import { internalQuery } from "../../_generated/server";
import { v } from "convex/values";

export const getAssignmentData = internalQuery({
  args: { assignmentId: v.id("monthlyAssignments") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.assignmentId);
  },
});

export const getClientData = internalQuery({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.clientId);
  },
});

export const getProjServiceData = internalQuery({
  args: { projServiceId: v.id("projectionServices") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.projServiceId);
  },
});

export const getProjectionByProjService = internalQuery({
  args: { projectionId: v.id("projections") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.projectionId);
  },
});

export const getQuestionnaireForClient = internalQuery({
  args: { clientId: v.id("clients"), projectionId: v.id("projections") },
  handler: async (ctx, args) => {
    const responses = await ctx.db
      .query("questionnaireResponses")
      .withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
      .collect();

    return (
      responses.find(
        (r) => r.projectionId === args.projectionId && r.status === "completed"
      ) ?? responses.find((r) => r.projectionId === args.projectionId) ?? null
    );
  },
});

export const findTemplate = internalQuery({
  args: {
    serviceName: v.string(),
    type: v.union(v.literal("deliverable_short"), v.literal("deliverable_long")),
    orgId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const allTemplates = await ctx.db
      .query("deliverableTemplates")
      .withIndex("by_type", (q) => q.eq("type", args.type))
      .collect();

    // Prefer org-specific, then global, matching service name
    const orgMatch = allTemplates.find(
      (t) => t.isActive && t.orgId === args.orgId && t.serviceName === args.serviceName
    );
    if (orgMatch) return orgMatch;

    const globalMatch = allTemplates.find(
      (t) => t.isActive && !t.orgId && t.serviceName === args.serviceName
    );
    if (globalMatch) return globalMatch;

    // Fallback: any active template of this type
    return allTemplates.find((t) => t.isActive) ?? null;
  },
});

export const getDeliverableData = internalQuery({
  args: { deliverableId: v.id("deliverables") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.deliverableId);
  },
});

export const getOrgBranding = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const branding = await ctx.db
      .query("orgBranding")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .first();
    return branding;
  },
});

export const getTemplateById = internalQuery({
  args: { templateId: v.id("deliverableTemplates") },
  handler: async (ctx, { templateId }) => {
    return await ctx.db.get(templateId);
  },
});

export const getQuestionnaireById = internalQuery({
  args: { questionnaireId: v.id("questionnaireResponses") },
  handler: async (ctx, { questionnaireId }) => {
    return await ctx.db.get(questionnaireId);
  },
});

export const findProjServiceByServiceAndProjection = internalQuery({
  args: {
    projectionId: v.id("projections"),
    serviceId: v.id("services"),
  },
  handler: async (ctx, { projectionId, serviceId }) => {
    return await ctx.db
      .query("projectionServices")
      .withIndex("by_projectionId", (q) => q.eq("projectionId", projectionId))
      .filter((q) => q.eq(q.field("serviceId"), serviceId))
      .first();
  },
});
