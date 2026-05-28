import { internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { resolveIssuingCompany } from "../issuingCompanies/resolve";

export const getProjServiceData = internalQuery({
  args: { projServiceId: v.id("projectionServices") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.projServiceId);
  },
});

export const getProjectionData = internalQuery({
  args: { projectionId: v.id("projections") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.projectionId);
  },
});

export const getClientData = internalQuery({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.clientId);
  },
});

export const getServiceData = internalQuery({
  args: { serviceId: v.id("services") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.serviceId);
  },
});

export const getOrgBranding = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("orgBranding")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .unique();
  },
});

export const getQuestionnaireForProjection = internalQuery({
  args: { projectionId: v.id("projections") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("questionnaireResponses")
      .withIndex("by_projectionId", (q) =>
        q.eq("projectionId", args.projectionId)
      )
      .first();
  },
});

export const findQuotationTemplate = internalQuery({
  args: {
    serviceId: v.optional(v.id("services")),
    orgId: v.string(),
  },
  handler: async (ctx, args) => {
    const templates = await ctx.db
      .query("deliverableTemplates")
      .withIndex("by_type", (q) => q.eq("type", "quotation"))
      .collect();

    // Service-specific for this org, then global service-specific, then generic.
    return (
      templates.find(
        (t) =>
          t.isActive &&
          t.serviceId === args.serviceId &&
          t.orgId === args.orgId
      ) ??
      templates.find(
        (t) => t.isActive && t.serviceId === args.serviceId && !t.orgId
      ) ??
      templates.find(
        (t) => t.isActive && !t.serviceId && t.orgId === args.orgId
      ) ??
      templates.find((t) => t.isActive && !t.serviceId && !t.orgId) ??
      null
    );
  },
});

export const getExistingQuotation = internalQuery({
  args: { projServiceId: v.id("projectionServices") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("quotations")
      .withIndex("by_projServiceId", (q) =>
        q.eq("projServiceId", args.projServiceId)
      )
      .first();
  },
});

export const getSendContext = internalQuery({
  args: { quotationId: v.id("quotations") },
  handler: async (ctx, args) => {
    const quotation = await ctx.db.get(args.quotationId);
    if (!quotation) return null;
    const projService = await ctx.db.get(quotation.projServiceId);
    if (!projService) return null;
    const projection = await ctx.db.get(projService.projectionId);
    if (!projection) return null;
    const client = await ctx.db.get(projection.clientId);
    if (!client) return null;
    const service = await ctx.db.get(projService.serviceId);

    let issuingCompany = null;
    let issuingCompanySource: string = "auto_resolved";
    let issuingCompanyError: string | null = null;

    // C2: honour the per-quotation override before falling through to auto-resolve
    if (quotation.issuingCompanyId) {
      const overrideCompany = await ctx.db.get(quotation.issuingCompanyId);
      if (
        overrideCompany &&
        overrideCompany.orgId === quotation.orgId &&
        overrideCompany.isActive
      ) {
        issuingCompany = overrideCompany;
        issuingCompanySource = "form_override";
      }
    }

    if (!issuingCompany) {
      try {
        const resolved = await resolveIssuingCompany(ctx, {
          orgId: quotation.orgId,
          clientId: client._id,
          serviceId: projService.serviceId,
        });
        issuingCompany = resolved.issuingCompany;
        issuingCompanySource = resolved.source ?? "auto_resolved";
      } catch (err) {
        issuingCompanyError = err instanceof Error ? err.message : String(err);
      }
    }

    const orgBranding = await ctx.db
      .query("orgBranding")
      .withIndex("by_orgId", (q) => q.eq("orgId", quotation.orgId))
      .unique();

    return {
      quotation,
      projService,
      projection,
      client,
      service,
      issuingCompany,
      issuingCompanySource,
      issuingCompanyError,
      orgBranding,
    };
  },
});

export const getByTokenHash = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("quotations")
      .withIndex("by_accessTokenHash", (q) =>
        q.eq("accessTokenHash", args.tokenHash)
      )
      .unique();
  },
});
