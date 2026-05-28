import { describe, it, expect } from "vitest";
import {
  PROMPT_VERSION,
  buildExtractionPrompt,
  parseExtractionResponse,
} from "../financialExtractionPrompt";
import type { SheetData } from "../excelParser";

const SHEET_FIXTURE: SheetData[] = [
  {
    sheetName: "P&L",
    rows: [
      ["Concepto", "Monto"],
      ["Ingresos por servicios", 150000],
      ["Gastos operativos", 50000],
    ],
  },
];

describe("PROMPT_VERSION", () => {
  it("is a non-empty string", () => {
    expect(typeof PROMPT_VERSION).toBe("string");
    expect(PROMPT_VERSION.length).toBeGreaterThan(0);
  });
});

describe("buildExtractionPrompt", () => {
  it("returns system + user with sheet JSON embedded", () => {
    const { system, user } = buildExtractionPrompt(SHEET_FIXTURE);

    expect(system).toContain("estados financieros");
    expect(user).toContain("P&L");
    expect(user).toContain("Ingresos por servicios");
    expect(user).toContain("ingresos");
  });

  it("includes the category enum in the rules", () => {
    const { user } = buildExtractionPrompt(SHEET_FIXTURE);
    expect(user).toContain("ingresos");
    expect(user).toContain("gastos_operativos");
    expect(user).toContain("impuestos");
    expect(user).toContain("otros");
  });

  it("caps rows per sheet at 100 inside the prompt", () => {
    const bigRows = Array.from({ length: 250 }, (_, i) => [`row-${i}`, i]);
    const { user } = buildExtractionPrompt([
      { sheetName: "Big", rows: bigRows },
    ]);
    // row-99 should appear; row-150 should not (cap = 100)
    expect(user).toContain("row-99");
    expect(user).not.toContain("row-150");
  });
});

describe("parseExtractionResponse", () => {
  it("parses well-formed JSON", () => {
    const raw = JSON.stringify({
      lineItems: [
        { label: "Ingresos", amount: 150000, category: "ingresos" },
        {
          label: "Gastos",
          amount: 50000,
          category: "gastos_operativos",
        },
      ],
    });
    const items = parseExtractionResponse(raw);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      label: "Ingresos",
      amount: 150000,
      category: "ingresos",
      satConcept: undefined,
    });
  });

  it("strips ```json code fences", () => {
    const raw = "```json\n" +
      JSON.stringify({
        lineItems: [{ label: "X", amount: 100, category: "otros" }],
      }) +
      "\n```";
    const items = parseExtractionResponse(raw);
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe("X");
  });

  it("strips bare ``` code fences", () => {
    const raw = "```\n" +
      JSON.stringify({
        lineItems: [{ label: "Y", amount: 200, category: "impuestos" }],
      }) +
      "\n```";
    const items = parseExtractionResponse(raw);
    expect(items).toHaveLength(1);
    expect(items[0].category).toBe("impuestos");
  });

  it("forces amount to positive via Math.abs", () => {
    const raw = JSON.stringify({
      lineItems: [
        { label: "Gasto neg", amount: -500, category: "gastos_operativos" },
      ],
    });
    const items = parseExtractionResponse(raw);
    expect(items[0].amount).toBe(500);
  });

  it("filters items with invalid category", () => {
    const raw = JSON.stringify({
      lineItems: [
        { label: "Ok", amount: 100, category: "ingresos" },
        { label: "Bad", amount: 100, category: "trash" },
      ],
    });
    const items = parseExtractionResponse(raw);
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe("Ok");
  });

  it("filters items missing required fields", () => {
    const raw = JSON.stringify({
      lineItems: [
        { label: "Ok", amount: 100, category: "ingresos" },
        { amount: 100, category: "ingresos" },
        { label: "NoAmount", category: "ingresos" },
        { label: "BadAmount", amount: "not-a-num", category: "ingresos" },
      ],
    });
    const items = parseExtractionResponse(raw);
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe("Ok");
  });

  it("preserves satConcept when provided", () => {
    const raw = JSON.stringify({
      lineItems: [
        {
          label: "X",
          amount: 100,
          category: "ingresos",
          satConcept: "84111506",
        },
      ],
    });
    const items = parseExtractionResponse(raw);
    expect(items[0].satConcept).toBe("84111506");
  });

  it("throws on JSON missing lineItems array", () => {
    const raw = JSON.stringify({ other: "value" });
    expect(() => parseExtractionResponse(raw)).toThrow(/lineItems/);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseExtractionResponse("not json at all")).toThrow();
  });
});
