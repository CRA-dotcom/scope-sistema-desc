import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";

/**
 * A3 — Append-only document lifecycle event wrapper.
 *
 * Invoked from:
 * - `invoices.actions.upload` (uploaded)
 * - `invoices.mutations.markSent` (sent)
 * - `invoices.mutations.markPaid` (paid)
 * - `invoices.mutations.markVoid` (voided)
 * - `deliverables.invoiceFlow.generateFromInvoice` (generated / error)
 * - `cron.deliverableEligibility.run` (reminder_sent)
 * - (future) `subservices.mutations.*`, `templates.mutations.*`
 *
 * Per docs/superpowers/specs/2026-05-23-document-lifecycle-design.md §3.5
 */

const eventTypeUnion = v.union(
  v.literal("created"),
  v.literal("updated"),
  v.literal("sent"),
  v.literal("signed"),
  v.literal("paid"),
  v.literal("generated"),
  v.literal("audited"),
  v.literal("deleted"),
  v.literal("personalized"),
  v.literal("restored"),
  v.literal("reminder_sent"),
  v.literal("uploaded"),
  v.literal("voided"),
  v.literal("error")
);

const severityUnion = v.union(
  v.literal("info"),
  v.literal("warning"),
  v.literal("error")
);

const entityTypeUnion = v.union(
  v.literal("deliverable"),
  v.literal("invoice"),
  v.literal("quotation"),
  v.literal("contract"),
  v.literal("template"),
  v.literal("subservice"),
  v.literal("questionnaire")
);

const actorTypeUnion = v.union(
  v.literal("user"),
  v.literal("cron"),
  v.literal("system"),
  v.literal("client_link")
);

export const logEventMutation = internalMutation({
  args: {
    orgId: v.string(),
    clientId: v.optional(v.id("clients")),
    entityType: entityTypeUnion,
    entityId: v.string(),
    eventType: eventTypeUnion,
    severity: v.optional(severityUnion),
    actorUserId: v.optional(v.string()),
    actorType: actorTypeUnion,
    message: v.string(),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("documentEvents", {
      orgId: args.orgId,
      clientId: args.clientId,
      entityType: args.entityType,
      entityId: args.entityId,
      eventType: args.eventType,
      severity: args.severity ?? "info",
      actorUserId: args.actorUserId,
      actorType: args.actorType,
      message: args.message,
      metadata: args.metadata,
      createdAt: Date.now(),
    });
  },
});
