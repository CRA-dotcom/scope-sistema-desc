import { query } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgIdSafe } from "../../lib/authHelpers";

export const list = query({
  args: {
    status: v.optional(v.string()),
    type: v.optional(v.string()),
    clientId: v.optional(v.id("clients")),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    const identity = await ctx.auth.getUserIdentity();
    const role = (identity?.orgRole as string) ?? "org:member";
    const userId = identity?.subject ?? "";

    let rows = await ctx.db
      .query("emailLog")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    if (role === "org:member") {
      const assignedClients = await ctx.db
        .query("clients")
        .withIndex("by_orgId_assignedTo", (q) =>
          q.eq("orgId", orgId).eq("assignedTo", userId)
        )
        .collect();
      const assignedIds = new Set(assignedClients.map((c) => c._id));
      rows = rows.filter((r) => r.clientId && assignedIds.has(r.clientId));
    }

    if (args.status) {
      rows = rows.filter((r) => r.status === args.status);
    }
    if (args.type) {
      rows = rows.filter((r) => r.type === args.type);
    }
    if (args.clientId) {
      rows = rows.filter((r) => r.clientId === args.clientId);
    }
    if (args.search) {
      const term = args.search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.toEmail.toLowerCase().includes(term) ||
          r.subject.toLowerCase().includes(term)
      );
    }

    rows.sort((a, b) => b.createdAt - a.createdAt);

    const limit = args.limit ?? 50;
    return rows.slice(0, limit);
  },
});

export const getById = query({
  args: { id: v.id("emailLog") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;
    const log = await ctx.db.get(args.id);
    if (!log || log.orgId !== orgId) return null;

    const identity = await ctx.auth.getUserIdentity();
    const role = (identity?.orgRole as string) ?? "org:member";
    if (role === "org:member") {
      if (!log.clientId) return null;
      const client = await ctx.db.get(log.clientId);
      if (!client || client.assignedTo !== identity?.subject) return null;
    }
    return log;
  },
});
