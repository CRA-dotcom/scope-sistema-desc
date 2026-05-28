import { internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { requireAuth, getOrgId, getOrgIdSafe } from "../../lib/authHelpers";

/**
 * SS4 — Internal helpers for the `clientFinancialData` module.
 *
 * Per docs/superpowers/specs/2026-05-27-financial-statements-ingestion-design.md
 */

export const requireAuthCtx = internalQuery({
  args: {},
  handler: async (ctx) => {
    const identity = await requireAuth(ctx);
    const orgId = await getOrgId(ctx);
    return { userId: identity.subject, orgId };
  },
});

export const getClientForOrg = internalQuery({
  args: { clientId: v.id("clients"), orgId: v.string() },
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientId);
    if (!client || client.orgId !== args.orgId) return null;
    return client;
  },
});

export const getRowForOrg = internalQuery({
  args: { id: v.id("clientFinancialData") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;
    const row = await ctx.db.get(args.id);
    if (!row || row.orgId !== orgId) return null;
    return row;
  },
});

/**
 * Unauthenticated read by id. Caller MUST validate orgId.
 * Used by extractInternal action which runs after upload (no auth ctx).
 */
export const getRowRaw = internalQuery({
  args: { id: v.id("clientFinancialData") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});
