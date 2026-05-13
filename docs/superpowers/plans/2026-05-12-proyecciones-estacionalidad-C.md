# Proyecciones — Sub-proyecto C (estacionalidad por outliers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the wizard's 12-input seasonality grid with an outlier-driven UX (12 month chips → select N outliers → enter signed value per outlier in % or $ → remaining months auto-prorate to balance against `annualSales`).

**Architecture:** Three layers, no engine changes. (1) Schema additive: new optional `seasonalityOutliers` field on `projections` and the wizard draft state. (2) New `seasonalityFromOutliers` + `outliersOvershoot` helpers in `convex/lib/seasonality.ts`; existing `seasonalityDataFromDeltas` stays for legacy reads. (3) New `<SeasonalityOutliersGrid>` component replaces the deleted `<SeasonalityDeltaGrid>` in Step 2 of the wizard. The wizard writes both `seasonalityOutliers` (input) and the derived 12-entry `seasonalityDeltas` (engine compatibility).

**Tech Stack:** Convex (DB + functions), Next.js 15 App Router, React 19, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-12-proyecciones-estacionalidad-C-design.md`

---

## File Structure

**Files modified:**
- `convex/schema.ts` — add `seasonalityOutliers` to `projections` + `projectionDrafts.state`; extend `seasonalityMode` union.
- `convex/lib/seasonality.ts` — add `SeasonalityOutlier` type + `seasonalityFromOutliers` + `outliersOvershoot` helpers.
- `convex/lib/__tests__/seasonality.test.ts` — new test cases for both helpers.
- `convex/functions/projections/mutations.ts` — accept `seasonalityOutliers` in `create` args + persist on the projection; extend `seasonalityMode` literal to include `"outliers"`.
- `convex/functions/projectionDrafts/mutations.ts` — accept `seasonalityOutliers` in draft state validator.
- `src/app/(dashboard)/proyecciones/nueva/page.tsx` — replace `<SeasonalityDeltaGrid>` with `<SeasonalityOutliersGrid>`; swap state; update mutation payload; handle draft hydration fallback.

**Files created:**
- `src/components/projections/seasonality-outliers-grid.tsx` — new outlier-driven UI component.

**Files deleted:**
- `src/components/projections/seasonality-delta-grid.tsx` — dead code after wizard swap.

---

## Phase 1 — Schema + helpers (TDD)

### Task 1: Write failing tests for `seasonalityFromOutliers` + `outliersOvershoot`

**Files:**
- Modify: `convex/lib/__tests__/seasonality.test.ts` (append new `describe` blocks at the end of the file)

- [ ] **Step 1: Read the existing file**

Run: `tail -10 convex/lib/__tests__/seasonality.test.ts`

Note the closing `});` of the last describe block.

- [ ] **Step 2: Update the top imports**

Find the imports at the top of the file:

```ts
import {
  seasonalityDataFromDeltas,
  defaultDeltas,
  seasonalitySumImplicit,
  seasonalityDeviation,
} from "../seasonality";
```

Replace with:

```ts
import {
  seasonalityDataFromDeltas,
  defaultDeltas,
  seasonalitySumImplicit,
  seasonalityDeviation,
  seasonalityFromOutliers,
  outliersOvershoot,
  type SeasonalityOutlier,
} from "../seasonality";
```

- [ ] **Step 3: Append the new test blocks**

Add at the END of the file (after the last existing `});`):

```ts
describe("seasonalityFromOutliers (sub-proyecto C)", () => {
  it("empty outliers produces uniform distribution (feFactor=1)", () => {
    const data = seasonalityFromOutliers(60_000_000, []);
    expect(data).toHaveLength(12);
    for (const m of data) {
      expect(m.monthlySales).toBeCloseTo(5_000_000, 2);
      expect(m.feFactor).toBeCloseTo(1, 4);
    }
  });

  it("Catimi-style 4 outliers at +30% balances remaining months", () => {
    const outliers: SeasonalityOutlier[] = [
      { month: 2, value: 30, unit: "percent" },
      { month: 3, value: 30, unit: "percent" },
      { month: 8, value: 30, unit: "percent" },
      { month: 9, value: 30, unit: "percent" },
    ];
    const data = seasonalityFromOutliers(60_000_000, outliers);
    // mean = 5M; outlier months = 5M × 1.3 = 6.5M each; 4 × 6.5M = 26M;
    // remaining = 60M − 26M = 34M, split across 8 months = 4.25M each.
    for (const m of data) {
      const isOutlier = outliers.some((o) => o.month === m.month);
      if (isOutlier) {
        expect(m.monthlySales).toBeCloseTo(6_500_000, 2);
        expect(m.feFactor).toBeCloseTo(1.3, 4);
      } else {
        expect(m.monthlySales).toBeCloseTo(4_250_000, 2);
        expect(m.feFactor).toBeCloseTo(0.85, 4);
      }
    }
    // Sum invariant
    const sum = data.reduce((acc, m) => acc + m.monthlySales, 0);
    expect(sum).toBeCloseTo(60_000_000, 2);
  });

  it("single negative outlier (-50%) balances the other 11 months", () => {
    const outliers: SeasonalityOutlier[] = [
      { month: 7, value: -50, unit: "percent" },
    ];
    const data = seasonalityFromOutliers(60_000_000, outliers);
    const july = data.find((m) => m.month === 7)!;
    expect(july.monthlySales).toBeCloseTo(2_500_000, 2);
    expect(july.feFactor).toBeCloseTo(0.5, 4);
    // Remaining = 60M − 2.5M = 57.5M / 11 ≈ 5_227_272.73
    const other = data.find((m) => m.month === 1)!;
    expect(other.monthlySales).toBeCloseTo(5_227_272.73, 2);
  });

  it("all 12 months as balanced outliers", () => {
    const outliers: SeasonalityOutlier[] = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      value: 0,
      unit: "percent" as const,
    }));
    const data = seasonalityFromOutliers(60_000_000, outliers);
    for (const m of data) {
      expect(m.monthlySales).toBeCloseTo(5_000_000, 2);
    }
  });

  it("overshoot case: outliers consume entire annualSales → remaining months at zero", () => {
    // 4 outliers × +200% = 4 × 15M = 60M total. Remaining 8 months get 0.
    const outliers: SeasonalityOutlier[] = [
      { month: 1, value: 200, unit: "percent" },
      { month: 2, value: 200, unit: "percent" },
      { month: 3, value: 200, unit: "percent" },
      { month: 4, value: 200, unit: "percent" },
    ];
    const data = seasonalityFromOutliers(60_000_000, outliers);
    const jan = data.find((m) => m.month === 1)!;
    expect(jan.monthlySales).toBeCloseTo(15_000_000, 2);
    const may = data.find((m) => m.month === 5)!;
    expect(may.monthlySales).toBeCloseTo(0, 2);
  });

  it("zero annualSales does not divide by zero", () => {
    const data = seasonalityFromOutliers(0, [
      { month: 1, value: 50, unit: "percent" },
    ]);
    for (const m of data) {
      expect(Number.isFinite(m.monthlySales)).toBe(true);
      expect(m.feFactor).toBe(1);
    }
  });
});

describe("outliersOvershoot (sub-proyecto C)", () => {
  it("empty outliers → not overshoot", () => {
    const r = outliersOvershoot(60_000_000, []);
    expect(r.overshoots).toBe(false);
    expect(r.outlierSum).toBe(0);
    expect(r.remainingSum).toBeCloseTo(60_000_000, 2);
    expect(r.nonOutlierCount).toBe(12);
  });

  it("one outlier at +50% → not overshoot", () => {
    const r = outliersOvershoot(60_000_000, [
      { month: 5, value: 50, unit: "percent" },
    ]);
    expect(r.overshoots).toBe(false);
    // outlier = 5M × 1.5 = 7.5M; remaining = 52.5M / 11
    expect(r.outlierSum).toBeCloseTo(7_500_000, 2);
    expect(r.remainingSum).toBeCloseTo(52_500_000, 2);
  });

  it("4 outliers × +200% (sum exactly = annualSales) → not overshoot (zero is allowed)", () => {
    const r = outliersOvershoot(60_000_000, [
      { month: 1, value: 200, unit: "percent" },
      { month: 2, value: 200, unit: "percent" },
      { month: 3, value: 200, unit: "percent" },
      { month: 4, value: 200, unit: "percent" },
    ]);
    expect(r.overshoots).toBe(false);
    expect(r.outlierSum).toBeCloseTo(60_000_000, 2);
  });

  it("4 outliers × +300% (sum > annualSales) → overshoots true", () => {
    const r = outliersOvershoot(60_000_000, [
      { month: 1, value: 300, unit: "percent" },
      { month: 2, value: 300, unit: "percent" },
      { month: 3, value: 300, unit: "percent" },
      { month: 4, value: 300, unit: "percent" },
    ]);
    expect(r.overshoots).toBe(true);
    // outlierSum = 4 × 5M × 4 = 80M; remaining = -20M; perNonOutlier = -2.5M < 0
    expect(r.outlierSum).toBeCloseTo(80_000_000, 2);
  });

  it("all 12 outliers summing > annualSales → overshoots true", () => {
    const outliers: SeasonalityOutlier[] = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      value: 50,
      unit: "percent" as const,
    }));
    const r = outliersOvershoot(60_000_000, outliers);
    // sum = 12 × 7.5M = 90M; nonOutlierCount = 0; remainingSum = -30M → overshoots = true
    expect(r.overshoots).toBe(true);
  });
});
```

- [ ] **Step 4: Run the new tests to confirm they FAIL**

Run: `npx vitest run convex/lib/__tests__/seasonality.test.ts -t "sub-proyecto C"`

Expected: all 11 new tests FAIL — typically with import errors ("seasonalityFromOutliers is not a function" / "outliersOvershoot is not a function" / "SeasonalityOutlier is not exported").

- [ ] **Step 5: Do NOT commit yet** (Task 2 lands the helpers and commits together)

---

### Task 2: Implement `seasonalityFromOutliers` + `outliersOvershoot` + extend schema

**Files:**
- Modify: `convex/lib/seasonality.ts`
- Modify: `convex/schema.ts` (projections + projectionDrafts.state)

- [ ] **Step 1: Add helpers to `convex/lib/seasonality.ts`**

Append at the end of the file (after the existing `seasonalityDeviation` function):

```ts
export type SeasonalityOutlier = {
  month: number;          // 1-12
  value: number;          // signed percent: -100..+200 (stored as percent regardless of UI unit)
  unit: "percent" | "amount";  // operator's last entry mode; informational for UI rehydrate
};

/**
 * Computes monthly sales for all 12 months: outlier months use the explicit
 * `value` (interpreted as signed percent over the mean); remaining months
 * receive the residual budget split evenly.
 *
 * If the outliers' implied sales > annualSales, the non-outlier months may
 * end up at zero or negative monthlySales — the UI surfaces this as a
 * warning; the helper does not clamp. Callers must validate upstream.
 */
export function seasonalityFromOutliers(
  annualSales: number,
  outliers: SeasonalityOutlier[]
): SeasonalityData[] {
  const meanMonthly = annualSales / 12;

  const outlierByMonth = new Map<number, SeasonalityOutlier>();
  for (const o of outliers) outlierByMonth.set(o.month, o);

  // Step 1: compute monthlySales for outlier months.
  const outlierMonthlySales = new Map<number, number>();
  let outlierSum = 0;
  for (const o of outliers) {
    const monthlySales = meanMonthly * (1 + o.value / 100);
    outlierMonthlySales.set(o.month, monthlySales);
    outlierSum += monthlySales;
  }

  // Step 2: residual budget for non-outlier months.
  const remainingSum = annualSales - outlierSum;
  const nonOutlierCount = 12 - outliers.length;
  const perNonOutlier = nonOutlierCount > 0 ? remainingSum / nonOutlierCount : 0;

  // Step 3: build the 12-entry array.
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const monthlySales = outlierMonthlySales.has(month)
      ? outlierMonthlySales.get(month)!
      : perNonOutlier;
    return {
      month,
      monthlySales,
      feFactor: meanMonthly > 0 ? monthlySales / meanMonthly : 1,
    };
  });
}

/**
 * Detects whether the outliers consume more than annualSales,
 * which would force non-outlier months into negative monthlySales.
 */
export function outliersOvershoot(
  annualSales: number,
  outliers: SeasonalityOutlier[]
): { outlierSum: number; remainingSum: number; nonOutlierCount: number; overshoots: boolean } {
  const meanMonthly = annualSales / 12;
  const outlierSum = outliers.reduce(
    (acc, o) => acc + meanMonthly * (1 + o.value / 100),
    0
  );
  const remainingSum = annualSales - outlierSum;
  const nonOutlierCount = 12 - outliers.length;
  const perNonOutlier = nonOutlierCount > 0 ? remainingSum / nonOutlierCount : 0;
  // Overshoot when the per-non-outlier value would be negative (or
  // remainingSum < 0 when no non-outliers).
  const overshoots = nonOutlierCount > 0 ? perNonOutlier < 0 : remainingSum < 0;
  return { outlierSum, remainingSum, nonOutlierCount, overshoots };
}
```

- [ ] **Step 2: Extend the projection schema in `convex/schema.ts`**

Find the `seasonalityMode` field (around line 68-70):

```ts
    seasonalityMode: v.optional(
      v.union(v.literal("legacy"), v.literal("delta_percent"))
    ),
```

Replace with:

```ts
    seasonalityMode: v.optional(
      v.union(
        v.literal("legacy"),
        v.literal("delta_percent"),
        v.literal("outliers")
      )
    ),
    seasonalityOutliers: v.optional(
      v.array(
        v.object({
          month: v.number(),
          value: v.number(),
          unit: v.union(v.literal("percent"), v.literal("amount")),
        })
      )
    ),
```

(Order in the schema: keep `seasonalityMode` where it is, insert `seasonalityOutliers` directly after.)

- [ ] **Step 3: Extend the `projectionDrafts.state` validator**

Still in `convex/schema.ts`, find the `projectionDrafts.state` object (around lines 94-130 — `state: v.object({ ... })`). Find:

```ts
      seasonalityDeltas: v.optional(
        v.array(
          v.object({
            month: v.number(),
            deltaPercent: v.number(),
          })
        )
      ),
```

Add immediately after (still inside the `state.v.object({...})`):

```ts
      seasonalityOutliers: v.optional(
        v.array(
          v.object({
            month: v.number(),
            value: v.number(),
            unit: v.union(v.literal("percent"), v.literal("amount")),
          })
        )
      ),
```

- [ ] **Step 4: Validate the schema via Convex codegen**

Run: `npx convex dev --once`

Expected: success; `_generated/api.d.ts` and `_generated/dataModel.d.ts` updated.

If Convex errors on schema validation, re-read the diff and ensure no missing commas/parens.

- [ ] **Step 5: Run the new tests to verify they PASS**

Run: `npx vitest run convex/lib/__tests__/seasonality.test.ts -t "sub-proyecto C"`

Expected: all 11 new tests PASS.

- [ ] **Step 6: Run the full suite**

Run: `npm test`

Expected: 322+ tests PASS (313 + 9 sub-proyecto B + 11 sub-proyecto C = 333+).

- [ ] **Step 7: Commit Phase 1**

```bash
git add convex/lib/seasonality.ts convex/lib/__tests__/seasonality.test.ts convex/schema.ts convex/_generated/
git commit -m "$(cat <<'EOF'
feat(seasonality): outlier-driven seasonality helpers + schema additive

Adds seasonalityFromOutliers(annualSales, outliers) and outliersOvershoot
helpers in convex/lib/seasonality.ts. Outliers carry a signed percent value
and a unit hint ('percent' | 'amount'); non-outlier months are auto-prorated
to balance against annualSales. Schema additive: projections gain optional
seasonalityOutliers field and seasonalityMode union extends with 'outliers';
projectionDrafts.state mirrors the field for resume support.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — Component

### Task 3: Create `<SeasonalityOutliersGrid>` and delete the old grid

**Files:**
- Create: `src/components/projections/seasonality-outliers-grid.tsx`
- Delete: `src/components/projections/seasonality-delta-grid.tsx`

- [ ] **Step 1: Write the new component file**

Write the following to `src/components/projections/seasonality-outliers-grid.tsx`:

```tsx
"use client";

// TODO: component tests deferred — preview + chip behavior is verified manually
// in QA (see plan C Task 5). Re-enable once React Testing Library is configured.

import { useMemo } from "react";
import {
  type SeasonalityOutlier,
  outliersOvershoot,
  seasonalityFromOutliers,
} from "convex/lib/seasonality";
import { cn, formatCurrency } from "@/lib/utils";

const MONTH_NAMES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

type Props = {
  value: SeasonalityOutlier[];
  onChange: (next: SeasonalityOutlier[]) => void;
  annualSales: number;
};

export function SeasonalityOutliersGrid({ value, onChange, annualSales }: Props) {
  const meanMonthly = annualSales / 12;
  const overshoot = useMemo(
    () => outliersOvershoot(annualSales, value),
    [annualSales, value]
  );
  const monthlyData = useMemo(
    () => seasonalityFromOutliers(annualSales, value),
    [annualSales, value]
  );

  const selectedMonths = new Set(value.map((v) => v.month));
  const sortedOutliers = [...value].sort((a, b) => a.month - b.month);

  function toggleMonth(month: number) {
    if (selectedMonths.has(month)) {
      onChange(value.filter((v) => v.month !== month));
    } else {
      onChange([...value, { month, value: 0, unit: "percent" }]);
    }
  }

  function updateOutlier(month: number, patch: Partial<SeasonalityOutlier>) {
    onChange(value.map((v) => (v.month === month ? { ...v, ...patch } : v)));
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Marca los meses con estacionalidad atípica. El resto de los meses se
        prorratean automáticamente para cuadrar con la venta anual.
      </p>

      {/* Month chip row */}
      <div className="flex flex-wrap gap-2">
        {MONTH_NAMES.map((name, i) => {
          const month = i + 1;
          const selected = selectedMonths.has(month);
          return (
            <button
              key={month}
              type="button"
              onClick={() => toggleMonth(month)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium border transition-colors cursor-pointer",
                selected
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border bg-secondary/30 text-muted-foreground hover:bg-secondary"
              )}
            >
              {name}
            </button>
          );
        })}
      </div>

      {/* Outlier rows */}
      {sortedOutliers.length > 0 && (
        <div className="space-y-2 rounded-md border border-border bg-secondary/20 p-3">
          {sortedOutliers.map((o) => {
            const monthlySales =
              monthlyData.find((m) => m.month === o.month)?.monthlySales ?? 0;
            // Display value: in percent unit, show the stored signed percent;
            // in amount unit, show the corresponding monthlySales as an absolute amount.
            const displayValue =
              o.unit === "percent" ? o.value : Math.round(monthlySales);
            const isPositive = o.value > 0.5;
            const isNegative = o.value < -0.5;

            return (
              <div
                key={o.month}
                className="flex items-center gap-3 flex-wrap"
              >
                <span className="w-10 text-sm font-medium">
                  {MONTH_NAMES[o.month - 1]}
                </span>
                {isPositive && (
                  <span className="text-xs text-emerald-500">🔼</span>
                )}
                {isNegative && (
                  <span className="text-xs text-amber-500">🔽</span>
                )}
                {!isPositive && !isNegative && (
                  <span className="text-xs text-muted-foreground">•</span>
                )}
                <input
                  type="number"
                  step={o.unit === "percent" ? 1 : 10000}
                  value={displayValue}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    if (o.unit === "percent") {
                      updateOutlier(o.month, { value: raw });
                    } else {
                      // amount → signed percent
                      const nextPct =
                        meanMonthly > 0 ? ((raw / meanMonthly) - 1) * 100 : 0;
                      updateOutlier(o.month, { value: nextPct });
                    }
                  }}
                  className="w-32 rounded-md border border-border bg-secondary px-2 py-1 text-sm focus:border-accent focus:outline-none"
                />
                <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
                  <button
                    type="button"
                    onClick={() => updateOutlier(o.month, { unit: "percent" })}
                    className={cn(
                      "px-2 py-1 cursor-pointer transition-colors",
                      o.unit === "percent"
                        ? "bg-accent/20 text-accent"
                        : "text-muted-foreground hover:bg-secondary"
                    )}
                  >
                    %
                  </button>
                  <button
                    type="button"
                    onClick={() => updateOutlier(o.month, { unit: "amount" })}
                    className={cn(
                      "px-2 py-1 cursor-pointer transition-colors",
                      o.unit === "amount"
                        ? "bg-accent/20 text-accent"
                        : "text-muted-foreground hover:bg-secondary"
                    )}
                  >
                    $
                  </button>
                </div>
                <span className="text-xs text-muted-foreground">
                  ≈ {formatCurrency(monthlySales)}/mes
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer summary */}
      <div
        className={cn(
          "rounded-md border p-3 text-sm",
          overshoot.overshoots
            ? "border-amber-500/40 bg-amber-500/5"
            : "border-border bg-secondary/30"
        )}
      >
        <div className="grid grid-cols-3 gap-2">
          <div>
            <p className="text-xs text-muted-foreground">Suma outliers</p>
            <p className="font-medium">{formatCurrency(overshoot.outlierSum)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Cada mes restante</p>
            <p className="font-medium">
              {overshoot.nonOutlierCount > 0
                ? formatCurrency(overshoot.remainingSum / overshoot.nonOutlierCount)
                : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total año</p>
            <p className="font-medium">{formatCurrency(annualSales)}</p>
          </div>
        </div>
        {overshoot.overshoots && (
          <p className="mt-2 text-xs text-amber-600">
            ⚠ La suma de tus meses outliers supera la venta anual. Los meses no
            marcados quedarían en negativo. Ajusta los valores o continúa si la
            diferencia es intencional.
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Delete the old grid file**

Run:

```bash
rm src/components/projections/seasonality-delta-grid.tsx
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -10`

Expected: the wizard `nueva/page.tsx` will fail because it still imports `SeasonalityDeltaGrid` from the now-deleted file. This is expected — Task 4 fixes the import. Capture the exact error names so Task 4 verifies the same errors disappear.

Example expected error:
```
src/app/(dashboard)/proyecciones/nueva/page.tsx(14,10): error TS2305: Module '"@/components/projections/seasonality-delta-grid"' has no exported member 'SeasonalityDeltaGrid'.
```
(or a "Cannot find module" variant)

- [ ] **Step 4: Do NOT commit yet** (Task 4 wires the new component in and we commit Phase 2 + Phase 3 together)

---

## Phase 3 — Wizard integration

### Task 4: Replace `<SeasonalityDeltaGrid>` with `<SeasonalityOutliersGrid>` + update mutation payloads + draft hydration

**Files:**
- Modify: `src/app/(dashboard)/proyecciones/nueva/page.tsx`
- Modify: `convex/functions/projections/mutations.ts`
- Modify: `convex/functions/projectionDrafts/mutations.ts`

- [ ] **Step 1: Update wizard imports**

In `src/app/(dashboard)/proyecciones/nueva/page.tsx`, find:

```ts
import { SeasonalityChart } from "@/components/projections/seasonality-chart";
import { BudgetAllocationWidget } from "@/components/projections/budget-allocation-widget";
import { SeasonalityDeltaGrid } from "@/components/projections/seasonality-delta-grid";
```

Replace with:

```ts
import { SeasonalityChart } from "@/components/projections/seasonality-chart";
import { BudgetAllocationWidget } from "@/components/projections/budget-allocation-widget";
import { SeasonalityOutliersGrid } from "@/components/projections/seasonality-outliers-grid";
```

Then find:

```ts
import {
  type SeasonalityDelta,
  seasonalityDataFromDeltas,
  defaultDeltas,
} from "convex/lib/seasonality";
```

Replace with:

```ts
import {
  type SeasonalityDelta,
  type SeasonalityOutlier,
  seasonalityDataFromDeltas,
  seasonalityFromOutliers,
  defaultDeltas,
} from "convex/lib/seasonality";
```

(`SeasonalityDelta` import stays — still used for the rehydration fallback in Step 4 of this task.)

- [ ] **Step 2: Swap wizard state**

Find:

```ts
  // Step 2: Seasonality deltas
  const [seasonalityDeltas, setSeasonalityDeltas] = useState<SeasonalityDelta[]>(defaultDeltas());
  const [useSeasonality, setUseSeasonality] = useState(false);
```

Replace with:

```ts
  // Step 2: Seasonality outliers (sub-proyecto C)
  const [seasonalityOutliers, setSeasonalityOutliers] = useState<SeasonalityOutlier[]>([]);
  const [useSeasonality, setUseSeasonality] = useState(false);
```

- [ ] **Step 3: Update the live `seasonalityData` computation**

Find:

```ts
  // Calculate preview
  const seasonalityData = useSeasonality
    ? seasonalityDataFromDeltas(annualSales, seasonalityDeltas)
    : generateEvenSeasonality(annualSales);
```

Replace with:

```ts
  // Calculate preview
  const seasonalityData = useSeasonality
    ? seasonalityFromOutliers(annualSales, seasonalityOutliers)
    : generateEvenSeasonality(annualSales);
```

- [ ] **Step 4: Update draft hydration fallback (R1 mitigation)**

Find the `hydrateFromDraft` function (search for `function hydrateFromDraft`). It currently sets `seasonalityDeltas`. Replace the relevant block with the outlier-aware version.

Find:

```ts
    if (s.seasonalityDeltas !== undefined) setSeasonalityDeltas(s.seasonalityDeltas);
```

Replace with:

```ts
    // Sub-proyecto C: prefer the new outliers field if present.
    // For legacy drafts (only seasonalityDeltas present), derive outliers from
    // months with |deltaPercent| > 0.5 (the same threshold used in the chip UI).
    if (s.seasonalityOutliers !== undefined) {
      setSeasonalityOutliers(s.seasonalityOutliers);
    } else if (s.seasonalityDeltas !== undefined) {
      const derived: SeasonalityOutlier[] = s.seasonalityDeltas
        .filter((d) => Math.abs(d.deltaPercent) > 0.5)
        .map((d) => ({
          month: d.month,
          value: d.deltaPercent,
          unit: "percent" as const,
        }));
      setSeasonalityOutliers(derived);
    }
```

- [ ] **Step 5: Update `saveDraft` to write outliers**

Find the `saveDraft` `useCallback` (search for `const saveDraft = useCallback`). Inside the `state:` object, find:

```ts
            seasonalityDeltas,
```

Replace with:

```ts
            seasonalityOutliers,
```

The wizard state no longer carries `seasonalityDeltas` (it's recomputed on submit). Remove the corresponding entry from the `useCallback` deps array:

Find in the deps array:
```ts
      seasonalityDeltas,
```

Replace with:
```ts
      seasonalityOutliers,
```

- [ ] **Step 6: Replace the Step 2 render of `<SeasonalityDeltaGrid>`**

Find the Step 2 JSX block. Locate:

```tsx
                {useSeasonality ? (
                  <SeasonalityDeltaGrid
                    value={seasonalityDeltas}
                    onChange={setSeasonalityDeltas}
                    annualSales={annualSales}
                  />
                ) : (
```

Replace with:

```tsx
                {useSeasonality ? (
                  <SeasonalityOutliersGrid
                    value={seasonalityOutliers}
                    onChange={setSeasonalityOutliers}
                    annualSales={annualSales}
                  />
                ) : (
```

- [ ] **Step 7: Update `handleSubmit` mutation payload**

Find the `createProjection({ ... })` call inside `handleSubmit`. The current payload has:

```ts
        seasonalityData,
        seasonalityDeltas: useSeasonality ? seasonalityDeltas : undefined,
        seasonalityMode: useSeasonality ? "delta_percent" : "legacy",
```

Replace with:

```ts
        seasonalityData,
        seasonalityOutliers: useSeasonality ? seasonalityOutliers : undefined,
        // Derive the legacy 12-entry deltas from the computed seasonalityData so
        // the engine and any non-outlier consumers see the same shape they always have.
        seasonalityDeltas: useSeasonality
          ? seasonalityData.map((m) => ({
              month: m.month,
              deltaPercent: (m.feFactor - 1) * 100,
            }))
          : undefined,
        seasonalityMode: useSeasonality ? "outliers" : "legacy",
```

- [ ] **Step 8: Update the `create` mutation server-side**

In `convex/functions/projections/mutations.ts`, find the `create` mutation's `args` declaration. Find the existing `seasonalityMode` and `seasonalityDeltas` args (they should already be defined). Add a new optional arg next to them:

After:

```ts
    seasonalityMode: v.optional(
      v.union(v.literal("legacy"), v.literal("delta_percent"))
    ),
```

Replace that whole block with:

```ts
    seasonalityMode: v.optional(
      v.union(
        v.literal("legacy"),
        v.literal("delta_percent"),
        v.literal("outliers")
      )
    ),
    seasonalityOutliers: v.optional(
      v.array(
        v.object({
          month: v.number(),
          value: v.number(),
          unit: v.union(v.literal("percent"), v.literal("amount")),
        })
      )
    ),
```

Then find the `ctx.db.insert("projections", { ... })` call inside the same handler. Find the existing `seasonalityMode` line:

```ts
      seasonalityMode: args.seasonalityMode ?? (args.seasonalityDeltas ? "delta_percent" : "legacy"),
```

Replace with:

```ts
      seasonalityMode:
        args.seasonalityMode ??
        (args.seasonalityOutliers
          ? "outliers"
          : args.seasonalityDeltas
            ? "delta_percent"
            : "legacy"),
      seasonalityOutliers: args.seasonalityOutliers,
```

- [ ] **Step 9: Update the `upsertDraft` mutation server-side**

In `convex/functions/projectionDrafts/mutations.ts`, find the `stateValidator` object. Find:

```ts
  seasonalityDeltas: v.optional(
    v.array(
      v.object({
        month: v.number(),
        deltaPercent: v.number(),
      })
    )
  ),
```

Add immediately after:

```ts
  seasonalityOutliers: v.optional(
    v.array(
      v.object({
        month: v.number(),
        value: v.number(),
        unit: v.union(v.literal("percent"), v.literal("amount")),
      })
    )
  ),
```

- [ ] **Step 10: Regenerate Convex API types**

Run: `npx convex dev --once`

Expected: success; `_generated` files updated to include the new args.

- [ ] **Step 11: Verify TypeScript compiles cleanly**

Run: `npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -10`

Expected: no new errors. The errors from Task 3 Step 3 (missing `SeasonalityDeltaGrid` import) should be gone.

- [ ] **Step 12: Run the full test suite**

Run: `npm test`

Expected: all tests PASS (333+).

- [ ] **Step 13: Commit Phase 2 + Phase 3**

```bash
git add src/components/projections/seasonality-outliers-grid.tsx src/app/\(dashboard\)/proyecciones/nueva/page.tsx convex/functions/projections/mutations.ts convex/functions/projectionDrafts/mutations.ts convex/_generated/
git add -u src/components/projections/seasonality-delta-grid.tsx
git commit -m "$(cat <<'EOF'
feat(wizard): outlier-driven seasonality UI + mutation plumbing

Adds <SeasonalityOutliersGrid> in src/components/projections/. Step 2 of
the wizard now renders 12 togglable month chips; for each selected month,
an input row with a per-row %/$ unit toggle and a live preview of the
resulting monthly amount. Non-outlier months auto-prorate; a footer
shows the totals and an amber warning fires when outliers consume more
than annualSales.

Removes the obsolete <SeasonalityDeltaGrid> component. Draft hydration
falls back to deriving outliers from legacy deltas (any month with
|deltaPercent| > 0.5 becomes an outlier).

Mutation plumbing: projections.create and projectionDrafts.upsertDraft
accept the new optional seasonalityOutliers arg; seasonalityMode union
extends with 'outliers'. The engine continues to consume the same
12-entry seasonalityDeltas shape (computed from the outliers on submit).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — Manual QA

### Task 5: Browser walkthrough verifying the new seasonality UX

**Files:** None (verification only)

This task verifies the end-to-end behavior. Reuses the agent-browser flow established in sub-proyecto A's Task 20 and reused in sub-proyecto B's Task 5.

- [ ] **Step 1: Ensure dev servers are running**

```bash
# Terminal 1 — if not already running
npm run dev

# Terminal 2 — if not already running
npx convex dev
```

Note the URL (likely `http://localhost:3001`).

- [ ] **Step 2: Open the wizard and configure Step 1**

In the existing logged-in Chrome session (`/tmp/projex-e2e-chrome` profile), open `/proyecciones/nueva`. Configure Step 1:
- Cliente: Katimi
- Año: 2026
- Tasa de Comisión: 2%
- Venta Anual: 60,000,000
- Presupuesto: 10,000,000
- Modo: Contrato año fiscal, Inicio: Mayo

Click Siguiente to land on Step 2.

- [ ] **Step 3: Toggle the seasonality feature**

Check the "Aplicar estacionalidad personalizada" checkbox.

Observe:
- 12 month chips appear (Ene–Dic), all unselected (`border-border bg-secondary/30`).
- No outlier rows yet.
- Footer shows: `Suma outliers: $0 · Cada mes restante: $5,000,000 · Total año: $60,000,000` (no amber).

- [ ] **Step 4: Select 4 Catimi outliers at +30%**

Click chips Feb, Mar, Ago, Sep. Observe:
- The 4 chips turn `border-accent bg-accent/10 text-accent`.
- 4 outlier rows appear in a bordered container, sorted by month.
- Each row defaults to value=0, unit=`%`, preview `≈ $5,000,000/mes`, no up/down arrow chip.

Type `30` in each of the 4 inputs. Observe:
- Each preview updates to `≈ $6,500,000/mes`.
- Each row gets a 🔼 chip.
- Footer updates: `Suma outliers: $26,000,000 · Cada mes restante: $4,250,000 · Total año: $60,000,000` (no amber).

- [ ] **Step 5: Verify the unit toggle**

On the Feb row, click the `$` toggle. Observe:
- Input value flips to `6500000` (the monthly amount).
- Preview stays at `≈ $6,500,000/mes`.
- Footer stays consistent.

Click back to `%`. Observe: input returns to `30`.

- [ ] **Step 6: Trigger the overshoot warning**

Change all 4 outlier values to `300` (in `%` mode). Observe:
- Each row preview shows `≈ $20,000,000/mes`.
- Each row has 🔼 chip.
- Footer turns amber and shows `Suma outliers: $80,000,000 · Cada mes restante: $-2,500,000 · Total año: $60,000,000` plus the amber warning copy below.
- The Siguiente button stays enabled (warning is non-blocking).

- [ ] **Step 7: Back off the warning + continue**

Reset all values to `30`. Confirm amber warning disappears. Click Siguiente.

- [ ] **Step 8: Verify Step 4 reflects the outliers**

Skip through Step 3 (services). On Step 4 (Revisión), check the Totales Mensuales:
- Feb/Mar/Ago/Sep: each ≈ $1,250,000 / month (allocated proportionally per the engine — exact value depends on the active services and fiscal mode).
- Other months: lower (proportional to the lower monthlySales).
- Total Asignado matches Presupuesto contratado (sub-proyecto A invariant preserved).

(Note: the Totales Mensuales are SERVICE budget per month, not the seasonality monthly sales. The seasonality affects how the budget is *weighted* across months via feFactor.)

Submit. Verify the projection appears in `/proyecciones` (sub-proyecto A's Bug 2 invariant).

- [ ] **Step 9: Verify draft round-trip with the new outliers**

Open `/proyecciones/nueva`. Pick Katimi. Begin Step 2, toggle seasonality, select Feb +30% and Mar +30%. Click Siguiente to advance to Step 3 (this autosaves the draft).

Click "Volver" → navigate away → return to `/proyecciones/nueva`. Select Katimi again. Confirm the banner appears. Click "Continuar borrador". Observe:
- Step 2 reloads with Feb and Mar chips selected.
- Each row shows value `30`, unit `%`, preview `$6,500,000/mes`.

- [ ] **Step 10: Verify legacy fallback (optional, manual setup required)**

If there's an existing draft from before this change (with `seasonalityDeltas` non-uniform but no `seasonalityOutliers`), resuming it should auto-derive outliers from non-zero deltas. This step is optional because creating a legacy draft requires manually editing the DB or skipping this validation.

- [ ] **Step 11: Mark task complete only if Steps 3–9 passed**

If any step failed:
- Capture browser DevTools console errors.
- Verify the affected source file matches the plan.
- File a follow-up task with the specific failure mode before merging.

---

## Self-Review

(Performed inline by the plan author.)

**Spec coverage:**
- § 1 (schema additive) → Task 2 Steps 2-4.
- § 2 (`seasonalityFromOutliers` + `outliersOvershoot`) → Task 2 Steps 1, 5.
- § 3 (`<SeasonalityOutliersGrid>`) → Task 3 Step 1.
- § 4 (wizard integration + mutation payload + draft round-trip) → Task 4 Steps 1-11.
- § 5 (tests) → Task 1.
- R1 (draft round-trip): explicit fallback in Task 4 Step 4.
- R2 (rounding when toggling): documented in spec; UI implementation uses `Math.round` in Task 3 Step 1 when computing the amount-mode display from the stored percent.
- R3 (detail-page edit): out of scope, noted in spec only.

**Placeholder scan:** No `TBD`/`TODO`/"implement later" in plan steps. The `// TODO: component tests deferred` comment in `seasonality-outliers-grid.tsx` is a documented deferral matching the sub-proyecto B precedent.

**Type consistency:**
- `SeasonalityOutlier.value` (number) → consistent everywhere (Task 1 tests, Task 2 helper, Task 3 component, Task 4 mutation args, schema additive field).
- `SeasonalityOutlier.unit` literal union `"percent" | "amount"` → consistent everywhere.
- `seasonalityFromOutliers` signature `(annualSales: number, outliers: SeasonalityOutlier[]) => SeasonalityData[]` → consistent in helper definition (Task 2) and consumer (Task 3, Task 4).
- `outliersOvershoot` return shape `{ outlierSum, remainingSum, nonOutlierCount, overshoots }` → consistent in helper (Task 2) and consumer (Task 3 footer).

No inconsistencies found.
