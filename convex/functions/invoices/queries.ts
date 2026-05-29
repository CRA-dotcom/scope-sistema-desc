import { query } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgIdSafe, requireAuth } from "../../lib/authHelpers";

/**
 * A3 — Public queries for `invoices`.
 *
 * Per docs/superpowers/specs/2026-05-23-document-lifecycle-design.md §3.1.3
 */

export const listByClient = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];
    return await ctx.db
      .query("invoices")
      .withIndex("by_orgId_clientId", (q) =>
        q.eq("orgId", orgId).eq("clientId", args.clientId)
      )
      .order("desc")
      .collect();
  },
});

export const listForBilling = query({
  args: {
    year: v.number(),
    month: v.optional(v.number()),
    status: v.optional(
      v.union(
        v.literal("uploaded"),
        v.literal("paid"),
        v.literal("void")
      )
    ),
    // SS5: fiscal period filter — uses issueDate, falling back to uploadedAt
    issueDateFrom: v.optional(v.number()),
    issueDateTo: v.optional(v.number()),
    // #25-bis: optional filters
    clientId: v.optional(v.id("clients")),
    issuingCompanyId: v.optional(v.id("issuingCompanies")),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];
    let rows = args.status
      ? await ctx.db
          .query("invoices")
          .withIndex("by_orgId_status", (qb) =>
            qb.eq("orgId", orgId).eq("status", args.status!)
          )
          .collect()
      : await ctx.db
          .query("invoices")
          .withIndex("by_orgId", (qb) => qb.eq("orgId", orgId))
          .collect();
    rows = rows.filter((r) => r.year === args.year);
    if (args.month !== undefined) {
      rows = rows.filter((r) => r.month === args.month);
    }
    if (args.issueDateFrom !== undefined) {
      rows = rows.filter((r) => (r.issueDate ?? r.uploadedAt) >= args.issueDateFrom!);
    }
    if (args.issueDateTo !== undefined) {
      rows = rows.filter((r) => (r.issueDate ?? r.uploadedAt) <= args.issueDateTo!);
    }
    // #25-bis: clientId filter
    if (args.clientId !== undefined) {
      rows = rows.filter((r) => r.clientId === args.clientId);
    }
    // #25-bis: issuingCompanyId filter — join via servicesIssuingCompanyMap
    if (args.issuingCompanyId !== undefined) {
      // Collect all serviceIds that map to this issuing company (org-scoped).
      const maps = await ctx.db
        .query("servicesIssuingCompanyMap")
        .withIndex("by_issuingCompanyId", (q) =>
          q.eq("issuingCompanyId", args.issuingCompanyId!)
        )
        .collect();
      const orgMaps = maps.filter((m) => m.orgId === orgId);
      const mappedServiceIds = new Set(orgMaps.map((m) => m.serviceId as unknown as string));

      // Bulk-fetch the projServices referenced by filtered rows.
      const projServiceIds = [...new Set(
        rows.filter((r) => r.projServiceId).map((r) => r.projServiceId!)
      )];
      const projServices = await Promise.all(
        projServiceIds.map((id) => ctx.db.get(id))
      );
      const psServiceMap = new Map<string, string>();
      for (const ps of projServices) {
        if (ps) psServiceMap.set(ps._id as unknown as string, ps.serviceId as unknown as string);
      }

      rows = rows.filter((r) => {
        if (!r.projServiceId) return false;
        const serviceId = psServiceMap.get(r.projServiceId as unknown as string);
        return serviceId !== undefined && mappedServiceIds.has(serviceId);
      });
    }
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const getById = query({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;
    const inv = await ctx.db.get(args.invoiceId);
    if (!inv || inv.orgId !== orgId) return null;
    return inv;
  },
});
