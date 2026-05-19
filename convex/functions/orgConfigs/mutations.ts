import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { requireSuperAdmin } from "../../lib/authHelpers";

export const upsert = mutation({
  args: {
    orgId: v.string(),
    calculationMode: v.union(v.literal("weighted"), v.literal("fixed")),
    commissionMode: v.union(
      v.literal("proportional"),
      v.literal("fixed_monthly")
    ),
    seasonalityEnabled: v.boolean(),
    featureFlags: v.object({
      advancedConfigVisible: v.boolean(),
      customServicesVisible: v.boolean(),
      seasonalityEditable: v.boolean(),
      manualOverrideAllowed: v.boolean(),
    }),
    currency: v.optional(v.string()),
    fiscalYearStartMonth: v.optional(v.number()),
    notificationEmail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);

    const existing = await ctx.db
      .query("orgConfigs")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .unique();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        calculationMode: args.calculationMode,
        commissionMode: args.commissionMode,
        seasonalityEnabled: args.seasonalityEnabled,
        featureFlags: args.featureFlags,
        currency: args.currency,
        fiscalYearStartMonth: args.fiscalYearStartMonth,
        notificationEmail: args.notificationEmail,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("orgConfigs", {
      orgId: args.orgId,
      calculationMode: args.calculationMode,
      commissionMode: args.commissionMode,
      seasonalityEnabled: args.seasonalityEnabled,
      featureFlags: args.featureFlags,
      currency: args.currency,
      fiscalYearStartMonth: args.fiscalYearStartMonth,
      notificationEmail: args.notificationEmail,
      updatedAt: now,
    });
  },
});
