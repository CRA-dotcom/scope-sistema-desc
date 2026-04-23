import { internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import type { Doc, Id, DataModel } from "../../_generated/dataModel";
import type { GenericQueryCtx } from "convex/server";

export class NoIssuingCompanyError extends Error {
  constructor(orgId: string) {
    super(`No hay empresa emitente activa para la organización ${orgId}`);
    this.name = "NoIssuingCompanyError";
  }
}

export type ResolveResult = {
  issuingCompany: Doc<"issuingCompanies">;
  source: "client_override" | "service_map" | "org_default";
};

export async function resolveIssuingCompany(
  ctx: GenericQueryCtx<DataModel>,
  args: { orgId: string; clientId: Id<"clients">; serviceId: Id<"services"> }
): Promise<ResolveResult> {
  const { orgId, clientId, serviceId } = args;

  // 1. clientIssuingCompanyOverride
  const override = await ctx.db
    .query("clientIssuingCompanyOverride")
    .withIndex("by_orgId_client_service", (q) =>
      q.eq("orgId", orgId).eq("clientId", clientId).eq("serviceId", serviceId)
    )
    .first();
  if (override) {
    const company = await ctx.db.get(override.issuingCompanyId);
    if (company && company.isActive) {
      return { issuingCompany: company, source: "client_override" };
    }
  }

  // 2. servicesIssuingCompanyMap
  const mapping = await ctx.db
    .query("servicesIssuingCompanyMap")
    .withIndex("by_orgId_serviceId", (q) =>
      q.eq("orgId", orgId).eq("serviceId", serviceId)
    )
    .first();
  if (mapping) {
    const company = await ctx.db.get(mapping.issuingCompanyId);
    if (company && company.isActive) {
      return { issuingCompany: company, source: "service_map" };
    }
  }

  // 3. org default
  const defaults = await ctx.db
    .query("issuingCompanies")
    .withIndex("by_orgId_isDefault", (q) =>
      q.eq("orgId", orgId).eq("isDefault", true)
    )
    .collect();
  const active = defaults.find((c) => c.isActive);
  if (active) {
    return { issuingCompany: active, source: "org_default" };
  }

  throw new NoIssuingCompanyError(orgId);
}

export const resolveIssuingCompanyQuery = internalQuery({
  args: {
    orgId: v.string(),
    clientId: v.id("clients"),
    serviceId: v.id("services"),
  },
  handler: async (ctx, args) => resolveIssuingCompany(ctx, args),
});
