import { type Doc } from "../_generated/dataModel";

export type ProjectionMode = "rolling" | "fiscal";

/**
 * Resolve effective values for projection-mode/startMonth/monthCount/effectiveBudget
 * from a projection record. Provides defaults for legacy rows that don't have these
 * fields set (treats them as rolling 12 months from January with full budget).
 */
export function resolveProjectionContext(p: Pick<Doc<"projections">,
  "totalBudget" | "year"
> & {
  startMonth?: number;
  projectionMode?: "rolling" | "fiscal";
  monthCount?: number;
  effectiveBudget?: number;
}): {
  projectionMode: ProjectionMode;
  startMonth: number;
  monthCount: number;
  effectiveBudget: number;
  endMonth: number; // computed from startMonth + monthCount - 1, modulo 12 wrap for rolling
  endYear: number;  // year for the end month (year+1 if rolling and wraps)
} {
  const projectionMode: ProjectionMode = p.projectionMode ?? "rolling";
  const startMonth = p.startMonth ?? 1;
  const computedMonthCount =
    projectionMode === "fiscal" ? Math.max(1, 13 - startMonth) : 12;
  const monthCount = p.monthCount ?? computedMonthCount;
  // 2026-05-12: dropped proration. `totalBudget` is the contracted amount to
  // distribute across `monthCount` months in both rolling and fiscal modes.
  // `effectiveBudget` is kept in the type for back-compat with stored rows
  // (prior rows may still have a prorated value) but is no longer load-bearing;
  // callers should treat it as equal to `totalBudget`.
  const effectiveBudget = p.totalBudget;

  // Compute end month/year. Rolling can wrap into next year; fiscal stays in same year.
  const endIndex = startMonth - 1 + (monthCount - 1); // 0-indexed
  const endMonth = (endIndex % 12) + 1;
  const endYear = p.year + Math.floor(endIndex / 12);

  return {
    projectionMode,
    startMonth,
    monthCount,
    effectiveBudget,
    endMonth,
    endYear,
  };
}

/**
 * Compute the array of month indices [1..12] that this projection covers,
 * in order from startMonth. Wraps around for rolling mode (Dec → Jan).
 *
 * Examples:
 *   resolveProjectionMonths(5, 12) → [5,6,7,8,9,10,11,12,1,2,3,4]
 *   resolveProjectionMonths(5, 8)  → [5,6,7,8,9,10,11,12]
 *   resolveProjectionMonths(1, 12) → [1,2,3,...,12]
 */
export function resolveProjectionMonths(
  startMonth: number,
  monthCount: number
): number[] {
  return Array.from({ length: monthCount }, (_, i) => ((startMonth - 1 + i) % 12) + 1);
}
