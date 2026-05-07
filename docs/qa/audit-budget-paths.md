# Audit: annualSales vs totalBudget en flujo de proyección

**Fecha:** 2026-05-06
**Contexto:** Bug reportado — preview del wizard `/proyecciones/nueva` muestra distribución sobre 31.2M (annualSales) cuando debería ser 24M (totalBudget). Engine de Convex está correcto; bug está en frontend o paths secundarios.

## Regla canónica

- `effectiveBudget ?? totalBudget` = base de distribución de servicios y residual mensual.
- `annualSales + seasonality` = base para FE. FE modula distribución mensual dentro de cada servicio (sin afectar el total contratado).

## Tabla

| # | Path | Línea | Uso actual | ¿Correcto? | Acción |
|---|---|---|---|---|---|
| 1 | `convex/lib/projectionEngine.ts` | 130 | `annualCommissions = annualSales * commissionRate` | ✅ correcto | — |
| 2 | `convex/lib/projectionEngine.ts` | 133 | `remainingBudget = totalBudget - annualCommissions` | ✅ correcto | — |
| 3 | `convex/lib/projectionEngine.ts` | 169 | `fixedMonthly = commissionRate * totalBudget / 12` (commissionMode=fixed_monthly) | ⚠️ discutible | En modo fixed_monthly la comisión se calcula sobre totalBudget, no sobre annualSales. Es coherente con el diseño del modo, pero es semánticamente diferente al modo proporcional. No es un ❌ de distribución, pero amerita nota en Fase C. |
| 4 | `convex/lib/projectionEngine.ts` | 238 | `annualAmount = remainingBudget * normalizedWeight` | ✅ correcto | — |
| 5 | `convex/lib/projectionEngine.ts` | 81 | `calculateFeFactor`: `monthlyAvg = annualSales / 12` | ✅ correcto | annualSales es la base correcta para FE |
| 6 | `convex/lib/projectionEngine.ts` | 96 | `generateSeasonalityData`: pasa `annualSales` a `calculateFeFactor` | ✅ correcto | — |
| 7 | `convex/lib/projectionEngine.ts` | 104 | `generateEvenSeasonality`: `monthly = annualSales / 12` | ✅ correcto | FE base para distribución uniforme |
| 8 | `convex/lib/projectionEngine.ts` | 292–300 | `validateServiceLimits`: `pctOfRevenue = service.annualAmount / annualSales` | ✅ correcto | Valida que el monto asignado no exceda % de la venta anual, uso semántico correcto |
| 9 | `convex/lib/projectionEngine.ts` | 38–39 | Definición tipo `ProjectionInput` con `annualSales` y `totalBudget` | info (definition) | — |
| 10 | `src/app/(dashboard)/proyecciones/nueva/page.tsx` | 68–69 | `useState(annualSales)` / `useState(totalBudget)` — inicialización de estado | info (definition) | — |
| 11 | `src/app/(dashboard)/proyecciones/nueva/page.tsx` | 118–119 | `generateSeasonalityData(monthlySales, annualSales)` / `generateEvenSeasonality(annualSales)` | ✅ correcto | annualSales es la entrada correcta para cálculo de FE |
| 12 | `src/app/(dashboard)/proyecciones/nueva/page.tsx` | 122–130 | `calculateProjection({ annualSales, totalBudget, ... })` — llama al engine pasando ambos valores | ✅ correcto | El engine usa cada uno para su propósito correcto |
| 13 | `src/app/(dashboard)/proyecciones/nueva/page.tsx` | 133 | `distributeEvenly`: `monthly = annualSales / 12` | ✅ correcto | Distribuye la venta anual entre 12 meses para estacionalidad |
| 14 | `src/app/(dashboard)/proyecciones/nueva/page.tsx` | 260 | Input "Venta Anual Proyectada" enlazado a `annualSales` | ✅ correcto | Label coincide con variable |
| 15 | `src/app/(dashboard)/proyecciones/nueva/page.tsx` | 272 | Input "Presupuesto Total a Contratar" enlazado a `totalBudget` | ✅ correcto | Label coincide con variable |
| 16 | `src/app/(dashboard)/proyecciones/nueva/page.tsx` | 352 | Informativo: `{formatCurrency(annualSales / 12)}/mes` en step 1 sin estacionalidad | ✅ correcto | Muestra venta mensual promedio, contexto informativo |
| 17 | `src/app/(dashboard)/proyecciones/nueva/page.tsx` | 368–371 | `Total ingresado / {formatCurrency(annualSales)} (X%)` en validación mensual | ✅ correcto | Compara suma mensual vs venta anual declarada, correcto |
| 18 | `src/app/(dashboard)/proyecciones/nueva/page.tsx` | 381 | Informativo: `{formatCurrency(annualSales / 12)}/mes` en step sin estacionalidad (modo orgConfig) | ✅ correcto | Mismo patrón que #16, contexto informativo |
| 19 | `src/app/(dashboard)/proyecciones/nueva/page.tsx` | 476 | Step 3 render "Venta Anual" = `{formatCurrency(annualSales)}` | ✅ correcto | Label "Venta Anual" coincide con annualSales |
| 20 | `src/app/(dashboard)/proyecciones/nueva/page.tsx` | 482 | Step 3 render "Presupuesto" = `{formatCurrency(totalBudget)}` | ✅ correcto | Label "Presupuesto" coincide con totalBudget |
| 21 | `src/app/(dashboard)/proyecciones/nueva/page.tsx` | 548 | Validación de avance: `annualSales <= 0 \|\| totalBudget <= 0` | ✅ correcto | Gate de navegación — requiere ambos valores no-zero |
| 22 | `src/app/(dashboard)/proyecciones/[id]/page.tsx` | 107 | Render "Venta Anual" = `projection.annualSales` | ✅ correcto | Label coincide con variable |
| 23 | `src/app/(dashboard)/proyecciones/[id]/page.tsx` | 113 | Render "Presupuesto" = `projection.totalBudget` | ✅ correcto | Label coincide con variable |
| 24 | `src/app/(dashboard)/proyecciones/page.tsx` | 80 | Render presupuesto en lista = `proj.totalBudget` | ✅ correcto | Muestra totalBudget con label "presupuesto" |
| 25 | `src/app/(dashboard)/clientes/[id]/page.tsx` | 194 | Render presupuesto en perfil de cliente = `proj.totalBudget` | ✅ correcto | Display informativo de presupuesto |
| 26 | `convex/schema.ts` | 50–51 | Schema: `annualSales: v.number()`, `totalBudget: v.number()` | info (definition) | — |
| 27 | `convex/lib/templateVariables.ts` | 21–22 | Tipo `ResolverContext.projection`: `annualSales: number`, `totalBudget: number` | info (definition) | — |
| 28 | `convex/lib/templateVariables.ts` | 174 | Template var `annual_sales` resuelve a `projection.annualSales` | ✅ correcto | Variable de template para mostrar venta anual |
| 29 | `convex/lib/templateVariables.ts` | 177 | Template var `total_budget` resuelve a `projection.totalBudget` | ✅ correcto | Variable de template para mostrar presupuesto |
| 30 | `src/lib/templateResolver.ts` | 17–18 | Tipo `TemplateContext.projection`: `annualSales`, `totalBudget` | info (definition) | — |
| 31 | `src/lib/templateResolver.ts` | 159–160 | Mock data de fallback: `annualSales: 5000000`, `totalBudget: 500000` | info (test fixture) | — |
| 32 | `convex/functions/projections/mutations.ts` | 16–17 | Args validator de `create`: `annualSales: v.number()`, `totalBudget: v.number()` | info (definition) | — |
| 33 | `convex/functions/projections/mutations.ts` | 65 | `generateEvenSeasonality(args.annualSales)` — fallback si seasonalityData incompleta | ✅ correcto | annualSales es la entrada correcta para FE |
| 34 | `convex/functions/projections/mutations.ts` | 84–85 | Persiste `annualSales` y `totalBudget` al insertar proyección | ✅ correcto | Almacena los valores correctos en DB |
| 35 | `convex/functions/projections/mutations.ts` | 185–186 | `recalculate`: `annualSales = args.annualSales ?? projection.annualSales`, ídem `totalBudget` | ✅ correcto | Fallback a valor guardado en DB, lógica correcta |
| 36 | `convex/functions/projections/mutations.ts` | 234–235 | `recalculate`: pasa `annualSales` y `totalBudget` al engine | ✅ correcto | — |
| 37 | `convex/functions/contracts/mutations.ts` | 77–78 | Template replacement dict: `annualSales: projection.annualSales.toLocaleString(...)`, `totalBudget: projection.totalBudget.toLocaleString(...)` | ✅ correcto | Provee ambas variables a templates de contratos para display |
| 38 | `convex/functions/contracts/actions.ts` | 224–225 | Contexto de template resolver: `annualSales: projection.annualSales`, `totalBudget: projection.totalBudget` | ✅ correcto | Pasa ambos al resolver para uso en templates |
| 39 | `convex/functions/quotations/mutations.ts` | 69–70 | Template replacement dict: `annualSales: projection.annualSales.toLocaleString(...)`, `totalBudget: projection.totalBudget.toLocaleString(...)` | ✅ correcto | Igual que #37, para cotizaciones |
| 40 | `convex/functions/quotations/actions.ts` | 204–205 | Contexto de resolver: `annualSales: projection.annualSales`, `totalBudget: projection.totalBudget` | ✅ correcto | Igual que #38, para cotizaciones |
| 41 | `convex/functions/deliverables/actions.ts` | 235 | Prompt de contexto AI: `Ventas anuales: ${projection.annualSales}... Presupuesto total: ${projection.totalBudget}...` | ✅ correcto | Contextualización informativa para Claude, labels correctos |
| 42 | `convex/functions/quotations/qaSeedMutation.ts` | 97–98 | QA seed: `annualSales: 1_000_000`, `totalBudget: 100_000` | info (test) | — |
| 43 | `convex/functions/contracts/actions.ts` | 224 | `annualSales: projection.annualSales` en contexto de template | ✅ correcto | Display informativo en documentos |

### Entradas de test (no clasificadas como correcto/incorrecto — solo datos de fixture)

Los siguientes archivos contienen exclusivamente datos de prueba y no son código de producción:

- `convex/lib/__tests__/projectionEngine.test.ts` — múltiples referencias a `annualSales` y `totalBudget` como inputs de fixtures
- `convex/lib/__tests__/integration.test.ts` — igual
- `convex/functions/quotations/__tests__/permissions.test.ts` — fixture mínimo `annualSales: 1`, `totalBudget: 1`
- `convex/functions/quotations/__tests__/getByToken.test.ts` — fixture mínimo
- `convex/functions/quotations/__tests__/sendQuotation.test.ts` — fixtures con valores realistas
- `convex/functions/quotations/__tests__/helpers/quotations.ts` — helper compartido de test

---

## Resultado de la auditoría

**Total de matches grep:** ~80 líneas (incluyendo tests duplicados)
**Entradas en tabla (código de producción):** 43
**Número de ❌:** 0

No se encontró ningún cruce de variables — ningún path de distribución usa `annualSales` en lugar de `totalBudget`, ni ningún path de FE/seasonality usa `totalBudget` en lugar de `annualSales`.

---

## Hipótesis alternativa

Dado que la auditoría no encontró ❌s, el bug reportado ("distribución sobre 31.2M en vez de 24M") **no es un cruce de variables** en el código. El engine de Convex y el frontend wizard usan correctamente cada campo para su propósito.

### Posibles causas del síntoma

**Hipótesis A — El usuario interpreta `preview.grandTotal` como "total distribuido sobre annualSales"**
El preview (step 3 del wizard) muestra tres cards:
- "Venta Anual" = `annualSales` (e.g. 31.2M)
- "Presupuesto" = `totalBudget` (e.g. 24M)
- "Total Asignado" = `preview.grandTotal` (calculado por engine sobre totalBudget)

Si el usuario ve el card "Venta Anual" y la distribución de servicios no suma exactamente al `totalBudget` (puede haber diferencia por el modo de comisión proporcional vs fixed_monthly), podría confundirse pensando que la base fue el 31.2M. **Hipótesis más probable.**

**Hipótesis B — Valor stale en el estado de React**
Los inputs de `annualSales` y `totalBudget` son estado local del componente. Si el usuario modifica `annualSales` pero `totalBudget` no se re-inicializa, el preview podría mostrar valores de un borrador anterior. El estado persiste durante la sesión pero se resetea al montar el componente.

**Hipótesis C — Confusión semántica del modo `fixed_monthly`**
En el modo `commissionMode = "fixed_monthly"`, la comisión mensual se calcula como `commissionRate * totalBudget / 12` (línea 169 del engine), **no** como `annualSales * commissionRate / 12`. Esto hace que `grandTotal` pueda diferir del `totalBudget` exacto dependiendo de cuántos servicios estén activos/inactivos y cómo se sumen. Si el usuario esperaba ver `grandTotal ≈ totalBudget` y ve un número diferente, podría reportar el síntoma equivocadamente.

**Hipótesis D — Campo que el usuario llama "presupuesto" es en realidad `annualSales`**
Existe la posibilidad de que el usuario haya llenado el campo "Venta Anual" con 24M y el campo "Presupuesto" con un valor incorrecto (o vice versa). La distribución sería correcta sobre el `totalBudget` que ingresó, pero el usuario espera que sea sobre el otro número.

### Recomendación

Escalar a Christian para validar el síntoma con pantallazos o reproducción del caso concreto. Preguntar:
1. ¿Cuáles son los valores exactos que ingresó en "Venta Anual Proyectada" y "Presupuesto Total a Contratar"?
2. ¿En qué pantalla ve la distribución de 31.2M — el step 3 del wizard o la vista de detalle `/proyecciones/[id]`?
3. ¿Qué número exactamente interpreta como "base de distribución"?

Con esa información se puede confirmar o descartar las hipótesis A–D antes de aplicar cualquier código change en Task 3.
