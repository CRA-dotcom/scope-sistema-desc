import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import {
  getOrgId,
  requireAdmin,
  requireAuth,
} from "../../lib/authHelpers";
import { internal } from "../../_generated/api";

/**
 * A3 — Public mutations for the invoice lifecycle.
 *
 * Per docs/superpowers/specs/2026-05-23-document-lifecycle-design.md §3.1.2
 */

/**
 * Symbolic "sent" — emits a documentEvents row without changing status.
 * In V1 the operator typically sends via out-of-band channels; this is a
 * trace marker, optional.
 */
export const markSent = mutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const identity = await requireAuth(ctx);
    const orgId = await getOrgId(ctx);
    const inv = await ctx.db.get(args.invoiceId);
    if (!inv || inv.orgId !== orgId) {
      throw new Error("Factura no encontrada.");
    }
    if (inv.status !== "uploaded") {
      throw new Error(
        "Solo facturas en estado 'uploaded' pueden marcarse enviadas."
      );
    }
    await ctx.runMutation(
      internal.functions.documentEvents.internal.logEventMutation,
      {
        orgId,
        clientId: inv.clientId,
        entityType: "invoice" as const,
        entityId: args.invoiceId,
        eventType: "sent" as const,
        severity: "info" as const,
        actorUserId: identity.subject,
        actorType: "user" as const,
        message: `Factura ${inv.filename} marcada como enviada.`,
      }
    );
    return { ok: true };
  },
});

/**
 * Single human gate that converts an invoice into a deliverable. Idempotent.
 *
 * R1 §10 R4: re-clicks return `{ alreadyPaid: true }` without re-enqueueing.
 * R1 §12.9: this is the ONLY trigger for generation (the cron never generates).
 */
export const markPaid = mutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const identity = await requireAuth(ctx);
    const orgId = await getOrgId(ctx);
    const userId = identity.subject;

    const inv = await ctx.db.get(args.invoiceId);
    if (!inv || inv.orgId !== orgId) {
      throw new Error("Factura no encontrada.");
    }
    if (inv.status === "void") {
      throw new Error("Factura cancelada no puede marcarse pagada.");
    }
    if (inv.status === "paid") {
      return { ok: true, alreadyPaid: true };
    }

    const now = Date.now();
    await ctx.db.patch(args.invoiceId, {
      status: "paid" as const,
      paidAt: now,
      paidBy: userId,
    });

    // Sync monthlyAssignments.invoiceStatus for legacy UI compat.
    if (inv.monthlyAssignmentId) {
      const ma = await ctx.db.get(inv.monthlyAssignmentId);
      if (ma && ma.orgId === orgId && ma.invoiceStatus !== "paid") {
        await ctx.db.patch(inv.monthlyAssignmentId, {
          invoiceStatus: "paid" as const,
        });
      }
    }

    await ctx.runMutation(
      internal.functions.documentEvents.internal.logEventMutation,
      {
        orgId,
        clientId: inv.clientId,
        entityType: "invoice" as const,
        entityId: args.invoiceId,
        eventType: "paid" as const,
        severity: "info" as const,
        actorUserId: userId,
        actorType: "user" as const,
        message: `Factura ${inv.filename} marcada pagada. Encolando generación de entregable.`,
        metadata: {
          amount: inv.amount,
          year: inv.year,
          month: inv.month,
        },
      }
    );

    // Fire-and-forget; the action checks idempotency via findByTriggerInvoiceId.
    await ctx.scheduler.runAfter(
      0,
      internal.functions.deliverables.actions.generateFromInvoice,
      { invoiceId: args.invoiceId }
    );

    return { ok: true, alreadyPaid: false };
  },
});

export const markVoid = mutation({
  args: {
    invoiceId: v.id("invoices"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    const userId = identity.subject;

    const inv = await ctx.db.get(args.invoiceId);
    if (!inv || inv.orgId !== orgId) {
      throw new Error("Factura no encontrada.");
    }
    if (inv.status === "void") {
      return { ok: true, alreadyVoid: true };
    }

    const now = Date.now();
    const previousStatus = inv.status;
    await ctx.db.patch(args.invoiceId, {
      status: "void" as const,
      voidedAt: now,
      voidedBy: userId,
      voidReason: args.reason,
    });

    await ctx.runMutation(
      internal.functions.documentEvents.internal.logEventMutation,
      {
        orgId,
        clientId: inv.clientId,
        entityType: "invoice" as const,
        entityId: args.invoiceId,
        eventType: "voided" as const,
        severity: "warning" as const,
        actorUserId: userId,
        actorType: "user" as const,
        message: `Factura ${inv.filename} cancelada. Razón: ${args.reason}`,
        metadata: { reason: args.reason, previousStatus },
      }
    );

    return { ok: true, alreadyVoid: false };
  },
});
