# Prod-Readiness Bug-Fixes & Features — Sprint 15-may

**Created:** 2026-05-06
**Target deploy:** 2026-05-15 (clientes reales de Desk)
**Sprint length:** 9 días hábiles (6-may a 15-may; demo intermedia 13-may)
**Strategy:** Incremental con schema backwards-compatible. Cada fase deployable independiente. Cleanup de campos legacy → post-launch.

## 0. Contexto

Post llamada con papá, definimos los cambios necesarios para llevar Projex a producción con los ~50 clientes de Desk. La lista cubre 3 módulos (Clientes, Proyecciones, Entregables) y combina bug-fixes con features nuevas. Este spec consolida el alcance, los hallazgos del audit, y el plan por fases.

### Hallazgos del audit (estado real del código)

Audit ejecutado 2026-05-06 sobre `/Users/christiandarrelcoverlozano/Desktop/Projects/DESC`:

1. **Bug 31.2M vs 24M:** el engine en `convex/lib/projectionEngine.ts:238` SÍ usa `totalBudget` (24M) — la fórmula es `remainingBudget * normalizedWeight`. El síntoma reportado (31.2M usado para distribución) ocurre **en el preview del wizard** `/proyecciones/nueva`, no en el engine de Convex. Hay que ubicar la función de preview y reemplazar `annualSales` por `totalBudget`. Auditoría completa requerida en todos los paths (matriz detalle, datos guardados, PDF) — no solo el preview.

2. **Estacionalidad hoy:** en `src/app/(dashboard)/proyecciones/nueva/page.tsx:304-336` se capturan **ventas absolutas mes-a-mes**. El FE se calcula como `monthlySales / (annualSales / 12)`. Hay que invertir: capturar deltas % y derivar las ventas mensuales.

3. **Q&A Service:** no es campo de producción. Son fixtures de QA en `convex/functions/quotations/qaSeed.ts` y `qaSeedMutation.ts`. Probablemente un seed/botón se filtró a la UI prod.

4. **23M vs 24M:** no hay reconciliación de redondeo en el engine. La suma `serviceAllocations.reduce(...)` (`projectionEngine.ts:272`) acumula error de punto flotante. Hay que cerrar el residuo al servicio con mayor peso.

5. **Convex first-load:** `useQuery(api.functions.clients.queries.list, {})` en `proyecciones/nueva/page.tsx:81` corre antes de que Clerk auth esté lista. La query handler llama `getOrgIdSafe()` que devuelve undefined inicialmente, retorna `[]`, y al re-resolver auth dispara la transición skip→defined que rompe Convex.

6. **Mes inicio/prorrateo:** hoy proyección es siempre Ene-Dic con `year` fijo. No existe `startMonth` ni `projectionMode` en `projections`. `orgConfigs` tiene `fiscalYearStartMonth` pero no se usa en `projections`.

7. **Templates por servicio:** `convex/functions/deliverableTemplates/seed.ts` es genérico — **no hay templates seeded por defecto**. Los 5 servicios (Admin, RH, TI, Marketing, Legal) literalmente no tienen entregables hasta que alguien crea el template manualmente.

8. **Cuestionario:** la arquitectura ya es **1 cuestionario único por proyección** (no por servicio) — `convex/functions/questionnaires/mutations.ts:22-98` y schema `questionnaireResponses`. Lo que falta es contenido canónico, mapping pregunta→variable de template, y tipo de campo `file_upload`.

9. **Carga de documentos cliente:** no existe ninguna UI ni schema fuera de logos (orgBranding) y PDFs generados.

### Decisiones de producto

- **Distribución de presupuesto:** `totalBudget` es la base de distribución entre servicios y meses. `annualSales + seasonality` modulan la distribución mensual de cada servicio (vía FE), no la base total.
- **Estacionalidad:** input son deltas % sobre la media mensual, multiplicador (`mes_i = mediaMensual × (1 + delta_i/100)`), **sin renormalización automática**. Se muestra warning si la suma implícita difiere del presupuesto anual; usuario ajusta manualmente.
- **Mes de inicio:** dos modos. `rolling` (12 meses corridos desde startMonth, default) y `fiscal` (startMonth → diciembre, presupuesto prorrateado a `monthCount/12`). Modo `fiscal` NO autocrea la siguiente proyección — dispara evento de corte y notificación al Ejecutivo en enero.
- **Cuestionario unificado:** ya es único por proyección. NO hay "dedup entre servicios" (frase no fundada — error de memoria previa). Lo que falta es contenido canónico, mapping a variables de templates, y tipo `file_upload`.
- **Carga de documentos sueltos** (fuera de cuestionario): post-launch backlog.

## 1. Estrategia general

**Schema-evolution backwards-compatible:**
- Todos los campos nuevos son `v.optional(...)` con defaults lógicos al lectura.
- Discriminadores de modo (`projectionMode`, `seasonalityMode`) permiten que proyecciones legacy convivan con nuevas.
- Cero migración destructiva durante el sprint.
- Cleanup de campos legacy programado post-15-may una vez prod estable.

**Orden de fases:**
| Fase | Días | Entregable |
|---|---|---|
| A. Bugs críticos | 1-2 | 4 bugs cerrados |
| B. Acumulado UI + Estacionalidad | 3-5 | Widget en vivo + delta% mode |
| C. Mes inicio + prorrateo | 6-8 | startMonth/mode/fiscalProrate |
| D. Cuestionario + 5 templates AI | 9-13 | file_upload + 5 PDFs contextualizados |
| Demo intermedia | 13 (mié) | Fases A+B+C funcionando |
| Buffer/QA | 14 (jue) | Bug-fixes de demo + deploy stage |
| **Producción** | 15 (vie) | Deploy a clientes Desk |

**Track paralelo (papá):** YAML con preguntas canónicas + mappings, meta-entrega día 7. Si llega después del 13, code-freeze con seed temporal y update post-launch.

## 2. Fase A — Bugs críticos (días 1-2)

### A1. Convex first-load en `/proyecciones/nueva`

**Causa raíz:** `useQuery` corre antes de que `useAuth().isLoaded` sea true. Query handler ve `orgId === undefined`, retorna `[]`, transiciona skip→defined al re-resolver auth.

**Fix:** gate todas las queries del wizard con `isLoaded && orgId`:

```ts
const { isLoaded, orgId } = useAuth();
const clients = useQuery(
  api.functions.clients.queries.list,
  isLoaded && orgId ? {} : "skip"
);
```

Aplicar el mismo patrón a queries de services, orgConfig, deliverableTemplates en el wizard.

**Test:** test de regresión que hard-reload `/proyecciones/nueva` y verifica que el selector llena al primer click sin error en consola.

### A2. Preview wizard usa annualSales en vez de totalBudget

**Fix:**
1. Localizar la función de preview en `src/app/(dashboard)/proyecciones/nueva/page.tsx`.
2. Reemplazar uso de `annualSales` por `totalBudget` como base de distribución.
3. **Auditoría completa:** barrer todos los paths que tocan distribución y catalogar en una tabla:

| Path | Línea | Usa actualmente | Debería usar | Acción |
|---|---|---|---|---|
| (a llenar durante implementación) | | | | |

Áreas a barrer: `proyecciones/nueva/page.tsx`, `proyecciones/[id]/page.tsx`, `convex/lib/projectionEngine.ts`, `convex/functions/deliverables/`, generación de PDF, exports Excel.

**Regla canónica documentada:**
- `effectiveBudget ?? totalBudget` = base de distribución de servicios y residual mensual. Durante fase A `effectiveBudget` aún no existe; el código debe leer con fallback a `totalBudget` desde día 1 para que la fase C no requiera tocar este path otra vez.
- `annualSales` + `seasonality` = base para calcular FE, que modula distribución mensual dentro de cada servicio (sin afectar el total contratado).

**Test:** snapshot test con caso conocido (totalBudget=24M, annualSales=31.2M) que valida sumatoria mensual exacta = 24M y que ningún render muestra 31.2M como total contratado.

**Resultado del audit (2026-05-07):** ver `docs/qa/audit-budget-paths.md` — 43 entradas analizadas, 0 ❌. El bug reportado no es cruce de variables en código; hipótesis alternativa documentada en el audit doc.

### A3. Residual de redondeo (23M en vez de 24M)

**Fix:** en `convex/lib/projectionEngine.ts`, agregar reconciliación al final del loop:

```ts
const sumAllocations = serviceAllocations.reduce((s, a) => s + a.annualAmount, 0);
const residual = totalBudget - sumAllocations;
if (Math.abs(residual) > 0) {
  const topWeightService = serviceAllocations.reduce(
    (max, a) => a.normalizedWeight > max.normalizedWeight ? a : max
  );
  topWeightService.annualAmount += residual;
}
```

Misma técnica para distribución mensual dentro de cada servicio (residual al mes con mayor FE).

**Test:** property test que verifica `sum(serviceAllocations) === totalBudget` exacto (tolerancia ≤ $0.01) para combinaciones aleatorias de servicios y pesos.

### A4. Q&A Service en flujo de prod

**Fix:**
1. Localizar dónde se invoca `qaSeedMutation` en la UI.
2. Gate detrás de `process.env.NODE_ENV !== 'production'` o flag de Super Admin.
3. Si existe el servicio en DB de prod, eliminar via mutation de cleanup.

**Test:** smoke test que en build de producción el QA seed no aparece en ninguna pantalla.

## 3. Fase B — Acumulado UI + Estacionalidad multiplicador (días 3-5)

### B1. Widget de acumulado en tiempo real

**Ubicación:** sticky en esquina superior derecha del wizard `/proyecciones/nueva` (también en edición de detalle si se permite).

**Layout (~200px alto):**

```
┌─────────────────────────────┐
│ Presupuesto: $24,000,000    │
├─────────────────────────────┤
│ Asignado:    $18,500,000    │
│ Restante:    $ 5,500,000    │
│ Margen:      77% / 80% ✓    │
├─────────────────────────────┤
│ Legal       12% │ $2,880,000│
│ Contable    25% │ $6,000,000│
│ TI          18% │ $4,320,000│
│ + 2 más          $5,300,000 │
└─────────────────────────────┘
```

**Cálculo en vivo:** función pura `computeServiceAllocation(budget, services[])` extraída a `lib/projection-allocation.ts`, compartida frontend↔backend (fuente única de verdad). El parámetro `budget` recibe `effectiveBudget ?? totalBudget` — así fase C no requiere cambios al widget cuando agrega `effectiveBudget`.

**Estados visuales:**
- `Restante > 0`: gris, info.
- `Restante ≈ 0` (±$0.01): verde, ✓ "Listo".
- `Restante < 0`: rojo, "Sobrepasaste el presupuesto por $X".
- `Margen` = `totalBudget / annualSales × 100`. Warning si > 80% (regla de papá: no delegar 80-90% de gastos sin dejar margen al cliente).

**Validación de submit:** form no permite guardar si `restante !== 0`.

**Tests:**
- Unit: helper `computeServiceAllocation` (caso normal, residual, sobrepasado, vacío).
- Component: widget reacciona a cambios de servicios.

### B2. Estacionalidad como multiplicador (deltas %)

**Schema (backwards-compatible):**

```ts
// convex/schema.ts — projections table
seasonalityData: v.optional(v.array(v.object({   // legacy
  month: v.number(),
  monthlySales: v.number(),
  feFactor: v.number(),
}))),
seasonalityDeltas: v.optional(v.array(v.object({   // NUEVO
  month: v.number(),
  deltaPercent: v.number(),    // ej. 30 = +30% sobre la media
}))),
seasonalityMode: v.optional(v.union(
  v.literal("legacy"),         // proyecciones viejas
  v.literal("delta_percent")   // proyecciones nuevas
)),
```

Proyecciones existentes: `seasonalityMode = "legacy"` por default, siguen leyendo `seasonalityData`. Nuevas se crean con `"delta_percent"`.

**UI:** grid de 12 meses, input numérico con sufijo `%`, validación entre `-100` y `+200`. Default `0` (estacionalidad neutra).

**Cálculo:**
```
mediaMensual = annualSales / 12
ventasMes_i  = mediaMensual × (1 + delta_i / 100)
feFactor_i   = 1 + delta_i / 100
sumaImplicada = sum(ventasMes_i)
desviacion = (sumaImplicada - annualSales) / annualSales × 100
```

**Warning persistente** debajo del grid:

```
Suma implícita: $32,400,000
Venta anual:    $31,200,000
Desviación:     +3.85%   ⚠️ ajusta los deltas o la venta anual
```

NO autocorregir. El usuario decide.

**Tests:**
- Engine: misma proyección con modo legacy y delta_percent producen los mismos `feFactor` cuando inputs equivalentes.
- UI: cambio en `delta_i` actualiza ventas mensuales calculadas y banner de desviación.
- Edge: todos los deltas = 0 → FE = 1 todos los meses, sumaImplicada === annualSales.

### B3. Auditoría annualSales vs totalBudget

Trabajo paralelo a B1/B2: con la fórmula canónica clara, completar la tabla de A2 y aplicar fixes a cualquier path encontrado.

## 4. Fase C — Mes de inicio + prorrateo a fiscal (días 6-8)

### C1. Schema (backwards-compatible)

```ts
// convex/schema.ts — projections table
year: v.number(),                              // legacy, año-base
startMonth: v.optional(v.number()),            // 1-12. Default 1 (enero)
projectionMode: v.optional(v.union(
  v.literal("rolling"),    // 12 meses desde startMonth
  v.literal("fiscal")      // startMonth → diciembre
)),
monthCount: v.optional(v.number()),            // derivado: rolling=12, fiscal=12-startMonth+1
effectiveBudget: v.optional(v.number()),       // derivado: totalBudget × monthCount/12 si fiscal
previousProjectionId: v.optional(v.id("projections")),  // trazabilidad
```

Defaults al leer si campos `undefined`: `projectionMode="rolling"`, `startMonth=1`, `monthCount=12`, `effectiveBudget=totalBudget`. Cero migración destructiva.

### C2. UI en wizard

Bloque "Periodo de la proyección" arriba de "Servicios":

```
○ Contrato 12 meses corridos (default)
   Inicio: [Mayo ▼] 2026 → Abril 2027
   Presupuesto contratado: $24,000,000

○ Prorrateo año fiscal
   Inicio: [Mayo ▼] 2026 → Diciembre 2026 (8 meses)
   Presupuesto prorrateado: $24,000,000 × 8/12 = $16,000,000
   ⓘ En enero 2027 deberás crear una nueva proyección 12 meses
```

Cambio de modo recalcula `monthCount` y `effectiveBudget` en vivo. El widget B1 lee `effectiveBudget`, no `totalBudget`, para todo lo posterior.

### C3. Engine

`convex/lib/projectionEngine.ts` recibe ahora `(projection, services, seasonalityDeltas)`:

1. Normalizar inputs:
   ```ts
   const monthCount = projection.monthCount ?? 12;
   const effectiveBudget = projection.effectiveBudget ?? projection.totalBudget;
   const startMonth = projection.startMonth ?? 1;
   ```
2. Distribución de servicios usa `effectiveBudget`.
3. Loop mensual itera `monthCount` meses empezando en `startMonth`. Matriz resultante tiene N columnas.
4. Comisiones se prorratean a `monthCount`.

### C4. Matriz de detalle

`proyecciones/[id]`:
- Header dinámico: `Mayo 26 | Junio 26 | ... | Diciembre 26`.
- Si `projectionMode === 'fiscal'`, badge: "Proyección parcial 8 meses · año fiscal".
- Link a proyección anterior si `previousProjectionId` existe.
- Botón "Crear continuación 12 meses" si la fiscal terminó en diciembre y aún no hay siguiente.

### C5. Evento de corte y revaluación

No se autocrea la siguiente proyección. Cron diario (`convex/crons.ts`) en día 1 de cada mes:
- Busca proyecciones `mode=fiscal` cuyo `endMonth = monthAnterior`.
- Crea notificación en dashboard del Ejecutivo asignado: "Cliente X: cerró proyección fiscal. Crear nueva proyección 12 meses".

Cron se reactiva al deploy del 15-may (consistente con blocker MOC "crons deshabilitados").

### C6. PDFs y entregables

`react-pdf` templates leen `monthCount` y `startMonth` para header. Sin cambios estructurales — data-driven.

### C7. Tests

- Engine: `mode=fiscal, startMonth=5` → `effectiveBudget=16M`, 8 columnas, suma exacta.
- Engine: `mode=rolling, startMonth=5` → 12 columnas may→abr, presupuesto completo.
- UI: cambio de modo recalcula widget B1 en vivo.
- Migration safety: query antigua sobre proyección sin `projectionMode` retorna defaults rolling/12/totalBudget.

## 5. Fase D — Cuestionario unificado + 5 templates AI (días 9-13)

### D1. Schema cuestionario — agregar `file_upload`

```ts
// questionnaireQuestions
type: v.union(
  v.literal("text"),
  v.literal("textarea"),
  v.literal("select"),
  v.literal("number"),
  v.literal("date"),
  v.literal("file_upload")    // NUEVO
),
fileConfig: v.optional(v.object({           // solo si type=file_upload
  acceptedMimeTypes: v.array(v.string()),
  maxSizeMB: v.number(),
  multiple: v.boolean(),
})),
templateVariableMappings: v.optional(v.array(v.object({   // NUEVO
  templateId: v.id("deliverableTemplates"),
  variableName: v.string(),
}))),
```

Para respuestas `file_upload`, `responses[].value` guarda el `_storage` ID de Convex. Frontend descarga via `ctx.storage.getUrl()`.

### D2. Componente `<FileUploadField>`

Reusa patrón de `orgBranding` (infra de Convex storage para logos ya existe). Acepta drag-drop, preview, reemplazo.

- Modo cliente (`/q/[token]`): sin auth — token público es la autorización.
- Modo interno (`/cuestionarios/[id]`): consultor sube en nombre del cliente con sesión Clerk.

### D3. Seed canónico — TRACK CONTENIDO (papá)

Formato propuesto (`papa-questionnaire-content.yaml`):

```yaml
- key: razon_social
  text: "¿Cuál es la razón social de la empresa?"
  type: text
  required: true
  templateMappings:
    - service: legal
      template: gobierno_corporativo
      variable: razon_social
    - service: contable
      template: estados_proyectados
      variable: razon_social

- key: actas_constitutivas
  text: "Sube la copia digital de las actas constitutivas vigentes"
  type: file_upload
  fileConfig:
    acceptedMimeTypes: [application/pdf, image/*]
    maxSizeMB: 20
  required: true
  templateMappings:
    - service: legal
      template: gobierno_corporativo
      variable: actas_constitutivas_url
```

Volumen estimado: ~30-50 preguntas para cubrir 6 áreas (Legal, Contable, RH, Marketing, TI, Admin).

**Mientras llega:** seed temporal de 6 preguntas (1 por área) marcado `temporary: true` para desbloquear track de código y templates AI. Fallback al code-freeze si no llega.

### D4. Mapping pregunta → variable de template

Mutation `convex/functions/questionnaires/mutations.ts:populateTemplateVariables(projectionId)`:

1. Lee respuestas del cuestionario.
2. Recorre `templateVariableMappings` por respuesta.
3. Construye `{ [variableName]: value }` por template.
4. Para `file_upload`, expone `{var}_url` (URL firmada) y `{var}_filename`.
5. Almacena en `deliverableJobs.aiVariables` (existing) — el AI prompt ya lee de ahí.

### D5. Cinco templates AI

Para cada uno de Admin, RH, TI, Marketing, Legal:

1. Template `react-pdf` en `src/components/pdf/templates/{servicio}-resumen.tsx`:
   - Header con logo del cliente (de `orgBranding`).
   - Tipografía profesional, paginación, secciones: Portada → Contexto cliente (industria, facturación, frecuencia) → Servicios contratados → Detalle por servicio → Próximos pasos.
2. Variables AI con prompts específicos:
   - `contexto_industria`: "Genera análisis de 2 párrafos sobre retos {servicio} típicos en {industria} con {anualSales}."
   - `prioridades_recomendadas`: "Lista 3 prioridades de {servicio} para empresa {tamaño} en {industria}."
3. Smoke test con cliente dummy (Empresa X, industria=Manufactura, anualSales=50M) que valida output sin placeholders `{...}` ni texto genérico.

### D6. Pre-requisito: `ANTHROPIC_API_KEY`

Blocker listado en MOC. Agregar a `.env.local` (dev) y Vercel env vars (prod) antes de fase D. Sin esto, los 5 templates no funcionan.

### D7. Tests

- Schema migration: cuestionarios viejos sin `templateVariableMappings` siguen leyéndose.
- File upload: subir PDF 5MB, recuperarlo, validar URL firmada.
- Variable population: respuestas → `aiVariables` correctamente, edge cases (vacía, file no subido).
- AI generation: 5 templates con cliente dummy producen PDF contextualizado.
- E2E: cliente → proyección → cuestionario → 5 entregables.

## 6. Backlog post-launch (no para 15-may)

- Pestaña `/clientes/[id]/documentos` — uploads sueltos fuera de cuestionario, vista consolidada, soporte de versiones (ej. acta nueva). Validar demanda real una vez Desk/CRA en prod.
- Templates adicionales por área (Marketing: manual identidad corporativa, estrategia redes; etc.).
- Migración de campos legacy a required (`startMonth`, `projectionMode`, `monthCount`, `seasonalityMode`).
- Cleanup de `seasonalityData` legacy.
- Cobertura tests S9-09 (multi-tenant isolation, AI retry, PDF branding).
- Reactivar Sprint 10 polish si post-launch lo amerita.

## 7. Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Contenido de papá llega tarde (D3) | Media | Alto | Seed temporal de 6 preguntas. Code-freeze día 13 si no llegó. Update post-launch. |
| Audit annualSales/totalBudget revela más bugs | Media | Medio | Catálogo en tabla, fix incremental. Si surge bug grande, fase A se extiende a día 3. |
| Floating-point en residuo no converge | Baja | Bajo | Property test exhaustivo durante A3. |
| `ANTHROPIC_API_KEY` no se configura a tiempo | Baja | Alto | Pre-requisito explícito de fase D. Validar día 8. |
| Demo intermedia 13-may revela regresión | Media | Medio | Buffer 14-may para fix. Si crítico, posponer feature menor. |

## 8. Definition of Done — 15-may

- [ ] 4 bugs cerrados con tests de regresión.
- [ ] Widget acumulado funciona en vivo en wizard.
- [ ] Estacionalidad delta% mode disponible para proyecciones nuevas; legacy sigue funcionando.
- [ ] `startMonth` + `projectionMode` (rolling/fiscal) funcionando en wizard, engine, matriz, PDFs.
- [ ] `file_upload` en cuestionario, drag-drop UX validado.
- [ ] 5 templates AI (Admin, RH, TI, Marketing, Legal) generan PDFs contextualizados con variables AI no-placeholder.
- [ ] Crons reactivados en `convex/crons.ts`.
- [ ] `ANTHROPIC_API_KEY` configurada en Vercel prod.
- [ ] Seed canónico de cuestionario poblado (real o temporal documentado).
- [ ] Smoke E2E: crear cliente → proyección → cuestionario → 5 entregables, todo verde.
- [ ] Demo del 13-may aprobada por papá.
- [ ] Deploy Vercel prod sin errores en logs primeras 24h con cliente real Desk.
