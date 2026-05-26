/**
 * Source-level tests for MissingContentBanner — spec §5.1
 *
 * Repo convention: source-level tests (read the file as text and verify
 * structure). Pattern visible in matrix-cell-detail.test.tsx and
 * src/app/(dashboard)/configuracion/branding/__tests__/page.test.tsx.
 *
 * @testing-library/react is not installed and vitest env is edge-runtime
 * (no DOM), so render-based tests cannot run in this project.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(
  resolve(__dirname, "../missing-content-banner.tsx"),
  "utf-8"
);

describe("MissingContentBanner", () => {
  it("renders nothing when missing is empty — returns null guard", () => {
    // Component must return null for empty array OR undefined
    expect(SOURCE).toMatch(/if\s*\(!missing\s*\|\|\s*missing\.length\s*===\s*0\)/);
    expect(SOURCE).toMatch(/return null/);
  });

  it("renders singular when 1 subservice missing", () => {
    expect(SOURCE).toContain("1 subservicio activo sin contenido real");
    expect(SOURCE).toMatch(/isSingular/);
  });

  it("renders plural with N items when multiple subservices missing", () => {
    expect(SOURCE).toMatch(/missing\.length.*subservicios activos sin contenido real/);
  });

  it("renders null when query result is undefined (loading) — same guard", () => {
    // The !missing check at the top of the null guard handles undefined
    expect(SOURCE).toMatch(/if\s*\(!missing/);
  });

  it("uses useQuery from convex/react", () => {
    expect(SOURCE).toMatch(/import\s*\{[^}]*useQuery[^}]*\}\s*from\s*"convex\/react"/);
  });

  it("calls subservicesMissingContent query", () => {
    expect(SOURCE).toContain("subservicesMissingContent");
  });

  it("renders AlertTriangle icon from lucide-react", () => {
    expect(SOURCE).toMatch(/import\s*\{[^}]*AlertTriangle[^}]*\}\s*from\s*"lucide-react"/);
  });

  it("maps over missing items and renders subserviceName and serviceName", () => {
    expect(SOURCE).toContain("m.subserviceName");
    expect(SOURCE).toContain("m.serviceName");
    expect(SOURCE).toMatch(/missing\.map\(/);
  });

  it("uses amber color scheme for the banner", () => {
    expect(SOURCE).toMatch(/amber/);
  });

  it("accepts projectionId prop typed as Id<projections>", () => {
    expect(SOURCE).toMatch(/projectionId.*Id.*projections/);
  });
});
