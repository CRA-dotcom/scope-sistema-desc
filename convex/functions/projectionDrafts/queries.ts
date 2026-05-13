import { query } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgIdSafe } from "../../lib/authHelpers";

export const getMyDraft = query({
  args: { clientId: v.optional(v.id("clients")) },
  handler: async (ctx, { clientId }) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await ctx.db
      .query("projectionDrafts")
      .withIndex("by_orgId_userId_clientId", (q) =>
        q.eq("orgId", orgId).eq("userId", identity.subject).eq("clientId", clientId)
      )
      .unique();
  },
});

export const listMyDrafts = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("projectionDrafts")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .filter((q) => q.eq(q.field("userId"), identity.subject))
      .collect();
  },
});
