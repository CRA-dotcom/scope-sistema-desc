import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";

const attachmentValidator = v.object({
  storageId: v.id("_storage"),
  filename: v.string(),
  contentType: v.optional(v.string()),
});

export const insertQueued = internalMutation({
  args: {
    orgId: v.string(),
    type: v.union(
      v.literal("quotation"),
      v.literal("quotation_reminder"),
      v.literal("contract"),
      v.literal("contract_reminder"),
      v.literal("deliverable"),
      v.literal("questionnaire"),
      v.literal("reminder"),
      v.literal("custom")
    ),
    fromEmail: v.string(),
    fromName: v.optional(v.string()),
    toEmail: v.string(),
    cc: v.optional(v.array(v.string())),
    bcc: v.optional(v.array(v.string())),
    replyTo: v.optional(v.string()),
    subject: v.string(),
    bodyHtml: v.optional(v.string()),
    bodyText: v.optional(v.string()),
    relatedType: v.optional(
      v.union(
        v.literal("quotation"),
        v.literal("contract"),
        v.literal("deliverable"),
        v.literal("questionnaire"),
        v.literal("assignment")
      )
    ),
    relatedId: v.optional(v.string()),
    clientId: v.optional(v.id("clients")),
    issuingCompanyId: v.optional(v.id("issuingCompanies")),
    attachments: v.optional(v.array(attachmentValidator)),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("emailLog", {
      orgId: args.orgId,
      type: args.type,
      direction: "outbound",
      relatedType: args.relatedType,
      relatedId: args.relatedId,
      clientId: args.clientId,
      issuingCompanyId: args.issuingCompanyId,
      fromEmail: args.fromEmail,
      fromName: args.fromName,
      toEmail: args.toEmail,
      cc: args.cc,
      bcc: args.bcc,
      replyTo: args.replyTo,
      subject: args.subject,
      bodyHtml: args.bodyHtml,
      bodyText: args.bodyText,
      attachments: args.attachments,
      status: "queued",
      provider: "resend",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const markSent = internalMutation({
  args: {
    emailLogId: v.id("emailLog"),
    providerMessageId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.emailLogId, {
      status: "sent",
      providerMessageId: args.providerMessageId,
      sentAt: now,
      updatedAt: now,
    });
  },
});

export const markFailed = internalMutation({
  args: {
    emailLogId: v.id("emailLog"),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.emailLogId, {
      status: "failed",
      errorMessage: args.errorMessage,
      updatedAt: Date.now(),
    });
  },
});

type ResendEventType =
  | "email.sent"
  | "email.delivered"
  | "email.delivery_delayed"
  | "email.opened"
  | "email.clicked"
  | "email.bounced"
  | "email.complained"
  | "email.failed";

const STATUS_RANK: Record<string, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  opened: 3,
  clicked: 4,
};

function mapEventToStatus(
  eventType: string
): "sent" | "delivered" | "opened" | "clicked" | "bounced" | "complained" | "failed" | null {
  switch (eventType) {
    case "email.sent": return "sent";
    case "email.delivered": return "delivered";
    case "email.opened": return "opened";
    case "email.clicked": return "clicked";
    case "email.bounced": return "bounced";
    case "email.complained": return "complained";
    case "email.failed": return "failed";
    case "email.delivery_delayed": return null;
    default: return null;
  }
}

function mapEventTypeToEmailEventsUnion(
  eventType: string
):
  | "sent"
  | "delivered"
  | "delivery_delayed"
  | "opened"
  | "clicked"
  | "bounced"
  | "complained"
  | "failed"
  | null {
  switch (eventType) {
    case "email.sent": return "sent";
    case "email.delivered": return "delivered";
    case "email.delivery_delayed": return "delivery_delayed";
    case "email.opened": return "opened";
    case "email.clicked": return "clicked";
    case "email.bounced": return "bounced";
    case "email.complained": return "complained";
    case "email.failed": return "failed";
    default: return null;
  }
}

export const handleWebhookEvent = internalMutation({
  args: {
    providerMessageId: v.string(),
    event: v.object({
      type: v.string(),
      occurredAt: v.number(),
      metadata: v.any(),
    }),
  },
  handler: async (ctx, args) => {
    const log = await ctx.db
      .query("emailLog")
      .withIndex("by_providerMessageId", (q) =>
        q.eq("providerMessageId", args.providerMessageId)
      )
      .first();
    if (!log) {
      console.warn(
        `[email.handleWebhookEvent] unknown providerMessageId=${args.providerMessageId}`
      );
      return;
    }

    const emailEventType = mapEventTypeToEmailEventsUnion(args.event.type);
    if (!emailEventType) {
      console.warn(
        `[email.handleWebhookEvent] unknown event type=${args.event.type}`
      );
      return;
    }

    const rawMeta = args.event.metadata as Record<string, unknown>;
    const eventMetadata: {
      userAgent?: string;
      ipAddress?: string;
      link?: string;
      bounceType?: string;
      bounceReason?: string;
    } = {};
    if (typeof rawMeta.user_agent === "string") eventMetadata.userAgent = rawMeta.user_agent;
    if (typeof rawMeta.ip === "string") eventMetadata.ipAddress = rawMeta.ip;
    if (typeof rawMeta.link === "string") eventMetadata.link = rawMeta.link;
    if (rawMeta.bounce && typeof rawMeta.bounce === "object") {
      const b = rawMeta.bounce as Record<string, unknown>;
      if (typeof b.type === "string") eventMetadata.bounceType = b.type;
      if (typeof b.message === "string") eventMetadata.bounceReason = b.message;
    }

    await ctx.db.insert("emailEvents", {
      orgId: log.orgId,
      emailLogId: log._id,
      providerMessageId: args.providerMessageId,
      provider: "resend",
      eventType: emailEventType,
      metadata: eventMetadata,
      rawPayload: JSON.stringify(args.event.metadata),
      occurredAt: args.event.occurredAt,
      createdAt: Date.now(),
    });

    const proposedStatus = mapEventToStatus(args.event.type);
    if (!proposedStatus) return;

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    const terminalStatuses = ["bounced", "complained", "failed"];
    if (terminalStatuses.includes(proposedStatus)) {
      patch.status = proposedStatus;
    } else {
      const currentRank = STATUS_RANK[log.status] ?? -1;
      const proposedRank = STATUS_RANK[proposedStatus] ?? -1;
      if (proposedRank > currentRank) {
        patch.status = proposedStatus;
      }
    }

    if (proposedStatus === "delivered") patch.deliveredAt = args.event.occurredAt;
    if (proposedStatus === "opened") patch.openedAt = args.event.occurredAt;
    if (proposedStatus === "clicked") {
      patch.clickedAt = args.event.occurredAt;
      // clicked implies opened — if openedAt is unset, infer it from this event
      if (log.openedAt === undefined) {
        patch.openedAt = args.event.occurredAt;
      }
    }

    await ctx.db.patch(log._id, patch);
  },
});
