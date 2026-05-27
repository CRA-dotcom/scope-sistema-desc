import { query } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgIdSafe, requireAdmin } from "../../lib/authHelpers";

export const getById = query({
  args: { id: v.id("contracts") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;
    const contract = await ctx.db.get(args.id);
    if (!contract || contract.orgId !== orgId) return null;
    return contract;
  },
});

export const getByQuotation = query({
  args: { quotationId: v.id("quotations") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;

    const contract = await ctx.db
      .query("contracts")
      .withIndex("by_quotationId", (q) =>
        q.eq("quotationId", args.quotationId)
      )
      .first();

    if (!contract || contract.orgId !== orgId) return null;
    return contract;
  },
});

export const listByClient = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    const contracts = await ctx.db
      .query("contracts")
      .withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
      .collect();

    return contracts
      .filter((c) => c.orgId === orgId)
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const listByOrg = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("sent"),
        v.literal("signed"),
        v.literal("cancelled")
      )
    ),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    let contracts;
    if (args.status) {
      contracts = await ctx.db
        .query("contracts")
        .withIndex("by_orgId_status", (q) =>
          q.eq("orgId", orgId).eq("status", args.status!)
        )
        .collect();
    } else {
      contracts = await ctx.db
        .query("contracts")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect();
    }

    return contracts.sort((a, b) => b.createdAt - a.createdAt);
  },
});

// TODO(post-MVP): support filter by issuingCompanyId — requires snapshot field
// on contracts table or join through servicesIssuingCompanyMap. Deferred.
export const getContractsForPipeline = query({
  args: {
    statusFilter: v.optional(
      v.union(
        v.literal("all"),
        v.literal("draft"),
        v.literal("sent"),
        v.literal("signed"),
        v.literal("cancelled")
      )
    ),
    minDaysWithoutSigning: v.optional(v.number()),
    clientId: v.optional(v.id("clients")),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    let rows = await ctx.db
      .query("contracts")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    if (args.statusFilter && args.statusFilter !== "all") {
      rows = rows.filter((r) => r.status === args.statusFilter);
    }
    if (args.clientId) {
      rows = rows.filter((r) => r.clientId === args.clientId);
    }
    const now = Date.now();
    if (args.minDaysWithoutSigning !== undefined) {
      const cutoff = args.minDaysWithoutSigning * 24 * 3600 * 1000;
      rows = rows.filter(
        (r) => r.status === "sent" && r.sentAt !== undefined && now - r.sentAt >= cutoff
      );
    }

    rows.sort((a, b) => {
      if (a.status === "sent" && b.status === "sent") {
        // Oldest sentAt first (largest days-unsigned first)
        return (a.sentAt ?? 0) - (b.sentAt ?? 0);
      }
      return b.createdAt - a.createdAt;
    });

    // Enrich each row with clientName (single db.get per row — acceptable for pipeline view)
    return Promise.all(
      rows.map(async (r) => {
        const client = await ctx.db.get(r.clientId);
        return { ...r, clientName: client?.name ?? r.clientId };
      })
    );
  },
});
