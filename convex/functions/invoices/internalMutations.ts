import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";

/**
 * A3 — Internal mutation atomically called by `invoices.actions.upload`
 * after the blob upload succeeds. Insert row + sync MA + emit
 * documentEvents in a single Convex transaction.
 *
 * Per docs/superpowers/specs/2026-05-23-document-lifecycle-design.md §3.1.1
 */
export const insertInvoiceRow = internalMutation({
  args: {
    orgId: v.string(),
    clientId: v.id("clients"),
    projectionId: v.id("projections"),
    projServiceId: v.optional(v.id("projectionServices")),
    subserviceId: v.optional(v.id("subservices")),
    serviceName: v.string(),
    monthlyAssignmentId: v.optional(v.id("monthlyAssignments")),
    month: v.number(),
    year: v.number(),
    amount: v.number(),
    bucketKey: v.string(),
    contentType: v.string(),
    sizeBytes: v.number(),
    filename: v.string(),
    notes: v.optional(v.string()),
    uploadedBy: v.string(),
    duplicateOfId: v.optional(v.id("invoices")),
    issueDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const invoiceId = await ctx.db.insert("invoices", {
      orgId: args.orgId,
      clientId: args.clientId,
      projectionId: args.projectionId,
      projServiceId: args.projServiceId,
      subserviceId: args.subserviceId,
      serviceName: args.serviceName,
      monthlyAssignmentId: args.monthlyAssignmentId,
      month: args.month,
      year: args.year,
      amount: args.amount,
      bucketKey: args.bucketKey,
      contentType: args.contentType,
      sizeBytes: args.sizeBytes,
      filename: args.filename,
      status: "uploaded" as const,
      uploadedAt: now,
      uploadedBy: args.uploadedBy,
      issueDate: args.issueDate,
      notes: args.notes,
      createdAt: now,
    });

    // Sync monthlyAssignments.invoiceStatus if we have the link.
    if (args.monthlyAssignmentId) {
      const ma = await ctx.db.get(args.monthlyAssignmentId);
      if (
        ma &&
        ma.orgId === args.orgId &&
        ma.invoiceStatus === "not_invoiced"
      ) {
        await ctx.db.patch(args.monthlyAssignmentId, {
          invoiceStatus: "invoiced" as const,
        });
      }
    }

    // Log "uploaded" event.
    await ctx.runMutation(
      internal.functions.documentEvents.internal.logEventMutation,
      {
        orgId: args.orgId,
        clientId: args.clientId,
        entityType: "invoice" as const,
        entityId: invoiceId,
        eventType: "uploaded" as const,
        severity: "info" as const,
        actorUserId: args.uploadedBy,
        actorType: "user" as const,
        message: `Factura subida: $${args.amount.toLocaleString("es-MX")} de ${args.serviceName} para ${args.month}/${args.year}.`,
        metadata: {
          amount: args.amount,
          year: args.year,
          month: args.month,
          filename: args.filename,
        },
      }
    );

    // If duplicate detected, also log a warning event.
    if (args.duplicateOfId) {
      await ctx.runMutation(
        internal.functions.documentEvents.internal.logEventMutation,
        {
          orgId: args.orgId,
          clientId: args.clientId,
          entityType: "invoice" as const,
          entityId: invoiceId,
          eventType: "created" as const,
          severity: "warning" as const,
          actorUserId: args.uploadedBy,
          actorType: "user" as const,
          message: `Factura duplicada detectada para ${args.month}/${args.year} (${args.serviceName}).`,
          metadata: { duplicateOf: args.duplicateOfId },
        }
      );
    }

    return invoiceId;
  },
});
