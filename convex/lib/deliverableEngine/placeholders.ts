const PLACEHOLDER_RE = /\{\{([a-zA-Z0-9_]+)\}\}/g;

/**
 * Extract unique placeholder keys (`{{key}}`) from an HTML string,
 * preserving first-seen order. Source of truth for which placeholders
 * a template actually contains — used instead of the stale
 * `template.variables` array.
 */
export function extractPlaceholders(html: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  PLACEHOLDER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PLACEHOLDER_RE.exec(html)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      out.push(m[1]);
    }
  }
  return out;
}
