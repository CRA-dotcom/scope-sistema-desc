# Proyecciones — Sub-proyecto B (lógica de servicios) — Design

**Date:** 2026-05-12
**Sprint:** v2 (toward 2026-05-15 demo, friday)
**Owner:** Christian
**Status:** Approved (pending user spec review)

---

## Context

In the 2026-05-12 partner call (after sub-proyecto A wrapped), the partner clarified the intended semantics of the per-service percentage sliders in the wizard's Step 3. Today the slider value (`chosenPct`) is used purely as a normalization weight to distribute the contracted budget across active services. There is no visual reference for "what would the market charge for this service" and no warning when the budget concentration pushes a service above its industry range.

Concretely, in the Catimi-style case (60M annual sales, 10M contract, fiscal 8 months) the partner expects to see:
- The market amount for each service: `chosenPct × annualSales` (e.g. Legal 2% × $60M = $1.2M).
- The budget amount actually allocated to each service: the engine's `annualAmount` (unchanged from current behavior).
- A visual indicator that fires red when `budgetAmount / annualSales > maxPct` for a service, and yellow when below `minPct`.
- A page-level banner telling the operator to add more services when any are red.

Without these signals, the operator has no way to know whether the budget allocation produces a defensible (market-aligned) projection or an artificially concentrated one (e.g. $10M of "Legal" services for a 60M-revenue client = 16.7%, far above the 1-3% legal market range).

## Goals

1. Show, per active non-commission service in Step 3, both the market amount (`chosenPct × annualSales`) and the budget amount (engine's `annualAmount`).
2. Show a per-service market-range indicator: green (within `[minPct, maxPct]`), yellow (below `minPct`), red (above `maxPct`), or hidden (no annual sales). The trigger is the effective percentage of sales the budget represents, not the slider position.
3. Show a banner at the top of Step 3 when at least one active service is red. Advisory, not blocking — the operator can still proceed to Step 4 if the budget is balanced.
4. Extract the per-service row into a dedicated `<ServiceRow>` component for maintainability (nueva/page.tsx is already at the file-size limit).

## Non-Goals

- Changing the engine. `convex/lib/projectionEngine.ts` is untouched. The market-range logic is purely a display concern computed from the existing engine outputs in the front-end allocation helper.
- Unblocking the wizard on red status. The Step 3 → 4 transition still requires `allocation.remaining ≈ 0` and nothing more.
- Sub-proyecto C (seasonality input) and D (templates) — separate specs.
- Refactoring the commission service row. The "= Tasa de comisión" line stays as-is.
- Mobile-specific redesign. The new layout reads on mobile the same way the current row does (vertical stack).

## Scope decisions captured during brainstorming

- **Indicator trigger**: `effectivePctOfSales = budgetAmount / annualSales`. Above `maxPct` → red. Below `minPct` → yellow. Within range → green. Hidden ("n/a") when `annualSales === 0`.
- **Layout**: vertical stack per service card. Slider + percentage on one line, market $ + budget $ + indicator pill on the next.
- **Banner**: persistent at top of Step 3 while any active service is `marketStatus === "above"`. Not blocking the wizard's `Siguiente`.
- **Helper extension**: extend `projection-allocation.ts` (single front-end source of truth) rather than introducing a separate `market-validation.ts`.
- **Component extraction**: split `<ServiceRow>` into `src/components/projections/service-row.tsx` because `nueva/page.tsx` is already large. Bundle `<MarketIndicator>` in the same file to avoid cross-file coupling for a 40-LOC element.
- **Slider remains bound** to `[minPct, maxPct]`. The "out of market" condition arises from budget concentration, not slider position.

---

## Design

### § 1. `projection-allocation.ts` extension

**Files:**
- Modify: `src/lib/projection-allocation.ts`

Extend `AllocationServiceInput`:

```ts
export type AllocationServiceInput = {
  serviceId: string;
  serviceName: string;
  isActive: boolean;
  isCommission: boolean;
  chosenPct: number;
  // 2026-05-12 (sub-proyecto B): market range for the indicator.
  // Both fields optional for back-compat with existing callers; when both
  // are defined AND annualSales > 0, the computed marketStatus is one of
  // "below" | "within" | "above". Otherwise "n/a".
  minPct?: number;
  maxPct?: number;
};
```

Extend `AllocationResult.perService[]`:

```ts
perService: Array<{
  serviceId: string;
  serviceName: string;
  chosenPct: number;
  annualAmount: number;
  // NEW (sub-proyecto B):
  marketAmount: number;         // chosenPct * annualSales
  effectivePctOfSales: number;  // annualAmount / annualSales (0 if sales=0)
  marketStatus: "below" | "within" | "above" | "n/a";
  marketDelta: number;          // magnitude in percentage POINTS, always ≥ 0
                                //   "above":  (effectivePctOfSales - maxPct) * 100
                                //   "below":  (minPct - effectivePctOfSales) * 100
                                //   "within" | "n/a": 0
}>;
```

Update the per-service builder inside `computeServiceAllocation`:

```ts
const marketAmount = service.chosenPct * annualSales;
const effectivePctOfSales = annualSales > 0 ? annualAmount / annualSales : 0;

let marketStatus: "below" | "within" | "above" | "n/a" = "n/a";
let marketDelta = 0;
if (annualSales > 0 && service.minPct !== undefined && service.maxPct !== undefined) {
  if (effectivePctOfSales > service.maxPct) {
    marketStatus = "above";
    marketDelta = (effectivePctOfSales - service.maxPct) * 100;
  } else if (effectivePctOfSales < service.minPct) {
    marketStatus = "below";
    marketDelta = (service.minPct - effectivePctOfSales) * 100;
  } else {
    marketStatus = "within";
    marketDelta = 0;
  }
}
```

Apply the same fields to the `!service.isActive` branch (`marketAmount = 0`, `effectivePctOfSales = 0`, `marketStatus = "n/a"`, `marketDelta = 0`) so the type stays uniform.

### § 2. `<ServiceRow>` + `<MarketIndicator>` component

**Files:**
- Create: `src/components/projections/service-row.tsx` (~150 LOC including both subcomponents and their styles)

`<ServiceRow>` props:

```ts
type ServiceRowProps = {
  service: {
    serviceId: string;
    serviceName: string;
    type: "base" | "comodin";
    minPct: number;
    maxPct: number;
    chosenPct: number;
    isActive: boolean;
    isCommission: boolean;
  };
  allocation: AllocationResult["perService"][number] | null;  // null when service is commission or inactive
  annualSales: number;
  commissionRate: number;
  onToggleActive: (next: boolean) => void;
  onChangePct: (next: number) => void;
};
```

Rendered layout:

```
┌─────────────────────────────────────────────────────────────────────┐
│ [✓] {serviceName}   {Base|Comodín} · Rango: {minPct}% - {maxPct}%   │
│     ──slider────────────── {chosenPct}%                              │
│     Mercado: ${marketAmount}    Presupuesto: ${budgetAmount}   {pill}│
└─────────────────────────────────────────────────────────────────────┘
```

Visibility rules (inside the component):
- `service.isCommission === true`: render only the checkbox (disabled), name, and "= Tasa de comisión ({commissionRate}%)" line. No slider, no $ columns, no indicator.
- `service.isActive === false`: render checkbox + name + range. Greyed (`opacity-50`). No slider, no $ columns, no indicator.
- `service.isActive === true && !isCommission`: render the full layout above.
- `allocation === null || marketStatus === "n/a"`: hide the Mercado column and the indicator pill. Show only Presupuesto.

`<MarketIndicator>` (same file):

```ts
type MarketIndicatorProps = {
  status: "below" | "within" | "above";
  delta: number;        // pp magnitude
  minPct: number;
  maxPct: number;
};
```

Visual states (Tailwind tokens already used elsewhere in the codebase — confirmed during sub-proyecto A `text-red-400` adoption):

| Status | Pill | Tooltip text |
|---|---|---|
| `within` | `🟢 dentro` (text-emerald-500) | "Dentro del rango de mercado ({minPct}-{maxPct}%)." |
| `below` | `🟡 -{delta.toFixed(1)}pp` (text-amber-500) | "Bajo el mínimo de mercado ({minPct}%). El servicio puede recibir poca cobertura." |
| `above` | `🔴 +{delta.toFixed(1)}pp` (text-red-400 — match A) | "Sobre el máximo de mercado ({maxPct}%). Considera agregar más áreas." |

Tooltip mechanism: use the `title` HTML attribute (no new library). On hover, browser shows native tooltip. A future enhancement could swap for a styled tooltip component, deferred to a separate sub-proyecto.

### § 3. Banner + wizard integration

**Files:**
- Modify: `src/app/(dashboard)/proyecciones/nueva/page.tsx`

Two changes to Step 3:

**(a) Replace the inline `.map()` with `<ServiceRow>`:**

```tsx
{serviceStates.map((svc, i) => {
  const svcAllocation = allocation.perService.find(p => p.serviceId === svc.serviceId) ?? null;
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
```

**(b) Add the banner above the service list:**

```tsx
{allocation.perService.some(s => s.marketStatus === "above") && (
  <div className="rounded-lg border border-red-400/40 bg-red-400/5 p-3">
    <p className="text-sm">
      <span className="font-medium">Hay áreas sobre el rango de mercado.</span>{" "}
      Considera agregar o activar más servicios para distribuir mejor el presupuesto.
    </p>
  </div>
)}
```

**(c) Update the `allocation` useMemo call:** the existing `serviceStates.map(...)` projection that builds `AllocationServiceInput` must include `minPct` and `maxPct`:

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

(The `BudgetAllocationWidget` also receives `services`; pass through the same fields for consistency, though the widget itself doesn't use them — type allows undefined.)

The `Siguiente` button's disabled condition remains `Math.abs(allocation.remaining) > 0.01`. Market status is advisory.

### § 4. Tests

**File modified or created:** `src/lib/__tests__/projection-allocation.test.ts` (verify existence; if missing, create using the patterns from `convex/lib/__tests__/projectionEngine.context.test.ts`).

Test cases:

| Case | Setup | Expectation |
|---|---|---|
| `within` rango | 60M sales, 10M budget, Legal chosen 2%, min 1, max 3 | `marketStatus === "within"`, `marketAmount === 1_200_000`, `marketDelta === 0` |
| `above` market | 60M sales, 10M budget, only Legal active chosen 2% min 1 max 3 | `effectivePctOfSales === 10/60 ≈ 16.7%`, `marketStatus === "above"`, `marketDelta ≈ 13.67` (16.67 - 3.0) |
| `below` market | 60M sales, 10M budget, Legal min 1 max 3 chosen 2%, plus 5 other services absorbing most of budget so Legal gets <600K | `effectivePctOfSales < 0.01`, `marketStatus === "below"`, `marketDelta > 0` |
| `n/a` no sales | 0 sales, any | `marketStatus === "n/a"` for every service |
| commission excluded | services include `isCommission: true` | `perService` length excludes commission (existing behavior unchanged) |
| `marketAmount` formula | 60M sales, Legal chosen 2.5% | `marketAmount === 1_500_000` |
| `marketDelta` magnitude is ≥ 0 | any | All cases satisfy `marketDelta >= 0` |

Component tests for `<ServiceRow>` / `<MarketIndicator>` are deferred. The pill/tooltip behavior is verified manually in QA. Add a TODO comment in `service-row.tsx` documenting that component tests are deferred.

**Manual QA**: extend the Sub-proyecto A E2E flow to verify:
1. Catimi 60M / 10M / fiscal mayo → distribute across all 8 services as today → each shows `🟢 dentro` and no banner.
2. Deactivate every service except Legal → Legal absorbs $10M → `🔴 +13.7pp` pill on Legal, banner visible above list.
3. Reactivate services until banner disappears.

---

## Test strategy summary

- Unit tests: 7 new cases in `projection-allocation.test.ts`, covering the four statuses, the marketAmount formula, and the marketDelta magnitude invariant.
- Component tests: deferred (no RTL setup; tests would be brittle for tooltip behavior).
- Manual QA: 3-step browser walkthrough verifying the indicator transitions and banner toggle.

## Risks and open questions

- **R1 — chosenPct interpretation drift**: the slider position is still a normalization weight from the engine's perspective, but the new market indicator reframes it as "% of sales for this service". The two concepts coincide numerically when the active services collectively absorb the contracted budget at their slider weights, but they diverge as budget concentration increases. Operators may set sliders expecting "market %" semantics and be surprised by the budget allocation. Mitigation: the Mercado column makes the $ × ventas reading explicit; if a future sub-proyecto wants to enforce strict "% of sales" semantics, that's an engine change.
- **R2 — Tooltip discoverability**: `title` attribute tooltips don't appear on touch devices and have ~1s hover delay on desktop. Acceptable for advisory copy; if it becomes a friction point, swap for a styled tooltip component.
- **R3 — `chosenPct` outside [minPct, maxPct] via legacy data**: if any existing row has `chosenPct` stored outside its service's current range, the slider clamps but the indicator may still compute `effectivePctOfSales > maxPct`. Expected behavior; no special handling needed.

## Appendix — Files added or modified

**Added:**
- `src/components/projections/service-row.tsx`
- `src/lib/__tests__/projection-allocation.test.ts` (if not already present)

**Modified:**
- `src/lib/projection-allocation.ts` (extended types + computed market fields)
- `src/app/(dashboard)/proyecciones/nueva/page.tsx` (replace inline service `.map()` with `<ServiceRow>`, add banner, pass `minPct`/`maxPct` to allocation helper)
