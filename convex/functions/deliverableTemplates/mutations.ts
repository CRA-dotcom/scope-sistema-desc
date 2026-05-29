import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import {
  getOrgId,
  getOrgIdMutation,
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
    issuingCompanyId: v.optional(v.id("issuingCompanies")),
    signerMode: v.optional(
      v.union(v.literal("client_only"), v.literal("co_sign")),
    ),
  },
  handler: async (ctx, args) => {
    const identity = await requireAuth(ctx);
    const superAdmin = isSuperAdminFromIdentity(identity);

    let resolvedOrgId: string | undefined;
    if (superAdmin) {
      resolvedOrgId = args.orgId;
    } else {
      await requireAdmin(ctx);
      const callerOrg = await getOrgIdMutation(ctx);
      if (args.orgId !== undefined && args.orgId !== callerOrg) {
        throw new Error("No puedes crear plantillas para otra organización.");
      }
      resolvedOrgId = callerOrg;
    }

    // SS2: type='contract' requires issuingCompanyId AND org-scope (no globals).
    // Other types must NOT have issuingCompanyId.
    if (args.type === "contract") {
      if (!args.issuingCompanyId) {
        throw new Error("issuingCompanyId is required for contract templates");
      }
      if (!resolvedOrgId) {
        throw new Error("Contract templates must be org-scoped (no globals)");
      }
    } else if (args.issuingCompanyId !== undefined) {
      throw new Error("issuingCompanyId only valid for contract type");
    }

    validatePlaceholdersDeclared(args.htmlTemplate, args.variables);

    const contentStatus = detectContentStatus(args.htmlTemplate);

    const now = Date.now();
    const newId = await ctx.db.insert("deliverableTemplates", {
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
      issuingCompanyId: args.issuingCompanyId,
      signerMode: args.signerMode,
      createdAt: now,
      updatedAt: now,
    });
    if (resolvedOrgId !== undefined) {
      await ctx.runMutation(
        internal.functions.documentEvents.internal.logEventMutation,
        {
          orgId: resolvedOrgId,
          entityType: "template" as const,
          entityId: newId,
          eventType: "created" as const,
          severity: "info" as const,
          actorUserId: identity.subject,
          actorType: "user" as const,
          message: `Plantilla "${args.name}" creada.`,
          metadata: {
            type: args.type,
            serviceName: args.serviceName,
            subserviceId: args.subserviceId,
          },
        }
      );
    }
    return newId;
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
      issuingCompanyId: v.optional(v.id("issuingCompanies")),
      signerMode: v.optional(
        v.union(v.literal("client_only"), v.literal("co_sign")),
      ),
    }),
  },
  handler: async (ctx, args) => {
    const tpl = await ctx.db.get(args.id);
    if (!tpl) throw new Error("Plantilla no encontrada.");

    const identity = await requireTemplateEditAccess(ctx, tpl);

    if (tpl.version !== args.expectedVersion) {
      throw new Error(
        `Versión obsoleta: la plantilla cambió a v${tpl.version} mientras editabas (esperabas v${args.expectedVersion}). Recargá los cambios.`,
      );
    }

    // SS2: validate issuingCompanyId on update — resolve effective type/issuingCompanyId.
    const effectiveType = args.patch.type ?? tpl.type;
    const effectiveIssuingCompanyId =
      "issuingCompanyId" in args.patch
        ? args.patch.issuingCompanyId
        : tpl.issuingCompanyId;
    if (effectiveType === "contract") {
      if (!effectiveIssuingCompanyId) {
        throw new Error("issuingCompanyId is required for contract templates");
      }
      if (!tpl.orgId) {
        throw new Error("Contract templates must be org-scoped (no globals)");
      }
    } else if (effectiveIssuingCompanyId !== undefined) {
      throw new Error("issuingCompanyId only valid for contract type");
    }

    const nextHtml = args.patch.htmlTemplate ?? tpl.htmlTemplate;
    const nextVars = args.patch.variables ?? tpl.variables;
    validatePlaceholdersDeclared(nextHtml, nextVars);

    const contentStatus = detectContentStatus(nextHtml);

    const nextVersion = tpl.version + 1;
    await ctx.db.patch(args.id, {
      ...args.patch,
      version: nextVersion,
      contentStatus,
      updatedAt: Date.now(),
    });
    if (tpl.orgId !== undefined) {
      await ctx.runMutation(
        internal.functions.documentEvents.internal.logEventMutation,
        {
          orgId: tpl.orgId,
          entityType: "template" as const,
          entityId: args.id,
          eventType: "updated" as const,
          severity: "info" as const,
          actorUserId: identity.subject,
          actorType: "user" as const,
          message: `Plantilla "${tpl.name}" actualizada (v${tpl.version} → v${nextVersion}).`,
          metadata: { patchKeys: Object.keys(args.patch), version: nextVersion },
        }
      );
    }
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
    const identity = await requireAdmin(ctx);
    const orgId = await getOrgIdMutation(ctx);

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
    const newId = await ctx.db.insert("deliverableTemplates", {
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
      contentStatus: source.contentStatus ?? detectContentStatus(source.htmlTemplate),
      parentTemplateId: source._id,
      originalVersionAtClone: source.version,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.runMutation(
      internal.functions.documentEvents.internal.logEventMutation,
      {
        orgId,
        entityType: "template" as const,
        entityId: newId,
        eventType: "personalized" as const,
        severity: "info" as const,
        actorUserId: identity.subject,
        actorType: "user" as const,
        message: `Plantilla global "${source.name}" personalizada para esta organización.`,
        metadata: {
          sourceTemplateId: args.globalTemplateId,
          originalVersionAtClone: source.version,
        },
      }
    );
    return newId;
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
    const identity = await requireAdmin(ctx);
    const orgId = await getOrgIdMutation(ctx);

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
    const mode: "soft" | "hard" = deliv ? "soft" : "hard";
    if (deliv) {
      await ctx.db.patch(args.orgTemplateId, {
        isActive: false,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.delete(args.orgTemplateId);
    }
    await ctx.runMutation(
      internal.functions.documentEvents.internal.logEventMutation,
      {
        orgId,
        entityType: "template" as const,
        entityId: args.orgTemplateId,
        eventType: "restored" as const,
        severity: "info" as const,
        actorUserId: identity.subject,
        actorType: "user" as const,
        message: `Plantilla "${tpl.name}" restaurada al default global (${mode}-delete).`,
        metadata: { mode, parentTemplateId: tpl.parentTemplateId },
      }
    );
    return { mode, id: args.orgTemplateId };
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
    const identity = await requireTemplateEditAccess(ctx, tpl);
    const next = !tpl.isActive;
    await ctx.db.patch(args.id, {
      isActive: next,
      updatedAt: Date.now(),
    });
    if (tpl.orgId !== undefined) {
      await ctx.runMutation(
        internal.functions.documentEvents.internal.logEventMutation,
        {
          orgId: tpl.orgId,
          entityType: "template" as const,
          entityId: args.id,
          eventType: "updated" as const,
          severity: "info" as const,
          actorUserId: identity.subject,
          actorType: "user" as const,
          message: `Plantilla "${tpl.name}" ${next ? "activada" : "desactivada"}.`,
          metadata: { isActive: next },
        }
      );
    }
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
    const identity = await requireTemplateEditAccess(ctx, tpl);

    if (tpl.orgId === undefined) {
      throw new Error(
        "No se pueden eliminar plantillas globales. Usá toggleActive para desactivar.",
      );
    }

    const deliv = await ctx.db
      .query("deliverables")
      .withIndex("by_templateId", (q) => q.eq("templateId", args.id))
      .first();
    const mode: "soft" | "hard" = deliv ? "soft" : "hard";
    if (deliv) {
      await ctx.db.patch(args.id, {
        isActive: false,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.delete(args.id);
    }
    await ctx.runMutation(
      internal.functions.documentEvents.internal.logEventMutation,
      {
        orgId: tpl.orgId,
        entityType: "template" as const,
        entityId: args.id,
        eventType: "deleted" as const,
        severity: "warning" as const,
        actorUserId: identity.subject,
        actorType: "user" as const,
        message: `Plantilla "${tpl.name}" eliminada (${mode}-delete).`,
        metadata: { mode, type: tpl.type },
      }
    );
    return { mode, id: args.id };
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
