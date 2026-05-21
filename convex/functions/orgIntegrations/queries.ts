import { internalQuery, query } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgIdSafe, requireAuth } from "../../lib/authHelpers";

/**
 * D2 §3.3 — `listForOrg`
 *
 * Returns all integrations for the caller's org. **Strips secret-bearing
 * fields** (`apiKeySecretRef`, `webhookSecretRef`) before returning to the
 * client — mirrors the `email.queries.getResendConfig` pattern.
 */
export const listForOrg = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    const rows = await ctx.db
      .query("orgIntegrations")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    return rows.map((r) => ({
      _id: r._id,
      provider: r.provider,
      providerLabel: r.providerLabel,
      status: r.status,
      apiKeyMasked: r.config.apiKeyMasked,
      fromEmail: r.config.fromEmail,
      fromName: r.config.fromName,
      sandboxMode: r.config.sandboxMode,
      webhookUrl: r.config.webhookUrl,
      hasWebhookSecret: Boolean(r.config.webhookSecretRef),
      lastCheckedAt: r.lastCheckedAt,
      lastErrorMessage: r.lastErrorMessage,
      updatedAt: r.updatedAt,
    }));
  },
});

/**
 * D2 §3.3 — `getRailwayInfo`
 *
 * Returns read-only Railway blob-bucket info derived from env vars at the
 * Convex deploy. Never exposes credentials — only presence flags.
 */
export const getRailwayInfo = query({
  args: {},
  handler: async (ctx) => {
    await requireAuth(ctx);
    return {
      bucketName: process.env.RAILWAY_BUCKET_NAME ?? null,
      endpoint: process.env.RAILWAY_BUCKET_ENDPOINT ?? null,
      hasCredentials:
        Boolean(process.env.RAILWAY_BUCKET_KEY) &&
        Boolean(process.env.RAILWAY_BUCKET_SECRET),
    };
  },
});

/**
 * D2 §3.3 — internal-only query used by `testFirmameConnection` action to
 * load the Firmame config including `apiKeySecretRef`. Never expose to
 * clients.
 */
export const getFirmameConfigInternal = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("orgIntegrations")
      .withIndex("by_orgId_provider", (q) =>
        q.eq("orgId", args.orgId).eq("provider", "other")
      )
      .filter((q) => q.eq(q.field("providerLabel"), "firmame"))
      .first();
    if (!row) return null;
    return {
      _id: row._id,
      apiKeySecretRef: row.config.apiKeySecretRef ?? null,
      webhookSecretRef: row.config.webhookSecretRef ?? null,
      sandboxMode: row.config.sandboxMode ?? null,
      status: row.status,
    };
  },
});
