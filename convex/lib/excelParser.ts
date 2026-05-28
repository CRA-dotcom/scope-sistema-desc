import * as XLSX from "xlsx";

export type SheetData = {
  sheetName: string;
  rows: any[][];
};

const MAX_SHEETS = 3;
const MAX_ROWS_PER_SHEET = 200;

export function parseExcel(buffer: ArrayBuffer | Uint8Array): SheetData[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheets: SheetData[] = [];
  for (const name of wb.SheetNames.slice(0, MAX_SHEETS)) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], {
      header: 1,
      defval: null,
    }) as any[][];
    sheets.push({ sheetName: name, rows: rows.slice(0, MAX_ROWS_PER_SHEET) });
  }
  return sheets;
}
