"use node";

import { action, internalAction } from "../../_generated/server";
import { internal, api } from "../../_generated/api";
import { v } from "convex/values";
import { Resend } from "resend";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENTS_BYTES = 25 * 1024 * 1024;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// --- Legacy sendEmailHandler, kept intact ---
async function sendEmailHandler(args: {
  to: string;
  subject: string;
  html: string;
  from?: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("RESEND_API_KEY not set, skipping email");
    return { sent: false, reason: "no_api_key" };
  }
  const resend = new Resend(apiKey);
  let from = args.from;
  if (!from) {
    const fromEmail = process.env.RESEND_FROM_EMAIL;
    if (!fromEmail) {
      // Never send from an unowned domain — fail instead.
      console.warn("RESEND_FROM_EMAIL not set, skipping email");
      return { sent: false, reason: "no_from_email" };
    }
    const fromName = process.env.RESEND_FROM_NAME;
    from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
  }
  try {
    const { data, error } = await resend.emails.send({
      from,
      to: args.to,
      subject: args.subject,
      html: args.html,
    });
    if (error) {
      console.error("Email send error:", error);
      return { sent: false, reason: error.message };
    }
    return { sent: true, id: data?.id };
  } catch (err) {
    console.error("Email send exception:", err);
    return { sent: false, reason: String(err) };
  }
}

const legacyEmailArgs = {
  to: v.string(),
  subject: v.string(),
  html: v.string(),
  from: v.optional(v.string()),
};

export const sendEmailInternal = internalAction({
  args: legacyEmailArgs,
  handler: async (_ctx, args) => {
    return await sendEmailHandler(args);
  },
});

// --- NEW sendEmail action with logging + per-org config ---
const attachmentInputValidator = v.object({
  storageId: v.id("_storage"),
  filename: v.string(),
  contentType: v.optional(v.string()),
});

export const sendEmail = action({
  args: {
    to: v.string(),
    subject: v.string(),
    bodyHtml: v.string(),
    bodyText: v.optional(v.string()),
    cc: v.optional(v.array(v.string())),
    bcc: v.optional(v.array(v.string())),
    replyTo: v.optional(v.string()),
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
    attachmentStorageIds: v.optional(v.array(attachmentInputValidator)),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; emailLogId?: string; providerMessageId?: string; errorMessage?: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("No autenticado");
    const orgId = (identity.orgId ??
      (identity as Record<string, unknown>).org_id) as string | undefined;
    if (!orgId) throw new Error("Sin organización");

    if (!EMAIL_REGEX.test(args.to)) throw new Error(`Email inválido: ${args.to}`);
    for (const addr of args.cc ?? []) {
      if (!EMAIL_REGEX.test(addr)) throw new Error(`CC inválido: ${addr}`);
    }
    for (const addr of args.bcc ?? []) {
      if (!EMAIL_REGEX.test(addr)) throw new Error(`BCC inválido: ${addr}`);
    }
    if (args.replyTo && !EMAIL_REGEX.test(args.replyTo)) {
      throw new Error(`Reply-To inválido: ${args.replyTo}`);
    }

    const role = (identity.orgRole as string) ?? "org:member";
    if (role === "org:member" && args.clientId) {
      const isAssigned = await ctx.runQuery(
        internal.functions.email.internalQueries.isClientAssignedToUser,
        { clientId: args.clientId, userId: identity.subject }
      );
      if (!isAssigned) throw new Error("Cliente no asignado a este ejecutivo");
    }

    const config = await ctx.runQuery(
      internal.functions.email.resolveConfig.resolveResendCredentialsQuery,
      { orgId }
    );

    const emailLogId = await ctx.runMutation(
      internal.functions.email.internalMutations.insertQueued,
      {
        orgId,
        type: args.type,
        fromEmail: config.fromEmail,
        fromName: config.fromName,
        toEmail: args.to,
        cc: args.cc,
        bcc: args.bcc,
        replyTo: args.replyTo,
        subject: args.subject,
        bodyHtml: args.bodyHtml,
        bodyText: args.bodyText,
        relatedType: args.relatedType,
        relatedId: args.relatedId,
        clientId: args.clientId,
        issuingCompanyId: args.issuingCompanyId,
        attachments: (args.attachmentStorageIds ?? []).map((a) => ({
          storageId: a.storageId,
          filename: a.filename,
          contentType: a.contentType,
        })),
      }
    );

    try {
      const attachments: Array<{ filename: string; content: string }> = [];
      let totalSize = 0;
      for (const att of args.attachmentStorageIds ?? []) {
        const blob = await ctx.storage.get(att.storageId);
        if (!blob) {
          throw new Error(`Attachment ${att.filename} no encontrado en storage`);
        }
        if (blob.size > MAX_ATTACHMENT_BYTES) {
          throw new Error(`Attachment ${att.filename} excede 10MB`);
        }
        totalSize += blob.size;
        if (totalSize > MAX_TOTAL_ATTACHMENTS_BYTES) {
          throw new Error(`Attachments totales exceden 25MB`);
        }
        const buffer = await blob.arrayBuffer();
        attachments.push({
          filename: att.filename,
          content: Buffer.from(buffer).toString("base64"),
        });
      }

      const resend = new Resend(config.apiKey);
      const fromHeader = config.fromName
        ? `${config.fromName} <${config.fromEmail}>`
        : config.fromEmail;
      const { data, error } = await resend.emails.send({
        from: fromHeader,
        to: args.to,
        subject: args.subject,
        html: args.bodyHtml,
        text: args.bodyText,
        cc: args.cc,
        bcc: args.bcc,
        replyTo: args.replyTo,
        attachments: attachments.length ? attachments : undefined,
        tags: [{ name: "orgId", value: orgId }],
      });

      if (error) {
        await ctx.runMutation(
          internal.functions.email.internalMutations.markFailed,
          { emailLogId, errorMessage: error.message }
        );
        return { ok: false as const, emailLogId, errorMessage: error.message };
      }

      await ctx.runMutation(
        internal.functions.email.internalMutations.markSent,
        { emailLogId, providerMessageId: data!.id }
      );
      return {
        ok: true as const,
        emailLogId,
        providerMessageId: data!.id,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(
        internal.functions.email.internalMutations.markFailed,
        { emailLogId, errorMessage }
      );
      return { ok: false as const, emailLogId, errorMessage };
    }
  },
});

export const testResendConnection = action({
  args: { apiKey: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("No autenticado");
    const role = (identity.orgRole as string) ?? "org:member";
    if (role !== "org:admin") {
      throw new Error("Acceso denegado. Se requiere rol de Administrador.");
    }

    try {
      const resend = new Resend(args.apiKey);
      const result = await resend.domains.list();
      if (result.error) {
        return { ok: false as const, error: result.error.message };
      }
      return { ok: true as const };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { ok: false as const, error };
    }
  },
});

export const resendFromLog = action({
  args: { id: v.id("emailLog") },
  handler: async (ctx, args): Promise<{ ok: boolean; emailLogId?: string; providerMessageId?: string; errorMessage?: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("No autenticado");
    const role = (identity.orgRole as string) ?? "org:member";
    if (role !== "org:admin") {
      throw new Error("Acceso denegado. Se requiere rol de Administrador.");
    }
    const orgId = (identity.orgId ??
      (identity as Record<string, unknown>).org_id) as string | undefined;
    if (!orgId) throw new Error("Sin organización");

    const original = await ctx.runQuery(
      internal.functions.email.internalQueries.getByIdForResend,
      { id: args.id, orgId }
    );
    if (!original) throw new Error("Email no encontrado");

    return await ctx.runAction(api.functions.email.send.sendEmail, {
      to: original.toEmail,
      subject: original.subject,
      bodyHtml: original.bodyHtml ?? "",
      bodyText: original.bodyText,
      cc: original.cc,
      bcc: original.bcc,
      replyTo: original.replyTo,
      type: original.type,
      relatedType: original.relatedType,
      relatedId: original.relatedId,
      clientId: original.clientId,
      issuingCompanyId: original.issuingCompanyId,
      attachmentStorageIds: original.attachments?.map((a: any) => ({
        storageId: a.storageId,
        filename: a.filename,
        contentType: a.contentType,
      })),
    });
  },
});
