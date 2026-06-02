import type { Id } from "../_generated/dataModel";

/**
 * Returns the effective subservice IDs for a projectionService row,
 * preferring the new `subserviceIds` array over the legacy scalar
 * `subserviceId`.
 *
 * Multi-subservicio: returns the full array.
 * Single-subservicio (legacy or new): returns [id].
 * No subservices: returns [].
 */
export function effectiveSubserviceIds(
  ps:
    | {
        subserviceIds?: Id<"subservices">[];
      }
    | null
    | undefined
): Id<"subservices">[] {
  if (!ps) return [];
  return ps.subserviceIds ?? [];
}
