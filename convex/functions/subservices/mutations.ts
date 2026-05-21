import { mutation, MutationCtx } from "../../_generated/server";
import { v } from "convex/values";
import { Id } from "../../_generated/dataModel";
import { getOrgId, requireAdmin } from "../../lib/authHelpers";

/**
 * Internal helper: derive a stable kebab-case slug from a name.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    // strip combining diacritics (Unicode block U+0300–U+036F)
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

const FREQUENCY_VALIDATOR = v.union(
  v.literal("mensual"),
  v.literal("trimestral"),
  v.literal("semestral"),
  v.literal("anual"),
  v.literal("una_vez")
);

/**
 * create — operator creates an org-scoped subservice.
 *
 * Multi-tenant: orgId is derived from the JWT, never accepted as an arg.
 * Idempotency-ish: rejects duplicate (parentServiceId, slug) within the
 * caller's org. Existing global rows with same slug are NOT rejected — that
 * is the intentional "override" case (listByParent prefers org-scoped).
 */
export const create = mutation({
  args: {
    parentServiceId: v.id("services"),
    name: v.string(),
    slug: v.optional(v.string()),
    description: v.optional(v.string()),
    defaultFrequency: FREQUENCY_VALIDATOR,
    applicableMonths: v.optional(v.array(v.number())),
    cooldownMonths: v.optional(v.number()),
    defaultPricingHint: v.optional(v.number()),
    isCommission: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    const parent = await ctx.db.get(args.parentServiceId);
    if (!parent) throw new Error("Servicio padre no encontrado.");

    const rawSlug = args.slug?.trim();
    if (rawSlug !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(rawSlug)) {
      throw new Error("Slug inválido: usa kebab-case (solo minúsculas, números y guiones).");
    }
    const slug = rawSlug ?? slugify(args.name);
    if (!slug) {
      throw new Error("Slug inválido. Proporciona un nombre con caracteres alfanuméricos.");
    }

    const existing = await ctx.db
      .query("subservices")
      .withIndex("by_parent_slug", (q) =>
        q.eq("parentServiceId", args.parentServiceId).eq("slug", slug)
      )
      .filter((q) => q.eq(q.field("orgId"), orgId))
      .first();
    if (existing) {
      throw new Error(
        `Ya existe un subservicio "${slug}" bajo ${parent.name} en este org.`
      );
    }

    const now = Date.now();
    return await ctx.db.insert("subservices", {
      orgId,
      parentServiceId: args.parentServiceId,
      name: args.name,
      slug,
      description: args.description,
      defaultFrequency: args.defaultFrequency,
      applicableMonths: args.applicableMonths,
      cooldownMonths: args.cooldownMonths,
      defaultPricingHint: args.defaultPricingHint,
      isCommission: args.isCommission ?? parent.isCommission ?? false,
      isActive: true,
      isDefault: false,
      sortOrder: args.sortOrder ?? 100,
      createdAt: now,
      updatedAt: now,
    });
    // TODO Z1: emit documentEvent { type: "created", documentType: "subservice" }
    // when the wrapper exists (A3 §8).
  },
});

/**
 * update — partial patch on an org-scoped subservice.
 *
 * Multi-tenant guard: rejects if the row's orgId doesn't match the caller's
 * org. Explicitly REJECTS editing globals (R1 §12 #2): the operator must
 * call `personalizeGlobal` first to fork the row into their org.
 */
export const update = mutation({
  args: {
    id: v.id("subservices"),
    patch: v.object({
      name: v.optional(v.string()),
      description: v.optional(v.string()),
      defaultFrequency: v.optional(FREQUENCY_VALIDATOR),
      applicableMonths: v.optional(v.array(v.number())),
      cooldownMonths: v.optional(v.number()),
      defaultPricingHint: v.optional(v.number()),
      isCommission: v.optional(v.boolean()),
      sortOrder: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    const sub = await ctx.db.get(args.id);
    if (!sub) throw new Error("Subservicio no encontrado.");
    if (sub.orgId === undefined) {
      throw new Error(
        "No puedes editar el catálogo global directamente. Personaliza este subservicio para tu org primero."
      );
    }
    if (sub.orgId !== orgId) {
      throw new Error("Subservicio no encontrado.");
    }
    await ctx.db.patch(args.id, { ...args.patch, updatedAt: Date.now() });
    return args.id;
  },
});

/**
 * personalizeGlobal — explicit copy-on-write: clone a global subservice
 * into the caller's org. Sets parentSubserviceId + originalVersionAtClone
 * for traceability. Idempotent: returns the existing clone if one already
 * exists for the same (parent, slug) in this org.
 */
export const personalizeGlobal = mutation({
  args: { sourceId: v.id("subservices") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    const source = await ctx.db.get(args.sourceId);
    if (!source) throw new Error("Subservicio fuente no encontrado.");
    if (source.orgId !== undefined) {
      throw new Error("Solo se pueden personalizar subservicios globales.");
    }

    const existing = await ctx.db
      .query("subservices")
      .withIndex("by_parent_slug", (q) =>
        q.eq("parentServiceId", source.parentServiceId).eq("slug", source.slug)
      )
      .filter((q) => q.eq(q.field("orgId"), orgId))
      .first();
    if (existing) return existing._id;

    const now = Date.now();
    return await ctx.db.insert("subservices", {
      orgId,
      parentServiceId: source.parentServiceId,
      name: source.name,
      slug: source.slug,
      description: source.description,
      defaultFrequency: source.defaultFrequency,
      applicableMonths: source.applicableMonths,
      cooldownMonths: source.cooldownMonths,
      defaultPricingHint: source.defaultPricingHint,
      isCommission: source.isCommission,
      isActive: true,
      isDefault: false,
      sortOrder: source.sortOrder,
      parentSubserviceId: source._id,
      originalVersionAtClone: source.updatedAt,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * restoreToGlobal — operator undoes a personalizeGlobal by deleting the
 * org-scoped row. The resolver in listByParent / listAllForOrg falls back
 * to the global automatically.
 *
 * Refs check: if the org-scoped row is referenced anywhere, restore is
 * blocked (same gate as `remove`) — operator must reassign or soft-delete
 * first.
 */
export const restoreToGlobal = mutation({
  args: { id: v.id("subservices") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    const sub = await ctx.db.get(args.id);
    if (!sub) throw new Error("Subservicio no encontrado.");
    if (sub.orgId === undefined) {
      throw new Error(
        "Este subservicio ya es global. No hay nada que restaurar."
      );
    }
    if (sub.orgId !== orgId) {
      throw new Error("Subservicio no encontrado.");
    }

    const blockers = await findActiveRefs(ctx, orgId, args.id);
    if (blockers.length > 0) {
      throw new Error(
        `No se puede restaurar al catálogo global. Está referenciado por: ${blockers.join(", ")}. ` +
          `Reasigna o desactiva las referencias primero.`
      );
    }

    await ctx.db.delete(args.id);
    return { ok: true };
  },
});

/**
 * toggleActive — soft delete reversible. Operator can hide an org-scoped
 * subservice from `listByParent` without losing history.
 */
export const toggleActive = mutation({
  args: { id: v.id("subservices") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    const sub = await ctx.db.get(args.id);
    if (!sub) throw new Error("Subservicio no encontrado.");
    if (sub.orgId === undefined) {
      throw new Error(
        "No puedes desactivar el catálogo global. Personaliza primero."
      );
    }
    if (sub.orgId !== orgId) {
      throw new Error("Subservicio no encontrado.");
    }
    const next = !sub.isActive;
    await ctx.db.patch(args.id, {
      isActive: next,
      updatedAt: Date.now(),
    });
    return { id: args.id, isActive: next };
  },
});

/**
 * remove — hard delete. Blocked if there are active refs in any of the 6
 * downstream tables (R1 §10 R12).
 */
export const remove = mutation({
  args: { id: v.id("subservices") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    const sub = await ctx.db.get(args.id);
    if (!sub) throw new Error("Subservicio no encontrado.");
    if (sub.orgId === undefined) {
      throw new Error(
        "No puedes eliminar el catálogo global desde un org."
      );
    }
    if (sub.orgId !== orgId) {
      throw new Error("Subservicio no encontrado.");
    }

    const blockers = await findActiveRefs(ctx, orgId, args.id);
    if (blockers.length > 0) {
      throw new Error(
        `No se puede eliminar este subservicio. Está referenciado por: ${blockers.join(", ")}. ` +
          `Considera desactivarlo en lugar de eliminarlo.`
      );
    }

    await ctx.db.delete(args.id);
    return { ok: true };
  },
});

/**
 * Internal helper: returns labels of tables that still reference this
 * subservice. Used by `remove` and `restoreToGlobal`.
 */
// TODO scale: this performs 6 full org-scoped scans per remove() call. At ~12-month×N-service
// volumes the cost grows linearly with rows per org. If perf becomes an issue, add
// `by_orgId_subserviceId` compound indexes on each of the 6 referenced tables.
async function findActiveRefs(
  ctx: MutationCtx,
  orgId: string,
  subId: Id<"subservices">
): Promise<string[]> {
  const blockers: string[] = [];

  const projServices = await ctx.db
    .query("projectionServices")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .filter((q) => q.eq(q.field("subserviceId"), subId))
    .first();
  if (projServices) blockers.push("una o más proyecciones activas");

  const monthly = await ctx.db
    .query("monthlyAssignments")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .filter((q) => q.eq(q.field("subserviceId"), subId))
    .first();
  if (monthly) blockers.push("asignaciones mensuales");

  const quotes = await ctx.db
    .query("quotations")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .filter((q) => q.eq(q.field("subserviceId"), subId))
    .first();
  if (quotes) blockers.push("cotizaciones");

  const contracts = await ctx.db
    .query("contracts")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .filter((q) => q.eq(q.field("subserviceId"), subId))
    .first();
  if (contracts) blockers.push("contratos");

  const deliv = await ctx.db
    .query("deliverables")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .filter((q) => q.eq(q.field("subserviceId"), subId))
    .first();
  if (deliv) blockers.push("entregables");

  const tpls = await ctx.db
    .query("deliverableTemplates")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .filter((q) => q.eq(q.field("subserviceId"), subId))
    .first();
  if (tpls) blockers.push("plantillas");

  return blockers;
}
