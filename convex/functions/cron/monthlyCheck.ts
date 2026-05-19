import { internalAction, internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";

/**
 * Internal query: fetch all active projections (system-level, no auth).
 */
export const listActiveProjections = internalQuery({
  args: {},
  handler: async (ctx) => {
    const projections = await ctx.db.query("projections").collect();
    return projections
      .filter((p) => p.status === "active")
      .map((p) => ({
        _id: p._id,
        orgId: p.orgId,
        clientId: p.clientId,
        year: p.year,
      }));
  },
});

/**
 * Internal query: fetch assignments for a specific month/year (system-level).
 */
export const listAssignmentsForMonth = internalQuery({
  args: { month: v.number(), year: v.number() },
  handler: async (ctx, args) => {
    const assignments = await ctx.db.query("monthlyAssignments").collect();
    return assignments
      .filter((a) => a.month === args.month && a.year === args.year)
      .map((a) => ({
        orgId: a.orgId,
        projectionId: a.projectionId,
        serviceName: a.serviceName,
        status: a.status,
        clientId: a.clientId,
      }));
  },
});

/**
 * Internal query: fetch questionnaires pending for given client/projection pairs.
 */
export const listPendingQuestionnaires = internalQuery({
  args: {
    clientProjectionPairs: v.array(
      v.object({
        clientId: v.id("clients"),
        projectionId: v.id("projections"),
        serviceName: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const results: Array<{
      clientId: string;
      clientName: string;
      serviceName: string;
    }> = [];

    for (const pair of args.clientProjectionPairs) {
      // Check if questionnaire exists and is still draft/sent
      const questionnaires = await ctx.db
        .query("questionnaireResponses")
        .withIndex("by_clientId", (q) => q.eq("clientId", pair.clientId))
        .collect();

      const pending = questionnaires.find(
        (qr) =>
          qr.projectionId === pair.projectionId &&
          (qr.status === "draft" || qr.status === "sent")
      );

      if (pending) {
        const client = await ctx.db.get(pair.clientId);
        if (client) {
          results.push({
            clientId: client._id,
            clientName: client.name,
            serviceName: pair.serviceName,
          });
        }
      }
    }

    return results;
  },
});

/**
 * Monthly cron action: review active projections and assignments due this month.
 * Runs on the 1st of each month.
 */
export const run: ReturnType<typeof internalAction> = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const activeProjections = await ctx.runQuery(
      internal.functions.cron.monthlyCheck.listActiveProjections
    );

    // Filter to projections for the current year
    const relevantProjections = activeProjections.filter(
      (p: { year: number }) => p.year === currentYear
    );

    const dueThisMonth = await ctx.runQuery(
      internal.functions.cron.monthlyCheck.listAssignmentsForMonth,
      { month: currentMonth, year: currentYear }
    );

    // Group by orgId
    const byOrg: Record<string, { total: number; pending: number }> = {};
    for (const a of dueThisMonth) {
      if (!byOrg[a.orgId]) {
        byOrg[a.orgId] = { total: 0, pending: 0 };
      }
      byOrg[a.orgId].total += 1;
      if (a.status === "pending") {
        byOrg[a.orgId].pending += 1;
      }
    }

    const summary = {
      timestamp: now.toISOString(),
      month: currentMonth,
      year: currentYear,
      activeProjections: relevantProjections.length,
      assignmentsDueThisMonth: dueThisMonth.length,
      byOrg,
    };

    console.log(
      `[monthlyCheck] Month ${currentMonth}/${currentYear}: ${relevantProjections.length} active projections, ${dueThisMonth.length} assignments due`,
      summary
    );

    // Build client/projection pairs for pending questionnaire check
    const clientProjectionPairs = dueThisMonth.map(
      (a: { clientId: any; projectionId: any; serviceName: string }) => ({
        clientId: a.clientId,
        projectionId: a.projectionId,
        serviceName: a.serviceName,
      })
    );

    if (clientProjectionPairs.length > 0) {
      const pendingQuestionnaires = await ctx.runQuery(
        internal.functions.cron.monthlyCheck.listPendingQuestionnaires,
        { clientProjectionPairs }
      );

      // TODO(feature): resolver el email real del cliente desde
      // Clerk/contactos. Hasta entonces estos recordatorios NO se envían
      // (antes iban a un dominio placeholder ajeno — fuga de datos).
      const clientReminderTo = process.env.OPS_NOTIFICATION_EMAIL;
      if (!clientReminderTo) {
        console.warn(
          `[monthlyCheck] Sin resolución de email de cliente; ` +
            `omitiendo ${pendingQuestionnaires.length} recordatorios de cuestionario.`
        );
      } else {
        // Send reminder email for each pending questionnaire
        for (const pq of pendingQuestionnaires) {
          await ctx.scheduler.runAfter(
            0,
            internal.functions.email.send.sendEmailInternal,
            {
              to: clientReminderTo,
              subject: `Recordatorio: Cuestionario pendiente - ${pq.serviceName}`,
              html: `<p>Estimado ${pq.clientName}, le recordamos que su cuestionario de ${pq.serviceName} para ${currentMonth}/${currentYear} está pendiente.</p>`,
            }
          );
        }

        console.log(
          `[monthlyCheck] Sent ${pendingQuestionnaires.length} questionnaire reminder emails`
        );
      }
    }

    return summary;
  },
});
