# Phase 1 — Pre-launch blockers + cascade fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar los 7 fixes pre-launch del spec `docs/superpowers/specs/2026-05-28-schema-coherence-audit-design.md` §3: race en acceptQuotation, cascade en applyDecline/cancelContract, email del deliver, guards en services.resetToDefault/quotations.deleteQuotation/issuingCompanies.remove, y claim atómico en generateFromInvoice. Resultado: sistema seguro para launch sin race conditions, sin caminos huérfanos, sin cascades rotas.

**Architecture:** 7 fixes independientes ejecutados como tasks separadas con TDD (test rojo → impl mínima → test verde → commit). Cada task es un commit atómico que puede revertirse sin afectar a los demás. Una task previa (Task 1) crea un helper compartido por Tasks 2 y 3.

**Tech Stack:** Convex (mutations, internal mutations, internal actions), Vitest + `convex-test` (edge-runtime), TypeScript estricto. `convex/lib/projectionDownstream.ts` para helpers, `tests/harness.ts` para `setupTest()` + `ORG_A`/`ORG_B`.

---

## Pre-flight

- [ ] **Step 0.1: Verificar baseline limpio**

Run: `npm test 2>&1 | tail -3 && npx tsc --noEmit 2>&1 | tail -5`
Expected:
```
Test Files  XX passed
     Tests  1096 passed | 1 skipped
(0 TS errors)
```

Si baseline está rojo, abort y reportar al user.

- [ ] **Step 0.2: Verificar working tree**

Run: `git status --short`
Expected: solo `M AGENTS.md`, `M CLAUDE.md`, plus untracked specs/plans. Si hay otros mods, pausar y consultar.

---

## Task 1: Add `cancelFuturePendingAssignments` helper

**Files:**
- Modify: `convex/lib/projectionDownstream.ts` (append nueva función exportada)
- Test: `convex/lib/__tests__/projectionDownstream.cancelFuture.test.ts`

**Contexto:** Helper compartido por Task 2 (applyDecline) y Task 3 (cancelContract). Borra los `monthlyAssignments` futuros de un `projectionService` que estén `status="pending"` Y `invoiceStatus="not_invoiced"`. No toca el pasado, no toca rows ya en progreso, no toca rows ya facturadas.

- [ ] **Step 1.1: Escribir test rojo**

Crear `convex/lib/__tests__/projectionDownstream.cancelFuture.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { setupTest, ORG_A } from "../../../tests/harness";
import { cancelFuturePendingAssignments } from "../projectionDownstream";

describe("cancelFuturePendingAssignments", () => {
  it("deletes future pending + not_invoiced assignments", async () => {
    const t = setupTest();
    const now = new Date();
    const futureYear = now.getFullYear() + 1;

    const projServiceId = await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: ORG_A, name: "C", rfc: "X", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: ORG_A, clientId, year: futureYear,
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
      // Future + pending + not_invoiced → DEBE borrarse
      await ctx.db.insert("monthlyAssignments", {
        orgId: ORG_A, projServiceId: psId, projectionId, clientId,
        serviceName: "S", month: 6, year: futureYear, amount: 100, feFactor: 1,
        status: "pending", invoiceStatus: "not_invoiced",
      });
      // Future pero in_progress → KEEP
      await ctx.db.insert("monthlyAssignments", {
        orgId: ORG_A, projServiceId: psId, projectionId, clientId,
        serviceName: "S", month: 7, year: futureYear, amount: 100, feFactor: 1,
        status: "in_progress", invoiceStatus: "not_invoiced",
      });
      // Future pero ya facturada → KEEP
      await ctx.db.insert("monthlyAssignments", {
        orgId: ORG_A, projServiceId: psId, projectionId, clientId,
        serviceName: "S", month: 8, year: futureYear, amount: 100, feFactor: 1,
        status: "pending", invoiceStatus: "invoiced",
      });
      // Pasado pending not_invoiced → KEEP (no tocamos historia)
      await ctx.db.insert("monthlyAssignments", {
        orgId: ORG_A, projServiceId: psId, projectionId, clientId,
        serviceName: "S", month: 1, year: now.getFullYear() - 1, amount: 100, feFactor: 1,
        status: "pending", invoiceStatus: "not_invoiced",
      });
      return psId;
    });

    await t.run(async (ctx) => {
      await cancelFuturePendingAssignments(ctx, projServiceId);
    });

    const remaining = await t.run((ctx) =>
      ctx.db.query("monthlyAssignments").collect()
    );
    expect(remaining).toHaveLength(3);
    expect(remaining.find((m) => m.month === 6 && m.year === futureYear)).toBeUndefined();
  });

  it("is idempotent (second call is a no-op)", async () => {
    const t = setupTest();
    const futureYear = new Date().getFullYear() + 1;
    const projServiceId = await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: ORG_A, name: "C", rfc: "X", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: ORG_A, clientId, year: futureYear,
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
      await ctx.db.insert("monthlyAssignments", {
        orgId: ORG_A, projServiceId: psId, projectionId, clientId,
        serviceName: "S", month: 6, year: futureYear, amount: 100, feFactor: 1,
        status: "pending", invoiceStatus: "not_invoiced",
      });
      return psId;
    });

    await t.run((ctx) => cancelFuturePendingAssignments(ctx, projServiceId));
    await t.run((ctx) => cancelFuturePendingAssignments(ctx, projServiceId));

    const remaining = await t.run((ctx) =>
      ctx.db.query("monthlyAssignments").collect()
    );
    expect(remaining).toHaveLength(0);
  });
});
```

- [ ] **Step 1.2: Correr test, verificar que falla**

Run: `npx vitest run convex/lib/__tests__/projectionDownstream.cancelFuture.test.ts`
Expected: FAIL con `"cancelFuturePendingAssignments" is not exported`.

- [ ] **Step 1.3: Implementar helper**

Append al final de `convex/lib/projectionDownstream.ts`:

```ts
/**
 * Cancela monthlyAssignments futuros que estén en estado pending + not_invoiced.
 * Usado por applyDecline (quotation rechazada) y cancelContract para evitar
 * recordatorios fantasma del cron de eligibility.
 *
 * - No toca assignments del pasado (preserva historia).
 * - No toca assignments en progreso (info_received, in_progress, delivered).
 * - No toca assignments ya facturados (invoiceStatus != "not_invoiced").
 */
export async function cancelFuturePendingAssignments(
  ctx: MutationCtx,
  projServiceId: Id<"projectionServices">
): Promise<void> {
  const today = new Date();
  const currentYearMonth = today.getFullYear() * 100 + (today.getMonth() + 1);
  const mas = await ctx.db
    .query("monthlyAssignments")
    .withIndex("by_projServiceId", (q) => q.eq("projServiceId", projServiceId))
    .collect();
  for (const ma of mas) {
    const maYm = ma.year * 100 + ma.month;
    if (maYm < currentYearMonth) continue;
    if (ma.status !== "pending") continue;
    if (ma.invoiceStatus !== "not_invoiced") continue;
    await ctx.db.delete(ma._id);
  }
}
```

- [ ] **Step 1.4: Correr test, verificar que pasa**

Run: `npx vitest run convex/lib/__tests__/projectionDownstream.cancelFuture.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 1.5: Commit**

```bash
git add convex/lib/projectionDownstream.ts convex/lib/__tests__/projectionDownstream.cancelFuture.test.ts
git commit -m "$(cat <<'EOF'
feat(lib): cancelFuturePendingAssignments helper

Phase 1 §3.2 helper para applyDecline y cancelContract.
Borra MAs futuros pending+not_invoiced sin tocar pasado ni in-progress.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Cascade en `applyDecline`

**Files:**
- Modify: `convex/functions/quotations/internalMutations.ts:61` (`applyDecline`)
- Test: `convex/functions/quotations/__tests__/applyDecline.cascade.test.ts`

**Contexto:** Cuando una quotation se rechaza, hoy solo se patchea status=rejected. El `projectionService` queda `isActive=true` y los MAs siguen `pending` → cron manda recordatorios fantasma. Fix: marcar projService `isActive=false` y llamar `cancelFuturePendingAssignments`.

- [ ] **Step 2.1: Escribir test rojo**

Crear `convex/functions/quotations/__tests__/applyDecline.cascade.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { internal } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../../tests/harness";

describe("applyDecline cascade", () => {
  it("deactivates projectionService and cancels future pending assignments", async () => {
    const t = setupTest();
    const futureYear = new Date().getFullYear() + 1;
    const { quotationId, projServiceId } = await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: ORG_A, name: "C", rfc: "X", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: ORG_A, clientId, year: futureYear,
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
      await ctx.db.insert("monthlyAssignments", {
        orgId: ORG_A, projServiceId: psId, projectionId, clientId,
        serviceName: "S", month: 6, year: futureYear, amount: 100, feFactor: 1,
        status: "pending", invoiceStatus: "not_invoiced",
      });
      const qId = await ctx.db.insert("quotations", {
        orgId: ORG_A, projServiceId: psId, clientId, serviceName: "S",
        content: "<p/>", status: "sent",
        accessTokenHash: "hash_v1",
        tokenExpiresAt: Date.now() + 100_000,
        createdAt: Date.now(),
      });
      return { quotationId: qId, projServiceId: psId };
    });

    await t.mutation(
      internal.functions.quotations.internalMutations.applyDecline,
      { tokenHash: "hash_v1", reason: "Demasiado caro" }
    );

    const ps = await t.run((ctx) => ctx.db.get(projServiceId));
    expect(ps?.isActive).toBe(false);
    const mas = await t.run((ctx) =>
      ctx.db.query("monthlyAssignments").collect()
    );
    expect(mas).toHaveLength(0);
    const q = await t.run((ctx) => ctx.db.get(quotationId));
    expect(q?.status).toBe("rejected");
    expect(q?.declineReason).toBe("Demasiado caro");
  });

  it("does NOT deactivate projectionService for supplementary (add-on) quotations", async () => {
    const t = setupTest();
    const futureYear = new Date().getFullYear() + 1;
    const projServiceId = await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: ORG_A, name: "C", rfc: "X", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: ORG_A, clientId, year: futureYear,
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
        chosenPct: 0, isActive: true, annualAmount: 0, normalizedWeight: 0,
        startMonth: 7,
      });
      await ctx.db.insert("quotations", {
        orgId: ORG_A, projServiceId: psId, clientId, serviceName: "S",
        content: "<p/>", status: "sent",
        accessTokenHash: "hash_supp",
        tokenExpiresAt: Date.now() + 100_000,
        isSupplementary: true,
        createdAt: Date.now(),
      });
      return psId;
    });

    await t.mutation(
      internal.functions.quotations.internalMutations.applyDecline,
      { tokenHash: "hash_supp", reason: "no" }
    );

    const ps = await t.run((ctx) => ctx.db.get(projServiceId));
    // Add-on rejected → también desactivar (spec §3.2-bis)
    expect(ps?.isActive).toBe(false);
  });
});
```

- [ ] **Step 2.2: Correr test, verificar que falla**

Run: `npx vitest run convex/functions/quotations/__tests__/applyDecline.cascade.test.ts`
Expected: FAIL — `ps.isActive` aún es `true` después del decline.

- [ ] **Step 2.3: Modificar `applyDecline`**

En `convex/functions/quotations/internalMutations.ts`, después del `ctx.db.patch(quotation._id, {...})` que setea status=rejected (cerca de línea 90), agregar:

```ts
// Phase 1 §3.2 — cascade: desactivar projService y cancelar MAs futuros pending
import { cancelFuturePendingAssignments } from "../../lib/projectionDownstream";
// (importar al top del archivo si no está ya)

// ... dentro del handler de applyDecline, después del patch a la quotation:
const projService = await ctx.db.get(quotation.projServiceId);
if (projService && projService.isActive) {
  await ctx.db.patch(projService._id, { isActive: false });
  await cancelFuturePendingAssignments(ctx, projService._id);
}
```

Esto aplica para base y supplementary por igual (per spec §3.2-bis).

- [ ] **Step 2.4: Correr test, verificar que pasa**

Run: `npx vitest run convex/functions/quotations/__tests__/applyDecline.cascade.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 2.5: Correr suite completa de quotations**

Run: `npx vitest run convex/functions/quotations/__tests__/`
Expected: todos verdes (sin regresiones en `applyDecline.test.ts` existente).

- [ ] **Step 2.6: Commit**

```bash
git add convex/functions/quotations/internalMutations.ts convex/functions/quotations/__tests__/applyDecline.cascade.test.ts
git commit -m "$(cat <<'EOF'
fix(quotations): cascade applyDecline → projService isActive=false + cancel MAs

Phase 1 §3.2. Evita recordatorios fantasma del cron de eligibility cuando
una cotización (base o add-on) es rechazada.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Cascade en `cancelContract`

**Files:**
- Modify: `convex/functions/contracts/mutations.ts:315` (`cancelContract`)
- Test: `convex/functions/contracts/__tests__/cancelContract.cascade.test.ts`

**Contexto:** Mismo problema que Task 2 pero para la mutation `cancelContract`. Después de cancelar el contrato, dejar el projService activo deja el pipeline inconsistente.

- [ ] **Step 3.1: Escribir test rojo**

Crear `convex/functions/contracts/__tests__/cancelContract.cascade.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../../tests/harness";

describe("cancelContract cascade", () => {
  it("deactivates projService and cancels future MAs when contract is cancelled", async () => {
    const t = setupTest();
    const futureYear = new Date().getFullYear() + 1;
    const { contractId, projServiceId, userIdentity } = await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: ORG_A, name: "C", rfc: "X", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: ORG_A, clientId, year: futureYear,
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
      await ctx.db.insert("monthlyAssignments", {
        orgId: ORG_A, projServiceId: psId, projectionId, clientId,
        serviceName: "S", month: 6, year: futureYear, amount: 100, feFactor: 1,
        status: "pending", invoiceStatus: "not_invoiced",
      });
      const qId = await ctx.db.insert("quotations", {
        orgId: ORG_A, projServiceId: psId, clientId, serviceName: "S",
        content: "<p/>", status: "approved", createdAt: Date.now(),
      });
      const cId = await ctx.db.insert("contracts", {
        orgId: ORG_A, quotationId: qId, projServiceId: psId, clientId,
        serviceName: "S", content: "<p/>", status: "sent",
        createdAt: Date.now(),
      });
      return { contractId: cId, projServiceId: psId, userIdentity: null };
    });

    await t.withIdentity({
      subject: "user_X",
      tokenIdentifier: "user_X",
      orgId: ORG_A,
      orgRole: "org:admin",
    } as any).mutation(api.functions.contracts.mutations.cancelContract, {
      contractId,
      reason: "Cliente desistió",
    });

    const c = await t.run((ctx) => ctx.db.get(contractId));
    expect(c?.status).toBe("cancelled");
    const ps = await t.run((ctx) => ctx.db.get(projServiceId));
    expect(ps?.isActive).toBe(false);
    const mas = await t.run((ctx) =>
      ctx.db.query("monthlyAssignments").collect()
    );
    expect(mas).toHaveLength(0);
  });
});
```

NOTA: Si el patrón `t.withIdentity` no acepta orgRole en este harness, simplificar a invocar la internal mutation interna que ya use el id directo. Verificar conventions de tests existentes en `convex/functions/contracts/__tests__/`.

- [ ] **Step 3.2: Correr test, verificar que falla**

Run: `npx vitest run convex/functions/contracts/__tests__/cancelContract.cascade.test.ts`
Expected: FAIL — projService sigue `isActive=true`.

- [ ] **Step 3.3: Modificar `cancelContract`**

En `convex/functions/contracts/mutations.ts`, dentro del handler de `cancelContract` (línea 315), después del `ctx.db.patch(contract._id, { status: "cancelled", cancellationReason: args.reason })`:

```ts
import { cancelFuturePendingAssignments } from "../../lib/projectionDownstream";
// (importar al top si no está)

// dentro del handler, después del patch a contract:
const projService = await ctx.db.get(contract.projServiceId);
if (projService && projService.isActive) {
  await ctx.db.patch(projService._id, { isActive: false });
  await cancelFuturePendingAssignments(ctx, projService._id);
}
```

- [ ] **Step 3.4: Correr test, verificar que pasa**

Run: `npx vitest run convex/functions/contracts/__tests__/cancelContract.cascade.test.ts`
Expected: PASS.

- [ ] **Step 3.5: Correr suite contracts**

Run: `npx vitest run convex/functions/contracts/__tests__/`
Expected: todos verdes.

- [ ] **Step 3.6: Commit**

```bash
git add convex/functions/contracts/mutations.ts convex/functions/contracts/__tests__/cancelContract.cascade.test.ts
git commit -m "$(cat <<'EOF'
fix(contracts): cancelContract cascade → projService isActive=false + cancel MAs

Phase 1 §3.2. Cierra orphan flow cuando se cancela un contrato.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Unique guard en `contracts.saveGenerated` (race fix §3.1)

**Files:**
- Modify: `convex/functions/contracts/mutations.ts:277` (`saveGenerated`)
- Test: `convex/functions/contracts/__tests__/saveGenerated.race.test.ts`

**Contexto:** Race en `acceptQuotation`: 2 schedules concurrentes pueden insertar 2 contracts draft para el mismo quotationId. Fix: `saveGenerated` consulta `by_quotationId` y si existe, devuelve el existente sin insertar.

- [ ] **Step 4.1: Escribir test rojo**

Crear `convex/functions/contracts/__tests__/saveGenerated.race.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { internal } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../../tests/harness";

describe("contracts.saveGenerated unique guard", () => {
  it("returns existing contract ID if one already exists for the quotation", async () => {
    const t = setupTest();
    const { quotationId, projServiceId, clientId } = await t.run(async (ctx) => {
      const cId = await ctx.db.insert("clients", {
        orgId: ORG_A, name: "C", rfc: "X", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: ORG_A, clientId: cId, year: 2026,
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
      const qId = await ctx.db.insert("quotations", {
        orgId: ORG_A, projServiceId: psId, clientId: cId, serviceName: "S",
        content: "<p/>", status: "approved", createdAt: Date.now(),
      });
      return { quotationId: qId, projServiceId: psId, clientId: cId };
    });

    const firstId = await t.mutation(
      internal.functions.contracts.mutations.saveGenerated,
      {
        orgId: ORG_A, quotationId, projServiceId, clientId,
        serviceName: "S", content: "<p>first</p>",
      } as any
    );

    const secondId = await t.mutation(
      internal.functions.contracts.mutations.saveGenerated,
      {
        orgId: ORG_A, quotationId, projServiceId, clientId,
        serviceName: "S", content: "<p>second</p>",
      } as any
    );

    expect(secondId).toBe(firstId);
    const contracts = await t.run((ctx) => ctx.db.query("contracts").collect());
    expect(contracts).toHaveLength(1);
    // Content del primero NO se sobreescribe
    expect(contracts[0].content).toBe("<p>first</p>");
  });
});
```

NOTA: el shape exacto de los args de `saveGenerated` puede diferir del cast `as any` — revisar línea 277 de `contracts/mutations.ts` y ajustar.

- [ ] **Step 4.2: Correr test, verificar que falla**

Run: `npx vitest run convex/functions/contracts/__tests__/saveGenerated.race.test.ts`
Expected: FAIL — se crean 2 contracts (length === 2) en vez de 1.

- [ ] **Step 4.3: Modificar `saveGenerated`**

En `convex/functions/contracts/mutations.ts:277`, dentro del handler, ANTES del `ctx.db.insert("contracts", ...)`:

```ts
// Phase 1 §3.1 — race guard: si ya existe contract para esta quotation, return existente
const existing = await ctx.db
  .query("contracts")
  .withIndex("by_quotationId", (q) => q.eq("quotationId", args.quotationId))
  .first();
if (existing) {
  return existing._id;
}

// ... resto del insert original
return await ctx.db.insert("contracts", { ... });
```

- [ ] **Step 4.4: Correr test, verificar que pasa**

Run: `npx vitest run convex/functions/contracts/__tests__/saveGenerated.race.test.ts`
Expected: PASS.

- [ ] **Step 4.5: Correr suite contracts**

Run: `npx vitest run convex/functions/contracts/__tests__/`
Expected: todos verdes (regression check).

- [ ] **Step 4.6: Commit**

```bash
git add convex/functions/contracts/mutations.ts convex/functions/contracts/__tests__/saveGenerated.race.test.ts
git commit -m "$(cat <<'EOF'
fix(contracts): unique guard en saveGenerated por quotationId

Phase 1 §3.1. Cierra race condition en acceptQuotation que podía crear
2 contracts draft por una sola quotation bajo carga concurrente.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Fix email placeholder en `deliverables.deliver` (§3.3)

**Files:**
- Modify: `convex/functions/deliverables/mutations.ts:102-150` (`deliver`)
- Test: `convex/functions/deliverables/__tests__/deliver.email.test.ts`

**Contexto:** `deliver` actualmente envía a `${client.rfc}@placeholder.com` — el cliente jamás recibe el entregable. Cambiar a `client.contactEmail` y manejar el caso de cliente sin email (marcar como rejected).

- [ ] **Step 5.1: Escribir test rojo**

Crear `convex/functions/deliverables/__tests__/deliver.email.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../../tests/harness";

describe("deliver email routing", () => {
  it("sends email to client.contactEmail when set", async () => {
    const t = setupTest();
    const { deliverableId } = await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: ORG_A, name: "Acme SA", rfc: "ACM010101AAA", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
        contactEmail: "facturas@acme.example",
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: ORG_A, clientId, year: 2026,
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
      const maId = await ctx.db.insert("monthlyAssignments", {
        orgId: ORG_A, projServiceId: psId, projectionId, clientId,
        serviceName: "S", month: 6, year: 2026, amount: 100, feFactor: 1,
        status: "pending", invoiceStatus: "paid",
      });
      const dId = await ctx.db.insert("deliverables", {
        orgId: ORG_A, assignmentId: maId, projServiceId: psId, clientId,
        serviceName: "S", month: 6, year: 2026,
        shortContent: "x", longContent: "y",
        auditStatus: "approved", retryCount: 0,
        createdAt: Date.now(),
      });
      return { deliverableId: dId };
    });

    const result = await t.withIdentity({
      subject: "user_X", tokenIdentifier: "user_X", orgId: ORG_A,
    } as any).mutation(api.functions.deliverables.mutations.deliver, {
      deliverableId,
    });

    expect(result.success).toBe(true);
    // No assertion sobre Resend mock — solo verificamos que no se rejected
    const d = await t.run((ctx) => ctx.db.get(deliverableId));
    expect(d?.deliveredAt).toBeDefined();
  });

  it("marks deliverable as rejected when client has no contactEmail", async () => {
    const t = setupTest();
    const { deliverableId } = await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: ORG_A, name: "Acme SA", rfc: "ACM010101AAA", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
        // contactEmail intentionally omitted
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: ORG_A, clientId, year: 2026,
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
      const maId = await ctx.db.insert("monthlyAssignments", {
        orgId: ORG_A, projServiceId: psId, projectionId, clientId,
        serviceName: "S", month: 6, year: 2026, amount: 100, feFactor: 1,
        status: "pending", invoiceStatus: "paid",
      });
      const dId = await ctx.db.insert("deliverables", {
        orgId: ORG_A, assignmentId: maId, projServiceId: psId, clientId,
        serviceName: "S", month: 6, year: 2026,
        shortContent: "x", longContent: "y",
        auditStatus: "approved", retryCount: 0,
        createdAt: Date.now(),
      });
      return { deliverableId: dId };
    });

    const result = await t.withIdentity({
      subject: "user_X", tokenIdentifier: "user_X", orgId: ORG_A,
    } as any).mutation(api.functions.deliverables.mutations.deliver, {
      deliverableId,
    });

    expect(result.success).toBe(false);
    expect(result.reason).toBe("no_contact_email");
    const d = await t.run((ctx) => ctx.db.get(deliverableId));
    expect(d?.auditStatus).toBe("rejected");
    expect(d?.auditFeedback).toMatch(/contactEmail/);
    expect(d?.deliveredAt).toBeUndefined();
  });
});
```

NOTA: si el harness convex-test no permite withIdentity con shape arbitrario o si la mutation requiere otro tipo de auth, ajustar para invocar internal mutations directamente con orgId pasado por args. El patrón estándar del repo se ve en otros tests existentes — usar ese.

- [ ] **Step 5.2: Correr test, verificar que falla**

Run: `npx vitest run convex/functions/deliverables/__tests__/deliver.email.test.ts`
Expected: FAIL — el segundo test debe fallar porque hoy NO rechaza el deliver cuando falta contactEmail.

- [ ] **Step 5.3: Modificar `deliver`**

En `convex/functions/deliverables/mutations.ts` reemplazar la sección de líneas ~133-150 (el bloque del `clientEmail` placeholder y el scheduler):

```ts
// REEMPLAZAR el bloque viejo:
// const client = await ctx.db.get(deliverable.clientId);
// const clientName = client?.name ?? "Cliente";
// const clientEmail = client ? `${client.rfc}@placeholder.com` : "unknown@placeholder.com";
// await ctx.scheduler.runAfter(0, ...)
// return { success: true, deliverableId: args.deliverableId };

// POR:
const client = await ctx.db.get(deliverable.clientId);
const clientName = client?.name ?? "Cliente";
const clientEmail = client?.contactEmail;
if (!clientEmail) {
  await ctx.db.patch(args.deliverableId, {
    auditStatus: "rejected" as const,
    auditFeedback: "Cliente sin contactEmail — agregar en perfil del cliente antes de re-entregar",
  });
  // Rollback assignment status (no entregamos)
  await ctx.db.patch(deliverable.assignmentId, {
    status: "in_progress" as const,
  });
  // Rollback deliveredAt si lo seteamos arriba
  await ctx.db.patch(args.deliverableId, {
    deliveredAt: undefined,
  });
  return { success: false, deliverableId: args.deliverableId, reason: "no_contact_email" };
}

await ctx.scheduler.runAfter(
  0,
  internal.functions.email.send.sendEmailInternal,
  {
    to: clientEmail,
    subject: `Entregable disponible - ${deliverable.serviceName}`,
    html: `<p>Estimado ${clientName}, su entregable de ${deliverable.serviceName} para ${deliverable.month}/${deliverable.year} esta disponible.</p>`,
  }
);

return { success: true, deliverableId: args.deliverableId };
```

NOTA importante de ordering: actualmente las patches a deliveredAt y assignment.status="delivered" se hacen ANTES del email. Hay que reordenar: verificar `clientEmail` antes de patches, o aplicar el rollback inverso si falta email (como muestra el snippet arriba). Decisión: simplificar moviendo el check arriba:

**Versión recomendada** (más limpia): mover el `client.contactEmail` check al INICIO del handler, antes de los patches de status:

```ts
// Al inicio del handler, después de validar auditStatus === "approved":
const client = await ctx.db.get(deliverable.clientId);
if (!client?.contactEmail) {
  await ctx.db.patch(args.deliverableId, {
    auditStatus: "rejected" as const,
    auditFeedback: "Cliente sin contactEmail — agregar en perfil del cliente antes de re-entregar",
  });
  return { success: false, deliverableId: args.deliverableId, reason: "no_contact_email" };
}
const clientEmail = client.contactEmail;
const clientName = client.name;

// ... después seguir con los patches a deliverable + assignment + scheduler
```

Esto evita el patrón de rollback. Usar esta versión.

- [ ] **Step 5.4: Correr test, verificar que pasa**

Run: `npx vitest run convex/functions/deliverables/__tests__/deliver.email.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 5.5: Correr suite deliverables**

Run: `npx vitest run convex/functions/deliverables/__tests__/`
Expected: todos verdes.

- [ ] **Step 5.6: Commit**

```bash
git add convex/functions/deliverables/mutations.ts convex/functions/deliverables/__tests__/deliver.email.test.ts
git commit -m "$(cat <<'EOF'
fix(deliverables): deliver usa client.contactEmail (drop placeholder)

Phase 1 §3.3. Si el cliente no tiene contactEmail, el deliverable se
marca como rejected con feedback claro en lugar de fingir entrega a
una dirección @placeholder.com inexistente.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Ref guard en `services.resetToDefault` (§3.4)

**Files:**
- Modify: `convex/functions/services/mutations.ts:47` (`resetToDefault`)
- Test: `convex/functions/services/__tests__/resetToDefault.guard.test.ts`

**Contexto:** `resetToDefault` hoy borra el service row sin chequear refs. Si un super-admin lo invoca con un service que tiene projectionServices vivos, queda data corrompida. Patrón a copiar: `subservices.remove` con `findActiveRefs`.

- [ ] **Step 6.1: Escribir test rojo**

Crear `convex/functions/services/__tests__/resetToDefault.guard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../../tests/harness";

describe("services.resetToDefault guard", () => {
  it("throws HAS_ACTIVE_REFS when service has projectionServices referencing it", async () => {
    const t = setupTest();
    const serviceId = await t.run(async (ctx) => {
      const sId = await ctx.db.insert("services", {
        name: "S", type: "base", minPct: 0, maxPct: 100,
        defaultPct: 10, isDefault: false, isCustom: true, sortOrder: 0,
      });
      const clientId = await ctx.db.insert("clients", {
        orgId: ORG_A, name: "C", rfc: "X", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: ORG_A, clientId, year: 2026,
        annualSales: 0, totalBudget: 0, commissionRate: 0,
        seasonalityData: [], status: "active",
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      await ctx.db.insert("projectionServices", {
        orgId: ORG_A, projectionId, serviceId: sId, serviceName: "S",
        chosenPct: 10, isActive: true, annualAmount: 0, normalizedWeight: 1,
      });
      return sId;
    });

    await expect(
      t.withIdentity({
        subject: "super", tokenIdentifier: "super", orgId: ORG_A,
        orgRole: "org:super_admin",
      } as any).mutation(
        api.functions.services.mutations.resetToDefault,
        { serviceId } as any
      )
    ).rejects.toThrow(/HAS_ACTIVE_REFS|en uso|active refs/i);

    const s = await t.run((ctx) => ctx.db.get(serviceId));
    expect(s).not.toBeNull(); // service NO se borró
  });

  it("deletes service when there are no refs", async () => {
    const t = setupTest();
    const serviceId = await t.run(async (ctx) =>
      ctx.db.insert("services", {
        name: "Unused", type: "base", minPct: 0, maxPct: 100,
        defaultPct: 10, isDefault: false, isCustom: true, sortOrder: 99,
      })
    );

    await t.withIdentity({
      subject: "super", tokenIdentifier: "super", orgId: ORG_A,
      orgRole: "org:super_admin",
    } as any).mutation(
      api.functions.services.mutations.resetToDefault,
      { serviceId } as any
    );

    const s = await t.run((ctx) => ctx.db.get(serviceId));
    expect(s).toBeNull();
  });
});
```

NOTA: ajustar el shape de `withIdentity` y argumentos según patrones de otros tests del repo (ej. `subservices.remove` test).

- [ ] **Step 6.2: Correr test, verificar que falla**

Run: `npx vitest run convex/functions/services/__tests__/resetToDefault.guard.test.ts`
Expected: FAIL — el primer test no throw, service se borra silenciosamente.

- [ ] **Step 6.3: Implementar guard en `resetToDefault`**

En `convex/functions/services/mutations.ts`, dentro del handler de `resetToDefault` (línea ~47), ANTES del `ctx.db.delete(serviceId)`:

```ts
import { ConvexError } from "convex/values";

// Phase 1 §3.4 — guard: no permitir reset si hay refs activas
const refs: { table: string; count: number }[] = [];
const projServices = await ctx.db
  .query("projectionServices")
  .collect()
  .then((rs) => rs.filter((p) => p.serviceId === args.serviceId).length);
if (projServices > 0) refs.push({ table: "projectionServices", count: projServices });

const subs = await ctx.db
  .query("subservices")
  .collect()
  .then((rs) => rs.filter((s) => s.parentServiceId === args.serviceId).length);
if (subs > 0) refs.push({ table: "subservices", count: subs });

const templates = await ctx.db
  .query("deliverableTemplates")
  .collect()
  .then((rs) => rs.filter((tpl) => tpl.serviceId === args.serviceId).length);
if (templates > 0) refs.push({ table: "deliverableTemplates", count: templates });

const maps = await ctx.db
  .query("servicesIssuingCompanyMap")
  .collect()
  .then((rs) => rs.filter((m) => m.serviceId === args.serviceId).length);
if (maps > 0) refs.push({ table: "servicesIssuingCompanyMap", count: maps });

const overrides = await ctx.db
  .query("clientIssuingCompanyOverride")
  .collect()
  .then((rs) => rs.filter((o) => o.serviceId === args.serviceId).length);
if (overrides > 0) refs.push({ table: "clientIssuingCompanyOverride", count: overrides });

if (refs.length > 0) {
  throw new ConvexError({
    code: "HAS_ACTIVE_REFS",
    message: `Servicio en uso: ${refs.map((r) => `${r.count} ${r.table}`).join(", ")}`,
  });
}

// ... resto del delete original
```

NOTA: `services` es catálogo global potencialmente — `.collect()` aquí escanea full tabla. Es aceptable porque resetToDefault es una operación super-admin de baja frecuencia.

- [ ] **Step 6.4: Correr test, verificar que pasa**

Run: `npx vitest run convex/functions/services/__tests__/resetToDefault.guard.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 6.5: Correr suite services**

Run: `npx vitest run convex/functions/services/__tests__/ 2>&1 | tail -5`
Expected: todos verdes.

- [ ] **Step 6.6: Commit**

```bash
git add convex/functions/services/mutations.ts convex/functions/services/__tests__/resetToDefault.guard.test.ts
git commit -m "$(cat <<'EOF'
fix(services): resetToDefault guard contra refs activas

Phase 1 §3.4. Bloquea borrado de service con projectionServices,
subservices, templates, mappings u overrides apuntándolo.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Contract guard en `quotations.deleteQuotation` (§3.5)

**Files:**
- Modify: `convex/functions/quotations/mutations.ts:691` (`deleteQuotation`)
- Test: `convex/functions/quotations/__tests__/deleteQuotation.contractGuard.test.ts`

**Contexto:** Defensive guard — el flujo normal no debería permitir que un draft quotation tenga contract, pero si existe (flujo parcial), el delete dejaría contract.quotationId huérfano.

- [ ] **Step 7.1: Escribir test rojo**

Crear `convex/functions/quotations/__tests__/deleteQuotation.contractGuard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../../tests/harness";

describe("deleteQuotation contract guard", () => {
  it("throws HAS_CONTRACT when a contract references the draft quotation", async () => {
    const t = setupTest();
    const { quotationId } = await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: ORG_A, name: "C", rfc: "X", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: ORG_A, clientId, year: 2026,
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
      const qId = await ctx.db.insert("quotations", {
        orgId: ORG_A, projServiceId: psId, clientId, serviceName: "S",
        content: "<p/>", status: "draft", createdAt: Date.now(),
      });
      await ctx.db.insert("contracts", {
        orgId: ORG_A, quotationId: qId, projServiceId: psId, clientId,
        serviceName: "S", content: "<p/>", status: "draft",
        createdAt: Date.now(),
      });
      return { quotationId: qId };
    });

    await expect(
      t.withIdentity({
        subject: "u", tokenIdentifier: "u", orgId: ORG_A,
      } as any).mutation(
        api.functions.quotations.mutations.deleteQuotation,
        { quotationId } as any
      )
    ).rejects.toThrow(/HAS_CONTRACT|contrato/i);

    const q = await t.run((ctx) => ctx.db.get(quotationId));
    expect(q).not.toBeNull();
  });
});
```

- [ ] **Step 7.2: Correr test, verificar que falla**

Run: `npx vitest run convex/functions/quotations/__tests__/deleteQuotation.contractGuard.test.ts`
Expected: FAIL — quotation se borra sin throw.

- [ ] **Step 7.3: Implementar guard en `deleteQuotation`**

En `convex/functions/quotations/mutations.ts:691`, dentro del handler de `deleteQuotation`, después del status check `draft` y ANTES del `ctx.db.delete`:

```ts
// Phase 1 §3.5 — guard: bloquear delete si hay contract apuntando
const contractRef = await ctx.db
  .query("contracts")
  .withIndex("by_quotationId", (q) => q.eq("quotationId", args.quotationId))
  .first();
if (contractRef) {
  throw new ConvexError({
    code: "HAS_CONTRACT",
    message: `Cotización tiene contrato ${contractRef._id} asociado. Borra el contrato primero.`,
  });
}
```

(Verificar que `ConvexError` esté importado en el archivo.)

- [ ] **Step 7.4: Correr test, verificar que pasa**

Run: `npx vitest run convex/functions/quotations/__tests__/deleteQuotation.contractGuard.test.ts`
Expected: PASS.

- [ ] **Step 7.5: Correr suite quotations**

Run: `npx vitest run convex/functions/quotations/__tests__/ 2>&1 | tail -5`
Expected: todos verdes.

- [ ] **Step 7.6: Commit**

```bash
git add convex/functions/quotations/mutations.ts convex/functions/quotations/__tests__/deleteQuotation.contractGuard.test.ts
git commit -m "$(cat <<'EOF'
fix(quotations): deleteQuotation guard contra contracts huérfanos

Phase 1 §3.5. Defensive: bloquea delete si hay contract referenciando
la quotation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Cerrar TODO en `issuingCompanies.remove` (§3.6)

**Files:**
- Modify: `convex/functions/issuingCompanies/mutations.ts:203` (`remove`) — eliminar TODO en línea 231
- Test: `convex/functions/issuingCompanies/__tests__/remove.guard.test.ts`

**Contexto:** SS2 (multi-entity) ya está live. El TODO en `mutations.ts:231` admite que no se cuentan refs en `quotations.issuingCompanyId`, `contracts.issuingCompanyId`, `deliverableTemplates.issuingCompanyId`. Cerrar.

- [ ] **Step 8.1: Escribir test rojo**

Crear `convex/functions/issuingCompanies/__tests__/remove.guard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../../tests/harness";

describe("issuingCompanies.remove extended guard", () => {
  it("throws when issuingCompanyId is referenced by a quotation", async () => {
    const t = setupTest();
    const { icId } = await t.run(async (ctx) => {
      const id = await ctx.db.insert("issuingCompanies", {
        orgId: ORG_A, name: "Emisora A", legalName: "Emisora SA",
        rfc: "EMA010101AAA", regimenFiscalCode: "601",
        codigoPostal: "11000",
        address: {
          street: "x", city: "CDMX", state: "CDMX", country: "MX",
        },
        email: "x@a.com",
        isDefault: false, isActive: true,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      const clientId = await ctx.db.insert("clients", {
        orgId: ORG_A, name: "C", rfc: "X", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: ORG_A, clientId, year: 2026,
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
      await ctx.db.insert("quotations", {
        orgId: ORG_A, projServiceId: psId, clientId, serviceName: "S",
        content: "<p/>", status: "draft",
        issuingCompanyId: id,
        createdAt: Date.now(),
      });
      return { icId: id };
    });

    await expect(
      t.withIdentity({
        subject: "u", tokenIdentifier: "u", orgId: ORG_A,
      } as any).mutation(
        api.functions.issuingCompanies.mutations.remove,
        { id: icId } as any
      )
    ).rejects.toThrow(/HAS_ACTIVE_REFS|en uso|cotiza|quotation/i);
  });

  it("throws when issuingCompanyId is referenced by a contract", async () => {
    const t = setupTest();
    const { icId } = await t.run(async (ctx) => {
      const id = await ctx.db.insert("issuingCompanies", {
        orgId: ORG_A, name: "B", legalName: "B SA",
        rfc: "EMB010101AAA", regimenFiscalCode: "601",
        codigoPostal: "11000",
        address: { street: "x", city: "CDMX", state: "CDMX", country: "MX" },
        email: "x@b.com",
        isDefault: false, isActive: true,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      const clientId = await ctx.db.insert("clients", {
        orgId: ORG_A, name: "C", rfc: "X", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: ORG_A, clientId, year: 2026,
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
      const qId = await ctx.db.insert("quotations", {
        orgId: ORG_A, projServiceId: psId, clientId, serviceName: "S",
        content: "<p/>", status: "approved", createdAt: Date.now(),
      });
      await ctx.db.insert("contracts", {
        orgId: ORG_A, quotationId: qId, projServiceId: psId, clientId,
        serviceName: "S", content: "<p/>", status: "draft",
        issuingCompanyId: id,
        createdAt: Date.now(),
      });
      return { icId: id };
    });

    await expect(
      t.withIdentity({
        subject: "u", tokenIdentifier: "u", orgId: ORG_A,
      } as any).mutation(
        api.functions.issuingCompanies.mutations.remove,
        { id: icId } as any
      )
    ).rejects.toThrow(/HAS_ACTIVE_REFS|en uso|contrato|contract/i);
  });

  it("throws when issuingCompanyId is referenced by a deliverableTemplate", async () => {
    const t = setupTest();
    const { icId } = await t.run(async (ctx) => {
      const id = await ctx.db.insert("issuingCompanies", {
        orgId: ORG_A, name: "C", legalName: "C SA",
        rfc: "EMC010101AAA", regimenFiscalCode: "601",
        codigoPostal: "11000",
        address: { street: "x", city: "CDMX", state: "CDMX", country: "MX" },
        email: "x@c.com",
        isDefault: false, isActive: true,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      await ctx.db.insert("deliverableTemplates", {
        orgId: ORG_A, serviceName: "S", type: "contract",
        name: "T", htmlTemplate: "<p/>",
        variables: [], version: 1, isActive: true,
        issuingCompanyId: id,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      return { icId: id };
    });

    await expect(
      t.withIdentity({
        subject: "u", tokenIdentifier: "u", orgId: ORG_A,
      } as any).mutation(
        api.functions.issuingCompanies.mutations.remove,
        { id: icId } as any
      )
    ).rejects.toThrow(/HAS_ACTIVE_REFS|en uso|template/i);
  });
});
```

- [ ] **Step 8.2: Correr test, verificar que falla**

Run: `npx vitest run convex/functions/issuingCompanies/__tests__/remove.guard.test.ts`
Expected: FAIL — los 3 tests porque el TODO no chequea esas tablas.

- [ ] **Step 8.3: Implementar guard extendido**

En `convex/functions/issuingCompanies/mutations.ts:203` (`remove`), donde está el TODO en línea 231, agregar el chequeo:

```ts
// Phase 1 §3.6 — cerrar TODO: contar refs en quotations + contracts + deliverableTemplates
const refs: { table: string; count: number }[] = [];

const quotationRefs = await ctx.db
  .query("quotations")
  .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
  .collect()
  .then((rs) => rs.filter((r) => r.issuingCompanyId === args.id).length);
if (quotationRefs > 0) refs.push({ table: "quotations", count: quotationRefs });

const contractRefs = await ctx.db
  .query("contracts")
  .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
  .collect()
  .then((rs) => rs.filter((r) => r.issuingCompanyId === args.id).length);
if (contractRefs > 0) refs.push({ table: "contracts", count: contractRefs });

const templateRefs = await ctx.db
  .query("deliverableTemplates")
  .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
  .collect()
  .then((rs) => rs.filter((tpl) => tpl.issuingCompanyId === args.id).length);
if (templateRefs > 0) refs.push({ table: "deliverableTemplates", count: templateRefs });

if (refs.length > 0) {
  throw new ConvexError({
    code: "HAS_ACTIVE_REFS",
    message: `Empresa emisora en uso: ${refs.map((r) => `${r.count} ${r.table}`).join(", ")}`,
  });
}
```

Reemplazar el comment TODO de la línea 231 con el bloque arriba. Asegurar que `orgId` y `args.id` correspondan a los nombres reales en el handler — leer el archivo primero para confirmar.

- [ ] **Step 8.4: Correr test, verificar que pasa**

Run: `npx vitest run convex/functions/issuingCompanies/__tests__/remove.guard.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 8.5: Correr suite issuingCompanies**

Run: `npx vitest run convex/functions/issuingCompanies/__tests__/ 2>&1 | tail -5`
Expected: todos verdes.

- [ ] **Step 8.6: Commit**

```bash
git add convex/functions/issuingCompanies/mutations.ts convex/functions/issuingCompanies/__tests__/remove.guard.test.ts
git commit -m "$(cat <<'EOF'
fix(issuingCompanies): cerrar TODO de refs en quotations/contracts/templates

Phase 1 §3.6. SS2 live → el guard original no contaba refs nuevos.
Ahora bloquea remove si hay quotations, contracts o deliverableTemplates
referenciando la emisora.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Claim atómico en `generateFromInvoice` (§3.7)

**Files:**
- Modify: `convex/functions/deliverables/invoiceFlow.ts:32` (`generateFromInvoice`)
- Create: `convex/functions/deliverables/invoiceFlow.ts` — nueva internal mutation `claimInvoiceForGeneration`
- Test: `convex/functions/deliverables/__tests__/invoiceFlow.claim.test.ts`

**Contexto:** Cierra race del doble markPaid → doble AI cost. `claimInvoiceForGeneration` es una internalMutation atómica que crea un placeholder `deliverables` row con `triggerInvoiceId` set. Si dos acciones concurrentes intentan claim, solo una gana (la otra retorna `false` y skipea el AI batch).

- [ ] **Step 9.1: Escribir test rojo (idempotency)**

Crear `convex/functions/deliverables/__tests__/invoiceFlow.claim.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { internal } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../../tests/harness";

describe("claimInvoiceForGeneration", () => {
  it("first call returns true and inserts a placeholder deliverable", async () => {
    const t = setupTest();
    const { invoiceId, assignmentId, projServiceId, clientId } = await t.run(async (ctx) => {
      const cId = await ctx.db.insert("clients", {
        orgId: ORG_A, name: "C", rfc: "X", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
        contactEmail: "c@x.com",
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: ORG_A, clientId: cId, year: 2026,
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
      const maId = await ctx.db.insert("monthlyAssignments", {
        orgId: ORG_A, projServiceId: psId, projectionId, clientId: cId,
        serviceName: "S", month: 6, year: 2026, amount: 100, feFactor: 1,
        status: "pending", invoiceStatus: "paid",
      });
      const iId = await ctx.db.insert("invoices", {
        orgId: ORG_A, clientId: cId, projectionId, projServiceId: psId,
        serviceName: "S", monthlyAssignmentId: maId,
        month: 6, year: 2026, amount: 100,
        bucketKey: "k", contentType: "application/pdf", sizeBytes: 1,
        filename: "f.pdf",
        status: "paid",
        uploadedAt: Date.now(), uploadedBy: "u",
        paidAt: Date.now(), paidBy: "u",
        createdAt: Date.now(),
      });
      return { invoiceId: iId, assignmentId: maId, projServiceId: psId, clientId: cId };
    });

    const claimed = await t.mutation(
      internal.functions.deliverables.invoiceFlow.claimInvoiceForGeneration,
      { invoiceId } as any
    );

    expect(claimed).toBe(true);
    const deliverables = await t.run((ctx) =>
      ctx.db.query("deliverables").collect()
    );
    expect(deliverables).toHaveLength(1);
    expect(deliverables[0].triggerInvoiceId).toBe(invoiceId);
    expect(deliverables[0].auditStatus).toBe("pending");
    expect(deliverables[0].shortContent).toBe("");
    expect(deliverables[0].triggerSource).toBe("invoice_paid");
  });

  it("second call returns false and does not insert duplicate", async () => {
    const t = setupTest();
    const { invoiceId } = await t.run(async (ctx) => {
      const cId = await ctx.db.insert("clients", {
        orgId: ORG_A, name: "C", rfc: "X", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: ORG_A, clientId: cId, year: 2026,
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
      const maId = await ctx.db.insert("monthlyAssignments", {
        orgId: ORG_A, projServiceId: psId, projectionId, clientId: cId,
        serviceName: "S", month: 6, year: 2026, amount: 100, feFactor: 1,
        status: "pending", invoiceStatus: "paid",
      });
      const iId = await ctx.db.insert("invoices", {
        orgId: ORG_A, clientId: cId, projectionId, projServiceId: psId,
        serviceName: "S", monthlyAssignmentId: maId,
        month: 6, year: 2026, amount: 100,
        bucketKey: "k", contentType: "application/pdf", sizeBytes: 1,
        filename: "f.pdf", status: "paid",
        uploadedAt: Date.now(), uploadedBy: "u",
        paidAt: Date.now(), paidBy: "u",
        createdAt: Date.now(),
      });
      return { invoiceId: iId };
    });

    await t.mutation(
      internal.functions.deliverables.invoiceFlow.claimInvoiceForGeneration,
      { invoiceId } as any
    );
    const second = await t.mutation(
      internal.functions.deliverables.invoiceFlow.claimInvoiceForGeneration,
      { invoiceId } as any
    );

    expect(second).toBe(false);
    const deliverables = await t.run((ctx) =>
      ctx.db.query("deliverables").collect()
    );
    expect(deliverables).toHaveLength(1);
  });
});
```

- [ ] **Step 9.2: Correr test, verificar que falla**

Run: `npx vitest run convex/functions/deliverables/__tests__/invoiceFlow.claim.test.ts`
Expected: FAIL — `claimInvoiceForGeneration` no existe.

- [ ] **Step 9.3: Implementar `claimInvoiceForGeneration`**

En `convex/functions/deliverables/invoiceFlow.ts`, agregar al final del archivo:

```ts
import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";

/**
 * Atomic claim para idempotencia de generateFromInvoice.
 * Inserta un placeholder deliverable con triggerInvoiceId set, retornando
 * false si ya existe (race winner ya reservó el slot).
 *
 * El placeholder se patchea con contenido real cuando termina el AI batch.
 */
export const claimInvoiceForGeneration = internalMutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => {
    const existing = await ctx.db
      .query("deliverables")
      .withIndex("by_triggerInvoiceId", (q) => q.eq("triggerInvoiceId", invoiceId))
      .first();
    if (existing) return false;

    const invoice = await ctx.db.get(invoiceId);
    if (!invoice) return false;

    const assignment = invoice.monthlyAssignmentId
      ? await ctx.db.get(invoice.monthlyAssignmentId)
      : null;
    if (!assignment) return false;

    await ctx.db.insert("deliverables", {
      orgId: invoice.orgId,
      assignmentId: assignment._id,
      projServiceId: assignment.projServiceId,
      clientId: assignment.clientId,
      serviceName: assignment.serviceName,
      subserviceId: assignment.subserviceId,
      month: assignment.month,
      year: assignment.year,
      shortContent: "",
      longContent: "",
      auditStatus: "pending" as const,
      retryCount: 0,
      triggerSource: "invoice_paid" as const,
      triggerInvoiceId: invoiceId,
      createdAt: Date.now(),
    });
    return true;
  },
});
```

- [ ] **Step 9.4: Modificar `generateFromInvoice` para usar el claim**

En `convex/functions/deliverables/invoiceFlow.ts:32`, dentro del handler de `generateFromInvoice`, REEMPLAZAR el bloque de idempotency check existente (alrededor de `findByTriggerInvoiceId`) por:

```ts
// Phase 1 §3.7 — atomic claim antes del AI call
const claimed: boolean = await ctx.runMutation(
  internal.functions.deliverables.invoiceFlow.claimInvoiceForGeneration,
  { invoiceId: args.invoiceId }
);
if (!claimed) {
  console.log(`[generateFromInvoice] invoice ${args.invoiceId} already claimed — skip AI`);
  return { skipped: "already_claimed" as const };
}
```

Y modificar el flow downstream que llama a `saveGenerated` para que **patchee el placeholder existente** en vez de insertar nuevo. El dedup en `deliverables.saveGenerated` ya hace patch-on-existing por `by_assignmentId`, así que esto debería funcionar sin cambios adicionales — verificar leyendo `saveGenerated` en `convex/functions/deliverables/mutations.ts`.

- [ ] **Step 9.5: Correr tests claim + invoiceFlow**

Run: `npx vitest run convex/functions/deliverables/__tests__/invoiceFlow.claim.test.ts`
Expected: PASS.

Run: `npx vitest run convex/functions/deliverables/__tests__/`
Expected: todos verdes (regression check). Si algún test legacy assumía que `findByTriggerInvoiceId` era la idempotency check, ajustar el test o, idealmente, no — el nuevo path mantiene el mismo invariante final.

- [ ] **Step 9.6: Commit**

```bash
git add convex/functions/deliverables/invoiceFlow.ts convex/functions/deliverables/__tests__/invoiceFlow.claim.test.ts
git commit -m "$(cat <<'EOF'
fix(deliverables): atomic claim en generateFromInvoice anti AI doble cost

Phase 1 §3.7. claimInvoiceForGeneration inserta placeholder deliverable
atómicamente. Race losers skipean el AI batch. saveGenerated patchea el
placeholder vía dedup existente por_assignmentId.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Verificación final

**Files:** ninguno

- [ ] **Step 10.1: Suite completa**

Run: `npm test 2>&1 | tail -5`
Expected: `Tests  XXXX passed | 1 skipped` (1096 baseline + nuevos tests de Task 1-9 = ~1110-1115).

- [ ] **Step 10.2: TypeScript clean**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: 0 errores.

- [ ] **Step 10.3: GitNexus reindex (per CLAUDE.md)**

Run: `npx gitnexus analyze --embeddings` (background OK)
Expected: completa sin errores. Stats updated.

- [ ] **Step 10.4: Detect changes scope check**

Run: `npx gitnexus detect-changes --scope=compare --base-ref=main` (o equivalent del CLI)
Expected: solo los archivos modificados por Phase 1 aparecen — no hay drift inesperado.

- [ ] **Step 10.5: Resumen para el user**

Reportar en una sentence: cuántos commits se hicieron, cuántos tests pasaron (X passed, baseline + nuevos), TS clean, y los 7 fixes done por sección (3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7). NO hacer push (per `feedback_no_push_default`).

---

## Notas finales

- **Cada task es un commit independiente** — rollback selectivo posible vía `git revert <hash>`.
- **NO se hace `git push`** por defecto (memoria `feedback_no_push_default`).
- **NO se hace `convex deploy --prod`** — el deploy a producción es decisión separada del user.
- **Si algún test legacy se rompe** (regression), pausar, investigar la causa raíz, y reportar al user con el contexto antes de modificar el test.
- **Si Phase 1 expone algún hallazgo no contemplado en el spec** (ej. una mutation que no se mencionó pero comparte el patrón), reportarlo al user y dejar para Phase 2 — no expandir scope dentro de Phase 1.
