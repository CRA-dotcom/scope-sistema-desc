import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import {
  getOrgId,
  isSuperAdminFromIdentity,
  requireAdmin,
  requireAuth,
  requireSuperAdmin,
} from "../../lib/authHelpers";
import { requireTemplateEditAccess } from "../../lib/templateAccess";
import { validatePlaceholdersDeclared } from "../../lib/templatePlaceholders";
import { detectContentStatus } from "../../lib/templateContent";

const variableValidator = v.object({
  key: v.string(),
  label: v.string(),
  source: v.union(
    v.literal("client"),
    v.literal("projection"),
    v.literal("service"),
    v.literal("ai"),
    v.literal("manual"),
  ),
  required: v.boolean(),
});

const typeValidator = v.union(
  v.literal("quotation"),
  v.literal("contract"),
  v.literal("deliverable_short"),
  v.literal("deliverable_long"),
  v.literal("questionnaire"),
  v.literal("invoice"),
);

/**
 * Crea una plantilla. Dual-path:
 * - Super-admin: puede pasar `orgId` explícito (incluyendo `undefined` = global).
 * - Operador (org:admin): el `orgId` se fuerza al del caller. Si pasa otro orgId
 *   explícito, throw.
 *
 * Per A2 §3.3.
 */
export const create = mutation({
  args: {
    serviceId: v.optional(v.id("services")),
    serviceName: v.string(),
    subserviceId: v.optional(v.id("subservices")),
    type: typeValidator,
    name: v.string(),
    htmlTemplate: v.string(),
    variables: v.array(variableValidator),
    isActive: v.boolean(),
    orgId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireAuth(ctx);
    const superAdmin = isSuperAdminFromIdentity(identity);

    let resolvedOrgId: string | undefined;
    if (superAdmin) {
      resolvedOrgId = args.orgId;
    } else {
      await requireAdmin(ctx);
      const callerOrg = await getOrgId(ctx);
      if (args.orgId !== undefined && args.orgId !== callerOrg) {
        throw new Error("No puedes crear plantillas para otra organización.");
      }
      resolvedOrgId = callerOrg;
    }

    validatePlaceholdersDeclared(args.htmlTemplate, args.variables);

    const contentStatus = detectContentStatus(args.htmlTemplate);

    const now = Date.now();
    return await ctx.db.insert("deliverableTemplates", {
      orgId: resolvedOrgId,
      serviceId: args.serviceId,
      serviceName: args.serviceName,
      subserviceId: args.subserviceId,
      type: args.type,
      name: args.name,
      htmlTemplate: args.htmlTemplate,
      variables: args.variables,
      version: 1,
      isActive: args.isActive,
      contentStatus,
      parentTemplateId: undefined,
      originalVersionAtClone: undefined,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Update with optimistic concurrency. `expectedVersion` is the version the
 * caller saw before editing — if the row was bumped since (concurrent edit),
 * throws. The patched row gets `version: existing.version + 1`.
 *
 * Per A2 §3.3 — R15 (concurrencia) + R6 (placeholders declarados).
 */
export const update = mutation({
  args: {
    id: v.id("deliverableTemplates"),
    expectedVersion: v.number(),
    patch: v.object({
      name: v.optional(v.string()),
      htmlTemplate: v.optional(v.string()),
      variables: v.optional(v.array(variableValidator)),
      serviceName: v.optional(v.string()),
      serviceId: v.optional(v.id("services")),
      subserviceId: v.optional(v.id("subservices")),
      type: v.optional(typeValidator),
      isActive: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    const tpl = await ctx.db.get(args.id);
    if (!tpl) throw new Error("Plantilla no encontrada.");

    await requireTemplateEditAccess(ctx, tpl);

    if (tpl.version !== args.expectedVersion) {
      throw new Error(
        `Versión obsoleta: la plantilla cambió a v${tpl.version} mientras editabas (esperabas v${args.expectedVersion}). Recargá los cambios.`,
      );
    }

    const nextHtml = args.patch.htmlTemplate ?? tpl.htmlTemplate;
    const nextVars = args.patch.variables ?? tpl.variables;
    validatePlaceholdersDeclared(nextHtml, nextVars);

    const contentStatus = detectContentStatus(nextHtml);

    await ctx.db.patch(args.id, {
      ...args.patch,
      version: tpl.version + 1,
      contentStatus,
      updatedAt: Date.now(),
    });
    return args.id;
  },
});

/**
 * Operador clona el global a un row org-scoped. El clon arranca con
 * `version: 1` y guarda el linaje en `parentTemplateId` /
 * `originalVersionAtClone`. Idempotente: si ya existe un clon del mismo
 * global para el mismo org, lo devuelve.
 *
 * Per A2 §3.3.
 */
export const personalizeGlobal = mutation({
  args: { globalTemplateId: v.id("deliverableTemplates") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);

    const source = await ctx.db.get(args.globalTemplateId);
    if (!source) throw new Error("Plantilla fuente no encontrada.");
    if (source.orgId !== undefined) {
      throw new Error("Solo se pueden personalizar plantillas globales.");
    }

    const existing = await ctx.db
      .query("deliverableTemplates")
      .withIndex("by_parentTemplateId", (q) =>
        q.eq("parentTemplateId", args.globalTemplateId),
      )
      .filter((q) => q.eq(q.field("orgId"), orgId))
      .first();
    if (existing) return existing._id;

    const now = Date.now();
    return await ctx.db.insert("deliverableTemplates", {
      orgId,
      serviceId: source.serviceId,
      serviceName: source.serviceName,
      subserviceId: source.subserviceId,
      type: source.type,
      name: source.name,
      htmlTemplate: source.htmlTemplate,
      variables: source.variables,
      version: 1,
      isActive: source.isActive,
      contentStatus: source.contentStatus,
      parentTemplateId: source._id,
      originalVersionAtClone: source.version,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Restaura el clon org-scoped a la default global. Si no hay deliverables
 * apuntando a este clon, hard-delete y `listForOrg` vuelve a mostrar el
 * global. Si hay deliverables, soft-delete (`isActive: false`) para preservar
 * la referencia en el snapshot.
 *
 * Per A2 §3.3.
 */
export const restoreToGlobal = mutation({
  args: { orgTemplateId: v.id("deliverableTemplates") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);

    const tpl = await ctx.db.get(args.orgTemplateId);
    if (!tpl) throw new Error("Plantilla no encontrada.");
    if (tpl.orgId !== orgId) {
      throw new Error("No puedes restaurar una plantilla de otra organización.");
    }
    if (!tpl.parentTemplateId) {
      throw new Error(
        "Esta plantilla no se basa en una global. No hay default al cual restaurar.",
      );
    }

    const deliv = await ctx.db
      .query("deliverables")
      .withIndex("by_templateId", (q) => q.eq("templateId", args.orgTemplateId))
      .first();
    if (deliv) {
      await ctx.db.patch(args.orgTemplateId, {
        isActive: false,
        updatedAt: Date.now(),
      });
      return { mode: "soft" as const, id: args.orgTemplateId };
    }

    await ctx.db.delete(args.orgTemplateId);
    return { mode: "hard" as const, id: args.orgTemplateId };
  },
});

/**
 * Toggle active/inactive. Globals exigen super-admin via
 * `requireTemplateEditAccess`. Org-scoped exige el dueño.
 *
 * Per A2 §3.3.
 */
export const toggleActive = mutation({
  args: { id: v.id("deliverableTemplates") },
  handler: async (ctx, args) => {
    const tpl = await ctx.db.get(args.id);
    if (!tpl) throw new Error("Plantilla no encontrada.");
    await requireTemplateEditAccess(ctx, tpl);
    await ctx.db.patch(args.id, {
      isActive: !tpl.isActive,
      updatedAt: Date.now(),
    });
    return args.id;
  },
});

/**
 * Borra una plantilla. Globales nunca se hard-deletean (defensivo extra
 * sobre `requireTemplateEditAccess` que ya bloquea para operador). Org-scoped
 * con deliverables → soft-delete; sin deliverables → hard-delete.
 *
 * Per A2 §3.3.
 */
export const remove = mutation({
  args: { id: v.id("deliverableTemplates") },
  handler: async (ctx, args) => {
    const tpl = await ctx.db.get(args.id);
    if (!tpl) throw new Error("Plantilla no encontrada.");
    await requireTemplateEditAccess(ctx, tpl);

    if (tpl.orgId === undefined) {
      throw new Error(
        "No se pueden eliminar plantillas globales. Usá toggleActive para desactivar.",
      );
    }

    const deliv = await ctx.db
      .query("deliverables")
      .withIndex("by_templateId", (q) => q.eq("templateId", args.id))
      .first();
    if (deliv) {
      await ctx.db.patch(args.id, {
        isActive: false,
        updatedAt: Date.now(),
      });
      return { mode: "soft" as const, id: args.id };
    }

    await ctx.db.delete(args.id);
    return { mode: "hard" as const, id: args.id };
  },
});

/**
 * Super-admin only. Duplica un row tal cual (caso "global → global como
 * variante"). El operador usa `personalizeGlobal` en su lugar.
 *
 * Per A2 §3.1 tabla "duplicate".
 */
export const duplicate = mutation({
  args: {
    id: v.id("deliverableTemplates"),
    orgId: v.optional(v.string()),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Plantilla no encontrada.");

    const now = Date.now();
    return await ctx.db.insert("deliverableTemplates", {
      orgId: args.orgId ?? existing.orgId,
      serviceId: existing.serviceId,
      serviceName: existing.serviceName,
      subserviceId: existing.subserviceId,
      type: existing.type,
      name: args.name ?? `${existing.name} (copia)`,
      htmlTemplate: existing.htmlTemplate,
      variables: existing.variables,
      version: 1,
      isActive: false,
      parentTemplateId: undefined,
      originalVersionAtClone: undefined,
      createdAt: now,
      updatedAt: now,
    });
  },
});
