# Stub spec — Llamada papá (capturada 2026-05-22, ampliada 2026-05-23)

**Fecha origen:** 2026-05-22 (call papá) + 2026-05-23 (captura adicional + clarificaciones)
**Estado:** 🟡 **STUB — captura + decomposición. Cada sub-spec a brainstormeado por separado.**
**Owner:** Christian
**Trigger:** lista funcional que papá pidió para lanzamiento.

---

## 1. Resumen ejecutivo

Papá pidió **7 áreas de cambio** + soportar **escala de producción** (2,000 contratos/mes, 2,000 entregables/mes). Decomposición en **7 sub-specs** ordenados por dependencia abajo.

Estimado total: **4-6 semanas de impl** secuencial. Algunos sub-specs paralelizables. Papá llena contenido del catálogo en paralelo.

---

## 2. Requirements crudos (lo que papá dijo)

### A. Catálogo + lógica de entregables
- A1. Definir qué entregable corresponde a cada subservicio (papá tiene contenido pendiente).
- A2. **Frecuencia real por entregable** — algunos entregables NO tiene sentido sacarlos dos veces al año.
- A3. **Año 2+ = update tier**, no entrega desde cero → precio menor.
- A4. Ciertos entregables **consumen estados financieros del periodo** → ingestion + analysis.

### B. Cotizaciones y contratos
- B1. Templates de contrato **por empresa emisora** (issuingCompanies múltiples).
- B2. Firma digital con **Firmame** (pending integration confirmada per memoria).
- B3. **Default start month = mes de creación de proyección**, override-able por servicio (ej. servicio X arranca hasta mayo).

### C. Pricing models
- C1. Modos a soportar (confirmados 2026-05-23):
  - **Fijo mensual (retainer)** — ya existe.
  - **Comisión / % ventas** — ya parcial (commission service).
  - **Proyecto fijo / one-time** — sin recurrencia.
  - **Retainer dinámico** ⬅ NUEVO — puede subir/bajar durante el año. Implica `monthlyAssignments.amount` editable per cell.
- C2. Subservicios `una_vez` con bloqueo de re-cotización año 2+ (ej. identidad corporativa no se repite).

### D. Timing de facturación
- D1. **Fecha emisión ≠ fecha pago** — factura emitida enero, cobrada diciembre (separar campos).

### E. Estados financieros como input de generación
- E1. **Procesar Excels** (parsing estructurado) y **guardar la información del cliente** como historia financiera persistente, no efímera.
- E2. PDF también soportado (extracción de texto via OCR).
- E3. Feed a Claude como contexto cuando se genera entregable financiero/contable.

### F. Escala (ya documentada en sección 5)
- F1. 2,000 contratos/mes + 2,000 entregables/mes.
- F2. Queue + Railway worker Puppeteer + Claude Batch API.

---

## 3. Decomposición en sub-specs

Cada uno necesita su propio brainstorming → spec → plan → impl cycle.

### Sub-spec 0: Pricing model + frequency foundation (schema)
**Bloquea:** Sub-specs 1, 3, 4
**Estimado:** 2-3 días impl
**Cambios:**
- Nueva enum `pricingModel: "fixed_retainer" | "dynamic_retainer" | "commission" | "one_time"` en `services`/`subservices` o `projectionServices`.
- Field `defaultFrequency` ya existe en `subservices` (revisar valores actuales y curar).
- Nuevo field `yearOverYearTier` en subservicios (TBD: % fijo o lista de tarifas; lo definimos cuando lleguemos a sub-spec 4).
- Lógica engine: si `pricingModel = "dynamic_retainer"`, el monto por mes es editable post-creación.

### Sub-spec 1: Catálogo de entregables por subservicio
**Bloquea:** Sub-spec 4 (parcialmente)
**Estimado:** 2 días impl + N días contenido humano (papá)
**Cambios:**
- UI mejorada en `/configuracion/plantillas` para que papá llene contenido rápido.
- Cada subservicio tiene mínimo 1 `deliverable_long`. Hoy hay 66 placeholders post-seed 2026-05-22.
- Validation: warn si subservicio activo en proyección sin plantilla con contenido real.

### Sub-spec 2: Contratos por empresa emisora + Firmame
**Bloquea:** nada (puede ir en paralelo)
**Estimado:** 4-5 días impl
**Cambios:**
- Schema: extender `deliverableTemplates` o agregar `contractTemplates` con `issuingCompanyId` requerido.
- UI nueva: `/configuracion/empresas/[id]/contratos` para gestionar templates por empresa.
- Integración Firmame: action que envía contrato → recibe webhook al firmar → marca como firmado.
- Audit en `documentEvents`.

### Sub-spec 3: Per-service start month + extensión a proyecciones
**Bloquea:** nada en su propio path
**Estimado:** 2-3 días impl
**Cambios:**
- Nuevo field `startMonth` en `projectionServices` (opcional, override del projection.startMonth).
- Wizard: per-service date picker en Step 2.
- Engine: `filteredSeasonality` y allocation respetan el offset del servicio individual.
- UI matriz: meses anteriores al start del servicio muestran `—` o "Inicia mes X".

### Sub-spec 4: Estados financieros — ingestion + persistencia
**Bloquea:** nada (independiente pero técnicamente más pesado)
**Estimado:** 5-7 días impl
**Cambios:**
- Schema: nueva tabla `clientFinancialData` con line items extraídos por periodo.
- UI: `/clientes/[id]/finanzas` upload + viewer.
- Parser Excel (server action): mapping de columnas → schema. Probablemente AI-assisted (Claude lee columnas y mapea).
- OCR PDF: librería tipo pdf-parse o Claude vision.
- Feed: cuando `generateDeliverable` corre para un subservicio "financiero/contable", el contexto Claude incluye snapshot del periodo de `clientFinancialData`.

### Sub-spec 5: Invoice issue date vs payment date
**Bloquea:** nada
**Estimado:** 1-2 días impl
**Cambios:**
- Schema: agregar `issueDate` (separado de `uploadedAt` que es operativo) en `invoices`.
- UI `/facturacion`: dos campos visibles (emisión vs pago).
- Generación de entregables: NO cambia (sigue dispared por `paidAt`).
- Reports: filtrable por issue date para conciliación contable.

### Sub-spec 6: Year-over-year update tier (precio menor año 2+)
**Bloquea:** nada hasta tener Sub-spec 0
**Estimado:** 2-3 días impl (decisión de modelo TBD)
**Cambios pendientes:** definir si es % fijo por subservicio o cotización manual cada vez. Resolver en brainstorming.

### Sub-spec 7: Queue + scale infra
**Bloquea:** nada (orthogonal)
**Estimado:** 3-5 días impl
**Cambios:** ver sección 5 abajo.

---

## 4. Orden de ataque recomendado

```
Sub-spec 0 (pricing/frequency foundation) ────┬── Sub-spec 1 (catálogo entregables)
                                              ├── Sub-spec 3 (per-service start month)
                                              └── Sub-spec 6 (year-over-year tier)
Sub-spec 2 (contratos + Firmame) ─────── paralelo
Sub-spec 4 (financial ingestion) ─────── paralelo (técnico, dedicar bloque dedicado)
Sub-spec 5 (invoice dates) ────────────── paralelo (1-2 días, en cualquier momento)
Sub-spec 7 (queue + scale) ────────────── al final cuando volumen sea real
```

---

## 5. Escala objetivo (sección 2026-05-22 conservada)

- **2,000 contratos/mes** (~0.046/min promedio, picos hasta ~200 batch end-of-month)
- **2,000 entregables/mes** similar.
- No necesariamente concurrentes; cuando lo son → queue.

### Análisis técnico

| Pieza | Capacidad actual | Veredicto a 2000/mes |
|---|---|---|
| Convex DB | Serverless | ✅ |
| Business logic | Sin estado pesado | ✅ |
| Resend | ~10-20/seg | ⚠️ batch API |
| Claude API | ~50 RPM Sonnet | ⚠️ Batch API + queue |
| Puppeteer PDF | 1 proceso Vercel function | ❌ separar a Railway worker |
| Convex scheduler | ~100 jobs/min | ⚠️ rate limit bucket |

### Arquitectura propuesta

```
[Trigger] → enqueue(generationJob)
              ↓
   [generationJobs table] (queued/running/completed/failed)
              ↓
   [worker cron cada 30s, dispatch N jobs por tick]
              ↓
   [generateDeliverable / generateContract]
              ↓
   [Railway puppeteer worker] (separado de Vercel, pool de browsers)
              ↓
   [Resend batch send]
```

Componentes:
1. Tabla `generationJobs` con estados + retry counter
2. Worker (Convex cron) que dispatch jobs respetando rate limits
3. Servicio dedicado Puppeteer en Railway (1 dyno con browser pool)
4. UI dashboard `/platform/jobs` para observabilidad
5. Retry con exponential backoff

---

## 6. Decisiones pendientes (TBD)

1. **Year-over-year tier discount** — método de cálculo (sub-spec 6 lo resolverá).
2. **Pricing model migration** — proyecciones existentes (Katimi, ACME) cómo se mapean al nuevo enum.
3. **Financial data parsing** — Claude lee Excel raw vs columnas convencionales vs UI-guided mapping.
4. **Firmame API specifics** — endpoints, webhook signature, fallback si falla.
5. **Cost estimates** — Claude Batch API + Railway + Resend total mensual a volumen objetivo.

---

## 7. Riesgos / flags

- **Concurrencia humana al ingestion financiero:** ¿cliente sube su propio Excel o lo hace papá? Auth/UX cambia.
- **Plantillas siguen vacías:** los 66 placeholders del 2026-05-22 necesitan contenido real antes de que sub-spec 1 sea útil.
- **Costo Claude API a 2000 entregables/mes:** con Batch API a 50% descuento, ~$50-150/mes solo en AI. Cabe.
- **Costo Railway worker:** ~$5-20/mes.
- **Concurrencia review humano:** papá no puede revisar 2000 contratos/mes manualmente → auto-aprobación con audit + sampling.
- **Dynamic retainer** rompe assumption del engine (monto fijo per mes) → engine necesita ser idempotent al recalculate cuando amounts cambian post-creación.

---

## 8. Próximo paso

**Christian:** confirmar prioridad de orden. Probable:
1. Empezar con **Sub-spec 0 (pricing foundation)** porque bloquea otros 3.
2. En paralelo, **papá llena contenido de plantillas** (no requiere code).
3. Cuando Sub-spec 0 esté listo, decidir si **Sub-spec 1, 3, 6** van en paralelo o secuencial.

Cuando estés listo para empezar Sub-spec 0: `superpowers:brainstorming` con esta sección + las respuestas de 2026-05-23.
