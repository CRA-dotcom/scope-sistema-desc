import type { Id } from "../../_generated/dataModel";

/**
 * A3 — Hook for per-client subservice frequency overrides (R1 §12.8).
 *
 * In beta this ALWAYS returns null. In June, this will read from a future
 * `clientSubserviceOverrides` table. Keeping the signature stable lets the
 * selector swap implementations in place without touching the call site.
 *
 * Per docs/superpowers/specs/2026-05-23-document-lifecycle-design.md §3.3.2
 */

export type FrequencyOverride = {
  frequencyOverride?:
    | "mensual"
    | "trimestral"
    | "semestral"
    | "anual"
    | "una_vez";
  applicableMonthsOverride?: number[];
  cooldownMonthsOverride?: number;
} | null;

export function getOverride(
  _clientId: Id<"clients">,
  _subserviceId: Id<"subservices"> | undefined
): FrequencyOverride {
  return null;
}
