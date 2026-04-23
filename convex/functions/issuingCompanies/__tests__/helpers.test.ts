import { describe, it, expect } from "vitest";
import { SAT_REGIMENES, validateRegimenFiscal, getRegimenLabel } from "../helpers";

describe("SAT_REGIMENES catalog", () => {
  it("includes the 4 most common régimenes", () => {
    const codes = SAT_REGIMENES.map((r) => r.code);
    expect(codes).toContain("601"); // General de Ley PM
    expect(codes).toContain("603"); // PM con Fines No Lucrativos
    expect(codes).toContain("612"); // Persona Física Actividad Empresarial
    expect(codes).toContain("626"); // RESICO
  });
});

describe("validateRegimenFiscal", () => {
  it("accepts a valid code", () => {
    expect(validateRegimenFiscal("601")).toBe(true);
  });
  it("rejects an unknown code", () => {
    expect(validateRegimenFiscal("999")).toBe(false);
  });
  it("rejects empty string", () => {
    expect(validateRegimenFiscal("")).toBe(false);
  });
});

describe("getRegimenLabel", () => {
  it("returns the label for a valid code", () => {
    expect(getRegimenLabel("601")).toMatch(/General de Ley/i);
  });
  it("returns null for an unknown code", () => {
    expect(getRegimenLabel("999")).toBeNull();
  });
});
