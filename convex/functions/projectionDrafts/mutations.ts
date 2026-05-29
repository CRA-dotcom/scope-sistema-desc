import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { requireAuth, getOrgId, getOrgIdMutation } from "../../lib/authHelpers";

const stateValidator = v.object({
  step: v.number(),
  year: v.optional(v.number()),
  annualSales: v.optional(v.number()),
  totalBudget: v.optional(v.number()),
  commissionRate: v.optional(v.number()),
  startMonth: v.optional(v.number()),
  projectionMode: v.optional(
    v.union(v.literal("rolling"), v.literal("fiscal"))
  ),
  useSeasonality: v.optional(v.boolean()),
  seasonalityDeltas: v.optional(
    v.array(
      v.object({
        month: v.number(),
        deltaPercent: v.number(),
      })
    )
  ),
  seasonalityOutliers: v.optional(
    v.array(
      v.object({
        month: v.number(),
        value: v.number(),
        unit: v.union(v.literal("percent"), v.literal("amount")),
      })
    )
  ),
  serviceStates: v.optional(
    v.array(
      v.object({
        serviceId: v.string(),
        chosenPct: v.number(),
        isActive: v.boolean(),
        // B6: persist multi-subservicio selection so the wizard restores it
        // on hydration. Optional for backward-compat with existing drafts.
        subserviceIds: v.optional(v.array(v.string())),
      })
    )
  ),
  previousProjectionId: v.optional(v.id("projections")),
});

export const upsertDraft = mutation({
  args: {
    clientId: v.optional(v.id("clients")),
    state: stateValidator,
    clearPreClientDraft: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await requireAuth(ctx);
    const orgId = await getOrgIdMutation(ctx);
    const userId = identity.subject;

    // If promoting from clientId=null to a real client, optionally clear the null slot.
    if (args.clientId !== undefined && args.clearPreClientDraft === true) {
      const preClient = await ctx.db
        .query("projectionDrafts")
        .withIndex("by_orgId_userId_clientId", (q) =>
          q.eq("orgId", orgId).eq("userId", userId).eq("clientId", undefined)
        )
        .unique();
      if (preClient) {
        await ctx.db.delete(preClient._id);
      }
    }

    const existing = await ctx.db
      .query("projectionDrafts")
      .withIndex("by_orgId_userId_clientId", (q) =>
        q.eq("orgId", orgId).eq("userId", userId).eq("clientId", args.clientId)
      )
      .unique();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        state: args.state,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("projectionDrafts", {
      orgId,
      userId,
      clientId: args.clientId,
      state: args.state,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const deleteMyDraft = mutation({
  args: {
    clientId: v.optional(v.id("clients")),
  },
  handler: async (ctx, { clientId }) => {
    const identity = await requireAuth(ctx);
    const orgId = await getOrgIdMutation(ctx);
    const userId = identity.subject;

    const existing = await ctx.db
      .query("projectionDrafts")
      .withIndex("by_orgId_userId_clientId", (q) =>
        q.eq("orgId", orgId).eq("userId", userId).eq("clientId", clientId)
      )
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});
