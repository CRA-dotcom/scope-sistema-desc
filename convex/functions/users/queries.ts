import { query } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgIdSafe } from "../../lib/authHelpers";

/**
 * D2 §3.1 — `listAssignmentsForOrg`
 *
 * Returns, for the caller's org, how many active (non-archived) clients each
 * Clerk userId currently has assigned. Used by `/configuracion/usuarios` to
 * join with Clerk memberships rendered client-side via `useOrganization()`.
 */
export const listAssignmentsForOrg = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    const clients = await ctx.db
      .query("clients")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();

    const counts = new Map<string, number>();
    for (const c of clients) {
      if (!c.assignedTo) continue;
      counts.set(c.assignedTo, (counts.get(c.assignedTo) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([userId, count]) => ({
      userId,
      assignedClientCount: count,
    }));
  },
});

/**
 * D2 §3.1 — `listAssignedClients`
 *
 * For the user-detail drawer: list the active clients assigned to a given
 * Clerk userId within the caller's org.
 */
export const listAssignedClients = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    return await ctx.db
      .query("clients")
      .withIndex("by_orgId_assignedTo", (q) =>
        q.eq("orgId", orgId).eq("assignedTo", args.userId)
      )
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();
  },
});
