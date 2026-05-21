/**
 * Source-level tests for `/configuracion/subservicios` page.
 *
 * NOTE: vitest runs in edge-runtime here and @testing-library/react is not
 * installed, so we cannot mount React components at test time. These tests
 * verify structural and API contracts by reading the page source, consistent
 * with the repo pattern (see proyecciones/__tests__/nueva-page.gate.test.tsx).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_PATH = resolve(__dirname, "../page.tsx");
const source = readFileSync(SOURCE_PATH, "utf-8");

describe("/configuracion/subservicios — page contract", () => {
  it("exports a default function component", () => {
    expect(source).toMatch(
      /export default function SubserviciosPage\s*\(\s*\)/
    );
  });

  it("is a client component (Convex hooks require client)", () => {
    expect(source).toContain('"use client"');
  });

  it("uses useQuery against listAllForOrg to populate the tree", () => {
    expect(source).toMatch(
      /useQuery\(\s*api\.functions\.subservices\.queries\.listAllForOrg/
    );
  });

  it("also queries services.listGlobal to render the parent accordion", () => {
    expect(source).toMatch(
      /useQuery\(\s*api\.functions\.services\.queries\.listGlobal/
    );
  });
});

describe("/configuracion/subservicios — row state badges", () => {
  it("renders a 'Global' badge when the row has no orgId", () => {
    expect(source).toContain('data-testid="badge-global"');
    expect(source).toContain("Global");
  });

  it("renders a 'Personalizada' badge for org-scoped rows", () => {
    expect(source).toContain('data-testid="badge-personalizada"');
    expect(source).toContain("Personalizada");
  });

  it("branches on orgId === undefined to decide which badge to show", () => {
    // SubserviceRow computes `isGlobal = subservice.orgId === undefined`
    expect(source).toMatch(
      /isGlobal\s*=\s*subservice\.orgId\s*===\s*undefined/
    );
  });
});

describe("/configuracion/subservicios — mutation wiring", () => {
  it("wires personalizeGlobal mutation for global rows", () => {
    expect(source).toMatch(
      /useMutation\(\s*api\.functions\.subservices\.mutations\.personalizeGlobal/
    );
    expect(source).toContain("Personalizar");
  });

  it("wires toggleActive mutation", () => {
    expect(source).toMatch(
      /useMutation\(\s*api\.functions\.subservices\.mutations\.toggleActive/
    );
  });

  it("wires remove mutation", () => {
    expect(source).toMatch(
      /useMutation\(\s*api\.functions\.subservices\.mutations\.remove/
    );
  });

  it("wires restoreToGlobal mutation (Volver al default)", () => {
    expect(source).toMatch(
      /useMutation\(\s*api\.functions\.subservices\.mutations\.restoreToGlobal/
    );
    expect(source).toContain("Volver al default");
  });

  it("wires create and update mutations through the editor drawer", () => {
    expect(source).toMatch(
      /useMutation\(\s*api\.functions\.subservices\.mutations\.create/
    );
    expect(source).toMatch(
      /useMutation\(\s*api\.functions\.subservices\.mutations\.update/
    );
  });
});

describe("/configuracion/subservicios — delete confirmation", () => {
  it("uses a confirmation dialog before invoking remove (two-step flow)", () => {
    // The Trash button sets pendingDelete, and DeleteConfirmDialog calls onConfirm.
    expect(source).toContain("setPendingDelete");
    expect(source).toContain("DeleteConfirmDialog");
    expect(source).toContain("Confirmar eliminación");
  });

  it("confirmation dialog warns about referential blocks and suggests Desactivar", () => {
    expect(source).toContain("Desactivar");
    expect(source).toMatch(/referenciado/);
  });

  it("delete button is destructive (red) styled", () => {
    expect(source).toContain("border-red-400/40");
    expect(source).toContain("bg-red-500");
  });
});

describe("/configuracion/subservicios — admin gate", () => {
  it("reads membership role from Clerk useOrganization", () => {
    expect(source).toContain('membership?.role === "org:admin"');
  });

  it("only shows mutating actions when isAdmin is true", () => {
    expect(source).toContain("{isAdmin && (");
  });
});

describe("/configuracion/subservicios — a11y (A1 Phase 2 review)", () => {
  it("'+ Agregar' is a real <button>, not a <span onClick> (button-in-button fix)", () => {
    // The previous implementation nested a <span onClick> inside a <button>,
    // which is invalid HTML and keyboard-inaccessible. The fixed header
    // splits into a header <div> with sibling <button>s: one for toggle,
    // one for Agregar. Assert no <span onClick> remains, and that Agregar
    // is rendered as a <button>.
    expect(source).not.toMatch(/<span[^>]*onClick[^>]*>\s*<Plus/);
    expect(source).toMatch(
      /<button[\s\S]*?>[\s\S]*?<Plus size=\{12\} \/> Agregar[\s\S]*?<\/button>/
    );
  });

  it("accordion trigger declares aria-expanded and aria-controls", () => {
    expect(source).toContain("aria-expanded={isExpanded}");
    expect(source).toMatch(/aria-controls=\{`subservices-panel-\$\{parentId\}`\}/);
  });

  it("accordion panel has matching id, role=region, and aria-labelledby", () => {
    expect(source).toMatch(/id=\{`subservices-panel-\$\{parentId\}`\}/);
    expect(source).toContain('role="region"');
    expect(source).toMatch(
      /aria-labelledby=\{`subservices-trigger-\$\{parentId\}`\}/
    );
  });
});

describe("/configuracion/subservicios — restore-to-global visibility", () => {
  it("hides 'Volver al default' when row has no parentSubserviceId (not a clone)", () => {
    // The button is wrapped in `{subservice.parentSubserviceId !== undefined && (...)}`
    expect(source).toMatch(
      /subservice\.parentSubserviceId\s*!==\s*undefined\s*&&[\s\S]*?Volver al default/
    );
    expect(source).toContain('data-testid="restore-to-global-btn"');
  });
});
