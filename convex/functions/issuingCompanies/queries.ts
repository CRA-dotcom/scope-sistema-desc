import { query } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgIdSafe } from "../../lib/authHelpers";

export const list = query({
  args: {
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    let companies = await ctx.db
      .query("issuingCompanies")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    if (!args.includeInactive) {
      companies = companies.filter((c) => c.isActive);
    }

    // Compute serviceCount and clientOverrideCount per company
    const withCounts = await Promise.all(
      companies.map(async (c) => {
        const services = await ctx.db
          .query("servicesIssuingCompanyMap")
          .withIndex("by_issuingCompanyId", (q) => q.eq("issuingCompanyId", c._id))
          .collect();
        const overrides = await ctx.db
          .query("clientIssuingCompanyOverride")
          .withIndex("by_issuingCompanyId", (q) => q.eq("issuingCompanyId", c._id))
          .collect();
        return {
          ...c,
          serviceCount: services.length,
          clientOverrideCount: overrides.length,
        };
      })
    );

    return withCounts.sort((a, b) => {
      // Default first, then alphabetical by name
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return a.name.localeCompare(b.name);
    });
  },
});

export const getById = query({
  args: { id: v.id("issuingCompanies") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;
    const doc = await ctx.db.get(args.id);
    if (!doc || doc.orgId !== orgId) return null;
    return doc;
  },
});
