import { query } from "../../_generated/server";
import { getOrgIdSafe } from "../../lib/authHelpers";

/**
 * C5: listForUser — returns unread notifications for the current user.
 *
 * Surfaces notifications that are either:
 *   - Assigned to the current user (assignedTo === userId), or
 *   - Org-wide (assignedTo is undefined/null)
 *
 * Results are sorted newest-first.
 */
export const listForUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const userId = identity.subject;
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    const list = await ctx.db
      .query("notifications")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    return list
      .filter((n) => !n.readAt)
      .filter((n) => !n.assignedTo || n.assignedTo === userId)
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});

/**
 * listAll — returns ALL notifications (read + unread) for the current
 * user's org, sorted newest-first. Useful for a notification history panel.
 */
export const listAll = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const userId = identity.subject;
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    const list = await ctx.db
      .query("notifications")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    return list
      .filter((n) => !n.assignedTo || n.assignedTo === userId)
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});
