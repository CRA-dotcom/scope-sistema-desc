---
section: 7
title: Testing strategy
created: 2026-04-22
status: draft
sprint: projex-v2-15may
baseline_tests: 61
target_tests: 90
---

# 7. Testing strategy — Projex v2 sprint (deadline 2026-05-15)

Esta sección define la estrategia de pruebas para el sprint v2, montada sobre los 61 tests que ya pasan en el MVP. Asume las secciones 1-6 del design doc como contrato fijo. La prioridad rectora es: **cero fuga cross-tenant** y **cero discrepancia de monto entre cotizacion/contrato firmado**, dado que el sprint v2 va a producción con ~50 clientes reales en mayo.

## 7.1 Pirámide de pruebas

El modelo recomendado es una pirámide **70 / 25 / 5** pensada para un stack Convex + Next.js:

| Nivel | % objetivo | Velocidad | Qué se prueba aquí |
|---|---|---|---|
| Unit (Vitest, mocks) | 70% | <5 ms/test | Reglas de negocio puras: motor de proyección (FE, distribución de presupuesto, comisiones), resolución de templates (cadena de fallback `(orgId, issuingCompanyId, serviceId) → (orgId, *, serviceId) → (*, *, serviceId)`), dedup de cuestionario unificado, parsing de webhooks MiFiel/Resend, validación de HMAC en `accept/decline` links, render de variables `{{issuing.*}}` y `{{questionnaire.*}}`, validación de RFC, mapeo SAT concepto → servicio. |
| Integration (convex-test) | 25% | 50-500 ms/test | Queries/mutations reales contra DB in-memory de Convex: se verifica que los **índices nuevos** se respeten, que el **filtering por `orgId`** sea transversal, y que las transacciones de pipeline (cotización → contrato) preserven invariantes. |
| E2E (Playwright smoke) | 5% | 5-30 s/test | Sólo golden paths críticos: (1) cliente → cuestionario público → cotización → accept → contrato MiFiel → firma → entregables; (2) multi-tenant isolation real entre dos orgs; (3) export Excel. |

**Justificación de la proporción**: el valor financiero/legal del sistema reside en la corrección determinística (formulas de proyección, integridad de montos, aislamiento). Esas propiedades se prueban baratas y rápidas en unit. Convex integration cubre lo que unit no puede ver: índices, reglas de autorización, paginación. E2E es costoso, flakey con webhooks externos, y redundante si unit+integration están bien. Mantenemos E2E en mínimo vital.

## 7.2 Herramientas

| Capa | Herramienta | Estado | Notas |
|---|---|---|---|
| Unit | **Vitest** | ya instalado (MVP) | Se mantiene. `vitest --coverage` con provider `v8`. |
| Convex integration | **`convex-test`** (oficial) | a instalar | Requiere `npm i -D convex-test` y `setup.ts` que exponga `convexTest(schema, modules)`. Setup mínimo propuesto en `convex/__tests__/helpers/harness.ts` (propuesto). |
| E2E | **Playwright** | a instalar | Elegido sobre Cypress por mejor soporte multi-context (dos orgs en el mismo test), mejor manejo de webhooks mockeables vía `route.fulfill()`, y ejecución headless más rápida en CI. |
| Coverage | **`@vitest/coverage-v8`** | a instalar | Meta: 70% líneas en `convex/functions/**`, 50% líneas en `src/app/**`, branch >65% en `convex/functions/**` (ideal). |
| HTTP mock | **MSW** (Mock Service Worker) | a instalar | Para interceptar llamadas a Anthropic, Resend y MiFiel sin tocar red. Unifica stubs entre unit y integration. |

**Snapshot testing de PDFs — decisión**: **NO** snapshot del binario PDF. Los binarios generados por Puppeteer varían por versión de Chromium, fonts disponibles en el host, y fechas embebidas. En su lugar, snapshot del **HTML intermedio** justo antes de entrar a Puppeteer (`pdf.generateHtml(template, vars) → string`). Esto captura la lógica de template resolution y variable rendering sin falsos positivos por renderizado. La validación visual del PDF queda como smoke test manual (sección 7.8).

**Si el tiempo no alcanza para E2E real**: plan B es 2-3 Playwright smoke tests que ejerciten UI + API real de staging, más checklist manual de sección 7.8. No intentar E2E completo de todos los flujos.

## 7.3 Multi-tenant isolation — no-negociable

Suite dedicada **propuesta**: `convex/functions/__tests__/multiTenantIsolation.test.ts`.

Los 8 casos críticos (ninguno opcional para 15-may):

1. **Query cross-org vacío**: Con sesión en `orgA`, `clients.list()` no devuelve clientes de `orgB` aunque existan en DB.
2. **Mutation con ID ajeno falla**: Con sesión en `orgA`, `projections.update({id: <projId de orgB>})` lanza `Unauthorized`, no silencia.
3. **Storage aislado**: `storage.getUrl(<storageId subido por orgB>)` desde sesión `orgA` falla. Aplica a PDFs de cotización, contrato firmado, branding logo.
4. **Token público de cuestionario**: `/q/[token]` con `token` de `orgA` sólo expone ese cuestionario. No listar otros. No permitir submit de respuestas a otro questionnaire ID aunque el token sea válido.
5. **HMAC accept/decline idempotente y scoped**: `accessToken` firmado para `quotationId X` no sirve para `quotationId Y`. Además: consumible una sola vez (segundo click devuelve estado actual, no re-ejecuta la transición).
6. **Roles**: `Ejecutivo` no puede acceder a admin endpoints (`orgConfigs.update`, `issuingCompanies.delete`). `Admin` sí dentro de su org. `Super Admin` (flag interno) sí cross-org.
7. **Webhook routing por `orgId`**: Webhook de Resend/MiFiel con `metadata.orgId = orgA` nunca escribe en tablas de `orgB`, aunque el `providerMessageId` colisione.
8. **Índices compuestos con `orgId` como prefijo**: queries hacia `quotations.by_org_and_status`, `contracts.by_org_and_client`, `emailLog.by_org_and_status` rechazan ejecuciones sin filtro de `orgId`. Se valida mediante un lint custom (propuesto) o test que inspeccione las queries generadas.

**Fixture helper** (propuesto): `createTestOrg(orgId, {clients: N, projections: N, issuingCompanies: N})` en `convex/__fixtures__/orgSeed.ts`. Devuelve un handle con IDs para encadenar aserciones.

## 7.4 Integraciones externas — mocking estratégico

### Claude API (Anthropic)

Elección: **MSW** interceptando `https://api.anthropic.com/v1/messages`. El SDK oficial no expone un mock interceptor estable, y MSW cubre tanto unit como integration.

Escenarios obligatorios (`convex/functions/deliverables/__tests__/actions.test.ts` propuesto):
- (a) **Respuesta válida**: retorna JSON esperado. Se valida que `aiLog` inserta fila con `model`, `inputTokens`, `outputTokens`, `costUsd`.
- (b) **Timeout**: MSW retrasa 60s (o aborta). Action debe reintentar hasta `maxRetries=3`. Tras 3 fallos, `aiLog.status="failed"` y `errorMessage` poblado.
- (c) **Error 429**: respuesta con `retry-after`. Debe respetarse backoff exponencial antes del retry.
- (d) **Cost tracking acumulado**: 3 llamadas en el mismo deliverable suman `costUsd` en `aiLog` agregado por `deliverableId`.

Tests con Anthropic se skippean si `ANTHROPIC_API_KEY` está ausente en CI local (ver 7.10).

### Resend

Mock de `resend.emails.send()` vía MSW sobre `https://api.resend.com/emails`.

Escenarios:
- **Envío OK** → `emailLog.status="sent"`, `providerMessageId` poblado.
- **Envío falla** (422/500) → `emailLog.status="failed"`, `errorMessage` poblado. Mutation no lanza; error queda en log.
- **Webhook `email.delivered`** → `emailEvents` inserta row, `emailLog.status="delivered"`.
- **Webhook `email.bounced`** → `emailLog.status="bounced"`, flag en cliente para alertar al ejecutivo.

### MiFiel

Mock MSW de endpoints de firma.

Escenarios:
- **Contrato enviado** → status `sent`, `mifielDocumentId` poblado.
- **Webhook firmado válido** (HMAC OK) → `contracts.status="signed"`, `signedAt=<timestamp>`, `signedPdfStorageId` descargado y guardado.
- **Webhook HMAC inválido** → endpoint retorna 401, tabla no se modifica, `emailEvents` registra intento sospechoso.
- **Webhook re-enviado por MiFiel** (idempotencia) → segundo evento `signed` no re-descarga ni re-dispara acciones downstream.

### Clerk Organizations

Stub manual del context de Convex: helper `withAuth({orgId, userId, role})` que setea `ctx.auth.getUserIdentity()` con claims correctos. No se usa JWT real; se usa el shim oficial de `convex-test` `t.withIdentity({subject, tokenIdentifier, ...})`.

## 7.5 Test data factories

Archivo propuesto: `convex/__fixtures__/factories.ts`. Cada factory acepta `overrides` para casos negativos.

Factories requeridas (19 tablas):

| Factory | Firma propuesta | Notas |
|---|---|---|
| `makeOrg()` | `({name?, plan?}) → OrgDoc` | Genera `orgId` sintético tipo `org_test_<nanoid>`. |
| `makeUser(orgId)` | `({email?, role?}) → UserDoc` | Rol default `Admin`. |
| `makeClient(orgId)` | `({rfc?, email?}) → ClientDoc` | RFC default válido `XAXX010101000`. |
| `makeProjection(orgId, clientId)` | `({year?, services?}) → ProjectionDoc` | |
| `makeProjectionService(projectionId)` | `({serviceId, weight?, basePrice?}) → Doc` | |
| `makeMonthlyAssignment(projectionServiceId)` | `({month, amount}) → Doc` | |
| `makeService(orgId)` | `({name?, category?}) → ServiceDoc` | |
| `makeOrgConfig(orgId)` | `(overrides) → Doc` | |
| `makeOrgBranding(orgId)` | `({logoStorageId?, colors?}) → Doc` | |
| `makeQuestionnaire(orgId, projectionId)` | `({token?, responses?}) → Doc` | |
| `makeQuotation(orgId, projectionId)` | `({status?, amount?}) → Doc` | |
| `makeContract(orgId, quotationId)` | `({status?}) → Doc` | |
| `makeDeliverable(orgId, projectionId)` | `({kind?, status?}) → Doc` | |
| `makeDeliverableTemplate(orgId)` | `({body?, variables?}) → Doc` | |
| `makeAiLog(orgId, deliverableId)` | `({model?, tokens?}) → Doc` | |
| **`makeIssuingCompany(orgId)`** | `({rfc?, isDefault?}) → Doc` | RFC default `ABC010203XY1`. |
| **`makeServicesIssuingCompanyMap(orgId, serviceId, issuingCompanyId)`** | `() → Doc` | |
| **`makeClientIssuingCompanyOverride(orgId, clientId, issuingCompanyId)`** | `() → Doc` | |
| **`makeEmailLog(orgId)`** | `({direction?, status?}) → Doc` | |
| **`makeEmailEvent(emailLogId)`** | `({type?}) → Doc` | Tipo default `delivered`. |
| **`makeOrgIntegration(orgId, provider)`** | `({apiKey?}) → Doc` | Provider ∈ `resend|mifiel|anthropic`. |
| **`makeSatConcept()`** | `({clave?, descripcion?}) → Doc` | Catálogo global (sin `orgId`). Seed con 10-15 conceptos reales (p.ej. `84111506 — Servicios de facturación`). |

**Datos mexicanos reales de test**:
- RFCs válidos de prueba: `XAXX010101000` (persona genérica SAT), `XEXX010101000` (extranjero genérico), `ABC010203XY1` (persona moral sintética).
- CPs de CDMX: `06700` (Roma Norte), `03100` (Del Valle), `11000` (Lomas).
- Claves SAT reales del catálogo `c_ClaveProdServ`: usar 10 seleccionadas por sección 5 del design doc.

## 7.6 Tests específicos por sección del sprint

### Sección 1 — Schema multi-tenant

1. Migrations (scripts de backfill) corren sin error contra un snapshot de DB con datos MVP (clientes, proyecciones, quotations previas).
2. Índices nuevos (`issuingCompanies.by_org_and_default`, `emailLog.by_org_and_status`, `satConcepts.by_clave`) son usados por las queries del sprint v2 — verificar con `t.explain()` del harness o inspección de plan.
3. Campos añadidos a tablas existentes (`quotations.issuingCompanyId`, `contracts.issuingCompanyId`) son `optional()` para no romper docs previos.
4. Docs MVP (sin `issuingCompanyId`) siguen siendo legibles por queries del v2 (backwards compat).

### Sección 2 — CRUD empresas facturadoras

1. Crear empresa con RFC válido OK; con RFC inválido (formato, longitud) → `ValidationError`.
2. **Sólo una `isDefault=true` por org**: constraint a nivel de mutation — al marcar una nueva como default, la anterior se degrada en la misma transacción. Test: crear 3, marcar la 2ª como default, verificar que sólo la 2ª quede en `true`.
3. Soft-delete via `isActive=false` mantiene FK históricas; quotations pasadas con `issuingCompanyId` de empresa desactivada siguen renderizando su PDF histórico correctamente.
4. Cross-org: sesión en `orgA` no puede listar, leer ni modificar empresas de `orgB` (cubierto también en 7.3).
5. UI settings: form de creación bloquea submit hasta RFC, razón social y régimen fiscal llenos.
6. Upload de logo específico de empresa facturadora se asocia a `issuingCompanies.logoStorageId`, no a `orgBranding`.

### Sección 3 — Pipeline cotización → contrato

1. **Flujo completo mock**: generar cotización → `email.send()` mockeado → accept link HMAC válido → crear contrato → `mifiel.send()` mockeado → webhook firmado → contrato `signed` + signed PDF en storage.
2. **Link accept/decline expirado**: `expiresAt < now` → responde 410 y no crea contrato.
3. **Doble click en accept es idempotente**: segundo request retorna 200 con estado actual (`accepted`), no crea segundo contrato, no dispara segundo email.
4. **MiFiel webhook HMAC inválido**: endpoint responde 401, tabla `contracts` no se muta, queda log en `emailEvents` con flag de seguridad.
5. **Monto en contrato === monto en cotización aceptada**: test propiedad — para cualquier quotation, `contract.amount === quotation.acceptedAmount`. Bloqueante por riesgo legal.
6. **Resend bounce del email de cotización**: `emailLog.status="bounced"` dispara notificación al ejecutivo (no silencia).

### Sección 4 — Templates por empresa

1. **Resolution chain**: sin template `(orgId, issuingCompanyId, serviceId)` → cae a `(orgId, null, serviceId)` → cae a `(null, null, serviceId)` (seed). Verificar los 3 niveles.
2. **Variables `{{issuing.*}}`** renderean con datos de la empresa correcta según la resolución (no de la default si hay override).
3. **Template clonado** (org copia del seed global) nace con `version=1` y no muta el seed original.
4. **Edición crea nueva versión**: update no sobreescribe; `version` incrementa, `supersededBy` apunta al nuevo.
5. **Render con variable faltante**: `{{questionnaire.ingresosAnuales}}` cuando no fue contestada → renderiza placeholder `[SIN RESPUESTA]` en lugar de string vacío.
6. **XSS en variables**: valor de cliente con `<script>` se escapa antes de entrar al HTML intermedio.

### Sección 5 — Proyección SAT + Excel

1. **Export `.xlsx`**: N servicios activos → N filas en hoja "Servicios". Totales de hoja "Resumen" cuadran con sum de "Servicios" ± $0.01 por redondeo.
2. **Formato moneda MXN** intacto al abrir en Excel/Numbers: celdas con `numFmt="$#,##0.00"` y valor numérico, no string.
3. **Concepto SAT por fila** corresponde al `servicesIssuingCompanyMap.satConceptClave` del assignment real.
4. **Multi-empresa**: cuando la proyección tiene servicios asignados a 2 empresas facturadoras, la hoja "Facturación" separa por `issuingCompany` con subtotales.
5. **Exportar proyección vacía** (sin assignments) → archivo válido con hojas y encabezados, sin filas. No crashea.
6. **FE (Factor de Estacionalidad)**: para cualquier proyección con 12 meses, `sum(FE) === 12.0 ± 0.001`. Regression desde MVP.

### Sección 6 — Cuestionario unificado

1. **Dedup**: una respuesta (`questionId="ingresosAnuales"`) alimenta N `projectionServices` que la listen en su `requiredQuestions[]`. Un solo render en UI, una sola escritura.
2. **Token público scoped**: `/q/<tokenA>` sólo expone preguntas/respuestas de `questionnaireA`; intento de submit con `questionnaireId` diferente en payload → 403.
3. **Autosave race condition**: dos tabs abiertas del mismo cuestionario, ambas escriben a la misma pregunta — last-write-wins con `updatedAt` server-side y sin perder data en otras preguntas.
4. **Render de `{{questionnaire.foo}}` no contestado** → placeholder, no `undefined` ni string vacío (cubre con sección 4 caso 5).
5. **Llenar por teléfono** (modo ejecutivo): mismo endpoint que público, pero con `ctx.auth` seteado y sin validar token. Respuestas quedan marcadas `source="phone"`.
6. **Completeness**: cuestionario marca `completed=true` sólo cuando todas las preguntas requeridas de todos los servicios dedupeados están contestadas.

## 7.7 Regression suite

- Los **61 tests existentes** deben seguir pasando. Cualquier PR del sprint v2 que los rompa no se mergea.
- **CI pipeline** (propuesto `.github/workflows/ci.yml`): GitHub Actions con matrix `node: [20, 22]`. Steps: `npm ci` → `npm run typecheck` → `npm test -- --coverage` → upload coverage artifact.
- **Pre-commit hook con Husky** (propuesto): `npx lint-staged` corre Vitest sobre archivos modificados + `tsc --noEmit`. Rápido (<15 s) para no estorbar.
- **Pre-push hook**: suite completa de unit + convex-test. E2E sólo corre en CI nightly o manual.

## 7.8 Smoke tests pre-deploy (15-may AM)

Checklist manual en staging, ejecutado por Christian + Papá (dual sign-off). Cada ítem es binario.

| # | Acción | Criterio de aceptación |
|---|---|---|
| 1 | Login Clerk con usuario `admin@orgA` | Dashboard carga, user/org correctos en header |
| 2 | Crear cliente + proyección con 3 servicios | Aparecen en lista; totales calculados |
| 3 | Generar cuestionario y llenarlo como cliente vía `/q/<token>` | Submit OK; `completed=true` |
| 4 | Generar cotización PDF y enviarla por email | PDF abre con datos correctos; `emailLog.status="sent"`; email recibido en inbox de prueba |
| 5 | Aceptar cotización desde link del email | Redirige a página de confirmación; `status="accepted"` |
| 6 | Generar contrato, enviar a MiFiel, firmar en sandbox | Webhook llega; `contract.status="signed"`; signed PDF descargable |
| 7 | Generar entregables con AI (requiere `ANTHROPIC_API_KEY`) | Deliverable creado; `aiLog` con tokens/costo |
| 8 | Export Excel de la proyección | Archivo descarga; abre en Excel sin error; totales cuadran |
| 9 | Logout y login con `admin@orgB` | No se ven clientes/proyecciones/contratos de orgA en ninguna lista |
| 10 | Multi-empresa: cotización de servicio mapeado a `issuingCompanyB` usa template y RFC de B | PDF muestra datos de B, no de default |

Cualquier fallo en 1-10 → NO deploy. Postponer a 16-may máximo.

## 7.9 Meta cuantitativa

| Categoría | Métrica | Valor |
|---|---|---|
| **Mínimo aceptable 15-may** | Tests passing | 90 (61 existentes + 30 nuevos) |
| | Tests nuevos distribución | 8 multi-tenant isolation + 6 cotización→contrato + 6 cuestionario + 4 templates + 3 issuing companies + 3 Excel |
| | Coverage líneas `convex/functions/**` | ≥60% |
| **Ideal** | Tests passing | 120 |
| | Coverage líneas `convex/functions/**` | ≥70% |
| | Coverage branch `convex/functions/**` | ≥65% |
| | Coverage líneas `src/app/**` | ≥50% |
| **No negociable** | Los 8 casos de multi-tenant isolation de 7.3 | 100% passing |
| | Test "monto contrato === monto cotización aceptada" (7.6 §3 caso 5) | passing |
| | Test "MiFiel webhook HMAC inválido rechaza" (7.6 §3 caso 4) | passing |

La meta original S9-09 de 81+ tests se reemplaza por este 90. Es realista dado el scope del sprint v2 y el track bottom-up con dummy data.

## 7.10 CI/CD y blockers conocidos

- **`ANTHROPIC_API_KEY` faltante en `.env.local`** (bloqueante listado en MOC): tests que lo requieran se skippean con `describe.skipIf(!process.env.ANTHROPIC_API_KEY)`. CI falla SOLO si la key está presente y el test no pasa. Pipeline prod de GitHub Actions sí la define como secret.
- **Crons deshabilitados** (`convex/crons.ts` comentado): tests de cron-triggered logic (`cron/monthlyCheck.ts`, `cron/overdueCheck.ts`) se ejecutan vía llamada directa a la mutation/action subyacente, NO simulando el scheduler. Al reactivarse los crons post-15-may, agregar un integration test que valide el registro en `crons.ts`.
- **`CLERK_JWT_ISSUER_DOMAIN` hardcodeado**: tests no dependen del issuer real; se mockea `ctx.auth.getUserIdentity()` con el helper de convex-test.
- **MiFiel sandbox**: key de sandbox debe estar en `.env.test` (no en repo). Tests E2E de firma corren sólo si está presente.
- **Storage**: `convex-test` expone `t.storage` in-memory; no se pega a Convex cloud storage real en unit/integration.

## 7.11 Qué NO se prueba (out-of-scope 15-may)

- Performance / load testing — NO
- Penetration testing / security formal — NO (sólo review manual de HMAC y headers)
- Accessibility audit con axe / Lighthouse — NO
- Cross-browser E2E completo (Firefox, Safari, Edge) — NO; sólo Chromium en Playwright smoke
- PDF binary snapshot diff — NO (sólo HTML intermedio, ver 7.2)
- Validación contra PAC real del SAT — NO (conceptos SAT se validan contra catálogo estático seeded)
- Stress testing de webhooks (volumen) — NO
- Pruebas de migración desde instalaciones previas fuera del MVP — NO

Todo lo anterior se agenda para un sprint post-GA (junio 2026+).

## 7.12 Orden de implementación dentro del sprint

| Semana | Fechas | Entregables de testing |
|---|---|---|
| Semana 1 | 21-27 abr | Factories (`convex/__fixtures__/factories.ts`) + 8 tests multi-tenant isolation + tests de schema nuevo (migrations, índices). Setup de `convex-test`, MSW y Playwright en CI. |
| Semana 2 | 28 abr-4 may | Tests pipeline cotización→contrato (Resend+MiFiel mocks) + tests de templates (resolution chain) + tests de cuestionario (dedup, autosave, token público). |
| Semana 3 | 5-14 may | Tests export Excel + Playwright smoke E2E (2-3 flujos) + regression completa + coverage report + ajuste de gaps. Swap dummy → real data (día 5-may en adelante). |
| 15-may AM | | Smoke checklist manual (7.8) en staging → deploy si 10/10 pasan. |

---

**Dependencias con otras secciones**:
- Sección 1 debe cerrar nombres finales de índices para que los tests de 7.6 §1 caso 2 tengan target fijo.
- Sección 3 debe definir el formato exacto del HMAC de accept/decline (algoritmo, TTL, payload) antes de semana 1 para que 7.3 caso 5 sea escribible.
- Sección 4 debe publicar el contrato de resolution chain (orden exacto de fallbacks) antes de semana 2.
- Sección 6 debe fijar el schema de `questionnaires.responses` y la regla de dedup antes de semana 2.

Si alguna de estas dependencias se retrasa, los tests correspondientes se corren en modo "skeleton" (describe.todo) y se completan en semana 3 — con riesgo de comer buffer del smoke final.
