import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Daily overdue check for projection deliverables.
crons.daily(
  "overdue-check",
  { hourUTC: 14, minuteUTC: 0 },
  internal.functions.cron.overdueCheck.run,
  {},
);

// Monthly review on day 1 of each month.
crons.monthly(
  "monthly-review",
  { day: 1, hourUTC: 14, minuteUTC: 0 },
  internal.functions.cron.monthlyCheck.run,
  {},
);

// C5: Daily check for fiscal projections that just closed.
// Notifies the assigned Ejecutivo to create a 12-month continuation projection.
crons.daily(
  "notify fiscal close events",
  { hourUTC: 6, minuteUTC: 0 },
  internal.functions.projections.cron.notifyFiscalCloseEvents,
);

export default crons;
