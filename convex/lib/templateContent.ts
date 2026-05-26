/**
 * Marker que el seed del 2026-05-22 dejó en las 33 plantillas placeholder.
 * Si el HTML aún lo contiene, el template no tiene contenido real.
 *
 * Reservado: no usar esta clase CSS en plantillas con contenido real, o
 * quedan flagged como placeholder. Spec:
 * docs/superpowers/specs/2026-05-25-deliverable-content-catalog-design.md §3
 */
const PLACEHOLDER_MARKER = '<div class="placeholder">';

export type ContentStatus = "placeholder" | "ready";

/**
 * Auto-derive contentStatus from htmlTemplate. Called on every create/update
 * of deliverableTemplates so the flag stays in sync without manual checkbox.
 */
export function detectContentStatus(htmlTemplate: string): ContentStatus {
  return htmlTemplate.includes(PLACEHOLDER_MARKER) ? "placeholder" : "ready";
}
