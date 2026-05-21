import { internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { requireAuth, getOrgId, getOrgIdSafe } from "../../lib/authHelpers";

/**
 * A3 — Internal helpers for the `invoices` module.
 *
 * Per docs/superpowers/specs/2026-05-23-document-lifecycle-design.md §3.1
 */

/**
 * Resolve `{ userId, orgId }` from the auth context inside an action via
 * `ctx.runQuery`. Actions cannot read auth + db directly; this internal
 * query is the canonical bridge.
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

/**
 * Detect duplicate invoices (same client+year+month+subservice) that are not void.
 */
export const findDuplicate = internalQuery({
  args: {
    orgId: v.string(),
    clientId: v.id("clients"),
    year: v.number(),
    month: v.number(),
    subserviceId: v.optional(v.id("subservices")),
  },
  handler: async (ctx, args) => {
    const candidates = await ctx.db
      .query("invoices")
      .withIndex("by_orgId_clientId_year_month", (q) =>
        q
          .eq("orgId", args.orgId)
          .eq("clientId", args.clientId)
          .eq("year", args.year)
          .eq("month", args.month)
      )
      .collect();
    const nonVoid = candidates.filter((c) => c.status !== "void");
    return (
      nonVoid.find((c) => c.subserviceId === args.subserviceId) ?? null
    );
  },
});

/**
 * Auth-gated read by id (used by `getDownloadUrl` action).
 */
export const getInvoiceForOrg = internalQuery({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;
    const inv = await ctx.db.get(args.invoiceId);
    if (!inv || inv.orgId !== orgId) return null;
    return inv;
  },
});

/**
 * Unauthenticated read (used by `generateFromInvoice` which runs as system).
 * Caller MUST validate orgId/status from the returned row.
 */
export const getInvoiceForGeneration = internalQuery({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.invoiceId);
  },
});
