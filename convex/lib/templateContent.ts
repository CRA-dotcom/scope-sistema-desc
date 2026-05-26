/**
 * Marker que el seed del 2026-05-22 dejó en las 33 plantillas placeholder.
 * Si el HTML aún lo contiene como elemento DOM activo (no en comentario ni
 * en script), el template no tiene contenido real.
 *
 * Reservado: no usar la clase CSS "placeholder" en una <div> de plantillas
 * con contenido real, o quedan flagged como placeholder. Spec:
 * docs/superpowers/specs/2026-05-25-deliverable-content-catalog-design.md §3
 */
const PLACEHOLDER_MARKER_REGEX = /<div\b[^>]*\bclass\s*=\s*["'][^"']*\bplaceholder\b[^"']*["'][^>]*>/i;

export type ContentStatus = "placeholder" | "ready";

/**
 * Auto-derive contentStatus from htmlTemplate. Called on every create/update
 * of deliverableTemplates so the flag stays in sync without manual checkbox.
 *
 * Robust to common HTML variations (whitespace, quote style, multiple classes,
 * case). Ignores markers inside HTML comments and <script> blocks.
 */
export function detectContentStatus(htmlTemplate: string): ContentStatus {
  // Strip HTML comments + script bodies so markers there don't trigger.
  const cleaned = htmlTemplate
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  return PLACEHOLDER_MARKER_REGEX.test(cleaned) ? "placeholder" : "ready";
}
