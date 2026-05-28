import { query } from "../../_generated/server";
import { v } from "convex/values";
import {
  getOrgIdSafe,
  isSuperAdminFromIdentity,
  requireAuth,
} from "../../lib/authHelpers";
import { documentEventEntityTypeValidator } from "../../lib/documentEventTypes";

/**
 * A3 — Audit queries for `documentEvents`.
 *
 * Per docs/superpowers/specs/2026-05-23-document-lifecycle-design.md §3.6
 *
 * Multi-tenant filter (Q6): non-super-admin callers are silently scoped to
 * their own orgId regardless of what `args.orgId` says.
 */

const entityTypeUnion = documentEventEntityTypeValidator;

const severityUnion = v.union(
  v.literal("info"),
  v.literal("warning"),
  v.literal("error")
);

export const list = query({
  args: {
    orgId: v.optional(v.string()),
    clientId: v.optional(v.id("clients")),
    entityType: v.optional(entityTypeUnion),
    severity: v.optional(severityUnion),
    sinceMs: v.optional(v.number()),
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const identity = await ctx.auth.getUserIdentity();
    const isSuperAdmin = isSuperAdminFromIdentity(identity);

    let targetOrgId = args.orgId;
    if (!isSuperAdmin) {
      const ownOrgId = await getOrgIdSafe(ctx);
      if (!ownOrgId) return { rows: [], cursor: null, isDone: true };
      // Override even if caller passed a different orgId — multi-tenant guard.
      targetOrgId = ownOrgId;
    }
    if (!targetOrgId) return { rows: [], cursor: null, isDone: true };

    const pageSize = Math.min(args.pageSize ?? 50, 100);

    // Pick the best index for the query.
    let result;
    if (args.severity) {
      result = await ctx.db
        .query("documentEvents")
        .withIndex("by_orgId_severity_createdAt", (qb) =>
          qb.eq("orgId", targetOrgId!).eq("severity", args.severity!)
        )
        .order("desc")
        .paginate({
          cursor: args.cursor ?? null,
          numItems: pageSize,
        });
    } else if (args.clientId) {
      result = await ctx.db
        .query("documentEvents")
        .withIndex("by_orgId_clientId_createdAt", (qb) =>
          qb.eq("orgId", targetOrgId!).eq("clientId", args.clientId!)
        )
        .order("desc")
        .paginate({
          cursor: args.cursor ?? null,
          numItems: pageSize,
        });
    } else {
      result = await ctx.db
        .query("documentEvents")
        .withIndex("by_orgId_createdAt", (qb) =>
          qb.eq("orgId", targetOrgId!)
        )
        .order("desc")
        .paginate({
          cursor: args.cursor ?? null,
          numItems: pageSize,
        });
    }

    // Post-filter (acceptable cost: pageSize ≤ 100).
    let filtered = result.page;
    if (args.entityType) {
      filtered = filtered.filter((r) => r.entityType === args.entityType);
    }
    if (args.sinceMs !== undefined) {
      filtered = filtered.filter((r) => r.createdAt >= args.sinceMs!);
    }

    return {
      rows: filtered,
      cursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const listForClient = query({
  args: {
    clientId: v.id("clients"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];
    return await ctx.db
      .query("documentEvents")
      .withIndex("by_orgId_clientId_createdAt", (q) =>
        q.eq("orgId", orgId).eq("clientId", args.clientId)
      )
      .order("desc")
      .take(args.limit ?? 30);
  },
});
