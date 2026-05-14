# BiHive-2 Production Readiness — Spec Maestro

**Date:** 2026-05-14
**Sprint:** v2 (production launch with real clients)
**Owner:** Christian
**Status:** Approved (pending user spec review)
**Source de los 13 items:** `~/Documents/Obsidian Vault/01 - Proyectos/DESC/2026-05-13 - meeting - bihive-review-2.md`

---

## Context

El 2026-05-13 hubo una segunda llamada de revisión con BiHive sobre el flujo end-to-end de Projex. Durante la prueba con datos reales salieron 13 items priorizados (4 críticos rojos, 3 altos, 3 medios, 3 menores), todos con due interno 2026-05-14.

Algunos items ya están resueltos en código (proyecciones-bugs-A mergeado), otros tienen specs preescritos pero sin ejecutar (section-3b-quotation-accept-decline, master-questionnaire), y varios son completamente nuevos (lifecycle de entregables, banco de servicios, bucket de almacenamiento).

Este spec **NO** es un diseño detallado de implementación. Es el **mapa**: define qué subsistemas conforman "production-ready", en qué orden se atacan, qué sub-specs se escribirán just-in-time, y qué queda en backlog para post-sprint. Cada sub-proyecto se diseñará en su propio spec antes de ejecutarse.

## Goals

1. Llevar Projex a "production-ready" para servir clientes reales del desk de papá.
2. Resolver los 4 críticos rojos de BiHive-2 (#1-#4) en máximo 2 semanas.
3. Resolver 3 altos (#5-#7) antes del fin del sprint.
4. Documentar medios/menores (#8-#13) como backlog priorizado.
5. Mantener consistencia arquitectónica con decisiones ya tomadas: blob storage en Railway, firma con Firmame, multi-tenant via Clerk Organizations, Convex como source of truth de DB.

## Non-Goals (de este spec maestro)

- Detalles de implementación de cada subsistema (eso vive en sub-specs).
- WhatsApp notifications (backlog).
- Integración con Firmame para contratos (post-sprint).
- Migración de proyecciones legacy al nuevo `serviceCatalogItemId` (backward-compat solo).
- Master-questionnaire de 150 preguntas (bloqueado por contenido de papá; este sprint solo agrega 2 deltas).

## Decisiones arquitectónicas globales (aplican a todos los sub-proyectos)

| Decisión | Por qué |
|---|---|
| Blob storage en Railway bucket `efficient-thermos` | Separa escalado: Convex paga por DB (crítico), Railway paga por blobs (barato/elástico). Ver `project_blob_storage` memory. |
| Convex DB = source of truth para metadata | PDFs/facturas/docs viven en Railway, sus metadatos (key, url, timestamps) viven en Convex. |
| Multi-tenant key namespace: `{{orgId}}/{{clientId}}/{{tipo}}/...` | Un solo bucket sirve todas las orgs sin colisiones; cleanup por org fácil. |
| URLs firmadas para entrega al cliente | Resend manda links de Railway con expiración (~7 días); revocable. |
| Firmame para contratos | Decisión vigente (`project_firma_provider` memory). MiFiel está stale en docs viejos. |
| Resend para email (ya integrado) | No cambia. |
| Convex actions (no mutations) para network I/O a Railway/Claude/Resend | Mutations son sync-only en Convex. |

## Mapping de los 13 items BiHive-2 a sub-proyectos

| # | Prio | Item BiHive | Sub-proyecto | En sprint |
|---|---|---|---|---|
| 1 | 🔴 | Trigger entregable (factura → entregable) | § 3 Deliverable Lifecycle | ✅ |
| 2 | 🔴 | Lógica de selección de entregable por mes | § 3 Deliverable Lifecycle | ✅ |
| 3 | 🔴 | Bucket de almacenamiento | § 3 Deliverable Lifecycle (Railway setup) | ✅ |
| 4 | 🔴 | Módulo de cotización | § 5 Quotation Module | ✅ |
| 5 | 🟠 | Notificaciones cuestionario completo | § 6 Questionnaire Delta + Notifications | ✅ |
| 6 | 🟠 | Campos separados por red social | § 6 Questionnaire Delta + Notifications | ✅ |
| 7 | 🟠 | Banco de servicios específicos por área | § 4 Services Catalog | ✅ |
| 8 | 🟡 | Subcampos gastos variables | Master-Questionnaire (separado) | Backlog |
| 9 | 🟡 | Cargar documentos en cuestionario | Master-Questionnaire (separado) | Backlog |
| 10 | 🟡 | Selección entregables dentro de proyección (UI) | Sprint siguiente | Backlog |
| 11 | 🟢 | Signos $ y % en UI | UX polish continuo | Backlog |
| 12 | 🟢 | Módulo de contrato (Firmame) | Post-sprint, sub-spec separado | Backlog |
| 13 | 🟢 | Fix valores default en cero | Verificar si ya quedó; si no, micro-fix | Verificación pre-sprint |

---

## § 2. Prerequisito — Cierre engine-refactor

**No es item de BiHive**, pero bloquea todo. Branch actual `feature/deliverable-engine-refactor` tiene PR1+PR2 internos completos (batchFillWithClaude, saveGenerated con costos). Baja costo de Claude de ~$33 → ~$0.50 por entregable.

**Definition of done:**
- `npm test` pasa.
- PR a main creado y mergeado.
- GitNexus refresh post-merge (`npx gitnexus analyze`).

**Output:** main actualizado con engine refactor listo. Costos de Claude bajos antes de empezar a generar entregables masivamente en el sprint.

---

## § 3. Sub-proyecto 1 — Deliverable Lifecycle 🔴

**Cubre:** Items #1, #2, #3.
**Sub-spec:** `docs/superpowers/specs/2026-05-15-deliverable-lifecycle-design.md` (a escribir).

### Componentes

1. **Setup Railway bucket S3-compatible** (`efficient-thermos`)
   - Generar access keys del bucket en Railway dashboard.
   - Env vars en `.env.local` de Convex: `RAILWAY_BUCKET_ENDPOINT`, `RAILWAY_BUCKET_KEY`, `RAILWAY_BUCKET_SECRET`, `RAILWAY_BUCKET_NAME=efficient-thermos`.
   - Helper `convex/lib/blobStorage.ts`: `uploadBlob(buffer, key, contentType)` y `signedDownloadUrl(key, expiresSec)`. Action-only (network I/O).
   - SDK: `@aws-sdk/client-s3` (Railway buckets son S3-compatible).

2. **Trigger por upload de factura**
   - Nueva tabla `invoices`: `orgId, clientId, projectionId, serviceId, monthIndex, bucketKey, bucketUrl, contentType, sizeBytes, uploadedAt, uploadedBy`.
   - Mutation `invoices.uploadAndTrigger(projectionId, serviceId, monthIndex, fileBlob, manualOverride?)`:
     - Sube PDF a Railway → guarda metadata en `invoices`.
     - Encola action `deliverables.generateForInvoice`.
   - Botón manual "generar ahora" en UI = misma action sin requerir factura.

3. **Metadata de templates para selección**
   - Agregar a `deliverableTemplates`: `frequency` (`"mensual"|"trimestral"|"semestral"|"anual"|"una_vez"`), `applicableMonths` (`number[] | null`), `cooldownMonths` (`number`), `priority` (`number`).
   - Tabla `deliverableHistory` para tracking del cooldown (puede ser query sobre `generatedDeliverables` si ya tiene los campos).

4. **Selector de entregable**
   - Función pura `selectDeliverableForMonth(serviceId, monthIndex, history) → templateId | null`:
     - Filtra templates por `applicableMonths` e `isActive`.
     - Aplica reglas de `frequency` (mensual = todos, trimestral = 3/6/9/12, semestral = 6/12, anual = 12, una_vez = solo primer mes elegible).
     - Aplica `cooldownMonths` contra history.
     - Retorna el de mayor `priority`, null si ninguno aplica.

5. **Action `generateForInvoice`**
   - Llama `selectDeliverableForMonth`.
   - Si retorna template, ejecuta el engine refactorizado (de § 2) para generar el HTML resuelto.
   - Genera PDF (puppeteer, reutilizar `src/app/api/generate-pdf/route.ts`).
   - Sube PDF a Railway → guarda `bucketKey` en `generatedDeliverables`.
   - Manda email al cliente con URL firmada vía Resend.
   - Si retorna null: marca `invoices.deliverableStatus = "no_template_applicable"`, notifica al operador.

### Definition of done sub-proyecto 1

- Operador puede subir PDF de factura desde dashboard.
- Sistema crea row en `invoices`, encola job, genera entregable, guarda PDF en Railway bucket.
- Email al cliente con URL firmada del PDF.
- Botón manual "generar ahora" funciona sin factura previa.
- Tests: lifecycle completo con datos seed + test multi-tenant isolation.

**Dependencias:** § 2 (engine-refactor mergeado).

---

## § 4. Sub-proyecto 2 — Services Catalog 🟠

**Cubre:** Item #7.
**Sub-spec:** `docs/superpowers/specs/2026-05-17-services-catalog-design.md` (a escribir).

### Componentes

1. **Schema `serviceCatalog`**
   - Campos: `orgId, area, name, description, defaultPricingHint, linkedTemplateIds, isActive`.
   - `area` enum: Legal, Contable, TI, Marketing, RH, Admin, Comisiones, Logística, Construcción.

2. **Seed inicial** (`convex/functions/serviceCatalog/seed.ts`)
   - 5-10 servicios por área, 9 áreas = ~70 entradas iniciales.
   - Catálogo sugerido:
     - **Legal:** Gobierno Corporativo, Contratos, Compliance, Propiedad Intelectual, Litigios.
     - **Contable:** Estados Financieros, Conciliación Bancaria, Reporte Fiscal, Auditoría Interna.
     - **TI:** Diagnóstico Tecnológico, Implementación ERP, Ciberseguridad, Soporte.
     - **Marketing:** Plan Anual, Redes Sociales, Contenido, Branding, Performance.
     - **RH:** Reclutamiento, Nómina, Capacitación, Clima Laboral.
     - **Admin:** Manual Operativo, Procesos, Control Interno.
     - **Comisiones:** Cálculo Mensual, Reporte de Comisiones.
     - **Logística:** Rutas, Inventario, Almacén.
     - **Construcción:** Levantamiento, Avance de Obra, Bitácora.

3. **CRUD básico**
   - Queries: `list(orgId, area?)`, `get(id)`.
   - Mutations: `create`, `update`, `archive` (soft-delete).
   - UI admin en `/configuracion/catalogo-servicios`: tabla + form modal.

4. **Wiring al wizard de proyección**
   - Step 2 muestra área → expandir → servicios específicos del catálogo.
   - Proyección guarda `serviceCatalogItemId` además de `area`.
   - Backward-compat: proyecciones legacy con solo `area` siguen funcionando; `area` queda como display fallback.

### Definition of done sub-proyecto 2

- Admin puede ver, crear, editar, archivar servicios del catálogo desde UI.
- Wizard Step 2 muestra servicios específicos por área.
- Seed inicial poblado en org de Christian.
- Tests: CRUD + multi-tenant isolation.

**Dependencias:** ninguna técnica.

---

## § 5. Sub-proyecto 3 — Quotation Module 🔴

**Cubre:** Item #4.
**Sub-spec:** `docs/superpowers/specs/2026-05-19-quotation-module-design.md` (a escribir).
**Base:** Actualiza `docs/superpowers/specs/2026-04-23-section-3b-quotation-accept-decline-design.md` (abr-24, no ejecutado).

### Qué se mantiene del spec abr-24

- Tabla `quotations`: `orgId, clientId, projectionId, lineItems, totalAmount, status, accessToken, sentAt, respondedAt`.
- Email con link único firmado HMAC: cliente entra a `/cotizacion/[token]` sin login, ve PDF + botones Aceptar/Rechazar.
- Webhook `quotations.respondToQuotation` valida HMAC y actualiza estado.
- Storage del `.eml` para audit trail.

### Qué cambia / se actualiza

1. **Line items vienen del catálogo de servicios** (§ 4). Cada line: `{serviceCatalogItemId, monthlyAmount, monthCount, totalAmount}`. Lee directo de la proyección.

2. **PDF de cotización**: nuevo template `quotation-template.tsx` (react-pdf), branding de `orgBranding` ya integrado. Reusa `src/app/api/generate-pdf/route.ts`.

3. **Storage en Railway** (no Convex): PDF + `.eml` van a `efficient-thermos` bajo `{{orgId}}/{{clientId}}/quotations/{{quotationId}}/`.

4. **Trigger del flujo aguas abajo en `respondToQuotation`**:
   - `accepted` → dispara `questionnaires.generate` + email al cliente con link al cuestionario + notifica operador.
   - `declined` → marca estado, notifica operador con CTA renegociar/archivar.

5. **Contrato Firmame queda en backlog.** Cliente queda en estado `quotation-accepted` esperando que operador dispare contrato fuera del sistema por ahora.

6. **UI del operador**:
   - Botón "Generar cotización" en vista de cliente con proyección activa.
   - Preview con line items editables antes de enviar.
   - Lista de cotizaciones con estado (sent / accepted / declined / expired).

### Definition of done sub-proyecto 3

- Operador genera cotización desde proyección, edita, envía.
- Cliente recibe email → abre link → ve PDF → acepta → cuestionario auto-generado + email enviado.
- Operador recibe notificación.
- Cotización + `.eml` en Railway bucket.
- Tests: flujo E2E accept + decline + expired + HMAC inválido.

**Dependencias:** § 4 (banco de servicios) para line items.

---

## § 6. Sub-proyecto 4 — Questionnaire Delta + Notifications 🟠

**Cubre:** Items #5, #6.
**Sub-spec:** `docs/superpowers/specs/2026-05-22-questionnaire-delta-design.md` (a escribir).
**No reemplaza:** `2026-05-12-master-questionnaire-design.md` (sigue bloqueado por contenido de papá).

### Componentes

1. **Campos separados por red social**
   - Reemplazar pregunta única "redes sociales" por tres:
     - `social_instagram_handle` (text, sección "Marketing/Comercial").
     - `social_linkedin_url` (text).
     - `social_facebook_page` (text).
   - Cada una con `variableKey` separada para inyección individual en templates.
   - Si master-questionnaire spec aún no aterriza, estas tres van directo a `DEFAULT_QUESTIONS` actual.

2. **Notificación al operador al completar cuestionario**
   - Hook en `questionnaires.submitResponses`: cuando `status` cambia a `completed`, encolar action `notifications.notifyQuestionnaireComplete`.
   - Action:
     - Lee `orgSettings.questionnaireCompleteNotificationEmail`.
     - Manda email vía Resend: cliente + link al dashboard `/clientes/[id]/cuestionario` + resumen.
     - Loggea en nueva tabla `notificationsLog` (`orgId, type, recipient, sentAt, status, errorMsg?`).

3. **Config UI**
   - Campo nuevo en schema `orgSettings`: `questionnaireCompleteNotificationEmail: v.optional(v.string())`.
   - UI en `/configuracion/notificaciones`: input email + toggle on/off + botón "enviar test".
   - Validación: formato email + test exitoso requerido para activar.

4. **WhatsApp** queda en backlog (decisión de provider abierta).

### Definition of done sub-proyecto 4

- Cliente completa cuestionario → operador recibe email con resumen + link.
- Admin puede cambiar email de notificación y enviarse test desde UI.
- Cuestionario tiene 3 campos de redes sociales con `variableKey` distintas.
- Row en `notificationsLog` por cada envío.

**Dependencias:** ninguna técnica.

---

## § 7. Backlog post-sprint

Items que NO se ejecutan en este sprint pero quedan documentados con prioridad:

| # | Item | Cuándo | Owner |
|---|---|---|---|
| 8 | Subcampos gastos variables | Junto con master-questionnaire | Christian + papá (contenido) |
| 9 | Cargar documentos cuestionario | Cuando se ejecute master-questionnaire | Christian |
| 10 | Selección entregables dentro de proyección (UI) | Sprint siguiente | Christian |
| 11 | Signos $ y % | Micro-PRs continuos | Christian |
| 12 | Módulo contrato Firmame | Post-sprint | Christian (depende de Firmame pricing) |
| 13 | Fix valores default en cero | Verificación 1h pre-sprint | Christian |

Todos quedan creados en ClickUp con tag `bihive-review-2-backlog`.

---

## § 8. Verificaciones de entrada al sprint

Antes de arrancar § 3:

- [ ] Branch `feature/deliverable-engine-refactor` mergeada a main.
- [ ] Bucket `efficient-thermos` en Railway accesible; access keys S3 generadas; env vars seteadas en `.env.local`.
- [ ] Item #13 verificado: correr wizard una vez, ver si fix en vivo persistió. Si no, micro-fix antes de § 3.
- [ ] `npm test` pasa en main.
- [ ] GitNexus index refrescado (`npx gitnexus analyze`).

---

## § 9. Testing strategy

**Por sub-proyecto:**

- § 3 lifecycle:
  - Unit: `selectDeliverableForMonth` con casos de frequency + cooldown + applicableMonths.
  - Integration: `uploadAndTrigger` → `generateForInvoice` con datos seed.
  - Multi-tenant: org A no ve invoices/deliverables de org B.

- § 4 catálogo: CRUD + multi-tenant isolation.

- § 5 cotización: E2E accept + decline + expired + HMAC inválido. Test del PDF generado (renderiza sin errores, branding correcto).

- § 6 cuestionario delta: `notifyQuestionnaireComplete` con email mock; las 3 variables de redes sociales se inyectan correctamente en una template de marketing.

**Meta del sprint:** 61 → 75+ tests pasando. (Master-questionnaire completo aporta los 6 restantes para llegar a 81+, en sprint siguiente.)

---

## § 10. Demo end-to-end (Definition of Done del sprint completo)

Un cliente real ejecuta este flujo sin que ningún paso requiera intervención manual fuera del sistema:

1. Operador entra → crea cliente real → crea proyección.
2. Step 2 del wizard: elige servicios del **banco** (§ 4).
3. Operador genera **cotización** (§ 5) → la edita → la envía.
4. Cliente abre email → ve PDF → acepta → cuestionario auto-generado y enviado.
5. Cliente completa cuestionario → operador recibe **email de notificación** (§ 6).
6. Operador sube PDF de **factura** del mes 1 (§ 3) → sistema selecciona template aplicable, genera entregable, sube PDF a Railway.
7. Cliente recibe email con URL firmada al entregable.

Si los 7 pasos funcionan con un cliente real (sugerido: tu tío Joche o BiHive como sandbox), el sprint está cerrado.

---

## § 11. Riesgos

| Riesgo | Mitigación |
|---|---|
| Railway bucket setup tarda > 30min | Backup: Cloudflare R2 (S3-compat, free tier 10GB) |
| `serviceCatalog` seed no refleja realidad del negocio | Tú o papá revisan/ajustan en UI admin antes de primera cotización real |
| Email a `contacto@<dominio>` no llega (SPF/DKIM no configurado) | Probar con email personal primero; configurar SPF/DKIM como parte del setup |
| Cotización rechazada deja cliente en limbo | Email automático al operador con CTA renegociar/archivar |
| Cliente perdido entre cotización aceptada → cuestionario | Recordatorio automático 3 días después si cuestionario sigue incompleto |
| Cooldown de templates produce mes sin entregable | UI flag visible al operador; botón "forzar generación" con override |

---

## § 12. Cronograma

| Día | Trabajo |
|---|---|
| 2026-05-14 (hoy) | § 2 cierre engine-refactor + setup Railway bucket + verificar #13 |
| 2026-05-15 — 2026-05-19 | Sub-spec § 3 lifecycle + implementación |
| 2026-05-20 — 2026-05-22 | Sub-spec § 4 banco servicios + implementación |
| 2026-05-23 — 2026-05-26 | Sub-spec § 5 cotización + implementación |
| 2026-05-27 — 2026-05-28 | Sub-spec § 6 cuestionario delta + notificaciones |
| 2026-05-29 | Demo E2E con cliente real (tío Joche o BiHive sandbox) |

**Total: 16 días.** Realista con buffer; no apretado a 7 días.

---

## Sub-specs a escribir (orden)

| # | Sub-spec | Cubre | Cuándo se escribe |
|---|---|---|---|
| 1 | `2026-05-15-deliverable-lifecycle-design.md` | § 3 | Inmediatamente después de aprobación del maestro |
| 2 | `2026-05-17-services-catalog-design.md` | § 4 | Al terminar § 3 |
| 3 | `2026-05-19-quotation-module-design.md` | § 5 | Al terminar § 4 |
| 4 | `2026-05-22-questionnaire-delta-design.md` | § 6 | Al terminar § 5 |

Cada sub-spec se brainstormea como spec normal antes de su implementación. Este maestro es solo el mapa.

---

## Links

- Source list: `~/Documents/Obsidian Vault/01 - Proyectos/DESC/2026-05-13 - meeting - bihive-review-2.md`
- Engine refactor: `docs/superpowers/specs/2026-05-14-deliverable-engine-refactor-design.md`
- Cotización base: `docs/superpowers/specs/2026-04-23-section-3b-quotation-accept-decline-design.md`
- Master-questionnaire: `docs/superpowers/specs/2026-05-12-master-questionnaire-design.md`
- DESC MOC: `~/Documents/Obsidian Vault/01 - Proyectos/DESC/DESC MOC.md`
- Memorias relevantes: `project_blob_storage`, `project_firma_provider`, `project_cuestionario_unificado`
