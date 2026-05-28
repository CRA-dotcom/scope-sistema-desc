import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export type DownstreamCounts = {
  projServices: number;
  assignments: number;
  quotations: number;
  contracts: number;
  deliverables: number;
  invoices: number;
};

export async function getProjectionDownstreamCounts(
  ctx: QueryCtx | MutationCtx,
  projectionId: Id<"projections">
): Promise<DownstreamCounts> {
  const [projServices, assignments, invoices] = await Promise.all([
    ctx.db
      .query("projectionServices")
      .withIndex("by_projectionId", (q) => q.eq("projectionId", projectionId))
      .collect(),
    ctx.db
      .query("monthlyAssignments")
      .withIndex("by_projectionId", (q) => q.eq("projectionId", projectionId))
      .collect(),
    ctx.db
      .query("invoices")
      .withIndex("by_projectionId", (q) => q.eq("projectionId", projectionId))
      .collect(),
  ]);

  let quotations = 0;
  let contracts = 0;
  let deliverables = 0;

  for (const ps of projServices) {
    const [qs, cs, ds] = await Promise.all([
      ctx.db
        .query("quotations")
        .withIndex("by_projServiceId", (q) => q.eq("projServiceId", ps._id))
        .collect(),
      ctx.db
        .query("contracts")
        .withIndex("by_projServiceId", (q) => q.eq("projServiceId", ps._id))
        .collect(),
      ctx.db
        .query("deliverables")
        .withIndex("by_projServiceId", (q) => q.eq("projServiceId", ps._id))
        .collect(),
    ]);
    quotations += qs.length;
    contracts += cs.length;
    deliverables += ds.length;
  }

  return {
    projServices: projServices.length,
    assignments: assignments.length,
    quotations,
    contracts,
    deliverables,
    invoices: invoices.length,
  };
}
