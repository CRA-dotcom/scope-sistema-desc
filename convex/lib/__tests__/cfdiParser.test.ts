import { describe, it, expect } from "vitest";
import { parseCfdiIssueDate } from "../cfdiParser";

const CFDI_40_VALID = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Serie="A" Folio="123" Fecha="2026-01-15T10:30:00" Total="1000.00">
  <cfdi:Emisor Rfc="DXX900101AAA" Nombre="Despacho X SA"/>
</cfdi:Comprobante>`;

const CFDI_33_VALID = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/3" Version="3.3" Serie="B" Folio="456" Fecha="2025-12-20T14:45:30" Total="500.00">
</cfdi:Comprobante>`;

const CFDI_NO_PREFIX = `<?xml version="1.0" encoding="UTF-8"?>
<Comprobante Version="4.0" Fecha="2026-02-01T09:00:00" Total="2000.00"></Comprobante>`;

const CFDI_MISSING_FECHA = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Total="1000.00"></cfdi:Comprobante>`;

const MALFORMED_XML = `not even xml at all <<<`;

const INVALID_FECHA_FORMAT = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Fecha="not-a-date" Total="1.00"></cfdi:Comprobante>`;

function toBuffer(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer;
}

describe("parseCfdiIssueDate", () => {
  it("extracts Fecha from CFDI 4.0 with namespace prefix", () => {
    const r = parseCfdiIssueDate(toBuffer(CFDI_40_VALID));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(new Date(r.issueDate).toISOString()).toMatch(/^2026-01-15T10:30:00/);
    }
  });

  it("extracts Fecha from CFDI 3.3", () => {
    const r = parseCfdiIssueDate(toBuffer(CFDI_33_VALID));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(new Date(r.issueDate).toISOString()).toMatch(/^2025-12-20T14:45:30/);
    }
  });

  it("extracts Fecha from XML without cfdi: prefix", () => {
    const r = parseCfdiIssueDate(toBuffer(CFDI_NO_PREFIX));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(new Date(r.issueDate).toISOString()).toMatch(/^2026-02-01T09:00:00/);
    }
  });

  it("returns ok=false when Fecha attribute is missing", () => {
    const r = parseCfdiIssueDate(toBuffer(CFDI_MISSING_FECHA));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/Fecha/i);
    }
  });

  it("returns ok=false for malformed XML", () => {
    const r = parseCfdiIssueDate(toBuffer(MALFORMED_XML));
    expect(r.ok).toBe(false);
  });

  it("returns ok=false when Fecha format is invalid", () => {
    const r = parseCfdiIssueDate(toBuffer(INVALID_FECHA_FORMAT));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/invalid|format/i);
    }
  });

  it("handles empty buffer", () => {
    const r = parseCfdiIssueDate(new ArrayBuffer(0));
    expect(r.ok).toBe(false);
  });
});
