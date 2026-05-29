import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";

// ─── Claim mutations for invoiceFlow ─────────────────────────────────────────
//
// Extracted from invoiceFlow.ts because that file carries "use node" (it
// orchestrates an AI action), and Convex rejects mutations in Node runtime
// files. These two mutations run in the standard V8 runtime.

/**
 * Atomic claim para idempotencia de generateFromInvoice.
 * Inserta un placeholder deliverable con triggerInvoiceId set, retornando
 * false si ya existe (race winner ya reservó el slot).
 *
 * El placeholder se patchea con contenido real cuando termina el AI batch
 * vía deliverables.saveGenerated (dedup por by_assignmentId).
 */
export const claimInvoiceForGeneration = internalMutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => {
    const existing = await ctx.db
      .query("deliverables")
      .withIndex("by_triggerInvoiceId", (q) =>
        q.eq("triggerInvoiceId", invoiceId)
      )
      .first();
    if (existing) return false;

    const invoice = await ctx.db.get(invoiceId);
    if (!invoice) return false;

    const assignment = invoice.monthlyAssignmentId
      ? await ctx.db.get(invoice.monthlyAssignmentId)
      : null;
    if (!assignment) return false;

    await ctx.db.insert("deliverables", {
      orgId: invoice.orgId,
      assignmentId: assignment._id,
      projServiceId: assignment.projServiceId,
      clientId: assignment.clientId,
      serviceName: assignment.serviceName,
      subserviceId: assignment.subserviceId,
      month: assignment.month,
      year: assignment.year,
      shortContent: "",
      longContent: "",
      auditStatus: "pending" as const,
      retryCount: 0,
      triggerSource: "invoice_paid" as const,
      triggerInvoiceId: invoiceId,
      createdAt: Date.now(),
    });
    return true;
  },
});

/**
 * Internal: release a stuck empty placeholder so a future retry can re-claim.
 *
 * Called from the catch block of generateFromInvoice when the AI batch throws.
 * Only deletes the placeholder when it is genuinely empty (shortContent === "",
 * longContent === "", auditStatus === "pending"). If it already has real content
 * — meaning saveGenerated ran successfully despite the action-level error —
 * it is left untouched to preserve user data.
 */
export const releaseClaimPlaceholder = internalMutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => {
    const existing = await ctx.db
      .query("deliverables")
      .withIndex("by_triggerInvoiceId", (q) =>
        q.eq("triggerInvoiceId", invoiceId)
      )
      .first();
    if (!existing) return { released: false };
    if (
      existing.shortContent !== "" ||
      existing.longContent !== "" ||
      existing.auditStatus !== "pending"
    ) {
      return { released: false };
    }
    await ctx.db.delete(existing._id);
    return { released: true };
  },
});
