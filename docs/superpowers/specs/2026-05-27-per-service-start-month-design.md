# Sub-spec 3 — Per-service start month

**Fecha:** 2026-05-27
**Estado:** Diseño (autopilot mode — user authorized blanket approval)
**Origen:** `docs/superpowers/specs/2026-05-22-papa-call-scale-pending-detailed-spec.md` §3 Sub-spec 3
**Estimado impl:** 2-3 días
**Bloquea:** nada

---

## 1. Resumen ejecutivo

Cada servicio en una proyección puede tener su propio `startMonth` (1-12), override de `projection.startMonth`. El engine de proyección filtra los meses anteriores al start del servicio (no aloca monto, no genera entregable). UI matriz muestra `—` con tooltip explicativo. Wizard Step 2 agrega selector inline per-row con default = mes de la proyección.

Caso de uso típico: papá vende paquete de 5 servicios al cliente, pero el servicio "Constitución de empresa" arranca hasta mayo (cuando ya están listos los papeles), mientras que "Contabilidad" arranca en enero como el resto.

## 2. Requirements

- R1. Schema: `projectionServices.startMonth: v.optional(v.number())` (1-12).
- R2. Engine `recalculate` filtra monthly allocations a meses `>= effectiveStartMonth`. `effectiveStartMonth = projService.startMonth ?? projection.startMonth`.
- R3. Pricing model interactions:
  - `fixed_retainer` / `dynamic_retainer` / `commission`: distribuye `annualAmount` proporcional sobre meses elegibles (usando FE existente).
  - `one_time`: concentra `annualAmount` en `effectiveStartMonth` (no en mes 1 si difiere).
- R4. UI Matriz `/proyecciones/[id]`: cells `month < effectiveStartMonth` muestran `—` con tooltip "Inicia mes <effectiveStartMonth>". No editables.
- R5. Wizard Step 2: cada row de servicio tiene selector mes (1-12) con label "Inicia en". Default = `projection.startMonth`. Persistido en `projectionServices.startMonth`.
- R6. Validación: `startMonth` ∈ [1, 12]. Si `> 12` o `< 1` → reject mutation.
- R7. NO se requiere migración (field opcional; rows existentes implícitamente heredan).

## 3. Arquitectura

```
┌──────────────────────────────────────────────────────────┐
│  WIZARD STEP 2                                            │
│    Por cada servicio en la lista:                         │
│      [Nombre] [Monto anual] [Inicia en: mes ▼] ...       │
│    Default: projection.startMonth                         │
└────────────────────────┬─────────────────────────────────┘
                         │ on save
                         ▼
┌──────────────────────────────────────────────────────────┐
│  Mutation                                                  │
│    projectionServices.createOrUpdate                       │
│    persists startMonth                                     │
└────────────────────────┬─────────────────────────────────┘
                         │ on recalculate trigger
                         ▼
┌──────────────────────────────────────────────────────────┐
│  Engine recalculate                                        │
│    effectiveStartMonth = projService.startMonth           │
│                          ?? projection.startMonth         │
│    for each month 1..12:                                  │
│      if month < effectiveStartMonth:                      │
│        cell.amount = 0  (or undefined; engine decides)    │
│      else:                                                │
│        cell.amount = allocateAccordingToPricingModel(...) │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│  UI Matrix                                                 │
│    cells with month < effectiveStartMonth:                │
│      render "—" + tooltip "Inicia mes X"                  │
│      no editable                                          │
│    cells with month >= effectiveStartMonth:               │
│      render amount, editable per pricing model            │
└──────────────────────────────────────────────────────────┘
```

## 4. Schema changes

`projectionServices` — agregar field:

```ts
{
  // ...existing fields
  startMonth: v.optional(v.number()), // 1-12; override of projection.startMonth
}
```

Sin nuevos índices.

## 5. Engine `recalculate`

Modificar la lógica en `convex/lib/projectionEngine.ts` (o equivalente) para que la distribución mensual respete `effectiveStartMonth`:

```ts
const effectiveStartMonth =
  projService.startMonth ?? projection.startMonth;

// Filter the FE seasonality array to only months >= effectiveStartMonth
const eligibleMonths = MONTHS.filter(m => m >= effectiveStartMonth);
const eligibleFE = eligibleMonths.map(m => seasonality[m - 1] ?? 1);
const sumFE = eligibleFE.reduce((a, b) => a + b, 0);

for (let month = 1; month <= 12; month++) {
  if (month < effectiveStartMonth) {
    cells[month - 1] = 0; // pre-start, no amount
    continue;
  }
  // For pricing-model-specific allocation:
  if (pricingModel === "one_time") {
    cells[month - 1] = month === effectiveStartMonth ? annualAmount : 0;
  } else {
    // proportional via FE on eligible months
    const fe = seasonality[month - 1] ?? 1;
    cells[month - 1] = (annualAmount / sumFE) * fe;
  }
}
```

**Important interaction with existing logic:**
- `monthlyAssignments.isManuallyOverridden` (from SS0) takes precedence over engine. So if a cell is manually overridden, engine doesn't touch it.
- For overridden cells in `month < effectiveStartMonth`: the engine doesn't zero them out (admin chose to set value there). Document as: "manual overrides win over startMonth filter".

## 6. UI changes

### 6.1 Wizard Step 2 — service row picker

In the wizard (likely `src/app/(dashboard)/proyecciones/.../wizard/...` — implementer to locate), add a "Inicia en" select to each service row:

```tsx
<select
  value={service.startMonth ?? projection.startMonth}
  onChange={(e) => updateService(idx, { startMonth: Number(e.target.value) })}
>
  {MONTHS.map(m => <option key={m} value={m}>{MONTH_NAMES[m-1]}</option>)}
</select>
```

If `startMonth === projection.startMonth`, store as `undefined` (omit field) to keep schema clean.

### 6.2 Matrix UI — pre-start cells

In `src/app/(dashboard)/proyecciones/[id]/...` matrix component, for each cell at `(serviceRow, month)`:

```tsx
const effectiveStartMonth = serviceRow.startMonth ?? projection.startMonth;
if (month < effectiveStartMonth) {
  return (
    <td title={`Inicia mes ${effectiveStartMonth}`} className="text-gray-400 italic">
      —
    </td>
  );
}
// else render normal cell
```

## 7. Mutations

`projectionServices.update` (or whatever the existing mutation name is) accepts `startMonth` in patch args. Validation:

```ts
if (args.patch.startMonth !== undefined &&
    (args.patch.startMonth < 1 || args.patch.startMonth > 12)) {
  throw new Error("startMonth debe estar entre 1 y 12");
}
```

After update, trigger recalculate of cells for that projService.

## 8. Testing

**Unit (~8 tests):**
- Engine: `recalculate` with `startMonth = 5` skips months 1-4, distributes over 5-12
- Engine: `pricingModel='one_time'` with `startMonth=5` → amount concentrated in month 5
- Engine: `pricingModel='fixed_retainer'` with `startMonth=5` → proportional via FE on 5-12
- Engine: manual override on month 3 (pre-start) is preserved
- Engine: no startMonth set → inherits from projection.startMonth
- Validation: startMonth=13 throws, startMonth=0 throws

**Integration (~3 tests):**
- Update projectionService.startMonth → cells re-calc
- Matrix query returns cells with metadata indicating pre-start months

**UI smoke (manual):**
- Wizard Step 2 shows picker
- Matrix renders `—` in pre-start cells with tooltip

Target: +11 tests (927 → ~938).

## 9. Error handling

- Invalid `startMonth` (out of 1-12) → mutation throws clear error
- Manual override in pre-start cell: preserved (existing isManuallyOverridden flag)
- Pricing model `one_time` with no `startMonth` → falls back to `projection.startMonth` (no change from current behavior)

## 10. Decisiones diferidas

- Per-day start (vs per-month) — overkill, defer
- Per-service END month (early termination) — separate feature, defer
- Visual indicator on row (besides cells) like "🕒 Empieza mayo" — UI polish, defer

## 11. Próximo paso

Plan + ejecución subagent-driven. Sin user input adicional (autopilot).
