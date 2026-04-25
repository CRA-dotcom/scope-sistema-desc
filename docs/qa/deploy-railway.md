# Section 3B — Deploy Guide (Railway + Convex Production)

Architectural recap: Railway hosts the **Next.js frontend** (build via `next build`, runs `next start`). Convex Cloud hosts the **backend** (DB + actions + queries + scheduler + storage + webhooks). Section 3B touches both layers — env vars must be set in the right place or the feature silently breaks.

---

## 1. Env vars — what goes where

### Railway (Next.js runtime)

Set these in the Railway service → Variables tab. They're consumed by the Next server (`process.env.*` from `src/`) or shipped to the client (`NEXT_PUBLIC_*`).

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | yes | `pk_live_…` (NOT `pk_test_…`) |
| `CLERK_SECRET_KEY` | yes | `sk_live_…` |
| `NEXT_PUBLIC_CONVEX_URL` | yes | Production Convex deploy URL, e.g. `https://<deployment>.convex.cloud` |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | yes | `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | yes | `/sign-in` |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` | yes | `/` |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL` | yes | `/` |

**Do NOT set in Railway:**
- `QUOTATION_TOKEN_SECRET` — backend-only, Convex env
- `APP_URL` — backend-only, Convex env
- `ANTHROPIC_API_KEY` — backend-only, Convex env
- `RESEND_API_KEY` — backend-only, Convex env
- `QA_SEED_ALLOWED` — must NEVER be set in production; QA-only

### Convex production

Set via `npx convex env set --prod <KEY> "<value>"` (or via the Convex dashboard → your prod deployment → Settings → Environment Variables).

| Variable | Required | Notes |
|---|---|---|
| `QUOTATION_TOKEN_SECRET` | **yes** | `openssl rand -base64 48`. Min 32 chars. Rotating it invalidates ALL active quotation accept/decline tokens. |
| `APP_URL` | **yes** | The Railway production URL (e.g. `https://app.projex.dev`). Used to build the public link in the email body. **Must NOT have trailing slash.** |
| `ANTHROPIC_API_KEY` | yes (for AI features) | If absent, contract auto-generation falls back to placeholder text. |
| `RESEND_API_KEY` | yes (or per-org config) | Platform-level fallback for orgs that haven't configured their own Resend integration in `/configuracion/integraciones/resend`. |
| `RESEND_WEBHOOK_SECRET` | recommended | Required for `emailLog.status` to advance past `sent` (delivered/opened/clicked tracking). |
| `RESEND_FROM_EMAIL` | optional | Default sender address. Defaults to `noreply@projex-platform.com` if absent. |
| `CLERK_JWT_ISSUER_DOMAIN` | yes | Already configured per repo CLAUDE.md. |

**Critical NOT-to-set:**
- `QA_SEED_ALLOWED` — production safety contract. The QA seed mutation guards on this; setting it in prod allows arbitrary quotation forgery.
- `NODE_ENV=development` — Convex sets this to `production` automatically; do not override.

---

## 2. Pre-deploy verification

Run from your local machine before pushing to main / Railway picks it up:

```bash
# 1. Tests pass
npm test -- --run                  # 164/164

# 2. Production build clean
npm run build                      # no errors, /q/cotizacion/[token] in route table

# 3. Convex schema + functions deploy clean (against dev)
npx convex dev --once

# 4. No secrets accidentally in client bundle
grep -r "QUOTATION_TOKEN_SECRET" src/        # should be empty
grep -r "ANTHROPIC_API_KEY" src/             # should be empty
grep -r "RESEND_API_KEY" src/                # should be empty
```

---

## 3. Convex production deploy

Convex has separate dev / prod deployments. Before pushing schema changes to prod, push code:

```bash
# Push functions + schema to production deployment
npx convex deploy --prod

# After deploy, set env vars (one-time per var; subsequent deploys preserve them)
npx convex env set --prod QUOTATION_TOKEN_SECRET "$(openssl rand -base64 48)"
npx convex env set --prod APP_URL "https://your-railway-url.up.railway.app"
npx convex env set --prod ANTHROPIC_API_KEY "sk-ant-..."
npx convex env set --prod RESEND_API_KEY "re_live_..."
npx convex env set --prod RESEND_WEBHOOK_SECRET "whsec_..."

# Verify what's set (values redacted in output)
npx convex env list --prod
```

**Watch for:** if you've been running QA seeds locally, `QA_SEED_ALLOWED` may have leaked into the dev deployment. Verify it's NOT in `npx convex env list --prod`:

```bash
npx convex env list --prod | grep QA_SEED  # should be empty
```

If it appears, REMOVE IT IMMEDIATELY:

```bash
npx convex env remove --prod QA_SEED_ALLOWED
```

---

## 4. Resend production setup

Required for emails to actually go out (the `sendQuotation` action calls Resend via 3A's `sendEmail`).

### 4.1 Domain verification

In Resend dashboard:
1. Add the domain you'll send from (e.g. `mail.projex.dev` — a subdomain of the Railway-deployed app).
2. Configure the DNS records Resend provides (DKIM, SPF, return-path).
3. Wait for verification (can take hours).
4. Note the verified `from` address (e.g. `noreply@mail.projex.dev`).

### 4.2 API key

1. Create a Resend API key (production-scoped).
2. `npx convex env set --prod RESEND_API_KEY "re_live_..."`.

### 4.3 Webhook endpoint

So `emailLog.status` advances past `sent`:

1. Go to Resend dashboard → Webhooks → Add endpoint.
2. URL: `https://<your-convex-prod-deployment>.convex.site/webhooks/resend` (note: `.convex.site`, NOT `.convex.cloud` — different domain for HTTP routes).
3. Events to subscribe: `email.sent`, `email.delivered`, `email.opened`, `email.clicked`, `email.bounced`, `email.complained`.
4. Copy the signing secret Resend gives you.
5. `npx convex env set --prod RESEND_WEBHOOK_SECRET "whsec_..."`.

### 4.4 Per-org integration (optional but recommended)

For orgs that prefer their own Resend account, they configure it in `/configuracion/integraciones/resend`. The `resolveResendCredentials` resolver prefers per-org over the platform-level fallback automatically.

---

## 5. Clerk production setup

If migrating from Clerk dev → prod:

1. Create a Clerk production instance.
2. Reuse your dev OAuth providers (or set up new ones).
3. Update Clerk URLs to point at Railway production URL.
4. Update Convex `CLERK_JWT_ISSUER_DOMAIN` env to the production Clerk frontend domain (e.g. `https://clerk.projex.dev`).
5. Update Railway env vars to use `pk_live_…` and `sk_live_…` keys.

---

## 6. Railway deployment

### 6.1 Build settings

Railway should autodetect Next.js. If you customize, ensure:

- Build command: `npm run build`
- Start command: `npm run start` (which is `next start`)
- Node version: 20.x (or whatever matches local)

### 6.2 Custom domain

If you want `app.projex.dev` instead of `xyz.up.railway.app`:

1. Railway service → Settings → Networking → Custom Domain → add domain.
2. Configure DNS CNAME at your registrar.
3. Wait for SSL provisioning.
4. **Update Convex `APP_URL` to the new custom domain** — emails would still link to old domain otherwise.

### 6.3 Deploy

```bash
# Option A: connect Railway to your GitHub repo + push to main
git push origin main

# Option B: Railway CLI
railway up
```

After Railway deploy succeeds:

```bash
# Smoke check
curl -I https://your-railway-url.up.railway.app
# Should be 200 (or redirect to /sign-in)

curl -I https://your-railway-url.up.railway.app/q/cotizacion/test
# Should be 200 with text/html

curl -sI https://your-railway-url.up.railway.app/q/cotizacion/test | grep -i robots
# Should show: x-robots-tag: noindex,nofollow (or via meta in HTML)
```

---

## 7. Production smoke test (manual)

After both deploys are live:

1. **Login** to dashboard at `https://your-railway-url.up.railway.app/sign-in`
2. **Verify Convex connection**: dashboard loads data → Convex prod talking to Next prod.
3. **Create a real quotation**:
   - Cliente con `contactEmail` real (use `you@gmail.com` or similar)
   - Generar PDF
   - Click "Enviar por email"
4. **Check email inbox**:
   - Email arrives within ~30s
   - Subject: "Cotización X — Empresa Y"
   - Body: greeting + button + link
   - PDF attachment opens
5. **Click the link** in the email (NOT in the dashboard preview):
   - Lands at `https://your-railway-url.up.railway.app/q/cotizacion/<token>`
   - White document card renders cleanly
   - Branding shows (logo + emitente name)
   - "Aceptar cotización" / "Rechazar" sticky bar at bottom
6. **Click "Aceptar"**:
   - Confirmation: "¡Gracias! Hemos registrado tu aceptación..."
   - Refresh dashboard `/cotizaciones/<id>` → status "Aprobado"
7. **Wait 30-60s**, refresh `/contratos`:
   - New contract draft appears tied to this quotation
   - Click "Ver Contrato" — content rendered
8. **Verify email log**:
   - `/configuracion/email-log?relatedId=<quotationId>` shows the send
   - Resend webhook events appear (delivered → opened if you opened the email)

If any step fails, check:
- Convex logs (`npx convex logs --prod --tail`)
- Railway logs (Railway dashboard → service → Logs)
- Resend dashboard → activity feed

---

## 8. Rollback plan

If a critical bug hits prod:

```bash
# Roll back Convex functions (keeps schema / data; reverts code)
git revert <bad-commit>
git push origin main
npx convex deploy --prod

# Roll back Railway: redeploy a previous build via Railway dashboard
# (Railway → Deployments → click prior good deploy → Redeploy)
```

For schema rollbacks (rare): Convex schema is forward-only at runtime. Don't try to remove fields — leave the new optional fields in place even if you revert the feature.

---

## 9. Post-deploy hardening (recommended within first week)

- **Monitor** `emailLog` for unusually high `failed` count (Resend issues, domain reputation).
- **Monitor** `quotations.status === "approved"` rows where no contract exists after 1h (scheduled `generateContractFromQuotationInternal` failures — surface in admin dashboard via §3B.10 notifications when implemented).
- **Rotate** `QUOTATION_TOKEN_SECRET` if leaked. Effect: ALL pending accept/decline links die — ejecutivos must re-send open quotations. Acceptable since TTL is 30d.
- **Audit** `npx convex env list --prod` after every deploy to catch accidental `QA_SEED_ALLOWED`.

---

## 10. Quick reference card

```
Railway (Next.js):  Clerk + NEXT_PUBLIC_CONVEX_URL only.
Convex prod:        QUOTATION_TOKEN_SECRET + APP_URL + ANTHROPIC + RESEND_API + RESEND_WEBHOOK + CLERK_JWT_ISSUER + (NEVER QA_SEED_ALLOWED).
Resend dashboard:   verified domain + webhook → convex.site/webhooks/resend.
Convex dashboard:   verify schema deployed, crons reactivated if you re-enabled them.
```
