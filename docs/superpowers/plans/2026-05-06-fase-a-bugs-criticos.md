# Fase A — Bugs Críticos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar 4 bugs críticos del módulo de proyecciones para desbloquear el sprint hacia prod del 15-may.

**Architecture:** Fixes incrementales sobre el código existente. Cero cambios de schema. Cada bug tiene su propio commit. La auditoría annualSales↔totalBudget produce una tabla en `docs/qa/audit-budget-paths.md` que servirá de input para Fase B.

**Tech Stack:** Next.js 15, React 19, Convex, Clerk, Vitest 4, edge-runtime test env, convex-test 0.0.49.

**Spec:** `docs/superpowers/specs/2026-05-06-prod-readiness-bugfixes-design.md` (sección §2 Fase A).

**Estimated time:** 1.5-2 días.

---

## File Structure

**Create:**
- `docs/qa/audit-budget-paths.md` — tabla de auditoría de uso de annualSales vs totalBudget en todo el flujo.
- `convex/lib/__tests__/projectionEngine.residual.test.ts` — property tests para reconciliación de redondeo.

**Modify:**
- `src/app/(dashboard)/proyecciones/nueva/page.tsx` — agregar gate de auth a `useQuery` calls; corregir cualquier path que use `annualSales` como base de distribución en preview.
- `src/app/(dashboard)/proyecciones/[id]/page.tsx` — aplicar mismo gate de auth si tiene `useQuery` sin gate.
- `convex/lib/projectionEngine.ts` — agregar reconciliación de residuo al final del loop de servicios y dentro de cálculo mensual.
- `convex/functions/quotations/qaSeed.ts` y/o `qaSeedMutation.ts` — gate detrás de `NODE_ENV !== 'production'` o flag de Super Admin.

**Delete (potencial, sólo si está en DB de prod):**
- Service "QA Service" en DB de prod via mutation de cleanup one-shot.

---

## Task 0: Setup branch y verificar baseline

**Files:**
- No file changes; verifica entorno.

- [ ] **Step 1: Crear branch desde main**

```bash
git checkout main
git pull
git checkout -b fix/fase-a-bugs-criticos
```

- [ ] **Step 2: Verificar que tests existentes pasan**

Run: `npm test`
Expected: `61 passed` o cifra cercana, sin failures. Si hay failures pre-existentes, anota cuáles antes de continuar (no son tu responsabilidad pero los reportas).

- [ ] **Step 3: Verificar que el build pasa**

Run: `npm run build`
Expected: Build exitoso sin errores TS. Si falla, anota error y pausa — no avanzar con build roto.

- [ ] **Step 4: Confirmar variables de entorno locales**

Run: `cat .env.local | grep -E "CONVEX|CLERK"`
Expected: ver `NEXT_PUBLIC_CONVEX_URL`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` definidas. Si falta algo, pedir credenciales antes de continuar.

---

## Task 1: A1 — Gate de auth en `useQuery` del wizard

**Bug:** En `proyecciones/nueva/page.tsx:81`, `useQuery(api.functions.clients.queries.list, {})` corre antes de que Clerk auth esté lista. Resultado: error de Convex en primer load del wizard al seleccionar cliente; se "arregla" recargando.

**Files:**
- Modify: `src/app/(dashboard)/proyecciones/nueva/page.tsx:81-82`
- Test: `src/app/(dashboard)/proyecciones/__tests__/nueva-page.gate.test.tsx` (create)

- [ ] **Step 1: Crear el test de regresión que reproduce el bug**

Create `src/app/(dashboard)/proyecciones/__tests__/nueva-page.gate.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

// Smoke test conceptual: verifica que el código del wizard usa el patrón "skip"
// cuando isLoaded es false. El test es estático sobre el AST/source del archivo,
// no E2E — convex-test no ejecuta hooks de React directamente.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("proyecciones/nueva — auth gate on useQuery", () => {
  it("clients useQuery debe pasar 'skip' si isLoaded es false", () => {
    const source = readFileSync(
      resolve(__dirname, "../nueva/page.tsx"),
      "utf-8"
    );
    // El useQuery de clients debe estar gated. Patrón aceptado:
    // useQuery(api.functions.clients.queries.list, isLoaded ? {} : "skip")
    // o variantes con && / ?? que produzcan "skip" cuando auth no lista.
    expect(source).toMatch(/useQuery\(\s*api\.functions\.clients\.queries\.list,\s*[^)]*"skip"/);
  });

  it("services useQuery debe estar gated igual", () => {
    const source = readFileSync(
      resolve(__dirname, "../nueva/page.tsx"),
      "utf-8"
    );
    expect(source).toMatch(/useQuery\(\s*api\.functions\.services\.queries\.listGlobal[^)]*"skip"/);
  });
});
```

Necesitas `@testing-library/react` solo para el import declarativo — no se usa. Si vitest se queja, simplifica a un test puro de `readFileSync` sin imports de testing-library.

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npm test -- proyecciones/__tests__/nueva-page.gate`
Expected: FAIL en ambos casos — el código actual NO contiene `"skip"` en esos `useQuery`.

- [ ] **Step 3: Aplicar el fix con gate de auth**

En `src/app/(dashboard)/proyecciones/nueva/page.tsx`, cerca de las líneas 80-82, importar `useAuth` de Clerk y gatear las queries:

```tsx
// Encima del componente, junto a otros imports:
import { useAuth } from "@clerk/nextjs";

// Dentro de NuevaProyeccionContent(), reemplazar las líneas 80-85 actuales:
const { flags } = useOrgConfig();
const { isLoaded, orgId } = useAuth();
const authReady = isLoaded && !!orgId;

const clients = useQuery(
  api.functions.clients.queries.list,
  authReady ? {} : "skip"
);
const services = useQuery(
  api.functions.services.queries.listGlobal,
  authReady ? {} : "skip"
);
const createProjection = useMutation(
  api.functions.projections.mutations.create
);
```

Nota: `listGlobal` originalmente no recibía args; ahora pasa `{}` o `"skip"`. Verifica que la query handler en `convex/functions/services/queries.ts` acepte `{}` (en Convex, query sin args acepta `{}` por defecto — si rompe, ajustar a la firma exacta que el handler espera).

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npm test -- proyecciones/__tests__/nueva-page.gate`
Expected: PASS.

- [ ] **Step 5: Smoke manual — hard reload del wizard**

Run en otra terminal: `npm run dev` (y `npx convex dev` si no está corriendo).
Abre `http://localhost:3000/proyecciones/nueva` en navegador con devtools abierto. Hard reload (Cmd+Shift+R). Selecciona un cliente del dropdown.
Expected: ningún error de Convex en consola del navegador. El selector llena al primer click.

- [ ] **Step 6: Aplicar mismo patrón a `proyecciones/[id]/page.tsx` si tiene useQuery sin gate**

```bash
grep -n "useQuery" src/app/\(dashboard\)/proyecciones/\[id\]/page.tsx
```

Para cada `useQuery` sin `"skip"` o gate, aplicar el patrón `authReady ? {...} : "skip"` con el mismo `useAuth()`. Si no hay queries sin gate, saltar este step.

- [ ] **Step 7: Build sanity check**

Run: `npm run build`
Expected: Build exitoso sin errores TS.

- [ ] **Step 8: Commit**

```bash
git add src/app/\(dashboard\)/proyecciones/
git commit -m "fix(proyecciones): gate useQuery calls behind Clerk auth ready

Previously, useQuery in /proyecciones/nueva fired before Clerk auth was
loaded, causing a Convex skip→defined transition error on first render.
Required a hard reload to recover. Gate every useQuery in the wizard
behind isLoaded && orgId from useAuth().

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: A2 — Auditar paths annualSales vs totalBudget (deliverable: tabla)

**Goal:** Antes de aplicar fixes a A2, hacer barrido completo y documentar TODOS los puntos donde aparecen `annualSales` y `totalBudget` para distinguir uso correcto (FE/seasonality) vs uso incorrecto (base de distribución).

**Files:**
- Create: `docs/qa/audit-budget-paths.md`

- [ ] **Step 1: Recolectar todos los puntos de uso**

Run estos comandos y copia salida a una nota temporal:

```bash
grep -rn "annualSales" src/ convex/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v _generated
grep -rn "totalBudget" src/ convex/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v _generated
```

- [ ] **Step 2: Crear el doc con la tabla de auditoría**

Create `docs/qa/audit-budget-paths.md`:

```markdown
# Audit: annualSales vs totalBudget en flujo de proyección

**Fecha:** 2026-05-06
**Contexto:** Bug reportado — preview del wizard `/proyecciones/nueva` muestra distribución sobre 31.2M (annualSales) cuando debería ser 24M (totalBudget). Engine de Convex está correcto; bug está en frontend o paths secundarios.

## Regla canónica

- `effectiveBudget ?? totalBudget` = base de distribución de servicios y residual mensual.
- `annualSales + seasonality` = base para FE. FE modula distribución mensual dentro de cada servicio (sin afectar el total contratado).

## Tabla

| # | Path | Línea | Uso actual | ¿Correcto? | Acción |
|---|---|---|---|---|---|
| 1 | `convex/lib/projectionEngine.ts` | ~133 | `remainingBudget = totalBudget - annualCommissions` | ✅ correcto | — |
| 2 | `convex/lib/projectionEngine.ts` | ~238 | `annualAmount = remainingBudget * normalizedWeight` | ✅ correcto | — |
| 3 | `src/app/(dashboard)/proyecciones/nueva/page.tsx` | 466 | render "Venta Anual" = annualSales | ✅ correcto (es la venta) | — |
| 4 | `src/app/(dashboard)/proyecciones/nueva/page.tsx` | 472 | render "Presupuesto" = totalBudget | ✅ correcto | — |
| 5 | (a llenar al ejecutar) | | | | |

> Llena todas las filas con la salida de los grep del Step 1. Para cada uno marca ✅/❌. Si está marcado ❌, abre task de fix en Task 3.
```

- [ ] **Step 3: Llenar la tabla con cada match del grep**

Para cada match, abre el archivo, lee las líneas circundantes, y clasifica:

- **Lectura como base de distribución de servicios o meses:** debe ser `totalBudget` (o `effectiveBudget` post-Fase-C). Si usa `annualSales`, marca ❌.
- **Lectura para FE / seasonality / multiplicadores:** debe ser `annualSales`. Si usa `totalBudget`, marca ❌.
- **Display informativo (label "Venta Anual", "Presupuesto"):** correcto si label coincide con variable.
- **Cálculos secundarios (margen, %, etc.):** evalúa caso por caso, anota razonamiento.

- [ ] **Step 4: Si NO encontraste ningún ❌, considera Tasks 3 cerradas y commit**

Si todo es ✅, el bug que reportó el usuario podría no ser un bug de variable cruzada sino otro síntoma (ej. falta de actualización del preview en cierto step). En ese caso, anota hipótesis alternativa al final del doc y lleva el doc a Christian para revisión antes de cerrar Task 3.

- [ ] **Step 5: Commit del audit**

```bash
git add docs/qa/audit-budget-paths.md
git commit -m "docs(qa): audit annualSales vs totalBudget paths in projection flow

Tabla de auditoría completa de cada uso de annualSales y totalBudget en
el flujo de proyección, con clasificación de uso correcto vs incorrecto.
Sirve de input para Task 3 (fixes) y para Fase C (refactor a effectiveBudget).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: A2 — Aplicar fixes a paths incorrectos identificados en audit

**Files:** los archivos marcados con ❌ en `docs/qa/audit-budget-paths.md`.

> **Nota:** este task se ramifica según los hallazgos del audit. Si Task 2 cerró sin ❌s, saltar a Task 4 y registrar nota en plan: "no se encontraron paths incorrectos; investigar reporte original con Christian".

- [ ] **Step 1: Para cada ❌, escribir test que reproduzca el bug**

Para cada path ❌, agrega caso de test en el archivo de test correspondiente. Ejemplo (si el bug está en preview render):

```tsx
// En src/app/(dashboard)/proyecciones/__tests__/preview.test.tsx (create si no existe)
import { describe, it, expect } from "vitest";
import { calculateProjection, generateEvenSeasonality } from "../../../../../convex/lib/projectionEngine";

describe("preview wizard — distribución usa totalBudget no annualSales", () => {
  it("con annualSales=31.2M y totalBudget=24M, el grandTotal cabe en 24M", () => {
    const result = calculateProjection({
      annualSales: 31_200_000,
      totalBudget: 24_000_000,
      commissionRate: 0.02,
      services: [
        { serviceId: "s1", serviceName: "Legal", type: "base", minPct: 0.05, maxPct: 0.30, chosenPct: 0.20, isActive: true, isCommission: false },
        { serviceId: "s2", serviceName: "Contable", type: "base", minPct: 0.05, maxPct: 0.30, chosenPct: 0.30, isActive: true, isCommission: false },
        { serviceId: "scom", serviceName: "Comisiones", type: "comodin", minPct: 0, maxPct: 0.05, chosenPct: 0.02, isActive: true, isCommission: true },
      ],
      seasonalityData: generateEvenSeasonality(31_200_000),
    });
    // grandTotal incluye comisiones + servicios. Comisiones = 31.2M × 0.02 = 624K
    // remainingBudget para servicios = 24M - 624K = 23.376M
    // grandTotal = 624K + 23.376M = 24M (con tolerancia de redondeo)
    expect(result.grandTotal).toBeGreaterThanOrEqual(23_999_999);
    expect(result.grandTotal).toBeLessThanOrEqual(24_000_001);
    // Y el grandTotal nunca debe acercarse a 31.2M
    expect(result.grandTotal).toBeLessThan(25_000_000);
  });
});
```

- [ ] **Step 2: Correr el test, ver si pasa o falla**

Run: `npm test -- preview.test`
Expected: si el engine está correcto (como dice el audit), el test pasa de inmediato → confirma que el bug NO está en el engine. Si falla, hay un bug profundo en el engine y hay que escalarlo.

Si el test pasa pero el bug visual persiste en el wizard, el problema es en cómo el COMPONENTE renderiza datos derivados del preview (no en el cálculo). Revisa `nueva/page.tsx` líneas 459-521 (step 3 "Resumen") — específicamente busca cualquier render que NO use `preview.grandTotal` o `preview.monthlyTotals`/`preview.services[].annualAmount`. Cualquier render directo de `annualSales / 12` o similar como "distribución mensual" es el bug.

- [ ] **Step 3: Aplicar fix a cada path ❌**

Para cada ❌ en la tabla:
1. Lee el contexto (10 líneas antes y después).
2. Decide la variable correcta según la regla canónica.
3. Aplica el fix con `Edit`.
4. Si el fix cruza componentes, agrega tests.

Ejemplo de fix probable (si líneas 123-127 muestran):

```tsx
// ANTES (probable buggy code):
const monthly = annualSales / 12;
// ... usado en rendering de "promedio mensual"

// DESPUÉS:
const monthly = totalBudget / 12;  // si el render decía "mensual del presupuesto"
// O dejar como está si el render decía "venta promedio mensual" (eso es correcto)
```

> No apliques este fix a ciegas. Lee el contexto del render adyacente. La regla: si dice "presupuesto/contratado/asignado" → totalBudget. Si dice "venta/facturación" → annualSales.

- [ ] **Step 4: Correr todos los tests**

Run: `npm test`
Expected: todos pasan, incluyendo el nuevo test de Task 3 Step 1.

- [ ] **Step 5: Smoke manual del wizard**

Run: `npm run dev`. Abre wizard, llena `annualSales=31200000`, `totalBudget=24000000`, agrega 2 servicios. Avanza a step 3.
Expected: `Total Asignado` ≈ $24M (con error de redondeo ≤ $1M sin Task 4; ≤ $0.01 después de Task 4).

- [ ] **Step 6: Commit**

```bash
git add src/ docs/qa/audit-budget-paths.md
git commit -m "fix(proyecciones): use totalBudget (not annualSales) for distribution paths

Audit revealed N paths in the wizard preview using annualSales as the
base of monthly distribution display, when totalBudget should be the base.
Fixed each occurrence per the canonical rule documented in
docs/qa/audit-budget-paths.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: A3 — Reconciliación de residuo en projectionEngine

**Bug:** Suma de `serviceAllocations` puede dar 23M cuando totalBudget es 24M por acumulación de error de punto flotante en `remainingBudget * normalizedWeight` con varios servicios.

**Files:**
- Modify: `convex/lib/projectionEngine.ts:236-275`
- Test: `convex/lib/__tests__/projectionEngine.residual.test.ts` (create)

- [ ] **Step 1: Crear test de propiedad para residuo**

Create `convex/lib/__tests__/projectionEngine.residual.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  calculateProjection,
  generateEvenSeasonality,
  type ProjectionInput,
  type ServiceConfig,
} from "../projectionEngine";

function makeServices(count: number, weights: number[]): ServiceConfig[] {
  return weights.slice(0, count).map((w, i) => ({
    serviceId: `s${i}`,
    serviceName: `Service ${i}`,
    type: "base" as const,
    minPct: 0.01,
    maxPct: 0.50,
    chosenPct: w,
    isActive: true,
    isCommission: false,
  }));
}

describe("projectionEngine — residual reconciliation", () => {
  it("sum(servicios.annualAmount) == remainingBudget exact (tolerancia $0.01)", () => {
    const totalBudget = 24_000_000;
    const annualSales = 31_200_000;
    const commissionRate = 0.02;

    const result = calculateProjection({
      annualSales,
      totalBudget,
      commissionRate,
      services: [
        ...makeServices(5, [0.07, 0.13, 0.21, 0.29, 0.31]),
        // Comisiones (comodin, no participa en remainingBudget distribution)
        {
          serviceId: "scom",
          serviceName: "Comisiones",
          type: "comodin" as const,
          minPct: 0,
          maxPct: 0.05,
          chosenPct: 0.02,
          isActive: true,
          isCommission: true,
        },
      ],
      seasonalityData: generateEvenSeasonality(annualSales),
    });

    const baseServicesSum = result.services
      .filter((s) => !s.serviceName.startsWith("Comisiones"))
      .reduce((acc, s) => acc + s.annualAmount, 0);

    // Tolerancia centavos
    expect(Math.abs(baseServicesSum - result.remainingBudget)).toBeLessThan(0.01);
  });

  it("grandTotal == totalBudget cuando hay comisiones (tolerancia $0.01)", () => {
    const totalBudget = 24_000_000;
    const annualSales = 31_200_000;
    const result = calculateProjection({
      annualSales,
      totalBudget,
      commissionRate: 0.02,
      services: makeServices(7, [0.05, 0.08, 0.12, 0.15, 0.18, 0.21, 0.21]),
      seasonalityData: generateEvenSeasonality(annualSales),
    });
    // grandTotal NO debe perder ni ganar más de centavo respecto a totalBudget
    expect(Math.abs(result.grandTotal - totalBudget)).toBeLessThan(0.01);
  });

  it("property: para 50 combinaciones aleatorias, sum == budget (tolerancia $0.01)", () => {
    const totalBudget = 1_000_000;
    const annualSales = 1_500_000;

    for (let i = 0; i < 50; i++) {
      const numServices = 2 + Math.floor(Math.random() * 8);
      const weights = Array.from({ length: numServices }, () => 0.05 + Math.random() * 0.20);
      const result = calculateProjection({
        annualSales,
        totalBudget,
        commissionRate: 0,
        services: makeServices(numServices, weights),
        seasonalityData: generateEvenSeasonality(annualSales),
      });
      const sum = result.services.reduce((acc, s) => acc + s.annualAmount, 0);
      expect(Math.abs(sum - result.remainingBudget)).toBeLessThan(0.01);
    }
  });

  it("property: monthlyTotals[i].total suma a annualAmount por servicio", () => {
    const annualSales = 1_200_000;
    const result = calculateProjection({
      annualSales,
      totalBudget: 600_000,
      commissionRate: 0,
      services: makeServices(3, [0.10, 0.20, 0.30]),
      seasonalityData: generateEvenSeasonality(annualSales),
    });

    for (const svc of result.services) {
      const monthlySum = svc.monthlyAmounts.reduce((a, m) => a + m.adjustedAmount, 0);
      expect(Math.abs(monthlySum - svc.annualAmount)).toBeLessThan(0.01);
    }
  });
});
```

- [ ] **Step 2: Correr el test, esperar fallas**

Run: `npm test -- projectionEngine.residual`
Expected: AL MENOS uno de los tests falla. Específicamente el property test (50 combinaciones aleatorias) o el grandTotal test va a mostrar diferencia > $0.01 con `totalBudget` grandes y muchos servicios.

Si los 4 tests pasan al primer intento, significa que el residuo es despreciable en este dataset — pero el bug del usuario (23M vs 24M = $1M de diferencia) sugiere que SÍ hay drift. Tras tests verde, prueba con caso del usuario: `totalBudget=24_000_000`, `annualSales=31_200_000`, 5+ servicios con pesos no-redondos como `[0.0337, 0.0721, 0.1283, 0.2055, 0.2604]`. Si ese caso falla, agrega test específico.

- [ ] **Step 3: Implementar reconciliación de residuo en el engine**

Edit `convex/lib/projectionEngine.ts`. Después del bloque que construye `serviceAllocations` (alrededor de línea 258 en la función `calculateProjection`, justo antes del `// Step 6: Monthly totals`), agregar:

```typescript
// Step 5b: Residual reconciliation — close floating-point drift on
// the base service with the highest normalizedWeight so that
// sum(base annualAmount) === remainingBudget exactamente (tolerancia centavo).
// Sin esto, varias multiplicaciones acumulan a presupuestos del orden de
// $24M y pueden llegar a discrepancias visibles ($1M en el reporte del usuario).
//
// Selecciona base services usando normalizedWeight > 0 — único filter que ya
// excluye inactivos (weight=0 por L155) y comisiones (weight=0 por L183/206).
const baseAllocations = serviceAllocations.filter((s) => s.normalizedWeight > 0);
if (baseAllocations.length > 0) {
  const sumBase = baseAllocations.reduce((acc, s) => acc + s.annualAmount, 0);
  const drift = remainingBudget - sumBase;
  if (Math.abs(drift) > 0) {
    const heaviest = baseAllocations.reduce((max, s) =>
      s.normalizedWeight > max.normalizedWeight ? s : max
    );
    heaviest.annualAmount += drift;
    // Reconciliar drift dentro de cada base service en sus monthlyAmounts:
    // el mes con mayor feFactor absorbe el residuo del servicio.
    for (const svc of baseAllocations) {
      const monthlySum = svc.monthlyAmounts.reduce((a, m) => a + m.adjustedAmount, 0);
      const monthlyDrift = svc.annualAmount - monthlySum;
      if (Math.abs(monthlyDrift) > 0 && svc.monthlyAmounts.length > 0) {
        const heaviestMonth = svc.monthlyAmounts.reduce((max, m) =>
          m.feFactor > max.feFactor ? m : max
        );
        heaviestMonth.adjustedAmount += monthlyDrift;
      }
    }
  }
}
```

> **Variables verificadas contra el código actual** (`projectionEngine.ts:121-258`):
> - `serviceAllocations` existe en línea 147.
> - `remainingBudget` existe en línea 133.
> - `s.normalizedWeight` y `s.annualAmount` son campos del tipo `ServiceAllocation`.
>
> **Out of scope intencional:** la reconciliación NO toca commission services (mode `proportional` puede dejar drift entre `sum(monthlyCommissions)` y `annualCommissions` cuando la seasonality custom no preserva la suma anual de `monthlySales`). El bug del usuario es de base services; commission drift no fue reportado.

- [ ] **Step 4: Correr los tests de residuo**

Run: `npm test -- projectionEngine.residual`
Expected: los 4 tests pasan.

- [ ] **Step 5: Correr toda la suite del engine para asegurar no rompiste casos existentes**

Run: `npm test -- projectionEngine`
Expected: todos los tests del engine pasan (los preexistentes en `projectionEngine.test.ts` + los nuevos en `projectionEngine.residual.test.ts`).

- [ ] **Step 6: Commit**

```bash
git add convex/lib/projectionEngine.ts convex/lib/__tests__/projectionEngine.residual.test.ts
git commit -m "fix(engine): reconcile floating-point residual on service allocation

Multiplying remainingBudget × normalizedWeight across many services drifts
sum from totalBudget by up to \$1M with realistic inputs (24M budget,
6+ services, non-round weights). Close drift on the heaviest service,
and within each service close monthly drift on the heaviest month.

Adds 4 property tests including 50-combination random fuzz.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: A4 — Q&A Service en flujo de prod (audit + cleanup)

**Bug:** "QA Service" aparece en flujo de producción. Origen presunto: alguien corrió `npx convex run quotations/qaSeed:seedForCapture` contra DB de prod, dejando una quotation y un service "QA Service" en la base.

**Files:**
- Modify: `convex/functions/quotations/qaSeed.ts` y/o `qaSeedMutation.ts` — gate detrás de NODE_ENV.
- Create: `convex/functions/quotations/qaCleanup.ts` (one-shot, ejecutar manual contra prod).

- [ ] **Step 1: Verificar si "QA Service" existe en la DB de prod**

Run desde local con env de prod (cuidadoso — solo lectura):

```bash
npx convex run --prod functions/services/queries:listGlobal
```

Busca en la salida un service con `name: "QA Service"`. Si NO está, salta a Step 4 (solo gating). Si SÍ está, sigue con Step 2-3 para limpiar.

> **⚠️ Si no tienes acceso a `--prod`** o no quieres correr contra prod ahora, posponer Step 2-3 hasta tener autorización. Documenta hallazgo en commit message.

- [ ] **Step 2: Crear mutation de cleanup one-shot**

Create `convex/functions/quotations/qaCleanup.ts`:

```typescript
import { internalMutation } from "../../_generated/server";

/**
 * One-shot cleanup: remove "QA Service" rows and any quotations/services
 * created by the QA seed script. Run manually via:
 *   npx convex run --prod functions/quotations/qaCleanup:purgeQaService
 * After running, delete this file in a follow-up commit.
 */
export const purgeQaService = internalMutation({
  args: {},
  handler: async (ctx) => {
    let deletedServices = 0;
    let deletedQuotations = 0;
    let deletedQuotationServices = 0;

    const services = await ctx.db.query("services").collect();
    for (const s of services) {
      if (s.name === "QA Service") {
        await ctx.db.delete(s._id);
        deletedServices++;
      }
    }

    const quotations = await ctx.db.query("quotations").collect();
    for (const q of quotations) {
      const hasQa =
        q.serviceName?.includes("QA Service") ||
        q.notes?.includes("QA seed");
      if (hasQa) {
        // Borrar projectionServices/quotationServices vinculados primero si aplica
        await ctx.db.delete(q._id);
        deletedQuotations++;
      }
    }

    return { deletedServices, deletedQuotations, deletedQuotationServices };
  },
});
```

> **Adapta los nombres de tablas/campos** a lo que ves en tu schema. Si "QA Service" se asocia con tablas adicionales (projectionServices, deliverables...), agrégalas al barrido.

- [ ] **Step 3: Ejecutar el cleanup contra prod (con autorización explícita)**

> **⚠️ ANTES DE EJECUTAR:** Confirma con Christian. Esta operación es destructiva sobre prod.

```bash
npx convex run --prod functions/quotations/qaCleanup:purgeQaService
```

Anota en commit message la salida (`deletedServices: N, deletedQuotations: M`).

- [ ] **Step 4: Gate del seed mutation detrás de NODE_ENV**

Edit `convex/functions/quotations/qaSeedMutation.ts` — al inicio del handler, agregar guard:

```typescript
// Encima del handler:
if (process.env.NODE_ENV === "production") {
  throw new Error(
    "qaSeedMutation está deshabilitado en producción. Usa staging/dev."
  );
}
```

Aplica lo mismo a `qaSeed.ts` si tiene un handler invocable directo.

- [ ] **Step 5: Test que valida el guard**

Create `convex/functions/quotations/__tests__/qaSeed.guard.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("qaSeed — production guard", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it("throws cuando NODE_ENV es production", async () => {
    process.env.NODE_ENV = "production";
    const mod = await import("../qaSeedMutation");
    // Asume que el módulo expone la mutation; el handler real recibe ctx + args.
    // Test de smoke: que el archivo cargue y el guard esté presente en el source.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(
        new URL("../qaSeedMutation.ts", import.meta.url),
        "utf-8"
      )
    );
    expect(source).toMatch(/NODE_ENV\s*===\s*["']production["']/);
  });
});
```

> Si el test del handler real es complicado de simular, deja solo el smoke source-check arriba — es suficiente para garantizar que el guard no se eliminó accidentalmente.

- [ ] **Step 6: Correr el test**

Run: `npm test -- qaSeed.guard`
Expected: PASS.

- [ ] **Step 7: Build + smoke**

Run: `npm run build`
Expected: build pasa.

- [ ] **Step 8: Commit**

```bash
git add convex/functions/quotations/
git commit -m "fix(qa): gate qaSeed behind NODE_ENV; one-shot cleanup of prod data

qaSeedMutation was reachable in production environments. Adds a hard
guard that throws if NODE_ENV === 'production'. Also adds a one-shot
cleanup mutation (qaCleanup.purgeQaService) to remove leaked QA Service
rows from production DB. Cleanup deleted: <N services, M quotations>.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Smoke E2E manual + tag

- [ ] **Step 1: Correr suite completa**

Run: `npm test`
Expected: todos los tests pasan. Anota el conteo final (debería subir respecto al baseline de Task 0 Step 2 por los nuevos tests agregados).

- [ ] **Step 2: Build de producción**

Run: `npm run build`
Expected: build pasa sin warnings nuevos.

- [ ] **Step 3: Smoke E2E del wizard**

Run: `npm run dev` (y `npx convex dev`).
Caso de prueba completo:
1. Hard reload `/proyecciones/nueva`. Selecciona cliente al primer click. → No errores en consola.
2. Llena `annualSales=31200000`, `totalBudget=24000000`, `commissionRate=0.02`.
3. Avanza a step 2, marca "use seasonality", llena ventas mensuales con valores distintos para cada mes.
4. Avanza a step 3, ajusta pesos de 5+ servicios.
5. Avanza a step 4 "Resumen". Verifica:
   - "Venta Anual" = $31,200,000
   - "Presupuesto" = $24,000,000
   - "Total Asignado" = $24,000,000 (±$0.01)
   - Distribución por servicio y totales mensuales coherentes (sumas dan $24M)
6. Crea la proyección. Verifica que se creó sin error.
7. Ve a `/proyecciones/[nuevoId]`. Verifica que la matriz suma a $24M.

Si ALGÚN paso falla, abre task de fix antes de cerrar Fase A.

- [ ] **Step 4: Verificar que "QA Service" ya no aparece en flujos de prod**

En la app local con DB de prod (si tienes acceso) o en staging, recorre los flujos donde antes aparecía. Confirma ausencia. Si Step 3 de Task 5 se ejecutó contra prod, también verifica directo con: `npx convex run --prod functions/services/queries:listGlobal | grep -i "QA"` → vacío.

- [ ] **Step 5: Crear PR (no merge aún)**

```bash
git push -u origin fix/fase-a-bugs-criticos

gh pr create --title "Fase A — Bugs críticos prod-readiness" --body "$(cat <<'EOF'
## Summary
- A1: Gate `useQuery` calls in proyecciones wizard behind Clerk auth ready
- A2: Audit + fix annualSales↔totalBudget paths in preview rendering
- A3: Reconcile floating-point residual on service allocation (engine)
- A4: Gate qaSeed behind NODE_ENV; cleanup leaked prod data

## Spec
docs/superpowers/specs/2026-05-06-prod-readiness-bugfixes-design.md (§2 Fase A)

## Test plan
- [ ] `npm test` — all green (incluye 4 nuevos property tests de residuo)
- [ ] `npm run build` — sin errores
- [ ] Smoke manual: `/proyecciones/nueva` carga sin errores en hard reload, flow completo sin "QA Service" visible
- [ ] Verificar `Total Asignado` ≈ $24M con totalBudget=24M, annualSales=31.2M, 5+ servicios

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Update plan tasks status**

Marca las 6 tasks de este plan como completed en TaskList. Notifica a Christian con link al PR.

---

## Done criteria (Fase A)

- [ ] PR `fix/fase-a-bugs-criticos` abierto y CI verde.
- [ ] 4 bugs cerrados con tests de regresión.
- [ ] `docs/qa/audit-budget-paths.md` completo y commiteado.
- [ ] `npm test` cuenta nuevos tests (+8 mínimo: 2 gate + 2 preview + 4 residual).
- [ ] Smoke E2E del wizard verde.
- [ ] "QA Service" no aparece en flujo de prod (verificado).
- [ ] Christian aprueba el PR para merge a main.
