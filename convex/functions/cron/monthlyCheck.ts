import { internalAction, internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";

/**
 * Internal query: active projections for a single org.
 */
export const listActiveProjectionsByOrg = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, args) => {
    const projections = await ctx.db
      .query("projections")
      .withIndex("by_orgId_status", (q) =>
        q.eq("orgId", args.orgId).eq("status", "active")
      )
      .collect();
    return projections.map((p) => ({
      _id: p._id,
      orgId: p.orgId,
      clientId: p.clientId,
      year: p.year,
    }));
  },
});

/**
 * Internal query: assignments for a specific (org, month, year).
 */
export const listAssignmentsForMonthByOrg = internalQuery({
  args: { orgId: v.string(), month: v.number(), year: v.number() },
  handler: async (ctx, args) => {
    const assignments = await ctx.db
      .query("monthlyAssignments")
      .withIndex("by_orgId_year_month", (q) =>
        q.eq("orgId", args.orgId).eq("year", args.year).eq("month", args.month)
      )
      .collect();
    return assignments.map((a) => ({
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
      contactEmail?: string;
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
            contactEmail: client.contactEmail,
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

    const orgIds = await ctx.runQuery(
      internal.functions.cron.overdueCheck.listOrgIds
    );
    const activeProjections: Array<{ _id: any; orgId: string; clientId: any; year: number }> = [];
    const dueThisMonth: Array<{ orgId: string; projectionId: any; serviceName: string; status: string; clientId: any }> = [];
    for (const orgId of orgIds) {
      const orgProjs = await ctx.runQuery(
        internal.functions.cron.monthlyCheck.listActiveProjectionsByOrg,
        { orgId }
      );
      activeProjections.push(...orgProjs);
      const orgAssigns = await ctx.runQuery(
        internal.functions.cron.monthlyCheck.listAssignmentsForMonthByOrg,
        { orgId, month: currentMonth, year: currentYear }
      );
      dueThisMonth.push(...orgAssigns);
    }

    // Filter to projections for the current year
    const relevantProjections = activeProjections.filter(
      (p: { year: number }) => p.year === currentYear
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

      let sent = 0;
      let skipped = 0;
      for (const pq of pendingQuestionnaires) {
        if (!pq.contactEmail) {
          skipped += 1;
          continue;
        }
        await ctx.scheduler.runAfter(
          0,
          internal.functions.email.send.sendEmailInternal,
          {
            to: pq.contactEmail,
            subject: `Recordatorio: Cuestionario pendiente - ${pq.serviceName}`,
            html: `<p>Estimado ${pq.clientName}, le recordamos que su cuestionario de ${pq.serviceName} para ${currentMonth}/${currentYear} está pendiente.</p>`,
          }
        );
        sent += 1;
      }

      if (skipped > 0) {
        console.warn(
          `[monthlyCheck] ${skipped} recordatorio(s) omitido(s): cliente sin ` +
            `contactEmail.`
        );
      }
      console.log(
        `[monthlyCheck] Sent ${sent} questionnaire reminder emails`
      );
    }

    return summary;
  },
});
