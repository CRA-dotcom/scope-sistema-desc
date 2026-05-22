/**
 * Regression test: projections.create no longer auto-inherits
 * serviceConfig.subserviceId into monthlyAssignments.
 * Spec: docs/superpowers/specs/2026-05-22-monthly-subservice-selection-design.md §3.2
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(
  resolve(__dirname, "../mutations.ts"),
  "utf-8"
);

describe("projections create — monthlyAssignments no longer inherits subserviceId", () => {
  it("does not pass subserviceId: serviceConfig.subserviceId in any monthlyAssignments insert", () => {
    expect(SOURCE).not.toMatch(/subserviceId:\s*serviceConfig\.subserviceId/);
  });
});
