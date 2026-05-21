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

// A3: Daily eligibility scan. NEVER generates (R1 §12.9), only sends
// reminders to operators about pending invoices for the current month.
crons.daily(
  "deliverable-eligibility-scan",
  { hourUTC: 13, minuteUTC: 0 },
  internal.functions.cron.deliverableEligibility.run,
  {},
);

export default crons;
