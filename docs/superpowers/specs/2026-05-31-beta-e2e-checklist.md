# Beta E2E Demo + Bugfix Buffer — Checklist (Z1)

**Owner:** Christian
**Día:** 11 (2026-05-31, dom) — último día del sprint v2 antes del beta con cliente real
**Duración:** 1 día (buffer + verificación)
**No es sub-spec:** Z1 NO tiene artefactos propios. La tabla `documentEvents` +
wrapper `logEvent` ya quedan en A3 (`2026-05-23-document-lifecycle-design.md`
§2.3 + §3.5), y `/platform/audit` también en A3 §4.3. D1
(`2026-05-27-super-admin-panels-design.md`, pendiente) extiende super-admin con
metrics/billing/subservicios globales pero NO duplica la página de audit.

Este archivo es solo la guía de verificación end-to-end del beta antes de
prender el switch para el cliente real.

---

## 1. Pre-flight (antes de tocar UI)

Correr en `/Users/christiandarrelcoverlozano/Desktop/Projects/DESC`:

- [ ] `git status` limpio en `main`.
- [ ] `git pull origin main`.
- [ ] `npm install` (por si A1-D2 metieron deps nuevas).
- [ ] `npm run lint` sin errores.
- [ ] `npx tsc --noEmit` sin errores.
- [ ] `npm test` (vitest) todo verde — A3 mete ~21 tests de invoices +
      documentEvents, A1 mete tests de migración subservicios, A2 tests de
      copy-on-write plantillas.
- [ ] `npx convex dev` arrancado en otra terminal sin warnings de schema.
- [ ] `npx gitnexus analyze` para refrescar el índice (CLAUDE.md hook).
- [ ] `.gitnexus/meta.json` muestra `stats.embeddings > 0` (si aplica).

### Convex env vars (deployment de beta)

Verificar con `npx convex env list --prod` que existen:

- [ ] `CLERK_JWT_ISSUER_DOMAIN` apuntando a Clerk prod.
- [ ] `APP_URL=https://<dominio-beta>` (NO localhost).
- [ ] `QUOTATION_TOKEN_SECRET` distinto al de dev (≥32 chars).
- [ ] `ANTHROPIC_API_KEY` válida (rotar después de 2026-05-14 — ver memoria).
- [ ] `RESEND_API_KEY` + `RESEND_FROM_EMAIL` con dominio verificado SPF/DKIM/DMARC.
- [ ] `RESEND_WEBHOOK_SECRET` configurado y endpoint Resend apuntado a `/api/webhooks/resend`.
- [ ] `OPS_NOTIFICATION_EMAIL` ≠ vacío (si no, cron alerts se silencian).
- [ ] `QA_SEED_ALLOWED` **NO** existe en prod.
- [ ] Railway S3 (blob storage): bucket creado, credenciales en Convex env.

### Vercel / Next env vars

- [ ] `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (prod).
- [ ] `CLERK_SECRET_KEY` (prod).
- [ ] `NEXT_PUBLIC_CONVEX_URL` + `NEXT_PUBLIC_CONVEX_SITE_URL` apuntan a deploy prod.

---

## 2. Flujo E2E manual (browser, navegador limpio / incógnito)

Hacer con un **org de prueba nuevo** creado en Clerk dashboard. NO usar el
org del dueño todavía. Cliente de prueba con email real propio para validar
los emails de Resend.

### 2.1 Crear org + miembros

- [ ] Sign-up nuevo usuario `e2e-owner@<dominio-tuyo>`.
- [ ] Crear org "E2E Test Co" desde Clerk widget.
- [ ] Invitar un segundo usuario `e2e-operator@<dominio-tuyo>` con rol Operator.
- [ ] Login con cada uno en navegadores separados — confirmar que el sidebar
      muestra/oculta secciones según rol (A2 §permisos).
- [ ] Verificar que `e2e-owner` NO ve `/platform/*` (solo super-admin).

### 2.2 Crear cliente

- [ ] `/clientes` → "Nuevo cliente". Llenar nombre, RFC, email, dirección.
- [ ] Verificar que el cliente queda con `orgId` correcto en Convex dashboard
      (tabla `clients`).
- [ ] Verificar timezone del cliente (campo `timezone` o default `America/Mexico_City`).
      **Bug típico:** si default es UTC, los meses fiscales se corren un día.

### 2.3 Crear proyección con subservicios

- [ ] `/proyecciones/nueva` → seleccionar cliente E2E.
- [ ] Configurar **modo proyección**: fiscal vs rolling. Probar fiscal con
      `fiscalYearStartMonth=4` (abril) — bug típico: el mes 1 de la
      proyección debe mapear a abril, no a enero.
- [ ] Añadir 2-3 servicios. Cada uno con 2 subservicios distintos (A1).
- [ ] Llenar `Factor de Estacionalidad` (FE) por mes — verificar que la suma
      mensual ÷ (anual ÷ 12) coincide con lo capturado.
- [ ] Llenar comisiones (% mensual).
- [ ] Guardar. Verificar que `subserviceId` queda llenado en cada row
      (no solo `serviceId`/`serviceName` legacy).

### 2.4 Cuestionario unificado (decisión papá — ver memoria)

- [ ] Si el cuestionario unificado quedó listo: cliente recibe email →
      llena un solo cuestionario que cubre todos los subservicios.
- [ ] Dedup: si dos subservicios piden el mismo dato (ej. RFC), aparece una
      sola vez.
- [ ] `questionnaires.submit` dispara `logEvent` con `eventType="submitted"`.

### 2.5 Cotización → enviar → aceptar

- [ ] Generar cotización desde la proyección.
- [ ] `quotations.send` — verificar que llega email a `e2e-owner@<dominio>`
      con link firmado HMAC (`QUOTATION_TOKEN_SECRET`).
- [ ] Click "Aceptar" → llega a página pública → confirmar → status pasa a
      `accepted`.
- [ ] **Bug típico race:** doble-click en "Aceptar". Verificar que NO crea
      dos `contracts` ni dos `logEvent` con severity error.
- [ ] Audit log (paso 2.10) muestra `quotation accepted` con
      `actorType="client"` y `actorUserId=null`.

### 2.6 Contrato firmado (Firmame — NO MiFiel)

> Provider correcto: Firmame.com (memoria `project_firma_provider.md`).
> Si los section docs del vault aún mencionan MiFiel, están stale.

- [ ] Cotización aceptada dispara generación de contrato.
- [ ] `contracts.send` envía a Firmame; webhook callback marca `signed`.
- [ ] `logEvent` con `entityType="contract"`, `eventType="signed"` visible.
- [ ] Si Firmame falla (timeout), debe haber `logEvent severity="error"`
      con metadata del error — NO 500 silencioso.

### 2.7 Subir factura → markPaid → entregable

Este es el flujo crítico de A3.

- [ ] `/facturacion` → "Nueva factura" para cliente E2E.
- [ ] Subir PDF de prueba (~200KB), llenar `amount`, `month`, `serviceId`/`subserviceId`.
- [ ] Verificar `invoices.upload` log: `eventType="uploaded"`, severity info.
- [ ] **Bug típico dup:** subir el mismo PDF (mismo hash). Debe loggear
      `severity="warning"` con `metadata={duplicateOf: ...}` y NO bloquear
      al operador.
- [ ] Marcar como pagada (`markPaid`).
- [ ] Verificar que `generateFromInvoice` corre — entregable aparece en
      `/entregables` para ese cliente/mes.
- [ ] **Idempotencia (R4):** click `markPaid` 2 veces seguidas. Solo 1
      entregable. Solo 1 `logEvent generated`.
- [ ] **selectDeliverableForMonth (R3):** si la proyección es trimestral,
      verificar que el entregable cae en el último mes del trimestre, no
      en cualquier mes random.
- [ ] El entregable se sube a Railway S3 (no a Convex storage).
- [ ] Llega email al cliente con signed URL del entregable. URL expira en
      tiempo razonable (verificar TTL del presigned).

### 2.8 markPaid void post-generación

- [ ] Tomar una factura ya pagada con entregable generado, marcar como void.
- [ ] `logEvent` con mensaje "facturada void post-generación" severity warning.
- [ ] El entregable existente **NO** se borra (audit trail — A3 §línea 534).
- [ ] El entregable queda referenciado en audit aunque la factura ya no esté
      válida.

### 2.9 Cron eligibility

- [ ] Forzar el cron (Convex dashboard → run scheduled function).
- [ ] Verificar que el cron **solo notifica** (R5), no genera nada.
- [ ] Cap 1 email/cliente/día (R1 §10 R11 referenciado en A3 línea 1262):
      correr el cron 2 veces el mismo día, segundo no manda email.
- [ ] `logEvent` con `entityType="cron"` o similar registra cada corrida.

### 2.10 Audit log `/platform/audit`

- [ ] Login con super-admin.
- [ ] Sidebar muestra link "Audit log" (`FileSearch` icon).
- [ ] Tabla muestra todos los eventos del flujo 2.1-2.9 cross-org.
- [ ] Filtro por `orgId` = "E2E Test Co" recorta a solo esos eventos.
- [ ] Filtro por `severity=error` debe estar vacío si todo salió bien.
- [ ] Filtro por `entityType=invoice` muestra upload + markPaid + (eventual void).
- [ ] Click en row expande `metadata` JSON.
- [ ] Timestamps en zona local del operador (no UTC raw).
- [ ] Paginación funciona — cargar más de 50 eventos.

---

## 3. Bugs típicos a verificar a mano

### 3.1 Timezones

- [ ] `formatLocalDateTime` (A3 §4.4) usa `Intl.DateTimeFormat` con tz del
      cliente o del operador, no UTC crudo.
- [ ] Mes fiscal vs mes calendario en `selectDeliverableForMonth`: cliente
      con `fiscalYearStartMonth=7` (julio) — el "mes 1" de la proyección
      debe ser julio en la UI y en el entregable.
- [ ] Cron corre en UTC pero notificaciones llegan en mañana local del cliente.

### 3.2 Race conditions

- [ ] Doble click en `markPaid` (cubierto 2.7).
- [ ] Doble accept de cotización (cubierto 2.5).
- [ ] Dos operadores subiendo facturas distintas para el mismo cliente/mes
      simultáneamente — ambos deben quedar; el selector escoge la "principal"
      determinísticamente.
- [ ] Cron + markPaid simultáneos (R5 ya mitigado, validar log).

### 3.3 Multi-tenant

- [ ] Login como `e2e-owner` del org A, intentar query directo a Convex
      pidiendo `clientId` del org B — debe regresar null o throw, NO data.
- [ ] `/platform/audit` solo accesible si `requireSuperAdmin` pasa.
- [ ] Buscar en código `gitnexus_query({query: "orgId filter"})` o
      `grep -r "ctx.db.query" convex/functions | grep -v "orgId"` — todas
      las queries deben filtrar por orgId (excepto las super-admin).
- [ ] Cliente del org A NO debe ver entregable del org B (probar con dos
      orgs de prueba si hay tiempo).

### 3.4 Email

- [ ] Resend dashboard muestra los emails enviados con SPF/DKIM verde.
- [ ] Bounce/complaint: simular bounce con email inválido — `logEvent`
      severity error.

### 3.5 PDF

- [ ] PDF de cotización abre sin error en Acrobat/Preview/Chrome.
- [ ] PDF de entregable carga charts (Recharts → react-pdf) correctamente.
- [ ] Tamaño razonable (<5MB para entregables mensuales).

---

## 4. Smoke tests rápidos (browser, ~10 min)

Después de cualquier hotfix último-minuto, correr estos 5 clicks:

1. [ ] Login operator → `/clientes` carga sin spinner infinito.
2. [ ] `/proyecciones` → abrir una existente → tabla render sin errores en consola.
3. [ ] `/facturacion` → modal "Nueva factura" abre y cierra.
4. [ ] Super-admin → `/platform/audit` → tabla carga con paginación.
5. [ ] Org-admin → `/configuracion/plantillas` (D2) → lista de plantillas
      carga, badge `(global)` o `(org vN)` correcto.

DevTools consola limpia (sin errores rojos, warnings amarillos OK si son
de Next dev / React 19 strict mode).

---

## 5. Pre-merge checklist

Antes del PR final a `main` (Vercel auto-deploy a prod):

- [ ] `npm run lint` ✅
- [ ] `npx tsc --noEmit` ✅
- [ ] `npm test` ✅ (vitest, todos los tests de A1+A2+A3+B1+D1+D2)
- [ ] `npm run build` ✅ localmente.
- [ ] `npx convex deploy --prod` corrido a mano (NO depender de webhook).
- [ ] Verificar en Convex dashboard prod que schema migró sin error
      (tabla `subservices`, columna `subserviceId` opcional en 6 tablas,
      tabla `invoices`, tabla `documentEvents`).
- [ ] `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` —
      cambios solo afectan los símbolos esperados (no hay drift).
- [ ] `git log --oneline main..HEAD` revisado — commits firmados, mensajes
      siguen convención `feat(area):` / `fix(area):`.
- [ ] PR description lista todos los sub-specs incluidos (A1, A2, A3, B1, D1, D2).
- [ ] PR enlaza memoria stale a actualizar después del merge:
      `project_sprint_v2_timeline.md`, `project_firma_provider.md` si Firmame
      ya está integrado.

---

## 6. Plan B si algo crítico revienta el 31-may

Orden de descarte (R1 §9.3):

1. D1.metrics → placeholder, diferir a junio.
2. D1.billing → diferir, gestionar vía Convex dashboard manualmente.
3. D2.branding → org usa branding default.
4. B1.add-on → clientes nuevos arrancan sin mid-year.
5. `/platform/audit` UI → diferir (tabla `documentEvents` sí queda backend).

**Lo que NO se sacrifica:** A1, A2, A3, D2.plantillas, D2.subservicios,
D2.notificaciones — sin estos el operador NO puede operar al cliente real.

---

## 7. Post-merge (1 jun)

- [ ] Crear org real del cliente (no E2E test).
- [ ] Onboarding: importar catálogo de subservicios validado con papá.
- [ ] Actualizar memorias stale:
  - `project_sprint_v2_timeline.md` → marcar v2 cerrado.
  - `project_firma_provider.md` → quitar warning "MOC stale" si quedó al día.
  - `project_cuestionario_unificado.md` → actualizar status según decisión final.
- [ ] Cierre del día con `cierre-del-dia` skill: sync ClickUp list 901326450292.
- [ ] Daily report del 31-may con `daily-report`.
