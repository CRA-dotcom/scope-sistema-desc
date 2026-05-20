# Cutover a producción — businessinteligencehub.com

> Dominio: `businessinteligencehub.com` (una "l" en "inteligence" — intencional,
> el .com correcto no estaba disponible; herramienta privada sin marketing).
> Host: **Railway** (no Vercel — la carpeta `.vercel/` es basura vieja del
> proyecto `scope-sistema-desc`, se puede borrar).

## Estado del código (ya aplicado)

| # | Blocker | Fix aplicado |
|---|---------|--------------|
| 1 | Emails con `localhost` | `actions.ts` / `qaSeed.ts` ahora lanzan error si `APP_URL` no está (sin fallback localhost) |
| 2 | Auth Clerk↔Convex | `auth.config.ts` lanza error claro si falta `CLERK_JWT_ISSUER_DOMAIN`; agregado a `.env.example` |
| 4 | PDF/chromium | `railway.json` → builder `DOCKERFILE` (chromium presente vía `Dockerfile`) |
| 5 | From de dominio ajeno | `send.ts` / `resolveConfig.ts` ya no usan `projex-platform.com`; requieren `RESEND_FROM_EMAIL` de dominio verificado |
| 6 | Crons filtrando datos | 3 envíos guardados tras `OPS_NOTIFICATION_EMAIL`; si no está, se omiten + warn (no se manda a dominio ajeno) |

> **Follow-up de feature (NO bloquea cutover):** resolver emails reales desde
> Clerk para overdue-alert (admin de la org), recordatorio de cuestionario
> (cliente) y cuestionario-completado (ejecutivo). Hoy van a
> `OPS_NOTIFICATION_EMAIL` o se omiten.

## Blocker 3 — secretos de producción (ops, no código)

- Generar **nuevo** `QUOTATION_TOKEN_SECRET` para prod: `openssl rand -base64 48`.
  NO reutilizar el de `.env.local` (es dev, estuvo en disco/shell — tratar como comprometido para un token money-adjacent).
- Usar claves **`pk_live_` / `sk_live_`** de la instancia de Clerk de producción
  (no las `pk_test_…cute-minnow-34` de dev).

## Convex — deployment de producción

`npx convex env set --prod KEY value` para cada uno:

- [ ] `APP_URL=https://businessinteligencehub.com` (sin slash final)
- [ ] `CLERK_JWT_ISSUER_DOMAIN=https://<issuer-clerk-prod>` (del JWT template `convex`)
- [ ] `QUOTATION_TOKEN_SECRET=<nuevo openssl rand -base64 48>`
- [ ] `ANTHROPIC_API_KEY=<key>`
- [ ] `RESEND_API_KEY=<key>`
- [ ] `RESEND_WEBHOOK_SECRET=<signing secret del webhook Resend>`
- [ ] `RESEND_FROM_EMAIL=noreply@businessinteligencehub.com`
- [ ] `RESEND_FROM_NAME=Business Intelligence Hub`
- [ ] `OPS_NOTIFICATION_EMAIL=<buzón interno>` (si no, los 3 crons se omiten)
- [ ] Confirmar que `QA_SEED_ALLOWED` **NO** está en prod

### Deploy del código a prod

> Setear env vars ≠ deployar código. Sin deploy, las funciones (incluyendo
> el handler de `/webhooks/resend`) no existen en prod y Resend recibe
> `404 — This Convex deployment does not have HTTP actions enabled`.

- [ ] `npx convex deploy --prod` — sube todas las funciones (queries,
      mutations, actions, http routes) al deployment prod.
- [ ] **Pre-requisito:** `CLERK_JWT_ISSUER_DOMAIN` debe estar seteado
      ANTES del deploy. `auth.config.ts` lanza error al cargar si falta.
- [ ] Después del deploy, en Resend → Webhooks → endpoint → "Replay"
      los attempts pendientes para validar 200.

## Railway — variables del servicio (frontend)

- [ ] `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_…`
- [ ] `CLERK_SECRET_KEY=sk_live_…`
- [ ] `NEXT_PUBLIC_CONVEX_URL=https://<prod>.convex.cloud`
- [ ] `NEXT_PUBLIC_CONVEX_SITE_URL=https://<prod>.convex.site`
- [ ] Los 4 `NEXT_PUBLIC_CLERK_*_URL` (`/sign-in`, `/sign-in`, `/`, `/`)
- [ ] Verificar que Railway pasa estas vars como **build args** al Dockerfile
      (el `Dockerfile` las recibe vía `ARG`); si no, definirlas como build-time.

## Clerk dashboard

- [ ] Crear instancia de **producción**
- [ ] Agregar `businessinteligencehub.com` como dominio primario (no satélite)
- [ ] Crear los DNS CNAME que pida Clerk (`clerk.`, `accounts.`, etc.)
- [ ] Crear/verificar el JWT template llamado exactamente **`convex`**
- [ ] Copiar su Issuer → `CLERK_JWT_ISSUER_DOMAIN` (paso Convex)

## Resend dashboard

- [ ] Verificar `businessinteligencehub.com` como dominio de envío (SPF/DKIM/DMARC)
- [ ] Apuntar el webhook a `https://<prod>.convex.site/webhooks/resend`
- [ ] Setear su signing secret → `RESEND_WEBHOOK_SECRET` (paso Convex)

## DNS

- [ ] Apuntar `businessinteligencehub.com` al servicio de Railway
- [ ] Confirmar cert TLS/HTTPS emitido **antes** de mandar cualquier email
      (los links son `https://`)

## Smoke test post-cutover

1. Login en `https://businessinteligencehub.com` (valida JWT Clerk↔Convex)
2. Enviar una cotización real → el link del email debe ser
   `https://businessinteligencehub.com/q/cotizacion/<token>` y adjuntar el PDF
3. Disparar un evento Resend → `emailLog.status` avanza más allá de `sent`
   (valida el webhook)

## Should-fix pendientes (no bloquean, recomendados pronto)

- SSRF en `/api/generate-pdf` (HTML del caller renderizado en Chromium con
  `networkidle0` — un usuario autenticado puede exfiltrar metadata del host).
- `next.config.ts` vacío: sin HSTS/CSP/headers de seguridad ni `poweredByHeader:false`.
- URLs cliente (`window.location.origin`) vs servidor (`APP_URL`) inconsistentes
  en el link de cuestionario (`cuestionarios/[id]/page.tsx`).
- Borrar `.vercel/` (apunta a proyecto viejo, confunde el host real).
