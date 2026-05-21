/**
 * Source-level tests for `/configuracion/plantillas` tree page (A2 Phase 2).
 *
 * Pattern: vitest + node:fs `readFileSync` + regex. @testing-library/react is
 * NOT installed in this repo (see configuracion/subservicios/__tests__/page.test.tsx
 * for the canonical A1 pattern). We verify structural contracts:
 *   - data fetching (services, subservices, listForOrg)
 *   - mutation wiring (personalizeGlobal, restoreToGlobal, create)
 *   - badges + buttons conditional rendering
 *   - "invoice" type filtered out of operator UI
 *   - tree shape (Service → Subservice → Templates)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_PATH = resolve(__dirname, "../page.tsx");
const source = readFileSync(SOURCE_PATH, "utf-8");

describe("/configuracion/plantillas — page contract", () => {
  it("exports a default function component", () => {
    expect(source).toMatch(
      /export default function PlantillasPage\s*\(\s*\)/
    );
  });

  it("is a client component (Convex hooks require client)", () => {
    expect(source).toContain('"use client"');
  });

  it("queries services.listByOrg to render the outer accordion", () => {
    expect(source).toMatch(
      /useQuery\(\s*api\.functions\.services\.queries\.listByOrg/
    );
  });

  it("queries subservices.listAllForOrg for the middle accordion", () => {
    expect(source).toMatch(
      /useQuery\(\s*api\.functions\.subservices\.queries\.listAllForOrg/
    );
  });

  it("queries deliverableTemplates.listForOrg for the inner template list", () => {
    expect(source).toMatch(
      /useQuery\(\s*api\.functions\.deliverableTemplates\.queries\.listForOrg/
    );
  });

  it("waits for all three queries before rendering the tree (loading state)", () => {
    // Tree builder returns null until all three queries are defined so we
    // never render half-loaded data.
    expect(source).toMatch(
      /if\s*\(\s*!services\s*\|\|\s*!subservices\s*\|\|\s*!templates\s*\)\s*return null/
    );
  });
});

describe("/configuracion/plantillas — mutation wiring", () => {
  it("wires personalizeGlobal mutation for global rows", () => {
    expect(source).toMatch(
      /useMutation\(\s*api\.functions\.deliverableTemplates\.mutations\.personalizeGlobal/
    );
    expect(source).toContain("Personalizar para mi org");
  });

  it("wires restoreToGlobal mutation behind a confirm dialog", () => {
    expect(source).toMatch(
      /useMutation\(\s*api\.functions\.deliverableTemplates\.mutations\.restoreToGlobal/
    );
    expect(source).toContain("Restaurar default");
    expect(source).toContain("RestoreConfirmDialog");
  });

  it("wires create mutation through the NewTemplateDialog", () => {
    expect(source).toMatch(
      /useMutation\(\s*api\.functions\.deliverableTemplates\.mutations\.create/
    );
    expect(source).toContain("NewTemplateDialog");
  });

  it("personalizeGlobal pushes to /configuracion/plantillas/{newId} on success", () => {
    expect(source).toMatch(
      /router\.push\(`\/configuracion\/plantillas\/\$\{newId\}`\)/
    );
  });

  it("create mutation does NOT pass orgId (operator path forces own org server-side)", () => {
    // The create call in NewTemplateDialog must NOT include orgId — per spec
    // §3.3 the server forces resolvedOrgId = caller.org.
    const createCall = source.match(
      /createMut\(\{[\s\S]*?\}\);/
    );
    expect(createCall).toBeTruthy();
    expect(createCall![0]).not.toMatch(/\borgId:/);
  });
});

describe("/configuracion/plantillas — badges + state", () => {
  it("renders a 'Global' badge when template.orgId === undefined", () => {
    expect(source).toContain('data-testid="badge-global"');
    expect(source).toContain("Global");
  });

  it("renders a 'Personalizada' badge for org-scoped templates", () => {
    expect(source).toContain('data-testid="badge-personalizada"');
    expect(source).toContain("Personalizada");
  });

  it("branches on template.orgId === undefined to decide which badge to render", () => {
    expect(source).toMatch(
      /isGlobal\s*=\s*template\.orgId\s*===\s*undefined/
    );
  });

  it("Personalizar button only renders for global templates", () => {
    expect(source).toMatch(/isGlobal\s*&&[\s\S]*?Personalizar para mi org/);
  });

  it("Restaurar default button only renders when parentTemplateId is set", () => {
    // Mirrors the A1 'Volver al default' pattern — restore only makes sense
    // for clones of a global (rows with parentTemplateId).
    expect(source).toMatch(
      /hasParent\s*=\s*template\.parentTemplateId\s*!==\s*undefined/
    );
    expect(source).toMatch(/hasParent\s*&&[\s\S]*?Restaurar default/);
    expect(source).toContain('data-testid="restore-to-global-btn"');
  });

  it("Editar button only renders for org-scoped (orgId === callerOrgId) rows", () => {
    expect(source).toMatch(
      /isOrgScoped\s*=\s*!isGlobal\s*&&\s*template\.orgId\s*===\s*callerOrgId/
    );
    expect(source).toMatch(/isOrgScoped\s*&&[\s\S]*?Editar/);
  });
});

describe("/configuracion/plantillas — invoice filtering (operator UI hides invoice type)", () => {
  it("filters templates where type === 'invoice' from the tree", () => {
    // The tree builder strips invoice templates so the operator never sees them.
    expect(source).toMatch(/t\.type\s*!==\s*"invoice"/);
  });

  it("the OPERATOR_TYPE_OPTIONS dropdown excludes 'invoice'", () => {
    // Type union for operator-side dropdown explicitly excludes "invoice".
    expect(source).toMatch(/Exclude<TemplateType,\s*"invoice">/);
    // And the options list does NOT contain a value "invoice".
    const optionsBlock = source.match(
      /OPERATOR_TYPE_OPTIONS[\s\S]*?\];/
    );
    expect(optionsBlock).toBeTruthy();
    expect(optionsBlock![0]).not.toMatch(/value:\s*"invoice"/);
  });
});

describe("/configuracion/plantillas — a11y", () => {
  it("service accordion declares aria-expanded + aria-controls + matching panel id", () => {
    expect(source).toContain("aria-expanded={svcOpen}");
    expect(source).toMatch(
      /aria-controls=\{`templates-service-panel-\$\{svcId\}`\}/
    );
    expect(source).toMatch(/id=\{`templates-service-panel-\$\{svcId\}`\}/);
    expect(source).toContain('role="region"');
  });

  it("dialogs are role=dialog aria-modal and close on Escape", () => {
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toMatch(/e\.key\s*===\s*"Escape"/);
  });

  it("'+ Nueva plantilla' is a real <button> with discoverable testid", () => {
    expect(source).toMatch(
      /<button[\s\S]*?data-testid=\{`new-template-btn-\$\{subId\}`\}[\s\S]*?Nueva plantilla[\s\S]*?<\/button>/
    );
  });

  it("admin gate only shows mutating actions when isAdmin is true", () => {
    expect(source).toContain('membership?.role === "org:admin"');
    expect(source).toContain("{isAdmin && (");
  });
});

describe("/configuracion/plantillas — empty + loading states", () => {
  it("renders a skeleton while any query is undefined", () => {
    expect(source).toMatch(/services === undefined/);
    expect(source).toMatch(/subservices === undefined/);
    expect(source).toMatch(/templates === undefined/);
    expect(source).toContain("animate-pulse");
  });

  it("renders an empty-state message when a subservice has zero templates", () => {
    expect(source).toContain("No hay plantillas todavía");
  });
});
