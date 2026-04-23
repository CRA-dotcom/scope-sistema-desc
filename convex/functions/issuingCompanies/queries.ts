import { query } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgIdSafe } from "../../lib/authHelpers";

export const list = query({
  args: {
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    let companies = await ctx.db
      .query("issuingCompanies")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    if (!args.includeInactive) {
      companies = companies.filter((c) => c.isActive);
    }

    // Compute serviceCount and clientOverrideCount per company
    const withCounts = await Promise.all(
      companies.map(async (c) => {
        const services = await ctx.db
          .query("servicesIssuingCompanyMap")
          .withIndex("by_issuingCompanyId", (q) => q.eq("issuingCompanyId", c._id))
          .collect();
        const overrides = await ctx.db
          .query("clientIssuingCompanyOverride")
          .withIndex("by_issuingCompanyId", (q) => q.eq("issuingCompanyId", c._id))
          .collect();
        return {
          ...c,
          serviceCount: services.length,
          clientOverrideCount: overrides.length,
        };
      })
    );

    return withCounts.sort((a, b) => {
      // Default first, then alphabetical by name
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return a.name.localeCompare(b.name);
    });
  },
});

export const getById = query({
  args: { id: v.id("issuingCompanies") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;
    const doc = await ctx.db.get(args.id);
    if (!doc || doc.orgId !== orgId) return null;
    return doc;
  },
});

export const listServiceMap = query({
  args: { issuingCompanyId: v.id("issuingCompanies") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];
    const company = await ctx.db.get(args.issuingCompanyId);
    if (!company || company.orgId !== orgId) return [];

    const maps = await ctx.db
      .query("servicesIssuingCompanyMap")
      .withIndex("by_issuingCompanyId", (q) => q.eq("issuingCompanyId", args.issuingCompanyId))
      .collect();

    return Promise.all(
      maps.map(async (m) => {
        const service = await ctx.db.get(m.serviceId);
        return {
          mapId: m._id,
          serviceId: m.serviceId,
          serviceName: service?.name ?? "(desconocido)",
        };
      })
    );
  },
});

export const listAvailableServices = query({
  args: { issuingCompanyId: v.optional(v.id("issuingCompanies")) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const role = (identity.orgRole as string) ?? "org:member";
    if (role !== "org:admin") {
      throw new Error("Acceso denegado. Se requiere rol de Administrador.");
    }
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    // All org services (org-scoped + global seeds)
    const orgServices = await ctx.db
      .query("services")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const globalServices = await ctx.db
      .query("services")
      .withIndex("by_orgId", (q) => q.eq("orgId", undefined))
      .collect();
    const services = [...orgServices, ...globalServices];

    // All mappings in this org
    const maps = await ctx.db
      .query("servicesIssuingCompanyMap")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const mapByService = new Map(maps.map((m) => [m.serviceId, m.issuingCompanyId]));

    // Enrich each service with its current assignment
    const result = await Promise.all(
      services.map(async (s) => {
        const assignedCompanyId = mapByService.get(s._id);
        let assignedTo: { issuingCompanyId: string; name: string } | undefined;
        if (assignedCompanyId) {
          const company = await ctx.db.get(assignedCompanyId);
          if (company) {
            assignedTo = { issuingCompanyId: company._id, name: company.name };
          }
        }
        return {
          serviceId: s._id,
          serviceName: s.name,
          assignedTo,
        };
      })
    );

    return result.sort((a, b) => a.serviceName.localeCompare(b.serviceName));
  },
});

export const getDefault = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;
    const results = await ctx.db
      .query("issuingCompanies")
      .withIndex("by_orgId_isDefault", (q) => q.eq("orgId", orgId).eq("isDefault", true))
      .collect();
    return results.find((c) => c.isActive) ?? null;
  },
});

export const countReferences = query({
  args: { id: v.id("issuingCompanies") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("No autenticado");
    const role = (identity.orgRole as string) ?? "org:member";
    if (role !== "org:admin") {
      throw new Error("Acceso denegado. Se requiere rol de Administrador.");
    }

    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) throw new Error("Sin organización");
    const company = await ctx.db.get(args.id);
    if (!company || company.orgId !== orgId) throw new Error("Empresa no encontrada");

    const [emailLogs, serviceMaps, clientOverrides] = await Promise.all([
      ctx.db
        .query("emailLog")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect()
        .then((rows) => rows.filter((r) => r.issuingCompanyId === args.id).length),
      ctx.db
        .query("servicesIssuingCompanyMap")
        .withIndex("by_issuingCompanyId", (q) => q.eq("issuingCompanyId", args.id))
        .collect()
        .then((r) => r.length),
      ctx.db
        .query("clientIssuingCompanyOverride")
        .withIndex("by_issuingCompanyId", (q) => q.eq("issuingCompanyId", args.id))
        .collect()
        .then((r) => r.length),
    ]);

    // TODO: when sections 3/4 add issuingCompanyId to quotations/contracts/deliverables/deliverableTemplates,
    // add counts here.
    const total = emailLogs + serviceMaps + clientOverrides;

    return {
      emailLog: emailLogs,
      serviceMap: serviceMaps,
      clientOverride: clientOverrides,
      total,
    };
  },
});
