import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export type DownstreamCounts = {
  projServices: number;
  assignments: number;
  quotations: number;
  contracts: number;
  deliverables: number;
  invoices: number;
  questionnaires: number;
};

export async function getProjectionDownstreamCounts(
  ctx: QueryCtx | MutationCtx,
  projectionId: Id<"projections">
): Promise<DownstreamCounts> {
  const [projServices, assignments, invoices, questionnaireRows] = await Promise.all([
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
    ctx.db
      .query("questionnaireResponses")
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
    questionnaires: questionnaireRows.length,
  };
}

/**
 * Cancela monthlyAssignments futuros que estén en estado pending + not_invoiced.
 * Usado por applyDecline (quotation rechazada) y cancelContract para evitar
 * recordatorios fantasma del cron de eligibility.
 *
 * - No toca assignments del pasado (preserva historia).
 * - No toca assignments en progreso (info_received, in_progress, delivered).
 * - No toca assignments ya facturados (invoiceStatus != "not_invoiced").
 */
export async function cancelFuturePendingAssignments(
  ctx: MutationCtx,
  projServiceId: Id<"projectionServices">
): Promise<void> {
  const today = new Date();
  const currentYearMonth = today.getFullYear() * 100 + (today.getMonth() + 1);
  const mas = await ctx.db
    .query("monthlyAssignments")
    .withIndex("by_projServiceId", (q) => q.eq("projServiceId", projServiceId))
    .collect();
  for (const ma of mas) {
    const maYm = ma.year * 100 + ma.month;
    if (maYm < currentYearMonth) continue;
    if (ma.status !== "pending") continue;
    if (ma.invoiceStatus !== "not_invoiced") continue;
    await ctx.db.delete(ma._id);
  }
}
