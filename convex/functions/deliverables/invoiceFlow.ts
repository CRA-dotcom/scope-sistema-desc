"use node";

import { internalAction, internalMutation } from "../../_generated/server";
import { internal, api } from "../../_generated/api";
import { v } from "convex/values";
import type { Id } from "../../_generated/dataModel";

// ─── A3 — Invoice-triggered deliverable flow ─────────────────────────
//
// Split out of `actions.ts` (which got past 1100 LOC) because this
// orchestration is a separate concern from the generic AI pipeline
// (`generateDeliverable` / `auditDeliverable` / `regenerateDeliverable` /
// `previewDeliverable`). Behaviour preserved 1:1 — only relocated.

/**
 * Internal: orchestrate deliverable generation triggered by a paid invoice.
 *
 * Flow (R1 §12.5, §12.9; doc-lifecycle §3.2):
 *  1. Load invoice; abort if missing / not paid.
 *  2. Resolve projection.
 *  3. Run the frequency-aware selector (`selectDeliverableForMonth`).
 *     If no template: log warning + email operator + return early.
 *  4. Resolve `monthlyAssignment`.
 *  5. Atomic claim via `claimInvoiceForGeneration`.
 *  6. Delegate to `generateDeliverable` with `templateOverride` so the
 *     snapshot used is the one the selector picked.
 *  7. Log success + notify executive.
 *
 * This is the ONLY non-manual path that creates a deliverable. The cron
 * NEVER calls this (R1 §12.9).
 */
export const generateFromInvoice = internalAction({
  args: { invoiceId: v.id("invoices") },
  handler: async (
    ctx,
    { invoiceId }
  ): Promise<{
    ok?: boolean;
    reason?: string;
    deliverableId?: Id<"deliverables">;
    error?: string;
    skipped?: "already_claimed";
  }> => {
    // 1. Load invoice.
    const invoice = await ctx.runQuery(
      internal.functions.invoices.internalQueries.getInvoiceForGeneration,
      { invoiceId }
    );
    if (!invoice) {
      console.warn(
        `[generateFromInvoice] invoice ${invoiceId} not found — race with void?`
      );
      return { ok: false, reason: "invoice_not_found" };
    }
    if (invoice.status !== "paid") {
      console.warn(
        `[generateFromInvoice] invoice ${invoiceId} status=${invoice.status} — abort`
      );
      return { ok: false, reason: "invoice_not_paid" };
    }

    // 3. Resolve projection.
    const projection = await ctx.runQuery(
      internal.functions.deliverables.internalQueries.getProjectionByProjService,
      { projectionId: invoice.projectionId }
    );
    if (!projection) {
      await ctx.runMutation(
        internal.functions.documentEvents.internal.logEventMutation,
        {
          orgId: invoice.orgId,
          clientId: invoice.clientId,
          entityType: "invoice" as const,
          entityId: invoiceId,
          eventType: "error" as const,
          severity: "error" as const,
          actorType: "system" as const,
          message: `Proyección ${invoice.projectionId} no encontrada.`,
        }
      );
      return { ok: false, reason: "projection_missing" };
    }

    // 4. Frequency-aware selector. B1: pass projServiceId so the selector
    //    can enforce the projectionServices [startMonth, endMonth] window
    //    for mid-year add-ons.
    const selected = await ctx.runQuery(
      internal.functions.deliverables.internalQueries.selectDeliverableForMonth,
      {
        orgId: invoice.orgId,
        clientId: invoice.clientId,
        subserviceId: invoice.subserviceId,
        serviceId: undefined,
        serviceName: invoice.serviceName,
        projServiceId: invoice.projServiceId,
        month: invoice.month,
        year: invoice.year,
        projectionMode: projection.projectionMode ?? "rolling",
        templateType: "deliverable_short" as const,
      }
    );

    if (!selected) {
      await ctx.runMutation(
        internal.functions.documentEvents.internal.logEventMutation,
        {
          orgId: invoice.orgId,
          clientId: invoice.clientId,
          entityType: "invoice" as const,
          entityId: invoiceId,
          eventType: "error" as const,
          severity: "warning" as const,
          actorType: "system" as const,
          message: `No hay plantilla aplicable para ${invoice.serviceName} en ${invoice.month}/${invoice.year}. Operador puede generar manualmente.`,
          metadata: {
            subserviceId: invoice.subserviceId,
            month: invoice.month,
            year: invoice.year,
          },
        }
      );
      await ctx.scheduler.runAfter(
        0,
        internal.functions.invoices.internalActions.notifyOperatorNoTemplate,
        { invoiceId }
      );
      return { ok: false, reason: "no_template" };
    }

    // 5. Resolve monthlyAssignment.
    let assignmentId: Id<"monthlyAssignments"> | null =
      invoice.monthlyAssignmentId ?? null;
    let projServiceId: Id<"projectionServices"> | null =
      invoice.projServiceId ?? null;
    if (!assignmentId) {
      const ma = await ctx.runQuery(
        internal.functions.deliverables.internalQueries.findAssignmentForInvoice,
        {
          orgId: invoice.orgId,
          clientId: invoice.clientId,
          projServiceId: invoice.projServiceId,
          month: invoice.month,
          year: invoice.year,
        }
      );
      if (!ma) {
        await ctx.runMutation(
          internal.functions.documentEvents.internal.logEventMutation,
          {
            orgId: invoice.orgId,
            clientId: invoice.clientId,
            entityType: "invoice" as const,
            entityId: invoiceId,
            eventType: "error" as const,
            severity: "error" as const,
            actorType: "system" as const,
            message:
              "No se encontró monthlyAssignment compatible para la factura.",
          }
        );
        return { ok: false, reason: "no_assignment" };
      }
      assignmentId = ma._id;
      projServiceId = ma.projServiceId;
    }

    if (!projServiceId) {
      // Should not happen if monthlyAssignment exists, but defensive.
      await ctx.runMutation(
        internal.functions.documentEvents.internal.logEventMutation,
        {
          orgId: invoice.orgId,
          clientId: invoice.clientId,
          entityType: "invoice" as const,
          entityId: invoiceId,
          eventType: "error" as const,
          severity: "error" as const,
          actorType: "system" as const,
          message: "Factura sin projServiceId resoluble.",
        }
      );
      return { ok: false, reason: "no_proj_service" };
    }

    // 5b. Guard: monthly cell must have a subservice picked. Per spec 2026-05-22.
    const assignment = await ctx.runQuery(
      internal.functions.deliverables.internalQueries.getAssignmentData,
      { assignmentId }
    );
    if (!assignment?.subserviceId) {
      await ctx.runMutation(
        internal.functions.documentEvents.internal.logEventMutation,
        {
          orgId: invoice.orgId,
          clientId: invoice.clientId,
          entityType: "invoice" as const,
          entityId: invoiceId,
          eventType: "error" as const,
          severity: "warning" as const,
          actorType: "system" as const,
          message: `Generacion abortada: la celda ${invoice.month}/${invoice.year} no tiene subservicio asignado. Pide al operador planificar en la matriz.`,
          metadata: { reason: "missing_subservice", assignmentId },
        }
      );
      return { ok: false, reason: "missing_subservice" };
    }

    // 6. Phase 1 §3.7 — atomic claim antes del AI call.
    //    Todos los guards pasaron; ahora reservamos el slot atómicamente.
    //    Si ya existe un placeholder (race loser), skip el AI batch.
    const claimed: boolean = await ctx.runMutation(
      internal.functions.deliverables.invoiceFlow.claimInvoiceForGeneration,
      { invoiceId }
    );
    if (!claimed) {
      console.log(
        `[generateFromInvoice] invoice ${invoiceId} already claimed — skip AI`
      );
      return { skipped: "already_claimed" as const };
    }

    // 7. Delegate to the engine with the snapshot we picked.
    let deliverableId: Id<"deliverables">;
    try {
      const result = await ctx.runAction(
        api.functions.deliverables.actions.generateDeliverable,
        {
          assignmentId,
          projServiceId,
          clientId: invoice.clientId,
          templateType: "deliverable_short" as const,
          triggerSource: "invoice_paid" as const,
          triggerInvoiceId: invoiceId,
          templateOverride: {
            templateId: selected.template._id,
            templateVersion: selected.template.version ?? 1,
            templateHtmlSnapshot: selected.template.htmlTemplate,
          },
        }
      );
      deliverableId = result as Id<"deliverables">;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(
        internal.functions.documentEvents.internal.logEventMutation,
        {
          orgId: invoice.orgId,
          clientId: invoice.clientId,
          entityType: "invoice" as const,
          entityId: invoiceId,
          eventType: "error" as const,
          severity: "error" as const,
          actorType: "system" as const,
          message: `Generación falló: ${msg}`,
          metadata: { error: msg },
        }
      );
      return { ok: false, reason: "generation_failed", error: msg };
    }

    // 8. Log success + notify executive.
    await ctx.runMutation(
      internal.functions.documentEvents.internal.logEventMutation,
      {
        orgId: invoice.orgId,
        clientId: invoice.clientId,
        entityType: "deliverable" as const,
        entityId: deliverableId,
        eventType: "generated" as const,
        severity: "info" as const,
        actorType: "system" as const,
        message: `Entregable generado desde factura ${invoice.filename}.`,
        metadata: {
          triggerInvoiceId: invoiceId,
          templateId: selected.template._id,
          templateVersion: selected.template.version,
        },
      }
    );

    await ctx.scheduler.runAfter(
      0,
      internal.functions.deliverables.invoiceFlow.notifyExecutiveGenerated,
      { deliverableId }
    );

    return { ok: true, deliverableId };
  },
});

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
 * Internal: notify the operator/ejecutivo that a deliverable was generated.
 * Honours the notification recipient resolution spec (2026-05-19) —
 * resolves via `resolveOrgNotificationEmail`, env fallback, then skip+warn.
 */
type ExecutiveNotifyResult = {
  sent: boolean;
  reason?: string;
  id?: string;
};

export const notifyExecutiveGenerated = internalAction({
  args: { deliverableId: v.id("deliverables") },
  handler: async (ctx, args): Promise<ExecutiveNotifyResult> => {
    const deliverable = await ctx.runQuery(
      internal.functions.deliverables.internalQueries.getDeliverableData,
      { deliverableId: args.deliverableId }
    );
    if (!deliverable) return { sent: false, reason: "deliverable_not_found" };

    const recipient: string | null = await ctx.runQuery(
      internal.functions.email.resolveRecipients.resolveOrgNotificationEmail,
      { orgId: deliverable.orgId }
    );
    if (!recipient) {
      console.warn(
        `[notifyExecutiveGenerated] no notificationEmail for org ${deliverable.orgId} — skip`
      );
      return { sent: false, reason: "no_recipient" };
    }

    const subject = `Entregable generado — ${deliverable.serviceName} ${deliverable.month}/${deliverable.year}`;
    const html = `<p>Un entregable nuevo se generó automáticamente para ${deliverable.serviceName} (${deliverable.month}/${deliverable.year}).</p>
<p>Revísalo en el panel de Projex.</p>`;

    const result = (await ctx.runAction(
      internal.functions.email.send.sendEmailInternal,
      { to: recipient, subject, html }
    )) as ExecutiveNotifyResult;
    return result;
  },
});
