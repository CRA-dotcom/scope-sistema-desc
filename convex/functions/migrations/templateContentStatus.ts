import { internalMutation, internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { detectContentStatus } from "../../lib/templateContent";

/**
 * One-shot backfill for Sub-spec 1.
 * Idempotent: skips rows that already have contentStatus.
 * Spec: docs/superpowers/specs/2026-05-25-deliverable-content-catalog-design.md §6
 *
 * Run: npx convex run functions/migrations/templateContentStatus:migrate '{"dryRun": false}'
 */
export const migrate = internalMutation({
  args: {
    dryRun: v.boolean(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { dryRun, limit, cursor }) => {
    const numItems = limit ?? 100;
    const page = await ctx.db
      .query("deliverableTemplates")
      .paginate({ numItems, cursor: cursor ?? null });

    let count = 0;
    for (const tpl of page.page) {
      if (tpl.contentStatus) continue;
      const status = detectContentStatus(tpl.htmlTemplate);
      if (!dryRun) await ctx.db.patch(tpl._id, { contentStatus: status });
      count++;
    }

    return {
      templates: count,
      dryRun,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const verifyComplete = internalQuery({
  args: {},
  handler: async (ctx) => {
    let pending = 0;
    for await (const tpl of ctx.db.query("deliverableTemplates")) {
      if (!tpl.contentStatus) pending++;
    }
    return { templatesPending: pending };
  },
});
