# Proyecciones — Sub-proyecto B (servicios + indicador mercado) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-service market-range indicator (green/yellow/red), market $ reference column, and a "considera agregar más áreas" banner to Step 3 of the projection wizard, so operators can see at a glance whether their budget allocation per service is aligned to industry market ranges.

**Architecture:** Three layers, no engine changes. (1) Extend the front-end allocation helper (`projection-allocation.ts`) with `marketAmount`, `effectivePctOfSales`, `marketStatus`, `marketDelta` fields, and align its commission deduction logic with the post-sub-proyecto-A engine. (2) Extract a `<ServiceRow>` + `<MarketIndicator>` component pair. (3) Wire them into the wizard's Step 3 along with a conditional banner.

**Tech Stack:** Next.js 15 App Router, React 19, vitest for tests, Tailwind for styling. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-12-proyecciones-servicios-B-design.md`

---

## File Structure

**Files modified:**
- `src/lib/projection-allocation.ts` — extend `AllocationServiceInput` with `minPct`/`maxPct`; extend `AllocationResult.perService[]` with market fields; align commission logic with engine.
- `src/lib/__tests__/projection-allocation.test.ts` — new market-range test cases.
- `src/app/(dashboard)/proyecciones/nueva/page.tsx` — replace inline service `.map()` with `<ServiceRow>`; add banner; pass `minPct`/`maxPct` to the allocation helper.

**Files created:**
- `src/components/projections/service-row.tsx` — `<ServiceRow>` + `<MarketIndicator>` subcomponents.

---

## Phase 1 — Helper extension (TDD)

### Task 1: Write failing tests for new market fields

**Files:**
- Modify: `src/lib/__tests__/projection-allocation.test.ts` (append new `describe` block at the end of the file)

- [ ] **Step 1: Read the existing file** so the new block slots cleanly

Run: `tail -20 src/lib/__tests__/projection-allocation.test.ts`

Note the closing `});` of the top-level describe and the existing test patterns.

- [ ] **Step 2: Append the new failing tests**

Add at the end of the existing top-level `describe("computeServiceAllocation", ...)` block (i.e. before its closing `});`):

```ts
  describe("market-range indicator fields (sub-proyecto B)", () => {
    it("marketAmount = chosenPct * annualSales", () => {
      const r = computeServiceAllocation(10_000_000, 60_000_000, 0, [
        { serviceId: "a", serviceName: "Legal", isActive: true, isCommission: false, chosenPct: 0.025, minPct: 0.01, maxPct: 0.03 },
      ]);
      const a = r.perService.find((s) => s.serviceId === "a")!;
      expect(a.marketAmount).toBeCloseTo(1_500_000, 2);
    });

    it("status 'within' when effectivePctOfSales is inside [minPct, maxPct]", () => {
      // 10M budget split between Legal (10%) and Marketing (90%) of weights.
      // Legal gets 10M × 0.1 = 1M; effective = 1M / 60M ≈ 1.67% which is in [1%, 3%] for Legal.
      const r = computeServiceAllocation(10_000_000, 60_000_000, 0, [
        { serviceId: "legal", serviceName: "Legal", isActive: true, isCommission: false, chosenPct: 0.1, minPct: 0.01, maxPct: 0.03 },
        { serviceId: "mkt", serviceName: "Marketing", isActive: true, isCommission: false, chosenPct: 0.9, minPct: 0.05, maxPct: 0.15 },
      ]);
      const legal = r.perService.find((s) => s.serviceId === "legal")!;
      expect(legal.marketStatus).toBe("within");
      expect(legal.marketDelta).toBe(0);
    });

    it("status 'above' when effectivePctOfSales > maxPct", () => {
      // Only Legal active → absorbs all 10M. 10M / 60M ≈ 16.67% > maxPct 3%.
      const r = computeServiceAllocation(10_000_000, 60_000_000, 0, [
        { serviceId: "legal", serviceName: "Legal", isActive: true, isCommission: false, chosenPct: 0.02, minPct: 0.01, maxPct: 0.03 },
      ]);
      const legal = r.perService.find((s) => s.serviceId === "legal")!;
      expect(legal.marketStatus).toBe("above");
      // delta = (10/60 - 0.03) × 100 ≈ 13.67 pp
      expect(legal.marketDelta).toBeCloseTo(13.67, 1);
    });

    it("status 'below' when effectivePctOfSales < minPct", () => {
      // Legal has tiny weight relative to Marketing → effective < minPct (1%)
      // Legal 0.001, Marketing 0.999 → Legal gets 10M × 0.001/1 = 10K → 10K/60M ≈ 0.0167% < 1%
      const r = computeServiceAllocation(10_000_000, 60_000_000, 0, [
        { serviceId: "legal", serviceName: "Legal", isActive: true, isCommission: false, chosenPct: 0.001, minPct: 0.01, maxPct: 0.03 },
        { serviceId: "mkt", serviceName: "Marketing", isActive: true, isCommission: false, chosenPct: 0.999, minPct: 0.05, maxPct: 0.15 },
      ]);
      const legal = r.perService.find((s) => s.serviceId === "legal")!;
      expect(legal.marketStatus).toBe("below");
      // delta = (0.01 - 10000/60_000_000) × 100 ≈ 0.983 pp
      expect(legal.marketDelta).toBeCloseTo(0.983, 1);
    });

    it("status 'n/a' when annualSales = 0", () => {
      const r = computeServiceAllocation(10_000_000, 0, 0, [
        { serviceId: "legal", serviceName: "Legal", isActive: true, isCommission: false, chosenPct: 0.02, minPct: 0.01, maxPct: 0.03 },
      ]);
      const legal = r.perService.find((s) => s.serviceId === "legal")!;
      expect(legal.marketStatus).toBe("n/a");
      expect(legal.marketDelta).toBe(0);
      expect(legal.marketAmount).toBe(0);
    });

    it("status 'n/a' when minPct/maxPct are not provided", () => {
      const r = computeServiceAllocation(10_000_000, 60_000_000, 0, [
        { serviceId: "legal", serviceName: "Legal", isActive: true, isCommission: false, chosenPct: 0.02 },
      ]);
      const legal = r.perService.find((s) => s.serviceId === "legal")!;
      expect(legal.marketStatus).toBe("n/a");
    });

    it("inactive services have marketStatus 'n/a' and marketDelta 0", () => {
      const r = computeServiceAllocation(10_000_000, 60_000_000, 0, [
        { serviceId: "a", serviceName: "A", isActive: false, isCommission: false, chosenPct: 0.5, minPct: 0.01, maxPct: 0.03 },
        { serviceId: "b", serviceName: "B", isActive: true, isCommission: false, chosenPct: 0.5, minPct: 0.05, maxPct: 0.15 },
      ]);
      const a = r.perService.find((s) => s.serviceId === "a")!;
      expect(a.marketStatus).toBe("n/a");
      expect(a.marketDelta).toBe(0);
    });

    it("marketDelta is always non-negative", () => {
      const r = computeServiceAllocation(10_000_000, 60_000_000, 0, [
        { serviceId: "a", serviceName: "A", isActive: true, isCommission: false, chosenPct: 0.5, minPct: 0.01, maxPct: 0.03 },
        { serviceId: "b", serviceName: "B", isActive: true, isCommission: false, chosenPct: 0.5, minPct: 0.05, maxPct: 0.15 },
      ]);
      for (const s of r.perService) {
        expect(s.marketDelta).toBeGreaterThanOrEqual(0);
      }
    });

    it("commissions only deduct when active commission service exists (engine-aligned)", () => {
      // commissionRate=0.02, ventas=60M, budget=10M.
      // Sub-proyecto A engine: no active commission service → commissions = 0 → full 10M distributes.
      const r = computeServiceAllocation(10_000_000, 60_000_000, 0.02, [
        { serviceId: "legal", serviceName: "Legal", isActive: true, isCommission: false, chosenPct: 1.0, minPct: 0.01, maxPct: 0.99 },
      ]);
      const legal = r.perService.find((s) => s.serviceId === "legal")!;
      expect(legal.annualAmount).toBeCloseTo(10_000_000, 2);
      expect(r.assigned).toBeCloseTo(10_000_000, 2);
    });
  });
```

- [ ] **Step 3: Run the new tests to confirm they FAIL**

Run: `npx vitest run src/lib/__tests__/projection-allocation.test.ts -t "market-range indicator"`

Expected: all 9 new tests FAIL with errors like "Cannot read properties of undefined (reading 'marketAmount')" or similar — because the helper doesn't compute those fields yet.

- [ ] **Step 4: Do NOT commit yet** (Task 2 implements the logic and commits together)

---

### Task 2: Implement market fields + align commission logic

**Files:**
- Modify: `src/lib/projection-allocation.ts`

- [ ] **Step 1: Extend `AllocationServiceInput` type**

Find the existing type definition (around lines 13-19):

```ts
export type AllocationServiceInput = {
  serviceId: string;
  serviceName: string;
  isActive: boolean;
  isCommission: boolean;
  chosenPct: number; // 0..1
};
```

Replace with:

```ts
export type AllocationServiceInput = {
  serviceId: string;
  serviceName: string;
  isActive: boolean;
  isCommission: boolean;
  chosenPct: number; // 0..1
  // 2026-05-12 (sub-proyecto B): market range for the indicator.
  // Both optional for back-compat; when both defined AND annualSales > 0,
  // computed marketStatus is "below" | "within" | "above". Otherwise "n/a".
  minPct?: number;
  maxPct?: number;
};
```

- [ ] **Step 2: Extend `AllocationResult.perService[]` type**

Find the existing type (around lines 21-32):

```ts
export type AllocationResult = {
  budget: number;
  assigned: number;
  remaining: number;
  marginPct: number | null;
  perService: Array<{
    serviceId: string;
    serviceName: string;
    chosenPct: number;
    annualAmount: number;
  }>;
};
```

Replace the inner `perService` array element shape:

```ts
export type AllocationResult = {
  budget: number;
  assigned: number;
  remaining: number;
  marginPct: number | null;
  perService: Array<{
    serviceId: string;
    serviceName: string;
    chosenPct: number;
    annualAmount: number;
    // NEW (sub-proyecto B):
    marketAmount: number;          // chosenPct × annualSales (0 if sales=0)
    effectivePctOfSales: number;   // annualAmount / annualSales (0 if sales=0)
    marketStatus: "below" | "within" | "above" | "n/a";
    marketDelta: number;           // magnitude in pp, always >= 0
  }>;
};
```

- [ ] **Step 3: Align commission deduction with the engine**

Find (around lines 41-48):

```ts
  // Step 1: Annual commissions (mirrors engine L130 / L167-208)
  // proportional: annualSales × commissionRate
  // fixed_monthly: commissionRate × totalBudget (monthly = rate×budget/12; annual = rate×budget)
  const annualCommissions =
    commissionMode === "fixed_monthly"
      ? commissionRate * budget
      : annualSales * commissionRate;
```

Replace with:

```ts
  // Step 1: Annual commissions — engine-aligned post 2026-05-12 sub-proyecto A.
  // Commissions only deduct when at least one isCommission && isActive service
  // is contracted; otherwise the rate has no effect on the budget.
  const hasActiveCommissionService = services.some(
    (s) => s.isCommission === true && s.isActive
  );
  const annualCommissions = !hasActiveCommissionService
    ? 0
    : commissionMode === "fixed_monthly"
      ? commissionRate * budget
      : annualSales * commissionRate;
```

- [ ] **Step 4: Compute the new market fields per service**

Find the per-service mapper (around lines 62-84):

```ts
  const perService: AllocationResult["perService"] = services
    .filter((service) => !service.isCommission)
    .map((service) => {
    if (!service.isActive) {
      return {
        serviceId: service.serviceId,
        serviceName: service.serviceName,
        chosenPct: service.chosenPct,
        annualAmount: 0,
      };
    }

    // Normal service: weight-based distribution (mirrors engine L237-238)
    const normalizedWeight = totalWeight > 0 ? service.chosenPct / totalWeight : 0;
    const annualAmount = remainingBudget * normalizedWeight;

    return {
      serviceId: service.serviceId,
      serviceName: service.serviceName,
      chosenPct: service.chosenPct,
      annualAmount,
    };
  });
```

Replace with:

```ts
  const perService: AllocationResult["perService"] = services
    .filter((service) => !service.isCommission)
    .map((service) => {
    if (!service.isActive) {
      return {
        serviceId: service.serviceId,
        serviceName: service.serviceName,
        chosenPct: service.chosenPct,
        annualAmount: 0,
        marketAmount: 0,
        effectivePctOfSales: 0,
        marketStatus: "n/a" as const,
        marketDelta: 0,
      };
    }

    // Normal service: weight-based distribution (mirrors engine L237-238)
    const normalizedWeight = totalWeight > 0 ? service.chosenPct / totalWeight : 0;
    const annualAmount = remainingBudget * normalizedWeight;

    const marketAmount = annualSales > 0 ? service.chosenPct * annualSales : 0;
    const effectivePctOfSales = annualSales > 0 ? annualAmount / annualSales : 0;

    let marketStatus: "below" | "within" | "above" | "n/a" = "n/a";
    let marketDelta = 0;
    if (
      annualSales > 0 &&
      service.minPct !== undefined &&
      service.maxPct !== undefined
    ) {
      if (effectivePctOfSales > service.maxPct) {
        marketStatus = "above";
        marketDelta = (effectivePctOfSales - service.maxPct) * 100;
      } else if (effectivePctOfSales < service.minPct) {
        marketStatus = "below";
        marketDelta = (service.minPct - effectivePctOfSales) * 100;
      } else {
        marketStatus = "within";
      }
    }

    return {
      serviceId: service.serviceId,
      serviceName: service.serviceName,
      chosenPct: service.chosenPct,
      annualAmount,
      marketAmount,
      effectivePctOfSales,
      marketStatus,
      marketDelta,
    };
  });
```

- [ ] **Step 5: Run the new tests to verify they PASS**

Run: `npx vitest run src/lib/__tests__/projection-allocation.test.ts -t "market-range indicator"`

Expected: all 9 new tests PASS.

- [ ] **Step 6: Run the full file to check for regressions**

Run: `npx vitest run src/lib/__tests__/projection-allocation.test.ts`

Expected: all tests PASS. If any pre-existing test fails:
- If it asserted `r.assigned === budget` and the test had `commissionRate > 0` WITHOUT an active commission service, the test value needs updating because the new logic no longer deducts. Recompute: `r.assigned` should equal `budget` (without commission carve-out).
- If it asserted per-service amounts based on `remainingBudget = budget - commissions` and the test had no commission service active, recompute against `remainingBudget = budget` (full budget).

Apply minimal edits to make legitimately-affected tests pass with the new semantics.

- [ ] **Step 7: Run the entire suite**

Run: `npm test`

Expected: 313+ tests PASS. If any other test breaks (e.g. wizard tests that use the helper), apply the same value transformations.

- [ ] **Step 8: Commit**

```bash
git add src/lib/projection-allocation.ts src/lib/__tests__/projection-allocation.test.ts
git commit -m "$(cat <<'EOF'
feat(allocation): market-range fields + engine-aligned commission logic

Extends AllocationServiceInput with optional minPct/maxPct and
AllocationResult.perService[] with marketAmount, effectivePctOfSales,
marketStatus ('below'|'within'|'above'|'n/a'), and marketDelta (pp).

Also aligns commission deduction with the post-sub-proyecto-A engine:
commissions only reduce the distributable budget when at least one
isCommission && isActive service is contracted, matching the partner's
2026-05-12 clarification.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — Components

### Task 3: Create `<ServiceRow>` + `<MarketIndicator>`

**Files:**
- Create: `src/components/projections/service-row.tsx`

- [ ] **Step 1: Write the component file**

Write the following to `src/components/projections/service-row.tsx`:

```tsx
"use client";

import { cn, formatCurrency } from "@/lib/utils";
import type { AllocationResult } from "@/lib/projection-allocation";

type ServiceFormState = {
  serviceId: string;
  serviceName: string;
  type: "base" | "comodin";
  minPct: number;
  maxPct: number;
  chosenPct: number;
  isActive: boolean;
  isCommission: boolean;
};

type ServiceRowProps = {
  service: ServiceFormState;
  allocation: AllocationResult["perService"][number] | null;
  annualSales: number;
  commissionRate: number;
  onToggleActive: (next: boolean) => void;
  onChangePct: (next: number) => void;
};

export function ServiceRow({
  service,
  allocation,
  annualSales: _annualSales,
  commissionRate,
  onToggleActive,
  onChangePct,
}: ServiceRowProps) {
  const isFullyActive = service.isActive && !service.isCommission;

  return (
    <div
      className={cn(
        "rounded-md border p-3 transition-colors",
        service.isActive ? "border-accent/30 bg-accent/5" : "border-border opacity-50"
      )}
    >
      {/* Line 1: checkbox + name + range/commission */}
      <div className="flex items-center gap-4">
        <input
          type="checkbox"
          checked={service.isActive}
          onChange={(e) => onToggleActive(e.target.checked)}
          className="accent-accent cursor-pointer"
          disabled={service.isCommission}
        />
        <div className="flex-1">
          <p className="text-sm font-medium">{service.serviceName}</p>
          <p className="text-xs text-muted-foreground">
            {service.type === "base" ? "Base" : "Comodín"} &middot;{" "}
            {service.isCommission
              ? `= Tasa de comisión (${(commissionRate * 100).toFixed(1)}%)`
              : `Rango: ${(service.minPct * 100).toFixed(1)}% - ${(service.maxPct * 100).toFixed(1)}%`}
          </p>
        </div>
      </div>

      {/* Line 2: slider + percentage (only when active + not commission) */}
      {isFullyActive && (
        <div className="mt-2 flex items-center gap-3">
          <input
            type="range"
            min={service.minPct * 100}
            max={service.maxPct * 100}
            step={0.5}
            value={service.chosenPct * 100}
            onChange={(e) => onChangePct(Number(e.target.value) / 100)}
            className="flex-1 accent-accent cursor-pointer"
          />
          <span className="w-14 text-right text-sm font-medium">
            {(service.chosenPct * 100).toFixed(1)}%
          </span>
        </div>
      )}

      {/* Line 3: market$ + budget$ + indicator (only when active + not commission + allocation present) */}
      {isFullyActive && allocation && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {allocation.marketStatus !== "n/a" && (
            <span className="text-muted-foreground">
              Mercado:{" "}
              <span className="font-medium text-foreground">
                {formatCurrency(allocation.marketAmount)}
              </span>
            </span>
          )}
          <span className="text-muted-foreground">
            Presupuesto:{" "}
            <span className="font-medium text-accent">
              {formatCurrency(allocation.annualAmount)}
            </span>
          </span>
          {allocation.marketStatus !== "n/a" && (
            <MarketIndicator
              status={allocation.marketStatus}
              delta={allocation.marketDelta}
              minPct={service.minPct}
              maxPct={service.maxPct}
            />
          )}
        </div>
      )}
    </div>
  );
}

type MarketIndicatorProps = {
  status: "below" | "within" | "above";
  delta: number;
  minPct: number;
  maxPct: number;
};

function MarketIndicator({ status, delta, minPct, maxPct }: MarketIndicatorProps) {
  const minText = `${(minPct * 100).toFixed(1)}%`;
  const maxText = `${(maxPct * 100).toFixed(1)}%`;

  if (status === "within") {
    return (
      <span
        className="text-emerald-500 font-medium"
        title={`Dentro del rango de mercado (${minText} - ${maxText}).`}
      >
        ✓ dentro
      </span>
    );
  }
  if (status === "below") {
    return (
      <span
        className="text-amber-500 font-medium"
        title={`Bajo el mínimo de mercado (${minText}). El servicio puede recibir poca cobertura.`}
      >
        ⚡ -{delta.toFixed(1)}pp
      </span>
    );
  }
  // status === "above"
  return (
    <span
      className="text-red-400 font-medium"
      title={`Sobre el máximo de mercado (${maxText}). Considera agregar más áreas.`}
    >
      ⚠ +{delta.toFixed(1)}pp
    </span>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -5`

Expected: no new errors (pre-existing regex flag errors in test files are unrelated).

- [ ] **Step 3: Do NOT commit yet** (Task 4 wires this in and we commit the wiring + new component together)

---

## Phase 3 — Wizard integration

### Task 4: Wire `<ServiceRow>` into wizard + add banner + pass minPct/maxPct

**Files:**
- Modify: `src/app/(dashboard)/proyecciones/nueva/page.tsx`

- [ ] **Step 1: Add import**

Near the top of `nueva/page.tsx`, find the existing component imports (e.g. `import { SeasonalityChart } from ...`). Add:

```ts
import { ServiceRow } from "@/components/projections/service-row";
```

- [ ] **Step 2: Update the `allocation` useMemo to pass minPct/maxPct**

Find the existing `allocation` useMemo (around lines 176-200). The current `services.map(...)` argument constructs `AllocationServiceInput` without `minPct`/`maxPct`. Replace it:

Find:

```tsx
  const allocation = useMemo(
    () =>
      computeServiceAllocation(
        effectiveBudget,
        annualSales,
        commissionRate,
        serviceStates.map((s) => ({
          serviceId: s.serviceId,
          serviceName: s.serviceName,
          isActive: s.isActive,
          isCommission: s.isCommission,
          chosenPct: s.chosenPct,
        })),
        "proportional"
      ),
    [effectiveBudget, annualSales, commissionRate, serviceStates]
  );
```

Replace with:

```tsx
  const allocation = useMemo(
    () =>
      computeServiceAllocation(
        effectiveBudget,
        annualSales,
        commissionRate,
        serviceStates.map((s) => ({
          serviceId: s.serviceId,
          serviceName: s.serviceName,
          isActive: s.isActive,
          isCommission: s.isCommission,
          chosenPct: s.chosenPct,
          minPct: s.minPct,
          maxPct: s.maxPct,
        })),
        "proportional"
      ),
    [effectiveBudget, annualSales, commissionRate, serviceStates]
  );
```

- [ ] **Step 3: Replace the inline service `.map()` with `<ServiceRow>` + add banner**

Find the Step 3 services block (around lines 579-654). Locate the `<div className="space-y-3">` that wraps the inline `.map()`. The relevant section looks like:

```tsx
              <p className="text-sm text-muted-foreground">
                Configura los servicios activos y sus porcentajes para esta
                proyección.
              </p>
              <div className="space-y-3">
                {serviceStates.map((svc, i) => (
                  <div
                    key={svc.serviceId}
                    className={cn(
                      "flex items-center gap-4 rounded-md border p-3 transition-colors",
                      svc.isActive
                        ? "border-accent/30 bg-accent/5"
                        : "border-border opacity-50"
                    )}
                  >
                    {/* ... ~60 lines of inline rendering: checkbox, name, slider, %, $ ... */}
                  </div>
                ))}
              </div>
```

Replace the entire `<p>...</p>` + `<div className="space-y-3">...</div>` block with:

```tsx
              <p className="text-sm text-muted-foreground">
                Configura los servicios activos y sus porcentajes para esta
                proyección.
              </p>
              {allocation.perService.some((s) => s.marketStatus === "above") && (
                <div className="rounded-lg border border-red-400/40 bg-red-400/5 p-3">
                  <p className="text-sm">
                    <span className="font-medium">Hay áreas sobre el rango de mercado.</span>{" "}
                    Considera agregar o activar más servicios para distribuir
                    mejor el presupuesto.
                  </p>
                </div>
              )}
              <div className="space-y-3">
                {serviceStates.map((svc, i) => {
                  const svcAllocation =
                    allocation.perService.find((p) => p.serviceId === svc.serviceId) ?? null;
                  return (
                    <ServiceRow
                      key={svc.serviceId}
                      service={svc}
                      allocation={svcAllocation}
                      annualSales={annualSales}
                      commissionRate={commissionRate}
                      onToggleActive={(next) => {
                        const updated = [...serviceStates];
                        updated[i] = { ...updated[i], isActive: next };
                        setServiceStates(updated);
                      }}
                      onChangePct={(next) => {
                        const updated = [...serviceStates];
                        updated[i] = { ...updated[i], chosenPct: next };
                        setServiceStates(updated);
                      }}
                    />
                  );
                })}
              </div>
```

(The preceding service-list container `<div className="space-y-4">` and following `<BudgetAllocationWidget>` block remain unchanged.)

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -10`

Expected: no new errors.

- [ ] **Step 5: Run full test suite**

Run: `npm test`

Expected: all tests PASS (313+).

- [ ] **Step 6: Commit**

```bash
git add src/components/projections/service-row.tsx src/app/\(dashboard\)/proyecciones/nueva/page.tsx
git commit -m "$(cat <<'EOF'
feat(wizard): per-service market indicator + advisory banner

Adds <ServiceRow> + <MarketIndicator> components in
src/components/projections/, replacing the inline service-row .map() in
the wizard's Step 3. Each active non-commission service now shows
Mercado $ (chosenPct × ventas), Presupuesto $ (engine allocation), and a
green/yellow/red pill indicating market-range alignment. A persistent
red banner appears at the top of Step 3 when any service is above its
market max, suggesting the operator add more areas.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — Manual QA

### Task 5: Browser walkthrough verifying the indicator transitions

**Files:** None (verification only)

This task does not modify code. It verifies the end-to-end behavior.

- [ ] **Step 1: Start dev servers (or reuse if already running)**

```bash
# Terminal 1
npm run dev

# Terminal 2
npx convex dev
```

Wait for both to be ready. Note the dev URL (likely `http://localhost:3001` if port 3000 is taken by another project).

- [ ] **Step 2: Open the wizard with a fresh Katimi projection**

Open the wizard at `/proyecciones/nueva` (use whatever auth flow the dev environment requires; the agent-browser flow from sub-proyecto A's QA Task is reusable).

In Step 1, configure:
- Cliente: Katimi (or any client with annualRevenue around 60M)
- Año: 2026
- Tasa de Comisión: 2%
- Venta Anual: 60,000,000
- Presupuesto: 10,000,000
- Modo: Contrato año fiscal, Inicio: Mayo

Click Siguiente twice to land on Step 3.

- [ ] **Step 3: Verify the "all green" baseline**

With all default services active, observe:
- Each active non-commission service shows three new pieces: `Mercado: $X`, `Presupuesto: $Y`, and a `✓ dentro` pill (or possibly `⚡ -X.Xpp` for very small services).
- No red banner at the top of the services list.
- The sticky budget widget on the right still says "Asignado $10,000,000 / Restante ✓ Listo".

If any service is `⚠` (above max), note which one — this is OK if the default config has high values.

- [ ] **Step 4: Trigger the "above market" red state**

Deactivate every non-commission service except Legal (toggle the checkboxes). Legal will absorb the full $10M budget.

Observe:
- Legal row shows `Mercado: $1,200,000` (2% × $60M), `Presupuesto: $10,000,000`, and `⚠ +X.Xpp` (red) where X.X ≈ 13.7.
- A persistent red banner appears above the service list: *"Hay áreas sobre el rango de mercado. Considera agregar o activar más servicios..."*

- [ ] **Step 5: Verify the banner disappears as you reactivate**

Reactivate services one by one until no service is `above`. Observe:
- The banner disappears the moment the last `above` service transitions to `within` or `below`.
- The `Siguiente` button stays enabled throughout (banner is advisory, not blocking).

- [ ] **Step 6: Verify the "below" yellow state**

Set Legal's slider to its minimum (1%) and Marketing's slider to its maximum, ensuring active services with high weights starve Legal of budget. If you can construct a state where Legal's effective-pct-of-sales falls below 1%, the indicator should show `⚡ -X.Xpp` (yellow).

This is the hardest state to reach intentionally — the engine's normalization usually keeps each service near its weight. If you can't reach it manually in 1 minute, skip this step (the unit test in Task 1 verifies the math).

- [ ] **Step 7: Verify Step 4 totals still match (sub-proyecto A regression check)**

Click Siguiente to Step 4. Confirm:
- Presupuesto contratado: $10,000,000.00
- Total asignado a servicios: $10,000,000.00 (the post-A commission-fix invariant)
- Monthly totals show 8 months May–Dic, each ≈ $1,250,000.

- [ ] **Step 8: Submit and verify the list reflects the new projection**

Click Crear Proyección. After redirect to detail, navigate to `/proyecciones`. Confirm the new Katimi projection appears at the top.

- [ ] **Step 9: Mark this task complete only if all 8 steps passed**

If any step failed:
- Capture browser DevTools console errors.
- Verify the suspect file's contents on the feature branch.
- File a follow-up task in this plan with the specific failure mode before merging.

---

## Self-Review

(Performed inline by the plan author.)

**Spec coverage:**
- § 1 (helper extension) → Tasks 1, 2.
- § 2 (`<ServiceRow>` + `<MarketIndicator>`) → Task 3.
- § 3 (banner + wizard integration + allocation helper update) → Task 4.
- § 4 (unit tests) → Task 1.
- Risk R1 (chosenPct drift): no separate task, but documented in the spec; manual QA Task 5 Step 4 surfaces it visually.
- Risk R2 (tooltip discoverability): no separate task; native `title` attribute used per spec decision.
- Risk R3 (legacy data): no migration task needed; the indicator gracefully handles `minPct`/`maxPct` mismatches.

**Placeholder scan:** No `TBD`/`TODO`/"implement later" in the plan. Tooltip behavior on touch devices is acknowledged as a known limitation per spec R2, with a future-work note (not in this plan's scope).

**Type consistency:**
- `AllocationServiceInput.minPct?` / `.maxPct?` → consistent between Task 2 Step 1 (type definition) and Task 4 Step 2 (caller passes them).
- `AllocationResult.perService[].marketStatus` literal type `"below" | "within" | "above" | "n/a"` → consistent between Task 2 Step 2 (type), Task 2 Step 4 (assignment), Task 3 Step 1 (`<ServiceRow>` consumes it and `<MarketIndicator>` accepts the 3-state subtype after the "n/a" early return).
- `marketDelta` → defined as ≥ 0 pp magnitude in Task 2; Task 1's invariant test asserts this; Task 3 formats with `.toFixed(1)`.
- `<ServiceRow>` `allocation` prop → typed as `AllocationResult["perService"][number] | null`; Task 4 Step 3 passes either the found entry or `null`.

No inconsistencies found.
