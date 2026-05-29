import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgId, getOrgIdMutation, requireAdmin } from "../../lib/authHelpers";

/**
 * Mask an API key for safe display: first 7 chars + `****` + last 4.
 * Mirrors `convex/functions/email/mutations.ts:maskApiKey`.
 */
function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 4) return "****";
  return `${apiKey.slice(0, 7)}****${apiKey.slice(-4)}`;
}

/**
 * D2 §3.3 — `upsertFirmameConfig`
 *
 * Persist Firmame credentials per org. Idempotent: re-calling with new
 * credentials patches the existing row. Beta-only: no live verification —
 * status is set to `pending_verification` and the real Firmame integration
 * is backlog post-beta.
 */
export const upsertFirmameConfig = mutation({
  args: {
    apiKey: v.string(),
    apiSecret: v.optional(v.string()),
    sandboxMode: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgIdMutation(ctx);

    if (args.apiKey.trim().length < 8) {
      throw new Error("API key inválido (muy corto).");
    }

    const existing = await ctx.db
      .query("orgIntegrations")
      .withIndex("by_orgId_provider", (q) =>
        q.eq("orgId", orgId).eq("provider", "other")
      )
      .filter((q) => q.eq(q.field("providerLabel"), "firmame"))
      .first();

    const now = Date.now();
    const configPayload = {
      apiKeySecretRef: args.apiKey,
      apiKeyMasked: maskApiKey(args.apiKey),
      webhookSecretRef: args.apiSecret,
      sandboxMode: args.sandboxMode ?? true,
    };

    if (existing) {
      await ctx.db.patch(existing._id, {
        config: configPayload,
        status: "pending_verification",
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("orgIntegrations", {
      orgId,
      provider: "other",
      providerLabel: "firmame",
      config: configPayload,
      status: "pending_verification",
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * D2 §3.3 — `deleteFirmameConfig`
 *
 * Remove the Firmame integration row for the caller's org. No-op if none.
 */
export const deleteFirmameConfig = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const orgId = await getOrgIdMutation(ctx);

    const existing = await ctx.db
      .query("orgIntegrations")
      .withIndex("by_orgId_provider", (q) =>
        q.eq("orgId", orgId).eq("provider", "other")
      )
      .filter((q) => q.eq(q.field("providerLabel"), "firmame"))
      .first();
    if (!existing) return { ok: true };
    await ctx.db.delete(existing._id);
    return { ok: true };
  },
});
