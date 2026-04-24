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

export default http;
