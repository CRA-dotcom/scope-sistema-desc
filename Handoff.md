# Handoff — Próxima sesión (post 2026-05-25)

**Misión:** **Sacar a mercado lo más rápido posible.** Sub-specs 0 y 1 cerradas. Sub-spec 2 (contratos + Firmame) es lo último para MVP funcional + contenido de papá llena las plantillas en paralelo.

**Sesión origen:** 2026-05-25 (ship day — SS0 + SS1 + adversarial hardening + agent-browser smoke)
**Sesión target:** próxima — Sub-spec 2 brainstorming/spec/plan/impl
**Estado código:** `main` en `456d691` pushed a `origin/main`. Tests 873 passed | 1 skipped. TypeScript clean.

---

## 🎯 Lo que se cerró hoy (2026-05-25)

### Sub-spec 0 — Pricing model + frequency foundation ✅

12 commits, 10 tasks TDD via subagent-driven workflow. Merge `456d691`.

- 3 schema fields nuevos: `subservices.defaultPricingModel`, `projectionServices.pricingModel`, `monthlyAssignments.isManuallyOverridden`
- 4 pricing models: `fixed_retainer | dynamic_retainer | commission | one_time`
- Engine branch para `one_time` (concentra en mes 1) + `isManuallyOverridden` flag para seed-then-freeze
- `recalculate` preserva cells overridas + sincroniza annualAmount con sum(cells) cuando hay overrides
- Nueva mutation `changePricingModel(row, newModel, confirmReset)` para switch mid-cycle
- Migration interna `internal:migrations/pricingModel:migrate` — corrida en dev (44 templates backfilled)
- 2 critical bugs caught por code review entre tasks: drift reconciler + annualAmount sync

**Tarea pendiente:** PR2 schema tightening a `required` (defer hasta tener prod).

### Sub-spec 1 — Deliverable content catalog ✅

13 commits + 5 hardening commits. Merge `41e97f0` + hardening merge `9eecbfd`.

- `contentStatus: 'placeholder' | 'ready'` field auto-derivado en deliverableTemplates
- Detección robusta via regex (whitespace-tolerant, case-insensitive, ignora HTML comments + `<script>`)
- UI: banner amarillo en `/proyecciones/[id]`, badge "Sin contenido" + counter en `/configuracion/plantillas`, chip emerald/amber en editor
- Bulk-import CLI: `npx tsx scripts/import-templates.ts` lee `.html` files de `convex/seeds/templates/` y upserta via internal mutation. Naming: `<parent-slug>__<sub-slug>[-<type>].html`
- Migration aplicada en dev (44 templates backfilled, `verifyComplete = 0`, idempotente)
- Smoke E2E visual via agent-browser (Vercel) — verificado counter, badge, chip ready, chip placeholder

**Tarea pendiente:** PR2 schema tightening a `required` (defer hasta tener prod).

### Adversarial review + hardening ✅

Cynical reviewer (bmad-review-adversarial-general) encontró 11 issues en SS1. Resolución:

| Issue | Status |
|---|---|
| Marker brittle (whitespace/quotes/case) | ✅ Regex robust + strip comments/scripts |
| upsertFromFile wrong index | ✅ `by_orgId_subserviceId` con orgId=undefined |
| upsertFromFile skips placeholder validation | ✅ `validatePlaceholdersDeclared` agregado |
| `by_name` services lookup unscoped | ✅ Filter `orgId === undefined` |
| `subservicesMissingContent` N+1 perf | ✅ Batched a 3 queries + N parallel db.get |
| `personalizeGlobal` propaga undefined | ✅ Fallback `detectContentStatus(source.html)` |
| Migration unbounded scan | ✅ Cursor-based pagination |
| CLI path traversal | ✅ Regex filename + `realpath` check |
| CLI auth/error sanitization | ✅ Strip HTML from error logs |
| `deliverables/actions.ts` scheduler | N/A (orphan audit-log work, not SS1) |
| Uncommitted files | N/A (orphan audit-log work, intentional) |

### Hotfixes a main hoy

| Commit | Fix |
|---|---|
| `58f7105` | Next.js 15 Suspense boundary en `/facturacion` + `/platform/orgs/[id]` |
| `d3e3620` | Railway port: removí `startCommand` del railway.json (Dockerfile CMD handle the expansion) |
| `0b6a80a` | Extended `contentStatus` hook a `seed.ts:upsertTemplate` (code review catch) |

### Audit-log code (orphan) — parcial accidente en main

Las uncommitted modifications del session start ("audit-log orfano") existieron en working tree casi todo el día. Durante SS1 hardening, una de las staging fases (commit `a5f6d4e`) accidentalmente incluyó audit-log code en `convex/functions/deliverableTemplates/mutations.ts`. Eso CAUSÓ 7 test failures post-SS0 merge porque `requireTemplateEditAccess` retornaba `void` pero el audit code esperaba `identity`.

**Resuelto:** cambié `requireTemplateEditAccess` a retornar `Promise<UserIdentity>` (con JSDoc + import). 873 tests passing post-fix.

**Quedan pendiente como uncommitted modifications** (todavía en working tree, sin commitear):
- `convex/functions/deliverables/actions.ts` — audit-log en generateDeliverable
- `convex/functions/subservices/mutations.ts` — audit-log en subservice mutations
- `convex/lib/templateAccess.ts` — ya integrado pero tiene mods pendientes
- `src/hooks/__tests__/useDebouncedAutosave.test.ts` — small test tweaks
- `AGENTS.md`, `CLAUDE.md` — gitnexus auto-updates

Si la próxima sesión quiere completar la feature de audit-log: revisar esos archivos + hacer un commit dedicado. Sino: dejarlos hasta que la feature sea retomada.

---

## 🗺️ MVP Roadmap status

| Sub-spec | Status | Bloquea |
|---|---|---|
| **0 — Pricing foundation** | ✅ Mergeado | Sub-specs 1, 3, 6 |
| **1 — Deliverable content catalog** | ✅ Mergeado + hardened | Sub-spec 4 (parcialmente) |
| **2 — Contratos + Firmame** | ⏳ NEXT (4-5 días) | nada |
| 3 — Per-service start month | Post-MVP | nada |
| 4 — Financial statements ingestion | Post-MVP | nada |
| 5 — Invoice issue date vs payment | Post-MVP | nada |
| 6 — Year-over-year update tier | Post-MVP | nada |
| 7 — Queue + scale infra | Post-MVP (cuando volumen lo amerite) | nada |

**Próximo:** brainstorm Sub-spec 2. Spec maestro en `docs/superpowers/specs/2026-05-22-papa-call-scale-pending-detailed-spec.md` §3 Sub-spec 2.

---

## Cómo arrancar próxima sesión

1. **Pre-flight (paralelo):**
   ```bash
   git status                              # working tree status
   git log --oneline -10                   # últimos commits
   npm test 2>&1 | tail -3                 # baseline: 873 passed | 1 skipped
   npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -3   # clean
   lsof -i :3000 2>&1 | head -3            # next dev
   ```

2. **Si servers no corren:**
   ```bash
   npx convex dev          # terminal 1
   npm run dev             # terminal 2 (puerto :3000)
   ```

3. **API key sync check:**
   ```bash
   diff <(~/.claude/bin/get-secret anthropic-api-key) <(npx convex env get ANTHROPIC_API_KEY) && echo OK || echo "MISMATCH"
   ```

4. **Decir:** `vamos con Sub-spec 2` → invoco `superpowers:brainstorming` con el stub spec maestro como contexto.

---

## Estado catálogo de plantillas (post-SS1)

- **44 plantillas** en deliverableTemplates de dev: 32 placeholder + 12 ready (Bitácora ya ready por bulk-import smoke; el resto siguen seedeadas en placeholder).
- **Counter "30 sin contenido"** visible en `/configuracion/plantillas` (count varía según cuántas papá vaya llenando).
- **Variables estándar** en cada placeholder: `{{cliente.nombre}}`, `{{cliente.rfc}}`, `{{proyeccion.mes}}`, `{{proyeccion.año}}`, `{{ai.diagnostico}}`.
- **Workflow bulk-import (recomendado para llenar las 32 restantes):**
  ```bash
  # 1. Crear .html files en convex/seeds/templates/ con Claude Code:
  #    "Genera HTML para reporte mensual de Asesoría Legal usando estas
  #     variables: {{cliente.nombre}}, {{cliente.rfc}}, {{proyeccion.mes}},
  #     {{proyeccion.año}}, {{ai.diagnostico}}"
  #
  # 2. Naming: <parent-slug>__<sub-slug>[-<type>].html
  #    Ejemplos: legal__asesoria-legal.html, contable__estados-financieros-quotation.html
  #
  # 3. Obtener deploy key del Convex dashboard (Settings → Deploy Keys)
  #
  # 4. Run:
  CONVEX_DEPLOY_KEY="convex_deploy_key_aqui" \
    NEXT_PUBLIC_CONVEX_URL=$(grep NEXT_PUBLIC_CONVEX_URL .env.local | cut -d= -f2) \
    npx tsx scripts/import-templates.ts
  ```

---

## Stack arquitectónico (estable post-SS0+SS1)

| Capa | Tech | Notas |
|---|---|---|
| Frontend | Next.js 15 + React 19 + Tailwind + shadcn | Deploy Railway (no Vercel) |
| Backend | Convex | 19+ tablas (3 nuevas en SS0, 1 field en SS1) |
| Auth | Clerk Organizations | Test mode dev; 2FA email code en login |
| Email | Resend | FROM `noreply@businessinteligencehub.com` |
| AI | Claude API | `claude-sonnet-4-20250514`, retry 3x |
| Blob storage | Railway S3 | PDFs/facturas; metadata en Convex |
| PDF gen | Puppeteer-core en Vercel | post-MVP: worker dedicado Railway |
| Firma | Firmame (pendiente integración) | Sub-spec 2 |

---

## Specs y plans relevantes (post-SS1)

**Mergeados:**
- `docs/superpowers/specs/2026-05-25-pricing-model-frequency-foundation-design.md` + plan
- `docs/superpowers/specs/2026-05-25-deliverable-content-catalog-design.md` + plan

**Stub maestro:**
- `docs/superpowers/specs/2026-05-22-papa-call-scale-pending-detailed-spec.md` — los 7 sub-specs decomposed

**Recientes referencia:**
- `2026-05-22-engine-fefactor-rescale-design.md` (fix Katimi)
- `2026-05-22-monthly-subservice-selection-design.md`
- `2026-05-21-subservices-visible-in-matrix-design.md`
- `2026-05-21-deliverable-manual-override-design.md`

---

## Pendientes infraestructura

### Railway custom domain — `www.businessinteligencehub.com` ⚠️

Estado actual:
- ✅ Custom domain agregado en Railway (typo previo `businessiteligencehub.com` quedó — ver dashboard)
- ✅ DNS GoDaddy configurado: CNAME `www` → `l9k5b5ao.up.railway.app`
- ✅ TXT `_railway-verify.www` para verification
- ✅ Forwarding apex 301 → `https://www.businessinteligencehub.com`
- ✅ SSL cert emitido por Railway (no más SSL error)
- ❌ **Pero** `https://www.businessinteligencehub.com/` devuelve **404** — routing al service no resuelve

Investigar en Railway dashboard:
- ¿El custom domain está apuntando al service correcto (Projex, no a otro)?
- ¿El typo `businessiteligencehub.com` aún existe en la lista de domains?
- ¿Hay algún routing/health check config que esté mal?

### GitHub auth — cuentas múltiples

`gh auth status` muestra 4 cuentas en keyring: `christiancover26`, `ccover-qwave`, `CRA-dotcom`, `ccover-hub`. Para push al repo `CRA-dotcom/projex`:
```bash
gh auth switch -u CRA-dotcom    # antes de git push
```

`christiancover26` no tiene write access al repo. El user.name/email del git config NO cambia con auth switch (commit author sigue siendo christiancover26).

---

## Tests + coverage status

- **Baseline pre-session:** 810 passed | 1 skipped
- **Post SS0 + SS1 + hardening:** 873 passed | 1 skipped (+63 tests)
- **TypeScript:** clean (excepto pre-existing `useDebouncedAutosave` issue ortogonal)

Breakdown de nuevos tests:
- SS0: ~29 tests (detector, schema, engine, mutations, migration)
- SS1: ~29 tests (detector, hooks, query, banner, migration, bulk-import)
- Hardening: +10 tests (marker variants, dedup, pagination)
- Audit-log compat: -5 tests previously failing now passing post-`requireTemplateEditAccess` fix

---

## ClickUp queue (legacy del handoff previo, revisar relevancia)

| Due | Pri | Ticket | Status |
|---|---|---|---|
| 25-may | high | `86ahfh6fr` WhatsApp via Gowa | Pendiente Gowa |
| 25-may | low | `86ahfh6g7` Módulo de contrato post-cotización | Absorbed por Sub-spec 2 |
| 27-may | high | `86ahjaqtq` Railway prod (env vars + DNS + TLS) | Parcial: DNS + TLS ok; domain routing pendiente |
| 28-may | normal | `86ahjar1x` SSRF en `/api/generate-pdf` + headers | Security fix |
| 28-may | normal | `86ahfh6g0` Cuestionario subcampos gastos variables | Probable absorbed por Sub-spec 4 |
| 29-may | low | `86ahfh6g6` Signos $ y % en proyección | UI polish |
| 30-may | high | `86agucmh4` Test E2E completo | QA, post-MVP |

---

## Action items manuales (Christian, no agente)

1. **Llenar las 32 plantillas placeholder restantes** via bulk-import workflow (con Claude Code). Sin esto, MVP genera entregables placeholder al cliente.
2. **Railway domain routing** — investigar por qué `www.businessinteligencehub.com` da 404 (SSL ok, routing no).
3. **Sub-spec 2 spec input** — definir endpoints Firmame, formato cotización vs contrato, qué empresas emisoras existen. Antes de brainstorming.
4. **Eventualmente** completar o descartar el audit-log orphan work (5 archivos uncommitted).

---

## Rules of engagement (recordatorios)

- Tarea sustancial: brainstorming → spec → writing-plans → subagent-driven (workflow ya probado, funcionó bien hoy con 2 sub-specs).
- Default: feature en branch + merge `--no-ff` per handoff convention.
- Tras cada merge: `npx gitnexus analyze --embeddings` (opcional, refresh background).
- Antes de edit a un símbolo: `gitnexus_impact({ target, direction: "upstream" })`.
- Smoke E2E manual hace Christian (browser) — alternativamente agent-browser CLI funciona si Claude tiene credentials Clerk del user.
- Push branch SI requiere OK (per memoria `feedback_no_push_default`). Hoy ya pasó por gh auth switch a CRA-dotcom.

---

## Si algo se rompe

- **Tests fallan en baseline:** revisar último merge, probable Convex codegen — corre `npx convex dev --once`.
- **PDF generation falla:** `CHROMIUM_PATH` en `.env.local` + chequear Google Chrome instalado.
- **Email no llega:** `orgConfigs.notificationEmail` del org en Convex dashboard. Fallback `OPS_NOTIFICATION_EMAIL` (env).
- **Override no aparece en drawer:** `orgConfigs.featureFlags.manualOverrideAllowed = true` Y user es `org:admin`.
- **Banner "Sin contenido real" no aparece:** verificar que la projection use el wizard nuevo (con `projectionServices.subserviceId` set). Banner no captura per-cell `monthlyAssignments.subserviceId` — gap conocido (defer).
- **Bug "todo a mayo" reaparece:** `convex/lib/projectionEngine.ts` Step 5 — `monthlyBase = annualAmount / sumFE` (fix `49d92aa` del 22-may, sigue en main).

---

## Lo que NO está en este handoff

- Detalle de cada sub-spec — vive en sus design docs.
- Decisiones de marketing / pricing / sales motion (business side de Christian + papá).
- Costos estimados a volumen — pendiente cuando Sub-spec 7 (queue + scale) sea retomado.
