import { internalMutation } from "../../_generated/server";
import { resolveProjectionContext } from "../../lib/projectionContext";

/**
 * C5: Daily cron handler — checks for fiscal projections whose endMonth
 * equals the month that just ended and inserts a notification for the
 * assigned Ejecutivo (or org-wide if no assignee is set on the client).
 *
 * Idempotency: skips projections that already have a "fiscal_close"
 * notification, so running the cron more than once on the same day is safe.
 *
 * The cron is registered (commented) in convex/crons.ts and will be
 * activated on deploy when Christian re-enables crons per MOC blocker.
 */
export const notifyFiscalCloseEvents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = new Date();

    // Compute the month that just ended (1-indexed, with year wrap for January).
    // Example: if today is Feb 1, prevMonth = 1 (January), prevYear = current year.
    // Example: if today is Jan 1, prevMonth = 12 (December), prevYear = current year - 1.
    let prevMonth = now.getMonth(); // getMonth() is 0-indexed, so Jan → 0 means prev = Dec of prev year
    let prevYear = now.getFullYear();
    if (prevMonth === 0) {
      prevMonth = 12;
      prevYear -= 1;
    }
    // prevMonth is now 1-indexed (1..12)

    // Scan all projections across all orgs (system-level cron, no auth context).
    const projections = await ctx.db.query("projections").collect();
    let notified = 0;

    for (const p of projections) {
      const pctx = resolveProjectionContext(p);

      // Only act on fiscal projections whose period just ended.
      if (
        pctx.projectionMode !== "fiscal" ||
        pctx.endMonth !== prevMonth ||
        pctx.endYear !== prevYear
      ) {
        continue;
      }

      // Idempotency guard: skip if notification already created for this projection.
      const existing = await ctx.db
        .query("notifications")
        .withIndex("by_orgId", (q) => q.eq("orgId", p.orgId))
        .filter((q) =>
          q.and(
            q.eq(q.field("relatedProjectionId"), p._id),
            q.eq(q.field("type"), "fiscal_close")
          )
        )
        .first();

      if (existing) continue;

      // Resolve client name and assignee.
      const client = await ctx.db.get(p.clientId);
      const clientName = client?.name ?? "(cliente desconocido)";
      // Use the client's assignedTo as the target ejecutivo
      // (projections don't carry their own assignedTo field).
      const assignedTo = client?.assignedTo;

      await ctx.db.insert("notifications", {
        orgId: p.orgId,
        assignedTo,
        type: "fiscal_close",
        message: `${clientName}: cerró proyección fiscal. Crear nueva proyección 12 meses`,
        relatedProjectionId: p._id,
        relatedClientId: p.clientId,
        createdAt: Date.now(),
      });

      notified++;
    }

    console.log(
      `[notifyFiscalCloseEvents] prevMonth=${prevMonth}/${prevYear} — notified=${notified} projections`
    );

    return { notified, prevMonth, prevYear };
  },
});
