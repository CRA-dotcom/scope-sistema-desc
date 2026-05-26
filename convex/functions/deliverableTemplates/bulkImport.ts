import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import { detectContentStatus } from "../../lib/templateContent";
import { validatePlaceholdersDeclared } from "../../lib/templatePlaceholders";

const STANDARD_VARIABLES = [
  {
    key: "cliente.nombre",
    label: "Nombre del cliente",
    source: "client" as const,
    required: true,
  },
  {
    key: "cliente.rfc",
    label: "RFC del cliente",
    source: "client" as const,
    required: false,
  },
  {
    key: "proyeccion.mes",
    label: "Mes de la proyección",
    source: "projection" as const,
    required: true,
  },
  {
    key: "proyeccion.año",
    label: "Año de la proyección",
    source: "projection" as const,
    required: true,
  },
  {
    key: "ai.diagnostico",
    label: "Diagnóstico ejecutivo (AI)",
    source: "ai" as const,
    required: true,
  },
];

/**
 * Internal upsert called by scripts/import-templates.ts CLI.
 * Looks up subservice by (parentServiceName, subserviceSlug), then upserts
 * a GLOBAL deliverableTemplate (orgId=undefined) for that subservice+type.
 *
 * Returns action='created' | 'updated' + templateId + derived contentStatus.
 * Spec: docs/superpowers/specs/2026-05-25-deliverable-content-catalog-design.md §7
 */
export const upsertFromFile = internalMutation({
  args: {
    parentServiceName: v.string(),
    subserviceSlug: v.string(),
    type: v.union(
      v.literal("quotation"),
      v.literal("contract"),
      v.literal("deliverable_short"),
      v.literal("deliverable_long"),
      v.literal("questionnaire")
    ),
    name: v.string(),
    htmlTemplate: v.string(),
  },
  handler: async (ctx, args) => {
    // Collect ALL services with this name, then filter for the global one
    // (orgId === undefined). Without this, .first() could return an org-scoped
    // service that happens to share the same name, silently linking the global
    // template to a tenant service ID (adversarial review issue #1).
    const allWithName = await ctx.db
      .query("services")
      .withIndex("by_name", (q) => q.eq("name", args.parentServiceName))
      .collect();
    const parentSvc = allWithName.find((s) => s.orgId === undefined);
    if (!parentSvc) {
      throw new Error(`Global service "${args.parentServiceName}" not found.`);
    }

    const subsvc = await ctx.db
      .query("subservices")
      .withIndex("by_parent_slug", (q) =>
        q.eq("parentServiceId", parentSvc._id).eq("slug", args.subserviceSlug)
      )
      .first();
    if (!subsvc) {
      throw new Error(
        `Subservice "${args.subserviceSlug}" under "${args.parentServiceName}" not found.`
      );
    }

    // Look up existing GLOBAL template for (subservice + type).
    // Uses by_orgId_subserviceId with orgId=undefined bound first so the index
    // scan returns only global rows — avoids pulling cross-tenant templates into
    // memory (adversarial review issue #3).
    const candidates = await ctx.db
      .query("deliverableTemplates")
      .withIndex("by_orgId_subserviceId", (q) =>
        q.eq("orgId", undefined).eq("subserviceId", subsvc._id)
      )
      .collect();
    const existing = candidates.find((t) => t.type === args.type);

    // Validate that every {{key}} in htmlTemplate is declared in STANDARD_VARIABLES.
    // Without this, bulk-imported HTML with undeclared placeholders silently
    // produces broken deliverable generation later (adversarial review issue #2).
    validatePlaceholdersDeclared(args.htmlTemplate, STANDARD_VARIABLES);

    const contentStatus = detectContentStatus(args.htmlTemplate);
    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        htmlTemplate: args.htmlTemplate,
        version: existing.version + 1,
        contentStatus,
        updatedAt: now,
      });
      return {
        action: "updated" as const,
        templateId: existing._id,
        contentStatus,
      };
    }

    const newId = await ctx.db.insert("deliverableTemplates", {
      orgId: undefined,
      serviceId: parentSvc._id,
      serviceName: parentSvc.name,
      subserviceId: subsvc._id,
      type: args.type,
      name: args.name,
      htmlTemplate: args.htmlTemplate,
      variables: STANDARD_VARIABLES,
      version: 1,
      isActive: true,
      contentStatus,
      createdAt: now,
      updatedAt: now,
    });

    return {
      action: "created" as const,
      templateId: newId,
      contentStatus,
    };
  },
});
