import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";

/**
 * SS4 — Internal mutations atomically called by clientFinancialData actions.
 *
 * Per docs/superpowers/specs/2026-05-27-financial-statements-ingestion-design.md
 */

const LINE_ITEM_VALIDATOR = v.object({
  label: v.string(),
  amount: v.number(),
  category: v.union(
    v.literal("ingresos"),
    v.literal("gastos_operativos"),
    v.literal("impuestos"),
    v.literal("otros")
  ),
  satConcept: v.optional(v.string()),
});

const AI_EXTRACTION_VALIDATOR = v.object({
  model: v.string(),
  promptVersion: v.string(),
  extractedAt: v.number(),
  costUsd: v.optional(v.number()),
  rawSnippet: v.optional(v.string()),
  editedAt: v.optional(v.number()),
});

export const insertRow = internalMutation({
  args: {
    orgId: v.string(),
    clientId: v.id("clients"),
    period: v.string(),
    periodType: v.union(
      v.literal("monthly"),
      v.literal("quarterly"),
      v.literal("annual")
    ),
    bucketKey: v.string(),
    contentType: v.string(),
    sizeBytes: v.number(),
    filename: v.string(),
    uploadedBy: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("clientFinancialData", {
      orgId: args.orgId,
      clientId: args.clientId,
      period: args.period,
      periodType: args.periodType,
      bucketKey: args.bucketKey,
      contentType: args.contentType,
      sizeBytes: args.sizeBytes,
      filename: args.filename,
      lineItems: [],
      status: "uploaded" as const,
      uploadedBy: args.uploadedBy,
      uploadedAt: now,
    });

    await ctx.runMutation(
      internal.functions.documentEvents.internal.logEventMutation,
      {
        orgId: args.orgId,
        clientId: args.clientId,
        entityType: "financial_data" as const,
        entityId: id,
        eventType: "uploaded" as const,
        severity: "info" as const,
        actorUserId: args.uploadedBy,
        actorType: "user" as const,
        message: `Estado financiero subido: ${args.filename} (${args.period}).`,
        metadata: {
          period: args.period,
          periodType: args.periodType,
          filename: args.filename,
        },
      }
    );

    return id;
  },
});

export const patchExtraction = internalMutation({
  args: {
    id: v.id("clientFinancialData"),
    lineItems: v.array(LINE_ITEM_VALIDATOR),
    aiExtraction: AI_EXTRACTION_VALIDATOR,
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("clientFinancialData row not found");
    await ctx.db.patch(args.id, {
      lineItems: args.lineItems,
      aiExtraction: args.aiExtraction,
      status: "extracted" as const,
      errorMessage: undefined,
    });

    await ctx.runMutation(
      internal.functions.documentEvents.internal.logEventMutation,
      {
        orgId: row.orgId,
        clientId: row.clientId,
        entityType: "financial_data" as const,
        entityId: args.id,
        eventType: "updated" as const,
        severity: "info" as const,
        actorType: "system" as const,
        message: `Extracción AI completa (${args.lineItems.length} line items).`,
        metadata: {
          model: args.aiExtraction.model,
          promptVersion: args.aiExtraction.promptVersion,
          lineCount: args.lineItems.length,
        },
      }
    );
  },
});

export const deleteRowInternal = internalMutation({
  args: {
    id: v.id("clientFinancialData"),
    actorUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return;
    await ctx.db.delete(args.id);
    await ctx.runMutation(
      internal.functions.documentEvents.internal.logEventMutation,
      {
        orgId: row.orgId,
        clientId: row.clientId,
        entityType: "financial_data" as const,
        entityId: args.id,
        eventType: "deleted" as const,
        severity: "info" as const,
        actorUserId: args.actorUserId,
        actorType: "user" as const,
        message: `Estados financieros borrados (${row.period} ${row.filename}).`,
        metadata: { bucketKey: row.bucketKey },
      }
    );
  },
});

export const markError = internalMutation({
  args: {
    id: v.id("clientFinancialData"),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return;
    await ctx.db.patch(args.id, {
      status: "error" as const,
      errorMessage: args.errorMessage,
    });

    await ctx.runMutation(
      internal.functions.documentEvents.internal.logEventMutation,
      {
        orgId: row.orgId,
        clientId: row.clientId,
        entityType: "financial_data" as const,
        entityId: args.id,
        eventType: "error" as const,
        severity: "error" as const,
        actorType: "system" as const,
        message: `Extracción AI falló: ${args.errorMessage}`,
        metadata: { errorMessage: args.errorMessage },
      }
    );
  },
});
