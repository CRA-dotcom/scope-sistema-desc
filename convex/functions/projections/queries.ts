import { query } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgId, getOrgIdSafe } from "../../lib/authHelpers";
import { Id } from "../../_generated/dataModel";
import { getProjectionDownstreamCounts } from "../../lib/projectionDownstream";
import { effectiveSubserviceIds } from "../../lib/subserviceIds";

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
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return false;
    const candidate = await ctx.db
      .query("projections")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
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

/**
 * Lista subservicios activos en la proyección que no tienen ninguna plantilla
 * con contentStatus="ready". Usado por <MissingContentBanner /> para advertir
 * que se generarán entregables con HTML placeholder.
 *
 * Spec: docs/superpowers/specs/2026-05-25-deliverable-content-catalog-design.md §4
 */
export const subservicesMissingContent = query({
  args: { projectionId: v.id("projections") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    const projection = await ctx.db.get(args.projectionId);
    if (!projection || projection.orgId !== orgId) return [];

    const activeRows = await ctx.db
      .query("projectionServices")
      .withIndex("by_projectionId_active", (q) =>
        q.eq("projectionId", args.projectionId).eq("isActive", true)
      )
      .collect();

    // Collect unique subserviceIds from active rows (multi-subservicio aware)
    const subIdsArr = activeRows.flatMap((ps) => effectiveSubserviceIds(ps));
    const uniqueSubIds = Array.from(new Set(subIdsArr));
    if (uniqueSubIds.length === 0) return [];

    // Fetch ready templates (global + org-scoped) in 2 batched scans
    const [globalReady, orgReady] = await Promise.all([
      ctx.db
        .query("deliverableTemplates")
        .withIndex("by_orgId", (q) => q.eq("orgId", undefined))
        .collect(),
      ctx.db
        .query("deliverableTemplates")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect(),
    ]);

    const readySubIds = new Set<string>();
    for (const tpl of [...globalReady, ...orgReady]) {
      if (tpl.contentStatus === "ready" && tpl.subserviceId) {
        readySubIds.add(tpl.subserviceId);
      }
    }

    // Fetch subservices in parallel (still N db.get but parallelized)
    const subDocs = await Promise.all(
      uniqueSubIds.map((id) => ctx.db.get(id))
    );

    const missing: Array<{
      subserviceId: Id<"subservices">;
      subserviceName: string;
      serviceName: string;
    }> = [];

    for (let i = 0; i < uniqueSubIds.length; i++) {
      const subId = uniqueSubIds[i];
      if (readySubIds.has(subId)) continue;
      const sub = subDocs[i];
      if (!sub) continue;
      // Find serviceName from any active row that has this subservice
      const ps = activeRows.find((p) =>
        effectiveSubserviceIds(p).includes(subId)
      );
      missing.push({
        subserviceId: subId,
        subserviceName: sub.name,
        serviceName: ps?.serviceName ?? "",
      });
    }

    return missing;
  },
});

export const getDownstreamSummary = query({
  args: { projectionId: v.id("projections") },
  handler: async (ctx, { projectionId }) => {
    const orgId = await getOrgId(ctx);
    const p = await ctx.db.get(projectionId);
    if (!p || p.orgId !== orgId) throw new Error("Proyección no encontrada.");
    return await getProjectionDownstreamCounts(ctx, projectionId);
  },
});
