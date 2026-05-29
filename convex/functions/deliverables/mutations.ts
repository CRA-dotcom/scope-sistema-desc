import { mutation, internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { getOrgId, getOrgIdMutation, requireAuth } from "../../lib/authHelpers";
import { internal } from "../../_generated/api";
import { assertDeliveredRequiresInvoice } from "../../lib/stateMachines";

// ─── Public mutations ────────────────────────────────────────────────

/**
 * Manual creation of a deliverable (for non-AI deliverables).
 */
export const create = mutation({
  args: {
    assignmentId: v.id("monthlyAssignments"),
    projServiceId: v.id("projectionServices"),
    clientId: v.id("clients"),
    serviceName: v.string(),
    month: v.number(),
    year: v.number(),
    shortContent: v.string(),
    longContent: v.string(),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdMutation(ctx);

    const assignment = await ctx.db.get(args.assignmentId);
    if (!assignment || assignment.orgId !== orgId) {
      throw new Error("Asignacion no encontrada.");
    }

    return await ctx.db.insert("deliverables", {
      orgId,
      assignmentId: args.assignmentId,
      projServiceId: args.projServiceId,
      clientId: args.clientId,
      serviceName: args.serviceName,
      month: args.month,
      year: args.year,
      shortContent: args.shortContent,
      longContent: args.longContent,
      auditStatus: "pending",
      retryCount: 0,
      createdAt: Date.now(),
    });
  },
});

/**
 * Mark a deliverable as delivered (set deliveredAt timestamp).
 */
export const markDelivered = mutation({
  args: { id: v.id("deliverables") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdMutation(ctx);
    const deliverable = await ctx.db.get(args.id);
    if (!deliverable || deliverable.orgId !== orgId) {
      throw new Error("Entregable no encontrado.");
    }

    await ctx.db.patch(args.id, { deliveredAt: Date.now() });
  },
});

/**
 * Manual override of audit status.
 */
export const updateAuditStatus = mutation({
  args: {
    id: v.id("deliverables"),
    auditStatus: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("corrected")
    ),
    auditFeedback: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdMutation(ctx);
    const deliverable = await ctx.db.get(args.id);
    if (!deliverable || deliverable.orgId !== orgId) {
      throw new Error("Entregable no encontrado.");
    }

    const patch: Record<string, unknown> = {
      auditStatus: args.auditStatus,
    };
    if (args.auditFeedback !== undefined) {
      patch.auditFeedback = args.auditFeedback;
    }

    await ctx.db.patch(args.id, patch);
  },
});

/**
 * Deliver a deliverable to the client.
 * - Verifies audit status is "approved"
 * - Sets deliveredAt timestamp
 * - Updates corresponding monthlyAssignment status to "delivered"
 * - Schedules email notification to client
 */
export const deliver = mutation({
  args: {
    deliverableId: v.id("deliverables"),
  },
  handler: async (ctx, args) => {
    const identity = await requireAuth(ctx);
    const orgId = await getOrgIdMutation(ctx);

    const deliverable = await ctx.db.get(args.deliverableId);
    if (!deliverable) {
      throw new Error("Deliverable not found");
    }

    if (deliverable.orgId !== orgId) {
      throw new Error("Unauthorized: org mismatch");
    }

    if (deliverable.auditStatus !== "approved") {
      throw new Error(
        `Cannot deliver: audit status is "${deliverable.auditStatus}", must be "approved"`
      );
    }

    // Verify client has a contactEmail before doing any writes.
    // Trim first so whitespace-only strings ("   ") are treated as absent.
    const client = await ctx.db.get(deliverable.clientId);
    const trimmedEmail = client?.contactEmail?.trim();
    if (!trimmedEmail) {
      // Return soft-failure without mutating auditStatus. The deliverable stays
      // "approved" so the "Marcar como Entregado" button remains visible after
      // the operator adds contactEmail — no AI re-run needed.
      return {
        success: false,
        deliverableId: args.deliverableId,
        reason: "no_contact_email" as const,
      };
    }
    const clientEmail = trimmedEmail;
    // client is guaranteed non-null here: trimmedEmail being truthy implies
    // client?.contactEmail was non-empty, which implies client was non-null.
    const clientName = client!.name;

    // Cross-machine coherence: spec §7.1 — delivered requires emitted invoice.
    const assignment = await ctx.db.get(deliverable.assignmentId);
    if (!assignment) {
      throw new ConvexError({ code: "ASSIGNMENT_NOT_FOUND", message: "Asignación huérfana" });
    }
    assertDeliveredRequiresInvoice(assignment.invoiceStatus as "not_invoiced" | "invoiced" | "paid");

    await ctx.db.patch(args.deliverableId, {
      deliveredAt: Date.now(),
    });

    await ctx.db.patch(deliverable.assignmentId, {
      status: "delivered" as const,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.functions.email.send.sendEmailInternal,
      {
        to: clientEmail,
        subject: `Entregable disponible - ${deliverable.serviceName}`,
        html: `<p>Estimado ${clientName}, su entregable de ${deliverable.serviceName} para ${deliverable.month}/${deliverable.year} esta disponible.</p>`,
      }
    );

    return { success: true, deliverableId: args.deliverableId };
  },
});

// ─── Internal mutations (used by actions) ────────────────────────────

const aiLogValidator = v.array(
  v.object({
    role: v.string(),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    costUsd: v.number(),
    timestamp: v.number(),
  })
);

/**
 * Internal: save a generated deliverable from the AI pipeline.
 *
 * `unfilledKeys` (D1): when non-empty, the deliverable is saved with
 * `auditStatus: "rejected"` and `auditFeedback` set to a JSON string
 * `{"reason":"incomplete_render","unfilledKeys":[...],"costUsd":N}` so the
 * audit UI can surface the partial-render warning.
 */
export const saveGenerated = internalMutation({
  args: {
    orgId: v.string(),
    assignmentId: v.id("monthlyAssignments"),
    projServiceId: v.id("projectionServices"),
    clientId: v.id("clients"),
    serviceName: v.string(),
    subserviceId: v.optional(v.id("subservices")),
    month: v.number(),
    year: v.number(),
    shortContent: v.string(),
    longContent: v.string(),
    aiLog: aiLogValidator,
    unfilledKeys: v.optional(v.array(v.string())),
    costUsd: v.optional(v.number()),
    // A2: snapshot por valor — reproducibilidad histórica aunque la plantilla
    // mute. Per docs/superpowers/specs/2026-05-22-templates-operator-access-design.md §5.
    templateId: v.optional(v.id("deliverableTemplates")),
    templateVersion: v.optional(v.number()),
    templateHtmlSnapshot: v.optional(v.string()),
    // A3: origen del trigger (R1 #5).
    // Per docs/superpowers/specs/2026-05-23-document-lifecycle-design.md §3.3.5
    triggerSource: v.optional(
      v.union(
        v.literal("manual"),
        v.literal("cron"),
        v.literal("invoice_paid"),
        v.literal("api")
      )
    ),
    triggerInvoiceId: v.optional(v.id("invoices")),
  },
  handler: async (ctx, args) => {
    const unfilledKeys = args.unfilledKeys ?? [];
    const auditStatus =
      unfilledKeys.length > 0 ? ("rejected" as const) : ("pending" as const);
    const auditFeedback =
      unfilledKeys.length > 0
        ? JSON.stringify({
            reason: "incomplete_render",
            unfilledKeys,
            costUsd: args.costUsd ?? null,
          })
        : undefined;

    // Idempotency guard: if a deliverable already exists for this assignment,
    // overwrite it (patch) instead of inserting a duplicate.
    const existing = await ctx.db
      .query("deliverables")
      .withIndex("by_assignmentId", (q) => q.eq("assignmentId", args.assignmentId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        orgId: args.orgId,
        projServiceId: args.projServiceId,
        clientId: args.clientId,
        serviceName: args.serviceName,
        subserviceId: args.subserviceId,
        month: args.month,
        year: args.year,
        shortContent: args.shortContent,
        longContent: args.longContent,
        templateId: args.templateId,
        templateVersion: args.templateVersion,
        templateHtmlSnapshot: args.templateHtmlSnapshot,
        triggerSource: args.triggerSource,
        triggerInvoiceId: args.triggerInvoiceId,
        auditStatus,
        auditFeedback,
        aiLog: args.aiLog,
      });
      return existing._id;
    }

    return await ctx.db.insert("deliverables", {
      orgId: args.orgId,
      assignmentId: args.assignmentId,
      projServiceId: args.projServiceId,
      clientId: args.clientId,
      serviceName: args.serviceName,
      subserviceId: args.subserviceId,
      month: args.month,
      year: args.year,
      shortContent: args.shortContent,
      longContent: args.longContent,
      templateId: args.templateId,
      templateVersion: args.templateVersion,
      templateHtmlSnapshot: args.templateHtmlSnapshot,
      triggerSource: args.triggerSource,
      triggerInvoiceId: args.triggerInvoiceId,
      auditStatus,
      auditFeedback,
      retryCount: 0,
      aiLog: args.aiLog,
      createdAt: Date.now(),
    });
  },
});

/**
 * Internal: update audit results from the AI auditor.
 */
export const updateAudit = internalMutation({
  args: {
    id: v.id("deliverables"),
    auditStatus: v.union(
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("corrected")
    ),
    auditFeedback: v.string(),
    aiLog: aiLogValidator,
  },
  handler: async (ctx, args) => {
    const deliverable = await ctx.db.get(args.id);
    if (!deliverable) {
      throw new Error("Entregable no encontrado.");
    }

    const existingLog = deliverable.aiLog ?? [];

    await ctx.db.patch(args.id, {
      auditStatus: args.auditStatus,
      auditFeedback: args.auditFeedback,
      aiLog: [...existingLog, ...args.aiLog],
    });
  },
});

/**
 * Internal: increment retry count for regeneration.
 */
export const incrementRetry = internalMutation({
  args: { id: v.id("deliverables") },
  handler: async (ctx, args) => {
    const deliverable = await ctx.db.get(args.id);
    if (!deliverable) return;
    await ctx.db.patch(args.id, { retryCount: deliverable.retryCount + 1 });
  },
});

/**
 * Internal: update deliverable after AI regeneration.
 */
export const updateAfterRegeneration = internalMutation({
  args: {
    id: v.id("deliverables"),
    shortContent: v.optional(v.string()),
    longContent: v.optional(v.string()),
    auditStatus: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("corrected")
    ),
    auditFeedback: v.string(),
    aiLog: aiLogValidator,
  },
  handler: async (ctx, args) => {
    const deliverable = await ctx.db.get(args.id);
    if (!deliverable) {
      throw new Error("Entregable no encontrado.");
    }

    const existingLog = deliverable.aiLog ?? [];
    const patch: Record<string, unknown> = {
      auditStatus: args.auditStatus,
      auditFeedback: args.auditFeedback,
      aiLog: [...existingLog, ...args.aiLog],
    };

    if (args.shortContent !== undefined) {
      patch.shortContent = args.shortContent;
    }
    if (args.longContent !== undefined) {
      patch.longContent = args.longContent;
    }

    await ctx.db.patch(args.id, patch);
  },
});
