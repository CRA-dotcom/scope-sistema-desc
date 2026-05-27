import type { GenericQueryCtx } from "convex/server";
import type { DataModel, Doc, Id } from "../_generated/dataModel";

/**
 * Looks up the active contract template for a given org, issuing company, and
 * subservice. Uses the composite index added in T1 (SS2).
 *
 * NO global fallback — per R1 spec, every org must define their own contracts.
 * Returns the highest-version active template, or null if none found.
 */
export async function findContractTemplate(
  ctx: GenericQueryCtx<DataModel>,
  args: {
    orgId: string;
    issuingCompanyId: Id<"issuingCompanies">;
    subserviceId: Id<"subservices">;
  }
): Promise<Doc<"deliverableTemplates"> | null> {
  const rows = await ctx.db
    .query("deliverableTemplates")
    .withIndex("by_orgId_type_issuingCompanyId_subserviceId", (q) =>
      q
        .eq("orgId", args.orgId)
        .eq("type", "contract")
        .eq("issuingCompanyId", args.issuingCompanyId)
        .eq("subserviceId", args.subserviceId)
    )
    .collect();

  const active = rows.filter((r) => r.isActive);
  if (active.length === 0) return null;

  return active.sort((a, b) => b.version - a.version)[0];
}
