import { internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { Doc } from "../../_generated/dataModel";

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

/**
 * A2 envoltorio sin guard: el action que llama esta query ya está
 * autenticado, así que no aplicamos `requireAuth`. Replica la lógica
 * dual-matching de `deliverableTemplates.queries.getResolved` pero recibe
 * el `orgId` explícito (no del JWT, porque las generaciones automatizadas
 * pueden correr en background donde el JWT del operador no aplica).
 *
 * Per docs/superpowers/specs/2026-05-22-templates-operator-access-design.md §5.
 */
export const getResolvedForGeneration = internalQuery({
  args: {
    orgId: v.string(),
    type: v.union(
      v.literal("deliverable_short"),
      v.literal("deliverable_long"),
      v.literal("quotation"),
      v.literal("contract"),
    ),
    subserviceId: v.optional(v.id("subservices")),
    serviceId: v.optional(v.id("services")),
    serviceName: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Doc<"deliverableTemplates"> | null> => {
    const candidates = await ctx.db
      .query("deliverableTemplates")
      .withIndex("by_type", (q) => q.eq("type", args.type))
      .collect();
    const active = candidates.filter((t) => t.isActive);

    if (args.subserviceId) {
      const orgSub = active.find(
        (t) => t.subserviceId === args.subserviceId && t.orgId === args.orgId,
      );
      if (orgSub) return orgSub;

      const globalSub = active.find(
        (t) =>
          t.subserviceId === args.subserviceId && t.orgId === undefined,
      );
      if (globalSub) return globalSub;
    }

    if (args.serviceId) {
      const orgSvc = active.find(
        (t) =>
          t.serviceId === args.serviceId &&
          t.orgId === args.orgId &&
          !t.subserviceId,
      );
      if (orgSvc) return orgSvc;

      const globalSvc = active.find(
        (t) =>
          t.serviceId === args.serviceId &&
          t.orgId === undefined &&
          !t.subserviceId,
      );
      if (globalSvc) return globalSvc;
    }

    if (args.serviceName) {
      const orgName = active.find(
        (t) =>
          t.serviceName === args.serviceName &&
          t.orgId === args.orgId &&
          !t.subserviceId,
      );
      if (orgName) return orgName;

      const globalName = active.find(
        (t) =>
          t.serviceName === args.serviceName &&
          t.orgId === undefined &&
          !t.subserviceId,
      );
      if (globalName) return globalName;
    }

    return null;
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
