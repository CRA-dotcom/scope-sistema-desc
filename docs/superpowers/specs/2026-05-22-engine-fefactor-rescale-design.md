# Engine: rescalar `monthlyBase` por `sum(feFactor)` (fix Katimi)

**Fecha:** 2026-05-22
**Estado:** propuesto
**Días estimados:** 0.25 (engine fix + 1 test + recalc data)
**Owner:** Christian
**Dependencias:** ninguna; fix self-contained al engine.

---

## 1. Bug observado

Proyección de Katimi (`jx71c2jwm9h62vcax242sctf4186pdg9`, creada 2026-05-14):

- `annualSales`: $66M, `totalBudget`: $5.7M
- Modo fiscal May-Dec (monthCount=8)
- Operador entró ventas mensuales (`unit: "amount"`) que suman $5.7M, no $66M — el sistema convirtió a feFactor relativos a `annualSales/12 = $5.5M`. Resultado: `sum(feFactor in slice) = 1.0363`, no `monthCount=8`.

**Síntoma:** Mayo absorbe `$5,155,909` (90.5% del budget). Otros meses con feFactor > 0 reciben $24k–$110k. Meses con feFactor=0 reciben $0.

**Root cause encadenada:**

1. Operador metió data inconsistente (sum(monthlyAmount) << annualSales). El wizard no valida.
2. Engine Step 5 calcula `monthlyBase = annualAmount / monthCount`, asumiendo `sum(feFactor) ≈ monthCount`. Si no, drift gigante.
3. Engine Step 5b dumpea **todo el drift** en el mes de mayor feFactor (vía `reduce` sin tiebreaker), concentrando todo el monto.

## 2. Fix (engine, no toca wizard)

### 2.1 Step 5 — `monthlyBase` dinámico

`convex/lib/projectionEngine.ts:289-296`

**Antes:**
```ts
const annualAmount = remainingBudget * normalizedWeight;
const monthlyBase = annualAmount / ctx.monthCount;
```

**Después:**
```ts
const annualAmount = remainingBudget * normalizedWeight;
// 2026-05-22: dynamic monthlyBase. Garantiza sum(adjustedAmount) === annualAmount
// independiente de la calibración de feFactor. Si sum(feFactor)≈monthCount (caso
// común), el resultado es matemáticamente idéntico al viejo (annualAmount / monthCount).
// Si sum(feFactor) está calibrado al annualSales/12 con datos inconsistentes (bug
// Katimi 2026-05-22), el factor adaptativo evita concentración patológica.
const sumFE = effectiveSeasonality.reduce((s, m) => s + m.feFactor, 0);
const monthlyBase = sumFE > 0 ? annualAmount / sumFE : annualAmount / ctx.monthCount;
```

Backward compat: cuando `sum(feFactor) === monthCount` (default + casos comunes), `annualAmount / sumFE === annualAmount / monthCount`. Resultados idénticos al engine viejo.

### 2.2 Step 5b — distribución proporcional del drift residual

`convex/lib/projectionEngine.ts:338-349`

**Antes:** loop por servicio que dumpea drift en `heaviestMonth` (max feFactor) via `reduce`.

**Después:** loop por servicio que distribuye drift proporcionalmente al feFactor de cada mes.

```ts
// (2) Drift residual: con el monthlyBase dinámico de Step 5, drift teórico = 0.
// Solo queda drift IEEE 754 (sub-cent). Distribuir proporcional por feFactor
// (no all-to-heaviest) para que ningún mes absorba magnitudes inesperadas.
for (const svc of baseAllocations) {
  if (svc.monthlyAmounts.length === 0) continue;
  const monthlySum = svc.monthlyAmounts.reduce((a, m) => a + m.adjustedAmount, 0);
  const drift = svc.annualAmount - monthlySum;
  if (Math.abs(drift) === 0) continue;
  const svcSumFE = svc.monthlyAmounts.reduce((s, m) => s + m.feFactor, 0);
  if (svcSumFE > 0) {
    for (const m of svc.monthlyAmounts) {
      m.adjustedAmount += drift * (m.feFactor / svcSumFE);
    }
  } else {
    // Defensive: todos los feFactor son 0. Distribuir uniformemente.
    const perMonth = drift / svc.monthlyAmounts.length;
    for (const m of svc.monthlyAmounts) m.adjustedAmount += perMonth;
  }
}
```

## 3. Tests

### 3.1 Test nuevo en `projectionEngine.residual.test.ts`

```ts
it("Katimi 2026-05-22: sum(feFactor in slice) << monthCount no concentra todo en un mes", () => {
  // Reproducción del bug: feFactors calibrados al annualSales/12 cuando las
  // monthlySales reales suman al totalBudget (no al annualSales).
  // sum(feFactor in 8-month slice) ≈ 1.04, no 8.
  const annualSales = 66_000_000;
  const totalBudget = 5_700_000;
  const meanMonthly = annualSales / 12;
  const sliceSales: Record<number, number> = {
    5: 1_500_000,
    6: 850_000,
    7: 1_000_000,
    8: 0,
    9: 950_000,
    10: 600_000,
    11: 0,
    12: 800_000,
  };
  const seasonality = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const sales = sliceSales[month] ?? 0;
    return { month, monthlySales: sales, feFactor: sales / meanMonthly };
  });

  const result = calculateProjection({
    annualSales,
    totalBudget,
    commissionRate: 0,
    services: makeServices(2, [0.3125, 0.6875]), // Legal + TI weights from Katimi
    seasonalityData: seasonality,
    startMonth: 5,
    monthCount: 8,
    projectionMode: "fiscal",
  });

  // Cada servicio: sum(adjustedAmount) === annualAmount.
  for (const svc of result.services) {
    if (svc.normalizedWeight === 0) continue;
    const monthlySum = svc.monthlyAmounts.reduce((a, m) => a + m.adjustedAmount, 0);
    expect(Math.abs(monthlySum - svc.annualAmount)).toBeLessThan(0.01);
  }

  // Ningún mes individual puede tener > 50% del annualAmount de su servicio.
  // (Mayo bug pre-fix: ~90%. Con fix: ~26% como el feFactor sugiere.)
  for (const svc of result.services) {
    if (svc.normalizedWeight === 0) continue;
    for (const m of svc.monthlyAmounts) {
      const share = m.adjustedAmount / svc.annualAmount;
      expect(share, `mes ${m.month} debe ser < 50% del annualAmount de ${svc.serviceName}`).toBeLessThan(0.5);
    }
  }
});
```

## 4. Backfill de datos

La proyección de Katimi tiene `monthlyAssignments.amount` stale (computados con el engine viejo). Necesita `recalculate`.

```bash
npx convex run functions/projections/mutations:recalculate '{"projectionId":"jx71c2jwm9h62vcax242sctf4186pdg9"}'
```

(Si requiere auth, se hace via Convex dashboard manualmente, o se agrega un internal action devtool one-off.)

## 5. Out of scope

- **Validación en el wizard:** si `sum(monthlyAmount)` no se acerca a `annualSales`, warn al operador. Sub-spec separado — el engine fix ya estabiliza el comportamiento aunque la data sea inconsistente.
- **Modo `unit: "amount"` revisión:** la conversión amount→percent del wizard puede tener otro bug. Separado.
- **Aplicar recalculate a todas las proyecciones existentes:** las legacy se quedan con sus valores hasta que alguien las toque. Si se necesita backfill masivo, sub-spec.

## 6. Riesgo

- **Bajo:** cambia el cálculo Step 5 pero mantiene la propiedad `sum(adjustedAmount) === annualAmount`. Tests existentes (`projectionEngine.residual.test.ts`) deben pasar tal cual.
- **Bajo:** Step 5b cambia de "all-to-heaviest" a "proportional". Pasa tests existentes; solo cambia la forma de los centavos residuales.
- **Nulo en producción:** ninguna proyección de prod tiene este patrón salvo Katimi (probable). Si otras tienen, el recalculate las arregla.
