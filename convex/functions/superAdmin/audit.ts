import { query } from "../../_generated/server";
import { v } from "convex/values";
import { requireSuperAdmin } from "../../lib/authHelpers";

/**
 * D1 — Super-admin audit helpers.
 *
 * Per docs/superpowers/specs/2026-05-27-super-admin-panels-design.md §3.3
 *
 * The audit table itself is driven by `documentEvents.queries.list` (A3); D1
 * only adds the lightweight dropdown helpers that the audit UI needs to filter
 * cross-org. Both queries return `[]` on non-super-admin callers so SSR doesn't
 * error while Clerk is loading.
 */

export const listOrgsForAuditFilter = query({
  args: {},
  handler: async (ctx) => {
    try {
      await requireSuperAdmin(ctx);
    } catch {
      return [];
    }
    const orgs = await ctx.db.query("organizations").collect();
    return orgs
      .map((o) => ({ clerkOrgId: o.clerkOrgId, name: o.name }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  },
});

/**
 * Cross-org client listing for the audit "Cliente" dropdown. Closes the gap
 * flagged in the A3 review: `clients.queries.list` is scoped to the caller's
 * own org, so the audit page couldn't show clients of an arbitrary org.
 */
export const listClientsForOrg = query({
  args: { orgId: v.string() },
  handler: async (ctx, args) => {
    try {
      await requireSuperAdmin(ctx);
    } catch {
      return [];
    }
    const clients = await ctx.db
      .query("clients")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .collect();
    return clients
      .map((c) => ({ id: c._id, name: c.name, rfc: c.rfc }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  },
});
