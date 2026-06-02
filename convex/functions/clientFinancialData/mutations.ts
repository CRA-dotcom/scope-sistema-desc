import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgId, getOrgIdMutation, requireAuth } from "../../lib/authHelpers";
import { internal } from "../../_generated/api";

/**
 * SS4 — Validation + edit mutations for clientFinancialData rows.
 *
 * Per docs/superpowers/specs/2026-05-27-financial-statements-ingestion-design.md §7
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

export const markValidated = mutation({
  args: { id: v.id("clientFinancialData") },
  handler: async (ctx, args) => {
    const identity = await requireAuth(ctx);
    const orgId = await getOrgIdMutation(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.orgId !== orgId) {
      throw new Error("Estado financiero no encontrado.");
    }
    if (row.status !== "extracted" && row.status !== "rejected") {
      throw new Error(
        "Solo filas con extracción completa pueden marcarse como validadas."
      );
    }
    const now = Date.now();
    await ctx.db.patch(args.id, {
      status: "validated" as const,
      validatedAt: now,
      validatedBy: identity.subject,
      rejectionReason: undefined,
    });
    await ctx.runMutation(
      internal.functions.documentEvents.internal.logEventMutation,
      {
        orgId,
        clientId: row.clientId,
        entityType: "financial_data" as const,
        entityId: args.id,
        eventType: "audited" as const,
        severity: "info" as const,
        actorUserId: identity.subject,
        actorType: "user" as const,
        message: `Estados financieros validados (${row.period}).`,
      }
    );
    return { ok: true };
  },
});

export const markRejected = mutation({
  args: {
    id: v.id("clientFinancialData"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await requireAuth(ctx);
    const orgId = await getOrgIdMutation(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.orgId !== orgId) {
      throw new Error("Estado financiero no encontrado.");
    }
    if (row.status !== "extracted") {
      throw new Error(
        "Solo filas con extracción completa pueden rechazarse."
      );
    }
    if (!args.reason || args.reason.trim().length === 0) {
      throw new Error("La razón de rechazo es requerida.");
    }
    await ctx.db.patch(args.id, {
      status: "rejected" as const,
      rejectionReason: args.reason.trim(),
    });
    await ctx.runMutation(
      internal.functions.documentEvents.internal.logEventMutation,
      {
        orgId,
        clientId: row.clientId,
        entityType: "financial_data" as const,
        entityId: args.id,
        eventType: "audited" as const,
        severity: "warning" as const,
        actorUserId: identity.subject,
        actorType: "user" as const,
        message: `Estados financieros rechazados (${row.period}): ${args.reason.trim()}`,
        metadata: { reason: args.reason.trim() },
      }
    );
    return { ok: true };
  },
});

export const manuallySetLineItems = mutation({
  args: {
    id: v.id("clientFinancialData"),
    lineItems: v.array(LINE_ITEM_VALIDATOR),
  },
  handler: async (ctx, args) => {
    const identity = await requireAuth(ctx);
    const orgId = await getOrgIdMutation(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.orgId !== orgId) {
      throw new Error("Estado financiero no encontrado.");
    }
    if (row.status === "rejected") {
      throw new Error(
        "Fila rechazada no puede editarse. Re-extrae primero."
      );
    }
    const aiExtraction = row.aiExtraction
      ? { ...row.aiExtraction, editedAt: Date.now() }
      : undefined;
    await ctx.db.patch(args.id, {
      lineItems: args.lineItems,
      aiExtraction,
    });
    await ctx.runMutation(
      internal.functions.documentEvents.internal.logEventMutation,
      {
        orgId,
        clientId: row.clientId,
        entityType: "financial_data" as const,
        entityId: args.id,
        eventType: "updated" as const,
        severity: "info" as const,
        actorUserId: identity.subject,
        actorType: "user" as const,
        message: `Line items editados manualmente (${args.lineItems.length}).`,
        metadata: { lineCount: args.lineItems.length },
      }
    );
    return { ok: true };
  },
});
