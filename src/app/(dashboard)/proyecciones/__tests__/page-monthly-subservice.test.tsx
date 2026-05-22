/**
 * Source-level tests for the monthly subservice picker integrated
 * into the projection matrix.
 * Spec: docs/superpowers/specs/2026-05-22-monthly-subservice-selection-design.md §3.4
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PAGE = readFileSync(
  resolve(__dirname, "../[id]/page.tsx"),
  "utf-8"
);

function readPickerOrEmpty(): string {
  try {
    return readFileSync(
      resolve(
        __dirname,
        "../../../../components/projections/subservice-cell-picker.tsx"
      ),
      "utf-8"
    );
  } catch {
    return "";
  }
}
const PICKER = readPickerOrEmpty();

describe("/proyecciones/[id] — monthly subservice picker integration", () => {
  it("derives isAdmin from useOrganization membership role", () => {
    expect(PAGE).toContain('membership?.role === "org:admin"');
  });

  it("imports SubserviceCellPicker", () => {
    expect(PAGE).toContain("SubserviceCellPicker");
  });

  it("filters dropdown options by parentServiceId of the row", () => {
    expect(PAGE).toMatch(/parentServiceId\s*===\s*svc\.serviceId/);
  });

  it("renders destructive border when cell has no subservice", () => {
    expect(PAGE).toContain("border-destructive");
  });
});

describe("SubserviceCellPicker component contract", () => {
  it("exports the component", () => {
    expect(PICKER).toMatch(/export function SubserviceCellPicker/);
  });

  it("stops click propagation on its trigger (to prevent drawer open)", () => {
    expect(PICKER).toContain("stopPropagation");
  });

  it("offers a 'Sin subservicio' option for clearing the field", () => {
    expect(PICKER).toMatch(/Sin subservicio/i);
  });
});
