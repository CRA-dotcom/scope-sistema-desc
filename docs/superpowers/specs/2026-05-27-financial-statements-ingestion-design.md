# Sub-spec 4 — Estados financieros: ingestion + persistencia

**Fecha:** 2026-05-27
**Estado:** Diseño V1 (autopilot — execution deferred to next session por scope)
**Origen:** `docs/superpowers/specs/2026-05-22-papa-call-scale-pending-detailed-spec.md` §3 Sub-spec 4
**Estimado impl V1:** 5-7 días (Excel + AI extraction + UI básico + feed a entregables)
**Bloquea:** nada

---

## 1. Resumen ejecutivo

V1: Admin sube un Excel con estados financieros del cliente para un periodo (mensual/trimestral/anual). El sistema sube el blob a Railway S3, crea row en `clientFinancialData` con status `uploaded`, encola una acción de extracción AI (Claude). La acción lee el Excel, mapea columnas → line items estructurados con category (ingresos/gastos/impuestos), patcha el row con `status=extracted`. Admin revisa los line items extraídos en `/clientes/[id]/finanzas` y marca como `validated` (o `rejected` con razón). Cuando `generateDeliverable` corre para un entregable financiero (template de subservicio contable), el contexto Claude incluye snapshot de los line items del periodo más cercano.

V2 (post-MVP): PDF + OCR, comparativas multi-periodo, edit inline de line items, dashboard agregado.

## 2. Requirements

- R1. Tabla `clientFinancialData` con: `orgId`, `clientId`, `period` (string `YYYY-MM` / `YYYY-Qn` / `YYYY`), `periodType`, blob metadata, `lineItems[]`, `aiExtraction` metadata, lifecycle `status`.
- R2. Upload action: acepta Excel (`.xlsx`, `.xls`, content-type variants), valida tamaño/tipo, sube blob a Railway S3 (key pattern `<orgId>/<clientId>/finanzas/<period>-<filename>`), inserta row `status='uploaded'`, schedule extraction action.
- R3. Extraction action (AI): lee blob de S3, usa Claude para mapear columnas → line items con categorización (ingresos / gastos_operativos / impuestos / otros). Patch row con `lineItems[]`, `aiExtraction { model, promptVersion, extractedAt, cost }`, `status='extracted'`. Retry 3x con exp backoff.
- R4. Validation mutation: admin marca row como `validated` o `rejected` (con razón). Log en `documentEvents`.
- R5. Query `listByClient`: returns rows del cliente, ordenado por period desc.
- R6. Query `getFinancialContext({ clientId, periodType, asOfDate })`: returns el row más reciente del cliente para ese periodType cuyo `period` <= asOfDate (parsing simple). Devuelve `null` si no hay validados (V1 usa solo validados como source of truth para feed a Claude).
- R7. UI `/clientes/[id]/finanzas`:
  - Upload form (file picker + period selector + periodType selector)
  - Tabla de periodos: period | tipo | status (chip) | extracted line count | uploadedAt | acciones (Ver detalles, Validar, Rechazar, Borrar)
  - Drawer viewer: muestra line items extraídos, agrupados por category
- R8. Feed a entregables: modificar `convex/functions/deliverables/actions.ts` para que cuando el template del subservicio sea "financial-related" (TBD: tag o campo en subservices), inyecte el último `getFinancialContext` validado al prompt Claude.

## 3. Arquitectura

```
┌──────────────────────────────────────────────────────────┐
│  Admin UI /clientes/[id]/finanzas                          │
│   Upload Excel + period + periodType                       │
└────────────────────────┬─────────────────────────────────┘
                         │ action upload
                         ▼
┌──────────────────────────────────────────────────────────┐
│  clientFinancialData.actions.upload                        │
│   - validate file type/size                                │
│   - uploadBlob to Railway S3                              │
│   - insertRow (status='uploaded')                         │
│   - scheduler.runAfter(0, extractInternal)                │
└────────────────────────┬─────────────────────────────────┘
                         │ async
                         ▼
┌──────────────────────────────────────────────────────────┐
│  clientFinancialData.actions.extractInternal               │
│   - signedDownloadUrl + fetch buffer                       │
│   - parseExcel(buffer) → raw rows                          │
│   - callClaude(rows) → structured lineItems[]              │
│   - patchRow (status='extracted', lineItems, aiExtraction)│
│   - documentEvents 'updated'                              │
└──────────────────────────────────────────────────────────┘
                         
┌──────────────────────────────────────────────────────────┐
│  Admin reviews extracted items in viewer drawer            │
│   Clicks "Validar" → markValidated                         │
│            or "Rechazar" → markRejected                    │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  generateDeliverable (modified)                            │
│   if subservice.isFinancialRelated:                        │
│     ctx = getFinancialContext(client, period, asOf)        │
│     promptIncludes(ctx.lineItems)                          │
└──────────────────────────────────────────────────────────┘
```

## 4. Schema

```ts
clientFinancialData: defineTable({
  orgId: v.string(),
  clientId: v.id("clients"),
  period: v.string(),  // "2026-01" / "2026-Q1" / "2026"
  periodType: v.union(
    v.literal("monthly"),
    v.literal("quarterly"),
    v.literal("annual"),
  ),
  bucketKey: v.string(),   // Railway S3
  contentType: v.string(),
  sizeBytes: v.number(),
  filename: v.string(),
  lineItems: v.array(
    v.object({
      label: v.string(),
      amount: v.number(),
      category: v.union(
        v.literal("ingresos"),
        v.literal("gastos_operativos"),
        v.literal("impuestos"),
        v.literal("otros"),
      ),
      satConcept: v.optional(v.string()),
    })
  ),
  aiExtraction: v.optional(
    v.object({
      model: v.string(),
      promptVersion: v.string(),
      extractedAt: v.number(),
      costUsd: v.optional(v.number()),
      rawSnippet: v.optional(v.string()),  // first 500 chars of raw LLM output for debug
    })
  ),
  status: v.union(
    v.literal("uploaded"),
    v.literal("extracted"),
    v.literal("validated"),
    v.literal("rejected"),
    v.literal("error"),  // extraction failed all retries
  ),
  rejectionReason: v.optional(v.string()),
  uploadedBy: v.string(),
  uploadedAt: v.number(),
  validatedBy: v.optional(v.string()),
  validatedAt: v.optional(v.number()),
  errorMessage: v.optional(v.string()),
})
  .index("by_orgId_clientId", ["orgId", "clientId"])
  .index("by_orgId_clientId_period", ["orgId", "clientId", "period"])
  .index("by_orgId_status", ["orgId", "status"])
```

Add to `subservices` (optional, V1 use a tag-based check):
```ts
  isFinancialRelated: v.optional(v.boolean()),
```

Mark via existing config UI or hardcode subservice slugs for V1 ("contabilidad", "estados-financieros", etc.).

## 5. Excel parsing

Use `xlsx` npm package (mature, server-side). Action reads buffer → array of `{ sheetName, rows: string[][] }`. Sends to Claude as JSON.

```ts
import * as XLSX from "xlsx";

function parseExcel(buffer: Buffer): { sheetName: string; rows: any[][] }[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  return wb.SheetNames.map(name => ({
    sheetName: name,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null }) as any[][],
  }));
}
```

Truncate to first 3 sheets / 200 rows per sheet to keep prompt bounded.

## 6. AI extraction

Prompt structure (V1):
```
Eres un asistente que extrae line items de un estado financiero en Excel.
Te paso las hojas del archivo. Devuelve JSON con este shape:
{
  "lineItems": [
    {
      "label": "Ingresos por servicios profesionales",
      "amount": 150000.50,
      "category": "ingresos" | "gastos_operativos" | "impuestos" | "otros",
      "satConcept": null
    }
  ]
}

Reglas:
- amount es un número positivo SIEMPRE (no negativos; usa category para indicar dirección)
- category obligatoria
- satConcept solo si reconoces uno claramente (ej. "84111506" para servicios)
- Ignora filas vacías, totales, encabezados
- Si una columna parece nombre de cuenta y otra cantidad, esos son los line items

Excel sheets:
{{sheets_json}}
```

Call via existing pattern in `convex/functions/deliverables/actions.ts` (Anthropic SDK + retry 3x).

Cost estimation log to `aiExtraction.costUsd`.

## 7. Mutations

- `markValidated({ id })` — admin only, row.status='extracted' required, sets validatedBy/validatedAt, status='validated'. Logs documentEvents.
- `markRejected({ id, reason })` — admin only, sets rejectionReason, status='rejected'. Logs.
- `deleteRecord({ id })` — admin only, removes blob from S3 + deletes row.
- `manuallySetLineItems({ id, lineItems })` — admin only, allows editing after extraction. Tags `aiExtraction.editedAt`. (V1 minimal; full edit inline V2.)

## 8. UI

`/clientes/[id]/finanzas` page:
- Top: upload form (`<input type="file" accept=".xlsx,.xls">`, period text input with regex hint, periodType select).
- Middle: table of periods (ordered by period desc).
- Bottom: empty state if no data.

Drawer viewer:
- Triggered by clicking a row.
- Shows: file metadata (filename, size, uploaded), aiExtraction metadata (model, cost), lineItems grouped by category with totals.
- Actions: "Validar", "Rechazar (con razón)", "Borrar", "Descargar PDF original" (signed URL).

## 9. Feed a `generateDeliverable`

In `convex/functions/deliverables/actions.ts`, before constructing the Claude prompt:

```ts
const isFinancialRelated = subservice?.isFinancialRelated ?? false; // or by slug match
let financialContext: string | undefined;
if (isFinancialRelated) {
  const ctx = await ctx.runQuery(internal.functions.clientFinancialData.queries.getFinancialContext, {
    clientId,
    asOfPeriod: `${year}-${String(month).padStart(2, "0")}`,
    periodType: "monthly",
  });
  if (ctx && ctx.status === "validated") {
    financialContext = formatLineItemsForPrompt(ctx.lineItems);
  }
}

// Include in prompt if available
const userPrompt = `${basePrompt}${financialContext ? `\n\nContexto financiero del cliente:\n${financialContext}` : ""}`;
```

## 10. Testing

**Unit (~8 tests):**
- Excel parser (mocked buffer)
- AI extraction mock (mocked Claude response → row patched correctly)
- Mutations: markValidated/markRejected/deleteRecord with auth + transition rules

**Integration (~5 tests):**
- Upload → row uploaded → extraction action mocked → status='extracted' with lineItems
- Validation flow
- getFinancialContext returns most recent validated row
- generateDeliverable includes financial context when subservice.isFinancialRelated

**Target:** +13 tests.

## 11. Decisiones diferidas

- **PDF + OCR ingestion** — V2. Add Claude vision when stable.
- **Edit inline de line items** — V1 tiene `manuallySetLineItems` (replace all); inline V2.
- **Comparativas multi-periodo** — V2 dashboard.
- **SAT concept auto-mapping** — V1 opcional, V2 con catalog lookup.
- **Soporte para múltiples archivos por periodo** — V1 single file per `(client, period)`.
- **isFinancialRelated tag on subservices** — V1 use either schema field OR hardcoded slug list; V2 surface in UI.

## 12. Próximo paso

Execution deferred to next session (scope warrants its own block). Plan listo en `docs/superpowers/plans/2026-05-27-financial-statements-ingestion.md` (próximo commit).
