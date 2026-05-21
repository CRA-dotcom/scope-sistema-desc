/**
 * Datetime formatting helpers for A3 document lifecycle UI.
 *
 * Per docs/superpowers/specs/2026-05-23-document-lifecycle-design.md §4.4 — used
 * by the audit table and the Documentos tab's "Facturas" section.
 */

/**
 * Format a millisecond timestamp in es-MX locale with an explicit IANA tz.
 *
 * When tz is omitted, falls back to the browser/operator's resolved time zone.
 * Returns strings like "29/05/2026, 14:22".
 */
export function formatLocalDateTime(ms: number, tz?: string): string {
  const timeZone =
    tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return new Intl.DateTimeFormat("es-MX", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}
