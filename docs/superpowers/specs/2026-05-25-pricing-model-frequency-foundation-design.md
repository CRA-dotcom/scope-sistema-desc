# Pricing Model + Frequency Foundation — Sub-spec 0

**Fecha:** 2026-05-25
**Autor:** Christian (via brainstorming)
**Estado:** 🟢 Spec aprobado — listo para writing-plans
**Origen:** [stub maestro § 3 Sub-spec 0](./2026-05-22-papa-call-scale-pending-detailed-spec.md)
**Bloquea:** Sub-spec 1 (catálogo entregables), Sub-spec 3 (per-service start month), Sub-spec 6 (year-over-year tier)
**Estimado:** 2-3 días impl + ~24h gap entre PR1 y PR2

---

## 1. Overview

Foundation para que Projex modele **4 pricing models** (`fixed_retainer | dynamic_retainer | commission | one_time`) consistentemente entre catálogo, proyecciones y engine — sin cambiar UX existente ni romper proyecciones de test (Katimi, ACME).

### 1.1 Cambios estructurales

- 3 fields nuevos:
  - `subservices.defaultPricingModel` — hint del catálogo.
  - `projectionServices.pricingModel` — verdad operativa por row.
  - `monthlyAssignments.isManuallyOverridden` — flag de protección de overrides.
- Engine respeta `isManuallyOverridden` en TODOS los recomputes (cierra bug actual donde overrides se pierden al cambiar `annualSales` / seasonality).
- Engine ramifica por `pricingModel` per row.

### 1.2 No-goals (explícitos)

- ❌ `yearOverYearTier` → Sub-spec 6.
- ❌ UI nueva para per-cliente override de pricingModel → Sub-spec 3.
- ❌ Cambios en quotation/contract templates → Sub-spec 2.
- ❌ Deprecar `services.isCommission` u `orgConfigs.commissionMode` (compat dual; cleanup post-MVP).

---

## 2. Schema changes

### 2.1 `subservices.defaultPricingModel`

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

- `optional` en PR1 (Fase 1). PR2 (Fase 2) lo vuelve required tras migration.
- Reglas de derivación inicial (Migration §4):
  - `isCommission = true` → `"commission"`
  - `defaultFrequency = "una_vez"` → `"one_time"`
  - Resto → `"fixed_retainer"`

### 2.2 `projectionServices.pricingModel`

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

- Heredado automáticamente de `subservice.defaultPricingModel` en `createProjectionService`.
- Override per-row permitido (caso: "asesoría fiscal" fijo para Cliente A, dinámico para Cliente B).
- Sin UI en Sub-spec 0 — Sub-spec 3 introduce el selector.

### 2.3 `monthlyAssignments.isManuallyOverridden`

```typescript
isManuallyOverridden: v.optional(v.boolean()),
```

- Flippea a `true` cuando:
  - Operador edita vía `updateAmount`.
  - Nuevo `projectionService` se crea con `pricingModel = "dynamic_retainer"` (seed + freeze inmediato).
  - Operador llama `changePricingModel` cambiando a `dynamic_retainer` mid-cycle.
- Flippea a `false` solo vía `changePricingModel` cambiando a un modelo recomputado (`fixed_retainer | commission | one_time`).
- Aplica a TODOS los pricing models, no solo `dynamic_retainer`. Sub-producto: cierra bug actual de overrides perdidos.

### 2.4 Indexes

Ninguno nuevo. Queries que ramifican por pricingModel ya filtran por `projectionId` / `projServiceId`.

---

## 3. Engine behavior

### 3.1 Recompute decision tree

```
Por cada monthlyAssignment cell del row:

1. if cell.isManuallyOverridden === true → SKIP
2. else branch por projectionService.pricingModel:
   - "fixed_retainer"    → amount = annualAmount × (feFactor / sumFE)
   - "dynamic_retainer"  → mismo cálculo SOLO en initial seed (ver 3.2)
   - "commission"        → amount = monthlySales × commissionRate
   - "one_time"          → amount = (month === rowStartMonth) ? annualAmount : 0
```

`sumFE` = suma de feFactor de los meses activos del row (post-fix `49d92aa`). No cambia.

### 3.2 Lifecycle especial — `dynamic_retainer`

| Momento | Acción |
|---|---|
| Crear projectionService con `pricingModel = "dynamic_retainer"` | Engine seed usando formula fixed_retainer + flippea `isManuallyOverridden = true` en TODAS las cells del row inmediatamente |
| Operador edita una cell | `updateAmount` patches `amount`. Flag ya es `true`. |
| Cambio de annualSales / seasonality | Engine recompute — cells dynamic_retainer skippean (flag) |
| `changePricingModel` → `dynamic_retainer` (de otro modelo) | Flippea `isManuallyOverridden = true` en todas las cells del row (snapshot del estado actual) |
| `changePricingModel` ← `dynamic_retainer` (a otro modelo) | Flippea `isManuallyOverridden = false` en todas las cells del row → siguiente recompute las re-genera |

### 3.3 `one_time`

- `startMonth` del row (`projectionServices.startMonth` existente, post-add-on work) = mes del cobro.
- Fallback si no está set: `projection.startMonth` (global del wizard).
- Otros meses: cell existe con `amount = 0` (consistencia con frequency/applicableMonths).

### 3.4 `commission`

- Sin cambios funcionales vs hoy.
- `orgConfigs.commissionMode` (`proportional | fixed_monthly`) se mantiene — controla submodalidad dentro de commission.
- Migration alinea: `service.isCommission ⟺ projectionService.pricingModel === "commission"`.

### 3.5 Engine signature

- `ProjectionInput.services[].pricingModel?: PricingModel` (nuevo, opcional).
- Cada cell `MonthlyAmount` recibe `isManuallyOverridden: boolean` desde la DB. Engine no la deriva.
- `EngineConfig` no cambia.

### 3.6 Touch points

- `convex/lib/projectionEngine.ts` — branch por pricingModel en Step 4-5 (rescaling logic).
- `convex/functions/projections/mutations.ts` — `seedMonthlyAssignments` flippea flag en dynamic_retainer.
- `convex/functions/monthlyAssignments/mutations.ts` — `updateAmount` siempre setea `isManuallyOverridden = true`.
- `convex/functions/projectionServices/mutations.ts` — nueva mutation `changePricingModel(row, newModel, confirmReset)`.

---

## 4. Migration strategy

### 4.1 Plan en 2 fases

| Fase | PR | Cambios |
|---|---|---|
| **Fase 1** | Sub-spec 0 main PR | Schema agrega 3 fields como `optional` + ships migration mutation interna |
| **Fase 2** | Schema tightening (~24h después) | Vuelve los 3 fields a `required`. Solo tras verificar migration aplicada en dev + prod |

Razón: Convex no permite cambiar optional→required en una sola deploy sin paso intermedio que confirme todas las rows tienen valor.

### 4.2 Migration mutation interna

**Path:** `convex/functions/migrations/pricingModel.ts`

```typescript
// internal.migrations.pricingModel.migrate
// Idempotente: skippea rows con field ya seteado.

export const migrate = internalMutation({
  args: { dryRun: v.boolean() },
  handler: async (ctx, { dryRun }) => {
    let subCount = 0, projCount = 0, cellCount = 0;

    // 1. subservices.defaultPricingModel
    for await (const sub of ctx.db.query("subservices")) {
      if (sub.defaultPricingModel) continue;
      const model = derivePricingModel({
        isCommission: sub.isCommission,
        defaultFrequency: sub.defaultFrequency,
      });
      if (!dryRun) await ctx.db.patch(sub._id, { defaultPricingModel: model });
      subCount++;
    }

    // 2. projectionServices.pricingModel
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

    // 3. monthlyAssignments.isManuallyOverridden = false (default)
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
    // Cuenta rows que aún no tienen el field. Esperado 0 post-migration.
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

### 4.3 Derivación inicial

```typescript
function derivePricingModel({ isCommission, defaultFrequency }: {
  isCommission?: boolean;
  defaultFrequency: SubserviceFrequency;
}): PricingModel {
  if (isCommission) return "commission";
  if (defaultFrequency === "una_vez") return "one_time";
  return "fixed_retainer";
}
```

Nadie se mapea a `dynamic_retainer` automáticamente — opt-in del operador.

### 4.4 Procedimiento de ejecución

```bash
# 1. Deploy Fase 1 a dev
npx convex deploy

# 2. Dry run
npx convex run internal:migrations/pricingModel:migrate '{"dryRun": true}'

# 3. Apply
npx convex run internal:migrations/pricingModel:migrate '{"dryRun": false}'

# 4. Verify
npx convex run internal:migrations/pricingModel:verifyComplete '{}'
# → { subservicesPending: 0, projectionServicesPending: 0, cellsPending: 0 }

# 5. (Tras OK explícito de Christian per feedback_no_push_default)
#    Deploy a prod + repeat migration en prod

# 6. Fase 2 PR endurece schema a required + remueve mutation
```

### 4.5 Rollback

- Migration no-destructiva (solo agrega; no sobreescribe data existente).
- Rollback = revert PR. Fields quedan en DB sin uso (Convex ignora fields no declarados, no falla).

### 4.6 Riesgos

| Riesgo | Mitigación |
|---|---|
| Concurrencia durante migration | Ejecutar en ventana sin tráfico (pre-launch, sin tráfico). Si llega a prod después, feature flag que pausa creación. |
| Query timeout en loops (>1024 ops por mutation) | Schema actual ~144 cells, holgado. Cuando volumen crezca (Sub-spec 7), refactor a paginated mutation. |

---

## 5. Testing strategy

### 5.1 Unit tests del engine

**Path:** `convex/lib/__tests__/projectionEngine.pricingModel.test.ts`

| Test | Setup | Expectation |
|---|---|---|
| `fixed_retainer` recompute | annualAmount=120k, FE=[1,1,...,1], sumFE=12 | Cada mes = 10k |
| `fixed_retainer` con `isManuallyOverridden=true` | seed normal + flip 1 cell a 99k+override | engine respeta 99k, recalcula los otros 11 |
| `dynamic_retainer` initial seed | crear row con dynamic_retainer | 12 cells seedadas + todas `isManuallyOverridden=true` |
| `dynamic_retainer` recompute post-cambio annualSales | cambiar annualSales | engine NO toca ninguna cell del row dynamic |
| `commission` recompute | monthlySales=[100k,200k,...], rate=0.05 | Cada mes = monthlySales × 0.05 |
| `commission` con cell overridden | flip 1 cell | engine respeta override (consistencia cross-modelo) |
| `one_time` en startMonth=3, annualAmount=50k | seed | mes 3 = 50k, resto = 0 |
| `one_time` cambio de annualAmount | recompute | mes 3 actualiza, resto sigue 0 |
| Switch `fixed_retainer → dynamic_retainer` | changePricingModel + recompute | snapshot freeze: flag a true, amounts preservan |
| Switch `dynamic_retainer → fixed_retainer` | changePricingModel + recompute | flag a false, engine recomputa con formula |

### 5.2 Integration tests de mutations

**Path:** `convex/functions/projectionServices/__tests__/pricingModel.test.ts`

- `createProjectionService` con subservice `defaultPricingModel="commission"` → hereda.
- `createProjectionService` con override explícito → respeta override.
- `changePricingModel(row, newModel, confirmReset)` → flippea flags per matriz §3.2.
- `updateAmount` siempre setea `isManuallyOverridden = true`.

### 5.3 Migration test

**Path:** `convex/functions/migrations/__tests__/pricingModel.test.ts`

- Fixture: 3 subservicios (commission, una_vez, normal) + 2 projectionServices + 24 cells.
- Dry run → no patches, counts correctos.
- Apply → todos los rows con valor correcto, counts coinciden.
- Apply 2da vez → 0 cambios (idempotente).

### 5.4 Coverage meta

- Baseline: 810 passing.
- Sub-spec 0 agrega: ~19 nuevos.
- Meta post: ~829 passing.

### 5.5 Manual smoke (Christian, browser)

1. Crear projection nueva con Cliente Katimi.
2. Activar subservicio con `defaultPricingModel="dynamic_retainer"` → verificar cells aparecen y editables.
3. Editar 1 cell a $99k → guardar.
4. Cambiar annualSales del projection → verificar cell $99k NO se mueve, otras dynamic NO se mueven, fixed sí recomputan.
5. Subservicio de comisiones → cells siguen = monthlySales × rate.

### 5.6 No-touch (regression risk)

- `selectDeliverableForMonth` (frecuencias aplicables).
- Cron `monthlyAssignmentsRefresh` — verifica que respeta el flag.
- Wizard step 3 (services selection) — sin cambios UI.

---

## 6. Risks + scope boundaries

### 6.1 Riesgos identificados

1. **Engine purity:** engine recibe `isManuallyOverridden` por cell desde DB. Si una mutation no incluye el flag al construir `ProjectionInput`, cells overridas se recomputan. *Mitigación:* test fixture obligatorio que pasa el flag por cada cell.
2. **`commission` doble fuente de verdad:** `service.isCommission` + `projectionService.pricingModel = "commission"`. Si divergen, el engine no sabe a quién creerle. *Mitigación:* migration alinea; assert en dev que `pricingModel === "commission" ⟺ service.isCommission`; failsafe lee `pricingModel`.
3. **Switch mid-cycle de pricing model:** `changePricingModel` cambia semántica de cells generadas. *Mitigación:* arg `confirmReset: true` explícito requerido. UI confirm dialog en Sub-spec 3.
4. **Migration no atómica entre tablas:** §4.6 — pre-launch sin tráfico, no problema; cuando llegue volumen, paginated.

### 6.2 Fuera de scope

| Tema | Vive en | Razón |
|---|---|---|
| UI selector de `pricingModel` per row | Sub-spec 3 | Operador no necesita override per-cliente para MVP |
| `yearOverYearTier` | Sub-spec 6 | Año 2 aún no llega; modelo TBD |
| Cleanup de `services.isCommission` + `orgConfigs.commissionMode` | Post-MVP | Coexisten con `pricingModel`; deprecación = refactor UI + tests |
| Contract templates que dependen de pricingModel | Sub-spec 2 | Contratos por empresa emisora |
| Reportes / dashboard que segmentan por pricingModel | Post-MVP | Útil pero no MVP |

---

## 7. Checklist de implementación (preview)

writing-plans formalizará. Preview:

```
PR1 (Sub-spec 0 main):
  [ ] convex/schema.ts → 3 optional fields
  [ ] convex/lib/projectionEngine.ts → branch por pricingModel + respeta flag
  [ ] convex/functions/projectionServices/mutations.ts → herencia + changePricingModel
  [ ] convex/functions/monthlyAssignments/mutations.ts → updateAmount setea flag
  [ ] convex/functions/migrations/pricingModel.ts → migrate + verifyComplete
  [ ] Tests §5.1-5.3 (~19 nuevos)
  [ ] Smoke E2E (Christian, browser)
  [ ] Verify en dev → OK explícito → deploy prod

PR2 (schema tightening, ~24h después):
  [ ] convex/schema.ts → 3 fields ahora required (no v.optional)
  [ ] Remover internal:migrations/pricingModel
  [ ] Test que validaciones de schema no rompen
```

---

## 8. Decisiones congeladas

- pricingModel en ambas tablas (catálogo `subservices.defaultPricingModel` + ops `projectionServices.pricingModel`).
- 4 modelos: `fixed_retainer | dynamic_retainer | commission | one_time`.
- `isManuallyOverridden` aplica a TODOS los pricing models.
- Migration en 2 fases, no-destructiva.
- `yearOverYearTier` OUT (Sub-spec 6).
- `dynamic_retainer` = seed-then-freeze (cells flagged en creación).

---

## 9. Próximo paso

writing-plans con este spec como contexto. Plan formal por tareas.
