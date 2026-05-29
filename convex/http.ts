import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Webhook } from "svix";

const http = httpRouter();

http.route({
  path: "/webhooks/resend",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await req.text();
    const svixId = req.headers.get("svix-id") ?? "";
    const svixTimestamp = req.headers.get("svix-timestamp") ?? "";
    const svixSignature = req.headers.get("svix-signature") ?? "";
    if (!svixId || !svixTimestamp || !svixSignature) {
      return new Response("Missing svix headers", { status: 400 });
    }

    let payloadUnverified: {
      type: string;
      created_at: string;
      data: { email_id?: string; [k: string]: unknown };
    };
    try {
      payloadUnverified = JSON.parse(body);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const providerMessageId = payloadUnverified?.data?.email_id;
    if (!providerMessageId) {
      return new Response("Bad payload: missing email_id", { status: 400 });
    }

    const resolved = await ctx.runQuery(
      internal.functions.email.resolveConfig.resolveWebhookSecretByMessageId,
      { providerMessageId }
    );
    if (!resolved) {
      console.warn(
        `[Resend webhook] unknown providerMessageId=${providerMessageId}`
      );
      return new Response(null, { status: 200 });
    }
    if (!resolved.webhookSigningSecret) {
      console.warn(
        `[Resend webhook] no signing secret configured for org=${resolved.orgId}`
      );
      return new Response("No webhook secret configured", { status: 500 });
    }

    try {
      const wh = new Webhook(resolved.webhookSigningSecret);
      wh.verify(body, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      });
    } catch {
      return new Response("Invalid signature", { status: 401 });
    }

    await ctx.runMutation(
      internal.functions.email.internalMutations.handleWebhookEvent,
      {
        providerMessageId,
        event: {
          type: payloadUnverified.type,
          occurredAt: Date.parse(payloadUnverified.created_at),
          metadata: payloadUnverified.data,
        },
      }
    );

    return new Response(null, { status: 200 });
  }),
});

http.route({
  path: "/webhooks/clerk",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await req.text();
    const svixId = req.headers.get("svix-id") ?? "";
    const svixTimestamp = req.headers.get("svix-timestamp") ?? "";
    const svixSignature = req.headers.get("svix-signature") ?? "";
    if (!svixId || !svixTimestamp || !svixSignature) {
      return new Response("Missing svix headers", { status: 400 });
    }

    let event: { type: string; data: Record<string, unknown> };
    try {
      event = JSON.parse(body);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const secret = process.env.CLERK_WEBHOOK_SECRET;
    if (!secret) {
      console.error("[Clerk webhook] CLERK_WEBHOOK_SECRET env var not set");
      return new Response("Webhook secret not configured", { status: 500 });
    }

    try {
      const wh = new Webhook(secret);
      wh.verify(body, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      });
    } catch {
      return new Response("Invalid signature", { status: 401 });
    }

    const data = event.data as Record<string, unknown>;

    if (event.type === "organization.created") {
      await ctx.runMutation(
        internal.functions.organizations.webhookMutations.createFromClerkWebhook,
        {
          clerkOrgId: data.id as string,
          name: data.name as string,
          slug: (data.slug as string | undefined) ?? undefined,
          imageUrl: (data.image_url as string | undefined) ?? undefined,
          createdAt:
            typeof data.created_at === "number"
              ? data.created_at
              : Date.now(),
        }
      );
    } else if (event.type === "organization.updated") {
      await ctx.runMutation(
        internal.functions.organizations.webhookMutations.updateFromClerkWebhook,
        {
          clerkOrgId: data.id as string,
          name: (data.name as string | undefined) ?? undefined,
        }
      );
    } else if (event.type === "organization.deleted") {
      await ctx.runMutation(
        internal.functions.organizations.webhookMutations.markInactiveFromClerkWebhook,
        { clerkOrgId: data.id as string }
      );
    }
    // Unknown event types are silently accepted (200) — forward-compat.

    return new Response(null, { status: 200 });
  }),
});

export default http;
