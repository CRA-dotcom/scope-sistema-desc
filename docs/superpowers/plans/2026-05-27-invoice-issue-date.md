# Sub-spec 5 — Invoice Issue Date vs Payment Date Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate fiscal `issueDate` from operational `uploadedAt` on `invoices`. Auto-extract from CFDI XML when provided, manual fallback. Add filter by fiscal period in `/facturacion`. Generation triggers stay on `paidAt`.

**Architecture:** Add `issueDate: v.optional(v.number())` to `invoices`. Isolate CFDI XML parsing in `convex/lib/cfdiParser.ts` (regex-based, no full XML DOM). Upload action resolves date via XML > manual > undefined. New mutation `updateIssueDate` for post-upload edits. Migration backfills existing rows with `uploadedAt`. UI adds column, filter range, upload form fields, edit modal.

**Tech Stack:** Convex (DB + actions + mutations + queries), Next.js 15 + React 19, Tailwind + shadcn/ui, Vitest + convex-test, `setupTest` harness from `tests/harness.ts`.

**Spec:** `docs/superpowers/specs/2026-05-27-invoice-issue-date-design.md`

**Test baseline:** 905 passed | 1 skipped. Target post-merge: ≥920.

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `convex/lib/cfdiParser.ts` | Pure helper to extract `Fecha` attribute from CFDI XML buffer; returns discriminated union `{ ok: true, issueDate } \| { ok: false, reason }` |
| `convex/lib/__tests__/cfdiParser.test.ts` | Unit tests: CFDI 4.0, 3.3, missing attribute, malformed XML, invalid date |
| `convex/functions/migrations/invoiceIssueDate.ts` | Cursor-paginated backfill `issueDate = uploadedAt` for rows where `issueDate === undefined` |
| `convex/functions/migrations/__tests__/invoiceIssueDate.test.ts` | Tests: backfills, idempotent, skips already-set rows |
| `convex/functions/invoices/__tests__/updateIssueDate.test.ts` | Tests: admin updates, void rejects, cross-org rejects |
| `convex/functions/invoices/__tests__/uploadIssueDateResolution.test.ts` | Tests: XML > manual > undefined precedence |
| `convex/functions/invoices/__tests__/listForBillingFilter.test.ts` | Tests: issueDate range filter, fallback to uploadedAt |

### Modified files

| Path | Change |
|---|---|
| `convex/schema.ts` | Add `issueDate: v.optional(v.number())` to `invoices` table |
| `convex/functions/invoices/actions.ts` | `upload` action accepts `xmlBuffer` + `issueDate` optional args; resolves via parser |
| `convex/functions/invoices/internalMutations.ts` | `insertInvoiceRow` accepts and persists `issueDate` |
| `convex/functions/invoices/mutations.ts` | Add `updateIssueDate` mutation |
| `convex/functions/invoices/queries.ts` | `listForBilling` accepts optional `issueDateFrom`, `issueDateTo`; filters post-query |
| `src/app/(dashboard)/facturacion/page.tsx` | Upload form (XML + date), table column, filter range, edit modal |

---

## Execution order

```
Phase 1: Schema + CFDI parser + migration  (Tasks 1-3)
Phase 2: Upload + insert + edit + list backend  (Tasks 4-7)
Phase 3: UI changes  (Tasks 8-10)
Phase 4: Final smoke  (Task 11)
```

All phases unblocked; no external dependencies.

---

# PHASE 1: Schema + parser + migration

## Task 1: Schema add `issueDate` field

**Files:**
- Modify: `convex/schema.ts` (invoices table, around line 809-849)

- [ ] **Step 1: Add field**

In `convex/schema.ts`, inside `invoices` table definition, append AFTER `notes: v.optional(v.string()),` (and before the V2 hooks `facturapiInvoiceId`):

```ts
    // SS5: fiscal issue date (separate from operational uploadedAt).
    // CFDI Fecha attribute when XML provided, manual capture otherwise.
    issueDate: v.optional(v.number()),
```

- [ ] **Step 2: Verify codegen**

```bash
npx convex dev --once
```

Expected: `✔ Convex functions ready!`; no errors.

- [ ] **Step 3: Commit**

```bash
git add convex/schema.ts
git commit -m "schema(ss5): add issueDate field to invoices"
```

---

## Task 2: CFDI parser + tests

**Files:**
- Create: `convex/lib/cfdiParser.ts`
- Create: `convex/lib/__tests__/cfdiParser.test.ts`

- [ ] **Step 1: Write failing tests**

Create `convex/lib/__tests__/cfdiParser.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseCfdiIssueDate } from "../cfdiParser";

const CFDI_40_VALID = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Serie="A" Folio="123" Fecha="2026-01-15T10:30:00" Total="1000.00">
  <cfdi:Emisor Rfc="DXX900101AAA" Nombre="Despacho X SA"/>
</cfdi:Comprobante>`;

const CFDI_33_VALID = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/3" Version="3.3" Serie="B" Folio="456" Fecha="2025-12-20T14:45:30" Total="500.00">
</cfdi:Comprobante>`;

const CFDI_NO_PREFIX = `<?xml version="1.0" encoding="UTF-8"?>
<Comprobante Version="4.0" Fecha="2026-02-01T09:00:00" Total="2000.00"></Comprobante>`;

const CFDI_MISSING_FECHA = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Total="1000.00"></cfdi:Comprobante>`;

const MALFORMED_XML = `not even xml at all <<<`;

const INVALID_FECHA_FORMAT = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Fecha="not-a-date" Total="1.00"></cfdi:Comprobante>`;

function toBuffer(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer;
}

describe("parseCfdiIssueDate", () => {
  it("extracts Fecha from CFDI 4.0 with namespace prefix", () => {
    const r = parseCfdiIssueDate(toBuffer(CFDI_40_VALID));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(new Date(r.issueDate).toISOString()).toMatch(/^2026-01-15T10:30:00/);
    }
  });

  it("extracts Fecha from CFDI 3.3", () => {
    const r = parseCfdiIssueDate(toBuffer(CFDI_33_VALID));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(new Date(r.issueDate).toISOString()).toMatch(/^2025-12-20T14:45:30/);
    }
  });

  it("extracts Fecha from XML without cfdi: prefix", () => {
    const r = parseCfdiIssueDate(toBuffer(CFDI_NO_PREFIX));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(new Date(r.issueDate).toISOString()).toMatch(/^2026-02-01T09:00:00/);
    }
  });

  it("returns ok=false when Fecha attribute is missing", () => {
    const r = parseCfdiIssueDate(toBuffer(CFDI_MISSING_FECHA));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/Fecha/i);
    }
  });

  it("returns ok=false for malformed XML", () => {
    const r = parseCfdiIssueDate(toBuffer(MALFORMED_XML));
    expect(r.ok).toBe(false);
  });

  it("returns ok=false when Fecha format is invalid", () => {
    const r = parseCfdiIssueDate(toBuffer(INVALID_FECHA_FORMAT));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/invalid|format/i);
    }
  });

  it("handles empty buffer", () => {
    const r = parseCfdiIssueDate(new ArrayBuffer(0));
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

```bash
npx vitest run convex/lib/__tests__/cfdiParser.test.ts
```

Expected: FAIL — `parseCfdiIssueDate` not exported.

- [ ] **Step 3: Implement parser**

Create `convex/lib/cfdiParser.ts`:

```ts
export type CfdiParseResult =
  | { ok: true; issueDate: number }
  | { ok: false; reason: string };

const FECHA_REGEX = /\bFecha\s*=\s*"([^"]+)"/;
const COMPROBANTE_ROOT_REGEX = /<(?:[a-zA-Z][\w-]*:)?Comprobante\b[^>]*>/;

/**
 * Parse the `Fecha` attribute from a CFDI XML buffer's <Comprobante> root.
 * Supports namespace-prefixed (`cfdi:Comprobante`) and bare (`Comprobante`)
 * variants. Date format: ISO datetime `YYYY-MM-DDTHH:MM:SS[.SSS][Z|±HH:MM]`.
 */
export function parseCfdiIssueDate(buffer: ArrayBuffer): CfdiParseResult {
  if (buffer.byteLength === 0) {
    return { ok: false, reason: "empty buffer" };
  }
  const xml = new TextDecoder("utf-8").decode(buffer);

  // Find <Comprobante> root element. If missing → malformed.
  const rootMatch = xml.match(COMPROBANTE_ROOT_REGEX);
  if (!rootMatch) {
    return { ok: false, reason: "malformed XML — no Comprobante root" };
  }

  // Extract Fecha attribute from the root opening tag only (avoid grabbing
  // Fecha from nested elements like cfdi:TimbreFiscalDigital).
  const fechaMatch = rootMatch[0].match(FECHA_REGEX);
  if (!fechaMatch) {
    return { ok: false, reason: "missing Fecha attribute on Comprobante root" };
  }

  const fechaStr = fechaMatch[1];
  const parsed = Date.parse(fechaStr);
  if (isNaN(parsed)) {
    return { ok: false, reason: `invalid Fecha date format: ${fechaStr}` };
  }

  return { ok: true, issueDate: parsed };
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npx vitest run convex/lib/__tests__/cfdiParser.test.ts
```

Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add convex/lib/cfdiParser.ts convex/lib/__tests__/cfdiParser.test.ts
git commit -m "feat(ss5): CFDI XML Fecha attribute parser"
```

---

## Task 3: Migration backfill `issueDate = uploadedAt`

**Files:**
- Create: `convex/functions/migrations/invoiceIssueDate.ts`
- Create: `convex/functions/migrations/__tests__/invoiceIssueDate.test.ts`

- [ ] **Step 1: Write failing tests**

Create `convex/functions/migrations/__tests__/invoiceIssueDate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

async function seedInvoice(t: ReturnType<typeof setupTest>, opts: {
  orgId: string;
  uploadedAt: number;
  issueDate?: number;
}): Promise<Id<"invoices">> {
  return await t.run(async (ctx) => {
    const serviceId = await ctx.db.insert("services", {
      name: "S", isActive: true, createdAt: 0, updatedAt: 0,
    } as any);
    const clientId = await ctx.db.insert("clients", {
      orgId: opts.orgId, name: "C", email: "c@c.com",
      rfc: "XXX900101AAA", industry: "Otros", annualRevenue: 0,
      billingFrequency: "mensual", isArchived: false,
      createdAt: 0, updatedAt: 0,
    } as any);
    const projectionId = await ctx.db.insert("projections", {
      orgId: opts.orgId, clientId, name: "P", year: 2026, startMonth: 1,
      status: "active", createdAt: 0, updatedAt: 0,
    } as any);
    return await ctx.db.insert("invoices", {
      orgId: opts.orgId,
      clientId,
      projectionId,
      serviceName: "S",
      month: 1, year: 2026,
      amount: 1000,
      bucketKey: "k", contentType: "application/pdf", sizeBytes: 1, filename: "x.pdf",
      status: "uploaded",
      uploadedAt: opts.uploadedAt,
      uploadedBy: "u",
      issueDate: opts.issueDate,
      createdAt: opts.uploadedAt,
    });
  });
}

describe("invoiceIssueDate migration", () => {
  it("backfills issueDate from uploadedAt when issueDate is undefined", async () => {
    const t = setupTest();
    const uploadedAt = Date.UTC(2026, 0, 15);
    const id = await seedInvoice(t, { orgId: "org_1", uploadedAt });

    const result = await t.mutation(
      internal.functions.migrations.invoiceIssueDate.migrate,
      { cursor: null, limit: 100 }
    );

    expect(result.migrated).toBe(1);
    expect(result.done).toBe(true);

    await t.run(async (ctx) => {
      const row = await ctx.db.get(id);
      expect(row?.issueDate).toBe(uploadedAt);
    });
  });

  it("does NOT touch rows that already have issueDate set", async () => {
    const t = setupTest();
    const uploadedAt = Date.UTC(2026, 0, 15);
    const issueDate = Date.UTC(2026, 0, 10);
    const id = await seedInvoice(t, { orgId: "org_1", uploadedAt, issueDate });

    const result = await t.mutation(
      internal.functions.migrations.invoiceIssueDate.migrate,
      { cursor: null, limit: 100 }
    );

    expect(result.migrated).toBe(0);
    await t.run(async (ctx) => {
      const row = await ctx.db.get(id);
      expect(row?.issueDate).toBe(issueDate); // unchanged
    });
  });

  it("is idempotent (re-running yields 0 migrated)", async () => {
    const t = setupTest();
    await seedInvoice(t, { orgId: "org_1", uploadedAt: Date.UTC(2026, 0, 15) });

    const first = await t.mutation(
      internal.functions.migrations.invoiceIssueDate.migrate,
      { cursor: null, limit: 100 }
    );
    expect(first.migrated).toBe(1);

    const second = await t.mutation(
      internal.functions.migrations.invoiceIssueDate.migrate,
      { cursor: null, limit: 100 }
    );
    expect(second.migrated).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

```bash
npx vitest run convex/functions/migrations/__tests__/invoiceIssueDate.test.ts
```

Expected: FAIL — migration not exported.

- [ ] **Step 3: Implement migration**

Create `convex/functions/migrations/invoiceIssueDate.ts`:

```ts
import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";

const PAGE_SIZE_DEFAULT = 100;

/**
 * SS5 migration — backfill `issueDate = uploadedAt` for invoice rows
 * created before the field existed. Cursor-paginated, idempotent.
 *
 * Per docs/superpowers/specs/2026-05-27-invoice-issue-date-design.md §8
 */
export const migrate = internalMutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? PAGE_SIZE_DEFAULT;
    const page = await ctx.db
      .query("invoices")
      .paginate({ cursor: args.cursor, numItems: limit });

    let migrated = 0;
    for (const row of page.page) {
      if (row.issueDate === undefined) {
        await ctx.db.patch(row._id, { issueDate: row.uploadedAt });
        migrated++;
      }
    }

    return {
      migrated,
      done: page.isDone,
      nextCursor: page.continueCursor,
    };
  },
});
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npx vitest run convex/functions/migrations/__tests__/invoiceIssueDate.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add convex/functions/migrations/invoiceIssueDate.ts convex/functions/migrations/__tests__/invoiceIssueDate.test.ts
git commit -m "migration(ss5): backfill invoices.issueDate from uploadedAt"
```

---

# PHASE 2: Backend logic

## Task 4: `insertInvoiceRow` accepts `issueDate`

**Files:**
- Modify: `convex/functions/invoices/internalMutations.ts`

- [ ] **Step 1: Add arg + insert field**

In `convex/functions/invoices/internalMutations.ts`, modify the `insertInvoiceRow` mutation args (around line 12-31) to add `issueDate` after `duplicateOfId`:

```ts
    duplicateOfId: v.optional(v.id("invoices")),
    issueDate: v.optional(v.number()),
```

In the handler `ctx.db.insert("invoices", { ... })` block (around line 34-54), add `issueDate` field after `uploadedBy`:

```ts
      uploadedAt: now,
      uploadedBy: args.uploadedBy,
      issueDate: args.issueDate,
      notes: args.notes,
```

- [ ] **Step 2: Verify codegen + TS**

```bash
npx convex dev --once
npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -5
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add convex/functions/invoices/internalMutations.ts
git commit -m "feat(ss5): insertInvoiceRow accepts issueDate field"
```

---

## Task 5: `upload` action resolves issueDate (XML > manual > undefined)

**Files:**
- Modify: `convex/functions/invoices/actions.ts`
- Create: `convex/functions/invoices/__tests__/uploadIssueDateResolution.test.ts`

- [ ] **Step 1: Write failing tests**

Create `convex/functions/invoices/__tests__/uploadIssueDateResolution.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

// Mock blobStorage to avoid Railway S3 calls
vi.mock("../../../lib/blobStorage", async () => ({
  uploadBlob: async () => ({ key: "test-key" }),
  buildKey: () => "o/c/invoices/test.pdf",
  signedDownloadUrl: async () => "https://fake/test.pdf",
}));

const CFDI_XML = `<?xml version="1.0"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Fecha="2026-01-15T10:30:00" Total="1000.00"></cfdi:Comprobante>`;

async function seedOrg(t: ReturnType<typeof setupTest>, orgId: string) {
  return await t.run(async (ctx) => {
    const serviceId = await ctx.db.insert("services", {
      name: "S", isActive: true, createdAt: 0, updatedAt: 0,
    } as any);
    const clientId = await ctx.db.insert("clients", {
      orgId, name: "C", email: "c@c.com",
      rfc: "XXX900101AAA", industry: "Otros", annualRevenue: 0,
      billingFrequency: "mensual", isArchived: false,
      createdAt: 0, updatedAt: 0,
    } as any);
    const projectionId = await ctx.db.insert("projections", {
      orgId, clientId, name: "P", year: 2026, startMonth: 1,
      status: "active", createdAt: 0, updatedAt: 0,
    } as any);
    return { clientId, projectionId };
  });
}

function pdfBytes(): ArrayBuffer {
  return new TextEncoder().encode("fake-pdf-bytes").buffer;
}

describe("upload action — issueDate resolution", () => {
  it("uses CFDI XML Fecha when xmlBuffer provided and valid", async () => {
    const t = setupTest();
    const orgId = "org_test";
    const { clientId, projectionId } = await seedOrg(t, orgId);
    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });

    const xmlBuffer = new TextEncoder().encode(CFDI_XML).buffer;
    const result = await auth.action(api.functions.invoices.actions.upload, {
      clientId, projectionId, serviceName: "S",
      month: 1, year: 2026, amount: 1000,
      filename: "test.pdf", contentType: "application/pdf",
      fileBuffer: pdfBytes(),
      xmlBuffer,
    });

    await t.run(async (ctx) => {
      const inv = await ctx.db.get(result.invoiceId);
      const expected = Date.UTC(2026, 0, 15, 10, 30, 0);
      expect(inv?.issueDate).toBe(expected);
    });
  });

  it("falls back to manual issueDate arg when xmlBuffer absent", async () => {
    const t = setupTest();
    const orgId = "org_test";
    const { clientId, projectionId } = await seedOrg(t, orgId);
    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });

    const manualIssueDate = Date.UTC(2026, 1, 10);
    const result = await auth.action(api.functions.invoices.actions.upload, {
      clientId, projectionId, serviceName: "S",
      month: 2, year: 2026, amount: 500,
      filename: "test.pdf", contentType: "application/pdf",
      fileBuffer: pdfBytes(),
      issueDate: manualIssueDate,
    });

    await t.run(async (ctx) => {
      const inv = await ctx.db.get(result.invoiceId);
      expect(inv?.issueDate).toBe(manualIssueDate);
    });
  });

  it("XML wins when both xmlBuffer (valid) and manual issueDate provided", async () => {
    const t = setupTest();
    const orgId = "org_test";
    const { clientId, projectionId } = await seedOrg(t, orgId);
    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });

    const xmlBuffer = new TextEncoder().encode(CFDI_XML).buffer;
    const manualIssueDate = Date.UTC(2025, 11, 1);
    const result = await auth.action(api.functions.invoices.actions.upload, {
      clientId, projectionId, serviceName: "S",
      month: 1, year: 2026, amount: 1000,
      filename: "test.pdf", contentType: "application/pdf",
      fileBuffer: pdfBytes(),
      xmlBuffer,
      issueDate: manualIssueDate,
    });

    const expectedXmlDate = Date.UTC(2026, 0, 15, 10, 30, 0);
    await t.run(async (ctx) => {
      const inv = await ctx.db.get(result.invoiceId);
      expect(inv?.issueDate).toBe(expectedXmlDate); // XML wins
    });
  });

  it("falls back to manual when xmlBuffer is malformed", async () => {
    const t = setupTest();
    const orgId = "org_test";
    const { clientId, projectionId } = await seedOrg(t, orgId);
    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });

    const malformedXml = new TextEncoder().encode("not xml").buffer;
    const manualIssueDate = Date.UTC(2026, 2, 1);
    const result = await auth.action(api.functions.invoices.actions.upload, {
      clientId, projectionId, serviceName: "S",
      month: 3, year: 2026, amount: 250,
      filename: "test.pdf", contentType: "application/pdf",
      fileBuffer: pdfBytes(),
      xmlBuffer: malformedXml,
      issueDate: manualIssueDate,
    });

    await t.run(async (ctx) => {
      const inv = await ctx.db.get(result.invoiceId);
      expect(inv?.issueDate).toBe(manualIssueDate);
    });
  });

  it("issueDate is undefined when neither xmlBuffer nor manual provided", async () => {
    const t = setupTest();
    const orgId = "org_test";
    const { clientId, projectionId } = await seedOrg(t, orgId);
    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });

    const result = await auth.action(api.functions.invoices.actions.upload, {
      clientId, projectionId, serviceName: "S",
      month: 4, year: 2026, amount: 100,
      filename: "test.pdf", contentType: "application/pdf",
      fileBuffer: pdfBytes(),
    });

    await t.run(async (ctx) => {
      const inv = await ctx.db.get(result.invoiceId);
      expect(inv?.issueDate).toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

```bash
npx vitest run convex/functions/invoices/__tests__/uploadIssueDateResolution.test.ts
```

Expected: failures — upload doesn't accept xmlBuffer/issueDate yet.

- [ ] **Step 3: Modify upload action**

In `convex/functions/invoices/actions.ts`:

1. Add import at top:
```ts
import { parseCfdiIssueDate } from "../../lib/cfdiParser";
```

2. Add args to the upload action (after `notes`):
```ts
    notes: v.optional(v.string()),
    xmlBuffer: v.optional(v.bytes()),
    issueDate: v.optional(v.number()),
```

3. After the duplicate-detect logic (around line 84, before bucket-first upload), add the issueDate resolution:
```ts
    // SS5: resolve issueDate — XML > manual > undefined
    let resolvedIssueDate: number | undefined = args.issueDate;
    if (args.xmlBuffer) {
      const result = parseCfdiIssueDate(args.xmlBuffer);
      if (result.ok) {
        resolvedIssueDate = result.issueDate;
      } else {
        console.warn(
          `[invoice upload] CFDI parse failed: ${result.reason}; using manual fallback`
        );
        // resolvedIssueDate stays as args.issueDate (manual fallback)
      }
    }
```

4. In the `insertInvoiceRow` call (around line 105-127), add `issueDate: resolvedIssueDate` to the args:
```ts
        uploadedBy: userId,
        duplicateOfId: duplicate?._id,
        issueDate: resolvedIssueDate,
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npx vitest run convex/functions/invoices/__tests__/uploadIssueDateResolution.test.ts
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add convex/functions/invoices/actions.ts convex/functions/invoices/__tests__/uploadIssueDateResolution.test.ts
git commit -m "feat(ss5): upload action resolves issueDate from CFDI XML or manual"
```

---

## Task 6: `updateIssueDate` mutation

**Files:**
- Modify: `convex/functions/invoices/mutations.ts`
- Create: `convex/functions/invoices/__tests__/updateIssueDate.test.ts`

- [ ] **Step 1: Write failing tests**

Create `convex/functions/invoices/__tests__/updateIssueDate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

async function seedInvoice(t: ReturnType<typeof setupTest>, opts: {
  orgId: string; status?: "uploaded" | "paid" | "void";
}): Promise<Id<"invoices">> {
  return await t.run(async (ctx) => {
    const serviceId = await ctx.db.insert("services", {
      name: "S", isActive: true, createdAt: 0, updatedAt: 0,
    } as any);
    const clientId = await ctx.db.insert("clients", {
      orgId: opts.orgId, name: "C", email: "c@c.com",
      rfc: "XXX900101AAA", industry: "Otros", annualRevenue: 0,
      billingFrequency: "mensual", isArchived: false,
      createdAt: 0, updatedAt: 0,
    } as any);
    const projectionId = await ctx.db.insert("projections", {
      orgId: opts.orgId, clientId, name: "P", year: 2026, startMonth: 1,
      status: "active", createdAt: 0, updatedAt: 0,
    } as any);
    return await ctx.db.insert("invoices", {
      orgId: opts.orgId, clientId, projectionId,
      serviceName: "S", month: 1, year: 2026, amount: 1000,
      bucketKey: "k", contentType: "application/pdf", sizeBytes: 1, filename: "x.pdf",
      status: opts.status ?? "uploaded",
      uploadedAt: 0, uploadedBy: "u",
      createdAt: 0,
    });
  });
}

describe("updateIssueDate mutation", () => {
  it("admin updates issueDate on uploaded invoice", async () => {
    const t = setupTest();
    const orgId = "org_1";
    const invoiceId = await seedInvoice(t, { orgId });
    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });

    const newDate = Date.UTC(2026, 0, 20);
    await auth.mutation(api.functions.invoices.mutations.updateIssueDate, {
      invoiceId, issueDate: newDate,
    });

    await t.run(async (ctx) => {
      const inv = await ctx.db.get(invoiceId);
      expect(inv?.issueDate).toBe(newDate);
    });
  });

  it("rejects update on void invoice", async () => {
    const t = setupTest();
    const orgId = "org_1";
    const invoiceId = await seedInvoice(t, { orgId, status: "void" });
    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });

    await expect(
      auth.mutation(api.functions.invoices.mutations.updateIssueDate, {
        invoiceId, issueDate: Date.UTC(2026, 0, 20),
      })
    ).rejects.toThrow(/cancelada/i);
  });

  it("rejects update across orgs", async () => {
    const t = setupTest();
    const invoiceId = await seedInvoice(t, { orgId: "org_a" });
    const auth = t.withIdentity({ orgId: "org_b", orgRole: "org:admin" });

    await expect(
      auth.mutation(api.functions.invoices.mutations.updateIssueDate, {
        invoiceId, issueDate: Date.UTC(2026, 0, 20),
      })
    ).rejects.toThrow(/no encontrada/i);
  });

  it("logs documentEvents 'updated' on success", async () => {
    const t = setupTest();
    const orgId = "org_1";
    const invoiceId = await seedInvoice(t, { orgId });
    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });

    await auth.mutation(api.functions.invoices.mutations.updateIssueDate, {
      invoiceId, issueDate: Date.UTC(2026, 0, 20),
    });

    await t.run(async (ctx) => {
      const events = await ctx.db
        .query("documentEvents")
        .withIndex("by_orgId_entityType_entityId", (q) =>
          q.eq("orgId", orgId).eq("entityType", "invoice").eq("entityId", invoiceId)
        )
        .collect();
      expect(events.some((e) => e.eventType === "updated")).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

```bash
npx vitest run convex/functions/invoices/__tests__/updateIssueDate.test.ts
```

Expected: failures — mutation not exported.

- [ ] **Step 3: Add mutation**

In `convex/functions/invoices/mutations.ts`, append at the end of the file (before any closing braces, after `markVoid`):

```ts
/**
 * SS5: Admin edits the fiscal issue date of an invoice post-upload.
 * Rejected if invoice is voided.
 *
 * Per docs/superpowers/specs/2026-05-27-invoice-issue-date-design.md §7
 */
export const updateIssueDate = mutation({
  args: {
    invoiceId: v.id("invoices"),
    issueDate: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    const inv = await ctx.db.get(args.invoiceId);
    if (!inv || inv.orgId !== orgId) {
      throw new Error("Factura no encontrada.");
    }
    if (inv.status === "void") {
      throw new Error("No se puede editar fecha en factura cancelada.");
    }

    await ctx.db.patch(args.invoiceId, { issueDate: args.issueDate });

    await ctx.runMutation(
      internal.functions.documentEvents.internal.logEventMutation,
      {
        orgId,
        clientId: inv.clientId,
        entityType: "invoice" as const,
        entityId: args.invoiceId,
        eventType: "updated" as const,
        severity: "info" as const,
        actorUserId: identity.subject,
        actorType: "user" as const,
        message: `Fecha de emisión actualizada a ${new Date(args.issueDate).toISOString().slice(0, 10)}.`,
      }
    );

    return { ok: true };
  },
});
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npx vitest run convex/functions/invoices/__tests__/updateIssueDate.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add convex/functions/invoices/mutations.ts convex/functions/invoices/__tests__/updateIssueDate.test.ts
git commit -m "feat(ss5): updateIssueDate mutation with documentEvents log"
```

---

## Task 7: `listForBilling` accepts issueDate range filter

**Files:**
- Modify: `convex/functions/invoices/queries.ts`
- Create: `convex/functions/invoices/__tests__/listForBillingFilter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `convex/functions/invoices/__tests__/listForBillingFilter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { api } from "../../../_generated/api";

async function seedInvoiceWithDate(t: ReturnType<typeof setupTest>, opts: {
  orgId: string;
  issueDate?: number;
  uploadedAt: number;
  serviceName?: string;
}) {
  await t.run(async (ctx) => {
    const serviceId = await ctx.db.insert("services", {
      name: "S", isActive: true, createdAt: 0, updatedAt: 0,
    } as any);
    const clientId = await ctx.db.insert("clients", {
      orgId: opts.orgId, name: "C", email: "c@c.com",
      rfc: "XXX900101AAA", industry: "Otros", annualRevenue: 0,
      billingFrequency: "mensual", isArchived: false,
      createdAt: 0, updatedAt: 0,
    } as any);
    const projectionId = await ctx.db.insert("projections", {
      orgId: opts.orgId, clientId, name: "P", year: 2026, startMonth: 1,
      status: "active", createdAt: 0, updatedAt: 0,
    } as any);
    await ctx.db.insert("invoices", {
      orgId: opts.orgId, clientId, projectionId,
      serviceName: opts.serviceName ?? "S",
      month: 1, year: 2026, amount: 1000,
      bucketKey: "k", contentType: "application/pdf", sizeBytes: 1, filename: "x.pdf",
      status: "uploaded",
      uploadedAt: opts.uploadedAt, uploadedBy: "u",
      issueDate: opts.issueDate,
      createdAt: opts.uploadedAt,
    });
  });
}

describe("listForBilling — issueDate range filter", () => {
  it("filters by issueDate >= issueDateFrom", async () => {
    const t = setupTest();
    const orgId = "org_1";
    const Jan1 = Date.UTC(2026, 0, 1);
    const Feb1 = Date.UTC(2026, 1, 1);
    const Mar1 = Date.UTC(2026, 2, 1);

    await seedInvoiceWithDate(t, { orgId, uploadedAt: Mar1, issueDate: Jan1, serviceName: "Old" });
    await seedInvoiceWithDate(t, { orgId, uploadedAt: Mar1, issueDate: Feb1, serviceName: "Mid" });
    await seedInvoiceWithDate(t, { orgId, uploadedAt: Mar1, issueDate: Mar1, serviceName: "New" });

    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });
    const result = await auth.query(api.functions.invoices.queries.listForBilling, {
      issueDateFrom: Feb1,
    });
    const names = result.map((r: any) => r.serviceName).sort();
    expect(names).toEqual(["Mid", "New"]);
  });

  it("filters by issueDate <= issueDateTo", async () => {
    const t = setupTest();
    const orgId = "org_1";
    const Jan1 = Date.UTC(2026, 0, 1);
    const Feb1 = Date.UTC(2026, 1, 1);
    const Mar1 = Date.UTC(2026, 2, 1);

    await seedInvoiceWithDate(t, { orgId, uploadedAt: Mar1, issueDate: Jan1, serviceName: "A" });
    await seedInvoiceWithDate(t, { orgId, uploadedAt: Mar1, issueDate: Feb1, serviceName: "B" });
    await seedInvoiceWithDate(t, { orgId, uploadedAt: Mar1, issueDate: Mar1, serviceName: "C" });

    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });
    const result = await auth.query(api.functions.invoices.queries.listForBilling, {
      issueDateTo: Feb1,
    });
    const names = result.map((r: any) => r.serviceName).sort();
    expect(names).toEqual(["A", "B"]);
  });

  it("falls back to uploadedAt when issueDate is undefined", async () => {
    const t = setupTest();
    const orgId = "org_1";
    const Jan1 = Date.UTC(2026, 0, 1);
    const Feb1 = Date.UTC(2026, 1, 1);

    await seedInvoiceWithDate(t, { orgId, uploadedAt: Jan1, serviceName: "NoIssue" }); // no issueDate
    await seedInvoiceWithDate(t, { orgId, uploadedAt: Feb1, serviceName: "Later", issueDate: Feb1 });

    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });
    const result = await auth.query(api.functions.invoices.queries.listForBilling, {
      issueDateFrom: Feb1,
    });
    const names = result.map((r: any) => r.serviceName);
    // NoIssue (uploadedAt=Jan1) excluded; Later (issueDate=Feb1) included
    expect(names).toEqual(["Later"]);
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

```bash
npx vitest run convex/functions/invoices/__tests__/listForBillingFilter.test.ts
```

Expected: failures — args not accepted.

- [ ] **Step 3: Modify query**

In `convex/functions/invoices/queries.ts`, find `listForBilling` (around line 26). Add the new args after the existing status filter arg:

```ts
    status: v.optional(
      v.union(
        v.literal("uploaded"),
        // ... existing union members
      )
    ),
    issueDateFrom: v.optional(v.number()),
    issueDateTo: v.optional(v.number()),
```

(Adapt to actual existing args shape.)

In the handler, after the existing filter logic, add:

```ts
    if (args.issueDateFrom !== undefined) {
      rows = rows.filter((r) => (r.issueDate ?? r.uploadedAt) >= args.issueDateFrom!);
    }
    if (args.issueDateTo !== undefined) {
      rows = rows.filter((r) => (r.issueDate ?? r.uploadedAt) <= args.issueDateTo!);
    }
```

(Adapt variable name `rows` to whatever the existing query uses.)

- [ ] **Step 4: Run tests, verify pass**

```bash
npx vitest run convex/functions/invoices/__tests__/listForBillingFilter.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add convex/functions/invoices/queries.ts convex/functions/invoices/__tests__/listForBillingFilter.test.ts
git commit -m "feat(ss5): listForBilling accepts issueDateFrom/To range filter"
```

---

# PHASE 3: UI changes

## Task 8: Upload form — XML picker + manual date input

**Files:**
- Modify: `src/app/(dashboard)/facturacion/page.tsx`

**Note:** `facturacion/page.tsx` is 1044 lines — find the existing upload form/modal section. Search for the existing upload submit handler or file picker. Add the two new fields adjacent.

- [ ] **Step 1: Add XML file picker + manual date input**

In `src/app/(dashboard)/facturacion/page.tsx`, locate the upload form/modal (search for `fileBuffer` or `serviceName` field). Add inside the form, after the existing fields:

```tsx
{/* SS5: optional CFDI XML + manual issueDate */}
<div className="space-y-2">
  <label className="text-sm font-medium">
    CFDI XML (opcional)
    <span className="ml-1 text-xs text-gray-500">
      — si lo subes, la fecha de emisión se autocompleta
    </span>
  </label>
  <input
    type="file"
    accept=".xml,application/xml,text/xml"
    onChange={(e) => setXmlFile(e.target.files?.[0] ?? null)}
    className="block w-full text-sm"
  />
</div>

<div className="space-y-2">
  <label className="text-sm font-medium">
    Fecha de emisión (opcional)
  </label>
  <input
    type="date"
    value={manualIssueDate}
    onChange={(e) => setManualIssueDate(e.target.value)}
    disabled={!!xmlFile}
    className="block w-full rounded border px-3 py-1.5 text-sm disabled:opacity-50"
  />
  {xmlFile && (
    <p className="text-xs text-gray-500">
      Deshabilitado — la fecha se extraerá del CFDI XML.
    </p>
  )}
</div>
```

- [ ] **Step 2: Add state vars**

In the same file, near other `useState` calls in the upload form component, add:

```tsx
const [xmlFile, setXmlFile] = useState<File | null>(null);
const [manualIssueDate, setManualIssueDate] = useState<string>("");
```

- [ ] **Step 3: Wire into upload action call**

Find the existing `.action(api.functions.invoices.actions.upload, {...})` call. Modify the args to include:

```ts
const xmlBuffer = xmlFile ? await xmlFile.arrayBuffer() : undefined;
const issueDateMs = manualIssueDate
  ? new Date(manualIssueDate).getTime()
  : undefined;

await convex.action(api.functions.invoices.actions.upload, {
  // ...existing args
  xmlBuffer,
  issueDate: issueDateMs,
});
```

- [ ] **Step 4: Verify TS clean**

```bash
npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -5
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/facturacion/page.tsx"
git commit -m "feat(ss5): upload form accepts CFDI XML + manual issueDate"
```

---

## Task 9: Table column + filter range

**Files:**
- Modify: `src/app/(dashboard)/facturacion/page.tsx`

- [ ] **Step 1: Add filter state**

Near the top of the page component, add:

```tsx
const [issueDateFrom, setIssueDateFrom] = useState<string>("");
const [issueDateTo, setIssueDateTo] = useState<string>("");
```

- [ ] **Step 2: Pass filter args to query**

Find the existing `useQuery(api.functions.invoices.queries.listForBilling, {...})` call. Add args:

```tsx
const invoices = useQuery(api.functions.invoices.queries.listForBilling, {
  // ...existing args
  issueDateFrom: issueDateFrom ? new Date(issueDateFrom).getTime() : undefined,
  issueDateTo: issueDateTo ? new Date(issueDateTo).getTime() : undefined,
});
```

- [ ] **Step 3: Add filter UI**

Locate the existing filters section in the page (search for `status` filter or similar). Add adjacent:

```tsx
<div className="flex items-center gap-2 text-sm">
  <label>Período fiscal:</label>
  <input
    type="date"
    value={issueDateFrom}
    onChange={(e) => setIssueDateFrom(e.target.value)}
    className="rounded border px-2 py-1"
  />
  <span className="text-gray-500">a</span>
  <input
    type="date"
    value={issueDateTo}
    onChange={(e) => setIssueDateTo(e.target.value)}
    className="rounded border px-2 py-1"
  />
</div>
```

- [ ] **Step 4: Add table column**

Find the existing invoices table headers and rows. Add a new column "Emisión" between existing columns (suggested: between `Mes/Año` and the upload date column).

Header:
```tsx
<th className="py-2">Emisión</th>
```

Row cell:
```tsx
<td className="py-2 text-gray-700">
  {(() => {
    const d = inv.issueDate ?? inv.uploadedAt;
    const isEstimated = inv.issueDate === undefined;
    return (
      <span className={isEstimated ? "text-amber-700" : ""} title={isEstimated ? "Estimada — falta fecha fiscal" : ""}>
        {new Date(d).toLocaleDateString("es-MX")}
      </span>
    );
  })()}
</td>
```

- [ ] **Step 5: Verify TS + smoke run dev**

```bash
npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -5
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/facturacion/page.tsx"
git commit -m "feat(ss5): /facturacion adds Emisión column + period filter"
```

---

## Task 10: Edit issueDate modal

**Files:**
- Modify: `src/app/(dashboard)/facturacion/page.tsx` (or extract to a new component file if grows >100 lines)

- [ ] **Step 1: Add modal state**

```tsx
const [editingInvoice, setEditingInvoice] = useState<Doc<"invoices"> | null>(null);
const [editIssueDate, setEditIssueDate] = useState<string>("");
const updateIssueDate = useMutation(api.functions.invoices.mutations.updateIssueDate);
```

(Adapt `Doc<"invoices">` import from `convex/_generated/dataModel`.)

- [ ] **Step 2: Add "Editar fecha emisión" action button per row**

In the row actions dropdown/cell, add (only if `inv.status !== "void"`):

```tsx
{inv.status !== "void" && (
  <button
    onClick={() => {
      setEditingInvoice(inv);
      const d = inv.issueDate ?? inv.uploadedAt;
      setEditIssueDate(new Date(d).toISOString().slice(0, 10));
    }}
    className="text-xs text-blue-600 hover:underline"
  >
    Editar fecha emisión
  </button>
)}
```

- [ ] **Step 3: Add modal**

At the bottom of the page render, before any closing tags:

```tsx
{editingInvoice && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
    <div className="rounded bg-white p-6 shadow-lg">
      <h3 className="text-lg font-semibold mb-3">
        Editar fecha de emisión
      </h3>
      <p className="text-sm text-gray-600 mb-4">
        Factura: {editingInvoice.filename}
      </p>
      <input
        type="date"
        value={editIssueDate}
        onChange={(e) => setEditIssueDate(e.target.value)}
        className="block w-full rounded border px-3 py-1.5 text-sm mb-4"
      />
      <div className="flex justify-end gap-2">
        <button
          onClick={() => setEditingInvoice(null)}
          className="rounded border px-3 py-1.5 text-sm"
        >
          Cancelar
        </button>
        <button
          onClick={async () => {
            const ms = new Date(editIssueDate).getTime();
            await updateIssueDate({
              invoiceId: editingInvoice._id,
              issueDate: ms,
            });
            setEditingInvoice(null);
          }}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white"
        >
          Guardar
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 4: Verify TS clean**

```bash
npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -5
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/facturacion/page.tsx"
git commit -m "feat(ss5): inline edit modal for invoice issueDate"
```

---

# PHASE 4: Final smoke

## Task 11: Full smoke + migration + handoff

**Files:**
- Modify: `Handoff.md`

- [ ] **Step 1: Run full test suite**

```bash
npm test 2>&1 | grep -E "Test Files|Tests" | head -3
```

Expected: ≥920 passed, 1 skipped.

- [ ] **Step 2: TypeScript clean**

```bash
npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -10
```

Expected: empty (clean).

- [ ] **Step 3: Run migration in dev**

```bash
npx convex run internal:functions:migrations:invoiceIssueDate:migrate '{"cursor":null}'
```

Expected: `{"migrated": <N>, "done": true, "nextCursor": ...}`. N = number of invoices in dev that had `issueDate === undefined`.

- [ ] **Step 4: Smoke browser**

```bash
npm run dev
```

In another terminal: `npx convex dev`.

Open `http://localhost:3000/facturacion`:
- Verify the new "Emisión" column appears.
- Verify the período filter widget shows.
- Try uploading an invoice with a date — verify it persists.
- Click "Editar fecha emisión" on a row — verify modal opens and saves.

(If you don't have browser access, mark these as manual TODO in handoff.)

- [ ] **Step 5: Update Handoff.md**

Append a section about SS5 closure or replace the existing "Próximos pasos" section. Briefly: SS5 done, tests at ~920, migration ran. Add to "Action items manuales" if anything pending (e.g., correr migración en prod).

- [ ] **Step 6: Final commit**

```bash
git add Handoff.md
git commit -m "docs(handoff): SS5 invoice issue date closure"
```

---

# Self-Review

**Spec coverage check** against `docs/superpowers/specs/2026-05-27-invoice-issue-date-design.md`:

| Spec section | Plan task(s) |
|---|---|
| §4 schema `issueDate` field | Task 1 |
| §5 cfdiParser + tests | Task 2 |
| §6 upload flow XML > manual > undefined | Task 5 |
| §7 updateIssueDate mutation | Task 6 |
| §8 migration backfill cursor-paginated | Task 3 |
| §9.1 table column "Emisión" | Task 9 |
| §9.2 filter range | Task 9 |
| §9.3 upload form CFDI + date | Task 8 |
| §9.4 edit modal | Task 10 |
| §10 listForBilling args | Task 7 |
| §11 error handling | Distributed (parser tests, upload tests, updateIssueDate tests) |
| §12 testing target ≥920 | Task 11 verify |
| §13 deferred decisions | Documented inline as not-implemented |
| §14 migration / rollout | Task 11 step 3 |
| §15 success metrics | Task 11 verify |

Coverage complete.

**Placeholder scan:** None — every step has code.

**Type consistency:**
- `parseCfdiIssueDate` signature consistent across Tasks 2, 5.
- `CfdiParseResult` discriminated union used in Tasks 2, 5.
- `issueDate: number` consistently in schema (Task 1), insert (Task 4), upload (Task 5), update (Task 6), query (Task 7).
- `issueDateFrom` / `issueDateTo` consistent across Task 7, 9.

Plan complete.
