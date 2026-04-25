# Section 3B — Guía de Testing Manual + Automatizado

> Cobertura: feature **Quotation send + accept/decline** (commits `54ab40e..bb1f817`).
> Spec de referencia: [`docs/superpowers/specs/2026-04-24-section-3b-quotation-accept-decline-design.md`](../superpowers/specs/2026-04-24-section-3b-quotation-accept-decline-design.md).
> Estado de tests automatizados: **164/164 pass**.

## Tabla de contenidos

- [0. Pre-requisitos](#0-pre-requisitos)
  - [0.1 Variables de entorno](#01-variables-de-entorno)
  - [0.2 Estado del sistema requerido](#02-estado-del-sistema-requerido)
  - [0.3 Comandos de verificación inicial](#03-comandos-de-verificacion-inicial)
- [1. Happy Path — End-to-End](#1-happy-path--end-to-end)
- [2. Decline Flow](#2-decline-flow)
- [3. Re-envío y rotación de token](#3-re-envio-y-rotacion-de-token)
- [4. Estados de error](#4-estados-de-error)
- [5. Edge cases — bloqueos al enviar](#5-edge-cases--bloqueos-al-enviar)
- [6. Permisos](#6-permisos)
- [7. Security tests](#7-security-tests)
- [8. UI Responsive](#8-ui-responsive)
- [9. Email Log integration](#9-email-log-integration)
- [10. Test automation](#10-test-automation)
- [11. Pre-deploy checklist](#11-pre-deploy-checklist)
- [Apéndice A — Catálogo de screenshots](#apendice-a--catalogo-de-screenshots)

---

## 0. Pre-requisitos

### 0.1 Variables de entorno

Configurar en `.env.local` (Next) y en Convex Dashboard → Environment Variables:

| Variable | Scope | Notas |
|---|---|---|
| `QUOTATION_TOKEN_SECRET` | Convex | HMAC secret, **>= 32 chars**. Si rota, todos los links viejos se invalidan |
| `APP_URL` | Convex + Next | URL pública de la app (ej. `https://app.projex.io` o `http://localhost:3000`) |
| `RESEND_API_KEY` | Convex | API key global de Resend. **Opcional** si cada org configura la suya en `/configuracion/integraciones/resend` |
| `ANTHROPIC_API_KEY` | Convex | Necesario para auto-generación de contrato post-accept (Section 3C) |
| `RESEND_WEBHOOK_SECRET` | Convex | Para validar webhooks de Resend (delivered/opened/bounced). Opcional para QA |

### 0.2 Estado del sistema requerido

- Convex deployed (`npx convex dev --once` sin errores)
- Next.js dev (`npm run dev`) o build production (`npm run build && npm start`)
- Por lo menos **1 organización Clerk** activa
- **1 usuario admin + 1 ejecutivo** en la org (para tests de permisos)
- **1 cliente** con `contactEmail` configurado
- **1 proyección + projService activo** para ese cliente
- **1 cotización en estado `draft` con PDF generado** (botón "Generar PDF" en `/cotizaciones/[id]`)
- **1 empresa emitente** activa marcada como `isDefault: true` en `/configuracion/empresas-emitentes`

### 0.3 Comandos de verificación inicial

```bash
# 1. Schema y functions de Convex compilan
npx convex dev --once

# 2. Backend tests pasan (164 tests)
npm test -- --run

# 3. Build de producción limpio
npm run build
```

**Esperado:** 164/164 tests pass, build sin errores TypeScript ni warnings críticos.

---

## 1. Happy Path — End-to-End

Flujo completo desde envío hasta auto-generación de contrato.

### Paso 1 — Admin abre detalle de cotización

- **Acción:** login como admin → navegar a `/cotizaciones/[id]` (cotización en `draft`).
- **Esperado:** detalle renderea con `SendStatusPanel` ausente o gris ("No enviada"), botón **"Enviar por email"** visible y habilitado.
- **Screenshot:** `screenshots/02-quotation-detail-draft.png`
- **Posibles fallas:** botón disabled → revisar pre-requisitos (PDF, contactEmail).

### Paso 2 — Verifica botón "Enviar por email" habilitado

- **Acción:** hover sobre el botón.
- **Esperado:** sin tooltip de bloqueo. Al hacer hover, no aparece "Genera el PDF primero" ni similar.
- **Screenshot:** `screenshots/03-send-button-enabled.png`
- **Posibles fallas:** ver Sección 5 (Edge cases).

### Paso 3 — Click → SendQuotationDialog abre

- **Acción:** click "Enviar por email".
- **Esperado:** dialog abre con título "Enviar cotización", muestra email del cliente, subject prellenado (`Cotización <empresa> — <folio>` o similar), CC opcional, mensaje opcional.
- **Screenshot:** `screenshots/04-send-dialog-open.png`
- **Posibles fallas:** dialog no abre → DevTools console → revisar errores de hooks.

### Paso 4 — Email + subject prellenados

- **Acción:** verificar campos.
- **Esperado:**
  - `to` = `cliente.contactEmail` (read-only o editable según diseño)
  - `subject` con el folio de cotización
  - mensaje con plantilla por defecto (puede editarse)
- **Screenshot:** `screenshots/05-send-dialog-prefilled.png`

### Paso 5 — Click "Enviar"

- **Acción:** click el botón submit del dialog.
- **Esperado:** transición inmediata a estado loading.

### Paso 6 — Loading state

- **Esperado:** spinner visible, botón disabled, no se puede cerrar el dialog.
- **Screenshot:** `screenshots/06-send-dialog-loading.png`

### Paso 7 — Success view con link copiable

- **Esperado:** después del round-trip (1-3s típico), dialog muestra confirmación verde:
  - "Cotización enviada a <email>"
  - **link `/q/cotizacion/<token>`** visible y copiable (botón "Copiar")
  - Aviso: "Este link es la única vez que se muestra el token completo"
- **Screenshot:** `screenshots/07-send-dialog-success.png`
- **Posibles fallas:** error toast "Resend no configurado" → ir a `/configuracion/integraciones/resend`.

### Paso 8 — Refresh /cotizaciones/[id] → SendStatusPanel azul "Enviada hace X"

- **Acción:** cerrar dialog → refresh detalle.
- **Esperado:** `SendStatusPanel` ahora azul, muestra:
  - "Enviada hace X minutos"
  - Email destinatario
  - Botón cambia a **"Reenviar"**
- **Screenshot:** `screenshots/08-send-status-panel-sent.png`

### Paso 9 — Email llega al inbox del cliente

- **Acción:** revisar inbox del cliente o `/configuracion/email-log`.
- **Esperado:** email recibido con:
  - Subject correcto
  - Logo + branding de la empresa emitente
  - Botón CTA "Ver cotización" → link `/q/cotizacion/<token>`
- **Screenshot:** `screenshots/09-email-inbox.png` y `screenshots/09b-email-log-entry.png`

### Paso 10 — Cliente abre link sin auth

- **Acción:** abrir el link en ventana incógnito o navegador limpio.
- **Esperado:** página `/q/cotizacion/[token]` carga sin redirect a login.
- **Screenshot:** `screenshots/10-public-landing-loaded.png`

### Paso 11 — Verifica branding (logo, color de empresa emitente)

- **Esperado:**
  - Logo de la empresa emitente en el header
  - `primaryColor` aplicado al CTA y acentos
  - Footer con info de contacto de la empresa emitente
- **Screenshot:** `screenshots/11-public-landing-branding.png`

### Paso 12 — HTML de cotización rendereado

- **Esperado:** el contenido HTML (`quotation.content`) se muestra sanitizado vía DOMPurify. Tablas, headings, listas se ven correctos.
- **Screenshot:** `screenshots/12-public-landing-content.png`

### Paso 13 — Click "Aceptar cotización"

- **Acción:** click el CTA verde "Aceptar cotización" (sticky bottom bar en móvil).
- **Esperado:** confirmación inline o modal "¿Estás seguro?".

### Paso 14 — Confirmación

- **Esperado:** mensaje de éxito:
  > "¡Gracias! Hemos registrado tu aceptación. Te enviaremos el contrato pronto."
- **Screenshot:** `screenshots/14-public-landing-accepted.png`

### Paso 15 — Refresh dashboard → status "Aprobado"

- **Acción:** admin refresca `/cotizaciones/[id]`.
- **Esperado:**
  - Status badge cambia a verde **"Aprobado"**
  - Banner verde con timestamp de aceptación + IP del cliente (auditoría)
  - Botón "Enviar por email" oculto (status terminal)
- **Screenshot:** `screenshots/15-dashboard-approved.png`

### Paso 16 — Esperar 30s, refrescar /contratos → contract draft

- **Acción:** esperar ~30s (cron + acción internal `generateContract`) → ir a `/contratos`.
- **Esperado:** nuevo contract draft listado con referencia al `quotationId`.
- **Screenshot:** `screenshots/16-contract-list-new.png`

### Paso 17 — Click "Ver Contrato" en /cotizaciones/[id]

- **Acción:** en el detalle de la cotización, click el link al contrato auto-generado.
- **Esperado:** navega a `/contratos/[contractId]`, contract draft visible con contenido inicial.
- **Screenshot:** `screenshots/17-contract-detail.png`

---

## 2. Decline Flow

### 2.1 Decline con razón

- **Setup:** repetir pasos 1-12 del happy path.
- **Acción:** en `/q/cotizacion/[token]`, click "Rechazar cotización" → `DeclineReasonDialog` abre.
- **Esperado:**
  - Dialog con textarea opcional "¿Nos puedes contar por qué?"
  - Botón "Confirmar rechazo" (destructivo, rojo)
- **Screenshot:** `screenshots/18-decline-dialog-with-reason.png`
- **Acción:** escribir razón → confirmar.
- **Esperado:** confirmación "Hemos registrado tu rechazo. Gracias por tu tiempo." → al refrescar dashboard, status "Rechazado" con la razón visible en el panel.
- **Screenshot:** `screenshots/19-dashboard-rejected-with-reason.png`

### 2.2 Decline sin razón

- **Acción:** abrir `DeclineReasonDialog`, dejar textarea vacío, confirmar.
- **Esperado:** rechazo registrado sin razón. Dashboard muestra "Rechazado" sin texto adicional.
- **Screenshot:** `screenshots/20-dashboard-rejected-no-reason.png`

---

## 3. Re-envío y rotación de token

### 3.1 Botón cambia a "Reenviar"

- **Setup:** cotización ya enviada (status `sent`).
- **Esperado:** en detalle, botón "Enviar por email" ahora dice **"Reenviar"** y `SendStatusPanel` muestra historial.
- **Screenshot:** `screenshots/21-resend-button.png`

### 3.2 Dialog warns sobre invalidación

- **Acción:** click "Reenviar".
- **Esperado:** dialog incluye warning:
  > "Reenviar generará un link nuevo. El link anterior dejará de funcionar."
- **Screenshot:** `screenshots/22-resend-dialog-warning.png`

### 3.3 Link viejo → InvalidTokenState

- **Acción:** después de reenviar, abrir el link **viejo** (capturado en el primer envío).
- **Esperado:** `InvalidTokenState` con mensaje "Este link ya no es válido. Solicita uno nuevo a tu contacto."
- **Screenshot:** `screenshots/23-old-token-invalid.png`

### 3.4 Link nuevo → ready

- **Acción:** abrir el link nuevo.
- **Esperado:** landing carga normalmente, en estado `sent` (listo para aceptar/rechazar).
- **Screenshot:** ver paso 10 del happy path.

---

## 4. Estados de error

### 4.1 Token expirado

- **Setup:** en Convex Dashboard, editar manualmente el doc en `quotations`, cambiar `tokenExpiresAt` a un timestamp pasado (ej. `Date.now() - 1000`).
- **Acción:** abrir el link.
- **Esperado:** estado `ExpiredTokenState`:
  > "Este link expiró el <fecha>. Contacta a tu asesor para recibir uno nuevo."
- **Screenshot:** `screenshots/24-expired-token-state.png`

### 4.2 Token inválido

- **Acción:** navegar a `/q/cotizacion/garbage_random_string_xyz`.
- **Esperado:** `InvalidTokenState` (heading "Link no válido").
- **Screenshot:** `screenshots/01-invalid-token-state.png` *(ya capturado)*

### 4.3 Already responded

- **Setup:** cotización ya en estado `approved` o `rejected`.
- **Acción:** abrir el link (no rotado aún).
- **Esperado:** estado `AlreadyRespondedState`:
  > "Ya respondiste esta cotización el <fecha>. Si necesitas reabrirla, contacta a tu asesor."
- **Screenshot:** `screenshots/25-already-responded-state.png`

### 4.4 Race condition (dos tabs)

- **Acción:** abrir el link en dos tabs simultáneamente. En tab A click "Aceptar". En tab B (sin refresh) click "Aceptar" después.
- **Esperado:** tab B recibe error gentil ("Esta cotización ya fue respondida"). El primer click gana (estado terminal). No hay double-write.
- **Screenshot:** `screenshots/26-race-condition.png`

---

## 5. Edge cases — bloqueos al enviar

| Estado | UX esperada |
|---|---|
| Sin PDF generado | Botón "Enviar por email" **disabled**, tooltip "Genera el PDF primero" |
| Sin `contactEmail` | Botón disabled, tooltip "El cliente no tiene email" + link "Editar cliente" |
| Status `approved` o `rejected` | Botón **oculto** (estado terminal) |
| Sin empresa emitente activa | Dialog abre pero al submit muestra error "Configura una empresa emitente activa" |
| Resend no configurado | Toast de error "Configura Resend" + link a `/configuracion/integraciones/resend` |

- **Screenshots:**
  - `screenshots/27-button-disabled-no-pdf.png`
  - `screenshots/28-button-disabled-no-email.png`
  - `screenshots/29-button-hidden-terminal.png`
  - `screenshots/30-error-no-emisora.png`
  - `screenshots/31-error-resend-not-configured.png`

---

## 6. Permisos

| Caso | Esperado |
|---|---|
| Admin envía cualquier cotización del org | OK |
| Ejecutivo envía cotización de **su** cliente asignado | OK |
| Ejecutivo intenta enviar cotización de **otro** ejecutivo | Backend rechaza con `ConvexError("FORBIDDEN")`, botón **oculto** en UI |
| Admin de **otra org** abre `/cotizaciones/[id]` cross-org | "Cotización no encontrada" (404 efectivo, no leak de existencia) |

- **Screenshots:**
  - `screenshots/32-permissions-exec-own.png`
  - `screenshots/33-permissions-exec-others-hidden.png`
  - `screenshots/34-permissions-cross-org-404.png`

---

## 7. Security tests

### 7.1 XSS en `quotation.content`

- **Pasos:**
  1. En `/cotizaciones/[id]` click "Editar Contenido".
  2. Pegar payload: `<script>alert('xss')</script><p>contenido normal</p>`.
  3. Guardar.
  4. Abrir preview en dashboard.
  5. Abrir `/q/cotizacion/[token]` en incógnito.
- **Esperado:**
  - Ningún `alert` se dispara (DevTools console).
  - El `<p>contenido normal</p>` renderea correctamente.
  - DOMPurify strip-out el `<script>` antes del innerHTML.
- **Screenshot:** `screenshots/35-xss-blocked-dashboard.png` y `screenshots/36-xss-blocked-public.png`

### 7.2 CSS injection en `orgBranding.primaryColor`

- **Pasos:**
  1. Como super admin, ir a `/platform/orgs/[id]/branding`.
  2. Cambiar `primaryColor` a payload: `; background-image: url(http://evil.com/leak)`.
  3. Guardar.
  4. Abrir landing pública.
- **Esperado:**
  - `getByToken` retorna `primaryColor=undefined` (validación de hex regex en backend).
  - Landing usa color **default** del tema.
  - DevTools Network tab: ningún request a `evil.com`.
- **Screenshot:** `screenshots/37-css-injection-blocked.png`

### 7.3 Token forgery

- **Pasos:** navegar a:
  - `/q/cotizacion/abcdef1234567890`
  - `/q/cotizacion/$(openssl rand -base64 32)`
  - `/q/cotizacion/admin`
- **Esperado:** todos renderean `InvalidTokenState`. Backend usa lookup por `tokenHash` (HMAC-SHA256) y devuelve `null` para tokens no registrados.
- **Screenshot:** `screenshots/01-invalid-token-state.png` *(ya capturado)*

### 7.4 Token plaintext leakage

- **Pasos:**
  1. DevTools → Network tab abierto.
  2. Abrir landing con un token válido.
  3. Inspeccionar la response de `getByToken` (Convex query).
- **Esperado:**
  - La response **NO contiene** el plaintext del token.
  - Solo contiene metadata: `quotation`, `client`, `branding`, `status`, `expiresAt`.
  - El plaintext únicamente viaja en la response de `sendQuotation` (auth-gated, mostrado una sola vez en el dialog).
- **Screenshot:** `screenshots/38-network-no-plaintext.png`

---

## 8. UI Responsive

Probar a tres breakpoints: **375px** (móvil), **768px** (tablet), **1280px** (desktop).

### 8.1 Dashboard cotización detail @ 375px

- **Esperado:** SendStatusPanel stacked, botón full-width, badge de status sin truncar.
- **Screenshot:** `screenshots/39-mobile-quotation-detail.png`

### 8.2 `/q/cotizacion/[token]` @ 375px

- **Esperado:** sticky bottom bar con botones "Aceptar"/"Rechazar" usable, contenido scrollable arriba sin overlap.
- **Screenshot:** `screenshots/40-mobile-public-landing.png`

### 8.3 DeclineReasonDialog @ 375px

- **Esperado:** dialog full-width o full-screen, textarea sin overflow horizontal, botones apilados.
- **Screenshot:** `screenshots/41-mobile-decline-dialog.png`

---

## 9. Email Log integration

- **Verificación 1:** cada send crea entrada en `emailLog` con `type=quotation`, `relatedId=quotationId`, `recipient`, `status=queued|sent`.
- **Verificación 2:** webhook de Resend (`POST /api/webhooks/resend`) actualiza el status a `delivered`, `opened`, `clicked` o `bounced`.
- **Verificación 3:** filtro `/configuracion/email-log?relatedId={quotationId}` muestra historial completo de la cotización (envíos, reenvíos, eventos).
- **Screenshots:**
  - `screenshots/42-email-log-list.png`
  - `screenshots/43-email-log-filtered.png`
  - `screenshots/44-email-log-event-timeline.png`

---

## 10. Test automation

### 10.1 Suite vitest (backend)

```bash
npm test -- --run
```

**164 tests** distribuidos en:

- `tokenHelpers.test.ts` — generación de tokens, HMAC, validación
- `quotations.internal.test.ts` — internal mutations (`recordSend`, `recordResponse`)
- `quotations.send.test.ts` — `sendQuotation` (action) con mocks de Resend
- `quotations.public.test.ts` — `getByToken`, `acceptByToken`, `declineByToken`
- `quotations.permissions.test.ts` — admin/ejecutivo/cross-org

### 10.2 E2E con `agent-browser`

Scripts en [`tests/e2e/`](../../tests/e2e/):

| Script | Propósito | Auth requerida |
|---|---|---|
| [`01-public-landing-states.sh`](../../tests/e2e/01-public-landing-states.sh) | Token inválido renderea InvalidTokenState | No |
| [`02-happy-path-e2e.sh`](../../tests/e2e/02-happy-path-e2e.sh) | Happy path semi-automatizado | Sí (manual) |
| [`03-security-checks.sh`](../../tests/e2e/03-security-checks.sh) | Token forgery, noindex, plaintext leakage | No |

Ejecución:

```bash
chmod +x tests/e2e/*.sh
bash tests/e2e/01-public-landing-states.sh
bash tests/e2e/03-security-checks.sh

# Para 02, ver instrucciones inline en el script:
QUOTATION_ID=jh7abc... bash tests/e2e/02-happy-path-e2e.sh
```

---

## 11. Pre-deploy checklist

Antes de mergear a `main` y deployar a producción:

- [ ] `npm test -- --run` → 164/164 pass
- [ ] `npm run build` → sin errores TypeScript ni warnings críticos
- [ ] `npx convex dev --once` → sin errores
- [ ] Todos los pasos del Happy Path (Sección 1) ejecutados manualmente al menos una vez
- [ ] Decline flow con y sin razón (Sección 2) verificado
- [ ] Re-envío y rotación (Sección 3) verificado
- [ ] Estados de error (Sección 4) verificados (al menos token expirado + already responded)
- [ ] Edge cases de bloqueo (Sección 5) revisados
- [ ] Permisos (Sección 6) verificados con cuenta de ejecutivo no-asignado
- [ ] Security tests (Sección 7) ejecutados
- [ ] Responsive @ 375px (Sección 8) revisado
- [ ] Email log integration (Sección 9) confirmada con webhook real (no solo mock)
- [ ] `tests/e2e/01-public-landing-states.sh` y `03-security-checks.sh` ejecutados sin fallas
- [ ] Variables de entorno (`QUOTATION_TOKEN_SECRET`, `APP_URL`, `ANTHROPIC_API_KEY`) configuradas en Convex production
- [ ] `RESEND_WEBHOOK_SECRET` configurado y endpoint `/api/webhooks/resend` accesible públicamente
- [ ] Smoke test post-deploy: enviar 1 cotización a un email interno del equipo, abrir link, aceptar, verificar contract draft

---

## Apéndice A — Catálogo de screenshots

Todos los paths son relativos a [`docs/qa/screenshots/`](./screenshots/).

| Archivo | Estado | Sección |
|---|---|---|
| `01-invalid-token-state.png` | **Capturado** | 4.2, 7.3 |
| `02-quotation-detail-draft.png` | Pendiente | 1.1 |
| `03-send-button-enabled.png` | Pendiente | 1.2 |
| `04-send-dialog-open.png` | Pendiente | 1.3 |
| `05-send-dialog-prefilled.png` | Pendiente | 1.4 |
| `06-send-dialog-loading.png` | Pendiente | 1.6 |
| `07-send-dialog-success.png` | Pendiente | 1.7 |
| `08-send-status-panel-sent.png` | Pendiente | 1.8 |
| `09-email-inbox.png` | Pendiente | 1.9 |
| `09b-email-log-entry.png` | Pendiente | 1.9 |
| `10-public-landing-loaded.png` | Pendiente | 1.10 |
| `11-public-landing-branding.png` | Pendiente | 1.11 |
| `12-public-landing-content.png` | Pendiente | 1.12 |
| `14-public-landing-accepted.png` | Pendiente | 1.14 |
| `15-dashboard-approved.png` | Pendiente | 1.15 |
| `16-contract-list-new.png` | Pendiente | 1.16 |
| `17-contract-detail.png` | Pendiente | 1.17 |
| `18-decline-dialog-with-reason.png` | Pendiente | 2.1 |
| `19-dashboard-rejected-with-reason.png` | Pendiente | 2.1 |
| `20-dashboard-rejected-no-reason.png` | Pendiente | 2.2 |
| `21-resend-button.png` | Pendiente | 3.1 |
| `22-resend-dialog-warning.png` | Pendiente | 3.2 |
| `23-old-token-invalid.png` | Pendiente | 3.3 |
| `24-expired-token-state.png` | Pendiente | 4.1 |
| `25-already-responded-state.png` | Pendiente | 4.3 |
| `26-race-condition.png` | Pendiente | 4.4 |
| `27-button-disabled-no-pdf.png` | Pendiente | 5 |
| `28-button-disabled-no-email.png` | Pendiente | 5 |
| `29-button-hidden-terminal.png` | Pendiente | 5 |
| `30-error-no-emisora.png` | Pendiente | 5 |
| `31-error-resend-not-configured.png` | Pendiente | 5 |
| `32-permissions-exec-own.png` | Pendiente | 6 |
| `33-permissions-exec-others-hidden.png` | Pendiente | 6 |
| `34-permissions-cross-org-404.png` | Pendiente | 6 |
| `35-xss-blocked-dashboard.png` | Pendiente | 7.1 |
| `36-xss-blocked-public.png` | Pendiente | 7.1 |
| `37-css-injection-blocked.png` | Pendiente | 7.2 |
| `38-network-no-plaintext.png` | Pendiente | 7.4 |
| `39-mobile-quotation-detail.png` | Pendiente | 8.1 |
| `40-mobile-public-landing.png` | Pendiente | 8.2 |
| `41-mobile-decline-dialog.png` | Pendiente | 8.3 |
| `42-email-log-list.png` | Pendiente | 9 |
| `43-email-log-filtered.png` | Pendiente | 9 |
| `44-email-log-event-timeline.png` | Pendiente | 9 |
| `e2e-01-invalid-token.png` | Generado por script | `tests/e2e/01-*` |
| `e2e-02-quotation-detail-draft.png` | Generado por script | `tests/e2e/02-*` |
