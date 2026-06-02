import { internalMutation } from "../../_generated/server";

/**
 * One-shot migration: backfill seasonalityOutliers from seasonalityDeltas on
 * legacy projections + drafts.
 *
 * STATUS: COMPLETED. Ran on dev 2026-06-01 — 0 rows migrated (no legacy rows
 * existed). The `seasonalityDeltas` field has since been dropped from the
 * schema (projections + projectionDrafts.state). This stub is preserved for
 * audit trail purposes and is a safe no-op.
 *
 * ClickUp #86ahtntfp — Phase 4 schema cleanup deferred item §4.1
 */
export const run = internalMutation({
  args: {},
  handler: async (_ctx) => {
    // Field dropped from schema after migration ran. No-op.
    return { projectionsMigrated: 0, draftsMigrated: 0 };
  },
});
