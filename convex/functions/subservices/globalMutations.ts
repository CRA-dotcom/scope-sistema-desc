import { mutation, query } from "../../_generated/server";
import { v } from "convex/values";
import { requireSuperAdmin } from "../../lib/authHelpers";
import { internal } from "../../_generated/api";
import { slugify } from "./mutations";

/**
 * D1 — Super-admin mutations for the global subservices catalog.
 *
 * Per docs/superpowers/specs/2026-05-27-super-admin-panels-design.md §3.4
 *
 * A1 entregó `subservices.mutations.{create,update,...}` para el path
 * org-scoped (esos rechazan editar globales). D1 entrega los equivalentes
 * super-admin que sí pueden tocar el catálogo (`orgId === undefined`).
 *
 * Todas las mutations loguean al `documentEvents` con `orgId: "__platform__"`
 * (marker para eventos de super-admin sin org concreto).
 */

const FREQUENCY_VALIDATOR = v.union(
  v.literal("mensual"),
  v.literal("trimestral"),
  v.literal("semestral"),
  v.literal("anual"),
  v.literal("una_vez")
);

const PLATFORM_ORG_MARKER = "__platform__";

export const createGlobal = mutation({
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
    const identity = await requireSuperAdmin(ctx);
    const parent = await ctx.db.get(args.parentServiceId);
    if (!parent) throw new Error("Servicio padre no encontrado.");

    const rawSlug = args.slug?.trim();
    if (rawSlug !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(rawSlug)) {
      throw new Error(
        "Slug inválido: usa kebab-case (solo minúsculas, números y guiones)."
      );
    }
    const slug = rawSlug ?? slugify(args.name);
    if (!slug) {
      throw new Error(
        "Slug inválido. Proporciona un nombre con caracteres alfanuméricos."
      );
    }

    // Unicidad global: (parentServiceId, slug, orgId=undefined).
    const existing = await ctx.db
      .query("subservices")
      .withIndex("by_parent_slug", (q) =>
        q.eq("parentServiceId", args.parentServiceId).eq("slug", slug)
      )
      .filter((q) => q.eq(q.field("orgId"), undefined))
      .first();
    if (existing) {
      throw new Error(
        `Ya existe subservicio global "${slug}" bajo ${parent.name}.`
      );
    }

    const now = Date.now();
    const id = await ctx.db.insert("subservices", {
      orgId: undefined, // global
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
      isDefault: true,
      sortOrder: args.sortOrder ?? 100,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.runMutation(
      internal.functions.documentEvents.internal.logEventMutation,
      {
        orgId: PLATFORM_ORG_MARKER,
        entityType: "subservice" as const,
        entityId: id as string,
        eventType: "created" as const,
        severity: "info" as const,
        actorType: "user" as const,
        actorUserId: identity.subject,
        message: `Subservicio global creado: ${parent.name} → ${args.name}`,
        metadata: {
          scope: "global",
          parentServiceId: args.parentServiceId,
        },
      }
    );

    return id;
  },
});

export const updateGlobal = mutation({
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
      isActive: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    const identity = await requireSuperAdmin(ctx);
    const sub = await ctx.db.get(args.id);
    if (!sub) throw new Error("Subservicio no encontrado.");
    if (sub.orgId !== undefined) {
      throw new Error(
        "Esta mutation solo edita globales. Usa subservices.update para org-scoped."
      );
    }

    // Drift warning si hay orgs con clones del mismo slug (R1 §10 R2).
    const clones = await ctx.db
      .query("subservices")
      .withIndex("by_parent_slug", (q) =>
        q.eq("parentServiceId", sub.parentServiceId).eq("slug", sub.slug)
      )
      .filter((q) => q.neq(q.field("orgId"), undefined))
      .collect();

    await ctx.db.patch(args.id, { ...args.patch, updatedAt: Date.now() });

    await ctx.runMutation(
      internal.functions.documentEvents.internal.logEventMutation,
      {
        orgId: PLATFORM_ORG_MARKER,
        entityType: "subservice" as const,
        entityId: args.id as string,
        eventType: "updated" as const,
        severity: (clones.length > 0 ? "warning" : "info") as
          | "warning"
          | "info",
        actorType: "user" as const,
        actorUserId: identity.subject,
        message:
          clones.length > 0
            ? `Subservicio global actualizado. Hay ${clones.length} orgs con clones que NO recibirán este cambio.`
            : `Subservicio global actualizado.`,
        metadata: { scope: "global", clonesCount: clones.length },
      }
    );

    return { id: args.id, clonesAffected: clones.length };
  },
});

export const deleteGlobal = mutation({
  args: {
    id: v.id("subservices"),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await requireSuperAdmin(ctx);
    const sub = await ctx.db.get(args.id);
    if (!sub) throw new Error("Subservicio no encontrado.");
    if (sub.orgId !== undefined) {
      throw new Error("Esta mutation solo borra globales.");
    }

    // Bloquear si hay clones org-scoped, salvo `force` explícito (Q3 §8).
    const clones = await ctx.db
      .query("subservices")
      .withIndex("by_parent_slug", (q) =>
        q.eq("parentServiceId", sub.parentServiceId).eq("slug", sub.slug)
      )
      .filter((q) => q.neq(q.field("orgId"), undefined))
      .collect();

    if (clones.length > 0 && !args.force) {
      throw new Error(
        `No se puede eliminar: ${clones.length} orgs tienen copias de este subservicio. ` +
          `Usa toggleActive en su lugar, o pasa { force: true } para eliminar SOLO el global ` +
          `(las copias org-scoped siguen vivas).`
      );
    }

    await ctx.db.delete(args.id);

    await ctx.runMutation(
      internal.functions.documentEvents.internal.logEventMutation,
      {
        orgId: PLATFORM_ORG_MARKER,
        entityType: "subservice" as const,
        entityId: args.id as string,
        eventType: "deleted" as const,
        severity: "warning" as const,
        actorType: "user" as const,
        actorUserId: identity.subject,
        message: `Subservicio global eliminado.${
          clones.length > 0
            ? ` ${clones.length} clones org-scoped quedan huérfanos.`
            : ""
        }`,
        metadata: {
          scope: "global",
          clonesLeftOrphan: clones.length,
          force: args.force ?? false,
        },
      }
    );

    return { ok: true, clonesLeftOrphan: clones.length };
  },
});

/**
 * Lista las orgs con clones org-scoped de un subservicio global dado.
 * Usado por el dialog "Ver orgs con clones" de /platform/subservices.
 */
export const listOrgsWithClones = query({
  args: { globalSubserviceId: v.id("subservices") },
  handler: async (ctx, args) => {
    try {
      await requireSuperAdmin(ctx);
    } catch {
      return [];
    }
    const global = await ctx.db.get(args.globalSubserviceId);
    if (!global || global.orgId !== undefined) return [];

    const clones = await ctx.db
      .query("subservices")
      .withIndex("by_parent_slug", (q) =>
        q.eq("parentServiceId", global.parentServiceId).eq("slug", global.slug)
      )
      .filter((q) => q.neq(q.field("orgId"), undefined))
      .collect();

    // Resolve org names.
    const orgIds = Array.from(new Set(clones.map((c) => c.orgId!)));
    const orgs = await Promise.all(
      orgIds.map((oid) =>
        ctx.db
          .query("organizations")
          .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", oid))
          .unique()
      )
    );
    const nameMap = new Map(
      orgs.filter((o): o is NonNullable<typeof o> => Boolean(o)).map((o) => [
        o.clerkOrgId,
        o.name,
      ])
    );

    return clones.map((c) => ({
      cloneId: c._id,
      orgId: c.orgId!,
      orgName: nameMap.get(c.orgId!) ?? c.orgId!,
      lastUpdated: c.updatedAt,
      isActive: c.isActive,
    }));
  },
});
