import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { getOrgId, requireAdmin, requireSuperAdmin } from "../../lib/authHelpers";

export const createOrgOverride = mutation({
  args: {
    sourceServiceId: v.id("services"),
    minPct: v.number(),
    maxPct: v.number(),
    defaultPct: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    const source = await ctx.db.get(args.sourceServiceId);
    if (!source) throw new Error("Servicio base no encontrado.");

    // Check if override already exists
    const existing = await ctx.db
      .query("services")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const existingOverride = existing.find((s) => s.name === source.name);

    if (existingOverride) {
      await ctx.db.patch(existingOverride._id, {
        minPct: args.minPct,
        maxPct: args.maxPct,
        defaultPct: args.defaultPct,
      });
      return existingOverride._id;
    }

    return await ctx.db.insert("services", {
      orgId,
      name: source.name,
      type: source.type,
      minPct: args.minPct,
      maxPct: args.maxPct,
      defaultPct: args.defaultPct,
      isDefault: false,
      sortOrder: source.sortOrder,
    });
  },
});

export const resetToDefault = mutation({
  args: { serviceId: v.id("services") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    const service = await ctx.db.get(args.serviceId);
    if (!service || service.orgId !== orgId || service.isDefault) {
      throw new Error("No se puede resetear este servicio.");
    }

    // Phase 1 §3.4 — guard: no permitir reset si hay refs activas
    const refs: { table: string; count: number }[] = [];

    const projServices = await ctx.db
      .query("projectionServices")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .filter((q) => q.eq(q.field("serviceId"), args.serviceId))
      .first();
    if (projServices) refs.push({ table: "projectionServices", count: 1 });

    const subs = await ctx.db
      .query("subservices")
      .withIndex("by_parent_slug", (q) => q.eq("parentServiceId", args.serviceId))
      .first();
    if (subs) refs.push({ table: "subservices", count: 1 });

    const templates = await ctx.db
      .query("deliverableTemplates")
      .withIndex("by_serviceId", (q) => q.eq("serviceId", args.serviceId))
      .first();
    if (templates) refs.push({ table: "deliverableTemplates", count: 1 });

    const maps = await ctx.db
      .query("servicesIssuingCompanyMap")
      .withIndex("by_orgId_serviceId", (q) =>
        q.eq("orgId", orgId).eq("serviceId", args.serviceId)
      )
      .first();
    if (maps) refs.push({ table: "servicesIssuingCompanyMap", count: 1 });

    const overrides = await ctx.db
      .query("clientIssuingCompanyOverride")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .filter((q) => q.eq(q.field("serviceId"), args.serviceId))
      .first();
    if (overrides) refs.push({ table: "clientIssuingCompanyOverride", count: 1 });

    if (refs.length > 0) {
      throw new ConvexError({
        code: "HAS_ACTIVE_REFS",
        message: `Servicio en uso: ${refs.map((r) => `${r.count} ${r.table}`).join(", ")}`,
      });
    }

    await ctx.db.delete(args.serviceId);
  },
});

/**
 * Super Admin: Create a custom service (optionally for a specific org).
 */
export const createCustomForAdmin = mutation({
  args: {
    name: v.string(),
    type: v.union(v.literal("base"), v.literal("comodin")),
    orgId: v.optional(v.string()),
    minPct: v.number(),
    maxPct: v.number(),
    defaultPct: v.number(),
    isCommission: v.optional(v.boolean()),
    sortOrder: v.number(),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);

    return await ctx.db.insert("services", {
      orgId: args.orgId,
      name: args.name,
      type: args.type,
      minPct: args.minPct,
      maxPct: args.maxPct,
      defaultPct: args.defaultPct,
      isDefault: !args.orgId,
      isCommission: args.isCommission ?? false,
      isCustom: !!args.orgId,
      sortOrder: args.sortOrder,
    });
  },
});

/**
 * Super Admin: Update benchmarks and isCommission on any service.
 */
export const updateForAdmin = mutation({
  args: {
    serviceId: v.id("services"),
    minPct: v.optional(v.number()),
    maxPct: v.optional(v.number()),
    defaultPct: v.optional(v.number()),
    isCommission: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    const service = await ctx.db.get(args.serviceId);
    if (!service) throw new Error("Servicio no encontrado.");

    const patch: Record<string, unknown> = {};
    if (args.minPct !== undefined) patch.minPct = args.minPct;
    if (args.maxPct !== undefined) patch.maxPct = args.maxPct;
    if (args.defaultPct !== undefined) patch.defaultPct = args.defaultPct;
    if (args.isCommission !== undefined) patch.isCommission = args.isCommission;

    await ctx.db.patch(args.serviceId, patch);
    return args.serviceId;
  },
});
