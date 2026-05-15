import { query } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgIdSafe } from "../../lib/authHelpers";

export const getByProjection = query({
  args: { projectionId: v.id("projections") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;

    const questionnaire = await ctx.db
      .query("questionnaireResponses")
      .withIndex("by_projectionId", (q) =>
        q.eq("projectionId", args.projectionId)
      )
      .first();

    if (!questionnaire || questionnaire.orgId !== orgId) return null;
    return questionnaire;
  },
});

export const getById = query({
  args: { id: v.id("questionnaireResponses") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;

    const questionnaire = await ctx.db.get(args.id);
    if (!questionnaire || questionnaire.orgId !== orgId) return null;
    return questionnaire;
  },
});

export const getByClient = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    const questionnaires = await ctx.db
      .query("questionnaireResponses")
      .withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
      .collect();

    return questionnaires
      .filter((q) => q.orgId === orgId)
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const listByOrg = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("sent"),
        v.literal("in_progress"),
        v.literal("completed")
      )
    ),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    let questionnaires;
    if (args.status) {
      questionnaires = await ctx.db
        .query("questionnaireResponses")
        .withIndex("by_orgId_status", (q) =>
          q.eq("orgId", orgId).eq("status", args.status!)
        )
        .collect();
    } else {
      questionnaires = await ctx.db
        .query("questionnaireResponses")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect();
    }

    return questionnaires.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const listTestable = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    const responses = await ctx.db
      .query("questionnaireResponses")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    const filtered = responses.filter(
      (r) => r.status === "completed" || r.status === "in_progress"
    );

    const enriched = await Promise.all(
      filtered.map(async (r) => {
        const client = await ctx.db.get(r.clientId);
        const projection = await ctx.db.get(r.projectionId);
        return {
          _id: r._id,
          clientName: client?.name ?? "Cliente",
          projectionYear: projection?.year ?? null,
          status: r.status,
          responseCount: r.responses.length,
        };
      })
    );

    return enriched.sort((a, b) =>
      (a.clientName ?? "").localeCompare(b.clientName ?? "")
    );
  },
});
