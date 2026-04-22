import { internalQuery } from "../../_generated/server";
import { v } from "convex/values";

export const getQuotationData = internalQuery({
  args: { quotationId: v.id("quotations") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.quotationId);
  },
});

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

export const findContractTemplate = internalQuery({
  args: {
    serviceId: v.optional(v.id("services")),
    orgId: v.string(),
  },
  handler: async (ctx, args) => {
    const templates = await ctx.db
      .query("deliverableTemplates")
      .withIndex("by_type", (q) => q.eq("type", "contract"))
      .collect();

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

export const getExistingContract = internalQuery({
  args: { quotationId: v.id("quotations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("contracts")
      .withIndex("by_quotationId", (q) => q.eq("quotationId", args.quotationId))
      .first();
  },
});
