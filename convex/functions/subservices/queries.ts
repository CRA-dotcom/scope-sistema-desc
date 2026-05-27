import { query } from "../../_generated/server";
import { v } from "convex/values";
import {
  getOrgId,
  getOrgIdSafe,
  requireAuth,
  requireSuperAdmin,
} from "../../lib/authHelpers";

/**
 * listByParent — used by the projection wizard Step 2 and the operator config
 * page. Merges org-scoped subservices over globals; on slug collision the
 * org-scoped row wins.
 */
export const listByParent = query({
  args: { parentServiceId: v.id("services") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    const orgScoped = await ctx.db
      .query("subservices")
      .withIndex("by_orgId_parentService", (q) =>
        q.eq("orgId", orgId).eq("parentServiceId", args.parentServiceId)
      )
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    const globals = await ctx.db
      .query("subservices")
      .withIndex("by_orgId_parentService", (q) =>
        q.eq("orgId", undefined).eq("parentServiceId", args.parentServiceId)
      )
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    const orgSlugs = new Set(orgScoped.map((s) => s.slug));
    const merged = [
      ...orgScoped,
      ...globals.filter((g) => !orgSlugs.has(g.slug)),
    ];
    return merged.sort((a, b) => a.sortOrder - b.sortOrder);
  },
});

/**
 * listAllForOrg — used by `/configuracion/subservicios` to build the full
 * subservice tree visible to the caller's org. Includes both active and
 * inactive rows so the operator can re-activate soft-deleted entries. Dedups
 * (parentServiceId, slug) preferring org-scoped over globals.
 */
export const listAllForOrg = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    const orgScoped = await ctx.db
      .query("subservices")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    const globals = await ctx.db
      .query("subservices")
      .withIndex("by_orgId", (q) => q.eq("orgId", undefined))
      .collect();

    const key = (s: { parentServiceId: string; slug: string }) =>
      `${s.parentServiceId}::${s.slug}`;
    const orgKeys = new Set(orgScoped.map(key));
    return [
      ...orgScoped,
      ...globals.filter((g) => !orgKeys.has(key(g))),
    ].sort((a, b) => a.sortOrder - b.sortOrder);
  },
});

/**
 * getById — single-row fetch with multi-tenant guard. Returns null on
 * mismatch so reactive Convex queries don't error.
 */
export const getById = query({
  args: { id: v.id("subservices") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const sub = await ctx.db.get(args.id);
    if (!sub) return null;
    if (sub.orgId) {
      const orgId = await getOrgIdSafe(ctx);
      if (sub.orgId !== orgId) return null;
    }
    return sub;
  },
});

/**
 * listGlobalsForAdmin — used by `/platform/subservices` (D1). Returns empty
 * silently for non-super-admin callers (consistent with services.listAllForAdmin).
 */
export const listGlobalsForAdmin = query({
  args: {},
  handler: async (ctx) => {
    try {
      await requireSuperAdmin(ctx);
    } catch {
      return [];
    }
    return await ctx.db
      .query("subservices")
      .withIndex("by_orgId", (q) => q.eq("orgId", undefined))
      .collect();
  },
});

/**
 * getYearOverYearHint — SS6: detect whether a client qualifies for a
 * year-over-year discount on a given subservice.
 *
 * Returns `{ available: true, priorProjectionYear, discount }` when:
 *   1. The subservice has a `yearOverYearDiscount` configured (> 0).
 *   2. The client has at least one non-draft projection in this org that
 *      includes the given subserviceId in its projectionServices.
 *
 * Returns `{ available: false }` otherwise.
 *
 * Per docs/superpowers/specs/2026-05-27-year-over-year-tier-design.md §5
 */
export const getYearOverYearHint = query({
  args: {
    clientId: v.id("clients"),
    subserviceId: v.id("subservices"),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgId(ctx);

    const sub = await ctx.db.get(args.subserviceId);
    if (!sub) return { available: false as const };
    if (!sub.yearOverYearDiscount || sub.yearOverYearDiscount === 0) {
      return { available: false as const };
    }

    // Find prior projections for this client in this org (non-draft)
    const allProjections = await ctx.db
      .query("projections")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    const clientProjections = allProjections.filter(
      (p) => p.clientId === args.clientId && p.status !== "draft"
    );

    for (const proj of clientProjections) {
      const projServices = await ctx.db
        .query("projectionServices")
        .withIndex("by_projectionId", (q) => q.eq("projectionId", proj._id))
        .collect();

      const hasMatch = projServices.some(
        (ps) => ps.subserviceId === args.subserviceId
      );
      if (hasMatch) {
        return {
          available: true as const,
          priorProjectionYear: proj.year,
          discount: sub.yearOverYearDiscount,
        };
      }
    }

    return { available: false as const };
  },
});
