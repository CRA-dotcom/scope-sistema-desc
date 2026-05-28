import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseExcel } from "../excelParser";

function buildWorkbook(
  sheets: { name: string; rows: any[][] }[]
): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return out as ArrayBuffer;
}

describe("parseExcel", () => {
  it("parses a single-sheet workbook into rows", () => {
    const buf = buildWorkbook([
      {
        name: "Hoja1",
        rows: [
          ["Concepto", "Monto"],
          ["Ingresos por servicios", 150000],
          ["Gastos operativos", 50000],
        ],
      },
    ]);

    const result = parseExcel(buf);

    expect(result).toHaveLength(1);
    expect(result[0].sheetName).toBe("Hoja1");
    expect(result[0].rows).toHaveLength(3);
    expect(result[0].rows[0]).toEqual(["Concepto", "Monto"]);
    expect(result[0].rows[1]).toEqual(["Ingresos por servicios", 150000]);
  });

  it("returns multiple sheets in workbook order", () => {
    const buf = buildWorkbook([
      { name: "P&L", rows: [["a", 1]] },
      { name: "Balance", rows: [["b", 2]] },
    ]);

    const result = parseExcel(buf);

    expect(result.map((s) => s.sheetName)).toEqual(["P&L", "Balance"]);
  });

  it("truncates to MAX_SHEETS (3)", () => {
    const buf = buildWorkbook([
      { name: "S1", rows: [["a"]] },
      { name: "S2", rows: [["b"]] },
      { name: "S3", rows: [["c"]] },
      { name: "S4", rows: [["d"]] },
      { name: "S5", rows: [["e"]] },
    ]);

    const result = parseExcel(buf);

    expect(result).toHaveLength(3);
    expect(result.map((s) => s.sheetName)).toEqual(["S1", "S2", "S3"]);
  });

  it("truncates to MAX_ROWS_PER_SHEET (200)", () => {
    const rows = Array.from({ length: 250 }, (_, i) => [`row-${i}`, i]);
    const buf = buildWorkbook([{ name: "Big", rows }]);

    const result = parseExcel(buf);

    expect(result[0].rows).toHaveLength(200);
    expect(result[0].rows[0]).toEqual(["row-0", 0]);
    expect(result[0].rows[199]).toEqual(["row-199", 199]);
  });

  it("handles empty workbook (no sheets after read)", () => {
    // Build a workbook with one sheet then strip it — fall back to single empty sheet.
    const buf = buildWorkbook([{ name: "Empty", rows: [] }]);

    const result = parseExcel(buf);

    // sheet exists but rows are empty (or absent)
    expect(result).toHaveLength(1);
    expect(result[0].sheetName).toBe("Empty");
    expect(result[0].rows).toEqual([]);
  });

  it("preserves null for missing cells via defval", () => {
    const buf = buildWorkbook([
      {
        name: "Sparse",
        rows: [
          ["A", "B", "C"],
          ["x", null, "z"],
        ],
      },
    ]);

    const result = parseExcel(buf);

    expect(result[0].rows[1]).toEqual(["x", null, "z"]);
  });
});
