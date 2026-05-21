"use node";

import { action } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import {
  buildKey,
  uploadBlob,
  signedDownloadUrl,
} from "../../lib/blobStorage";

// Authenticated, single-use download from the UI: a short TTL is enough
// because the user is already in-session and can re-request another URL.
const DOWNLOAD_URL_TTL_SEC = 60 * 60;

/**
 * A3 — Upload an invoice PDF.
 *
 * Bucket-first ordering (R1 §10 R7): the blob is uploaded BEFORE the row is
 * inserted. If the bucket put throws, no DB row is created — preventing
 * "row without blob" inconsistencies. If insert later fails, the worst case
 * is an orphan blob that the weekly cleanup script sweeps.
 *
 * Per docs/superpowers/specs/2026-05-23-document-lifecycle-design.md §3.1.1
 */
export const upload = action({
  args: {
    clientId: v.id("clients"),
    projectionId: v.id("projections"),
    projServiceId: v.optional(v.id("projectionServices")),
    subserviceId: v.optional(v.id("subservices")),
    serviceName: v.string(),
    monthlyAssignmentId: v.optional(v.id("monthlyAssignments")),
    month: v.number(),
    year: v.number(),
    amount: v.number(),
    filename: v.string(),
    contentType: v.string(),
    fileBuffer: v.bytes(),
    notes: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    invoiceId: Id<"invoices">;
    duplicateOf?: Id<"invoices">;
  }> => {
    const { userId, orgId } = await ctx.runQuery(
      internal.functions.invoices.internalQueries.requireAuthCtx,
      {}
    );

    // 1. Validate client membership.
    const client = await ctx.runQuery(
      internal.functions.invoices.internalQueries.getClientForOrg,
      { clientId: args.clientId, orgId }
    );
    if (!client) {
      throw new Error("Cliente no encontrado o no pertenece al org.");
    }

    if (args.month < 1 || args.month > 12) {
      throw new Error("Mes inválido.");
    }
    if (!Number.isFinite(args.amount) || args.amount < 0) {
      throw new Error("Monto inválido.");
    }
    if (args.contentType !== "application/pdf") {
      throw new Error("Solo PDFs aceptados en V1.");
    }

    // 2. Detect duplicates (same client+year+month+subservice, non-void).
    const duplicate = await ctx.runQuery(
      internal.functions.invoices.internalQueries.findDuplicate,
      {
        orgId,
        clientId: args.clientId,
        year: args.year,
        month: args.month,
        subserviceId: args.subserviceId,
      }
    );

    // 3. Bucket-first: upload blob to Railway BEFORE inserting row.
    const safeFilename = args.filename
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 80);
    const suffix = `${args.year}-${String(args.month).padStart(2, "0")}-${Date.now()}-${safeFilename}`;
    const bucketKey = buildKey({
      orgId,
      clientId: args.clientId,
      kind: "invoices",
      suffix,
    });

    await uploadBlob({
      buffer: Buffer.from(args.fileBuffer),
      key: bucketKey,
      contentType: args.contentType,
    });
    // Bucket OK → safe to insert row.

    // 4. Insert row + log events atomically.
    const invoiceId = await ctx.runMutation(
      internal.functions.invoices.internalMutations.insertInvoiceRow,
      {
        orgId,
        clientId: args.clientId,
        projectionId: args.projectionId,
        projServiceId: args.projServiceId,
        subserviceId: args.subserviceId,
        serviceName: args.serviceName,
        monthlyAssignmentId: args.monthlyAssignmentId,
        month: args.month,
        year: args.year,
        amount: args.amount,
        bucketKey,
        contentType: args.contentType,
        sizeBytes: args.fileBuffer.byteLength,
        filename: safeFilename,
        notes: args.notes,
        uploadedBy: userId,
        duplicateOfId: duplicate?._id,
      }
    );

    // 5. Notify client (signed URL) — fire and forget.
    await ctx.scheduler.runAfter(
      0,
      internal.functions.invoices.internalActions.notifyClientUploaded,
      { invoiceId }
    );

    return {
      invoiceId,
      duplicateOf: duplicate?._id,
    };
  },
});

/**
 * Generate a short-lived signed URL for downloading the invoice PDF.
 * Auth + multi-tenant enforced via `getInvoiceForOrg`.
 */
export const getDownloadUrl = action({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args): Promise<string> => {
    const inv = await ctx.runQuery(
      internal.functions.invoices.internalQueries.getInvoiceForOrg,
      { invoiceId: args.invoiceId }
    );
    if (!inv) throw new Error("Factura no encontrada.");
    return await signedDownloadUrl({
      bucketKey: inv.bucketKey,
      expiresSec: DOWNLOAD_URL_TTL_SEC,
    });
  },
});
