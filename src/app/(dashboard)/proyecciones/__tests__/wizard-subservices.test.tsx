/**
 * Source-level tests for the projection wizard's A1 subservice integration.
 *
 * vitest runs in edge-runtime here, no @testing-library/react available, so we
 * verify the wizard wiring by reading the page source. See repo pattern in
 * proyecciones/__tests__/nueva-page.gate.test.tsx.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const WIZARD_SOURCE = readFileSync(
  resolve(__dirname, "../nueva/page.tsx"),
  "utf-8"
);

const PROJECTIONS_MUT_SOURCE = readFileSync(
  resolve(
    __dirname,
    "../../../../../convex/functions/projections/mutations.ts"
  ),
  "utf-8"
);

describe("wizard Step 2 — subservice dropdown", () => {
  it("ServiceFormState carries an optional subserviceId field", () => {
    expect(WIZARD_SOURCE).toMatch(
      /subserviceId\?\s*:\s*Id<"subservices">/
    );
  });

  it("prefetches subservices via listAllForOrg (batched, not N+1)", () => {
    expect(WIZARD_SOURCE).toMatch(
      /useQuery\(\s*api\.functions\.subservices\.queries\.listAllForOrg/
    );
  });

  it("groups subservices by parentServiceId for per-row dropdown lookup", () => {
    expect(WIZARD_SOURCE).toContain("subservicesByParent");
    expect(WIZARD_SOURCE).toContain("parentServiceId");
  });

  it("renders a <select required> dropdown under each active service row", () => {
    // The select is required and labels are aria-labelled per service.
    expect(WIZARD_SOURCE).toMatch(/required[^>]*aria-label=\{`Subservicio/);
    // Placeholder option uses the spec wording.
    expect(WIZARD_SOURCE).toContain("— Selecciona subservicio —");
  });

  it("each subservice option label includes name and defaultFrequency", () => {
    // "{o.name} · {o.defaultFrequency}"
    expect(WIZARD_SOURCE).toMatch(
      /\{o\.name\}\s*·\s*\{o\.defaultFrequency\}/
    );
  });

  it("shows a warning + deep link when the active parent has zero subservices", () => {
    // The warning copy may wrap across JSX lines, so we match the prefix only.
    expect(WIZARD_SOURCE).toContain(
      "Este servicio no tiene subservicios configurados"
    );
    expect(WIZARD_SOURCE).toContain("/configuracion/subservicios");
  });
});

describe("wizard Step 2 — Continuar button validation", () => {
  it("computes missingSubserviceSelection from active services with options", () => {
    expect(WIZARD_SOURCE).toContain("missingSubserviceSelection");
    // The computation considers !s.subserviceId for active services that have options.
    expect(WIZARD_SOURCE).toMatch(/!s\.subserviceId/);
  });

  it("disables the 'Siguiente' button when subservice selection is missing in Step 2", () => {
    // The disabled prop on Siguiente combines allocation guard + missing subservice.
    expect(WIZARD_SOURCE).toMatch(
      /step\s*===\s*2[\s\S]{0,200}missingSubserviceSelection/
    );
  });

  it("button title hints the user to pick subservices when blocked by this guard", () => {
    expect(WIZARD_SOURCE).toContain(
      "Selecciona un subservicio para cada servicio activo antes de continuar."
    );
  });
});

describe("projections.create mutation — subserviceId propagation", () => {
  it("validator accepts an optional subserviceId per service config", () => {
    expect(PROJECTIONS_MUT_SOURCE).toMatch(
      /subserviceId:\s*v\.optional\(\s*v\.id\(\s*"subservices"\s*\)\s*\)/
    );
  });

  it("persists subserviceId on the projectionServices insert", () => {
    expect(PROJECTIONS_MUT_SOURCE).toMatch(
      /insert\(\s*"projectionServices"[\s\S]+?subserviceId:\s*serviceConfig\.subserviceId/
    );
  });

  it("persists subserviceId on the monthlyAssignments insert", () => {
    expect(PROJECTIONS_MUT_SOURCE).toMatch(
      /insert\(\s*"monthlyAssignments"[\s\S]+?subserviceId:\s*serviceConfig\.subserviceId/
    );
  });

  it("wizard submit forwards subserviceId in each serviceConfigs entry", () => {
    expect(WIZARD_SOURCE).toMatch(
      /serviceConfigs:\s*serviceStates\.map\(\(s\)\s*=>\s*\(\{[\s\S]+?subserviceId:\s*s\.subserviceId/
    );
  });
});
