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

// The downstream build logic (projectionServices + monthlyAssignments insert)
// was extracted to a shared helper in buildProjectionDownstream.ts.
// Source gates that check insert patterns must read from the helper file.
const BUILD_DOWNSTREAM_SOURCE = readFileSync(
  resolve(
    __dirname,
    "../../../../../convex/lib/buildProjectionDownstream.ts"
  ),
  "utf-8"
);

describe("wizard Step 2 — subservice checkboxes (#9 multi-select)", () => {
  it("ServiceFormState carries a subserviceIds array field (multi-select)", () => {
    expect(WIZARD_SOURCE).toMatch(
      /subserviceIds\s*:\s*string\[\]/
    );
  });

  it("prefetches subservices via listAllForOrg (batched, not N+1)", () => {
    expect(WIZARD_SOURCE).toMatch(
      /useQuery\(\s*api\.functions\.subservices\.queries\.listAllForOrg/
    );
  });

  it("groups subservices by parentServiceId for per-row lookup", () => {
    expect(WIZARD_SOURCE).toContain("subservicesByParent");
    expect(WIZARD_SOURCE).toContain("parentServiceId");
  });

  it("renders checkboxes (type=checkbox) for multi-select under each active service row", () => {
    expect(WIZARD_SOURCE).toContain('type="checkbox"');
    expect(WIZARD_SOURCE).toMatch(/aria-label=\{`Subservicio/);
  });

  it("each subservice option label includes name and defaultFrequency", () => {
    // The label renders both {o.name} and {o.defaultFrequency}
    expect(WIZARD_SOURCE).toContain("{o.name}");
    expect(WIZARD_SOURCE).toContain("{o.defaultFrequency}");
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
    // The computation considers s.subserviceIds.length === 0 for active services that have options.
    expect(WIZARD_SOURCE).toMatch(/subserviceIds\.length\s*===\s*0/);
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

describe("projections.create mutation — subserviceIds propagation (#9)", () => {
  it("validator accepts optional subserviceIds array per service config (scalar dropped)", () => {
    // Only the array form is now accepted — scalar subserviceId removed from create args.
    expect(PROJECTIONS_MUT_SOURCE).toMatch(
      /subserviceIds:\s*v\.optional\(\s*v\.array\(\s*v\.id\(\s*"subservices"\s*\)\s*\)\s*\)/
    );
    expect(PROJECTIONS_MUT_SOURCE).not.toMatch(
      /serviceId.*\n.*subserviceId:\s*v\.optional\(\s*v\.id\(\s*"subservices"\s*\)\s*\)/
    );
  });

  it("does NOT write scalar subserviceId on the projectionServices insert (field dropped)", () => {
    // The scalar was removed from buildProjectionDownstream — only subserviceIds[] is written.
    expect(BUILD_DOWNSTREAM_SOURCE).not.toMatch(
      /insert\(\s*"projectionServices"[\s\S]+?subserviceId:\s*legacySubserviceId/
    );
    expect(BUILD_DOWNSTREAM_SOURCE).toMatch(
      /insert\(\s*"projectionServices"[\s\S]+?subserviceIds:/
    );
  });

  it("does NOT persist subserviceId on monthlyAssignments insert (per spec 2026-05-22 — operator picks per-cell)", () => {
    expect(PROJECTIONS_MUT_SOURCE).not.toMatch(
      /insert\(\s*"monthlyAssignments"[\s\S]+?subserviceId:\s*serviceConfig\.subserviceId/
    );
  });

  it("wizard submit forwards subserviceIds in each serviceConfigs entry", () => {
    expect(WIZARD_SOURCE).toMatch(
      /serviceConfigs:\s*serviceStates\.map\(\(s\)\s*=>\s*\(\{[\s\S]+?subserviceIds/
    );
  });
});
