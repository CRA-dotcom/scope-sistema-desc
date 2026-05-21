"use node";

import { action } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Resend } from "resend";

/**
 * D2 §3.4 — `sendTestNotification`
 *
 * Sends a test email to the org's configured `notificationEmail`. Beta
 * stub: reuses the legacy `RESEND_API_KEY` env-var sender when present
 * (mirrors `convex/functions/email/send.ts:sendEmailHandler`); if neither
 * the env var nor org-scoped Resend config is set, returns a graceful
 * `{ sent: false, reason }` so the UI can show an actionable toast.
 *
 * If A3 ships `internal.functions.email.actions.sendTestToOrgNotificationEmail`
 * later, swap this body for a single `ctx.runAction(...)` call.
 */
export const sendTestNotification = action({
  args: {},
  handler: async (
    ctx
  ): Promise<{ sent: boolean; reason?: string; messageId?: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("No autenticado. Inicia sesión para continuar.");
    }
    const role = (identity.orgRole as string) ?? "org:member";
    if (role !== "org:admin") {
      throw new Error("Acceso denegado. Se requiere rol de Administrador.");
    }
    const orgId = (identity.orgId ??
      (identity as Record<string, unknown>).org_id) as string | undefined;
    if (!orgId) {
      throw new Error(
        "No se encontró la organización. Selecciona una organización."
      );
    }

    const config = await ctx.runQuery(
      internal.functions.orgConfigs.internalQueries.getNotificationEmail,
      { orgId }
    );
    if (!config?.notificationEmail) {
      throw new Error(
        "No hay email destino configurado. Guarda primero un notificationEmail."
      );
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return {
        sent: false,
        reason:
          "RESEND_API_KEY no configurado. Configura Resend en Integraciones primero.",
      };
    }
    const fromEmail = process.env.RESEND_FROM_EMAIL;
    if (!fromEmail) {
      return {
        sent: false,
        reason:
          "RESEND_FROM_EMAIL no configurado. Configura Resend en Integraciones primero.",
      };
    }
    const fromName = process.env.RESEND_FROM_NAME;
    const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;

    try {
      const resend = new Resend(apiKey);
      const { data, error } = await resend.emails.send({
        from,
        to: config.notificationEmail,
        subject: "Projex · Email de prueba",
        html: `<p>Esto es un email de prueba de tu configuración de notificaciones en Projex.</p>
<p>Si lo recibiste, tu email destino está bien configurado.</p>
<p><small>orgId: ${orgId}</small></p>`,
      });
      if (error) {
        return { sent: false, reason: error.message };
      }
      return { sent: true, messageId: data?.id };
    } catch (err) {
      return {
        sent: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  },
});
