# Phase 2 — Performance: índices + dashboard queries + crons paginados

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar el riesgo de escalado post-launch del spec `docs/superpowers/specs/2026-05-28-schema-coherence-audit-design.md` §6: agregar 4 índices nuevos, refactorizar 5 queries del dashboard que hacen full scan, y paginar 3 crons cross-org. Resultado: dashboard que escala con N orgs × M assignments, crons que no explotan con multi-tenant growth.

**Architecture:** 8 tasks ejecutadas como commits atómicos. Task 1 agrega los 4 índices (backward-compatible, no rompe nada). Tasks 2-6 refactorizan queries para usar índices nuevos/existentes. Tasks 7-9 paginan crons por orgId vía `organizations` lookup + per-org queries indexadas. Task 10 final verify. TDD para los refactors (test de equivalencia: mismo input → mismo output, pero con índice).

**Tech Stack:** Convex (queries, internalQueries, internalActions, schema indexes), Vitest + convex-test edge-runtime. Tests existentes baseline 1124 — no se rompen.

---

## Pre-flight

- [ ] **Step 0.1: Baseline limpio**

Run: `npm test 2>&1 | tail -3 && npx tsc --noEmit 2>&1 | tail -3`
Expected:
```
Tests 1124 passed | 1 skipped
(0 TS errors)
```

- [ ] **Step 0.2: Working tree**

Run: `git status --short`
Expected: solo `?? docs/superpowers/plans/2026-05-28-fase4-...` (unrelated untracked). Si hay otros mods, pausar.

---

## Task 1: Agregar 4 índices nuevos al schema

**Files:**
- Modify: `convex/schema.ts`

**Contexto:** Los 4 índices nuevos son backward-compatible — Convex permite agregar índices sin migración. Lock-in del schema cambia, todos los tests siguen verdes. Los índices habilitan los refactors de Tasks 2-9.

**Índices:**
- `monthlyAssignments.by_orgId_year` — refactor dashboard queries que filtran por año
- `monthlyAssignments.by_clientId_year_month` — futuro getBillingBreakdown, no usado en Phase 2 pero documentado
- `projections.by_orgId_status` — refactor crons que filtran active
- `deliverables.by_orgId_clientId_year` — futuro listByClientMatrix, no usado en Phase 2 pero documentado

- [ ] **Step 1.1: Agregar índices**

En `convex/schema.ts`, encuentra la tabla `monthlyAssignments` (alrededor de línea 259-289). Después del último `.index(...)` (`by_orgId_invoiceStatus`), agrega:

```ts
    .index("by_orgId_year", ["orgId", "year"])
    .index("by_clientId_year_month", ["clientId", "year", "month"]),
```

NOTA: el último `.index` actual termina con `]),` cerrando defineTable. Cambia ese `]),` a `])`, agrega los nuevos `.index(...)` arriba, y termina el último con `,`.

Encuentra `projections` defineTable (~ línea 50-106). Después del último `.index("by_clientId_year", ...)`, agrega:

```ts
    .index("by_orgId_status", ["orgId", "status"])
```

Encuentra `deliverables` defineTable (~ línea 453-515). Después del último `.index("by_triggerInvoiceId", ...)`, agrega:

```ts
    .index("by_orgId_clientId_year", ["orgId", "clientId", "year"])
```

- [ ] **Step 1.2: Verificar codegen + tests**

Run: `npx convex codegen 2>&1 | tail -3 && npm test 2>&1 | tail -3`
Expected: codegen OK, 1124 tests pass.

- [ ] **Step 1.3: Commit**

```bash
git add convex/schema.ts
git commit -m "$(cat <<'EOF'
feat(schema): agregar 4 índices para performance del dashboard + crons

Phase 2 §6.2:
- monthlyAssignments.by_orgId_year (dashboard year-only queries)
- monthlyAssignments.by_clientId_year_month (billing breakdown)
- projections.by_orgId_status (cron pagination)
- deliverables.by_orgId_clientId_year (matriz por cliente)

Backward-compatible. No breaking changes en código existente.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Refactor `dashboard.deliverableStats` para usar `by_orgId_year`

**Files:**
- Modify: `convex/functions/dashboard/queries.ts:69-116` (`deliverableStats`)
- Create: `convex/functions/dashboard/__tests__/deliverableStats.test.ts`

**Contexto:** Hoy hace `by_orgId` + `.collect()` + filter year en JS. Con multi-tenant growth: full scan de monthlyAssignments. Refactor: `by_orgId_year` direct lookup. El test bloquea regresión de resultados.

- [ ] **Step 2.1: Escribir test rojo de equivalencia**

Crear `convex/functions/dashboard/__tests__/deliverableStats.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api } from "../../../_generated/api";

const ORG_A = "org_test_A";

describe("dashboard.deliverableStats", () => {
  it("returns correct counts by status for the requested year", async () => {
    const t = convexTest(schema);
    const currentYear = new Date().getFullYear();
    const targetYear = 2099; // future year so "overdue" logic doesn't fire

    await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: ORG_A, name: "C", rfc: "X", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: ORG_A, clientId, year: targetYear,
        annualSales: 0, totalBudget: 0, commissionRate: 0,
        seasonalityData: [], status: "active",
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      const serviceId = await ctx.db.insert("services", {
        name: "S", type: "base", minPct: 0, maxPct: 100,
        defaultPct: 10, isDefault: true, sortOrder: 0,
      });
      const psId = await ctx.db.insert("projectionServices", {
        orgId: ORG_A, projectionId, serviceId, serviceName: "S",
        chosenPct: 10, isActive: true, annualAmount: 0, normalizedWeight: 1,
      });
      // 2 pending, 1 in_progress, 1 delivered, all in targetYear
      const statuses = ["pending", "pending", "in_progress", "delivered"] as const;
      for (let i = 0; i < statuses.length; i++) {
        await ctx.db.insert("monthlyAssignments", {
          orgId: ORG_A, projServiceId: psId, projectionId, clientId,
          serviceName: "S", month: i + 1, year: targetYear,
          amount: 100, feFactor: 1,
          status: statuses[i],
          invoiceStatus: "not_invoiced",
        });
      }
      // 1 delivered in a DIFFERENT year — must NOT be counted
      await ctx.db.insert("monthlyAssignments", {
        orgId: ORG_A, projServiceId: psId, projectionId, clientId,
        serviceName: "S", month: 1, year: targetYear + 1,
        amount: 100, feFactor: 1,
        status: "delivered", invoiceStatus: "paid",
      });
    });

    const result = await t
      .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
      .query(api.functions.dashboard.queries.deliverableStats, { year: targetYear });

    expect(result.pending).toBe(2);
    expect(result.in_progress).toBe(1);
    expect(result.delivered).toBe(1);
    expect(result.info_received).toBe(0);
    expect(result.overdue).toBe(0); // future year
  });

  it("isolates by org (does not count assignments from other orgs)", async () => {
    const t = convexTest(schema);
    const targetYear = 2099;
    await t.run(async (ctx) => {
      // Org A
      const cA = await ctx.db.insert("clients", {
        orgId: ORG_A, name: "CA", rfc: "XA", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      const pA = await ctx.db.insert("projections", {
        orgId: ORG_A, clientId: cA, year: targetYear,
        annualSales: 0, totalBudget: 0, commissionRate: 0,
        seasonalityData: [], status: "active",
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      const sId = await ctx.db.insert("services", {
        name: "S", type: "base", minPct: 0, maxPct: 100,
        defaultPct: 10, isDefault: true, sortOrder: 0,
      });
      const psA = await ctx.db.insert("projectionServices", {
        orgId: ORG_A, projectionId: pA, serviceId: sId, serviceName: "S",
        chosenPct: 10, isActive: true, annualAmount: 0, normalizedWeight: 1,
      });
      await ctx.db.insert("monthlyAssignments", {
        orgId: ORG_A, projServiceId: psA, projectionId: pA, clientId: cA,
        serviceName: "S", month: 1, year: targetYear, amount: 100, feFactor: 1,
        status: "pending", invoiceStatus: "not_invoiced",
      });
      // Org B
      const cB = await ctx.db.insert("clients", {
        orgId: "org_test_B", name: "CB", rfc: "XB", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      const pB = await ctx.db.insert("projections", {
        orgId: "org_test_B", clientId: cB, year: targetYear,
        annualSales: 0, totalBudget: 0, commissionRate: 0,
        seasonalityData: [], status: "active",
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      const psB = await ctx.db.insert("projectionServices", {
        orgId: "org_test_B", projectionId: pB, serviceId: sId, serviceName: "S",
        chosenPct: 10, isActive: true, annualAmount: 0, normalizedWeight: 1,
      });
      await ctx.db.insert("monthlyAssignments", {
        orgId: "org_test_B", projServiceId: psB, projectionId: pB, clientId: cB,
        serviceName: "S", month: 1, year: targetYear, amount: 100, feFactor: 1,
        status: "delivered", invoiceStatus: "paid",
      });
    });

    const result = await t
      .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
      .query(api.functions.dashboard.queries.deliverableStats, { year: targetYear });
    expect(result.pending).toBe(1);
    expect(result.delivered).toBe(0); // org B's delivered MUST NOT count
  });
});
```

- [ ] **Step 2.2: Correr — debe pasar con el código actual (test de equivalencia)**

Run: `npx vitest run convex/functions/dashboard/__tests__/deliverableStats.test.ts`
Expected: 2 tests PASS (verifica baseline antes del refactor).

- [ ] **Step 2.3: Refactor a usar `by_orgId_year`**

En `convex/functions/dashboard/queries.ts:89-93`, REEMPLAZAR:

```ts
    const assignments = await ctx.db
      .query("monthlyAssignments")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect()
      .then((all) => all.filter((a) => a.year === year));
```

POR:

```ts
    const assignments = await ctx.db
      .query("monthlyAssignments")
      .withIndex("by_orgId_year", (q) => q.eq("orgId", orgId).eq("year", year))
      .collect();
```

- [ ] **Step 2.4: Tests siguen pasando**

Run: `npx vitest run convex/functions/dashboard/__tests__/deliverableStats.test.ts`
Expected: 2 tests PASS (mismos resultados, ahora con índice).

- [ ] **Step 2.5: Commit**

```bash
git add convex/functions/dashboard/queries.ts convex/functions/dashboard/__tests__/deliverableStats.test.ts
git commit -m "$(cat <<'EOF'
perf(dashboard): deliverableStats usa by_orgId_year (no full scan)

Phase 2 §6.1. Refactor de full scan + JS filter a direct index lookup.
Tests de equivalencia + cross-org isolation agregados.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Refactor `dashboard.clientSummary` para usar `by_orgId_year`

**Files:**
- Modify: `convex/functions/dashboard/queries.ts:122-198` (`clientSummary`)
- Create: `convex/functions/dashboard/__tests__/clientSummary.test.ts`

**Contexto:** Mismo patrón que Task 2 pero para clientSummary. También hace full scan en `monthlyAssignments` y filtra year en JS.

- [ ] **Step 3.1: Escribir test rojo de equivalencia**

Crear `convex/functions/dashboard/__tests__/clientSummary.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api } from "../../../_generated/api";

const ORG_A = "org_test_A";

describe("dashboard.clientSummary", () => {
  it("returns per-client summary for the requested year", async () => {
    const t = convexTest(schema);
    const targetYear = 2099;
    await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: ORG_A, name: "Acme", rfc: "ACM010101AAA", industry: "Tech",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: ORG_A, clientId, year: targetYear,
        annualSales: 0, totalBudget: 0, commissionRate: 0,
        seasonalityData: [], status: "active",
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      const sId = await ctx.db.insert("services", {
        name: "S", type: "base", minPct: 0, maxPct: 100,
        defaultPct: 10, isDefault: true, sortOrder: 0,
      });
      const psId = await ctx.db.insert("projectionServices", {
        orgId: ORG_A, projectionId, serviceId: sId, serviceName: "S",
        chosenPct: 10, isActive: true, annualAmount: 0, normalizedWeight: 1,
      });
      // 2 assignments en targetYear, 1 en otro año
      await ctx.db.insert("monthlyAssignments", {
        orgId: ORG_A, projServiceId: psId, projectionId, clientId,
        serviceName: "S", month: 1, year: targetYear, amount: 100, feFactor: 1,
        status: "pending", invoiceStatus: "not_invoiced",
      });
      await ctx.db.insert("monthlyAssignments", {
        orgId: ORG_A, projServiceId: psId, projectionId, clientId,
        serviceName: "S", month: 2, year: targetYear, amount: 100, feFactor: 1,
        status: "delivered", invoiceStatus: "paid",
      });
      await ctx.db.insert("monthlyAssignments", {
        orgId: ORG_A, projServiceId: psId, projectionId, clientId,
        serviceName: "S", month: 1, year: targetYear - 1, amount: 100, feFactor: 1,
        status: "delivered", invoiceStatus: "paid",
      });
    });

    const result = await t
      .withIdentity({
        subject: "u", tokenIdentifier: "u", orgId: ORG_A, orgRole: "org:admin",
      } as any)
      .query(api.functions.dashboard.queries.clientSummary, { year: targetYear });

    expect(result).toHaveLength(1);
    expect(result[0].clientName).toBe("Acme");
    expect(result[0].totalAssignments).toBe(2); // solo targetYear
    expect(result[0].activeProjections).toBe(1);
    expect(result[0].activeServices).toBe(1); // S tiene 1 no-delivered
    expect(result[0].pendingPayments).toBe(1); // only the pending one
  });
});
```

- [ ] **Step 3.2: Test passes con código actual**

Run: `npx vitest run convex/functions/dashboard/__tests__/clientSummary.test.ts`
Expected: PASS.

- [ ] **Step 3.3: Refactor**

En `convex/functions/dashboard/queries.ts:147-151`, REEMPLAZAR:

```ts
    const assignments = await ctx.db
      .query("monthlyAssignments")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect()
      .then((all) => all.filter((a) => a.year === year));
```

POR:

```ts
    const assignments = await ctx.db
      .query("monthlyAssignments")
      .withIndex("by_orgId_year", (q) => q.eq("orgId", orgId).eq("year", year))
      .collect();
```

- [ ] **Step 3.4: Test sigue pasando**

Run: `npx vitest run convex/functions/dashboard/__tests__/clientSummary.test.ts`
Expected: PASS.

- [ ] **Step 3.5: Commit**

```bash
git add convex/functions/dashboard/queries.ts convex/functions/dashboard/__tests__/clientSummary.test.ts
git commit -m "$(cat <<'EOF'
perf(dashboard): clientSummary usa by_orgId_year (no full scan)

Phase 2 §6.1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Refactor `dashboard.alerts` para usar `by_orgId_year`

**Files:**
- Modify: `convex/functions/dashboard/queries.ts:203-280` (`alerts`)
- Create: `convex/functions/dashboard/__tests__/alerts.test.ts`

**Contexto:** Mismo patrón. `alerts` también colecta full scan de monthlyAssignments y filtra year en JS.

- [ ] **Step 4.1: Test de equivalencia**

Crear `convex/functions/dashboard/__tests__/alerts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api } from "../../../_generated/api";

const ORG_A = "org_test_A";

describe("dashboard.alerts", () => {
  it("returns overdue + unpaid for the requested year", async () => {
    const t = convexTest(schema);
    const now = new Date();
    const currentYear = now.getFullYear();
    const pastMonth = now.getMonth() === 0 ? 12 : now.getMonth();
    const pastYear = now.getMonth() === 0 ? currentYear - 1 : currentYear;

    await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: ORG_A, name: "Acme", rfc: "ACM010101AAA", industry: "Tech",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: ORG_A, clientId, year: pastYear,
        annualSales: 0, totalBudget: 0, commissionRate: 0,
        seasonalityData: [], status: "active",
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      const sId = await ctx.db.insert("services", {
        name: "S", type: "base", minPct: 0, maxPct: 100,
        defaultPct: 10, isDefault: true, sortOrder: 0,
      });
      const psId = await ctx.db.insert("projectionServices", {
        orgId: ORG_A, projectionId, serviceId: sId, serviceName: "S",
        chosenPct: 10, isActive: true, annualAmount: 0, normalizedWeight: 1,
      });
      // overdue: past month, not delivered
      await ctx.db.insert("monthlyAssignments", {
        orgId: ORG_A, projServiceId: psId, projectionId, clientId,
        serviceName: "S", month: pastMonth, year: pastYear,
        amount: 100, feFactor: 1,
        status: "pending", invoiceStatus: "not_invoiced",
      });
      // unpaid: invoiced but not paid
      await ctx.db.insert("monthlyAssignments", {
        orgId: ORG_A, projServiceId: psId, projectionId, clientId,
        serviceName: "S", month: pastMonth, year: pastYear,
        amount: 100, feFactor: 1,
        status: "delivered", invoiceStatus: "invoiced",
      });
    });

    const result = await t
      .withIdentity({
        subject: "u", tokenIdentifier: "u", orgId: ORG_A, orgRole: "org:admin",
      } as any)
      .query(api.functions.dashboard.queries.alerts, { year: pastYear });

    expect(result.overdueAssignments).toHaveLength(1);
    expect(result.overdueAssignments[0].clientName).toBe("Acme");
    expect(result.unpaidInvoices).toHaveLength(1);
  });
});
```

- [ ] **Step 4.2: Test pasa con código actual**

Run: `npx vitest run convex/functions/dashboard/__tests__/alerts.test.ts`
Expected: PASS.

- [ ] **Step 4.3: Refactor**

En `convex/functions/dashboard/queries.ts:219-223`, REEMPLAZAR:

```ts
    const assignments = await ctx.db
      .query("monthlyAssignments")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect()
      .then((all) => all.filter((a) => a.year === year));
```

POR:

```ts
    const assignments = await ctx.db
      .query("monthlyAssignments")
      .withIndex("by_orgId_year", (q) => q.eq("orgId", orgId).eq("year", year))
      .collect();
```

- [ ] **Step 4.4: Test sigue pasando**

Run: `npx vitest run convex/functions/dashboard/__tests__/alerts.test.ts`
Expected: PASS.

- [ ] **Step 4.5: Commit**

```bash
git add convex/functions/dashboard/queries.ts convex/functions/dashboard/__tests__/alerts.test.ts
git commit -m "$(cat <<'EOF'
perf(dashboard): alerts usa by_orgId_year (no full scan)

Phase 2 §6.1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Refactor `clients.list` para usar índices selectivos

**Files:**
- Modify: `convex/functions/clients/queries.ts:5-50` (`list`)
- Create: `convex/functions/clients/__tests__/list.test.ts`

**Contexto:** `clients.list` hace `by_orgId` + JS filter sobre `isArchived`, `industry`, `assignedTo`. Los 3 índices compuestos existen (`by_orgId_archived`, `by_orgId_industry`, `by_orgId_assignedTo`) pero no se usan. Refactor: branch en el handler — si solo viene 1 filter "fuerte" (industry o assignedTo), usar ese índice; sino usar `by_orgId_archived`.

Estrategia: PRIORIZAR el filter más selectivo:
1. Si `args.industry` set → `by_orgId_industry`
2. Sino si role=member → `by_orgId_assignedTo` (con `assignedTo = identity?.subject`)
3. Sino si `!args.includeArchived` → `by_orgId_archived` con `isArchived=false`
4. Sino → `by_orgId` (full)

Search (text) sigue post-filter en JS — no hay índice fulltext.

- [ ] **Step 5.1: Test de equivalencia**

Crear `convex/functions/clients/__tests__/list.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api } from "../../../_generated/api";

const ORG_A = "org_test_A";

async function seedClients(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const a = await ctx.db.insert("clients", {
      orgId: ORG_A, name: "Acme", rfc: "ACM010101AAA",
      industry: "Tech", annualRevenue: 0, billingFrequency: "mensual",
      isArchived: false, assignedTo: "user_X", createdAt: 1,
    });
    const b = await ctx.db.insert("clients", {
      orgId: ORG_A, name: "Beta", rfc: "BTA010101BBB",
      industry: "Retail", annualRevenue: 0, billingFrequency: "mensual",
      isArchived: false, assignedTo: "user_Y", createdAt: 2,
    });
    const c = await ctx.db.insert("clients", {
      orgId: ORG_A, name: "Gamma", rfc: "GMA010101CCC",
      industry: "Tech", annualRevenue: 0, billingFrequency: "mensual",
      isArchived: true, assignedTo: "user_X", createdAt: 3,
    });
    return { a, b, c };
  });
}

describe("clients.list", () => {
  it("returns non-archived clients by default for admin", async () => {
    const t = convexTest(schema);
    await seedClients(t);

    const result = await t
      .withIdentity({
        subject: "user_X", tokenIdentifier: "u", orgId: ORG_A,
        orgRole: "org:admin",
      } as any)
      .query(api.functions.clients.queries.list, {});

    expect(result.map((c: any) => c.name).sort()).toEqual(["Acme", "Beta"]);
  });

  it("filters by industry when set", async () => {
    const t = convexTest(schema);
    await seedClients(t);

    const result = await t
      .withIdentity({
        subject: "user_X", tokenIdentifier: "u", orgId: ORG_A,
        orgRole: "org:admin",
      } as any)
      .query(api.functions.clients.queries.list, { industry: "Tech" });

    expect(result.map((c: any) => c.name).sort()).toEqual(["Acme"]); // Gamma archived excluded
  });

  it("filters by assignedTo for org:member role", async () => {
    const t = convexTest(schema);
    await seedClients(t);

    const result = await t
      .withIdentity({
        subject: "user_X", tokenIdentifier: "u", orgId: ORG_A,
        orgRole: "org:member",
      } as any)
      .query(api.functions.clients.queries.list, {});

    expect(result.map((c: any) => c.name).sort()).toEqual(["Acme"]); // only assignedTo=user_X, non-archived
  });

  it("includes archived when includeArchived=true", async () => {
    const t = convexTest(schema);
    await seedClients(t);

    const result = await t
      .withIdentity({
        subject: "user_X", tokenIdentifier: "u", orgId: ORG_A,
        orgRole: "org:admin",
      } as any)
      .query(api.functions.clients.queries.list, { includeArchived: true });

    expect(result.map((c: any) => c.name).sort()).toEqual(["Acme", "Beta", "Gamma"]);
  });

  it("filters by search term (name or RFC)", async () => {
    const t = convexTest(schema);
    await seedClients(t);

    const result = await t
      .withIdentity({
        subject: "user_X", tokenIdentifier: "u", orgId: ORG_A,
        orgRole: "org:admin",
      } as any)
      .query(api.functions.clients.queries.list, { search: "bta" });

    expect(result.map((c: any) => c.name)).toEqual(["Beta"]);
  });
});
```

- [ ] **Step 5.2: Tests pasan con código actual**

Run: `npx vitest run convex/functions/clients/__tests__/list.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5.3: Refactor con branching de índices**

En `convex/functions/clients/queries.ts:5-50`, REEMPLAZAR el handler entero por:

```ts
export const list = query({
  args: {
    includeArchived: v.optional(v.boolean()),
    search: v.optional(v.string()),
    industry: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    const identity = await ctx.auth.getUserIdentity();
    const role = (identity?.orgRole as string) ?? "org:member";

    // Pick the most selective index available based on the filter combo.
    let clients: Doc<"clients">[];
    if (args.industry) {
      clients = await ctx.db
        .query("clients")
        .withIndex("by_orgId_industry", (q) =>
          q.eq("orgId", orgId).eq("industry", args.industry!)
        )
        .collect();
    } else if (role === "org:member") {
      clients = await ctx.db
        .query("clients")
        .withIndex("by_orgId_assignedTo", (q) =>
          q.eq("orgId", orgId).eq("assignedTo", identity?.subject)
        )
        .collect();
    } else if (!args.includeArchived) {
      clients = await ctx.db
        .query("clients")
        .withIndex("by_orgId_archived", (q) =>
          q.eq("orgId", orgId).eq("isArchived", false)
        )
        .collect();
    } else {
      clients = await ctx.db
        .query("clients")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect();
    }

    // Apply remaining filters that weren't covered by the chosen index.
    if (!args.includeArchived) {
      clients = clients.filter((c) => !c.isArchived);
    }
    if (role === "org:member") {
      clients = clients.filter((c) => c.assignedTo === identity?.subject);
    }
    if (args.industry) {
      clients = clients.filter((c) => c.industry === args.industry);
    }
    if (args.search) {
      const term = args.search.toLowerCase();
      clients = clients.filter(
        (c) =>
          c.name.toLowerCase().includes(term) ||
          c.rfc.toLowerCase().includes(term)
      );
    }

    return clients.sort((a, b) => b.createdAt - a.createdAt);
  },
});
```

NOTA: Los filtros JS post-index son DEFENSIVOS — el índice ya seleccionó por la condición principal, pero re-aplicar es safe y maneja casos edge (ej. `industry` filter mientras member role: index trae todos los de esa industry, luego JS filtra por assignedTo).

- [ ] **Step 5.4: Tests siguen pasando**

Run: `npx vitest run convex/functions/clients/__tests__/list.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5.5: Suite clients regression check**

Run: `npx vitest run convex/functions/clients/__tests__/`
Expected: todos verdes.

- [ ] **Step 5.6: Commit**

```bash
git add convex/functions/clients/queries.ts convex/functions/clients/__tests__/list.test.ts
git commit -m "$(cat <<'EOF'
perf(clients): list usa índices selectivos según filter combo

Phase 2 §6.1. Branch en handler: by_orgId_industry > by_orgId_assignedTo
(member role) > by_orgId_archived (default) > by_orgId (full). Filtros
adicionales se aplican en JS sobre el subset ya indexado.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Refactor `invoices.listForBilling` para usar `by_orgId_status` cuando aplica

**Files:**
- Modify: `convex/functions/invoices/queries.ts:28-110` (`listForBilling`)

**Contexto:** `listForBilling` hoy hace `by_orgId` + filter year/month/status en JS. Existe `by_orgId_status` que sería direct hit cuando `args.status` viene. Para year/month no hay índice compuesto. Mejora menor pero mide.

Estrategia: si `args.status` set → usar `by_orgId_status`. Sino, mantener `by_orgId` (no peor que ahora).

- [ ] **Step 6.1: Tests existentes**

El archivo `convex/functions/invoices/__tests__/listForBillingFilter.test.ts` ya cubre filtrado por status, year, month, etc. Verificar primero que pasa baseline:

Run: `npx vitest run convex/functions/invoices/__tests__/listForBillingFilter.test.ts`
Expected: PASS (baseline).

- [ ] **Step 6.2: Refactor con branch por status**

En `convex/functions/invoices/queries.ts:listForBilling` handler, REEMPLAZAR las primeras líneas:

```ts
    let rows = await ctx.db
      .query("invoices")
      .withIndex("by_orgId", (qb) => qb.eq("orgId", orgId))
      .collect();
    rows = rows.filter((r) => r.year === args.year);
```

POR:

```ts
    let rows = args.status
      ? await ctx.db
          .query("invoices")
          .withIndex("by_orgId_status", (qb) =>
            qb.eq("orgId", orgId).eq("status", args.status!)
          )
          .collect()
      : await ctx.db
          .query("invoices")
          .withIndex("by_orgId", (qb) => qb.eq("orgId", orgId))
          .collect();
    rows = rows.filter((r) => r.year === args.year);
```

Eliminar el `if (args.status)` filter posterior (~ línea 60), ya está cubierto por el index branch:

```ts
    // ELIMINAR estas 3 líneas (el filter por status ya no es necesario):
    if (args.status) {
      rows = rows.filter((r) => r.status === args.status);
    }
```

- [ ] **Step 6.3: Tests siguen pasando**

Run: `npx vitest run convex/functions/invoices/__tests__/`
Expected: todos verdes.

- [ ] **Step 6.4: Commit**

```bash
git add convex/functions/invoices/queries.ts
git commit -m "$(cat <<'EOF'
perf(invoices): listForBilling usa by_orgId_status cuando args.status set

Phase 2 §6.1. Branch en handler para usar índice direct hit en lugar
de full scan + JS filter cuando status está presente.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Paginar `cron/overdueCheck` por orgId

**Files:**
- Modify: `convex/functions/cron/overdueCheck.ts:8-23` (`listAllPendingAssignments`) + handler `run`

**Contexto:** `listAllPendingAssignments` hace `ctx.db.query("monthlyAssignments").collect()` cross-org + filter status en JS. Con M assignments × N orgs = full scan que no escala. Refactor: nuevo internalQuery `listOrgIds` que lista organizaciones, luego per-org `listPendingAssignmentsByOrg` usando `by_orgId_status`.

Estrategia mínima:
1. Mantener `run` action — solo cambia su lógica interna
2. Nuevo `listOrgIds` que hace `ctx.db.query("organizations").collect()` (es la única forma de saber qué orgs existen — esta tabla es pequeña, scan OK)
3. Nuevo `listPendingAssignmentsByOrg(orgId)` usando `by_orgId_status`
4. `run` itera orgs y llama el query por cada uno

Esto preserva comportamiento (cross-org pending detection) pero usa el índice.

- [ ] **Step 7.1: Tests existentes**

Run: `npx vitest run convex/functions/cron/__tests__/overdueCheck.recipients.test.ts`
Expected: PASS (baseline).

- [ ] **Step 7.2: Test nuevo para pagination**

Crear `convex/functions/cron/__tests__/overdueCheck.pagination.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { internal } from "../../../_generated/api";

describe("overdueCheck pagination", () => {
  it("listOrgIds returns clerkOrgIds from organizations table", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("organizations", {
        clerkOrgId: "org_A", name: "Org A", status: "active",
        plan: "basic", createdAt: Date.now(),
      });
      await ctx.db.insert("organizations", {
        clerkOrgId: "org_B", name: "Org B", status: "active",
        plan: "basic", createdAt: Date.now(),
      });
      await ctx.db.insert("organizations", {
        clerkOrgId: "org_inactive", name: "Org C", status: "inactive",
        plan: "basic", createdAt: Date.now(),
      });
    });

    const ids = await t.query(internal.functions.cron.overdueCheck.listOrgIds, {});
    expect(ids.sort()).toEqual(["org_A", "org_B"]); // inactive excluded
  });

  it("listPendingAssignmentsByOrg uses index and respects org boundary", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      const cA = await ctx.db.insert("clients", {
        orgId: "org_A", name: "CA", rfc: "X", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      const pA = await ctx.db.insert("projections", {
        orgId: "org_A", clientId: cA, year: 2026,
        annualSales: 0, totalBudget: 0, commissionRate: 0,
        seasonalityData: [], status: "active",
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      const sId = await ctx.db.insert("services", {
        name: "S", type: "base", minPct: 0, maxPct: 100,
        defaultPct: 10, isDefault: true, sortOrder: 0,
      });
      const psA = await ctx.db.insert("projectionServices", {
        orgId: "org_A", projectionId: pA, serviceId: sId, serviceName: "S",
        chosenPct: 10, isActive: true, annualAmount: 0, normalizedWeight: 1,
      });
      // org_A: 1 pending, 1 delivered
      await ctx.db.insert("monthlyAssignments", {
        orgId: "org_A", projServiceId: psA, projectionId: pA, clientId: cA,
        serviceName: "S", month: 1, year: 2026, amount: 100, feFactor: 1,
        status: "pending", invoiceStatus: "not_invoiced",
      });
      await ctx.db.insert("monthlyAssignments", {
        orgId: "org_A", projServiceId: psA, projectionId: pA, clientId: cA,
        serviceName: "S", month: 2, year: 2026, amount: 100, feFactor: 1,
        status: "delivered", invoiceStatus: "paid",
      });
      // org_B: 1 pending
      const cB = await ctx.db.insert("clients", {
        orgId: "org_B", name: "CB", rfc: "Y", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      const pB = await ctx.db.insert("projections", {
        orgId: "org_B", clientId: cB, year: 2026,
        annualSales: 0, totalBudget: 0, commissionRate: 0,
        seasonalityData: [], status: "active",
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      const psB = await ctx.db.insert("projectionServices", {
        orgId: "org_B", projectionId: pB, serviceId: sId, serviceName: "S",
        chosenPct: 10, isActive: true, annualAmount: 0, normalizedWeight: 1,
      });
      await ctx.db.insert("monthlyAssignments", {
        orgId: "org_B", projServiceId: psB, projectionId: pB, clientId: cB,
        serviceName: "S", month: 1, year: 2026, amount: 100, feFactor: 1,
        status: "pending", invoiceStatus: "not_invoiced",
      });
    });

    const result = await t.query(
      internal.functions.cron.overdueCheck.listPendingAssignmentsByOrg,
      { orgId: "org_A" }
    );
    expect(result).toHaveLength(1);
    expect(result[0].orgId).toBe("org_A");
  });
});
```

- [ ] **Step 7.3: Test rojo**

Run: `npx vitest run convex/functions/cron/__tests__/overdueCheck.pagination.test.ts`
Expected: FAIL — `listOrgIds` y `listPendingAssignmentsByOrg` no existen.

- [ ] **Step 7.4: Implementar internal queries nuevas**

En `convex/functions/cron/overdueCheck.ts`, AGREGAR (después de `listAllPendingAssignments`):

```ts
/**
 * Internal query: list active org IDs for cron pagination.
 */
export const listOrgIds = internalQuery({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db
      .query("organizations")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    return orgs.map((o) => o.clerkOrgId);
  },
});

/**
 * Internal query: pending assignments for a single org.
 */
export const listPendingAssignmentsByOrg = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("monthlyAssignments")
      .withIndex("by_orgId_status", (q) =>
        q.eq("orgId", args.orgId).eq("status", "pending")
      )
      .collect();
    return rows.map((a) => ({
      orgId: a.orgId,
      serviceName: a.serviceName,
      clientId: a.clientId,
      month: a.month,
      year: a.year,
    }));
  },
});
```

- [ ] **Step 7.5: Reemplazar lógica de `run` para paginar**

En `convex/functions/cron/overdueCheck.ts:run`, REEMPLAZAR el call a `listAllPendingAssignments`:

```ts
    const allPending = await ctx.runQuery(
      internal.functions.cron.overdueCheck.listAllPendingAssignments
    );
```

POR:

```ts
    const orgIds = await ctx.runQuery(
      internal.functions.cron.overdueCheck.listOrgIds
    );
    const allPending: Array<{ orgId: string; serviceName: string; clientId: string; month: number; year: number }> = [];
    for (const orgId of orgIds) {
      const orgPending = await ctx.runQuery(
        internal.functions.cron.overdueCheck.listPendingAssignmentsByOrg,
        { orgId }
      );
      allPending.push(...orgPending);
    }
```

El resto del handler queda igual (filter overdue por past months, group by org, send alerts).

ELIMINAR el `listAllPendingAssignments` viejo (deprecate por completo). Si algún test legacy lo invoca, ajustarlo.

- [ ] **Step 7.6: Tests verdes**

Run: `npx vitest run convex/functions/cron/__tests__/`
Expected: todos verdes (pagination test + recipients test existente).

- [ ] **Step 7.7: Commit**

```bash
git add convex/functions/cron/overdueCheck.ts convex/functions/cron/__tests__/overdueCheck.pagination.test.ts
git commit -m "$(cat <<'EOF'
perf(cron): overdueCheck paginado por orgId

Phase 2 §6.3. listOrgIds + listPendingAssignmentsByOrg con
by_orgId_status. Reemplaza el full scan cross-org de
listAllPendingAssignments.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Paginar `cron/monthlyCheck` por orgId

**Files:**
- Modify: `convex/functions/cron/monthlyCheck.ts` (`listActiveProjections` + `listAssignmentsForMonth`)

**Contexto:** Mismo patrón que Task 7. `listActiveProjections` y `listAssignmentsForMonth` hacen full scan cross-org. Refactor: per-org queries usando `projections.by_orgId_status` y `monthlyAssignments.by_orgId_year_month`.

Estrategia:
1. Reusar el `listOrgIds` ya creado en Task 7 (re-exportarlo o copiarlo localmente — usar el de overdueCheck importándolo via internal API).
2. Nuevo `listActiveProjectionsByOrg(orgId)` usando `by_orgId_status`
3. Nuevo `listAssignmentsForMonthByOrg(orgId, month, year)` usando `by_orgId_year_month`
4. `run` itera orgs.

- [ ] **Step 8.1: Test rojo**

Crear `convex/functions/cron/__tests__/monthlyCheck.pagination.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { internal } from "../../../_generated/api";

describe("monthlyCheck pagination", () => {
  it("listActiveProjectionsByOrg returns only active in that org", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      const cA = await ctx.db.insert("clients", {
        orgId: "org_A", name: "CA", rfc: "X", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      await ctx.db.insert("projections", {
        orgId: "org_A", clientId: cA, year: 2026,
        annualSales: 0, totalBudget: 0, commissionRate: 0,
        seasonalityData: [], status: "active",
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      await ctx.db.insert("projections", {
        orgId: "org_A", clientId: cA, year: 2026,
        annualSales: 0, totalBudget: 0, commissionRate: 0,
        seasonalityData: [], status: "draft",
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      const cB = await ctx.db.insert("clients", {
        orgId: "org_B", name: "CB", rfc: "Y", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      await ctx.db.insert("projections", {
        orgId: "org_B", clientId: cB, year: 2026,
        annualSales: 0, totalBudget: 0, commissionRate: 0,
        seasonalityData: [], status: "active",
        createdAt: Date.now(), updatedAt: Date.now(),
      });
    });

    const result = await t.query(
      internal.functions.cron.monthlyCheck.listActiveProjectionsByOrg,
      { orgId: "org_A" }
    );
    expect(result).toHaveLength(1);
    expect(result[0].orgId).toBe("org_A");
  });

  it("listAssignmentsForMonthByOrg uses by_orgId_year_month", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      const cId = await ctx.db.insert("clients", {
        orgId: "org_A", name: "C", rfc: "X", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      const pId = await ctx.db.insert("projections", {
        orgId: "org_A", clientId: cId, year: 2026,
        annualSales: 0, totalBudget: 0, commissionRate: 0,
        seasonalityData: [], status: "active",
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      const sId = await ctx.db.insert("services", {
        name: "S", type: "base", minPct: 0, maxPct: 100,
        defaultPct: 10, isDefault: true, sortOrder: 0,
      });
      const psId = await ctx.db.insert("projectionServices", {
        orgId: "org_A", projectionId: pId, serviceId: sId, serviceName: "S",
        chosenPct: 10, isActive: true, annualAmount: 0, normalizedWeight: 1,
      });
      // 2 assignments mes 3, 1 mes 4 (no debe contar)
      await ctx.db.insert("monthlyAssignments", {
        orgId: "org_A", projServiceId: psId, projectionId: pId, clientId: cId,
        serviceName: "S", month: 3, year: 2026, amount: 100, feFactor: 1,
        status: "pending", invoiceStatus: "not_invoiced",
      });
      await ctx.db.insert("monthlyAssignments", {
        orgId: "org_A", projServiceId: psId, projectionId: pId, clientId: cId,
        serviceName: "S", month: 3, year: 2026, amount: 100, feFactor: 1,
        status: "delivered", invoiceStatus: "paid",
      });
      await ctx.db.insert("monthlyAssignments", {
        orgId: "org_A", projServiceId: psId, projectionId: pId, clientId: cId,
        serviceName: "S", month: 4, year: 2026, amount: 100, feFactor: 1,
        status: "pending", invoiceStatus: "not_invoiced",
      });
    });

    const result = await t.query(
      internal.functions.cron.monthlyCheck.listAssignmentsForMonthByOrg,
      { orgId: "org_A", month: 3, year: 2026 }
    );
    expect(result).toHaveLength(2);
  });
});
```

- [ ] **Step 8.2: Run, expect FAIL**

Run: `npx vitest run convex/functions/cron/__tests__/monthlyCheck.pagination.test.ts`
Expected: FAIL.

- [ ] **Step 8.3: Implementar queries paginadas**

En `convex/functions/cron/monthlyCheck.ts`, AGREGAR (después de `listAssignmentsForMonth`):

```ts
/**
 * Internal query: active projections for a single org.
 */
export const listActiveProjectionsByOrg = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, args) => {
    const projections = await ctx.db
      .query("projections")
      .withIndex("by_orgId_status", (q) =>
        q.eq("orgId", args.orgId).eq("status", "active")
      )
      .collect();
    return projections.map((p) => ({
      _id: p._id,
      orgId: p.orgId,
      clientId: p.clientId,
      year: p.year,
    }));
  },
});

/**
 * Internal query: assignments for a specific (org, month, year).
 */
export const listAssignmentsForMonthByOrg = internalQuery({
  args: { orgId: v.string(), month: v.number(), year: v.number() },
  handler: async (ctx, args) => {
    const assignments = await ctx.db
      .query("monthlyAssignments")
      .withIndex("by_orgId_year_month", (q) =>
        q.eq("orgId", args.orgId).eq("year", args.year).eq("month", args.month)
      )
      .collect();
    return assignments.map((a) => ({
      orgId: a.orgId,
      projectionId: a.projectionId,
      serviceName: a.serviceName,
      status: a.status,
      clientId: a.clientId,
    }));
  },
});
```

- [ ] **Step 8.4: Modificar `run` para paginar**

En `convex/functions/cron/monthlyCheck.ts:run` handler, REEMPLAZAR las llamadas a `listActiveProjections` y `listAssignmentsForMonth` por iteración per-org. Lee el handler entero primero para mapear las llamadas. Reusar `listOrgIds` de overdueCheck via internal API.

Patrón del refactor:

```ts
// reemplazar:
const projections = await ctx.runQuery(
  internal.functions.cron.monthlyCheck.listActiveProjections
);
const assignments = await ctx.runQuery(
  internal.functions.cron.monthlyCheck.listAssignmentsForMonth,
  { month, year }
);

// por:
const orgIds = await ctx.runQuery(
  internal.functions.cron.overdueCheck.listOrgIds
);
const projections: Array<{ _id: any; orgId: string; clientId: any; year: number }> = [];
const assignments: Array<{ orgId: string; projectionId: any; serviceName: string; status: string; clientId: any }> = [];
for (const orgId of orgIds) {
  const orgProjs = await ctx.runQuery(
    internal.functions.cron.monthlyCheck.listActiveProjectionsByOrg,
    { orgId }
  );
  projections.push(...orgProjs);
  const orgAssigns = await ctx.runQuery(
    internal.functions.cron.monthlyCheck.listAssignmentsForMonthByOrg,
    { orgId, month, year }
  );
  assignments.push(...orgAssigns);
}
```

ELIMINAR los queries `listActiveProjections` y `listAssignmentsForMonth` viejos. Ajustar cualquier test que los invocaba directamente.

- [ ] **Step 8.5: Tests**

Run: `npx vitest run convex/functions/cron/__tests__/monthlyCheck.pagination.test.ts && npx vitest run convex/functions/cron/__tests__/`
Expected: todos verdes.

- [ ] **Step 8.6: Commit**

```bash
git add convex/functions/cron/monthlyCheck.ts convex/functions/cron/__tests__/monthlyCheck.pagination.test.ts
git commit -m "$(cat <<'EOF'
perf(cron): monthlyCheck paginado por orgId

Phase 2 §6.3. listActiveProjectionsByOrg + listAssignmentsForMonthByOrg
con índices by_orgId_status / by_orgId_year_month. Reemplaza full scans
cross-org de listActiveProjections + listAssignmentsForMonth.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Paginar `projections/cron.notifyFiscalCloseEvents` por orgId

**Files:**
- Modify: `convex/functions/projections/cron.ts` (`notifyFiscalCloseEvents`)

**Contexto:** Hoy `notifyFiscalCloseEvents` hace `ctx.db.query("projections").collect()` cross-org y filtra fiscal mode + endMonth match en JS. Refactor: iterar orgs y usar `by_orgId_status` para traer solo `active` projections (las únicas que pueden notificar fiscal close).

- [ ] **Step 9.1: Test de pagination**

Crear `convex/functions/projections/__tests__/cron.fiscalClose.pagination.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { internal } from "../../../_generated/api";

describe("notifyFiscalCloseEvents pagination", () => {
  it("processes only active projections via by_orgId_status", async () => {
    const t = convexTest(schema);
    const now = new Date();
    const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
    const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

    await t.run(async (ctx) => {
      await ctx.db.insert("organizations", {
        clerkOrgId: "org_A", name: "Org A", status: "active",
        plan: "basic", createdAt: Date.now(),
      });
      const cId = await ctx.db.insert("clients", {
        orgId: "org_A", name: "C", rfc: "X", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      // active fiscal projection that just closed → MUST notify
      await ctx.db.insert("projections", {
        orgId: "org_A", clientId: cId, year: prevYear,
        annualSales: 0, totalBudget: 0, commissionRate: 0,
        seasonalityData: [], status: "active",
        startMonth: prevMonth === 12 ? 1 : prevMonth - 10,
        projectionMode: "fiscal",
        monthCount: 12,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      // draft projection (NOT active) → should be skipped
      await ctx.db.insert("projections", {
        orgId: "org_A", clientId: cId, year: prevYear,
        annualSales: 0, totalBudget: 0, commissionRate: 0,
        seasonalityData: [], status: "draft",
        startMonth: 1, projectionMode: "fiscal", monthCount: 12,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
    });

    await t.mutation(internal.functions.projections.cron.notifyFiscalCloseEvents, {});

    const notifications = await t.run((ctx) =>
      ctx.db.query("notifications").collect()
    );
    // exact count depends on resolveProjectionContext fiscal endMonth math,
    // but at minimum: NO notification should reference the draft projection
    const draftIds = await t.run(async (ctx) => {
      const drafts = await ctx.db
        .query("projections")
        .withIndex("by_orgId_status", (q) =>
          q.eq("orgId", "org_A").eq("status", "draft")
        )
        .collect();
      return drafts.map((d) => d._id);
    });
    for (const n of notifications) {
      expect(draftIds).not.toContain(n.relatedProjectionId);
    }
  });
});
```

- [ ] **Step 9.2: Test pasa con código actual (verificación de invariante)**

Run: `npx vitest run convex/functions/projections/__tests__/cron.fiscalClose.pagination.test.ts`
Expected: PASS (el código actual filtra status=active en JS, así que la invariante "draft NO notifica" se respeta — confirmamos baseline).

NOTA: Si NO existe el directorio `convex/functions/projections/__tests__/`, créalo.

- [ ] **Step 9.3: Refactor para usar índice**

En `convex/functions/projections/cron.ts:notifyFiscalCloseEvents` handler, REEMPLAZAR:

```ts
    // Scan all projections across all orgs (system-level cron, no auth context).
    const projections = await ctx.db.query("projections").collect();
```

POR:

```ts
    // Iterate active orgs and only fetch active projections per org via index.
    const orgs = await ctx.db
      .query("organizations")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    const projections: any[] = [];
    for (const org of orgs) {
      const orgProjections = await ctx.db
        .query("projections")
        .withIndex("by_orgId_status", (q) =>
          q.eq("orgId", org.clerkOrgId).eq("status", "active")
        )
        .collect();
      projections.push(...orgProjections);
    }
```

ELIMINAR el `if (p.status !== "active") continue;` (si existe) y el `if (pctx.projectionMode !== "fiscal" || ...)` SI el check de status pasaba ahí. Léelo primero y ajusta. El check de `projectionMode === "fiscal"` y `endMonth === prevMonth` se mantiene — solo el filter de status pasa al índice.

- [ ] **Step 9.4: Tests siguen pasando**

Run: `npx vitest run convex/functions/projections/__tests__/cron.fiscalClose.pagination.test.ts`
Expected: PASS.

- [ ] **Step 9.5: Suite projections regression**

Run: `npx vitest run convex/functions/projections/__tests__/`
Expected: todos verdes.

- [ ] **Step 9.6: Commit**

```bash
git add convex/functions/projections/cron.ts convex/functions/projections/__tests__/cron.fiscalClose.pagination.test.ts
git commit -m "$(cat <<'EOF'
perf(projections): notifyFiscalCloseEvents paginado por orgId

Phase 2 §6.3. Itera orgs activas y usa by_orgId_status para traer solo
projections active por org. Reemplaza el full scan cross-org.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Verificación final

**Files:** ninguno

- [ ] **Step 10.1: Suite completa**

Run: `npm test 2>&1 | tail -5`
Expected: `Tests XXXX passed | 1 skipped` (baseline 1124 + ~15 nuevos tests de Phase 2 = ~1139).

- [ ] **Step 10.2: TypeScript clean**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: 0 errores.

- [ ] **Step 10.3: Convex codegen**

Run: `npx convex codegen 2>&1 | tail -3`
Expected: clean.

- [ ] **Step 10.4: GitNexus reindex**

Run: `npx gitnexus analyze --embeddings 2>&1 | tail -3` (background OK)
Expected: completa.

- [ ] **Step 10.5: Smoke check del diff**

Run: `git log --oneline ba5ab9d..HEAD`
Expected: 9 commits Phase 2 (1 schema + 5 query refactors + 3 cron paginations).

Run: `git diff ba5ab9d..HEAD --stat`
Expected: ~10 archivos modificados, mayormente queries + crons + schema.

- [ ] **Step 10.6: Reportar al user**

Resumen de 1-2 frases: cuántos commits, tests pasando (baseline + nuevos), tsc clean, los 3 áreas cubiertas (índices, dashboard queries, crons paginados). NO push (per `feedback_no_push_default`).

---

## Notas finales

- Cada task es un commit independiente — rollback selectivo posible vía `git revert <hash>`.
- NO push (memoria `feedback_no_push_default`).
- Los tests de equivalencia bloquean regresión funcional, pero NO miden performance directamente. Confiamos en que `withIndex` es estructuralmente más rápido que `.collect()+.filter()`.
- Si algún test legacy se rompe por la pagination de crons (ej. invocaba directamente `listAllPendingAssignments` o `listActiveProjections`), reportar BLOCKED — discutir si actualizar el test o mantener la query vieja como wrapper.
- Phase 3 (state machine guards), Phase 4 (schema cleanup), Phase 5 (polish) quedan separadas — no expandir scope dentro de Phase 2.
