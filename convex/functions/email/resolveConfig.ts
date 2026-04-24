import { internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import type { GenericQueryCtx } from "convex/server";
import type { DataModel } from "../../_generated/dataModel";

// Env vars consumed by platform fallback:
//   RESEND_API_KEY       — fallback API key
//   RESEND_WEBHOOK_SECRET — fallback webhook signing secret
//   RESEND_FROM_EMAIL    — optional default "noreply@projex-platform.com"
//   RESEND_FROM_NAME     — optional

export class ResendNotConfiguredError extends Error {
  constructor(orgId: string) {
    super(
      `No hay configuración de Resend activa para la org ${orgId}. ` +
        `Configura el API key en /configuracion/integraciones/resend o ` +
        `establece RESEND_API_KEY en environment.`
    );
    this.name = "ResendNotConfiguredError";
  }
}

export type ResendConfig = {
  apiKey: string;
  fromEmail: string;
  fromName?: string;
  webhookSigningSecret?: string;
  source: "org_integration" | "platform_env";
};

export async function resolveResendCredentials(
  ctx: GenericQueryCtx<DataModel>,
  args: { orgId: string }
): Promise<ResendConfig> {
  const orgConfig = await ctx.db
    .query("orgIntegrations")
    .withIndex("by_orgId_provider", (q) =>
      q.eq("orgId", args.orgId).eq("provider", "resend")
    )
    .first();

  if (
    orgConfig &&
    orgConfig.status === "active" &&
    orgConfig.config.apiKeySecretRef
  ) {
    return {
      apiKey: orgConfig.config.apiKeySecretRef,
      fromEmail: orgConfig.config.fromEmail ?? "noreply@projex-platform.com",
      fromName: orgConfig.config.fromName,
      webhookSigningSecret: orgConfig.config.webhookSecretRef,
      source: "org_integration",
    };
  }

  const platformKey = process.env.RESEND_API_KEY;
  if (!platformKey || platformKey === "placeholder") {
    throw new ResendNotConfiguredError(args.orgId);
  }

  return {
    apiKey: platformKey,
    fromEmail: process.env.RESEND_FROM_EMAIL ?? "noreply@projex-platform.com",
    fromName: process.env.RESEND_FROM_NAME,
    webhookSigningSecret: process.env.RESEND_WEBHOOK_SECRET,
    source: "platform_env",
  };
}

export const resolveResendCredentialsQuery = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, args) => resolveResendCredentials(ctx, args),
});

export const resolveWebhookSecretByMessageId = internalQuery({
  args: { providerMessageId: v.string() },
  handler: async (ctx, args) => {
    const log = await ctx.db
      .query("emailLog")
      .withIndex("by_providerMessageId", (q) =>
        q.eq("providerMessageId", args.providerMessageId)
      )
      .first();
    if (!log) return null;

    try {
      const config = await resolveResendCredentials(ctx, { orgId: log.orgId });
      return {
        orgId: log.orgId,
        emailLogId: log._id,
        webhookSigningSecret: config.webhookSigningSecret ?? null,
      };
    } catch {
      return {
        orgId: log.orgId,
        emailLogId: log._id,
        webhookSigningSecret: null,
      };
    }
  },
});
