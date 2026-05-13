# Proyecciones — Sub-proyecto C (estacionalidad por outliers) — Design

**Date:** 2026-05-12
**Sprint:** v2 (toward 2026-05-15 demo, friday)
**Owner:** Christian
**Status:** Approved (pending user spec review)

---

## Context

In the 2026-05-12 partner call, the partner asked for a seasonality UX that matches how operators actually think about it: *"yo ya sé que febrero y marzo son meses altos y el otro mes alto creo que es agosto y septiembre... seleccionar el mes y si esos meses aumenta en porcentaje o aumenta en monto."* The remaining months should auto-prorate so the total annual figure stays consistent.

Today the wizard's Step 2 offers a 12-input grid (`SeasonalityDeltaGrid`) where the operator must enter a percent delta for every month, balance the sum manually, and read a deviation warning if they're off. This is the inverse of how operators think — they know the 2-4 outlier months, not the baseline of the other 8-10. The grid forces them to fill in zeros and worry about reconciliation that the system can do for them.

The relevant engine pieces (`seasonalityDataFromDeltas`, `defaultDeltas`, the engine's `seasonalityData: MonthlyData[]` consumption) already support the underlying math. The change is concentrated in the UI layer plus a new helper that does autoprorrateo.

## Goals

1. Replace `SeasonalityDeltaGrid` with an "outlier-driven" UX: 12 selectable month chips at top; for each selected month, render one input row with a value field and a per-row `%` ↔ `$` unit toggle.
2. Auto-prorate the unselected months so the total monthly sales sum equals `annualSales`. Display the resulting monthly amounts as preview text.
3. Allow either sign (positive or negative deltas) on outliers. Render an informational up/down chip based on the sign — no hard distinction in the input.
4. Show an amber warning (non-blocking) when the outlier values consume more than `annualSales` and the autoprorated months would be negative. Operator can continue if the discrepancy is intentional.
5. Persist the outlier list on the projection alongside the existing 12-entry `seasonalityDeltas` array, so the new UI rehydrates correctly while the engine continues to consume the same `MonthlyData[]` shape.

## Non-Goals

- Changing the engine. The engine continues to receive `seasonalityData: MonthlyData[]` (12 entries of `{ month, monthlySales, feFactor }`). All compute happens upstream of the engine call.
- Migrating existing projections. Projections created before this change have only `seasonalityDeltas` and no `seasonalityOutliers`. The wizard's edit/recompute path is out of scope; this spec only covers wizard create. Existing detail pages render unchanged (they read `seasonalityData` from the stored record).
- Refactoring `SeasonalityChart`. It already accepts `MonthlyData[]` directly — works as-is.
- Sub-proyecto D (questionnaire → AI → templates). Separate spec.

## Scope decisions captured during brainstorming

- **Replace, not augment**: the old 12-input grid goes away. `SeasonalityDeltaGrid` becomes dead code and is deleted in this sub-proyecto. `seasonality-chart.tsx` stays.
- **Outliers with signed values**: a single number per selected month, range -100..+200 when expressed as `%`. Sign determines up/down chip. No separate "alto" vs "bajo" mode.
- **Per-row unit toggle**: each outlier row has its own `% ↔ $` switch. The operator can mix (e.g., Feb +30%, Aug +$500K) within one projection.
- **Internal storage is signed percent**: `seasonalityOutliers[].value` is stored as a percentage even when the operator entered an amount. On input toggle from `$` to `%`, the value is converted using the current mean. This keeps the math clean and avoids a second source of truth.
- **Edge-case overshoot**: amber warning + allow continue. Matches today's `SeasonalityDeltaGrid` deviation behavior.
- **Schema is additive**: add optional `seasonalityOutliers` array to `projections`; keep `seasonalityDeltas` for back-compat and for the engine to consume.

---

## Design

### § 1. Schema additive field

**Files:**
- Modify: `convex/schema.ts` (projections table)

Add a new optional field next to `seasonalityDeltas`:

```ts
seasonalityOutliers: v.optional(
  v.array(
    v.object({
      month: v.number(),       // 1-12, unique within array
      value: v.number(),       // signed percent: -100..+200 (stored as percent regardless of UI unit)
      unit: v.union(v.literal("percent"), v.literal("amount")),
                               // operator's last entry mode; UI rehydrates the right toggle state
    })
  )
),
```

`seasonalityMode` literal union grows: extend to `v.union(v.literal("legacy"), v.literal("delta_percent"), v.literal("outliers"))`. New wizard writes `seasonalityMode: "outliers"`. Old projections keep `"legacy"` or `"delta_percent"`.

### § 2. Helper: `seasonalityFromOutliers`

**Files:**
- Modify: `convex/lib/seasonality.ts`

Add a new helper next to `seasonalityDataFromDeltas`:

```ts
export type SeasonalityOutlier = {
  month: number;          // 1-12
  value: number;          // signed percent (the stored representation)
  unit: "percent" | "amount";  // operator's last entry mode (informational only here)
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
```

And a deviation helper (mirrors the existing `seasonalityDeviation` for use in the UI warning):

```ts
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
  // Overshoot if the per-non-outlier amount is negative (or remainingSum < 0 when no non-outliers).
  const overshoots = nonOutlierCount > 0 ? perNonOutlier < 0 : remainingSum < 0;
  return { outlierSum, remainingSum, nonOutlierCount, overshoots };
}
```

### § 3. New UI component: `<SeasonalityOutliersGrid>`

**Files:**
- Create: `src/components/projections/seasonality-outliers-grid.tsx`
- Delete (or empty): `src/components/projections/seasonality-delta-grid.tsx` is deleted as part of this sub-proyecto since the wizard no longer references it. No other consumer.

Props:

```ts
type Props = {
  value: SeasonalityOutlier[];      // current outlier list (sparse, only selected months)
  onChange: (next: SeasonalityOutlier[]) => void;
  annualSales: number;
};
```

Layout (top to bottom):

1. **Header text**:
   > *Marca los meses con estacionalidad atípica. El resto de los meses se prorratean automáticamente para cuadrar con la venta anual.*

2. **Month chip row** — 12 toggleable chips for Ene…Dic. Selected chips are `border-accent bg-accent/10 text-accent`; unselected are `border-border bg-secondary/30 text-muted-foreground`. Clicking a chip toggles its presence in `value` (with a default of `{ value: 0, unit: "percent" }` when adding).

3. **Outlier rows** (one per selected chip, sorted by month):
   ```
   [Mes] [Δ chip 🔼/🔽]  [number input]  [% ↔ $ toggle]   ≈ $X,XXX,XXX/mes
   ```
   - The number input: when unit=`percent`, accepts -100..+200; when unit=`amount`, accepts any positive number.
   - Toggle changes how the input is interpreted. When the operator switches from `%` → `$`, the input value updates to `mean × (1 + storedPercent/100)` (rounded). When they switch `$` → `%`, the input value updates to `((amount / mean) - 1) × 100`. The internal `outliers[].value` stays as signed percent.
   - The 🔼/🔽 chip is informational: shown if `|value| > 0.5%` to avoid noise around zero. Up arrow + green when `value > 0`, down arrow + amber when `value < 0`.
   - Preview line: `≈ {formatCurrency(monthlySales)}/mes`.

4. **Footer summary** (single row):
   ```
   Suma outliers: $X · Cada mes restante: ≈$Y · Total año: $Z {⚠ si overshoot}
   ```
   When `outliersOvershoot(...).overshoots === true`, the row gets an amber background + warning copy:
   > *La suma de tus meses outliers supera la venta anual. Los meses no marcados quedarían en negativo. Ajusta los valores o continúa si la diferencia es intencional.*

5. **`SeasonalityChart`**: continues to render below this component when called with the computed `SeasonalityData[]`. No changes to the chart itself.

### § 4. Wizard integration

**Files:**
- Modify: `src/app/(dashboard)/proyecciones/nueva/page.tsx`

State changes inside `NuevaProyeccionContent`:

```ts
// Replace:
const [seasonalityDeltas, setSeasonalityDeltas] = useState<SeasonalityDelta[]>(defaultDeltas());

// With:
const [seasonalityOutliers, setSeasonalityOutliers] = useState<SeasonalityOutlier[]>([]);
```

The existing `useSeasonality` toggle stays as the entry gate. When `useSeasonality === true`, render `<SeasonalityOutliersGrid value={seasonalityOutliers} onChange={setSeasonalityOutliers} annualSales={annualSales} />` instead of `<SeasonalityDeltaGrid>`.

Computed:

```ts
const seasonalityData = useSeasonality
  ? seasonalityFromOutliers(annualSales, seasonalityOutliers)
  : generateEvenSeasonality(annualSales);
```

`createProjection` mutation payload:

```ts
await createProjection({
  ...existing fields...,
  seasonalityData,
  seasonalityOutliers: useSeasonality ? seasonalityOutliers : undefined,
  seasonalityDeltas: useSeasonality
    ? seasonalityData.map((m) => ({
        month: m.month,
        deltaPercent: ((m.feFactor - 1) * 100),
      }))
    : undefined,
  seasonalityMode: useSeasonality ? "outliers" : "legacy",
  ...existing fields...,
});
```

We continue to write `seasonalityDeltas` (computed from the result) so the engine and the existing detail page consume the same shape. The mutation's existing args validator must accept the new `seasonalityOutliers` field (Convex's optional inheritance keeps the mutation backward compatible).

The wizard draft state (`projectionDrafts.state`) should also include `seasonalityOutliers?` alongside the existing `seasonalityDeltas?`. Schema update in `convex/schema.ts:projectionDrafts.state`.

### § 5. Tests

**File modified or created:** `convex/lib/__tests__/seasonality.test.ts` (verify existence; current file already covers `seasonalityDataFromDeltas`).

Test cases for `seasonalityFromOutliers`:

| Case | Inputs | Expectation |
|---|---|---|
| Catimi-style 4 outliers, all +30% | annualSales=60M, outliers=[(2,+30,%),(3,+30,%),(8,+30,%),(9,+30,%)] | Outlier months show monthlySales=6.5M each; non-outlier months sum to 34M / 8 = 4.25M each; feFactor for non-outlier = 0.85 |
| Empty outliers | annualSales=60M, outliers=[] | All 12 months at 5M, feFactor=1 |
| All 12 months as outliers | annualSales=60M, outliers covers all 12, sum balanced | Each month at its outlier value, feFactor matches |
| Single negative outlier | annualSales=60M, outliers=[(7,-50,%)] | July at 2.5M; other 11 months get (60M-2.5M)/11=5.227M each |
| Overshoot case | annualSales=60M, outliers=[(1,+200,%),(2,+200,%),(3,+200,%),(4,+200,%)] | outlierSum=60M, remainingSum=0, perNonOutlier=0 — engine still runs, UI shows warning (verified separately) |

Test cases for `outliersOvershoot`:

| Case | Expected `overshoots` |
|---|---|
| Empty outliers | false |
| One outlier +50% | false |
| 4 outliers +200% (sum = 60M, perNonOutlier=0) | false (zero is not negative) |
| 4 outliers +300% (sum = 80M, perNonOutlier=-2.5M) | true |
| All 12 outliers summing > annualSales | true |

**Manual QA**: extend the existing browser walkthrough to:
1. Create a fresh projection. Toggle "Aplicar estacionalidad personalizada".
2. Click chips for Feb, Mar, Aug, Sep. Verify 4 input rows appear sorted by month.
3. Enter 30 in each (default unit `%`). Verify each preview shows ~$6.5M, the footer shows `Suma: $26M · Cada mes restante: $4.25M · Total: $60M`.
4. Toggle one row to `$` unit. Verify input value updates to the dollar equivalent. Toggle back to `%` — value returns to the percent.
5. Set one outlier to +300%. Verify amber warning appears and Step 2 still permits "Siguiente".
6. Submit, verify Step 4 monthly totals reflect the outlier distribution.

---

## Test strategy summary

- Unit tests: 10 cases across the two new helpers (`seasonalityFromOutliers` + `outliersOvershoot`).
- Component tests: deferred (same rationale as sub-proyecto B — no RTL setup).
- Manual QA: 6-step browser walkthrough verifying the chip toggle, input modes, overshoot warning, and end-to-end persistence.

## Risks and open questions

- **R1 — Draft round-trip**: the wizard draft persisted in `projectionDrafts` currently stores `seasonalityDeltas` only. After this change the draft also stores `seasonalityOutliers`. If a user resumes an old draft (created before this change), the UI sees no outliers; it should fall back to either rendering the legacy grid for that draft OR converting deltas to outliers (every non-zero month becomes an outlier). Mitigation in scope: on resume, if `seasonalityOutliers` is absent but `seasonalityDeltas` are present and non-uniform, convert deltas to outliers (one outlier per month with `|deltaPercent| > 0.5`).
- **R2 — Rounding when toggling `% ↔ $`**: switching units rounds the displayed input value, which can cause apparent drift between the stored percent and what the operator sees. Acceptable for v1; the canonical value is the percent and the preview text shows the resulting monthly amount with full precision.
- **R3 — Detail-page edit**: the projection detail page may offer a "recalcular" path that uses the old delta grid. After this change, that path is not migrated — operators editing existing projections continue to see the legacy UX. Out of scope for this sub-proyecto; if it becomes a pain point, a follow-up spec aligns the detail-page editor.

## Appendix — Files added or modified

**Added:**
- `src/components/projections/seasonality-outliers-grid.tsx`

**Modified:**
- `convex/schema.ts` (add `seasonalityOutliers` to projections + draft state; extend `seasonalityMode` union)
- `convex/lib/seasonality.ts` (add `SeasonalityOutlier` type + `seasonalityFromOutliers` + `outliersOvershoot` helpers)
- `convex/lib/__tests__/seasonality.test.ts` (add tests for new helpers)
- `convex/functions/projections/mutations.ts` (accept `seasonalityOutliers` argument in `create`; persist on the projection)
- `convex/functions/projectionDrafts/mutations.ts` (accept `seasonalityOutliers` in the draft state validator)
- `src/app/(dashboard)/proyecciones/nueva/page.tsx` (replace `<SeasonalityDeltaGrid>` with `<SeasonalityOutliersGrid>`; swap state; update mutation payload)

**Deleted:**
- `src/components/projections/seasonality-delta-grid.tsx` (dead code after wizard swap)
