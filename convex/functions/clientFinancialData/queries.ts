import { query, internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgIdSafe, getOrgId } from "../../lib/authHelpers";

/**
 * SS4 — Public + internal queries for clientFinancialData.
 *
 * Per docs/superpowers/specs/2026-05-27-financial-statements-ingestion-design.md §5,§6
 */

const PERIOD_TYPE_VALIDATOR = v.union(
  v.literal("monthly"),
  v.literal("quarterly"),
  v.literal("annual")
);

export const listByClient = query({
  args: {
    clientId: v.id("clients"),
    periodType: v.optional(PERIOD_TYPE_VALIDATOR),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    let rows = await ctx.db
      .query("clientFinancialData")
      .withIndex("by_orgId_clientId", (q) =>
        q.eq("orgId", orgId).eq("clientId", args.clientId)
      )
      .collect();

    if (args.periodType) {
      rows = rows.filter((r) => r.periodType === args.periodType);
    }

    // Sort by period desc (lexicographic works for YYYY-MM and YYYY-Qn given
    // zero-padded month and Q1..Q4 in [1,4]).
    rows.sort((a, b) => (a.period < b.period ? 1 : a.period > b.period ? -1 : 0));
    return rows;
  },
});

/**
 * Public version for deliverable-side reads where the caller must already
 * be authenticated.
 */
export const getFinancialContext = query({
  args: {
    clientId: v.id("clients"),
    periodType: PERIOD_TYPE_VALIDATOR,
    asOfPeriod: v.string(),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;
    return await fetchFinancialContext(ctx, orgId, args);
  },
});

/**
 * Internal version called from generateDeliverable action.
 */
export const getFinancialContextInternal = internalQuery({
  args: {
    orgId: v.string(),
    clientId: v.id("clients"),
    periodType: PERIOD_TYPE_VALIDATOR,
    asOfPeriod: v.string(),
  },
  handler: async (ctx, args) => {
    return await fetchFinancialContext(ctx, args.orgId, {
      clientId: args.clientId,
      periodType: args.periodType,
      asOfPeriod: args.asOfPeriod,
    });
  },
});

async function fetchFinancialContext(
  ctx: { db: any },
  orgId: string,
  args: {
    clientId: any;
    periodType: "monthly" | "quarterly" | "annual";
    asOfPeriod: string;
  }
) {
  const rows = await ctx.db
    .query("clientFinancialData")
    .withIndex("by_orgId_clientId", (q: any) =>
      q.eq("orgId", orgId).eq("clientId", args.clientId)
    )
    .collect();

  const eligible = rows.filter(
    (r: any) =>
      r.status === "validated" &&
      r.periodType === args.periodType &&
      r.period <= args.asOfPeriod
  );
  if (eligible.length === 0) return null;
  eligible.sort((a: any, b: any) =>
    a.period < b.period ? 1 : a.period > b.period ? -1 : 0
  );
  return eligible[0];
}
