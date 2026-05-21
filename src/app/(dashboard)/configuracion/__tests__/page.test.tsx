/**
 * Source-level tests for `/configuracion` hub (D2 Phase 2 §4.1).
 *
 * Pattern: vitest + node:fs `readFileSync` + regex. @testing-library/react is
 * NOT installed in this repo — see configuracion/subservicios/__tests__/page.test.tsx
 * for the canonical structural-test pattern (A1) and plantillas (A2).
 *
 * Spec §5 test #14: "Hub /configuracion renderiza 9 cards" — we assert the
 * 9 hrefs are wired across the 5 group sections.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_PATH = resolve(__dirname, "../page.tsx");
const source = readFileSync(SOURCE_PATH, "utf-8");

describe("/configuracion — hub contract (D2 §4.1)", () => {
  it("exports a default function component", () => {
    expect(source).toMatch(
      /export default function ConfiguracionPage\s*\(\s*\)/
    );
  });

  it("is a client component (uses Link + lucide icons under Next.js client tree)", () => {
    expect(source).toContain('"use client"');
  });

  it("renders 5 section groups in the spec-mandated order", () => {
    const groupOrder = [
      "Catálogo",
      "Equipo",
      "Comunicación",
      "Identidad",
      "Proveedores",
    ];
    // The groups array literal preserves textual order, so the first
    // occurrence of each label must follow `groupOrder`.
    const positions = groupOrder.map((label) => source.indexOf(`"${label}"`));
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  it("wires all 9 hub cards with the spec-mandated hrefs", () => {
    const requiredHrefs = [
      "/configuracion/empresas-emitentes",
      "/configuracion/subservicios",
      "/configuracion/plantillas",
      "/configuracion/usuarios",
      "/configuracion/frecuencias",
      "/configuracion/notificaciones",
      "/configuracion/email-log",
      "/configuracion/branding",
      "/configuracion/integraciones",
    ];
    for (const href of requiredHrefs) {
      expect(source).toContain(`"${href}"`);
    }
    // Count: exactly 9 card entries with `href:` keys (groups array).
    const hrefEntries = source.match(/href:\s*"\/configuracion\//g) ?? [];
    expect(hrefEntries.length).toBe(9);
  });

  it("declares aria-labelledby on each section group for screen readers", () => {
    expect(source).toMatch(/aria-labelledby=\{`config-group-\$\{group\.label\}`\}/);
    expect(source).toMatch(/id=\{`config-group-\$\{group\.label\}`\}/);
  });
});
