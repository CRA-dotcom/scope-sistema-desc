import type { SheetData } from "./excelParser";

export const PROMPT_VERSION = "v1-2026-05-27";

const MAX_ROWS_FOR_PROMPT = 100;

const SYSTEM =
  "Eres un asistente que extrae line items de estados financieros mexicanos.";

const INSTRUCTIONS = `Reglas:
- amount es un número positivo SIEMPRE (no negativos; usa category para indicar dirección)
- category ∈ {"ingresos","gastos_operativos","impuestos","otros"}
- satConcept solo si reconoces uno claramente
- Ignora encabezados, totales y filas vacías
- Si una columna parece nombre de cuenta y otra cantidad, esos son los line items

Devuelve SOLO JSON con este shape, sin texto adicional:
{"lineItems":[{"label":"...","amount":N,"category":"...","satConcept":null}]}`;

export type ExtractionCategory =
  | "ingresos"
  | "gastos_operativos"
  | "impuestos"
  | "otros";

const CATEGORIES: ExtractionCategory[] = [
  "ingresos",
  "gastos_operativos",
  "impuestos",
  "otros",
];

export type ExtractedLineItem = {
  label: string;
  amount: number;
  category: ExtractionCategory;
  satConcept?: string;
};

export function buildExtractionPrompt(sheets: SheetData[]): {
  system: string;
  user: string;
} {
  const truncated = sheets.map((s) => ({
    sheet: s.sheetName,
    rows: s.rows.slice(0, MAX_ROWS_FOR_PROMPT),
  }));
  return {
    system: SYSTEM,
    user: `${INSTRUCTIONS}\n\nExcel sheets:\n${JSON.stringify(truncated)}`,
  };
}

export function parseExtractionResponse(rawJson: string): ExtractedLineItem[] {
  let clean = rawJson.trim();
  // Strip surrounding code fences (```json ... ``` or ``` ... ```)
  if (clean.startsWith("```")) {
    clean = clean.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  const parsed = JSON.parse(clean);
  if (!parsed || !Array.isArray(parsed.lineItems)) {
    throw new Error("Response missing lineItems array");
  }
  return parsed.lineItems
    .filter(
      (item: any) =>
        item &&
        typeof item.label === "string" &&
        typeof item.amount === "number" &&
        Number.isFinite(item.amount) &&
        CATEGORIES.includes(item.category)
    )
    .map((item: any) => ({
      label: item.label,
      amount: Math.abs(item.amount),
      category: item.category as ExtractionCategory,
      satConcept:
        typeof item.satConcept === "string" && item.satConcept.length > 0
          ? item.satConcept
          : undefined,
    }));
}
