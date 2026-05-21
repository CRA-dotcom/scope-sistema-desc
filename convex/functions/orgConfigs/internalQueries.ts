import { internalQuery } from "../../_generated/server";
import { v } from "convex/values";

/**
 * D2 §3.4 — internal-only query used by `sendTestNotification` action to
 * resolve the org's `notificationEmail` (and any future prefs) without
 * relying on caller identity (the action already validated `requireAdmin`
 * before running).
 */
export const getNotificationEmail = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, args) => {
    const cfg = await ctx.db
      .query("orgConfigs")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .unique();
    if (!cfg) return null;
    return {
      notificationEmail: cfg.notificationEmail ?? null,
      notificationPreferences: cfg.notificationPreferences ?? null,
    };
  },
});
