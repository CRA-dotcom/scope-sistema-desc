import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";

// Cap 1 reminder email per client per 24h. The lookback window used when
// querying `documentEvents` for an existing `reminder_sent`.
const REMINDER_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/**
 * A3 — Daily eligibility scan.
 *
 * Runs once at 13:00 UTC (≈07:00 CDMX). For each active org:
 *  1. Resolve `today` in the org's local timezone (default UTC).
 *  2. Skip Sat/Sun in the org's local tz.
 *  3. For each active client / projection service:
 *     - Run `selectDeliverableForMonth` for today (year, month).
 *     - Skip if no template applies for that subservice this month.
 *     - Skip if a deliverable already exists for (clientId, subservice, month, year).
 *     - Skip if an invoice for the same month is already paid (operator already
 *       triggered generation).
 *     - Skip if we already emailed this client in the last 24h.
 *     - Otherwise: schedule a reminder email + log `reminder_sent`.
 *
 * Decision #9 (hard-coded): this cron NEVER calls `generate*` — only reminders.
 *
 * Per docs/superpowers/specs/2026-05-23-document-lifecycle-design.md §3.4
 */

function getLocalToday(timezoneIANA: string | undefined): {
  year: number;
  month: number;
  day: number;
  weekday: string;
} {
  const tz = timezoneIANA ?? "UTC";
  const now = new Date();
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
    });
    const parts = fmt.formatToParts(now);
    const year = Number(parts.find((p) => p.type === "year")?.value);
    const month = Number(parts.find((p) => p.type === "month")?.value);
    const day = Number(parts.find((p) => p.type === "day")?.value);
    const weekday =
      parts.find((p) => p.type === "weekday")?.value ?? "Mon";
    return { year, month, day, weekday };
  } catch {
    // Invalid timezone string → fall back to UTC.
    return {
      year: now.getUTCFullYear(),
      month: now.getUTCMonth() + 1,
      day: now.getUTCDate(),
      weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
        now.getUTCDay()
      ],
    };
  }
}

export const run = internalAction({
  args: {},
  handler: async (
    ctx
  ): Promise<{
    totalReminders: number;
    totalSkipped: number;
    orgsScanned: number;
  }> => {
    const orgs = await ctx.runQuery(
      internal.functions.cron.eligibilityHelpers.listActiveOrgs,
      {}
    );

    let totalReminders = 0;
    let totalSkipped = 0;

    for (const org of orgs) {
      const orgConfig = await ctx.runQuery(
        internal.functions.cron.eligibilityHelpers.getOrgConfig,
        { orgId: org.orgId }
      );
      const tz = orgConfig?.timezone;
      const today = getLocalToday(tz);

      // Skip Sat/Sun in org-local tz (R1 §12 hard-coded for beta).
      if (today.weekday === "Sat" || today.weekday === "Sun") continue;

      const clients = await ctx.runQuery(
        internal.functions.cron.eligibilityHelpers.listActiveClients,
        { orgId: org.orgId }
      );

      for (const client of clients) {
        const projServices = await ctx.runQuery(
          internal.functions.cron.eligibilityHelpers.listProjServicesForClient,
          { orgId: org.orgId, clientId: client._id, year: today.year }
        );

        for (const ps of projServices) {
          const projection = await ctx.runQuery(
            internal.functions.deliverables.internalQueries
              .getProjectionByProjService,
            { projectionId: ps.projectionId as Id<"projections"> }
          );
          if (!projection) continue;

          const selected = await ctx.runQuery(
            internal.functions.deliverables.internalQueries
              .selectDeliverableForMonth,
            {
              orgId: org.orgId,
              clientId: client._id,
              subserviceId: ps.subserviceId as
                | Id<"subservices">
                | undefined,
              serviceId: ps.serviceId as Id<"services">,
              serviceName: ps.serviceName,
              // B1: include projServiceId so the selector enforces the
              // [startMonth, endMonth] window for mid-year add-ons.
              projServiceId: ps._id as Id<"projectionServices">,
              month: today.month,
              year: today.year,
              projectionMode: projection.projectionMode ?? "rolling",
              templateType: "deliverable_short" as const,
            }
          );
          if (!selected) continue;

          const existingDeliverable = await ctx.runQuery(
            internal.functions.deliverables.internalQueries
              .findDeliverableForMonth,
            {
              clientId: client._id,
              subserviceId: ps.subserviceId as
                | Id<"subservices">
                | undefined,
              serviceName: ps.serviceName,
              year: today.year,
              month: today.month,
            }
          );
          if (existingDeliverable) continue;

          const existingPaidInvoice = await ctx.runQuery(
            internal.functions.cron.eligibilityHelpers
              .findPaidInvoiceForMonth,
            {
              orgId: org.orgId,
              clientId: client._id,
              subserviceId: ps.subserviceId as
                | Id<"subservices">
                | undefined,
              year: today.year,
              month: today.month,
            }
          );
          if (existingPaidInvoice) continue;

          // Cap 1 email/client/day.
          const recentReminder = await ctx.runQuery(
            internal.functions.cron.eligibilityHelpers.findRecentReminder,
            {
              orgId: org.orgId,
              clientId: client._id,
              sinceMs: Date.now() - REMINDER_LOOKBACK_MS,
            }
          );
          if (recentReminder) {
            totalSkipped += 1;
            continue;
          }

          await ctx.scheduler.runAfter(
            0,
            internal.functions.cron.eligibilityHelpers.sendReminderEmail,
            {
              orgId: org.orgId,
              clientId: client._id,
              subserviceName: ps.serviceName,
              month: today.month,
              year: today.year,
            }
          );

          await ctx.runMutation(
            internal.functions.documentEvents.internal.logEventMutation,
            {
              orgId: org.orgId,
              clientId: client._id,
              entityType: "deliverable" as const,
              entityId: `eligibility:${ps._id}:${today.year}-${today.month}`,
              eventType: "reminder_sent" as const,
              severity: "info" as const,
              actorType: "cron" as const,
              message: `Recordatorio: toca subir factura de ${ps.serviceName} para ${client.name}, mes ${today.month}/${today.year}.`,
              metadata: {
                projServiceId: ps._id,
                subserviceId: ps.subserviceId,
                month: today.month,
                year: today.year,
              },
            }
          );
          totalReminders += 1;
        }
      }
    }

    return { totalReminders, totalSkipped, orgsScanned: orgs.length };
  },
});
