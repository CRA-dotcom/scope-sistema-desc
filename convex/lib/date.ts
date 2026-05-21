/**
 * Date utilities shared across Convex functions.
 *
 * Keep this module pure (no Convex ctx, no DB access) so it can be imported
 * from queries, mutations, actions, and tests without side effects.
 */

/**
 * Returns the UTC millisecond timestamp for the first day of the month that
 * contains `now` (00:00:00 UTC). Defaults to the current time, but accepts an
 * explicit anchor for testability and to align rollups against a fixed clock.
 *
 * Used by super-admin metrics + billing rollups to bucket monthly aggregates.
 */
export function monthStartMs(now: number = Date.now()): number {
  const d = new Date(now);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}
