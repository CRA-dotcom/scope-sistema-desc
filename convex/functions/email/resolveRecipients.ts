import { internalQuery, QueryCtx, MutationCtx } from "../../_generated/server";
import { v } from "convex/values";

/**
 * Resolves the notification email for an org from app data, with a
 * last-resort env fallback. Returns null when nothing is configured —
 * callers MUST skip + warn (never send to a placeholder domain).
 * Empty/whitespace-only values are treated as not configured.
 */
export async function getOrgNotificationEmail(
  ctx: QueryCtx | MutationCtx,
  orgId: string
): Promise<string | null> {
  const config = await ctx.db
    .query("orgConfigs")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .unique();
  const fromConfig = config?.notificationEmail?.trim();
  if (fromConfig) return fromConfig;
  const fromEnv = process.env.OPS_NOTIFICATION_EMAIL?.trim();
  return fromEnv ? fromEnv : null;
}

export const resolveOrgNotificationEmail = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, args) => getOrgNotificationEmail(ctx, args.orgId),
});
