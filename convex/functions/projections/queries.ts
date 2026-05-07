import { query } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgIdSafe } from "../../lib/authHelpers";

export const getByClient = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];
    return await ctx.db
      .query("projections")
      .withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
      .collect()
      .then((projs) =>
        projs
          .filter((p) => p.orgId === orgId)
          .sort((a, b) => b.year - a.year)
      );
  },
});

export const getById = query({
  args: { id: v.id("projections") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;
    const projection = await ctx.db.get(args.id);
    if (!projection || projection.orgId !== orgId) return null;
    return projection;
  },
});

export const getMatrix = query({
  args: { projectionId: v.id("projections") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;
    const projection = await ctx.db.get(args.projectionId);
    if (!projection || projection.orgId !== orgId) return null;

    const projServices = await ctx.db
      .query("projectionServices")
      .withIndex("by_projectionId", (q) =>
        q.eq("projectionId", args.projectionId)
      )
      .collect();

    const assignments = await ctx.db
      .query("monthlyAssignments")
      .withIndex("by_projectionId", (q) =>
        q.eq("projectionId", args.projectionId)
      )
      .collect();

    return {
      projection,
      services: projServices,
      assignments,
    };
  },
});

export const hasSuccessor = query({
  args: { projectionId: v.id("projections") },
  handler: async (ctx, { projectionId }) => {
    const candidate = await ctx.db
      .query("projections")
      .filter((q) => q.eq(q.field("previousProjectionId"), projectionId))
      .first();
    return candidate !== null;
  },
});

export const list = query({
  args: {
    year: v.optional(v.number()),
    status: v.optional(
      v.union(v.literal("draft"), v.literal("active"), v.literal("archived"))
    ),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    let projections = await ctx.db
      .query("projections")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    if (args.year) {
      projections = projections.filter((p) => p.year === args.year);
    }
    if (args.status) {
      projections = projections.filter((p) => p.status === args.status);
    }

    const enriched = await Promise.all(
      projections.map(async (p) => {
        const client = await ctx.db.get(p.clientId);
        return {
          ...p,
          clientName: client?.name ?? "Cliente eliminado",
        };
      })
    );

    return enriched.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});
