"use node";

import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";
import { signedDownloadUrl } from "../../lib/blobStorage";

/**
 * A3 — Email side-effects spawned from invoice flows. Both honour the
 * notification recipient resolution spec (2026-05-19):
 *  - Client emails resolve via `clients.contactEmail`.
 *  - Operator emails resolve via `resolveOrgNotificationEmail` with env fallback.
 *
 * Per docs/superpowers/specs/2026-05-23-document-lifecycle-design.md §3.1.1
 */

type EmailResult = {
  sent: boolean;
  reason?: string;
  id?: string;
};

export const notifyClientUploaded = internalAction({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args): Promise<EmailResult> => {
    const inv = await ctx.runQuery(
      internal.functions.invoices.internalQueries.getInvoiceForGeneration,
      { invoiceId: args.invoiceId }
    );
    if (!inv) return { sent: false, reason: "invoice_not_found" };

    const client = await ctx.runQuery(
      internal.functions.invoices.internalQueries.getClientForOrg,
      { clientId: inv.clientId, orgId: inv.orgId }
    );
    const contactEmail = client?.contactEmail?.trim();
    if (!contactEmail) {
      console.warn(
        `[notifyClientUploaded] no contactEmail for client ${inv.clientId} — skip`
      );
      await ctx.runMutation(
        internal.functions.documentEvents.internal.logEventMutation,
        {
          orgId: inv.orgId,
          clientId: inv.clientId,
          entityType: "invoice" as const,
          entityId: args.invoiceId,
          eventType: "sent" as const,
          severity: "info" as const,
          actorType: "system" as const,
          message:
            "Cliente sin contactEmail — notificación de factura no enviada.",
        }
      );
      return { sent: false, reason: "no_contact_email" };
    }

    let url: string;
    try {
      url = await signedDownloadUrl({
        bucketKey: inv.bucketKey,
        expiresSec: 60 * 60 * 24 * 7,
      });
    } catch (err) {
      console.error("[notifyClientUploaded] signed URL failed:", err);
      return { sent: false, reason: "signed_url_failed" };
    }

    const subject = `Nueva factura disponible — ${inv.serviceName} ${inv.month}/${inv.year}`;
    const html = `<p>Hola ${client?.name ?? ""},</p>
<p>Hemos subido tu factura de ${inv.serviceName} para ${inv.month}/${inv.year} por $${inv.amount.toLocaleString("es-MX")} MXN.</p>
<p><a href="${url}">Descargar factura (PDF)</a></p>`;

    const result = (await ctx.runAction(
      internal.functions.email.send.sendEmailInternal,
      { to: contactEmail, subject, html }
    )) as EmailResult;
    return result;
  },
});

export const notifyOperatorNoTemplate = internalAction({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args): Promise<EmailResult> => {
    const inv = await ctx.runQuery(
      internal.functions.invoices.internalQueries.getInvoiceForGeneration,
      { invoiceId: args.invoiceId }
    );
    if (!inv) return { sent: false, reason: "invoice_not_found" };

    const recipient: string | null = await ctx.runQuery(
      internal.functions.email.resolveRecipients.resolveOrgNotificationEmail,
      { orgId: inv.orgId }
    );
    if (!recipient) {
      console.warn(
        `[notifyOperatorNoTemplate] no notificationEmail for org ${inv.orgId} — skip`
      );
      return { sent: false, reason: "no_org_notification_email" };
    }

    const subject = `Factura pagada pero sin plantilla — ${inv.serviceName} ${inv.month}/${inv.year}`;
    const html = `<p>La factura ${inv.filename} (${inv.serviceName}) está marcada pagada para ${inv.month}/${inv.year}, pero no existe una plantilla aplicable.</p>
<p>Por favor configura la plantilla en /platform/templates o genera el entregable manualmente.</p>`;

    const result = (await ctx.runAction(
      internal.functions.email.send.sendEmailInternal,
      { to: recipient, subject, html }
    )) as EmailResult;
    return result;
  },
});
