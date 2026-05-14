import { internalQuery } from "../../_generated/server";
import { v } from "convex/values";

/**
 * Dev tool — dumps all the context needed to render demo deliverables for one client.
 * Returns: client, latest projection, projectionServices, questionnaire responses,
 * orgBranding, and orgConfig in one call.
 *
 * Usage:
 *   npx convex run functions/devtools/dumpDemoContext:dumpForClient \
 *     '{"clientId":"<id>"}'
 */
export const dumpForClient = internalQuery({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }) => {
    const client = await ctx.db.get(clientId);
    if (!client) return { error: "client not found" };
    const orgId = client.orgId;

    const projections = await ctx.db
      .query("projections")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const projection =
      projections
        .filter((p) => p.clientId === clientId)
        .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;

    let projServices: any[] = [];
    if (projection) {
      projServices = await ctx.db
        .query("projectionServices")
        .withIndex("by_projectionId", (q) => q.eq("projectionId", projection._id))
        .collect();
    }

    const questionnaire = await ctx.db
      .query("questionnaireResponses")
      .withIndex("by_clientId", (q) => q.eq("clientId", clientId))
      .order("desc")
      .first();

    const orgBranding = await ctx.db
      .query("orgBranding")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .first();

    const orgConfig = await ctx.db
      .query("orgConfigs")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .first();

    const services = await ctx.db
      .query("services")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    return {
      orgId,
      client,
      projection,
      projServices,
      questionnaire,
      orgBranding,
      orgConfig,
      services,
    };
  },
});
