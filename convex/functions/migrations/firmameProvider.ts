import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";

const PAGE_SIZE_DEFAULT = 100;

/**
 * One-shot backfill for Sub-spec 2.
 * Converts orgIntegrations rows with provider='other' + providerLabel='firmame'
 * to provider='firmame'. Cursor-paginated; idempotent.
 *
 * Run: npx convex run functions/migrations/firmameProvider:migrate '{"cursor": null}'
 */
export const migrate = internalMutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? PAGE_SIZE_DEFAULT;
    const page = await ctx.db
      .query("orgIntegrations")
      .paginate({ cursor: args.cursor, numItems: limit });

    let migrated = 0;
    for (const row of page.page) {
      if (row.provider === "other" && row.providerLabel === "firmame") {
        await ctx.db.patch(row._id, {
          provider: "firmame",
          updatedAt: Date.now(),
        });
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
