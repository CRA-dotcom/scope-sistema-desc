/**
 * Server-side placeholder helpers for `deliverableTemplates`.
 *
 * Mirrors the regex shape used in `src/lib/templateResolver.ts` and in
 * `convex/lib/deliverableEngine/placeholders.ts` so that schema-side
 * validation in mutations stays consistent with both the client editor and
 * the AI generation engine.
 *
 * Per A2 §3.3 (docs/superpowers/specs/2026-05-22-templates-operator-access-design.md).
 */

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/**
 * Extract unique placeholder keys (`{{key}}`) from an HTML string, preserving
 * first-seen order. Allows surrounding whitespace inside the braces to be
 * tolerant of hand-edited HTML; key chars must start with [A-Za-z_] (no
 * leading digit) to avoid matching CSS-like patterns.
 */
export function extractPlaceholders(html: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  // Each call uses a fresh regex (lastIndex reset) since /g state would
  // otherwise leak across invocations when the same module is reused.
  const re = new RegExp(PLACEHOLDER_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      out.push(m[1]);
    }
  }
  return out;
}

/**
 * Validate that every `{{key}}` in `html` is also declared in `vars[].key`.
 * Throws when there are undeclared placeholders so the mutation rejects the
 * write before persisting a broken template.
 *
 * Branding tokens (`branding_*`) are auto-allowed because they live in CSS
 * blocks and are resolved from `orgBranding`, not declared as variables.
 */
export function validatePlaceholdersDeclared(
  html: string,
  vars: ReadonlyArray<{ key: string }>,
): void {
  const declared = new Set(vars.map((v) => v.key));
  const found = extractPlaceholders(html);
  const undeclared = found.filter(
    (k) => !declared.has(k) && !k.startsWith("branding_"),
  );
  if (undeclared.length > 0) {
    throw new Error(
      `Placeholders no declarados en variables[]: ${undeclared.join(", ")}. ` +
        `Agregalos a la lista de variables o quítalos del HTML.`,
    );
  }
}
