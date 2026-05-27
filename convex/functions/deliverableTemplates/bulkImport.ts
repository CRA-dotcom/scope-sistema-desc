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

/**
 * Internal upsert for contract templates, called by scripts/import-templates.ts CLI.
 *
 * Filename convention: <empresa-slug>__<subservice-slug>-contract.html
 *
 * Lookup strategy for issuingCompany:
 *   NEEDS_CONTEXT: issuingCompanies has no slug field. This mutation matches
 *   empresa by normalized (lowercase + trim) name within the given org.
 *   If empresa names are ambiguous, add a unique slug field to issuingCompanies.
 *
 * The resulting template is org-scoped (orgId = args.orgId) because contract
 * templates must reference an org-specific issuingCompany.
 *
 * Returns action='created' | 'updated' + templateId + derived contentStatus.
 */
export const upsertContractFromFile = internalMutation({
  args: {
    orgId: v.string(),
    empresaSlug: v.string(), // normalized name slug for empresa lookup
    subserviceSlug: v.string(),
    name: v.string(),
    htmlTemplate: v.string(),
  },
  handler: async (ctx, args) => {
    // Lookup issuingCompany by normalized name within the org.
    // NEEDS_CONTEXT: no slug field on issuingCompanies — using toLowerCase().trim()
    // name match. Add a unique slug to the schema if this proves ambiguous.
    const companies = await ctx.db
      .query("issuingCompanies")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .collect();

    const normalizedSlug = args.empresaSlug.toLowerCase().trim();
    const issuingCompany = companies.find(
      (c) => c.name.toLowerCase().trim() === normalizedSlug
    );

    if (!issuingCompany) {
      throw new Error(
        `Empresa emisora con slug '${args.empresaSlug}' no encontrada en org ${args.orgId}. ` +
          `Empresas disponibles: ${companies.map((c) => c.name).join(", ") || "(ninguna)"}.`
      );
    }

    // Look up an org-scoped subservice by slug within this org.
    const orgSubsvc = await ctx.db
      .query("subservices")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .collect()
      .then((rows) => rows.find((r) => r.slug === args.subserviceSlug));

    if (!orgSubsvc) {
      throw new Error(
        `Subservice "${args.subserviceSlug}" no encontrado en org ${args.orgId}.`
      );
    }

    // Look up an org-scoped service from the subservice's parentServiceId.
    const parentSvc = await ctx.db.get(orgSubsvc.parentServiceId);
    if (!parentSvc) {
      throw new Error(
        `Servicio padre no encontrado para subservice "${args.subserviceSlug}".`
      );
    }

    // Look up existing org-scoped contract template for this combination.
    const candidates = await ctx.db
      .query("deliverableTemplates")
      .withIndex("by_orgId_type_issuingCompanyId_subserviceId", (q) =>
        q
          .eq("orgId", args.orgId)
          .eq("type", "contract")
          .eq("issuingCompanyId", issuingCompany._id)
          .eq("subserviceId", orgSubsvc._id)
      )
      .collect();
    const existing = candidates[0] ?? null;

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
      orgId: args.orgId,
      serviceId: parentSvc._id,
      serviceName: parentSvc.name,
      subserviceId: orgSubsvc._id,
      issuingCompanyId: issuingCompany._id,
      type: "contract",
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
