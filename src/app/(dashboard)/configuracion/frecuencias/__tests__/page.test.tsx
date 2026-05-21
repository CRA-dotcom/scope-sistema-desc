/**
 * Source-level tests for `/configuracion/frecuencias` (D2 §4.6).
 *
 * Verifies the read-only placeholder structure: banner deferring per-client
 * overrides to V2, grouping by parent service, and the per-row "Editar en
 * Subservicios" links that thread `?focus={id}` (spec §8 Q7).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_PATH = resolve(__dirname, "../page.tsx");
const source = readFileSync(SOURCE_PATH, "utf-8");

describe("/configuracion/frecuencias — page contract (D2 §4.6)", () => {
  it("exports a default function component", () => {
    expect(source).toMatch(
      /export default function FrecuenciasPage\s*\(\s*\)/
    );
  });

  it("is a client component", () => {
    expect(source).toContain('"use client"');
  });

  it("queries services.listByOrg + subservices.listAllForOrg", () => {
    expect(source).toMatch(
      /useQuery\(\s*api\.functions\.services\.queries\.listByOrg/
    );
    expect(source).toMatch(
      /useQuery\(\s*api\.functions\.subservices\.queries\.listAllForOrg/
    );
  });

  it("renders the deferral banner with role=note for screen readers", () => {
    expect(source).toContain('data-testid="frecuencias-banner"');
    expect(source).toContain(
      "Override por cliente estará disponible en una versión futura."
    );
    expect(source).toContain('role="note"');
  });

  it("renders a per-row Editar link that threads ?focus={id} (spec §8 Q7)", () => {
    expect(source).toMatch(
      /href=\{`\/configuracion\/subservicios\?focus=\$\{sub\._id\}`\}/
    );
    expect(source).toContain("Editar en Subservicios");
    expect(source).toContain('data-testid={`frec-edit-${sub._id}`}');
  });

  it("groups subservices by parent service via a Map keyed on parentServiceId", () => {
    expect(source).toMatch(
      /byService\.set\(\s*sub\.parentServiceId,\s*arr\s*\)/
    );
    expect(source).toMatch(/sub\.parentServiceId/);
  });

  it("falls back to empty state when no subservices exist", () => {
    expect(source).toContain("Aún no hay subservicios configurados.");
    // Empty-state still links to Subservicios so the user can self-serve.
    expect(source).toMatch(/href="\/configuracion\/subservicios"/);
  });
});
