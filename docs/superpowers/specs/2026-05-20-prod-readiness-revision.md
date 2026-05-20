# Projex Prod-Readiness Revision — 2026-05-20

**Fecha:** 2026-05-20
**Autor:** Christian + Claude
**Reemplaza:** `docs/superpowers/specs/2026-05-14-bihive-prod-readiness-design.md`
**Estado:** propuesto
**Deadline beta:** 2026-05-31
**Sprint window:** 11 días hábiles (2026-05-21 → 2026-05-31)

Este spec es el **mapa maestro revisado** del sprint v2 beta. Reconcilia la visión
expandida que articuló Christian el 2026-05-20 (servicios → subservicios,
plantillas accesibles al operador, frecuencias variables, mini-CRM, facturas
reales, admin panels paralelos) con la auditoría adversarial que recorrió el
schema, las páginas existentes y los call sites afectados.

El maestro previo (2026-05-14) queda como histórico: sigue siendo válido en
varios módulos puntuales (engine refactor, cuestionario delta), pero ya no
representa el alcance ni los nombres correctos del beta. Las divergencias se
listan abajo de forma exhaustiva.

> Este spec **no se ejecuta directamente**. Define qué sub-specs se escriben,
> en qué orden, y deja resueltas en negro sobre blanco las decisiones
> bloqueantes para que cada sub-spec arranque sin re-litigar fundamentos.

---

## 0. Diferencias con el maestro previo (2026-05-14)

| Sección maestro previo | Qué decía 2026-05-14 | Qué cambia en 2026-05-20 | Razón |
|---|---|---|---|
| § 4 Services Catalog | Tabla nueva `serviceCatalog` con `(area, name)` como par denormalizado. Seed plano de ~70 items por área. | Se descarta `serviceCatalog`. Modelo correcto: `services` (los 9 padre, ya existentes) + nueva tabla `subservices` con `parentServiceId`. Seed inicial mínimo por servicio padre (3-6 subservicios típicos), no exhaustivo. | El operador piensa en jerarquía padre→hijo (Legal → Gobierno Corporativo) y necesita poder agregar subservicios mid-year. Un par plano `(area, name)` no soporta add-on contractual ni FE. |
| § 3 Deliverable Lifecycle — selector | Frequency vive en `deliverableTemplates`. | Frequency vive primario en `subservices.defaultFrequency`. La plantilla hereda. Override por template solo si el subservicio tiene varias plantillas con cadencias distintas (ej. corto mensual + largo trimestral). | El operador piensa "Marketing mensual" no "Marketing template X mensual". Frequency es atributo del servicio comercializable. |
| § 3 Deliverable Lifecycle — invoices | `invoices` se crea + upload PDF + `deliverables.generateForInvoice`. Bien orientado. | Mantener. Se añade explícitamente: `invoices.markPaid` triggea generación (no solo el upload del PDF). `triggerSource` en `deliverables`. Plantilla `"invoice"` en enum desde ya. | El beta del 31-may permite operador subir factura V1 manualmente; pago se marca después; el entregable solo se libera al marcarse `paid`. |
| § 5 Quotation Module | Cotización referencia `serviceCatalogItemId` (tabla descartada arriba). | Cotización referencia `projectionServiceId` (ya existe) y, cuando aplique, `subserviceId`. Line items reflejan subservicios. | Coherente con el nuevo modelo `services + subservices`. |
| Plantillas — permisos | Implícito: super-admin only (estado actual). No se cambia. | **Refactor:** copy-on-write desde defaults globales hacia org-scoped al primer edit. Página operadora `/configuracion/plantillas` en árbol Servicio→Subservicio→Plantilla. | El dueño quiere que el operador genere sus propias variantes sin tocar globales. |
| Admin panels | No se diseñaron como bloque. | **Nuevo §7:** gap analysis explícito de `/platform` (super admin) y `/configuracion` (org admin), con páginas faltantes para beta. | Necesario para llegar a un beta presentable, no solo a un flujo E2E. |
| Frecuencias | Implícito: mensual fijo (`monthlyAssignments` con 12 filas). | Frecuencias variables por subservicio (`defaultFrequency`). Cron diario "qué generar hoy" reemplaza el flujo mensual rígido. Override por cliente diferido a junio. | El cliente real tiene servicios trimestrales/anuales/una-vez; forzar mensual rompe la realidad. |
| Logs / auditoría | No existe. | Nueva tabla `documentEvents` en beta (backend only). UI rica diferida a junio. | Para depurar producción sin esperar la UI. |
| Notification routing | No mencionado. | Referencia explícita al sub-spec `2026-05-19-notification-recipient-resolution-design.md` ya escrito. | Evita duplicar diseño. |
| Cuestionario delta + redes sociales | § 6 con `social_instagram_handle` etc. | Se mantiene. Se ajusta solo: `questionnaireResponses.responses[].serviceNames[]` debe poder mapear a subservicios además de servicios padre (cuestionario unificado). | Decisión derivada del cambio de modelo. |
| Cronograma 16 días | Sprint dimensionado a 16 días. | **Nuevo cronograma de 11 días hábiles** (2026-05-21 → 2026-05-31). Out-of-scope explícito para todo lo que no entra. | Deadline movido por el dueño. |

---

## 1. Visión y alcance

### 1.1 Producto post-beta (visión expandida)

Projex sirve a despachos de consultoría que venden paquetes anuales de servicios
profesionales a clientes pyme. El despacho ("la org") configura su catálogo de
**servicios padre** (los 9 estándar: Legal, Contable, TI, Marketing, RH, Admin,
Comisiones, Logística, Construcción), y bajo cada uno define **subservicios**
específicos que sí se venden (ej. Legal → Gobierno Corporativo, Contratos
Mercantiles, Compliance LFPDPP).

Cada subservicio tiene:
- Una o más **plantillas** de entregable (corto, largo, cotización, contrato, factura).
- Una **frecuencia por defecto** (mensual, trimestral, semestral, anual, una vez).
- Opcionalmente, **override por cliente** (frecuencia distinta solo para ese cliente — diferido a junio).

El operador opera el ciclo: vende → cuestionario → cotización → contrato →
mes a mes sube factura, marca pagada, sistema genera el entregable correcto
para ese cliente, mes y subservicio.

### 1.2 Modo beta del 31-may

El beta sirve a **1-3 clientes reales del desk de papá**. El producto debe permitir:

1. Catálogo padre+subservicios configurado por la org.
2. Plantillas globales por defecto editables por el operador (copy-on-write).
3. Crear cliente, proyección, cotización con line items por subservicio.
4. Cliente acepta cotización → cuestionario disparado.
5. Operador sube factura PDF V1 manual → marca pagada → entregable generado.
6. Entregable correcto se selecciona según subservicio + frecuencia + mes.
7. Email al cliente con signed URL al PDF.
8. Org admin tiene panel `/configuracion` para configurar subservicios, plantillas, integraciones, branding, ejecutivos.
9. Super admin tiene panel `/platform` para ver métricas de uso, billing simple y errores cross-org.

### 1.3 Out-of-scope explícito (diferido a junio)

Los siguientes módulos **NO** entran al beta del 31-may. Cada uno tiene mención
en el spec donde corresponda con la nota `[DIFERIDO-JUNIO]`:

| Módulo | Razón del diferimiento |
|---|---|
| Frecuencias granulares por cliente (override) | Modelo de datos definido (`subserviceId.defaultFrequency` ya soporta) pero la UI y la mutation de override quedan fuera. El beta usa solo `defaultFrequency`. |
| Mini-CRM con UI rica (calendario, semáforos, recordatorios visuales) | El beta usa email cron simple ("toca subir factura del cliente Y este mes"). |
| Pipeline visual global (Gantt / calendario cross-cliente) | El beta usa `/clientes/[id]/ciclo` per-cliente existente. |
| `documentEvents` UI bonita en `/platform/audit` | Tabla existe en backend; en beta se inspecciona via Convex dashboard. |
| Facturas V2 con FacturAPI (emisión automática) | V1 = operador sube PDF manual. V2 espera definición de `issuingCompanies` flow. |
| Contrato firmado con Firmame | Se mantiene en backlog. Cotización aceptada → operador dispara contrato fuera del sistema. |
| Master-questionnaire completo (150 preguntas) | Bloqueado por contenido de papá. Beta agrega solo deltas críticos. |

---

## 2. Modelo de servicios y subservicios

### 2.1 Schema actual (relevante)

`convex/schema.ts:153-166` define `services` con los 9 padre. Tablas que
denormalizan `serviceName` como string:

- `projectionServices.serviceName` (`:172`)
- `monthlyAssignments.serviceName` (`:187`)
- `quotations.serviceName` (`:280`)
- `contracts.serviceName` (`:311`)
- `deliverables.serviceName` (`:333`)
- `deliverableTemplates.serviceName` (`:410`)
- `questionnaireResponses.responses[].serviceNames[]` (`:221`, array de strings)

Total: 7 tablas con dependencia textual de "Marketing", "Legal", etc.

### 2.2 Cambios

**Nueva tabla `subservices`:**

```ts
subservices: defineTable({
  orgId: v.optional(v.string()),        // null = subservicio global (catálogo base)
  parentServiceId: v.id("services"),    // FK al servicio padre (uno de los 9)
  name: v.string(),                     // "Gobierno Corporativo"
  description: v.optional(v.string()),
  defaultFrequency: v.union(
    v.literal("mensual"),
    v.literal("trimestral"),
    v.literal("semestral"),
    v.literal("anual"),
    v.literal("una_vez")
  ),
  applicableMonths: v.optional(v.array(v.number())),  // null = sin restricción de mes
  cooldownMonths: v.optional(v.number()),             // default 0
  defaultPricingHint: v.optional(v.number()),         // monto mensual sugerido en MXN
  isActive: v.boolean(),
  isDefault: v.boolean(),               // true = catálogo base, false = creado por org
  sortOrder: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_orgId", ["orgId"])
  .index("by_parentServiceId", ["parentServiceId"])
  .index("by_orgId_parentService", ["orgId", "parentServiceId"])
  .index("by_orgId_isActive", ["orgId", "isActive"]),
```

**`subserviceId` opcional en tablas denormalizadas:**

Una sola migración añade `subserviceId: v.optional(v.id("subservices"))` a:

- `projectionServices`
- `monthlyAssignments`
- `quotations`
- `contracts`
- `deliverables`
- `deliverableTemplates`

`serviceName` y `serviceId` **se mantienen**. Backfill = todo `subserviceId` queda
`null` para registros legacy. Las queries que filtran por subservicio usan dual
matching: si `subserviceId` está presente úsalo; si no, fallback a `serviceId` +
`serviceName`. Eso preserva proyecciones existentes.

**`questionnaireResponses.responses[].serviceNames`:**

Se mantiene como `array of strings` (compatibilidad). Se añade campo paralelo
opcional `subserviceIds: v.optional(v.array(v.id("subservices")))` para los
flujos nuevos. El cuestionario unificado decide a qué subservicio aplica cada
pregunta.

### 2.3 Seed inicial

`convex/functions/subservices/seed.ts` (nuevo): semilla mínima viable
(3-6 subservicios por padre, ~30 total), `isDefault: true`, `orgId: null`. La
org admin puede ocultar/editar/agregar desde `/configuracion/subservicios`.

Catálogo base sugerido (**pendiente de validación con papá antes del seed**; A1 reserva +0.5 día para refinar la lista con su input):

- **Legal:** Gobierno Corporativo · Contratos Mercantiles · Compliance · Propiedad Intelectual · Litigios.
- **Contable:** Estados Financieros Mensuales · Conciliación Bancaria · Cierre Anual · Reporte SAT.
- **TI:** Diagnóstico · Implementación ERP · Soporte Mensual · Ciberseguridad.
- **Marketing:** Plan Anual · Redes Sociales · Contenido · Branding · Performance.
- **RH:** Reclutamiento · Nómina · Capacitación · Clima Laboral.
- **Admin:** Manual Operativo · Procesos · Control Interno.
- **Comisiones:** Cálculo Mensual · Reporte Comisiones (subservicio único, comodín).
- **Logística:** Rutas · Inventario · Almacén.
- **Construcción:** Levantamiento · Avance de Obra · Bitácora.

### 2.4 Comodín `Comisiones`

`services` ya tipa "Comisiones" como `type: "comodin"` con `isCommission: true`
(`convex/functions/services/seed.ts:10`). Decisión: el subservicio "Cálculo
Mensual" hereda esa marca. La engine de proyección **no cambia** — `Comisiones`
sigue calculándose como % de ventas mensuales proporcional. `subservices` para
Comisiones existe solo por consistencia de UI y por si en el futuro la org
quiere diferenciar tipos de cálculo (proporcional vs fijo).

### 2.5 Estrategia de migración

1. Schema: añadir `subservices` + `subserviceId` opcional en 6 tablas (un commit).
2. Seed: correr `seedDefaultSubservices` una vez en prod (no falla si existe).
3. Wizard de proyección: Step 2 muestra subservicios bajo cada servicio padre. Selección guarda `subserviceId` además de `serviceId`/`serviceName`.
4. Backward-compat: proyecciones legacy con solo `serviceId` siguen funcionando. Solo nuevas proyecciones requieren `subserviceId`.

---

## 3. Plantillas — permisos y página operadora

### 3.1 Estado actual

`convex/functions/deliverableTemplates/queries.ts:21,67` y
`mutations.ts:38,68,93,113` llaman `requireSuperAdmin`. Si un operador entra a
`list` sin badge, recibe array vacío (try/catch silencioso). Página en
`src/app/platform/templates/page.tsx` solo accesible con badge morado en sidebar
(`src/components/layout/sidebar.tsx:104-119`).

### 3.2 Modelo de permisos: defaults globales + copy-on-write

**Reglas:**

- Plantillas con `orgId: null` = defaults globales. Solo super admin las edita.
- Plantillas con `orgId: "org_xxx"` = scope org. Cualquier miembro `org:admin` (operador) las puede leer/editar/desactivar.
- Al editar una plantilla global por primera vez desde un org, **no se edita la global**: se duplica con `orgId: <esa org>`, `version: 1`, hereda HTML+variables, y desde ese momento esa org ve y edita su copia local. La global sigue intacta para las demás orgs.
- El resolver (`findTemplate`) prefiere la copia org-scoped si existe, cae a la global si no.

**Implementación:**

- `mutations.create`: si caller es operador → forzar `orgId = currentOrgId`.
- `mutations.update`: si target es global Y caller es operador → no editar; en su lugar `duplicate({ id, orgId: currentOrgId })` y aplicar el patch sobre la copia.
- `queries.list`: quitar `requireSuperAdmin`. Devolver globales + org-scoped del caller. Filtrar por `orgId === null OR orgId === currentOrgId`.
- `requireSuperAdmin` se mantiene solo en mutations sobre plantillas globales.

### 3.3 Página operadora `/configuracion/plantillas`

Nueva ruta `src/app/(dashboard)/configuracion/plantillas/page.tsx`. Layout:

```
[Árbol izquierda]                [Detalle / Editor derecha]
├ Legal
│  ├ Gobierno Corporativo
│  │  ├ Cotización  (global)
│  │  ├ Entregable Corto  (org)
│  │  └ Entregable Largo  (org)
│  └ Compliance
│     └ ...
├ Contable
└ Marketing
   └ Plan Anual
      ├ Cotización  (global)
      ├ Entregable Corto  (global)
      └ + agregar plantilla
```

- Árbol agrupa Servicio padre → Subservicio → Plantillas (tipo).
- Cada plantilla muestra badge: `global` o `org` (copia local).
- Click en plantilla `global` → editor abre en modo read-only con botón "Crear copia editable para mi org". Click activa copy-on-write.
- Click en plantilla `org` → editor full (mismo componente que `/platform/templates` pero sin el campo libre `orgId`).
- Botón "+ agregar plantilla" en cada subservicio → form de creación con `orgId` forzado.

### 3.4 Versionado

Decisión: **snapshot de plantilla en cada `deliverable` generado**.

Cambios en `deliverables`:

```ts
templateId: v.optional(v.id("deliverableTemplates")),
templateVersion: v.optional(v.number()),    // copia de templates.version en el momento de generar
templateHtmlSnapshot: v.optional(v.string()), // copia del HTML usado, para auditoría exacta
```

Razón: la plantilla puede evolucionar entre el mes 3 y el mes 9 del mismo
cliente; el `deliverable` del mes 3 debe quedar reproducible para siempre.
Snapshot por valor (no por referencia) lo garantiza incluso si la plantilla se
borra o se renombra. Costo: ~5-50KB extra por deliverable, aceptable.

### 3.5 `"invoice"` en enum desde ahora

Aunque V2 FacturAPI queda fuera del beta, **añadir `"invoice"` al union de
`deliverableTemplates.type`** ahora evita una migración futura cuando se prenda
emisión automática:

```ts
type: v.union(
  v.literal("quotation"),
  v.literal("contract"),
  v.literal("deliverable_short"),
  v.literal("deliverable_long"),
  v.literal("questionnaire"),
  v.literal("invoice"),  // V2-ready, no usado en beta
),
```

UI lo filtra/oculta hasta que esté disponible.

---

## 4. Lifecycle de documentos

### 4.1 Tabla `invoices`

Schema nuevo:

```ts
invoices: defineTable({
  orgId: v.string(),
  clientId: v.id("clients"),
  projectionId: v.id("projections"),
  projServiceId: v.optional(v.id("projectionServices")),
  subserviceId: v.optional(v.id("subservices")),
  serviceName: v.string(),
  monthIndex: v.number(),         // 1-12 (mes calendario al que aplica)
  year: v.number(),
  amount: v.number(),
  bucketKey: v.string(),          // Railway key: {orgId}/{clientId}/invoices/{invoiceId}.pdf
  bucketUrl: v.optional(v.string()),
  contentType: v.string(),
  sizeBytes: v.number(),
  uploadedAt: v.number(),
  uploadedBy: v.string(),         // userId del operador
  status: v.union(
    v.literal("uploaded"),        // PDF subido, falta marcar pagada
    v.literal("paid"),            // factura cobrada → triggea generación
    v.literal("void")             // cancelada
  ),
  paidAt: v.optional(v.number()),
  paidBy: v.optional(v.string()),
  notes: v.optional(v.string()),
  // V2 hooks (no usados en beta)
  facturapiInvoiceId: v.optional(v.string()),
  cfdiUuid: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_orgId", ["orgId"])
  .index("by_clientId", ["clientId"])
  .index("by_clientId_year_month", ["clientId", "year", "monthIndex"])
  .index("by_projectionId", ["projectionId"])
  .index("by_orgId_status", ["orgId", "status"]),
```

### 4.2 Upload flow V1 (manual)

Action `invoices.upload`:

1. Operador en `/clientes/[id]/ciclo` o `/facturacion` selecciona PDF + cliente + servicio + mes.
2. Action `invoices.upload({ projectionId, projServiceId?, subserviceId?, monthIndex, year, amount, fileBuffer, contentType })`:
   - Sube PDF a Railway bucket vía helper existente (`convex/lib/blobStorage.ts` ya está en branch).
   - Inserta row en `invoices` con `status: "uploaded"`.
   - **No** dispara generación aún.
3. Mutation `invoices.markPaid({ invoiceId })`:
   - Verifica permisos (operador o admin).
   - Patch `{ status: "paid", paidAt: now, paidBy: userId }`.
   - **Encola** `internal.functions.deliverables.actions.generateFromInvoice({ invoiceId })`.
4. Botón manual "Generar ahora sin factura" sigue disponible (override) — `triggerSource: "manual"`.

### 4.3 Refactor de `selectDeliverableForMonth`

Hoy `convex/functions/deliverables/internalQueries.ts:48` (`findTemplate`)
filtra por `serviceName` exacto. Necesita:

```ts
selectDeliverableForMonth(
  ctx,
  { subserviceId, clientId, year, monthIndex, history }
): { templateId, templateVersion } | null
```

Lógica:

1. Lee `subservices[subserviceId]` → obtiene `defaultFrequency`, `applicableMonths`, `cooldownMonths`.
2. (Si el cliente tiene override de frecuencia [DIFERIDO-JUNIO] → usa ese. En beta: ignorar.)
3. Valida `monthIndex` ∈ `applicableMonths` (si está seteado).
4. Aplica reglas de frequency contra el mes:
   - `mensual`: aplica siempre.
   - `trimestral`: aplica si `monthIndex` ∈ {3, 6, 9, 12} (o calculado desde `applicableMonths`).
   - `semestral`: aplica si `monthIndex` ∈ {6, 12}.
   - `anual`: aplica si `monthIndex === 12`.
   - `una_vez`: aplica solo si no hay `deliverable` previo para este `(clientId, subserviceId)`.
5. Verifica `cooldownMonths` contra `deliverables.by_clientId` filtrando por `subserviceId`.
6. Si pasa todos los gates, busca `deliverableTemplates` con `subserviceId` matching y `type: "deliverable_short"` o `"deliverable_long"` (o el tipo solicitado). Prefiere copia org-scoped.
7. Si match → devuelve `(templateId, templateVersion)`. Si no → `null`.

### 4.4 Action `generateFromInvoice`

```
generateFromInvoice({ invoiceId })
  → load invoice
  → load history of deliverables for (clientId, subserviceId)
  → selectDeliverableForMonth → templateId, templateVersion
  → if null: patch invoice.notes = "no template applicable" + notify operator + return
  → engine (refactor) genera contenido con templateHtmlSnapshot
  → puppeteer PDF (reusar src/app/api/generate-pdf/route.ts)
  → uploadBlob al Railway bucket
  → insert deliverables { templateId, templateVersion, templateHtmlSnapshot, triggerSource: "invoice_paid", invoiceId, ... }
  → patch monthlyAssignments.status = "delivered" (matching assignment)
  → email al cliente con signed URL via Resend
  → log en emailLog + documentEvents
```

### 4.5 `triggerSource` en `deliverables`

```ts
triggerSource: v.optional(v.union(
  v.literal("manual"),         // operador forzó
  v.literal("cron"),            // cron diario seleccionó
  v.literal("invoice_paid"),    // factura marcada pagada
  v.literal("api")              // futuro: webhook externo
)),
```

Backfill: registros legacy quedan `null`. Audit/dashboards filtran por presencia.

### 4.6 Diagrama del flujo (beta)

```
operador            sistema                                          cliente
  │
  │ upload PDF       ┌─────────────┐
  ├─────────────────►│ invoices    │  status=uploaded
  │                  │ table       │
  │                  └─────────────┘
  │
  │ markPaid()       ┌─────────────┐    enqueue
  ├─────────────────►│ invoices    │───────────► generateFromInvoice
  │                  │ status=paid │              │
  │                  └─────────────┘              │
  │                                               ▼
  │                                       selectDeliverableForMonth
  │                                               │
  │                                  null ◄──────┼──────► templateId
  │                                   │           │              │
  │                              notify operator  │              ▼
  │                                               │       engine + PDF
  │                                               │              │
  │                                               │              ▼
  │                                               │       upload Railway
  │                                               │              │
  │                                               │              ▼
  │                                               │      insert deliverable
  │                                               │      (triggerSource=invoice_paid,
  │                                               │       templateVersion snapshot)
  │                                               │              │
  │                                               │              ▼
  │                                               │       email signed URL ──────►
  │                                               │
  │                                               ▼
  │                                       log documentEvents
```

---

## 5. Frecuencias

### 5.1 Modelo en beta

`subservices.defaultFrequency` (ver §2.2). Cada subservicio tiene una frecuencia
única que aplica a todos los clientes que contraten ese subservicio.

### 5.2 Override por cliente [DIFERIDO-JUNIO]

Tabla planeada para junio (no se incluye en V2-beta):

```ts
// NO ENTRA EN BETA — referencia para junio
clientSubserviceOverrides: defineTable({
  orgId: v.string(),
  clientId: v.id("clients"),
  subserviceId: v.id("subservices"),
  frequencyOverride: v.optional(v.union(/* mismas literales */)),
  applicableMonthsOverride: v.optional(v.array(v.number())),
  cooldownMonthsOverride: v.optional(v.number()),
  notes: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_orgId_client_subservice", ["orgId", "clientId", "subserviceId"]),
```

`selectDeliverableForMonth` debe **dejar el hook listo**: una lectura
`getOverride(clientId, subserviceId)` que en beta siempre devuelve `null`. En
junio, swap del placeholder a la tabla real. Cero cambio de signature.

### 5.3 Cron diario "qué generar hoy"

Nuevo cron en `convex/crons.ts`:

```ts
crons.daily(
  "deliverable-eligibility-scan",
  { hourUTC: 13, minuteUTC: 0 },  // 7am CDMX
  internal.functions.cron.eligibilityScan.run,
  {}
);
```

`eligibilityScan` recorre `projectionServices` activos del año actual, calcula
para hoy (`(year, monthIndex)` del calendar tick) si `selectDeliverableForMonth`
retorna template, y:

- Si retorna template Y no existe `deliverable` para `(clientId, subserviceId, year, monthIndex)`: **NO genera todavía** — encola recordatorio al operador ("toca subir factura de cliente Y, subservicio Z para mes M"). Mantiene `factura paga → entregable` como gate humano explícito en beta.
- Si ya existe deliverable: skip.
- Si retorna `null`: skip silencioso.

> El cron NO genera entregables sin factura pagada en beta. Solo recordatorios.
> Eso preserva el flujo humano-en-el-loop y deja al operador a cargo del trigger.

### 5.4 Compatibilidad con `monthlyAssignments`

`monthlyAssignments` asume 12 filas/año por servicio. Con frecuencias variables,
una proyección trimestral generaría 4 deliverables, no 12. Decisión:

- **Mantener `monthlyAssignments` con 12 filas siempre** (no romper engine
  existente ni UI `/facturacion`).
- Para meses donde `selectDeliverableForMonth` retorna `null`, la fila existe
  pero `deliverables` jamás se crea para ese mes. El UI ya distingue
  `status: "pending" | "delivered"` — pending sin entregable es válido.
- A futuro (post-beta), reemplazar `monthlyAssignments` por una tabla
  `documentSchedule` derivada del subservicio. Out-of-scope ahora.

---

## 6. Client Services Overview + Mid-Year Add-on

### 6.1 Panel "servicios activos por cliente"

En `src/app/(dashboard)/clientes/[id]/page.tsx`, agregar sección **"Servicios
contratados"** después de "Proyecciones". Tabla:

| Subservicio | Frecuencia | Mes inicio | Mes fin | Monto mensual | Estado |
|---|---|---|---|---|---|
| Marketing → Plan Anual | mensual | Ene 2026 | Dic 2026 | $X | activo |
| Legal → Compliance | trimestral | Ene 2026 | Dic 2026 | $Y | activo |
| Legal → Gobierno Corporativo (add-on) | semestral | Jul 2026 | Dic 2026 | $Z | activo |

- Lee de `projectionServices` join `subservices`.
- Botón "+ Agregar subservicio" abre modal de mid-year add-on.

### 6.2 Mid-year add-on

Modal:

1. Selección de subservicio (no contratados aún para este cliente).
2. Mes de arranque (default: mes siguiente al actual).
3. Mes de fin: **calendario** (siempre diciembre del año en curso por defecto).
4. Monto mensual.

**Decisión sobre prorrateo: calendario.** El contrato anual estándar va de enero a
diciembre. Si el cliente contrata un add-on en julio, este corre julio→diciembre
(6 meses) con prorrateo simple en la cotización. Razón:

- Más simple operativamente (alineado al año fiscal default).
- Renovación anual unificada el 1-ene (no fechas dispersas).
- La cotización del add-on muestra explícitamente "X meses × Y MXN".

Implementación: crea `projectionServices` nuevo con `startMonth`, `endMonth`
(añadir si no existe), y dispara cotización suplementaria por el monto
prorrateado.

### 6.3 Cambios al schema

`projectionServices` añade:

```ts
startMonth: v.optional(v.number()),    // 1-12; null = 1 (legacy)
endMonth: v.optional(v.number()),      // 1-12; null = 12 (legacy)
addOnOfProjectionServiceId: v.optional(v.id("projectionServices")), // audit trail
```

---

## 7. Admin panels

### 7.1 Super Admin (`/platform`)

**Lo que ya existe:**

| Ruta | Archivo | Estado |
|---|---|---|
| `/platform` | `src/app/platform/page.tsx` | Lista de orgs (tabla, link a detalle, crear nueva). Funcional. |
| `/platform/orgs/[id]` | `src/app/platform/orgs/[id]/page.tsx` | Detalle org. Funcional. |
| `/platform/orgs/[id]/branding` | `.../branding/page.tsx` | Branding override por org. |
| `/platform/servicios` | `src/app/platform/servicios/page.tsx` | CRUD servicios globales. |
| `/platform/templates` | `src/app/platform/templates/page.tsx` | CRUD plantillas globales (super admin only). |

**Lo que falta para beta:**

| Ruta nueva | Propósito | Mínimo viable |
|---|---|---|
| `/platform/metrics` | Métricas básicas de uso y costos | Tabla por org: # deliverables generados (30d), # cotizaciones enviadas, costo Claude USD (30d, calculado desde `deliverables.aiLog[].costUsd`). Recharts opcional, tabla suficiente. |
| `/platform/billing` | Billing simple | Para cada org: plan actual + uso vs límite del plan (definido en `organizations.plan` enum). Botón "exportar CSV". No procesa pagos. |
| `/platform/audit` | Cross-org error feed | Lista de últimos N entries en `documentEvents` con `severity = "error"`. Filtros por org y tipo. Minimalista (ver §8). |
| `/platform/subservices` | Catálogo subservicios globales | CRUD sobre `subservices` con `orgId: null`. Mismo patrón que `/platform/templates`. |

**No-blockers (no hacer ahora):** dashboard analítico avanzado, control de
feature flags por org (ya existe `orgConfigs.featureFlags` editable via prod),
gestión de planes Stripe.

### 7.2 Org Admin (`/configuracion`)

**Lo que ya existe:**

| Ruta | Archivo | Estado |
|---|---|---|
| `/configuracion` | `src/app/(dashboard)/configuracion/page.tsx` | Hub con 3 cards: Empresas Emitentes, Email Log, Integración Resend. |
| `/configuracion/empresas-emitentes` | `.../empresas-emitentes/page.tsx` | CRUD personas morales (issuingCompanies). Funcional. |
| `/configuracion/email-log` | `.../email-log/page.tsx` | Log de envíos. |
| `/configuracion/integraciones/resend` | `.../integraciones/resend/page.tsx` | API key Resend. |

**Lo que falta para beta:**

| Ruta nueva | Propósito | Mínimo viable |
|---|---|---|
| `/configuracion/plantillas` | Plantillas operadora con árbol Servicio→Subservicio (ver §3.3) | Árbol izquierda + editor derecha. Copy-on-write desde globales. |
| `/configuracion/subservicios` | CRUD subservicios scope org | Tabla agrupada por servicio padre. Form: nombre, frecuencia, applicableMonths, cooldown, precio sugerido. Heredados globales solo lectura con botón "Personalizar para mi org". |
| `/configuracion/frecuencias` | Vista read-only de defaults por subservicio | En beta: solo lectura, redirección a `/configuracion/subservicios`. UI dedicada de override por cliente [DIFERIDO-JUNIO]. |
| `/configuracion/usuarios` | Gestión ejecutivos | Lista miembros (lectura via Clerk). Asignación de email del ejecutivo (campo libre, sin Clerk lookup) para notification routing del cuestionario completado (ver `2026-05-19-notification-recipient-resolution-design.md`). |
| `/configuracion/branding` | Logo + colores org | CRUD sobre `orgBranding`. Ya existe schema en `convex/schema.ts:393-405`, falta UI. |
| `/configuracion/integraciones/firmame` | API key Firmame | Form: API key + secret + sandbox toggle. Sin integración funcional (Firmame queda backlog) — solo persiste credenciales en `orgIntegrations`. |
| `/configuracion/integraciones/railway` | Railway bucket creds | Mostrar bucket activo (read-only, viene de env vars). Opcional override por org en V2. En beta: read-only info. |
| `/configuracion/notificaciones` | Email destino notificaciones org | Input `orgConfigs.notificationEmail` + toggle + test send. Spec referenciado: `2026-05-19-notification-recipient-resolution-design.md`. |

**Cards actualizadas en `/configuracion`** (hub): añadir 6 entradas nuevas con sus respectivos íconos.

### 7.3 Roles intermedios

Decisión: **definir rol `"operator"` en Clerk custom roles ya, mapeado a
`org:admin` por ahora**. Razón: cuando se diferencie operador vs admin de org
(junio+), solo cambia el mapping interno; no requiere migración de Clerk. Las
mutations sensibles (eliminar plantilla global, ver otra org) siguen detrás de
`requireSuperAdmin`; las del org siguen detrás de `requireOrgMember`. El badge
visual del sidebar puede ya leer `role === "operator"` aunque hoy sea idéntico
a `org:admin`.

---

## 8. Logs / Auditoría (minimalista para beta)

### 8.1 Tabla `documentEvents`

Nueva tabla:

```ts
documentEvents: defineTable({
  orgId: v.string(),
  clientId: v.optional(v.id("clients")),
  projectionId: v.optional(v.id("projections")),
  documentType: v.union(
    v.literal("invoice"),
    v.literal("deliverable"),
    v.literal("quotation"),
    v.literal("contract"),
    v.literal("questionnaire")
  ),
  documentId: v.string(),
  eventType: v.union(
    v.literal("created"),
    v.literal("uploaded"),
    v.literal("generated"),
    v.literal("sent"),
    v.literal("paid"),
    v.literal("signed"),
    v.literal("rejected"),
    v.literal("error"),
    v.literal("retried"),
    v.literal("deleted")
  ),
  severity: v.union(
    v.literal("info"),
    v.literal("warn"),
    v.literal("error")
  ),
  actorUserId: v.optional(v.string()),  // null = system / cron
  message: v.optional(v.string()),
  metadata: v.optional(v.string()),     // JSON string libre
  occurredAt: v.number(),
})
  .index("by_orgId", ["orgId"])
  .index("by_orgId_occurredAt", ["orgId", "occurredAt"])
  .index("by_orgId_severity", ["orgId", "severity"])
  .index("by_clientId", ["clientId"])
  .index("by_documentType", ["documentType"]),
```

Wrapper `logDocumentEvent(ctx, args)` se llama desde:

- `invoices.upload`, `invoices.markPaid`
- `deliverables.generate*` (success + error paths)
- `quotations.send`, `quotations.respond`
- `contracts.send` (futuro Firmame)
- `questionnaires.submit`
- Cron crashes / failures

### 8.2 UI en beta

`/platform/audit`: tabla simple, filtros por `orgId`, `documentType`, `severity`,
date range. Sin gráficas. Sin per-org cliente view en beta (los clientes no
ven sus logs aún; UI rica diferida a junio).

---

## 9. Plan de implementación

### 9.1 Sub-specs en orden

| # | Sub-spec | Cubre | Días | Dependencias | Owner |
|---|---|---|---|---|---|
| R1 | `2026-05-20-prod-readiness-revision.md` (este) | Mapa maestro revisado | 0 (ya) | — | Christian |
| A1 | `2026-05-21-subservices-model-design.md` | §2 modelo + seed + migración (+0.5d buffer validación catálogo con papá) | 2 | R1 | Christian |
| A2 | `2026-05-22-templates-operator-access-design.md` | §3 permisos + página operadora + versionado | 2 | A1 | Christian |
| A3 | `2026-05-23-document-lifecycle-design.md` | §4 invoices + selector + generateFromInvoice + §5 cron + §8 documentEvents | 3 | A1, A2 | Christian |
| B1 | `2026-05-26-client-services-overview-design.md` | §6 panel + add-on | 1 | A1 | Christian |
| D1 | `2026-05-27-super-admin-panels-design.md` | §7.1 metrics/billing/audit/subservicios globales | 1.5 | A1, A3, §8 | Christian |
| D2 | `2026-05-28-org-admin-panels-design.md` | §7.2 páginas faltantes en `/configuracion` | 2 | A1, A2 | Christian |
| Z1 | Beta E2E demo + bugfix buffer | flujo completo con cliente real | 1 | todos | Christian |

**Total: 12.5 días estimados, contra 11 hábiles + sábado-domingo (30-31 may) confirmados por el dueño.** Ver §9.3 para mitigación si se desborda.

### 9.2 Cronograma día por día

| Día hábil | Fecha | Trabajo |
|---|---|---|
| 1 | 2026-05-21 (jue) | R1 aprobado (hoy). Brainstorm A1 + schema PR. |
| 2 | 2026-05-22 (vie) | A1 implementación: schema `subservices` + `subserviceId` en 6 tablas + seed. |
| 3 | 2026-05-25 (lun) | A2 brainstorm + permisos refactor. |
| 4 | 2026-05-26 (mar) | A2 página `/configuracion/plantillas` + copy-on-write + `templateVersion` snapshot. |
| 5 | 2026-05-27 (mié) | A3 brainstorm + schema `invoices` + `documentEvents`. |
| 6 | 2026-05-28 (jue) | A3 `selectDeliverableForMonth` + `markPaid` trigger + cron eligibility. |
| 7 | 2026-05-29 (vie) | A3 `generateFromInvoice` end-to-end + email signed URL + tests. |
| 8 | 2026-05-30 (sáb) | B1 (panel servicios cliente + add-on). |
| 9 | 2026-05-30 (sáb) | D1 (super admin: metrics + billing + audit). |
| 10 | 2026-05-31 (dom) | D2 (org admin: plantillas page + subservicios + branding + notificaciones). |
| 11 | 2026-05-31 (dom) | Z1 demo E2E + bugfix buffer. |

**Sábado-domingo 30-31 may:** confirmados como días de trabajo por el dueño (2026-05-20). Cronograma cabe sin recortar B1/D1/D2.

### 9.3 Mitigación si se desborda

Orden de descarte si el sprint no cabe (de menos crítico a más crítico):

1. D1.metrics → diferir a junio. `/platform/metrics` queda placeholder.
2. D1.billing → diferir. El plan se mantiene gestionable via Convex dashboard.
3. D2.branding → diferir. Org usa branding default.
4. B1.add-on → diferir. Clientes nuevos arrancan en mes 1 sin mid-year hasta junio.
5. § 8 UI `/platform/audit` → diferir (la tabla `documentEvents` sí se crea backend).

Lo que **NO** se descarta del beta:
- A1 (subservicios) — es estructural.
- A2 (plantillas operadora) — es el feature más visible para el dueño.
- A3 (lifecycle facturas → entregables) — es el flujo crítico para servir cliente real.
- D2.plantillas, D2.subservicios, D2.notificaciones — el operador necesita estas tres páginas o no opera.

---

## 10. Riesgos y mitigaciones

| # | Riesgo | Mitigación |
|---|---|---|
| R1 | Migración `subserviceId` opcional en 6 tablas rompe queries existentes | Backward-compat por construcción (campo opcional, fallback a `serviceId`/`serviceName`). Test E2E pre/post migración con dataset de seed. |
| R2 | Copy-on-write de plantillas crea drift silencioso entre orgs | UI muestra badge `(global vN)` vs `(org vN, basado en global vM)`. Banner si la global subió de versión: "Tu copia está basada en v3; existe v5 global. ¿Importar cambios?". |
| R3 | `selectDeliverableForMonth` con frecuencia trimestral falla en mes fiscal (no calendario) | Test específico para cada `seasonalityMode` y cada `projectionMode` (rolling vs fiscal). Cron debe leer `projections.projectionMode` para mapear `monthIndex` real. |
| R4 | `markPaid` ejecutado dos veces dispara dos generaciones | Idempotencia en `generateFromInvoice`: si ya existe `deliverable` con `triggerSource: "invoice_paid"` y mismo `invoiceId`, skip. |
| R5 | Race condition: cron eligibility + markPaid simultáneos crean entregable duplicado | Cron NO genera, solo notifica. Generación solo via `markPaid` o botón manual. Lock primario implícito. |
| R6 | Plantilla con variables inválidas falla en runtime → entregable corrupto | Validación pre-save en `mutations.update`: parse `htmlTemplate` con `templateResolver`, verificar que cada `{{key}}` declarada exista en `variables[]`. Pre-flight check antes de generar. |
| R7 | Bucket Railway falla en upload → factura queda en limbo | Try/catch en `invoices.upload`: si falla bucket, no insertar row. Cliente recibe error. Si falla post-row, mark `status: "void"` + log error. |
| R8 | Blobs huérfanos cuando se elimina cliente/proyección | Soft delete en clients/projections (`isArchived`). Cleanup job manual semanal (script CLI, no cron) para hard delete + bucket sweep. |
| R9 | Costo Claude explota con generación masiva | Engine refactor (mergeado en main) bajó costo a ~$0.50/deliverable. Cap diario por org: si excede 50 generaciones/día, requiere super admin override. Métrica visible en `/platform/metrics`. |
| R10 | `templateVersion` snapshot bloat (HTML duplicado) | Aceptable hasta ~10K deliverables. Si crece, mover a `deliverableTemplateSnapshots` separada con hash de contenido (dedup). Out-of-scope ahora. |
| R11 | Cron eligibility envía notificaciones spam si operador no las atiende | Throttle: máximo 1 email cron por cliente-mes. Si ya se mandó hoy, skip. Lookback por `documentEvents` (`severity=info`, `eventType="reminder"`). |
| R12 | Subservicio borrado mientras tiene `projectionServices` activos rompe FK | Soft delete: `subservices.isActive = false`. Mutation `delete` rechaza si hay `projectionServices` activos. UI muestra "Desactivar" no "Eliminar". |
| R13 | Operador edita plantilla que ya generó deliverables — fechas pasadas se ven afectadas | NO se afectan: `templateHtmlSnapshot` preserva el HTML usado. La edición solo aplica a generaciones futuras. UI lo explicita en banner. |
| R14 | Notificaciones a destinatarios mal resueltos (Clerk userId en lugar de email) | Sub-spec `2026-05-19-notification-recipient-resolution-design.md` ya lo resolvió. Verificar que A3 lo invoca correctamente. |
| R15 | Dos operadores editan la misma plantilla simultáneamente | `version` se incrementa por update. Si llega update con `expectedVersion: N` y la actual es `N+1`, rechazar con error de concurrencia. UI muestra "alguien más editó esta plantilla, recargá". |

---

## 11. Open questions (a resolver durante implementación)

| # | Pregunta | Sub-spec dueño | Default si no se resuelve |
|---|---|---|---|
| O1 | ¿`subservices` con `isCommission` aparte del padre o heredado? | A1 | Heredado del padre. |
| O2 | ¿Subservicio puede pertenecer a múltiples padres (servicios cross-functional)? | A1 | No. Un solo `parentServiceId`. Si el caso real aparece, crear dos subservicios espejo. |
| O3 | ¿Plantillas heredan de `subservice` o `service`? | A2 | De subservice. Si subservice no tiene, fallback a service padre. |
| O4 | ¿Cómo se borra una plantilla `org` para volver a la `global`? | A2 | Botón "Restaurar default" → `delete` el row org-scoped. |
| O5 | ¿`invoices` permite múltiples facturas por mismo cliente-mes-subservicio? | A3 | Sí, V1 manual permite duplicados; flag operador. |
| O6 | ¿`monthlyAssignments` se sigue creando para subservicios con frecuencia `una_vez`? | A3 | Sí, 12 filas; solo una termina con deliverable. |
| ~~O7~~ | ~~¿Cron eligibility corre en zona horaria de la org o UTC?~~ — **resuelto, ver §12.13** | — | — |
| O8 | ¿Add-on mid-year genera cotización separada o reabre la principal? | B1 | Cotización separada con `parentQuotationId` referencia. |
| O9 | ¿Métricas `/platform/metrics` se calculan en query (live) o tabla agregada? | D1 | Live por simplicidad; agregar tabla si > 100 orgs. |
| O10 | ¿`/platform/billing` muestra USD o MXN? | D1 | MXN (cliente es MX). USD solo en costos Claude (auditable). |
| O11 | ¿Soft delete de `subservices` cascadea a `deliverableTemplates`? | A1+A2 | No; templates pueden vivir huérfanas (deactivated). |
| O12 | ¿Branding override per-issuingCompany vs per-org? | D2 | Per-org en beta. Per-issuingCompany existe en `issuingCompanies` schema (V2 spec separado). |
| O13 | ¿Quién recibe notificación cuando `generateFromInvoice` falla? | A3 | `orgConfigs.notificationEmail` (mismo helper de notification routing). |
| O14 | ¿Cotización para add-on debe firmarse igual que la principal? | B1 | Sí, mismo flow. Hash separado. |
| O15 | ¿`documentEvents` tiene retención (TTL)? | A3 | No en beta. Retención manual via cleanup script post-junio. |

---

## 12. Decisiones tomadas en este spec (resumen ejecutivo)

Listado verbatim de las decisiones bloqueantes resueltas para que A1/A2/A3 no
las re-litiguen:

1. **Versionado de plantillas:** snapshot por valor en cada deliverable (`templateId`, `templateVersion`, `templateHtmlSnapshot`). Plantillas son mutables pero los deliverables generados son inmutables y auditablemente reproducibles.

2. **Plantillas: global vs org-scoped:** defaults globales con `orgId: null`, editables solo por super admin. Copy-on-write **explícito** (botón "Personalizar para mi org" — simetría con subservicios A1, confirmado 2026-05-20). Si la org no personaliza, sigue recibiendo updates del global cuando super-admin lo actualiza. Si personaliza, su copia diverge y deja de recibir updates (banner en UI muestra "v3 personalizada · v5 global disponible"). El resolver prefiere copia org-scoped sobre global.

3. **Mid-year add-on:** prorrateo **calendario** (julio→diciembre), no proporcional 12 meses. La renovación anual unificada cae el 1-ene. Cotización suplementaria separada con `parentQuotationId`.

4. **Plantilla `"invoice"` en enum:** se añade el literal `"invoice"` a `deliverableTemplates.type` desde ya, aunque no se use en beta. Evita migración cuando V2 FacturAPI se prenda.

5. **`triggerSource` en `deliverables`:** se añade el campo opcional con union `"manual" | "cron" | "invoice_paid" | "api"`. Backfill `null` para legacy; audit dashboards filtran por presencia.

6. **`subserviceId` opcional en tablas:** una sola migración añade `subserviceId: v.optional(v.id("subservices"))` a `projectionServices`, `monthlyAssignments`, `quotations`, `contracts`, `deliverables`, `deliverableTemplates`. Backfill `null`. Dual-matching (`subserviceId` preferido, fallback `serviceId`+`serviceName`).

7. **Rol `"operator"` en Clerk:** se define el rol custom ya, mapeado internamente a `org:admin`. Permite separación futura sin migración Clerk.

8. **Frecuencias granulares por cliente:** **diferidas a junio**. En beta solo `subservices.defaultFrequency`. `selectDeliverableForMonth` deja hook `getOverride()` que en beta siempre retorna `null`, swap trivial en junio.

9. **Cron eligibility en beta:** NO genera entregables; solo manda recordatorios al operador. El gate humano "marcar factura pagada" se preserva como trigger explícito.

10. **`monthlyAssignments` con 12 filas siempre:** se mantiene por compatibilidad con engine y UI. Frecuencias variables manifiestan en que algunos meses simplemente no producen `deliverable`. Refactor a `documentSchedule` queda para post-beta.

11. **`documentEvents` en beta:** tabla y wrapper sí se crean. UI `/platform/audit` minimalista (tabla + filtros básicos). UI rica diferida a junio.

12. **Mini-CRM y pipeline visual:** diferidos a junio. Beta usa email cron simple y `/clientes/[id]/ciclo` existente.

13. **Timezone del cron eligibility (ex-O7):** campo opcional `orgConfigs.timezone` (string IANA, ej. `"America/Mexico_City"`). Default si vacío: UTC. A3 lo lee al evaluar qué generar HOY. Multi-tenant timezone-aware desde beta.

14. **Sábado-domingo 30-31 may como días de trabajo:** confirmado. Cronograma §9.2 no requiere recortes; B1/D1/D2 caben.

15. **Catálogo inicial de subservicios:** sujeto a validación con papá antes del seed final. A1 reserva +0.5 día para refinar la lista propuesta en §2.3 con su input operativo real.

---

## 13. Referencias

### 13.1 Archivos del codebase relevantes

- `convex/schema.ts:153-166` — `services` (los 9 padre actuales).
- `convex/schema.ts:182-210` — `monthlyAssignments` (con `invoiceStatus` enum).
- `convex/schema.ts:212-274` — `questionnaireResponses` (con `serviceNames[]`).
- `convex/schema.ts:328-367` — `deliverables` (recibe `templateVersion` y `triggerSource` en A3).
- `convex/schema.ts:407-441` — `deliverableTemplates` (recibe `subserviceId` y enum `"invoice"` en A1+A2).
- `convex/functions/services/seed.ts` — seed actual de 9 padre.
- `convex/functions/deliverableTemplates/{queries,mutations}.ts` — permisos a refactorizar (A2).
- `convex/functions/monthlyAssignments/mutations.ts:24` — `updateInvoiceStatus`, callsite del nuevo trigger (A3).
- `convex/functions/deliverables/internalQueries.ts:48` — `findTemplate`, refactor a `selectDeliverableForMonth` (A3).
- `convex/functions/deliverables/actions.ts:215` — invocación actual de `findTemplate`.
- `convex/crons.ts` — añadir `deliverable-eligibility-scan` daily (A3).
- `convex/lib/blobStorage.ts` — helper Railway (branch `feature/blob-storage-railway`, ya mergeado).
- `src/components/layout/sidebar.tsx:24-35` — navegación operadora.
- `src/components/layout/sidebar.tsx:104-119` — gate super admin para `/platform`.
- `src/app/(dashboard)/configuracion/page.tsx` — hub actual (3 cards), expandir a 9 (D2).
- `src/app/platform/page.tsx` — lista orgs.
- `src/app/platform/templates/page.tsx` — base UI para `/configuracion/plantillas` (A2).
- `src/app/(dashboard)/clientes/[id]/page.tsx` — añadir sección "Servicios contratados" (B1).
- `src/app/(dashboard)/clientes/[id]/ciclo/page.tsx` — ciclo per-cliente existente (no se reemplaza).
- `src/app/api/generate-pdf/route.ts` — puppeteer existente, reutilizar.

### 13.2 Sub-specs relacionados

- `docs/superpowers/specs/2026-05-14-bihive-prod-readiness-design.md` — maestro previo, **stale**, conservado como histórico.
- `docs/superpowers/specs/2026-05-14-deliverable-engine-refactor-design.md` — engine refactor ya mergeado a main; reduce costo Claude a ~$0.50/deliverable.
- `docs/superpowers/specs/2026-05-19-notification-recipient-resolution-design.md` — destinatarios de notificaciones (cliente vía `contactEmail`, ejecutivo vía `orgConfigs.notificationEmail`). Vigente; A3 lo integra.
- `docs/superpowers/specs/2026-05-20-client-documents-tab-design.md` — pestaña "Documentos" en client detail. Complementa pero no bloquea este maestro; ejecutable en paralelo con B1.
- `docs/superpowers/specs/2026-04-24-section-3b-quotation-accept-decline-design.md` — cotización accept/decline base; sigue siendo válido para el flujo del cliente externo, solo cambian las refs (`projectionServiceId` + `subserviceId`).
- `docs/superpowers/specs/2026-05-12-master-questionnaire-design.md` — bloqueado por contenido de papá, no afecta el sprint.

### 13.3 Memorias del proyecto relevantes

- `project_blob_storage` — Railway bucket = source of truth para blobs.
- `project_firma_provider` — Firmame (no MiFiel) es el provider activo.
- `project_cuestionario_unificado` — un solo cuestionario por proyección.
- `project_sprint_v2_timeline` — target 31-may; backlog real en ClickUp `901326450292`.

---

**Fin del spec maestro revisado.** Los sub-specs A1, A2, A3, B1, D1, D2 se
brainstormearán como specs normales antes de su implementación. Este maestro
es el mapa: define qué, en qué orden, con qué dependencias, y deja resueltas
las decisiones bloqueantes para que cada sub-spec arranque ya cargado.
