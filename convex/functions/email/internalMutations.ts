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
