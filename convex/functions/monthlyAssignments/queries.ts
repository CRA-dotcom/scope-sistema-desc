import { query } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgIdSafe } from "../../lib/authHelpers";

export const listByProjection = query({
  args: { projectionId: v.id("projections") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];
    return await ctx.db
      .query("monthlyAssignments")
      .withIndex("by_projectionId", (q) => q.eq("projectionId", args.projectionId))
      .collect()
      .then((mas) => mas.filter((m) => m.orgId === orgId));
  },
});

export const listByClientMonth = query({
  args: { clientId: v.id("clients"), month: v.number() },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];
    return await ctx.db
      .query("monthlyAssignments")
      .withIndex("by_clientId_month", (q) => q.eq("clientId", args.clientId).eq("month", args.month))
      .collect()
      .then((mas) => mas.filter((m) => m.orgId === orgId));
  },
});

export const listByClient = query({
  args: { clientId: v.id("clients"), year: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];
    const all = await ctx.db
      .query("monthlyAssignments")
      .withIndex("by_clientId_month", (q) => q.eq("clientId", args.clientId))
      .collect();
    return all.filter(
      (a) => a.orgId === orgId && (args.year === undefined || a.year === args.year)
    );
  },
});

export const listOverdue = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const assignments = await ctx.db
      .query("monthlyAssignments")
      .withIndex("by_orgId_status", (q) => q.eq("orgId", orgId).eq("status", "pending"))
      .collect();

    return assignments.filter(
      (a) => a.year < currentYear || (a.year === currentYear && a.month < currentMonth)
    );
  },
});
