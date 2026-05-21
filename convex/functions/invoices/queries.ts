import { query } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgIdSafe, requireAuth } from "../../lib/authHelpers";

/**
 * A3 — Public queries for `invoices`.
 *
 * Per docs/superpowers/specs/2026-05-23-document-lifecycle-design.md §3.1.3
 */

export const listByClient = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];
    return await ctx.db
      .query("invoices")
      .withIndex("by_orgId_clientId", (q) =>
        q.eq("orgId", orgId).eq("clientId", args.clientId)
      )
      .order("desc")
      .collect();
  },
});

export const listForBilling = query({
  args: {
    year: v.number(),
    month: v.optional(v.number()),
    status: v.optional(
      v.union(
        v.literal("uploaded"),
        v.literal("paid"),
        v.literal("void")
      )
    ),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];
    let rows = await ctx.db
      .query("invoices")
      .withIndex("by_orgId", (qb) => qb.eq("orgId", orgId))
      .collect();
    rows = rows.filter((r) => r.year === args.year);
    if (args.month !== undefined) {
      rows = rows.filter((r) => r.month === args.month);
    }
    if (args.status) {
      rows = rows.filter((r) => r.status === args.status);
    }
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const getById = query({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;
    const inv = await ctx.db.get(args.invoiceId);
    if (!inv || inv.orgId !== orgId) return null;
    return inv;
  },
});
