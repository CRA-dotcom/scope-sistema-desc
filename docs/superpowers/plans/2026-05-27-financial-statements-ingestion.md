# Sub-spec 4 — Financial Statements Ingestion Implementation Plan (V1)

> **For agentic workers:** Subagent-driven. ~14 tasks across 5 phases. Estimated 5-7 days.

**Goal:** V1 ingestion of client financial statements (Excel only). AI extraction with Claude. Admin validates. Feed to `generateDeliverable` for financial-related subservices.

**Status:** Spec at `docs/superpowers/specs/2026-05-27-financial-statements-ingestion-design.md`. Execution NOT yet started.

**Test baseline (at SS6 close):** 951. Target post-merge: ≥970.

---

## File Structure

### New files
- `convex/lib/excelParser.ts` — Pure helper using `xlsx` to read buffers → sheet rows
- `convex/lib/__tests__/excelParser.test.ts`
- `convex/lib/financialExtractionPrompt.ts` — Build the Claude prompt + parse response
- `convex/lib/__tests__/financialExtractionPrompt.test.ts`
- `convex/functions/clientFinancialData/actions.ts` — upload + extractInternal
- `convex/functions/clientFinancialData/mutations.ts` — markValidated, markRejected, deleteRecord, manuallySetLineItems
- `convex/functions/clientFinancialData/queries.ts` — listByClient, getFinancialContext
- `convex/functions/clientFinancialData/internalQueries.ts` — internal lookups
- `convex/functions/clientFinancialData/internalMutations.ts` — insertRow, patchExtraction
- `convex/functions/clientFinancialData/__tests__/upload.test.ts`
- `convex/functions/clientFinancialData/__tests__/extractInternal.test.ts`
- `convex/functions/clientFinancialData/__tests__/markValidated.test.ts`
- `convex/functions/clientFinancialData/__tests__/getFinancialContext.test.ts`
- `src/app/(dashboard)/clientes/[id]/finanzas/page.tsx` — UI page
- `src/app/(dashboard)/clientes/[id]/finanzas/components/UploadForm.tsx`
- `src/app/(dashboard)/clientes/[id]/finanzas/components/PeriodsTable.tsx`
- `src/app/(dashboard)/clientes/[id]/finanzas/components/ViewerDrawer.tsx`

### Modified files
- `convex/schema.ts` — Add `clientFinancialData` table + `subservices.isFinancialRelated`
- `convex/functions/deliverables/actions.ts` — Inject financial context when subservice.isFinancialRelated
- `package.json` — Add `xlsx` dependency (if not already)

---

## Execution order

```
Phase 1: Schema + dependencies          (Tasks 1-2)
Phase 2: Parsers + AI prompt            (Tasks 3-4)
Phase 3: Actions + mutations            (Tasks 5-7)
Phase 4: Queries                        (Tasks 8-9)
Phase 5: UI                             (Tasks 10-12)
Phase 6: Feed integration + smoke       (Tasks 13-14)
```

---

## Task 1: Schema

Add `clientFinancialData` table + `subservices.isFinancialRelated`. See spec §4 for exact field list and indexes.

Run `npx convex dev --once` to verify codegen.

Commit: `schema(ss4): add clientFinancialData table + isFinancialRelated flag`

---

## Task 2: Install `xlsx` dependency

```bash
npm install xlsx
```

Verify `package.json` lists it. Run `npm test` to confirm no breakage from install.

Commit: `chore(ss4): add xlsx dependency for Excel parsing`

---

## Task 3: `excelParser` helper

`convex/lib/excelParser.ts`:

```ts
import * as XLSX from "xlsx";

export type SheetData = {
  sheetName: string;
  rows: any[][];  // 2D array, first row often header
};

const MAX_SHEETS = 3;
const MAX_ROWS_PER_SHEET = 200;

export function parseExcel(buffer: ArrayBuffer): SheetData[] {
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
```

Tests in `convex/lib/__tests__/excelParser.test.ts`:
- Parse a simple Excel buffer (build via XLSX.utils.aoa_to_sheet + write to buffer in test setup)
- Truncates to MAX_SHEETS / MAX_ROWS_PER_SHEET
- Handles empty workbook
- Handles missing cells (returns null in slots)

TDD red → impl → green. Commit: `feat(ss4): excelParser helper using xlsx`

---

## Task 4: Financial extraction prompt + parser

`convex/lib/financialExtractionPrompt.ts`:

```ts
import type { SheetData } from "./excelParser";

export const PROMPT_VERSION = "v1-2026-05-27";

const SYSTEM = `Eres un asistente que extrae line items de estados financieros mexicanos.`;

const INSTRUCTIONS = `
Reglas:
- amount es número positivo SIEMPRE (no negativos)
- category ∈ {"ingresos","gastos_operativos","impuestos","otros"}
- Ignora encabezados/totales/filas vacías
- Devuelve JSON: {"lineItems":[{"label":"...","amount":N,"category":"...","satConcept":null}]}
`;

export function buildExtractionPrompt(sheets: SheetData[]): { system: string; user: string } {
  const truncated = sheets.map(s => ({
    sheet: s.sheetName,
    rows: s.rows.slice(0, 100),
  }));
  return {
    system: SYSTEM,
    user: `${INSTRUCTIONS}\n\nExcel sheets:\n${JSON.stringify(truncated)}`,
  };
}

export type ExtractedLineItem = {
  label: string;
  amount: number;
  category: "ingresos" | "gastos_operativos" | "impuestos" | "otros";
  satConcept?: string;
};

export function parseExtractionResponse(rawJson: string): ExtractedLineItem[] {
  // Robust parsing: strip code fences if present, JSON.parse, validate shape.
  let clean = rawJson.trim();
  if (clean.startsWith("```")) clean = clean.replace(/^```(json)?\n?|\n?```$/g, "");
  const parsed = JSON.parse(clean);
  if (!parsed || !Array.isArray(parsed.lineItems)) {
    throw new Error("Response missing lineItems array");
  }
  return parsed.lineItems.filter((item: any) =>
    item && typeof item.label === "string" && typeof item.amount === "number" && ["ingresos","gastos_operativos","impuestos","otros"].includes(item.category)
  ).map((item: any) => ({
    label: item.label,
    amount: Math.abs(item.amount),  // ensure positive
    category: item.category,
    satConcept: item.satConcept || undefined,
  }));
}
```

Tests: prompt builds correctly, parser handles code fences / strict JSON / invalid shapes (throws / filters).

Commit: `feat(ss4): financialExtractionPrompt + response parser`

---

## Task 5: `upload` action

`convex/functions/clientFinancialData/actions.ts`:
- Args: `clientId`, `period`, `periodType`, `filename`, `contentType`, `fileBuffer: v.bytes()`
- Validates file type (must be Excel content type or extension)
- Validates period format per periodType
- Calls `uploadBlob` (Railway S3) with key pattern
- Inserts row via `internalMutations.insertRow` (status='uploaded')
- Schedules `extractInternal`

Tests: upload writes blob + row + schedules; rejects invalid period; rejects non-Excel.

Commit: `feat(ss4): clientFinancialData upload action`

---

## Task 6: `extractInternal` action (AI extraction)

Action:
- Signed download URL → fetch buffer
- `parseExcel(buffer)` → sheets
- `buildExtractionPrompt(sheets)` → prompt
- Call Claude API (mirror pattern from `convex/functions/deliverables/actions.ts`)
- `parseExtractionResponse(rawText)` → lineItems
- Patch row with lineItems + aiExtraction metadata + status='extracted'
- Retry 3x on Claude API failure; final failure sets status='error' + errorMessage

Tests: mocked Claude returns valid JSON → row patched correctly; mocked failure → status='error' after retries.

Commit: `feat(ss4): extractInternal action with Claude AI extraction`

---

## Task 7: Validation mutations

`convex/functions/clientFinancialData/mutations.ts`:
- `markValidated({ id })`
- `markRejected({ id, reason })`
- `deleteRecord({ id })` (also calls deleteBlob from Railway)
- `manuallySetLineItems({ id, lineItems })`

Each admin-only, org-scoped, transitions validated by status check. Tests for each.

Commit: `feat(ss4): clientFinancialData validation + edit mutations`

---

## Task 8: `listByClient` query

`convex/functions/clientFinancialData/queries.ts`:
- Args: `clientId` (optional `periodType`)
- Returns rows ordered by `period` desc
- Auth: admin only, scoped to org

Tests: filtered + ordering correct.

Commit: `feat(ss4): listByClient query`

---

## Task 9: `getFinancialContext` query

Internal + public version.

Args: `clientId`, `periodType`, `asOfPeriod` (string).

Logic:
- Filter rows by clientId + status='validated' + periodType
- Filter rows where `row.period <= asOfPeriod` (string comparison works for `YYYY-MM` and `YYYY-Qn` formats given padding)
- Sort by period desc, take first
- Return row or null

Tests: returns most recent validated, ignores non-validated, returns null when none.

Commit: `feat(ss4): getFinancialContext query`

---

## Task 10: UI page skeleton + UploadForm

`src/app/(dashboard)/clientes/[id]/finanzas/page.tsx`:
- Use `useParams` for clientId
- Render UploadForm + PeriodsTable

`UploadForm.tsx`:
- File input + period text input + periodType select
- Submit calls `upload` action

Commit: `feat(ss4): /clientes/[id]/finanzas page + UploadForm`

---

## Task 11: PeriodsTable + status chips

`PeriodsTable.tsx`:
- Pulls from `listByClient` query
- Table with cols: period | periodType | status (chip) | lineCount | uploadedAt | actions
- Row click opens ViewerDrawer

Commit: `feat(ss4): PeriodsTable component`

---

## Task 12: ViewerDrawer

`ViewerDrawer.tsx`:
- Side drawer with file metadata + extraction metadata
- LineItems grouped by category with category subtotals
- Actions: Validar, Rechazar (con modal pidiendo razón), Borrar (con confirm), Descargar archivo

Commit: `feat(ss4): ViewerDrawer with validate/reject/delete actions`

---

## Task 13: Feed into `generateDeliverable`

In `convex/functions/deliverables/actions.ts`:
- Before building prompt, check if `subservice.isFinancialRelated === true`
- If yes, call `getFinancialContext({ clientId, periodType: 'monthly', asOfPeriod: '${year}-${month}' })`
- If returned row exists, format lineItems as text and append to prompt

Tests: existing deliverable tests should still pass; new test: when subservice.isFinancialRelated, financial context inserted into prompt.

Commit: `feat(ss4): generateDeliverable includes financial context for financial subservices`

---

## Task 14: Smoke + handoff

- Run full test suite (target ≥970).
- TS clean.
- Smoke browser flow: upload Excel → wait for extraction → validate → generate deliverable for financial subservice → verify financial data appears in Claude context.
- Update Handoff.md.

Commit: `docs(handoff): SS4 V1 financial statements ingestion complete`

---

## Self-Review

Spec coverage: §4 schema → T1; §5 parser → T3; §6 AI → T4+T6; §7 mutations → T7; §8 UI → T10-12; §9 feed → T13. All covered.

No placeholders.

Type consistency: `ExtractedLineItem` consistent across prompt parser and schema validation.

Estimated tasks: 14. Estimated tests new: ~25.
