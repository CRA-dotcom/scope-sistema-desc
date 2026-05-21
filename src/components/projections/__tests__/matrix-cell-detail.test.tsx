/**
 * Source-level tests for MatrixCellDetail drawer — override manual block.
 *
 * Verifica el contrato del bloque "Avanzado · override manual" agregado
 * por el sub-spec docs/superpowers/specs/2026-05-21-deliverable-manual-override-design.md
 *
 * Convención del repo: source-level tests (lee el archivo como texto y
 * verifica estructura). Patrón visible en
 * src/app/(dashboard)/configuracion/branding/__tests__/page.test.tsx.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(
  resolve(__dirname, "../matrix-cell-detail.tsx"),
  "utf-8"
);

describe("MatrixCellDetail — override manual block", () => {
  it("imports useOrganization from Clerk for admin detection", () => {
    expect(SOURCE).toMatch(
      /import\s*\{[^}]*useOrganization[^}]*\}\s*from\s*"@clerk\/nextjs"/
    );
  });

  it("derives canOverride from admin role AND manualOverrideAllowed flag", () => {
    expect(SOURCE).toContain('membership?.role === "org:admin"');
    expect(SOURCE).toContain("flags.manualOverrideAllowed");
    expect(SOURCE).toMatch(/canOverride\s*=/);
  });

  it("renders the Avanzado block only when canOverride is true", () => {
    expect(SOURCE).toMatch(/\{canOverride\s*&&\s*\(/);
  });

  it("invokes generateDeliverable action with triggerSource manual and short template", () => {
    expect(SOURCE).toMatch(
      /useAction\(\s*api\.functions\.deliverables\.actions\.generateDeliverable/
    );
    expect(SOURCE).toContain('triggerSource: "manual"');
    expect(SOURCE).toContain('templateType: "deliverable_short"');
  });

  it("confirms before generating with a window.confirm prompt", () => {
    expect(SOURCE).toMatch(/window\.confirm\(/);
    expect(SOURCE).toContain("triggerSource=manual");
  });

  it("disables the button when deliverable already exists", () => {
    expect(SOURCE).toMatch(/Ya existe entregable/);
    expect(SOURCE).toMatch(/\/entregables\/\$\{deliverable\._id\}/);
  });

  it("disables the button when assignment.status is pending", () => {
    expect(SOURCE).toMatch(/assignment\.status\s*===\s*"pending"/);
    expect(SOURCE).toContain("Cliente no ha respondido");
  });

  it("renders inline banner with link to plantillas when template is missing", () => {
    expect(SOURCE).toContain('"missing-template"');
    expect(SOURCE).toMatch(/\/configuracion\/plantillas/);
  });

  it("does not import any toast library (repo convention)", () => {
    expect(SOURCE).not.toMatch(/from\s*"sonner"/);
    expect(SOURCE).not.toMatch(/react-hot-toast/);
  });
});
