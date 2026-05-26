# Deliverable Content Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Distinguir plantillas con contenido real vs placeholder, mostrar warning visual (non-blocking) cuando proyecciones tienen subservicios activos sin contenido real, y agregar bulk-import CLI para que papá llene 33 plantillas vía Claude Code en lugar de copy-paste 33 veces.

**Architecture:** Schema field `contentStatus` auto-derivado on-save vía detección de marker `<div class="placeholder">`. Banner en proyección + badge + counter en tree de plantillas. Bulk-import lee archivos `.html` de `convex/seeds/templates/` y upserta via internal mutation. Migration en 2 fases (optional → required).

**Tech Stack:** Convex (DB + mutations + queries), TypeScript estricto, Vitest, React 19 (UI), Node 20 (CLI script).

**Spec origen:** `docs/superpowers/specs/2026-05-25-deliverable-content-catalog-design.md`

---

## File Structure

### Crear
| Path | Responsabilidad |
|---|---|
| `convex/lib/templateContent.ts` | Type `ContentStatus` + helper puro `detectContentStatus(html)` (single source of truth) |
| `convex/lib/__tests__/templateContent.test.ts` | Unit tests del detector (4 casos) |
| `convex/functions/migrations/templateContentStatus.ts` | `migrate` + `verifyComplete` internalMutation/Query |
| `convex/functions/migrations/__tests__/templateContentStatus.test.ts` | Migration tests (dry/apply/idempotent/verify) |
| `convex/functions/deliverableTemplates/__tests__/contentStatus.test.ts` | Mutation hooks integration tests |
| `convex/functions/deliverableTemplates/bulkImport.ts` | Internal mutation `upsertFromFile` para CLI |
| `convex/functions/deliverableTemplates/__tests__/bulkImport.test.ts` | Bulk-import tests (create/update/error) |
| `convex/functions/projections/__tests__/subservicesMissingContent.test.ts` | Query tests (ready/placeholder/no-sub/cross-org) |
| `src/components/projections/missing-content-banner.tsx` | Componente que llama query + renderiza banner |
| `src/components/projections/__tests__/missing-content-banner.test.tsx` | UI tests (null/singular/plural) |
| `scripts/import-templates.ts` | CLI script Node que lee .html files y llama upsertFromFile |
| `convex/seeds/templates/README.md` | Convención de naming + ejemplos |
| `convex/seeds/templates/.gitkeep` | Marca dir como tracked (papá luego pega .html aquí) |

### Modificar
| Path | Cambio |
|---|---|
| `convex/schema.ts:509-554` | Agregar `contentStatus: v.optional(...)` + index `by_subservice_contentStatus` |
| `convex/functions/deliverableTemplates/mutations.ts:44-200` | Hooks `detectContentStatus` en `create`, `update`, `personalizeGlobal` |
| `convex/functions/projections/queries.ts` | Agregar `subservicesMissingContent` query (append al final) |
| `src/app/(dashboard)/proyecciones/[id]/page.tsx` | Wire `<MissingContentBanner projectionId={...} />` antes del grid |
| `src/app/(dashboard)/configuracion/plantillas/page.tsx:308-450` (aprox tree cards) | Badge "Sin contenido" + counter en header |
| `src/app/(dashboard)/configuracion/plantillas/[id]/page.tsx` | Chip de estado (Placeholder/Ready) junto al título |

---

## Task 1: Crear `detectContentStatus` helper

**Files:**
- Create: `convex/lib/templateContent.ts`
- Create: `convex/lib/__tests__/templateContent.test.ts`

- [ ] **Step 1: Write the failing test**

Crear `convex/lib/__tests__/templateContent.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { detectContentStatus } from "../templateContent";

describe("detectContentStatus", () => {
  it("returns 'placeholder' when HTML contains the seed marker", () => {
    const html = `<div class="placeholder"><strong>Plantilla placeholder.</strong></div>`;
    expect(detectContentStatus(html)).toBe("placeholder");
  });

  it("returns 'ready' when marker absent (real content)", () => {
    const html = `<h1>Reporte Mensual</h1><p>Datos del cliente {{cliente.nombre}}</p>`;
    expect(detectContentStatus(html)).toBe("ready");
  });

  it("returns 'ready' for empty or minimal HTML without the marker", () => {
    expect(detectContentStatus("")).toBe("ready");
    expect(detectContentStatus("<p></p>")).toBe("ready");
  });

  it("returns 'placeholder' even if marker is nested deep", () => {
    const html = `<html><body><section><div class="placeholder">x</div></section></body></html>`;
    expect(detectContentStatus(html)).toBe("placeholder");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/lib/__tests__/templateContent.test.ts`
Expected: FAIL — "Cannot find module '../templateContent'"

- [ ] **Step 3: Implement the helper**

Crear `convex/lib/templateContent.ts`:

```typescript
/**
 * Marker que el seed del 2026-05-22 dejó en las 33 plantillas placeholder.
 * Si el HTML aún lo contiene, el template no tiene contenido real.
 *
 * Reservado: no usar esta clase CSS en plantillas con contenido real, o
 * quedan flagged como placeholder. Spec:
 * docs/superpowers/specs/2026-05-25-deliverable-content-catalog-design.md §3
 */
const PLACEHOLDER_MARKER = '<div class="placeholder">';

export type ContentStatus = "placeholder" | "ready";

/**
 * Auto-derive contentStatus from htmlTemplate. Called on every create/update
 * of deliverableTemplates so the flag stays in sync without manual checkbox.
 */
export function detectContentStatus(htmlTemplate: string): ContentStatus {
  return htmlTemplate.includes(PLACEHOLDER_MARKER) ? "placeholder" : "ready";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/lib/__tests__/templateContent.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add convex/lib/templateContent.ts convex/lib/__tests__/templateContent.test.ts
git commit -m "feat(template-content): add detectContentStatus helper + type

Single source of truth for marker-based detection of placeholder vs
ready deliverableTemplates. Used by mutation hooks (Task 3), migration
(Task 4), and bulk-import (Task 9)."
```

---

## Task 2: Schema — agregar `contentStatus` field + index

**Files:**
- Modify: `convex/schema.ts:509-554`

- [ ] **Step 1: Add `contentStatus` field to deliverableTemplates table**

En `convex/schema.ts`, dentro de `deliverableTemplates: defineTable({ ... })`, agregar el field después de `isActive: v.boolean(),` (alrededor de línea 539):

```typescript
    contentStatus: v.optional(
      v.union(
        v.literal("placeholder"),
        v.literal("ready")
      )
    ),
```

- [ ] **Step 2: Add new index `by_subservice_contentStatus`**

En el mismo bloque, al final de la cadena de `.index(...)` (después de `.index("by_parentTemplateId", ["parentTemplateId"])`):

```typescript
    .index("by_subservice_contentStatus", ["subserviceId", "contentStatus"]),
```

- [ ] **Step 3: Verify Convex codegen + TypeScript**

Run: `npx convex dev --once`
Expected: Sin errores. `_generated/dataModel.d.ts` actualizado con el nuevo field.

Run: `npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -10`
Expected: Sin errores.

- [ ] **Step 4: Run full suite — verify no regression**

Run: `npm test 2>&1 | tail -5`
Expected: same baseline (sin nuevos tests aún).

- [ ] **Step 5: Commit**

```bash
git add convex/schema.ts
git commit -m "feat(schema): add contentStatus + by_subservice_contentStatus index

Sub-spec 1 schema foundation. Field optional in PR1; migration backfills
via internal:migrations/templateContentStatus:migrate. PR2 tightens to
required after backfill is verified."
```

---

## Task 3: Mutation hooks — `create` / `update` / `personalizeGlobal`

**Files:**
- Modify: `convex/functions/deliverableTemplates/mutations.ts:44-260`
- Create: `convex/functions/deliverableTemplates/__tests__/contentStatus.test.ts`

- [ ] **Step 1: Write the failing test**

Crear `convex/functions/deliverableTemplates/__tests__/contentStatus.test.ts`:

```typescript
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import schema from "../../../schema";

const PLACEHOLDER_HTML = `<div class="placeholder">Plantilla placeholder.</div>`;
const REAL_HTML = `<h1>Reporte Real</h1><p>{{cliente.nombre}}</p>`;

const STANDARD_VARS = [
  { key: "cliente.nombre", label: "Nombre", source: "client" as const, required: true },
];

async function setupServiceAndSubservice(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const serviceId = await ctx.db.insert("services", {
      orgId: undefined,
      name: "TI",
      type: "base",
      minPct: 0,
      maxPct: 100,
      defaultPct: 30,
      isDefault: true,
      sortOrder: 1,
    });
    const subserviceId = await ctx.db.insert("subservices", {
      orgId: undefined,
      parentServiceId: serviceId,
      name: "Soporte",
      slug: "soporte",
      defaultFrequency: "mensual",
      isActive: true,
      isDefault: false,
      sortOrder: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { serviceId, subserviceId };
  });
}

describe("deliverableTemplates contentStatus hooks", () => {
  it("create with placeholder HTML sets contentStatus='placeholder'", async () => {
    const t = convexTest(schema);
    const asAdmin = t.withIdentity({
      subject: "u",
      tokenIdentifier: "t|u",
      org_id: "org_test",
      org_role: "org:admin",
    });
    const { serviceId, subserviceId } = await setupServiceAndSubservice(t);

    const tplId = await asAdmin.mutation(api.functions.deliverableTemplates.mutations.create, {
      serviceId,
      serviceName: "TI",
      subserviceId,
      type: "deliverable_long",
      name: "Test",
      htmlTemplate: PLACEHOLDER_HTML,
      variables: STANDARD_VARS,
      scope: "org",
    });

    const tpl = await t.run(async (ctx) => ctx.db.get(tplId));
    expect(tpl?.contentStatus).toBe("placeholder");
  });

  it("create with real HTML sets contentStatus='ready'", async () => {
    const t = convexTest(schema);
    const asAdmin = t.withIdentity({
      subject: "u",
      tokenIdentifier: "t|u",
      org_id: "org_test",
      org_role: "org:admin",
    });
    const { serviceId, subserviceId } = await setupServiceAndSubservice(t);

    const tplId = await asAdmin.mutation(api.functions.deliverableTemplates.mutations.create, {
      serviceId,
      serviceName: "TI",
      subserviceId,
      type: "deliverable_long",
      name: "Test",
      htmlTemplate: REAL_HTML,
      variables: STANDARD_VARS,
      scope: "org",
    });

    const tpl = await t.run(async (ctx) => ctx.db.get(tplId));
    expect(tpl?.contentStatus).toBe("ready");
  });

  it("update flips placeholder → ready when marker removed", async () => {
    const t = convexTest(schema);
    const asAdmin = t.withIdentity({
      subject: "u",
      tokenIdentifier: "t|u",
      org_id: "org_test",
      org_role: "org:admin",
    });
    const { serviceId, subserviceId } = await setupServiceAndSubservice(t);

    const tplId = await asAdmin.mutation(api.functions.deliverableTemplates.mutations.create, {
      serviceId,
      serviceName: "TI",
      subserviceId,
      type: "deliverable_long",
      name: "Test",
      htmlTemplate: PLACEHOLDER_HTML,
      variables: STANDARD_VARS,
      scope: "org",
    });

    await asAdmin.mutation(api.functions.deliverableTemplates.mutations.update, {
      id: tplId,
      expectedVersion: 1,
      patch: { htmlTemplate: REAL_HTML },
    });

    const tpl = await t.run(async (ctx) => ctx.db.get(tplId));
    expect(tpl?.contentStatus).toBe("ready");
  });

  it("update flips ready → placeholder when marker re-introduced", async () => {
    const t = convexTest(schema);
    const asAdmin = t.withIdentity({
      subject: "u",
      tokenIdentifier: "t|u",
      org_id: "org_test",
      org_role: "org:admin",
    });
    const { serviceId, subserviceId } = await setupServiceAndSubservice(t);

    const tplId = await asAdmin.mutation(api.functions.deliverableTemplates.mutations.create, {
      serviceId,
      serviceName: "TI",
      subserviceId,
      type: "deliverable_long",
      name: "Test",
      htmlTemplate: REAL_HTML,
      variables: STANDARD_VARS,
      scope: "org",
    });

    await asAdmin.mutation(api.functions.deliverableTemplates.mutations.update, {
      id: tplId,
      expectedVersion: 1,
      patch: { htmlTemplate: PLACEHOLDER_HTML },
    });

    const tpl = await t.run(async (ctx) => ctx.db.get(tplId));
    expect(tpl?.contentStatus).toBe("placeholder");
  });

  it("personalizeGlobal inherits contentStatus from source", async () => {
    const t = convexTest(schema);
    const asAdmin = t.withIdentity({
      subject: "u",
      tokenIdentifier: "t|u",
      org_id: "org_test",
      org_role: "org:admin",
    });
    const { serviceId, subserviceId } = await setupServiceAndSubservice(t);

    const globalId = await t.run(async (ctx) =>
      ctx.db.insert("deliverableTemplates", {
        orgId: undefined,
        serviceId,
        serviceName: "TI",
        subserviceId,
        type: "deliverable_long",
        name: "Global",
        htmlTemplate: REAL_HTML,
        variables: STANDARD_VARS,
        version: 1,
        isActive: true,
        contentStatus: "ready",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    );

    const cloneId = await asAdmin.mutation(
      api.functions.deliverableTemplates.mutations.personalizeGlobal,
      { globalTemplateId: globalId }
    );

    const clone = await t.run(async (ctx) => ctx.db.get(cloneId));
    expect(clone?.contentStatus).toBe("ready");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/functions/deliverableTemplates/__tests__/contentStatus.test.ts`
Expected: FAIL — `contentStatus` será `undefined` en todos los casos (mutations no lo setean aún).

- [ ] **Step 3: Add import to mutations.ts**

En `convex/functions/deliverableTemplates/mutations.ts`, top del archivo (después de existing imports):

```typescript
import { detectContentStatus } from "../../lib/templateContent";
```

- [ ] **Step 4: Hook `create` mutation (~line 44-120)**

Buscar el bloque `ctx.db.insert("deliverableTemplates", { ... })` dentro de `create`. Antes del insert, derivar contentStatus; agregar al payload del insert:

```typescript
    const contentStatus = detectContentStatus(args.htmlTemplate);

    const now = Date.now();
    const newId = await ctx.db.insert("deliverableTemplates", {
      orgId: resolvedOrgId,
      serviceId: args.serviceId,
      serviceName: args.serviceName,
      subserviceId: args.subserviceId,
      type: args.type,
      name: args.name,
      htmlTemplate: args.htmlTemplate,
      variables: args.variables,
      version: 1,
      isActive: true,
      contentStatus, // ← NEW
      createdAt: now,
      updatedAt: now,
    });
```

(El `newId` ya viene de la rama uncommitted de audit-log; si esa rama NO se mergeó aún, ajusta `return await ctx.db.insert(...)` directamente con el field.)

- [ ] **Step 5: Hook `update` mutation (~line 122-185)**

Buscar el bloque `ctx.db.patch(args.id, { ...args.patch, version: ..., updatedAt: ... })`. Derivar contentStatus desde el HTML resultante:

```typescript
    const nextHtml = args.patch.htmlTemplate ?? tpl.htmlTemplate;
    const nextVars = args.patch.variables ?? tpl.variables;
    validatePlaceholdersDeclared(nextHtml, nextVars);

    const contentStatus = detectContentStatus(nextHtml); // ← NEW

    const nextVersion = tpl.version + 1;
    await ctx.db.patch(args.id, {
      ...args.patch,
      version: nextVersion,
      contentStatus, // ← NEW
      updatedAt: Date.now(),
    });
```

- [ ] **Step 6: Hook `personalizeGlobal` mutation (~line 187-250)**

Buscar el `ctx.db.insert("deliverableTemplates", { ... })` dentro de personalizeGlobal (el que crea el clone). Agregar `contentStatus: source.contentStatus`:

```typescript
    const cloneId = await ctx.db.insert("deliverableTemplates", {
      orgId,
      serviceId: source.serviceId,
      serviceName: source.serviceName,
      subserviceId: source.subserviceId,
      type: source.type,
      name: source.name,
      htmlTemplate: source.htmlTemplate,
      variables: source.variables,
      version: 1,
      isActive: true,
      parentTemplateId: source._id,
      originalVersionAtClone: source.version,
      contentStatus: source.contentStatus, // ← NEW (heredado, mismo HTML)
      createdAt: now,
      updatedAt: now,
    });
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run convex/functions/deliverableTemplates/__tests__/contentStatus.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 8: Run full suite — verify no regression**

Run: `npm test 2>&1 | tail -5`
Expected: baseline + 5 (e.g. if baseline 831 + 5 = 836).

- [ ] **Step 9: Commit**

```bash
git add convex/functions/deliverableTemplates/mutations.ts convex/functions/deliverableTemplates/__tests__/contentStatus.test.ts
git commit -m "feat(template-content): auto-set contentStatus on create/update/personalize

Hooks call detectContentStatus(html) and persist the derived state on
every mutation. Operator never needs to flip a checkbox — borrar el
placeholder marker y guardar es suficiente para marcar Ready."
```

---

## Task 4: Migration — `migrate` + `verifyComplete`

**Files:**
- Create: `convex/functions/migrations/templateContentStatus.ts`
- Create: `convex/functions/migrations/__tests__/templateContentStatus.test.ts`

- [ ] **Step 1: Write the failing test**

Crear `convex/functions/migrations/__tests__/templateContentStatus.test.ts`:

```typescript
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal } from "../../../_generated/api";
import schema from "../../../schema";

const PLACEHOLDER_HTML = `<div class="placeholder">x</div>`;
const REAL_HTML = `<h1>Real</h1>`;

async function seedFixtures(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const serviceId = await ctx.db.insert("services", {
      orgId: undefined,
      name: "TI",
      type: "base",
      minPct: 0,
      maxPct: 100,
      defaultPct: 30,
      isDefault: true,
      sortOrder: 1,
    });
    // 3 templates: 1 con marker, 1 sin marker, 1 ya tiene contentStatus seteado
    const t1 = await ctx.db.insert("deliverableTemplates", {
      orgId: undefined,
      serviceId,
      serviceName: "TI",
      type: "deliverable_long",
      name: "A (placeholder)",
      htmlTemplate: PLACEHOLDER_HTML,
      variables: [],
      version: 1,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const t2 = await ctx.db.insert("deliverableTemplates", {
      orgId: undefined,
      serviceId,
      serviceName: "TI",
      type: "deliverable_long",
      name: "B (real)",
      htmlTemplate: REAL_HTML,
      variables: [],
      version: 1,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const t3 = await ctx.db.insert("deliverableTemplates", {
      orgId: undefined,
      serviceId,
      serviceName: "TI",
      type: "deliverable_long",
      name: "C (already set)",
      htmlTemplate: REAL_HTML,
      variables: [],
      version: 1,
      isActive: true,
      contentStatus: "ready",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { t1, t2, t3 };
  });
}

describe("migrations.templateContentStatus.migrate", () => {
  it("dry run reports counts without patching", async () => {
    const t = convexTest(schema);
    await seedFixtures(t);

    const result = await t.mutation(
      internal.functions.migrations.templateContentStatus.migrate,
      { dryRun: true }
    );

    expect(result.dryRun).toBe(true);
    expect(result.templates).toBe(2); // t1 + t2 (t3 skipped, already set)

    const tpls = await t.run(async (ctx) =>
      ctx.db.query("deliverableTemplates").collect()
    );
    expect(tpls.filter((t) => !t.contentStatus).length).toBe(2);
  });

  it("apply patches each row with correct derived status", async () => {
    const t = convexTest(schema);
    const { t1, t2 } = await seedFixtures(t);

    await t.mutation(
      internal.functions.migrations.templateContentStatus.migrate,
      { dryRun: false }
    );

    const tpl1 = await t.run(async (ctx) => ctx.db.get(t1));
    const tpl2 = await t.run(async (ctx) => ctx.db.get(t2));
    expect(tpl1?.contentStatus).toBe("placeholder");
    expect(tpl2?.contentStatus).toBe("ready");
  });

  it("is idempotent — second run patches 0 rows", async () => {
    const t = convexTest(schema);
    await seedFixtures(t);

    await t.mutation(internal.functions.migrations.templateContentStatus.migrate, { dryRun: false });
    const second = await t.mutation(
      internal.functions.migrations.templateContentStatus.migrate,
      { dryRun: false }
    );

    expect(second.templates).toBe(0);
  });

  it("verifyComplete returns 0 pending after apply", async () => {
    const t = convexTest(schema);
    await seedFixtures(t);
    await t.mutation(internal.functions.migrations.templateContentStatus.migrate, { dryRun: false });

    const verify = await t.query(
      internal.functions.migrations.templateContentStatus.verifyComplete,
      {}
    );
    expect(verify.templatesPending).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/functions/migrations/__tests__/templateContentStatus.test.ts`
Expected: FAIL — módulo `templateContentStatus` no existe.

- [ ] **Step 3: Implement migration**

Crear `convex/functions/migrations/templateContentStatus.ts`:

```typescript
import { internalMutation, internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { detectContentStatus } from "../../lib/templateContent";

/**
 * One-shot backfill for Sub-spec 1.
 * Idempotent: skips rows that already have contentStatus.
 * Spec: docs/superpowers/specs/2026-05-25-deliverable-content-catalog-design.md §6
 *
 * Run: npx convex run functions/migrations/templateContentStatus:migrate '{"dryRun": false}'
 */
export const migrate = internalMutation({
  args: { dryRun: v.boolean() },
  handler: async (ctx, { dryRun }) => {
    let count = 0;
    for await (const tpl of ctx.db.query("deliverableTemplates")) {
      if (tpl.contentStatus) continue;
      const status = detectContentStatus(tpl.htmlTemplate);
      if (!dryRun) await ctx.db.patch(tpl._id, { contentStatus: status });
      count++;
    }
    return { templates: count, dryRun };
  },
});

export const verifyComplete = internalQuery({
  args: {},
  handler: async (ctx) => {
    let pending = 0;
    for await (const tpl of ctx.db.query("deliverableTemplates")) {
      if (!tpl.contentStatus) pending++;
    }
    return { templatesPending: pending };
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/functions/migrations/__tests__/templateContentStatus.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run full suite**

Run: `npm test 2>&1 | tail -5`
Expected: baseline + 4 (vs Task 3 baseline).

- [ ] **Step 6: Commit**

```bash
git add convex/functions/migrations/templateContentStatus.ts convex/functions/migrations/__tests__/templateContentStatus.test.ts
git commit -m "feat(migrations): add templateContentStatus backfill + verifyComplete

Idempotent backfill that derives contentStatus from existing
htmlTemplate via detectContentStatus. Run via:
  npx convex run functions/migrations/templateContentStatus:migrate '{\"dryRun\": false}'"
```

---

## Task 5: `subservicesMissingContent` query

**Files:**
- Modify: `convex/functions/projections/queries.ts` (append nuevo export)
- Create: `convex/functions/projections/__tests__/subservicesMissingContent.test.ts`

- [ ] **Step 1: Write the failing test**

Crear `convex/functions/projections/__tests__/subservicesMissingContent.test.ts`:

```typescript
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import schema from "../../../schema";

const PLACEHOLDER_HTML = `<div class="placeholder">x</div>`;
const REAL_HTML = `<h1>Real</h1>`;

describe("projections.subservicesMissingContent", () => {
  async function setup(t: ReturnType<typeof convexTest>) {
    return await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: "org_test",
        name: "Test",
        rfc: "XAXX010101000",
        isArchived: false,
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: "org_test",
        clientId,
        year: 2026,
        annualSales: 1_200_000,
        totalBudget: 120_000,
        commissionRate: 0,
        seasonalityData: [],
        status: "draft",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const serviceId = await ctx.db.insert("services", {
        orgId: undefined,
        name: "TI",
        type: "base",
        minPct: 0,
        maxPct: 100,
        defaultPct: 30,
        isDefault: true,
        sortOrder: 1,
      });

      // Subservice A with ready template
      const subA = await ctx.db.insert("subservices", {
        orgId: undefined,
        parentServiceId: serviceId,
        name: "Sub A (ready)",
        slug: "sub-a",
        defaultFrequency: "mensual",
        isActive: true,
        isDefault: false,
        sortOrder: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("deliverableTemplates", {
        orgId: undefined,
        serviceId,
        serviceName: "TI",
        subserviceId: subA,
        type: "deliverable_long",
        name: "A tpl",
        htmlTemplate: REAL_HTML,
        variables: [],
        version: 1,
        isActive: true,
        contentStatus: "ready",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Subservice B with only placeholder template
      const subB = await ctx.db.insert("subservices", {
        orgId: undefined,
        parentServiceId: serviceId,
        name: "Sub B (placeholder)",
        slug: "sub-b",
        defaultFrequency: "mensual",
        isActive: true,
        isDefault: false,
        sortOrder: 2,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("deliverableTemplates", {
        orgId: undefined,
        serviceId,
        serviceName: "TI",
        subserviceId: subB,
        type: "deliverable_long",
        name: "B tpl",
        htmlTemplate: PLACEHOLDER_HTML,
        variables: [],
        version: 1,
        isActive: true,
        contentStatus: "placeholder",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Active projServices
      await ctx.db.insert("projectionServices", {
        orgId: "org_test",
        projectionId,
        serviceId,
        serviceName: "TI",
        subserviceId: subA,
        chosenPct: 30,
        isActive: true,
        annualAmount: 36000,
        normalizedWeight: 0.5,
      });
      await ctx.db.insert("projectionServices", {
        orgId: "org_test",
        projectionId,
        serviceId,
        serviceName: "TI",
        subserviceId: subB,
        chosenPct: 30,
        isActive: true,
        annualAmount: 36000,
        normalizedWeight: 0.5,
      });
      // projService without subserviceId (no aplica)
      await ctx.db.insert("projectionServices", {
        orgId: "org_test",
        projectionId,
        serviceId,
        serviceName: "TI (no sub)",
        chosenPct: 0,
        isActive: true,
        annualAmount: 0,
        normalizedWeight: 0,
      });

      return { projectionId, subA, subB };
    });
  }

  it("returns only subservices without any ready template", async () => {
    const t = convexTest(schema);
    const asUser = t.withIdentity({
      subject: "u",
      tokenIdentifier: "t|u",
      org_id: "org_test",
      org_role: "org:member",
    });
    const { projectionId, subB } = await setup(t);

    const missing = await asUser.query(
      api.functions.projections.queries.subservicesMissingContent,
      { projectionId }
    );

    expect(missing).toHaveLength(1);
    expect(missing[0].subserviceId).toBe(subB);
    expect(missing[0].subserviceName).toBe("Sub B (placeholder)");
  });

  it("returns empty array for non-existent projection", async () => {
    const t = convexTest(schema);
    const asUser = t.withIdentity({
      subject: "u",
      tokenIdentifier: "t|u",
      org_id: "org_test",
      org_role: "org:member",
    });
    const fakeId = await t.run(async (ctx) => {
      const cId = await ctx.db.insert("clients", {
        orgId: "org_test",
        name: "x",
        rfc: "XAXX010101000",
        isArchived: false,
      });
      const pId = await ctx.db.insert("projections", {
        orgId: "org_test",
        clientId: cId,
        year: 2026,
        annualSales: 0,
        totalBudget: 0,
        commissionRate: 0,
        seasonalityData: [],
        status: "draft",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.delete(pId); // crear y borrar para tener un id "inexistente"
      return pId;
    });

    const missing = await asUser.query(
      api.functions.projections.queries.subservicesMissingContent,
      { projectionId: fakeId }
    );
    expect(missing).toEqual([]);
  });

  it("does not leak cross-org", async () => {
    const t = convexTest(schema);
    const { projectionId } = await setup(t);

    const asOther = t.withIdentity({
      subject: "u2",
      tokenIdentifier: "t|u2",
      org_id: "org_OTHER",
      org_role: "org:member",
    });
    const missing = await asOther.query(
      api.functions.projections.queries.subservicesMissingContent,
      { projectionId }
    );
    expect(missing).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/functions/projections/__tests__/subservicesMissingContent.test.ts`
Expected: FAIL — query no existe.

- [ ] **Step 3: Add query to `convex/functions/projections/queries.ts`**

Buscar el final del archivo (después del último `export const list = query(...)`). Agregar:

```typescript
import { Id } from "../../_generated/dataModel";

/**
 * Lista subservicios activos en la proyección que no tienen ninguna plantilla
 * con contentStatus="ready". Usado por <MissingContentBanner /> para advertir
 * que se generarán entregables con HTML placeholder.
 *
 * Spec: docs/superpowers/specs/2026-05-25-deliverable-content-catalog-design.md §4
 */
export const subservicesMissingContent = query({
  args: { projectionId: v.id("projections") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const orgId = await getOrgId(ctx);

    const projection = await ctx.db.get(args.projectionId);
    if (!projection || projection.orgId !== orgId) return [];

    const activeRows = await ctx.db
      .query("projectionServices")
      .withIndex("by_projectionId_active", (q) =>
        q.eq("projectionId", args.projectionId).eq("isActive", true)
      )
      .collect();

    const missing: Array<{
      subserviceId: Id<"subservices">;
      subserviceName: string;
      serviceName: string;
    }> = [];

    for (const ps of activeRows) {
      if (!ps.subserviceId) continue;
      const readyTemplate = await ctx.db
        .query("deliverableTemplates")
        .withIndex("by_subservice_contentStatus", (q) =>
          q.eq("subserviceId", ps.subserviceId).eq("contentStatus", "ready")
        )
        .first();

      if (!readyTemplate) {
        const sub = await ctx.db.get(ps.subserviceId);
        if (sub) {
          missing.push({
            subserviceId: ps.subserviceId,
            subserviceName: sub.name,
            serviceName: ps.serviceName,
          });
        }
      }
    }

    return missing;
  },
});
```

(Si `Id`, `query`, `v`, `requireAuth`, `getOrgId` no están ya importados al top del file, agregarlos. Probablemente ya están — verifica.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/functions/projections/__tests__/subservicesMissingContent.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run full suite**

Run: `npm test 2>&1 | tail -5`
Expected: baseline + 3.

- [ ] **Step 6: Commit**

```bash
git add convex/functions/projections/queries.ts convex/functions/projections/__tests__/subservicesMissingContent.test.ts
git commit -m "feat(projections): add subservicesMissingContent query

Returns active projectionServices whose subservice has no
deliverableTemplate with contentStatus='ready'. Used by
MissingContentBanner (Task 6) to warn operator before generating
placeholder content."
```

---

## Task 6: `MissingContentBanner` component + wire in projection page

**Files:**
- Create: `src/components/projections/missing-content-banner.tsx`
- Create: `src/components/projections/__tests__/missing-content-banner.test.tsx`
- Modify: `src/app/(dashboard)/proyecciones/[id]/page.tsx`

- [ ] **Step 1: Write the failing test**

Crear `src/components/projections/__tests__/missing-content-banner.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MissingContentBanner } from "../missing-content-banner";

// Mock useQuery from convex/react
vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
}));

import { useQuery } from "convex/react";

describe("MissingContentBanner", () => {
  it("renders nothing when missing is empty", () => {
    (useQuery as any).mockReturnValue([]);
    const { container } = render(
      <MissingContentBanner projectionId={"p1" as any} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders singular when 1 subservice missing", () => {
    (useQuery as any).mockReturnValue([
      { subserviceId: "s1", subserviceName: "Sub A", serviceName: "Legal" },
    ]);
    render(<MissingContentBanner projectionId={"p1" as any} />);
    expect(
      screen.getByText(/1 subservicio activo sin contenido real/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Sub A/)).toBeInTheDocument();
  });

  it("renders plural with N items when multiple subservices missing", () => {
    (useQuery as any).mockReturnValue([
      { subserviceId: "s1", subserviceName: "Sub A", serviceName: "Legal" },
      { subserviceId: "s2", subserviceName: "Sub B", serviceName: "TI" },
      { subserviceId: "s3", subserviceName: "Sub C", serviceName: "Mkt" },
    ]);
    render(<MissingContentBanner projectionId={"p1" as any} />);
    expect(
      screen.getByText(/3 subservicios activos sin contenido real/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Sub A/)).toBeInTheDocument();
    expect(screen.getByText(/Sub B/)).toBeInTheDocument();
    expect(screen.getByText(/Sub C/)).toBeInTheDocument();
  });

  it("renders null when query result is undefined (loading)", () => {
    (useQuery as any).mockReturnValue(undefined);
    const { container } = render(
      <MissingContentBanner projectionId={"p1" as any} />
    );
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/projections/__tests__/missing-content-banner.test.tsx`
Expected: FAIL — module no existe.

- [ ] **Step 3: Implement the component**

Crear `src/components/projections/missing-content-banner.tsx`:

```typescript
"use client";

import { useQuery } from "convex/react";
import { AlertTriangle } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";

type Props = {
  projectionId: Id<"projections">;
};

/**
 * Banner amarillo al top de /proyecciones/[id] que advierte cuando hay
 * subservicios activos sin plantilla con contentStatus="ready".
 * Non-blocking: solo informacional. Spec §5.1
 */
export function MissingContentBanner({ projectionId }: Props) {
  const missing = useQuery(
    api.functions.projections.queries.subservicesMissingContent,
    { projectionId }
  );

  if (!missing || missing.length === 0) return null;

  const isSingular = missing.length === 1;

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 mb-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" />
        <div className="flex-1 text-sm">
          <p className="font-medium text-amber-200 mb-1">
            {isSingular
              ? "1 subservicio activo sin contenido real"
              : `${missing.length} subservicios activos sin contenido real`}
          </p>
          <p className="text-amber-200/70 mb-2">
            Estos entregables se generarán con HTML placeholder hasta que se
            cargue el contenido real:
          </p>
          <ul className="list-disc list-inside space-y-0.5 text-amber-200/90">
            {missing.map((m) => (
              <li key={m.subserviceId}>
                <span className="font-medium">{m.serviceName}</span> ·{" "}
                {m.subserviceName}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/projections/__tests__/missing-content-banner.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire into projection page**

En `src/app/(dashboard)/proyecciones/[id]/page.tsx`, agregar import al top:

```typescript
import { MissingContentBanner } from "@/components/projections/missing-content-banner";
```

Y en el JSX, antes del grid de la matriz (buscar `<MatrixGrid` o similar — el primer componente principal del contenido de la página):

```tsx
<MissingContentBanner projectionId={projectionId} />
```

Donde `projectionId` es la variable ya disponible en scope (typed `Id<"projections">`).

- [ ] **Step 6: Run full suite**

Run: `npm test 2>&1 | tail -5`
Expected: baseline + 4.

Run: `npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -10`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/projections/missing-content-banner.tsx src/components/projections/__tests__/missing-content-banner.test.tsx src/app/\(dashboard\)/proyecciones/\[id\]/page.tsx
git commit -m "feat(projections): add MissingContentBanner to projection page

Non-blocking amber banner lists subservicios activos sin contentStatus=ready
templates. Hidden when nothing to warn about. Operator-facing — papá uses
the tree badge (Task 7) to find what to fill."
```

---

## Task 7: Tree badge + counter en `/configuracion/plantillas`

**Files:**
- Modify: `src/app/(dashboard)/configuracion/plantillas/page.tsx`

- [ ] **Step 1: Inspect current tree card render**

Run: `grep -n "ChevronRight\|template.name\|template.type\|template.version" src/app/\(dashboard\)/configuracion/plantillas/page.tsx | head -10`

Identifica las líneas donde se renderiza cada template card. Buscar el bloque que muestra el nombre + chips de type/version. Ahí se agrega el badge.

- [ ] **Step 2: Add `contentStatus` to local `Template` type**

En el archivo, alrededor de líneas 40-57 donde se define `type Template = {...}`, agregar:

```typescript
type Template = {
  _id: Id<"deliverableTemplates">;
  // ... existing fields
  contentStatus?: "placeholder" | "ready";
  // ... existing fields
};
```

(Si la query backend ya retorna este field via Doc type inference, este tipo manual probablemente ya esté correcto. Verifica el TS check tras agregar.)

- [ ] **Step 3: Add badge inline en el card render**

Encontrar el JSX donde se renderiza el card (probablemente cerca de líneas 350-450 dentro del map del tree). Junto a los chips existentes de type, agregar:

```tsx
{template.contentStatus !== "ready" && (
  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30">
    <AlertTriangle className="h-3 w-3" />
    Sin contenido
  </span>
)}
```

(`AlertTriangle` ya está importado de `lucide-react` en este archivo — línea ~19.)

**Nota:** `!== "ready"` cubre tanto `"placeholder"` como `undefined` (legacy rows pre-migration). Después de PR2 schema tightening, undefined no será posible.

- [ ] **Step 4: Add header counter**

Buscar el `useMemo` que construye `tree` (alrededor de línea 153). Agregar otro useMemo después:

```typescript
const placeholderCount = useMemo(() => {
  if (!tree) return 0;
  return tree.flatMap(({ subservices }) =>
    subservices.flatMap((sub) =>
      sub.templates.filter((row) => row.template.contentStatus !== "ready")
    )
  ).length;
}, [tree]);
```

Y en el header del page (buscar el `<h1>` o título principal), después del título:

```tsx
{placeholderCount > 0 && (
  <span className="ml-3 text-sm text-amber-300">
    {placeholderCount} sin contenido
  </span>
)}
```

- [ ] **Step 5: TypeScript + suite check**

Run: `npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -10`
Expected: clean.

Run: `npm test 2>&1 | tail -5`
Expected: baseline (no nuevos tests para este task, UI manual).

- [ ] **Step 6: Commit**

```bash
git add src/app/\(dashboard\)/configuracion/plantillas/page.tsx
git commit -m "feat(plantillas): add 'Sin contenido' badge + header counter

Per-card badge marks templates with contentStatus !== 'ready'. Header
counter shows total pending so papá ve cuánto le falta de un vistazo.
Reuses existing AlertTriangle icon import."
```

---

## Task 8: Status chip en editor `/configuracion/plantillas/[id]`

**Files:**
- Modify: `src/app/(dashboard)/configuracion/plantillas/[id]/page.tsx`

- [ ] **Step 1: Locate template state + title render**

Run: `grep -n "template?.name\|template.name\|h1\|h2" src/app/\(dashboard\)/configuracion/plantillas/\[id\]/page.tsx | head -10`

Identificar dónde se muestra el título de la plantilla en el header.

- [ ] **Step 2: Add chip next to title**

Junto al título de la plantilla (probablemente cerca de líneas 250-300), agregar conditional chip:

```tsx
{template?.contentStatus === "ready" ? (
  <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
    Ready
  </span>
) : (
  <span className="text-xs text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30">
    Placeholder · borrar el bloque <code>{'<div class="placeholder">'}</code> y guardar lo marca como Ready
  </span>
)}
```

`template` es la variable ya en scope (probablemente derivada de `getByIdWithBanner` o similar query).

- [ ] **Step 3: TypeScript check**

Run: `npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -10`
Expected: clean.

- [ ] **Step 4: Suite check**

Run: `npm test 2>&1 | tail -5`
Expected: baseline (UI cambio sin tests automated; smoke manual cubre).

- [ ] **Step 5: Commit**

```bash
git add src/app/\(dashboard\)/configuracion/plantillas/\[id\]/page.tsx
git commit -m "feat(plantillas/editor): status chip with explicit flip instruction

Papá sees current state at-a-glance + literal instruction of how to
flip Placeholder → Ready (delete the marker div, save). No new
checkbox; the existing detectContentStatus hook handles the flip."
```

---

## Task 9: Bulk-import internal mutation `upsertFromFile`

**Files:**
- Create: `convex/functions/deliverableTemplates/bulkImport.ts`
- Create: `convex/functions/deliverableTemplates/__tests__/bulkImport.test.ts`

- [ ] **Step 1: Write the failing test**

Crear `convex/functions/deliverableTemplates/__tests__/bulkImport.test.ts`:

```typescript
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal } from "../../../_generated/api";
import schema from "../../../schema";

const REAL_HTML = `<h1>Mensual {{cliente.nombre}}</h1>`;
const PLACEHOLDER_HTML = `<div class="placeholder">stub</div>`;

async function setup(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const serviceId = await ctx.db.insert("services", {
      orgId: undefined,
      name: "Legal",
      type: "base",
      minPct: 0,
      maxPct: 100,
      defaultPct: 30,
      isDefault: true,
      sortOrder: 1,
    });
    const subserviceId = await ctx.db.insert("subservices", {
      orgId: undefined,
      parentServiceId: serviceId,
      name: "Asesoría Legal",
      slug: "asesoria-legal",
      defaultFrequency: "mensual",
      isActive: true,
      isDefault: false,
      sortOrder: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { serviceId, subserviceId };
  });
}

describe("deliverableTemplates.bulkImport.upsertFromFile", () => {
  it("creates new global template when none exists", async () => {
    const t = convexTest(schema);
    await setup(t);

    const result = await t.mutation(
      internal.functions.deliverableTemplates.bulkImport.upsertFromFile,
      {
        parentServiceName: "Legal",
        subserviceSlug: "asesoria-legal",
        type: "deliverable_long",
        name: "Asesoría Legal — Reporte",
        htmlTemplate: REAL_HTML,
      }
    );

    expect(result.action).toBe("created");
    expect(result.contentStatus).toBe("ready");

    const tpl = await t.run(async (ctx) => ctx.db.get(result.templateId));
    expect(tpl?.htmlTemplate).toBe(REAL_HTML);
    expect(tpl?.contentStatus).toBe("ready");
    expect(tpl?.orgId).toBeUndefined();
    expect(tpl?.version).toBe(1);
  });

  it("updates existing template + bumps version when one exists", async () => {
    const t = convexTest(schema);
    const { serviceId, subserviceId } = await setup(t);

    const existingId = await t.run(async (ctx) =>
      ctx.db.insert("deliverableTemplates", {
        orgId: undefined,
        serviceId,
        serviceName: "Legal",
        subserviceId,
        type: "deliverable_long",
        name: "Old name",
        htmlTemplate: PLACEHOLDER_HTML,
        variables: [],
        version: 1,
        isActive: true,
        contentStatus: "placeholder",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    );

    const result = await t.mutation(
      internal.functions.deliverableTemplates.bulkImport.upsertFromFile,
      {
        parentServiceName: "Legal",
        subserviceSlug: "asesoria-legal",
        type: "deliverable_long",
        name: "New name",
        htmlTemplate: REAL_HTML,
      }
    );

    expect(result.action).toBe("updated");
    expect(result.templateId).toBe(existingId);
    expect(result.contentStatus).toBe("ready");

    const tpl = await t.run(async (ctx) => ctx.db.get(existingId));
    expect(tpl?.name).toBe("New name");
    expect(tpl?.htmlTemplate).toBe(REAL_HTML);
    expect(tpl?.contentStatus).toBe("ready");
    expect(tpl?.version).toBe(2);
  });

  it("throws when subservice slug not found", async () => {
    const t = convexTest(schema);
    await setup(t);

    await expect(
      t.mutation(internal.functions.deliverableTemplates.bulkImport.upsertFromFile, {
        parentServiceName: "Legal",
        subserviceSlug: "no-existe",
        type: "deliverable_long",
        name: "x",
        htmlTemplate: REAL_HTML,
      })
    ).rejects.toThrow(/Subservice .* not found/);
  });

  it("throws when parent service not found", async () => {
    const t = convexTest(schema);
    await setup(t);

    await expect(
      t.mutation(internal.functions.deliverableTemplates.bulkImport.upsertFromFile, {
        parentServiceName: "NoExiste",
        subserviceSlug: "asesoria-legal",
        type: "deliverable_long",
        name: "x",
        htmlTemplate: REAL_HTML,
      })
    ).rejects.toThrow(/Service .* not found/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/functions/deliverableTemplates/__tests__/bulkImport.test.ts`
Expected: FAIL — module no existe.

- [ ] **Step 3: Implement the mutation**

Crear `convex/functions/deliverableTemplates/bulkImport.ts`:

```typescript
import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import { detectContentStatus } from "../../lib/templateContent";

const STANDARD_VARIABLES = [
  {
    key: "cliente.nombre",
    label: "Nombre del cliente",
    source: "client" as const,
    required: true,
  },
  {
    key: "cliente.rfc",
    label: "RFC del cliente",
    source: "client" as const,
    required: false,
  },
  {
    key: "proyeccion.mes",
    label: "Mes de la proyección",
    source: "projection" as const,
    required: true,
  },
  {
    key: "proyeccion.año",
    label: "Año de la proyección",
    source: "projection" as const,
    required: true,
  },
  {
    key: "ai.diagnostico",
    label: "Diagnóstico ejecutivo (AI)",
    source: "ai" as const,
    required: true,
  },
];

/**
 * Internal upsert called by scripts/import-templates.ts CLI.
 * Looks up subservice by (parentServiceName, subserviceSlug), then upserts
 * a GLOBAL deliverableTemplate (orgId=undefined) for that subservice+type.
 *
 * Returns action='created' | 'updated' + templateId + derived contentStatus.
 * Spec: docs/superpowers/specs/2026-05-25-deliverable-content-catalog-design.md §7
 */
export const upsertFromFile = internalMutation({
  args: {
    parentServiceName: v.string(),
    subserviceSlug: v.string(),
    type: v.union(
      v.literal("quotation"),
      v.literal("contract"),
      v.literal("deliverable_short"),
      v.literal("deliverable_long"),
      v.literal("questionnaire")
    ),
    name: v.string(),
    htmlTemplate: v.string(),
  },
  handler: async (ctx, args) => {
    const parentSvc = await ctx.db
      .query("services")
      .withIndex("by_name", (q) => q.eq("name", args.parentServiceName))
      .first();
    if (!parentSvc) {
      throw new Error(`Service "${args.parentServiceName}" not found.`);
    }

    const subsvc = await ctx.db
      .query("subservices")
      .withIndex("by_parent_slug", (q) =>
        q.eq("parentServiceId", parentSvc._id).eq("slug", args.subserviceSlug)
      )
      .first();
    if (!subsvc) {
      throw new Error(
        `Subservice "${args.subserviceSlug}" under "${args.parentServiceName}" not found.`
      );
    }

    // Look up existing GLOBAL template for (subservice + type)
    const candidates = await ctx.db
      .query("deliverableTemplates")
      .withIndex("by_subservice_contentStatus", (q) =>
        q.eq("subserviceId", subsvc._id)
      )
      .collect();
    const existing = candidates.find(
      (t) => t.orgId === undefined && t.type === args.type
    );

    const contentStatus = detectContentStatus(args.htmlTemplate);
    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        htmlTemplate: args.htmlTemplate,
        version: existing.version + 1,
        contentStatus,
        updatedAt: now,
      });
      return {
        action: "updated" as const,
        templateId: existing._id,
        contentStatus,
      };
    }

    const newId = await ctx.db.insert("deliverableTemplates", {
      orgId: undefined,
      serviceId: parentSvc._id,
      serviceName: parentSvc.name,
      subserviceId: subsvc._id,
      type: args.type,
      name: args.name,
      htmlTemplate: args.htmlTemplate,
      variables: STANDARD_VARIABLES,
      version: 1,
      isActive: true,
      contentStatus,
      createdAt: now,
      updatedAt: now,
    });

    return {
      action: "created" as const,
      templateId: newId,
      contentStatus,
    };
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/functions/deliverableTemplates/__tests__/bulkImport.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run full suite**

Run: `npm test 2>&1 | tail -5`
Expected: baseline + 4.

- [ ] **Step 6: Commit**

```bash
git add convex/functions/deliverableTemplates/bulkImport.ts convex/functions/deliverableTemplates/__tests__/bulkImport.test.ts
git commit -m "feat(deliverableTemplates): add bulkImport.upsertFromFile internal mutation

Called by scripts/import-templates.ts (Task 10). Resolves subservice
by parent+slug, upserts global template per (subservice, type),
bumps version on update, auto-detects contentStatus from HTML."
```

---

## Task 10: Bulk-import CLI + seeds README

**Files:**
- Create: `scripts/import-templates.ts`
- Create: `convex/seeds/templates/README.md`
- Create: `convex/seeds/templates/.gitkeep`

- [ ] **Step 1: Add `tsx` as dev dependency if not present**

Run: `npm ls tsx 2>&1 | head -3`

Si no aparece, instalar:
```bash
npm install --save-dev tsx
```

(Si ya está, skip.)

- [ ] **Step 2: Create the CLI script**

Crear `scripts/import-templates.ts`:

```typescript
#!/usr/bin/env tsx
/**
 * Bulk-import HTML templates from convex/seeds/templates/ to Convex DB.
 *
 * Naming convention: <parent-svc-slug>__<subservice-slug>[-<type>].html
 *   Default type if no suffix: deliverable_long
 *   Valid suffixes: -quotation -contract -short -long -questionnaire
 *
 * Run:
 *   CONVEX_DEPLOY_KEY=$(npx convex deploy-key) npx tsx scripts/import-templates.ts
 *
 * Spec: docs/superpowers/specs/2026-05-25-deliverable-content-catalog-design.md §7
 */

import { readFile, readdir } from "fs/promises";
import { join, basename } from "path";
import { ConvexHttpClient } from "convex/browser";
import { internal } from "../convex/_generated/api";

const TEMPLATES_DIR = process.argv[2] ?? "./convex/seeds/templates";
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
const DEPLOY_KEY = process.env.CONVEX_DEPLOY_KEY;

// Map slug → display name (must match catalog services). Extend as needed.
const SLUG_TO_NAME: Record<string, string> = {
  legal: "Legal",
  contable: "Contable",
  ti: "TI",
  marketing: "Marketing",
  rh: "RH",
  admin: "Admin",
  comisiones: "Comisiones",
  logistica: "Logística",
  construccion: "Construcción",
};

type TemplateType =
  | "quotation"
  | "contract"
  | "deliverable_short"
  | "deliverable_long"
  | "questionnaire";

function parseFilename(filename: string): {
  parentSvcSlug: string;
  subserviceSlug: string;
  type: TemplateType;
} {
  const base = basename(filename, ".html");
  const [parentSvcSlug, rest] = base.split("__");
  if (!parentSvcSlug || !rest) {
    throw new Error(
      `Invalid name "${filename}": expected <parent>__<subslug>[-<type>].html`
    );
  }
  const typeMatch = rest.match(
    /-(quotation|contract|short|long|questionnaire)$/
  );
  let type: TemplateType = "deliverable_long";
  let subserviceSlug = rest;
  if (typeMatch) {
    const suffix = typeMatch[1];
    type =
      suffix === "short"
        ? "deliverable_short"
        : suffix === "long"
          ? "deliverable_long"
          : (suffix as TemplateType);
    subserviceSlug = rest.slice(0, -typeMatch[0].length);
  }
  return { parentSvcSlug, subserviceSlug, type };
}

function humanize(slug: string): string {
  return slug
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

function typeLabel(type: TemplateType): string {
  return {
    quotation: "Cotización",
    contract: "Contrato",
    deliverable_short: "Reporte Breve",
    deliverable_long: "Reporte Completo",
    questionnaire: "Cuestionario",
  }[type];
}

async function main() {
  if (!CONVEX_URL || !DEPLOY_KEY) {
    console.error(
      "Missing env vars. Run: CONVEX_DEPLOY_KEY=$(npx convex deploy-key) NEXT_PUBLIC_CONVEX_URL=... npx tsx scripts/import-templates.ts"
    );
    process.exit(1);
  }

  const client = new ConvexHttpClient(CONVEX_URL);
  client.setAdminAuth(DEPLOY_KEY);

  const all = await readdir(TEMPLATES_DIR);
  const files = all.filter((f) => f.endsWith(".html"));
  console.log(`Found ${files.length} HTML templates in ${TEMPLATES_DIR}\n`);

  let created = 0;
  let updated = 0;
  let errors = 0;

  for (const file of files) {
    try {
      const { parentSvcSlug, subserviceSlug, type } = parseFilename(file);
      const html = await readFile(join(TEMPLATES_DIR, file), "utf-8");

      const parentServiceName = SLUG_TO_NAME[parentSvcSlug];
      if (!parentServiceName) {
        throw new Error(
          `Unknown parent slug "${parentSvcSlug}". Add it to SLUG_TO_NAME.`
        );
      }

      const name = `${humanize(subserviceSlug)} — ${typeLabel(type)}`;

      const result = await client.mutation(
        internal.functions.deliverableTemplates.bulkImport.upsertFromFile,
        {
          parentServiceName,
          subserviceSlug,
          type,
          name,
          htmlTemplate: html,
        }
      );

      const sym = result.action === "created" ? "✓ created" : "↻ updated";
      console.log(`${sym} ${file} (status: ${result.contentStatus})`);
      if (result.action === "created") created++;
      else updated++;
    } catch (err) {
      console.error(`✗ ${file}: ${(err as Error).message}`);
      errors++;
    }
  }

  console.log(`\n${created} created · ${updated} updated · ${errors} errors`);
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Create seeds dir + README**

Crear `convex/seeds/templates/.gitkeep` (archivo vacío):

```bash
mkdir -p convex/seeds/templates
touch convex/seeds/templates/.gitkeep
```

Crear `convex/seeds/templates/README.md`:

```markdown
# Deliverable Templates — Bulk Seed Directory

Pon archivos `.html` aquí y corre el script para upsert masivo a Convex DB.

## Naming Convention

`<parent-svc-slug>__<subservice-slug>[-<type>].html`

- `parent-svc-slug` — slug del Service padre. Mapping en `scripts/import-templates.ts:SLUG_TO_NAME`. Slugs válidos hoy: `legal`, `contable`, `ti`, `marketing`, `rh`, `admin`, `comisiones`, `logistica`, `construccion`.
- `subservice-slug` — slug exacto del Subservice (column `subservices.slug`). Ver `/configuracion/subservicios` o `npx convex data subservices` para listar slugs.
- `<type>` (opcional) — sufijo `-quotation`, `-contract`, `-short`, `-long`, `-questionnaire`. Default: `deliverable_long`.

## Ejemplos

- `legal__asesoria-legal.html` → Legal · Asesoría Legal · Reporte Completo
- `contable__estados-financieros-quotation.html` → Contable · Estados Financieros · Cotización
- `marketing__contenido-redes-short.html` → Marketing · Contenido Redes · Reporte Breve

## Cómo correr

```bash
# 1. Crear/editar .html files aquí (Claude Code amigable — pídele a Claude:
#    "Genera HTML para el reporte mensual de Asesoría Legal usando estas
#     variables: {{cliente.nombre}}, {{cliente.rfc}}, {{proyeccion.mes}},
#     {{proyeccion.año}}, {{ai.diagnostico}}")

# 2. Auth + run
CONVEX_DEPLOY_KEY=$(npx convex deploy-key) \
NEXT_PUBLIC_CONVEX_URL=$(npx convex env get NEXT_PUBLIC_CONVEX_URL 2>/dev/null || cat .env.local | grep NEXT_PUBLIC_CONVEX_URL | cut -d= -f2) \
  npx tsx scripts/import-templates.ts

# 3. Verifica output (esperado: ✓ created / ↻ updated per file).
```

## Variables disponibles

Todas las plantillas creadas via bulk-import vienen con estas 5 variables estándar declaradas (mismo set que el seed del 2026-05-22):

- `{{cliente.nombre}}` — required, source: client
- `{{cliente.rfc}}` — optional, source: client
- `{{proyeccion.mes}}` — required, source: projection
- `{{proyeccion.año}}` — required, source: projection
- `{{ai.diagnostico}}` — required, source: ai (Claude API rellena en generation)

## contentStatus auto-detection

El script NO necesita decirle a Convex si el HTML es placeholder o ready. Lo detecta automáticamente:

- HTML contiene `<div class="placeholder">` → `contentStatus = "placeholder"`
- HTML NO contiene ese marker → `contentStatus = "ready"`

Si necesitas dejar una plantilla en estado "placeholder" intencionalmente (ej: tienes header listo pero contenido no), incluye el marker en algún parte del HTML.

## Bulk vs in-app editor

- **Bulk-import** (este flujo): para llenar muchas plantillas iniciales o re-importar batch desde versionado en git.
- **In-app editor** (`/configuracion/plantillas/[id]`): para hot-fixes puntuales sin tocar el filesystem.

Convención: bulk-import es la fuente de verdad para iniciales; in-app es para ajustes ad-hoc. NO hay sync bidireccional automático — si editas in-app, esos cambios NO se exportan a `.html` files.
```

- [ ] **Step 4: Smoke run with empty templates dir**

```bash
CONVEX_DEPLOY_KEY=$(npx convex deploy-key) \
NEXT_PUBLIC_CONVEX_URL=$(cat .env.local | grep NEXT_PUBLIC_CONVEX_URL | cut -d= -f2) \
  npx tsx scripts/import-templates.ts
```

Expected output:
```
Found 0 HTML templates in ./convex/seeds/templates

0 created · 0 updated · 0 errors
```

(Si falla por env vars u otra cosa, debugger con verbose.)

- [ ] **Step 5: TypeScript check**

Run: `npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -10`
Expected: clean.

- [ ] **Step 6: Run full suite (sanity)**

Run: `npm test 2>&1 | tail -5`
Expected: baseline (script no agrega tests, solo plumbing).

- [ ] **Step 7: Commit**

```bash
git add scripts/import-templates.ts convex/seeds/templates/README.md convex/seeds/templates/.gitkeep package.json package-lock.json
git commit -m "feat(bulk-import): add CLI script + seeds dir + README

Reads .html files from convex/seeds/templates/ and upserts via internal
mutation. Filename convention: <parent-slug>__<sub-slug>[-<type>].html.
Default type deliverable_long. Auto-detects contentStatus from HTML.
Enables Claude Code workflow: papá writes 33 templates in one session
then runs script once vs 33 manual copy-paste rounds."
```

(Si no se instaló tsx en Step 1, omitir package*.json del add.)

---

## Task 11: PR1 final — smoke + dev backfill + import fixture

**Files:** ninguno modificado (verificación + ejecución manual)

- [ ] **Step 1: Full test suite + tsc**

Run: `npm test 2>&1 | tail -5`
Expected: baseline + ~20 tests (~851 passing | 1 skipped).

Run: `npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -10`
Expected: clean.

- [ ] **Step 2: Dry-run migration en dev Convex**

Run: `npx convex run functions/migrations/templateContentStatus:migrate '{"dryRun": true}'`
Expected output:
```
{ templates: ~33+, dryRun: true }
```

- [ ] **Step 3: Apply migration en dev**

Run: `npx convex run functions/migrations/templateContentStatus:migrate '{"dryRun": false}'`
Expected: same counts, `dryRun: false`.

- [ ] **Step 4: Verify**

Run: `npx convex run functions/migrations/templateContentStatus:verifyComplete '{}'`
Expected: `{ templatesPending: 0 }`.

- [ ] **Step 5: Bulk-import fixture sanity**

Crear archivo de prueba:

```bash
cat > convex/seeds/templates/legal__asesoria-legal.html <<'EOF'
<!DOCTYPE html>
<html><body>
<h1>Asesoría Legal — Reporte Mensual</h1>
<p>Cliente: {{cliente.nombre}} (RFC: {{cliente.rfc}})</p>
<p>Periodo: {{proyeccion.mes}}/{{proyeccion.año}}</p>
<h2>Diagnóstico</h2>
<p>{{ai.diagnostico}}</p>
</body></html>
EOF
```

Run el import:

```bash
CONVEX_DEPLOY_KEY=$(npx convex deploy-key) \
NEXT_PUBLIC_CONVEX_URL=$(cat .env.local | grep NEXT_PUBLIC_CONVEX_URL | cut -d= -f2) \
  npx tsx scripts/import-templates.ts
```

Expected:
```
Found 1 HTML templates in ./convex/seeds/templates
↻ updated legal__asesoria-legal.html (status: ready)
0 created · 1 updated · 0 errors
```

(Es `updated` porque ya existe seeded del 2026-05-22 con ese subservice + deliverable_long. `contentStatus` flippea a `ready` post-import.)

- [ ] **Step 6: Manual smoke en browser (Christian)**

1. Abrir `http://localhost:3000/configuracion/plantillas` → ver counter "32 sin contenido" (era 33, ahora 32 porque "asesoria-legal" se llenó vía bulk-import).
2. Esa card de Asesoría Legal NO tiene badge "Sin contenido" — está ready.
3. Click en otra plantilla placeholder → chip amarillo con instrucción.
4. Borrar marker + guardar → chip cambia a verde "Ready"; counter en /configuracion/plantillas baja a 31.
5. Abrir `/proyecciones/[id]` (cualquier projection con subservices activos) → banner amarillo lista subservicios sin contenido (asume hay alguno).

Si algún paso falla, abrir issue + parar antes de Task 12.

- [ ] **Step 7: Wait for explicit OK from Christian before prod deploy**

Per memoria `feedback_no_push_default`: no `git push`, no `convex deploy --prod` sin OK explícito.

Cuando Christian apruebe:
```bash
git push origin feature/sub-spec-1-content-catalog  # o el branch usado
gh pr create --base main
# (review + merge)
npx convex deploy
npx convex run --prod functions/migrations/templateContentStatus:migrate '{"dryRun": true}'
npx convex run --prod functions/migrations/templateContentStatus:migrate '{"dryRun": false}'
npx convex run --prod functions/migrations/templateContentStatus:verifyComplete '{}'
```

---

## Task 12: PR2 — Tighten schema to required

**Files:**
- Modify: `convex/schema.ts`

**Pre-requisito:** Task 11 step 7 completado en prod. `verifyComplete` returnea `{ templatesPending: 0 }` en prod.

- [ ] **Step 1: Verify migration applied in prod**

Run: `npx convex run --prod functions/migrations/templateContentStatus:verifyComplete '{}'`
Expected: `{ templatesPending: 0 }`.

Si NO retorna 0, no proceder.

- [ ] **Step 2: Remove `v.optional()` from `contentStatus`**

En `convex/schema.ts`, dentro de `deliverableTemplates: defineTable({ ... })`:

```typescript
// Antes (PR1):
contentStatus: v.optional(
  v.union(
    v.literal("placeholder"),
    v.literal("ready")
  )
),

// Después (PR2):
contentStatus: v.union(
  v.literal("placeholder"),
  v.literal("ready")
),
```

- [ ] **Step 3: Verify schema deploys cleanly**

Run: `npx convex dev --once`
Expected: "Schema is up to date" (porque todos los rows ya tienen contentStatus post-migration).

- [ ] **Step 4: Run tests + tsc**

Run: `npm test 2>&1 | tail -5`
Expected: ~851 passing (sin cambios).

Run: `npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -10`
Expected: clean.

- [ ] **Step 5: Remove migration module**

```bash
git rm convex/functions/migrations/templateContentStatus.ts
git rm convex/functions/migrations/__tests__/templateContentStatus.test.ts
```

- [ ] **Step 6: Run tests again**

Run: `npm test 2>&1 | tail -5`
Expected: ~847 passing (4 menos por migration tests borrados).

- [ ] **Step 7: Commit**

```bash
git add convex/schema.ts
git commit -m "feat(schema): tighten contentStatus to required

Backfill verified complete in prod (verifyComplete = 0 pending).
contentStatus is now required on deliverableTemplates. Removes the
internal migration module — no longer needed."
```

- [ ] **Step 8: Deploy (espera OK explícito de Christian per memoria)**

```bash
git push origin main
npx convex deploy
```

---

## Self-review checklist

Antes de marcar plan completo:

- [ ] Cada task tiene 4-7 steps de 2-5 min cada uno.
- [ ] Cada task tiene un commit explícito al final.
- [ ] TDD: failing test → impl → passing test → commit.
- [ ] Sin placeholders ("TBD", "implement later", etc.).
- [ ] Paths exactos en todos los `Files:` headers.
- [ ] Código completo en cada step.
- [ ] Commands con expected output.
- [ ] Cobertura del spec:
  - §1 overview → tasks 1-11 PR1
  - §2 schema → tasks 2 + 12 (tightening)
  - §3 detector → task 1
  - §4 query → task 5
  - §5 UI → tasks 6, 7, 8
  - §6 migration → task 4
  - §7 bulk-import → tasks 9, 10
  - §8 testing → todos los tasks tienen tests
  - §9 out-of-scope → no se implementa nada de eso
