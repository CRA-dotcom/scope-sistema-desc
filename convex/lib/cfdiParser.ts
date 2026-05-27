export type CfdiParseResult =
  | { ok: true; issueDate: number }
  | { ok: false; reason: string };

const FECHA_REGEX = /\bFecha\s*=\s*(?:"([^"]+)"|'([^']+)')/;
const COMPROBANTE_ROOT_REGEX = /<(?:[a-zA-Z][\w-]*:)?Comprobante\b[^>]*>/;

/**
 * Parse the `Fecha` attribute from a CFDI XML buffer's <Comprobante> root.
 * Supports namespace-prefixed (`cfdi:Comprobante`) and bare (`Comprobante`)
 * variants. Date format: ISO datetime `YYYY-MM-DDTHH:MM:SS[.SSS][Z|±HH:MM]`.
 */
export function parseCfdiIssueDate(buffer: ArrayBuffer): CfdiParseResult {
  if (buffer.byteLength === 0) {
    return { ok: false, reason: "empty buffer" };
  }
  const xml = new TextDecoder("utf-8").decode(buffer);

  // Find <Comprobante> root element. If missing → malformed.
  const rootMatch = xml.match(COMPROBANTE_ROOT_REGEX);
  if (!rootMatch) {
    return { ok: false, reason: "malformed XML — no Comprobante root" };
  }

  // Extract Fecha attribute from the root opening tag only (avoid grabbing
  // Fecha from nested elements like cfdi:TimbreFiscalDigital).
  const fechaMatch = rootMatch[0].match(FECHA_REGEX);
  if (!fechaMatch) {
    return { ok: false, reason: "missing Fecha attribute on Comprobante root" };
  }

  // Group 1 = double-quoted, group 2 = single-quoted
  const fechaStr = fechaMatch[1] ?? fechaMatch[2];
  // CFDI Fecha is a naive datetime (no timezone suffix). SAT specifies Mexican
  // local time but for consistent storage we treat it as UTC (no offset applied).
  // Append "Z" only when the string has no timezone info already.
  const hasTimezone = /[Zz]$|[+-]\d{2}:\d{2}$/.test(fechaStr);
  const normalized = hasTimezone ? fechaStr : `${fechaStr}Z`;
  const parsed = Date.parse(normalized);
  if (isNaN(parsed)) {
    return { ok: false, reason: `invalid Fecha date format: ${fechaStr}` };
  }

  return { ok: true, issueDate: parsed };
}
