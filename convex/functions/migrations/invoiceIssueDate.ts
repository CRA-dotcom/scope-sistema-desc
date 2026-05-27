import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";

const PAGE_SIZE_DEFAULT = 100;

/**
 * SS5 migration — backfill `issueDate = uploadedAt` for invoice rows
 * created before the field existed. Cursor-paginated, idempotent.
 *
 * Per docs/superpowers/specs/2026-05-27-invoice-issue-date-design.md §8
 *
 * Run: npx convex run functions/migrations/invoiceIssueDate:migrate '{"cursor": null}'
 */
export const migrate = internalMutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? PAGE_SIZE_DEFAULT;
    const page = await ctx.db
      .query("invoices")
      .paginate({ cursor: args.cursor, numItems: limit });

    let migrated = 0;
    for (const row of page.page) {
      if (row.issueDate === undefined) {
        await ctx.db.patch(row._id, { issueDate: row.uploadedAt });
        migrated++;
      }
    }

    return {
      migrated,
      done: page.isDone,
      nextCursor: page.continueCursor,
    };
  },
});
