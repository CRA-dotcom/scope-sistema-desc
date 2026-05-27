import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";

/**
 * Log a reminder email row + documentEvents entry for a contract reminder.
 * Called from sendContractReminder action after status re-check.
 */
export const logReminder = internalMutation({
  args: {
    contractId: v.id("contracts"),
    level: v.union(v.literal(1), v.literal(2), v.literal(3)),
    isAdminFinal: v.boolean(),
  },
  handler: async (ctx, args) => {
    const c = await ctx.db.get(args.contractId);
    if (!c) return;

    await ctx.db.insert("emailLog", {
      orgId: c.orgId,
      type: "contract_reminder",
      direction: "outbound",
      relatedType: "contract",
      relatedId: args.contractId,
      clientId: c.clientId,
      fromEmail:
        process.env.RESEND_FROM_EMAIL ?? "noreply@businessinteligencehub.com",
      toEmail: args.isAdminFinal
        ? (process.env.OPS_NOTIFICATION_EMAIL ?? "christiancover81@gmail.com")
        : "TBD-client-email",
      subject: args.isAdminFinal
        ? `Considera cancelar contrato no firmado: ${c.serviceName}`
        : `Recordatorio: firma tu contrato ${c.serviceName}`,
      bodyHtml: `<p>Reminder level ${args.level}. SignUrl: <a href="${c.firmameSignUrl ?? "#"}">${c.firmameSignUrl ?? "N/A"}</a></p>`,
      status: "queued",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await ctx.db.insert("documentEvents", {
      orgId: c.orgId,
      clientId: c.clientId,
      entityType: "contract",
      entityId: args.contractId,
      eventType: "reminder_sent",
      severity: "info",
      actorType: "cron",
      message: `Reminder level ${args.level} queued`,
      createdAt: Date.now(),
    });
  },
});
