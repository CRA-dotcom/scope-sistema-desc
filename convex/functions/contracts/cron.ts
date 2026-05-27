import { internalMutation, internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";

const DAY_MS = 24 * 3600 * 1000;

/**
 * contractRemindersTick — internal mutation run by daily cron.
 *
 * Scans all contracts with status='sent' and applies the 3/7/14-day
 * reminder ladder:
 *   count=0 + daysSent >= 3  → level 1 reminder
 *   count=1 + daysSent >= 7  + daysSinceLastReminder >= 3 → level 2
 *   count=2 + daysSent >= 14 + daysSinceLastReminder >= 7 → level 3 (admin)
 *   count=3 → skip (max reached)
 *
 * For each eligible contract: increments reminderCount, sets lastReminderAt,
 * and schedules a sendContractReminder action.
 *
 * Returns { scheduled: number }.
 */
export const contractRemindersTick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Collect all sent contracts. For real scale, paginate with by_orgId_status index.
    const sentContracts = await ctx.db
      .query("contracts")
      .filter((q) => q.eq(q.field("status"), "sent"))
      .collect();

    let scheduled = 0;

    for (const c of sentContracts) {
      // Already signed race guard (status filter above should exclude, but be defensive)
      if (c.signedAt) continue;
      if (!c.sentAt) continue;

      const daysSent = (now - c.sentAt) / DAY_MS;
      const count = c.reminderCount ?? 0;
      const lastReminder = c.lastReminderAt ?? 0;
      const daysSinceLastReminder = lastReminder > 0 ? (now - lastReminder) / DAY_MS : Infinity;

      let pick = false;
      if (count === 0 && daysSent >= 3) {
        pick = true;
      } else if (count === 1 && daysSent >= 7 && daysSinceLastReminder >= 3) {
        pick = true;
      } else if (count === 2 && daysSent >= 14 && daysSinceLastReminder >= 7) {
        pick = true;
      }
      // count === 3 → skip (max reminders reached)

      if (pick) {
        const nextCount = count + 1;
        await ctx.db.patch(c._id, {
          reminderCount: nextCount,
          lastReminderAt: now,
        });
        await ctx.scheduler.runAfter(
          0,
          internal.functions.contracts.cron.sendContractReminder,
          { contractId: c._id, level: nextCount as 1 | 2 | 3 }
        );
        scheduled++;
      }
    }

    return { scheduled };
  },
});

/**
 * sendContractReminder — internal action scheduled by contractRemindersTick.
 *
 * Re-fetches the contract to guard against a race with a webhook that may have
 * set status='signed' between tick and now. If status is no longer 'sent',
 * aborts silently.
 *
 * Otherwise delegates to logReminder mutation to insert an emailLog row
 * (queued) + a documentEvents row.
 */
export const sendContractReminder = internalAction({
  args: {
    contractId: v.id("contracts"),
    level: v.union(v.literal(1), v.literal(2), v.literal(3)),
  },
  handler: async (ctx, args) => {
    // Re-fetch to detect status changes since tick ran
    const contract = await ctx.runQuery(
      internal.functions.contracts.internalQueries.getById,
      { contractId: args.contractId }
    );

    if (!contract || contract.status !== "sent") {
      // Signed, cancelled, or deleted between tick and now — abort
      return;
    }

    const isAdminFinal = args.level === 3;

    await ctx.runMutation(
      internal.functions.contracts.internalMutations.logReminder,
      {
        contractId: args.contractId,
        level: args.level,
        isAdminFinal,
      }
    );
  },
});
