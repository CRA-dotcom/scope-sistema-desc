/**
 * Source-level tests for missing-subservice guards in generation paths.
 * Spec: docs/superpowers/specs/2026-05-22-monthly-subservice-selection-design.md §3.3
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ACTIONS = readFileSync(
  resolve(__dirname, "../actions.ts"),
  "utf-8"
);
const INVOICE_FLOW = readFileSync(
  resolve(__dirname, "../invoiceFlow.ts"),
  "utf-8"
);

describe("generation guards on missing subservice", () => {
  it("generateDeliverable throws when assignment.subserviceId is missing", () => {
    expect(ACTIONS).toContain("Selecciona el subservicio del mes");
    expect(ACTIONS).toMatch(/!assignment\.subserviceId/);
  });

  it("generateFromInvoice returns missing_subservice and logs an error event", () => {
    expect(INVOICE_FLOW).toContain("missing_subservice");
    expect(INVOICE_FLOW).toMatch(/!assignment\??\.subserviceId/);
  });
});
