import { query } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgIdSafe } from "../../lib/authHelpers";

export const getByAssignment = query({
  args: { assignmentId: v.id("monthlyAssignments") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;

    const results = await ctx.db
      .query("deliverables")
      .withIndex("by_assignmentId", (q) => q.eq("assignmentId", args.assignmentId))
      .collect();

    const deliverable = results.find((d) => d.orgId === orgId);
    return deliverable ?? null;
  },
});

export const listByClient = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    const results = await ctx.db
      .query("deliverables")
      .withIndex("by_orgId_clientId", (q) =>
        q.eq("orgId", orgId).eq("clientId", args.clientId)
      )
      .collect();

    return results.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const listByOrg = query({
  args: {
    year: v.optional(v.number()),
    month: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    let results;

    if (args.year && args.month) {
      results = await ctx.db
        .query("deliverables")
        .withIndex("by_orgId_year_month", (q) =>
          q.eq("orgId", orgId).eq("year", args.year!).eq("month", args.month!)
        )
        .collect();
    } else {
      results = await ctx.db
        .query("deliverables")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect();

      if (args.year) {
        results = results.filter((d) => d.year === args.year);
      }
    }

    return results.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const listByAuditStatus = query({
  args: {
    auditStatus: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("corrected")
    ),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    const results = await ctx.db
      .query("deliverables")
      .withIndex("by_orgId_auditStatus", (q) =>
        q.eq("orgId", orgId).eq("auditStatus", args.auditStatus)
      )
      .collect();

    return results.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const getById = query({
  args: { id: v.id("deliverables") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;
    const deliverable = await ctx.db.get(args.id);
    if (!deliverable || deliverable.orgId !== orgId) return null;
    return deliverable;
  },
});

export const listByClientMatrix = query({
  args: { clientId: v.id("clients"), year: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return { services: [], months: [] };

    const allDeliverables = await ctx.db
      .query("deliverables")
      .withIndex("by_orgId_clientId", (q) =>
        q.eq("orgId", orgId).eq("clientId", args.clientId)
      )
      .collect();

    // Filter to the requested year when provided
    const mine = args.year !== undefined
      ? allDeliverables.filter((d) => d.year === args.year)
      : allDeliverables;

    // Group by projServiceId
    const byService = new Map<
      string,
      {
        projServiceId: string;
        serviceName: string;
        deliverables: typeof mine;
      }
    >();

    for (const d of mine) {
      const key = d.projServiceId as unknown as string;
      if (!byService.has(key)) {
        byService.set(key, {
          projServiceId: key,
          serviceName: d.serviceName,
          deliverables: [],
        });
      }
      byService.get(key)!.deliverables.push(d);
    }

    const services = [...byService.values()].map((s) => ({
      ...s,
      deliverables: s.deliverables
        .map((d) => ({
          _id: d._id,
          assignmentId: d.assignmentId,
          month: d.month,
          year: d.year,
          auditStatus: d.auditStatus,
          deliveredAt: d.deliveredAt,
          createdAt: d.createdAt,
        }))
        .sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month)),
    }));

    const allMonths = [...new Set(mine.map((d) => d.month))].sort((a, b) => a - b);

    // Collect distinct years across all deliverables for this client
    const availableYears = [...new Set(allDeliverables.map((d) => d.year))].sort(
      (a, b) => b - a
    );

    return { services, months: allMonths, availableYears };
  },
});
