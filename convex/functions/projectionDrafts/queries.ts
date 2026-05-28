import { query } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgIdSafe, requireAuth, getOrgId } from "../../lib/authHelpers";

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

export const listMyActiveDrafts = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireAuth(ctx);
    const orgId = await getOrgId(ctx);
    const userId = identity.subject;
    const drafts = await ctx.db
      .query("projectionDrafts")
      .withIndex("by_orgId_userId_clientId", (q) =>
        q.eq("orgId", orgId).eq("userId", userId)
      )
      .collect();
    return Promise.all(
      drafts.map(async (d) => {
        const client = d.clientId ? await ctx.db.get(d.clientId) : null;
        return {
          _id: d._id,
          clientId: d.clientId,
          clientName: client?.name ?? null,
          year: d.state.year ?? null,
          step: d.state.step,
          updatedAt: d.updatedAt,
          previousProjectionId: d.state.previousProjectionId ?? null,
        };
      })
    );
  },
});
