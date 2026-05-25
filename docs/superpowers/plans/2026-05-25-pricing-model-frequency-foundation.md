# Pricing Model + Frequency Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Foundation schema + engine para 4 pricing models (`fixed_retainer | dynamic_retainer | commission | one_time`) + cierre del bug actual donde overrides manuales se pierden al recalcular.

**Architecture:** 3 fields nuevos optional (PR1) → backfill via migration interna → schema tightening a required (PR2). Engine recibe `pricingModel` por row y branchea para `one_time`; layer de mutations preserva cells con `isManuallyOverridden=true` durante recalc.

**Tech Stack:** Convex (DB + mutations + queries), TypeScript estricto, Vitest, Node 20.

**Spec origen:** `docs/superpowers/specs/2026-05-25-pricing-model-frequency-foundation-design.md`

---

## File Structure

### Crear
| Path | Responsabilidad |
|---|---|
| `convex/lib/pricingModel.ts` | Type union `PricingModel` + helper `derivePricingModel` (single source of truth) |
| `convex/lib/__tests__/pricingModel.test.ts` | Unit tests del helper |
| `convex/lib/__tests__/projectionEngine.pricingModel.test.ts` | Engine recompute por pricingModel + preservation of overridden cells |
| `convex/functions/migrations/pricingModel.ts` | `migrate` + `verifyComplete` internalMutation/Query |
| `convex/functions/migrations/__tests__/pricingModel.test.ts` | Migration idempotency + derivation correctness |
| `convex/functions/projectionServices/__tests__/changePricingModel.test.ts` | Switch mid-cycle entre modelos |
| `convex/functions/monthlyAssignments/__tests__/updateAmount.test.ts` | Verifica que `updateAmount` setea `isManuallyOverridden=true` |

### Modificar
| Path | Cambio |
|---|---|
| `convex/schema.ts` | Agregar 3 fields optional (subservices.defaultPricingModel, projectionServices.pricingModel, monthlyAssignments.isManuallyOverridden) |
| `convex/lib/projectionEngine.ts` | Extender `ServiceConfig` con `pricingModel`; nueva branch en `calculateProjection` para `one_time` |
| `convex/functions/monthlyAssignments/mutations.ts:42-54` | `updateAmount` setea `isManuallyOverridden: true` |
| `convex/functions/projections/mutations.ts:235-266` | En `create`, herencia de pricingModel desde subservice + flag inicial en dynamic_retainer |
| `convex/functions/projections/mutations.ts:400-445` | En `recalculate`, preservar cells con `isManuallyOverridden=true` (NO eliminar + recrear sus amounts) |
| `convex/functions/projectionServices/mutations.ts` | Agregar `changePricingModel` mutation |

---

## Task 1: Crear `PricingModel` type + `derivePricingModel` helper

**Files:**
- Create: `convex/lib/pricingModel.ts`
- Create: `convex/lib/__tests__/pricingModel.test.ts`

- [ ] **Step 1: Write the failing test**

Crear `convex/lib/__tests__/pricingModel.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { derivePricingModel } from "../pricingModel";

describe("derivePricingModel", () => {
  it("returns 'commission' when isCommission is true (wins over una_vez)", () => {
    expect(
      derivePricingModel({ isCommission: true, defaultFrequency: "una_vez" })
    ).toBe("commission");
  });

  it("returns 'one_time' when defaultFrequency is 'una_vez' and not commission", () => {
    expect(
      derivePricingModel({ isCommission: false, defaultFrequency: "una_vez" })
    ).toBe("one_time");
  });

  it("returns 'fixed_retainer' when defaultFrequency is 'mensual' and not commission", () => {
    expect(
      derivePricingModel({ isCommission: false, defaultFrequency: "mensual" })
    ).toBe("fixed_retainer");
  });

  it("treats undefined isCommission as false", () => {
    expect(
      derivePricingModel({ isCommission: undefined, defaultFrequency: "trimestral" })
    ).toBe("fixed_retainer");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/lib/__tests__/pricingModel.test.ts`
Expected: FAIL — "Cannot find module '../pricingModel'"

- [ ] **Step 3: Implement the helper**

Crear `convex/lib/pricingModel.ts`:

```typescript
/**
 * Pricing model union — single source of truth for the 4 modes Projex supports.
 * Spec: docs/superpowers/specs/2026-05-25-pricing-model-frequency-foundation-design.md §2
 */
export type PricingModel =
  | "fixed_retainer"
  | "dynamic_retainer"
  | "commission"
  | "one_time";

export type SubserviceFrequency =
  | "mensual"
  | "trimestral"
  | "semestral"
  | "anual"
  | "una_vez";

/**
 * Derive default pricingModel from existing subservice signals.
 * Order: commission > one_time > fixed_retainer.
 * Used at migration time and as fallback when subservice has no defaultPricingModel.
 */
export function derivePricingModel(args: {
  isCommission?: boolean;
  defaultFrequency: SubserviceFrequency;
}): PricingModel {
  if (args.isCommission) return "commission";
  if (args.defaultFrequency === "una_vez") return "one_time";
  return "fixed_retainer";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/lib/__tests__/pricingModel.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add convex/lib/pricingModel.ts convex/lib/__tests__/pricingModel.test.ts
git commit -m "feat(pricing): add PricingModel type + derivePricingModel helper

Single source of truth for the 4 pricing modes. Derivation order:
commission > one_time > fixed_retainer."
```

---

## Task 2: Schema — agregar 3 fields optional

**Files:**
- Modify: `convex/schema.ts:170-202` (subservices), `convex/schema.ts:204-227` (projectionServices), `convex/schema.ts:229-258` (monthlyAssignments)

- [ ] **Step 1: Add `defaultPricingModel` to subservices table**

En `convex/schema.ts`, dentro de `subservices: defineTable({ ... })` después del field `defaultFrequency`:

```typescript
    defaultPricingModel: v.optional(
      v.union(
        v.literal("fixed_retainer"),
        v.literal("dynamic_retainer"),
        v.literal("commission"),
        v.literal("one_time")
      )
    ),
```

- [ ] **Step 2: Add `pricingModel` to projectionServices table**

En `convex/schema.ts`, dentro de `projectionServices: defineTable({ ... })` después del field `subserviceId`:

```typescript
    pricingModel: v.optional(
      v.union(
        v.literal("fixed_retainer"),
        v.literal("dynamic_retainer"),
        v.literal("commission"),
        v.literal("one_time")
      )
    ),
```

- [ ] **Step 3: Add `isManuallyOverridden` to monthlyAssignments table**

En `convex/schema.ts`, dentro de `monthlyAssignments: defineTable({ ... })` después del field `invoiceStatus`:

```typescript
    isManuallyOverridden: v.optional(v.boolean()),
```

- [ ] **Step 4: Verify TypeScript + Convex codegen**

Run: `npx convex dev --once`
Expected: Sin errores. Convex regenera `_generated/dataModel.d.ts` con los nuevos fields.

Run: `npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -10`
Expected: Sin errores.

- [ ] **Step 5: Commit**

```bash
git add convex/schema.ts
git commit -m "feat(schema): add pricingModel + isManuallyOverridden fields (optional)

Sub-spec 0 schema foundation. Fields are optional in PR1; migration
backfills via internal:migrations/pricingModel:migrate. PR2 tightens
to required after backfill is verified."
```

---

## Task 3: Engine — extender `ServiceConfig` con `pricingModel` + branch `one_time`

**Files:**
- Modify: `convex/lib/projectionEngine.ts:9-19` (ServiceConfig type), `:127-394` (calculateProjection)
- Create: `convex/lib/__tests__/projectionEngine.pricingModel.test.ts`

- [ ] **Step 1: Write the failing test**

Crear `convex/lib/__tests__/projectionEngine.pricingModel.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { calculateProjection } from "../projectionEngine";

const FE_FLAT = Array.from({ length: 12 }, (_, i) => ({
  month: i + 1,
  monthlySales: 100_000,
  feFactor: 1,
}));

describe("calculateProjection — pricingModel branches", () => {
  it("one_time: puts annualAmount only in month=1 (startMonth fallback), 0 elsewhere", () => {
    const result = calculateProjection({
      annualSales: 1_200_000,
      totalBudget: 50_000,
      commissionRate: 0.02,
      services: [
        {
          serviceId: "svc1",
          serviceName: "Identidad Corporativa",
          type: "base",
          minPct: 0,
          maxPct: 100,
          chosenPct: 100,
          isActive: true,
          pricingModel: "one_time",
        },
      ],
      seasonalityData: FE_FLAT,
    });

    const svc = result.services[0];
    expect(svc.monthlyAmounts[0].adjustedAmount).toBeCloseTo(50_000, 2);
    for (let i = 1; i < 12; i++) {
      expect(svc.monthlyAmounts[i].adjustedAmount).toBe(0);
    }
  });

  it("fixed_retainer (or no pricingModel): distributes per FE/sumFE — unchanged from current behavior", () => {
    const result = calculateProjection({
      annualSales: 1_200_000,
      totalBudget: 120_000,
      commissionRate: 0,
      services: [
        {
          serviceId: "svc1",
          serviceName: "TI",
          type: "base",
          minPct: 0,
          maxPct: 100,
          chosenPct: 100,
          isActive: true,
          pricingModel: "fixed_retainer",
        },
      ],
      seasonalityData: FE_FLAT,
    });

    const svc = result.services[0];
    for (let i = 0; i < 12; i++) {
      expect(svc.monthlyAmounts[i].adjustedAmount).toBeCloseTo(10_000, 2);
    }
  });

  it("dynamic_retainer: same arithmetic as fixed_retainer at seed time (flag flip lives in mutation layer)", () => {
    const result = calculateProjection({
      annualSales: 1_200_000,
      totalBudget: 60_000,
      commissionRate: 0,
      services: [
        {
          serviceId: "svc1",
          serviceName: "Legal",
          type: "base",
          minPct: 0,
          maxPct: 100,
          chosenPct: 100,
          isActive: true,
          pricingModel: "dynamic_retainer",
        },
      ],
      seasonalityData: FE_FLAT,
    });

    const svc = result.services[0];
    for (let i = 0; i < 12; i++) {
      expect(svc.monthlyAmounts[i].adjustedAmount).toBeCloseTo(5_000, 2);
    }
  });

  it("commission: matches existing isCommission behavior when pricingModel is commission", () => {
    const result = calculateProjection({
      annualSales: 1_200_000,
      totalBudget: 100_000,
      commissionRate: 0.05,
      services: [
        {
          serviceId: "svc1",
          serviceName: "Comisiones",
          type: "base",
          minPct: 0,
          maxPct: 100,
          chosenPct: 0,
          isActive: true,
          isCommission: true,
          pricingModel: "commission",
        },
      ],
      seasonalityData: FE_FLAT,
    });

    const svc = result.services[0];
    for (let i = 0; i < 12; i++) {
      expect(svc.monthlyAmounts[i].adjustedAmount).toBeCloseTo(5_000, 2);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/lib/__tests__/projectionEngine.pricingModel.test.ts`
Expected: FAIL — el test `one_time` falla porque el engine actual no tiene ese branch (distribuye por FE).

- [ ] **Step 3: Extend `ServiceConfig` with pricingModel**

En `convex/lib/projectionEngine.ts`, modificar el type `ServiceConfig` (line 9):

```typescript
import type { PricingModel } from "./pricingModel";

export type ServiceConfig = {
  serviceId: string;
  serviceName: string;
  type: "base" | "comodin";
  minPct: number;
  maxPct: number;
  chosenPct: number;
  isActive: boolean;
  isCommission?: boolean;
  fixedMonthlyAmount?: number;
  pricingModel?: PricingModel;
};
```

- [ ] **Step 4: Add `one_time` branch in calculateProjection**

En `convex/lib/projectionEngine.ts`, dentro del map de `serviceAllocations` (después del `if (service.isCommission === true)` block, antes del `if (resolvedConfig.calculationMode === "fixed")`), agregar:

```typescript
    if (service.pricingModel === "one_time") {
      // one_time: annualAmount entero se cobra en el primer mes del scope.
      // Resto de meses = 0. Sin FE adjustment (es un único cobro fijo).
      const normalizedWeight = totalWeight > 0 ? service.chosenPct / totalWeight : 0;
      const annualAmount = remainingBudget * normalizedWeight;
      const firstMonth = effectiveSeasonality[0]?.month ?? 1;

      const monthlyAmounts: MonthlyAmount[] = effectiveSeasonality.map((m) => ({
        month: m.month,
        baseAmount: m.month === firstMonth ? annualAmount : 0,
        feFactor: m.feFactor,
        adjustedAmount: m.month === firstMonth ? annualAmount : 0,
      }));

      return {
        serviceId: service.serviceId,
        serviceName: service.serviceName,
        type: service.type,
        chosenPct: service.chosenPct,
        isActive: true,
        normalizedWeight,
        annualAmount,
        monthlyAmounts,
      };
    }
```

**Nota:** `one_time` no participa en Step 5b residual reconciliation (no tiene `normalizedWeight > 0` que reduzca al sumBase de fixed services — el filtro `baseAllocations` ya excluye una_vez naturalmente porque su lógica sigue su propio path arriba de fixed).

**Importante para el reconciler (Step 5b):** después de agregar el branch one_time, el filtro `baseAllocations.filter((s) => s.normalizedWeight > 0)` incluiría `one_time` (que tiene `normalizedWeight > 0`). Como `one_time` ya cierra su propia distribución (todo en 1 mes), el reconciler intentaría redistribuir drift sub-cent en sus meses-0, lo cual rompe la invariante "solo mes 1 tiene amount". Excluir explícitamente:

Modificar línea ~336 de:
```typescript
const baseAllocations = serviceAllocations.filter((s) => s.normalizedWeight > 0);
```

A:
```typescript
const baseAllocations = serviceAllocations.filter(
  (s) =>
    s.normalizedWeight > 0 &&
    // one_time concentra en un solo mes — excluir del reconciler de drift mensual.
    !(input.services.find((cfg) => cfg.serviceId === s.serviceId)?.pricingModel === "one_time")
);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run convex/lib/__tests__/projectionEngine.pricingModel.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Run full test suite — verify no regression**

Run: `npm test 2>&1 | tail -5`
Expected: 814 passed | 1 skipped (810 baseline + 4 new).

- [ ] **Step 7: Commit**

```bash
git add convex/lib/projectionEngine.ts convex/lib/__tests__/projectionEngine.pricingModel.test.ts
git commit -m "feat(engine): branch one_time pricing + extend ServiceConfig

one_time concentrates annualAmount in the first month of the scope.
Excluded from monthly-drift reconciler (Step 5b) to preserve the
zero-amount months. fixed_retainer / dynamic_retainer / commission
keep their existing math at the engine layer; the dynamic_retainer
freeze semantics live in the mutation orchestration (Task 5)."
```

---

## Task 4: `updateAmount` setea `isManuallyOverridden=true`

**Files:**
- Modify: `convex/functions/monthlyAssignments/mutations.ts:42-54`
- Create: `convex/functions/monthlyAssignments/__tests__/updateAmount.test.ts`

- [ ] **Step 1: Write the failing test**

Crear `convex/functions/monthlyAssignments/__tests__/updateAmount.test.ts`:

```typescript
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import schema from "../../../schema";

describe("monthlyAssignments.updateAmount", () => {
  it("sets isManuallyOverridden=true when amount changes", async () => {
    const t = convexTest(schema);
    const asUser = t.withIdentity({
      subject: "user_abc",
      tokenIdentifier: "test|user_abc",
      org_id: "org_test",
      org_role: "org:member",
    });

    // Seed: insert a monthlyAssignment with isManuallyOverridden=false
    const cellId = await t.run(async (ctx) => {
      // Need a client + projection + projectionService first for FK integrity.
      // For this test, we sidestep by inserting a minimal monthlyAssignment.
      // (Convex test runner allows direct inserts that bypass mutation flow.)
      const clientId = await ctx.db.insert("clients", {
        orgId: "org_test",
        name: "Test Client",
        rfc: "XAXX010101000",
        isArchived: false,
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: "org_test",
        clientId,
        year: 2026,
        annualSales: 1_200_000,
        totalBudget: 120_000,
        commissionRate: 0.02,
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
      const projServiceId = await ctx.db.insert("projectionServices", {
        orgId: "org_test",
        projectionId,
        serviceId,
        serviceName: "TI",
        chosenPct: 30,
        isActive: true,
        annualAmount: 36000,
        normalizedWeight: 1,
      });
      return await ctx.db.insert("monthlyAssignments", {
        orgId: "org_test",
        projServiceId,
        projectionId,
        clientId,
        serviceName: "TI",
        month: 1,
        year: 2026,
        amount: 3000,
        feFactor: 1,
        status: "pending",
        invoiceStatus: "not_invoiced",
        isManuallyOverridden: false,
      });
    });

    await asUser.mutation(api.functions.monthlyAssignments.mutations.updateAmount, {
      id: cellId,
      amount: 99_000,
    });

    const updated = await t.run(async (ctx) => await ctx.db.get(cellId));
    expect(updated?.amount).toBe(99_000);
    expect(updated?.isManuallyOverridden).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/functions/monthlyAssignments/__tests__/updateAmount.test.ts`
Expected: FAIL — `isManuallyOverridden` será `false` o `undefined`, no `true`.

- [ ] **Step 3: Patch `updateAmount`**

En `convex/functions/monthlyAssignments/mutations.ts:42-54`, reemplazar:

```typescript
export const updateAmount = mutation({
  args: {
    id: v.id("monthlyAssignments"),
    amount: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const orgId = await getOrgId(ctx);
    const ma = await ctx.db.get(args.id);
    if (!ma || ma.orgId !== orgId) throw new Error("No encontrado.");
    await ctx.db.patch(args.id, {
      amount: args.amount,
      isManuallyOverridden: true,
    });
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/functions/monthlyAssignments/__tests__/updateAmount.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full test suite — verify no regression**

Run: `npm test 2>&1 | tail -5`
Expected: 815 passed | 1 skipped.

- [ ] **Step 6: Commit**

```bash
git add convex/functions/monthlyAssignments/mutations.ts convex/functions/monthlyAssignments/__tests__/updateAmount.test.ts
git commit -m "fix(monthlyAssignments): updateAmount sets isManuallyOverridden=true

Closes the bug where manual cell edits got clobbered on engine
recompute. The flag is now persisted; recalc orchestration (Task 6)
respects it across all pricing models."
```

---

## Task 5: `projections.create` — inheritance + dynamic_retainer flag

**Files:**
- Modify: `convex/functions/projections/mutations.ts:228-267`

- [ ] **Step 1: Inspect current create logic + identify hook points**

Run: `grep -n "ctx.db.insert" convex/functions/projections/mutations.ts | head -5`
Expected: 235 (projectionServices), 250 (monthlyAssignments), and others below.

- [ ] **Step 2: Modify projectionService insert to inherit pricingModel from subservice**

En `convex/functions/projections/mutations.ts:235`, reemplazar el bloque del insert por:

```typescript
      // Resolve pricingModel: explicit override on serviceConfig > subservice.defaultPricingModel
      //                    > derive from service.isCommission
      let resolvedPricingModel: PricingModel | undefined =
        serviceConfig.pricingModel; // ← lo lee del input si viene
      if (!resolvedPricingModel && serviceConfig.subserviceId) {
        const sub = await ctx.db.get(serviceConfig.subserviceId);
        resolvedPricingModel = sub?.defaultPricingModel;
      }
      if (!resolvedPricingModel) {
        const svc = await ctx.db.get(serviceConfig.serviceId);
        resolvedPricingModel = svc?.isCommission ? "commission" : "fixed_retainer";
      }

      const projServiceId = await ctx.db.insert("projectionServices", {
        orgId,
        projectionId,
        serviceId: serviceConfig.serviceId,
        serviceName: svc.serviceName,
        subserviceId: serviceConfig.subserviceId,
        chosenPct: svc.chosenPct,
        isActive: svc.isActive,
        annualAmount: svc.annualAmount,
        normalizedWeight: svc.normalizedWeight,
        pricingModel: resolvedPricingModel,
      });
```

Importar `PricingModel` al top del file:

```typescript
import type { PricingModel } from "../../lib/pricingModel";
```

Y agregar el field opcional al schema de `serviceConfigs` args en `convex/functions/projections/mutations.ts:31-42`. El bloque actual es:

```typescript
    serviceConfigs: v.array(
      v.object({
        serviceId: v.id("services"),
        chosenPct: v.number(),
        isActive: v.boolean(),
        subserviceId: v.optional(v.id("subservices")),
      })
    ),
```

Cambiar a:

```typescript
    serviceConfigs: v.array(
      v.object({
        serviceId: v.id("services"),
        chosenPct: v.number(),
        isActive: v.boolean(),
        subserviceId: v.optional(v.id("subservices")),
        pricingModel: v.optional(
          v.union(
            v.literal("fixed_retainer"),
            v.literal("dynamic_retainer"),
            v.literal("commission"),
            v.literal("one_time")
          )
        ),
      })
    ),
```

- [ ] **Step 3: Modify monthlyAssignments insert to flag dynamic_retainer cells**

En el mismo file `convex/functions/projections/mutations.ts:250`, reemplazar el insert por:

```typescript
          await ctx.db.insert("monthlyAssignments", {
            orgId,
            projServiceId,
            projectionId,
            clientId: args.clientId,
            serviceName: svc.serviceName,
            month: ma.month,
            year: args.year,
            amount: ma.adjustedAmount,
            feFactor: ma.feFactor,
            status: "pending",
            invoiceStatus: "not_invoiced",
            isManuallyOverridden: resolvedPricingModel === "dynamic_retainer",
          });
```

`resolvedPricingModel` viene del scope del `for` loop (Step 2).

- [ ] **Step 4: Add a test that verifies dynamic_retainer cells get flagged on create**

Crear (o agregar a un existing test file de projections) `convex/functions/projections/__tests__/createDynamicRetainer.test.ts`:

```typescript
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import schema from "../../../schema";

describe("projections.create with dynamic_retainer subservice", () => {
  it("seeds monthlyAssignments with isManuallyOverridden=true", async () => {
    const t = convexTest(schema);
    const asAdmin = t.withIdentity({
      subject: "user_abc",
      tokenIdentifier: "test|user_abc",
      org_id: "org_test",
      org_role: "org:admin",
    });

    // Seed: service + subservice with defaultPricingModel=dynamic_retainer
    const { clientId, serviceId, subserviceId } = await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: "org_test",
        name: "Test",
        rfc: "XAXX010101000",
        isArchived: false,
      });
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
        defaultPricingModel: "dynamic_retainer",
        isActive: true,
        isDefault: false,
        sortOrder: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return { clientId, serviceId, subserviceId };
    });

    const projectionId = await asAdmin.mutation(api.functions.projections.mutations.create, {
      clientId,
      year: 2026,
      annualSales: 1_200_000,
      totalBudget: 120_000,
      commissionRate: 0,
      seasonalityData: Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        monthlySales: 100_000,
        feFactor: 1,
      })),
      serviceConfigs: [
        {
          serviceId,
          subserviceId,
          chosenPct: 100,
          isActive: true,
        },
      ],
    });

    const cells = await t.run(async (ctx) => {
      return await ctx.db
        .query("monthlyAssignments")
        .withIndex("by_projectionId", (q) => q.eq("projectionId", projectionId))
        .collect();
    });

    expect(cells.length).toBe(12);
    expect(cells.every((c) => c.isManuallyOverridden === true)).toBe(true);
  });
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run convex/functions/projections/__tests__/createDynamicRetainer.test.ts`
Expected: PASS.

- [ ] **Step 6: Run full test suite**

Run: `npm test 2>&1 | tail -5`
Expected: 816 passed | 1 skipped.

- [ ] **Step 7: Commit**

```bash
git add convex/functions/projections/mutations.ts convex/functions/projections/__tests__/createDynamicRetainer.test.ts
git commit -m "feat(projections): inherit pricingModel + seed-then-freeze dynamic_retainer

On create, projectionServices inherits pricingModel from subservice
(or falls back to commission/fixed_retainer per service). dynamic_retainer
rows get all 12 monthlyAssignments flagged isManuallyOverridden=true
immediately — engine recompute will skip them."
```

---

## Task 6: `projections.recalculate` — preservar cells overridas

**Files:**
- Modify: `convex/functions/projections/mutations.ts:400-445`

- [ ] **Step 1: Write the failing test**

Crear `convex/functions/projections/__tests__/recalculatePreservesOverrides.test.ts`:

```typescript
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import schema from "../../../schema";

describe("projections.recalculate preserves overridden cells", () => {
  it("does NOT clobber a cell with isManuallyOverridden=true when annualSales changes", async () => {
    const t = convexTest(schema);
    const asAdmin = t.withIdentity({
      subject: "user_abc",
      tokenIdentifier: "test|user_abc",
      org_id: "org_test",
      org_role: "org:admin",
    });

    // Seed projection with fixed_retainer service
    const { clientId, serviceId, projectionId } = await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: "org_test",
        name: "Test",
        rfc: "XAXX010101000",
        isArchived: false,
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
      return { clientId, serviceId, projectionId: undefined };
    });

    const newProjectionId = await asAdmin.mutation(api.functions.projections.mutations.create, {
      clientId,
      year: 2026,
      annualSales: 1_200_000,
      totalBudget: 120_000,
      commissionRate: 0,
      seasonalityData: Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        monthlySales: 100_000,
        feFactor: 1,
      })),
      serviceConfigs: [{ serviceId, chosenPct: 100, isActive: true }],
    });

    // Override the March cell to 99_000
    const marchCell = await t.run(async (ctx) => {
      const cells = await ctx.db
        .query("monthlyAssignments")
        .withIndex("by_projectionId", (q) => q.eq("projectionId", newProjectionId))
        .collect();
      return cells.find((c) => c.month === 3)!;
    });

    await asAdmin.mutation(api.functions.monthlyAssignments.mutations.updateAmount, {
      id: marchCell._id,
      amount: 99_000,
    });

    // Now recalculate with new annualSales
    await asAdmin.mutation(api.functions.projections.mutations.recalculate, {
      projectionId: newProjectionId,
      annualSales: 2_400_000, // doubled
      totalBudget: 240_000,
      commissionRate: 0,
      seasonalityData: Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        monthlySales: 200_000,
        feFactor: 1,
      })),
    });

    const cellsAfter = await t.run(async (ctx) => {
      return await ctx.db
        .query("monthlyAssignments")
        .withIndex("by_projectionId", (q) => q.eq("projectionId", newProjectionId))
        .collect();
    });

    const marchAfter = cellsAfter.find((c) => c.month === 3);
    expect(marchAfter?.amount).toBe(99_000); // PRESERVED
    expect(marchAfter?.isManuallyOverridden).toBe(true);

    // Other months should have recomputed to 20_000 (240_000 / 12)
    const aprilAfter = cellsAfter.find((c) => c.month === 4);
    expect(aprilAfter?.amount).toBeCloseTo(20_000, 0);
    expect(aprilAfter?.isManuallyOverridden).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/functions/projections/__tests__/recalculatePreservesOverrides.test.ts`
Expected: FAIL — the test will see `marchAfter.amount = 20_000` (clobbered) instead of `99_000`.

- [ ] **Step 3: Modify recalculate orchestration**

En `convex/functions/projections/mutations.ts:414-440`, reemplazar el bloque "Delete existing monthly assignments" + "Recreate monthly assignments" por:

```typescript
      // Read existing monthlyAssignments. Capture overridden cells by month
      // so we can preserve their amount + flag through the recompute.
      const existingMAs = await ctx.db
        .query("monthlyAssignments")
        .withIndex("by_projServiceId", (q) =>
          q.eq("projServiceId", existingPS._id)
        )
        .collect();

      const overrideMap = new Map<number, { amount: number; status: typeof existingMAs[number]["status"]; invoiceStatus: typeof existingMAs[number]["invoiceStatus"]; subserviceId: typeof existingMAs[number]["subserviceId"] }>();
      for (const ma of existingMAs) {
        if (ma.isManuallyOverridden) {
          overrideMap.set(ma.month, {
            amount: ma.amount,
            status: ma.status,
            invoiceStatus: ma.invoiceStatus,
            subserviceId: ma.subserviceId,
          });
        }
      }

      // Delete all existing — we'll recreate using engine output, overlaying
      // overrides where they existed.
      for (const ma of existingMAs) {
        await ctx.db.delete(ma._id);
      }

      // Recreate monthly assignments
      if (svc.isActive) {
        for (const ma of svc.monthlyAmounts) {
          const overridden = overrideMap.get(ma.month);
          await ctx.db.insert("monthlyAssignments", {
            orgId,
            projServiceId: existingPS._id,
            projectionId: args.projectionId,
            clientId: projection.clientId,
            serviceName: svc.serviceName,
            month: ma.month,
            year: projection.year,
            amount: overridden ? overridden.amount : ma.adjustedAmount,
            feFactor: ma.feFactor,
            status: overridden?.status ?? "pending",
            invoiceStatus: overridden?.invoiceStatus ?? "not_invoiced",
            subserviceId: overridden?.subserviceId,
            isManuallyOverridden: !!overridden,
          });
        }
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/functions/projections/__tests__/recalculatePreservesOverrides.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full test suite — check nothing regressed**

Run: `npm test 2>&1 | tail -5`
Expected: 817 passed | 1 skipped.

- [ ] **Step 6: Commit**

```bash
git add convex/functions/projections/mutations.ts convex/functions/projections/__tests__/recalculatePreservesOverrides.test.ts
git commit -m "fix(projections): recalculate preserves cells with isManuallyOverridden

Reads existing monthlyAssignments before delete; for cells with
isManuallyOverridden=true, restores amount + status + invoiceStatus
+ subserviceId after recreate. Fixes the bug where annualSales/seasonality
changes clobbered manual operator edits."
```

---

## Task 7: `changePricingModel` mutation

**Files:**
- Modify: `convex/functions/projectionServices/mutations.ts`
- Create: `convex/functions/projectionServices/__tests__/changePricingModel.test.ts`

- [ ] **Step 1: Write the failing test**

Crear `convex/functions/projectionServices/__tests__/changePricingModel.test.ts`:

```typescript
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import schema from "../../../schema";

describe("projectionServices.changePricingModel", () => {
  async function setup(t: ReturnType<typeof convexTest>) {
    return await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: "org_test",
        name: "Test",
        rfc: "XAXX010101000",
        isArchived: false,
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
      const projServiceId = await ctx.db.insert("projectionServices", {
        orgId: "org_test",
        projectionId,
        serviceId,
        serviceName: "TI",
        chosenPct: 100,
        isActive: true,
        annualAmount: 120_000,
        normalizedWeight: 1,
        pricingModel: "fixed_retainer",
      });
      // Insert 12 cells, none overridden
      for (let m = 1; m <= 12; m++) {
        await ctx.db.insert("monthlyAssignments", {
          orgId: "org_test",
          projServiceId,
          projectionId,
          clientId,
          serviceName: "TI",
          month: m,
          year: 2026,
          amount: 10_000,
          feFactor: 1,
          status: "pending",
          invoiceStatus: "not_invoiced",
          isManuallyOverridden: false,
        });
      }
      return { projServiceId, projectionId };
    });
  }

  it("fixed_retainer → dynamic_retainer flips all cells to isManuallyOverridden=true", async () => {
    const t = convexTest(schema);
    const asAdmin = t.withIdentity({
      subject: "u",
      tokenIdentifier: "t|u",
      org_id: "org_test",
      org_role: "org:admin",
    });
    const { projServiceId, projectionId } = await setup(t);

    await asAdmin.mutation(
      api.functions.projectionServices.mutations.changePricingModel,
      { id: projServiceId, newModel: "dynamic_retainer", confirmReset: true }
    );

    const cells = await t.run(async (ctx) =>
      ctx.db
        .query("monthlyAssignments")
        .withIndex("by_projServiceId", (q) => q.eq("projServiceId", projServiceId))
        .collect()
    );

    expect(cells.every((c) => c.isManuallyOverridden === true)).toBe(true);
    const ps = await t.run(async (ctx) => ctx.db.get(projServiceId));
    expect(ps?.pricingModel).toBe("dynamic_retainer");
  });

  it("dynamic_retainer → fixed_retainer flips all cells to isManuallyOverridden=false", async () => {
    const t = convexTest(schema);
    const asAdmin = t.withIdentity({
      subject: "u",
      tokenIdentifier: "t|u",
      org_id: "org_test",
      org_role: "org:admin",
    });
    const { projServiceId } = await setup(t);

    // Seed all cells overridden + projServiceId = dynamic_retainer
    await t.run(async (ctx) => {
      await ctx.db.patch(projServiceId, { pricingModel: "dynamic_retainer" });
      const cells = await ctx.db
        .query("monthlyAssignments")
        .withIndex("by_projServiceId", (q) => q.eq("projServiceId", projServiceId))
        .collect();
      for (const c of cells) {
        await ctx.db.patch(c._id, { isManuallyOverridden: true });
      }
    });

    await asAdmin.mutation(
      api.functions.projectionServices.mutations.changePricingModel,
      { id: projServiceId, newModel: "fixed_retainer", confirmReset: true }
    );

    const cells = await t.run(async (ctx) =>
      ctx.db
        .query("monthlyAssignments")
        .withIndex("by_projServiceId", (q) => q.eq("projServiceId", projServiceId))
        .collect()
    );
    expect(cells.every((c) => c.isManuallyOverridden === false)).toBe(true);
  });

  it("throws when confirmReset is false", async () => {
    const t = convexTest(schema);
    const asAdmin = t.withIdentity({
      subject: "u",
      tokenIdentifier: "t|u",
      org_id: "org_test",
      org_role: "org:admin",
    });
    const { projServiceId } = await setup(t);

    await expect(
      asAdmin.mutation(
        api.functions.projectionServices.mutations.changePricingModel,
        { id: projServiceId, newModel: "dynamic_retainer", confirmReset: false }
      )
    ).rejects.toThrow(/confirmReset/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/functions/projectionServices/__tests__/changePricingModel.test.ts`
Expected: FAIL — mutation no existe.

- [ ] **Step 3: Add the mutation**

En `convex/functions/projectionServices/mutations.ts` (append al final del file):

```typescript
/**
 * Switch pricingModel of a projectionService row mid-cycle.
 * - newModel = dynamic_retainer  → flip all cells to isManuallyOverridden=true
 *                                  (snapshot freeze of current amounts)
 * - newModel = anything else     → flip all cells to isManuallyOverridden=false
 *                                  (engine will recompute on next recalc)
 *
 * Requires confirmReset=true acknowledgement because cell behavior changes
 * abruptly.
 *
 * Spec: docs/superpowers/specs/2026-05-25-pricing-model-frequency-foundation-design.md §3.2
 */
export const changePricingModel = mutation({
  args: {
    id: v.id("projectionServices"),
    newModel: v.union(
      v.literal("fixed_retainer"),
      v.literal("dynamic_retainer"),
      v.literal("commission"),
      v.literal("one_time")
    ),
    confirmReset: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const orgId = await getOrgId(ctx);
    const ps = await ctx.db.get(args.id);
    if (!ps || ps.orgId !== orgId) throw new Error("No encontrado.");

    if (!args.confirmReset) {
      throw new Error(
        "confirmReset=true requerido — cambiar pricingModel mid-cycle reescribe el comportamiento de las celdas."
      );
    }

    await ctx.db.patch(args.id, { pricingModel: args.newModel });

    const cells = await ctx.db
      .query("monthlyAssignments")
      .withIndex("by_projServiceId", (q) => q.eq("projServiceId", args.id))
      .collect();

    const newFlag = args.newModel === "dynamic_retainer";
    for (const cell of cells) {
      await ctx.db.patch(cell._id, { isManuallyOverridden: newFlag });
    }

    return { ok: true, cellsTouched: cells.length };
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/functions/projectionServices/__tests__/changePricingModel.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run full test suite**

Run: `npm test 2>&1 | tail -5`
Expected: 820 passed | 1 skipped.

- [ ] **Step 6: Commit**

```bash
git add convex/functions/projectionServices/mutations.ts convex/functions/projectionServices/__tests__/changePricingModel.test.ts
git commit -m "feat(projectionServices): changePricingModel switches model + flips cell flags

Switching to dynamic_retainer flags all row cells as overridden
(snapshot freeze of current amounts). Switching to any other model
unflags them (engine recomputes on next recalc). Requires
confirmReset=true acknowledgement."
```

---

## Task 8: Migration mutation + verifyComplete

**Files:**
- Create: `convex/functions/migrations/pricingModel.ts`
- Create: `convex/functions/migrations/__tests__/pricingModel.test.ts`

- [ ] **Step 1: Write the failing test**

Crear `convex/functions/migrations/__tests__/pricingModel.test.ts`:

```typescript
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal } from "../../../_generated/api";
import schema from "../../../schema";

describe("migrations.pricingModel.migrate", () => {
  async function seedFixtures(t: ReturnType<typeof convexTest>) {
    return await t.run(async (ctx) => {
      const svcCommission = await ctx.db.insert("services", {
        orgId: undefined,
        name: "Comisiones",
        type: "base",
        minPct: 0,
        maxPct: 100,
        defaultPct: 5,
        isDefault: true,
        isCommission: true,
        sortOrder: 1,
      });
      const svcTI = await ctx.db.insert("services", {
        orgId: undefined,
        name: "TI",
        type: "base",
        minPct: 0,
        maxPct: 100,
        defaultPct: 30,
        isDefault: true,
        sortOrder: 2,
      });

      const subCom = await ctx.db.insert("subservices", {
        orgId: undefined,
        parentServiceId: svcCommission,
        name: "Sub Comisión",
        slug: "sub-comision",
        defaultFrequency: "mensual",
        isCommission: true,
        isActive: true,
        isDefault: false,
        sortOrder: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const subOneShot = await ctx.db.insert("subservices", {
        orgId: undefined,
        parentServiceId: svcTI,
        name: "Identidad Corporativa",
        slug: "identidad-corporativa",
        defaultFrequency: "una_vez",
        isActive: true,
        isDefault: false,
        sortOrder: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const subNormal = await ctx.db.insert("subservices", {
        orgId: undefined,
        parentServiceId: svcTI,
        name: "Soporte",
        slug: "soporte",
        defaultFrequency: "mensual",
        isActive: true,
        isDefault: false,
        sortOrder: 2,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

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

      const psCom = await ctx.db.insert("projectionServices", {
        orgId: "org_test",
        projectionId,
        serviceId: svcCommission,
        serviceName: "Comisiones",
        subserviceId: subCom,
        chosenPct: 5,
        isActive: true,
        annualAmount: 60000,
        normalizedWeight: 0,
      });
      const psTI = await ctx.db.insert("projectionServices", {
        orgId: "org_test",
        projectionId,
        serviceId: svcTI,
        serviceName: "TI",
        chosenPct: 30,
        isActive: true,
        annualAmount: 36000,
        normalizedWeight: 0.5,
      });

      // 2 cells per service, none with flag set
      for (const psId of [psCom, psTI]) {
        for (const m of [1, 2]) {
          await ctx.db.insert("monthlyAssignments", {
            orgId: "org_test",
            projServiceId: psId,
            projectionId,
            clientId,
            serviceName: "x",
            month: m,
            year: 2026,
            amount: 1000,
            feFactor: 1,
            status: "pending",
            invoiceStatus: "not_invoiced",
          });
        }
      }
      return { subCom, subOneShot, subNormal, psCom, psTI };
    });
  }

  it("dry run reports counts without patching", async () => {
    const t = convexTest(schema);
    await seedFixtures(t);

    const result = await t.mutation(internal.functions.migrations.pricingModel.migrate, {
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.subservices).toBe(3);
    expect(result.projectionServices).toBe(2);
    expect(result.monthlyAssignments).toBe(4);

    // Verify nothing was actually patched
    const subs = await t.run(async (ctx) => ctx.db.query("subservices").collect());
    expect(subs.every((s) => s.defaultPricingModel === undefined)).toBe(true);
  });

  it("apply patches each row with correct derived model", async () => {
    const t = convexTest(schema);
    const { subCom, subOneShot, subNormal, psCom, psTI } = await seedFixtures(t);

    await t.mutation(internal.functions.migrations.pricingModel.migrate, { dryRun: false });

    const subCommission = await t.run(async (ctx) => ctx.db.get(subCom));
    const subOne = await t.run(async (ctx) => ctx.db.get(subOneShot));
    const subN = await t.run(async (ctx) => ctx.db.get(subNormal));
    expect(subCommission?.defaultPricingModel).toBe("commission");
    expect(subOne?.defaultPricingModel).toBe("one_time");
    expect(subN?.defaultPricingModel).toBe("fixed_retainer");

    const psC = await t.run(async (ctx) => ctx.db.get(psCom));
    const psT = await t.run(async (ctx) => ctx.db.get(psTI));
    expect(psC?.pricingModel).toBe("commission");
    expect(psT?.pricingModel).toBe("fixed_retainer"); // no subservice → derives from service.isCommission=false

    const cells = await t.run(async (ctx) => ctx.db.query("monthlyAssignments").collect());
    expect(cells.every((c) => c.isManuallyOverridden === false)).toBe(true);
  });

  it("is idempotent — second run patches 0 rows", async () => {
    const t = convexTest(schema);
    await seedFixtures(t);

    await t.mutation(internal.functions.migrations.pricingModel.migrate, { dryRun: false });
    const second = await t.mutation(internal.functions.migrations.pricingModel.migrate, { dryRun: false });

    expect(second.subservices).toBe(0);
    expect(second.projectionServices).toBe(0);
    expect(second.monthlyAssignments).toBe(0);
  });

  it("verifyComplete returns 0 pending after apply", async () => {
    const t = convexTest(schema);
    await seedFixtures(t);
    await t.mutation(internal.functions.migrations.pricingModel.migrate, { dryRun: false });

    const verify = await t.query(internal.functions.migrations.pricingModel.verifyComplete, {});
    expect(verify.subservicesPending).toBe(0);
    expect(verify.projectionServicesPending).toBe(0);
    expect(verify.cellsPending).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/functions/migrations/__tests__/pricingModel.test.ts`
Expected: FAIL — module no existe.

- [ ] **Step 3: Implement the migration**

Crear `convex/functions/migrations/pricingModel.ts`:

```typescript
import { internalMutation, internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { derivePricingModel, type PricingModel } from "../../lib/pricingModel";

/**
 * One-shot backfill for Sub-spec 0.
 * Idempotent: skips rows that already have the field set.
 * Spec: docs/superpowers/specs/2026-05-25-pricing-model-frequency-foundation-design.md §4
 *
 * Run via: npx convex run functions/migrations/pricingModel:migrate '{"dryRun": false}'
 */
export const migrate = internalMutation({
  args: { dryRun: v.boolean() },
  handler: async (ctx, { dryRun }) => {
    let subCount = 0;
    for await (const sub of ctx.db.query("subservices")) {
      if (sub.defaultPricingModel) continue;
      const model = derivePricingModel({
        isCommission: sub.isCommission,
        defaultFrequency: sub.defaultFrequency,
      });
      if (!dryRun) await ctx.db.patch(sub._id, { defaultPricingModel: model });
      subCount++;
    }

    let projCount = 0;
    for await (const ps of ctx.db.query("projectionServices")) {
      if (ps.pricingModel) continue;
      let model: PricingModel;
      if (ps.subserviceId) {
        const sub = await ctx.db.get(ps.subserviceId);
        model = sub?.defaultPricingModel ?? "fixed_retainer";
      } else {
        const svc = await ctx.db.get(ps.serviceId);
        model = svc?.isCommission ? "commission" : "fixed_retainer";
      }
      if (!dryRun) await ctx.db.patch(ps._id, { pricingModel: model });
      projCount++;
    }

    let cellCount = 0;
    for await (const cell of ctx.db.query("monthlyAssignments")) {
      if (cell.isManuallyOverridden !== undefined) continue;
      if (!dryRun) await ctx.db.patch(cell._id, { isManuallyOverridden: false });
      cellCount++;
    }

    return {
      subservices: subCount,
      projectionServices: projCount,
      monthlyAssignments: cellCount,
      dryRun,
    };
  },
});

export const verifyComplete = internalQuery({
  args: {},
  handler: async (ctx) => {
    let subservicesPending = 0;
    for await (const sub of ctx.db.query("subservices")) {
      if (!sub.defaultPricingModel) subservicesPending++;
    }
    let projectionServicesPending = 0;
    for await (const ps of ctx.db.query("projectionServices")) {
      if (!ps.pricingModel) projectionServicesPending++;
    }
    let cellsPending = 0;
    for await (const cell of ctx.db.query("monthlyAssignments")) {
      if (cell.isManuallyOverridden === undefined) cellsPending++;
    }
    return { subservicesPending, projectionServicesPending, cellsPending };
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/functions/migrations/__tests__/pricingModel.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run full test suite**

Run: `npm test 2>&1 | tail -5`
Expected: 824 passed | 1 skipped.

- [ ] **Step 6: Commit**

```bash
git add convex/functions/migrations/pricingModel.ts convex/functions/migrations/__tests__/pricingModel.test.ts
git commit -m "feat(migrations): add pricingModel backfill + verifyComplete

Idempotent backfill for the 3 new fields. Derivation: commission >
one_time > fixed_retainer for subservices; projectionServices inherit
from subservice or derive from service.isCommission; monthlyAssignments
default to isManuallyOverridden=false. To run:
  npx convex run functions/migrations/pricingModel:migrate '{\"dryRun\": false}'"
```

---

## Task 9: PR1 final — smoke + TypeScript + run backfill in dev

**Files:** ninguno modificado en esta task (verificación + manual)

- [ ] **Step 1: Full test suite + TypeScript**

Run: `npm test 2>&1 | tail -5`
Expected: 824 passed | 1 skipped.

Run: `npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -10`
Expected: Sin errores.

- [ ] **Step 2: Dry-run the migration against dev Convex**

Run: `npx convex run functions/migrations/pricingModel:migrate '{"dryRun": true}'`
Expected output (counts variarán según data actual):
```
{ subservices: 33, projectionServices: ~12, monthlyAssignments: ~144, dryRun: true }
```

- [ ] **Step 3: Apply migration in dev**

Run: `npx convex run functions/migrations/pricingModel:migrate '{"dryRun": false}'`
Expected: same counts, `dryRun: false`.

- [ ] **Step 4: Verify completion**

Run: `npx convex run functions/migrations/pricingModel:verifyComplete '{}'`
Expected: `{ subservicesPending: 0, projectionServicesPending: 0, cellsPending: 0 }`

- [ ] **Step 5: Manual smoke (Christian, browser)**

Abrir `http://localhost:3000` y verificar:

1. Crear projection nueva con cliente Katimi.
2. En la matrix, activar subservicio con `defaultPricingModel="dynamic_retainer"` (uno de los existentes; o crear uno via `/configuracion/subservicios` con ese model).
3. Verificar que las 12 cells aparecen con monto seedado y que `isManuallyOverridden=true` (DevTools network → `_creationTime` cells → verificar field).
4. Editar 1 cell a $99k → guardar.
5. Cambiar annualSales del projection → verificar:
   - cell $99k: NO se mueve.
   - otras cells del row dynamic: NO se mueven.
   - cells de OTROS rows fixed_retainer: SÍ se recomputan.
6. Subservicio de comisiones: cells siguen calculadas como `monthlySales × rate`.

Si algún paso falla, abrir issue + parar antes de Task 10.

- [ ] **Step 6: Wait for explicit OK from Christian before prod deploy**

Per memoria `feedback_no_push_default`: no `git push`, no `convex deploy --prod` sin OK explícito.

Cuando Christian apruebe:
```bash
git push origin main
npx convex deploy
npx convex run --prod functions/migrations/pricingModel:migrate '{"dryRun": true}'
# verificar counts razonables, después:
npx convex run --prod functions/migrations/pricingModel:migrate '{"dryRun": false}'
npx convex run --prod functions/migrations/pricingModel:verifyComplete '{}'
```

---

## Task 10: PR2 — Tighten schema to required

**Files:**
- Modify: `convex/schema.ts` (mismas 3 ubicaciones de Task 2)

**Pre-requisito:** Task 9 step 6 completado en prod. `verifyComplete` returnea `{ 0, 0, 0 }` en prod.

- [ ] **Step 1: Verify migration applied everywhere**

Run: `npx convex run --prod functions/migrations/pricingModel:verifyComplete '{}'`
Expected: `{ subservicesPending: 0, projectionServicesPending: 0, cellsPending: 0 }`

Si NO retorna ceros, no proceder.

- [ ] **Step 2: Remove `v.optional()` from the 3 fields**

En `convex/schema.ts`:

```typescript
// subservices
defaultPricingModel: v.union(
  v.literal("fixed_retainer"),
  v.literal("dynamic_retainer"),
  v.literal("commission"),
  v.literal("one_time")
),

// projectionServices
pricingModel: v.union(
  v.literal("fixed_retainer"),
  v.literal("dynamic_retainer"),
  v.literal("commission"),
  v.literal("one_time")
),

// monthlyAssignments
isManuallyOverridden: v.boolean(),
```

- [ ] **Step 3: Verify schema deploys cleanly**

Run: `npx convex dev --once`
Expected: Schema valida sin errores ("Schema is up to date").

- [ ] **Step 4: Run tests — verify nothing regressed**

Run: `npm test 2>&1 | tail -5`
Expected: 824 passed | 1 skipped (tests no cambian).

Run: `npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -10`
Expected: Sin errores.

- [ ] **Step 5: Remove migration module**

```bash
git rm convex/functions/migrations/pricingModel.ts
git rm convex/functions/migrations/__tests__/pricingModel.test.ts
# Si la carpeta queda vacía:
rmdir convex/functions/migrations/__tests__/ convex/functions/migrations/ 2>/dev/null || true
```

- [ ] **Step 6: Run tests again**

Run: `npm test 2>&1 | tail -5`
Expected: 820 passed | 1 skipped (4 tests menos por borrar migration tests).

- [ ] **Step 7: Commit**

```bash
git add convex/schema.ts
git commit -m "feat(schema): tighten pricingModel fields to required

Backfill verified complete in prod (verifyComplete = 0/0/0). The 3 fields
are now required across subservices.defaultPricingModel,
projectionServices.pricingModel, and monthlyAssignments.isManuallyOverridden.
Removes the internal migration module — no longer needed."
```

- [ ] **Step 8: Deploy** (espera OK explícito de Christian per memoria)

```bash
git push origin main
npx convex deploy
```

---

## Self-review checklist

Antes de marcar plan completo:

- [ ] Cada task tiene 5-7 steps de 2-5 min cada uno.
- [ ] Cada task tiene un commit explícito al final.
- [ ] TDD: failing test → impl → passing test → commit.
- [ ] Sin placeholders ("TBD", "implement later", etc.).
- [ ] Paths exactos en todos los `Files:` headers.
- [ ] Código completo en cada step.
- [ ] Commands con expected output.
- [ ] Cobertura del spec: §1 (overview) → tasks 1-9 PR1, §2 (schema) → tasks 2+10, §3 (engine) → task 3, §4 (migration) → task 8, §5 (testing) → tasks 1/3/4/5/6/7/8 todos con tests TDD, §6 (out-of-scope) → no se implementa nada de eso, §7 (checklist) → tasks 1-10.
