import { internalMutation } from "../../_generated/server";

/**
 * One-shot migration: backfill subserviceIds array from legacy subserviceId
 * scalar on projectionServices rows that still have scalar but empty array.
 *
 * STATUS: COMPLETED. Ran on dev 2026-06-01 — 7 rows migrated. The
 * `subserviceId` scalar has since been dropped from the `projectionServices`
 * schema. This stub is preserved for audit trail purposes and is a safe no-op.
 *
 * NOTE: Only drops the scalar on `projectionServices`. The scalar on
 * monthlyAssignments, quotations, contracts, deliverables, and invoices is an
 * intentional document snapshot — DO NOT touch those.
 *
 * ClickUp #86ahtnthc — Phase 4 schema cleanup deferred item §4.1
 */
export const run = internalMutation({
  args: {},
  handler: async (_ctx) => {
    // Field dropped from schema after migration ran. No-op.
    return { migrated: 0 };
  },
});
