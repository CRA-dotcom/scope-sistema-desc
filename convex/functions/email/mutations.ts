import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { requireAdmin, getOrgId, getOrgIdMutation } from "../../lib/authHelpers";

function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 4) return "****";
  return `${apiKey.slice(0, 7)}****${apiKey.slice(-4)}`;
}

export const upsertResendConfig = mutation({
  args: {
    apiKey: v.string(),
    fromEmail: v.string(),
    fromName: v.optional(v.string()),
    webhookSigningSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgIdMutation(ctx);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.fromEmail)) {
      throw new Error("fromEmail inválido");
    }
    if (args.apiKey.trim().length < 8) {
      throw new Error("API key inválido (muy corto)");
    }

    const existing = await ctx.db
      .query("orgIntegrations")
      .withIndex("by_orgId_provider", (q) =>
        q.eq("orgId", orgId).eq("provider", "resend")
      )
      .first();

    const now = Date.now();
    const configPayload = {
      apiKeySecretRef: args.apiKey,
      apiKeyMasked: maskApiKey(args.apiKey),
      fromEmail: args.fromEmail,
      fromName: args.fromName,
      webhookSecretRef: args.webhookSigningSecret,
    };

    if (existing) {
      await ctx.db.patch(existing._id, {
        config: configPayload,
        status: "active",
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("orgIntegrations", {
      orgId,
      provider: "resend",
      config: configPayload,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  },
});
