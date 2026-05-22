/**
 * Source-level tests for monthlyAssignments.setSubservice mutation.
 * Spec: docs/superpowers/specs/2026-05-22-monthly-subservice-selection-design.md §3.1
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(
  resolve(__dirname, "../mutations.ts"),
  "utf-8"
);

describe("monthlyAssignments.setSubservice", () => {
  it("exports setSubservice mutation", () => {
    expect(SOURCE).toMatch(/export const setSubservice\s*=\s*mutation/);
  });

  it("requires admin role", () => {
    expect(SOURCE).toContain("requireAdmin(ctx)");
  });

  it("validates subservice parentServiceId matches assignment's parent service", () => {
    expect(SOURCE).toMatch(
      /subservice\.parentServiceId\s*!==\s*projService\.serviceId/
    );
  });

  it("accepts null to clear the field", () => {
    expect(SOURCE).toMatch(
      /v\.union\(\s*v\.id\(\s*"subservices"\s*\)\s*,\s*v\.null\(\)\s*\)/
    );
  });
});
