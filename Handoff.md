# Handoff — Próxima sesión (post 2026-05-27)

**Misión:** Sacar a mercado lo más rápido posible. SS0, SS1, SS2-foundation y SS5 cerradas en main. Lo que falta para MVP funcional end-to-end de contratos: **integración real con Firmame** (research items pendientes).

**Sesión origen:** 2026-05-26 → 2026-05-27 (SS2 brainstorm/spec/plan/ejecución parcial + SS5 full ciclo)
**Estado código:** `main` 37 commits ahead de `origin/main`. Tests **927 passed | 1 skipped**. TypeScript clean (excepto pre-existing `useDebouncedAutosave` ortogonal). Sin push (per `feedback_no_push_default`).

---

## 🎯 Lo que se cerró este turno

### Sub-spec 2 — Contratos por empresa emisora + Firmame ⚙️ (foundation merged)

Merge commit: `76140d8` en main. Branch `feature/sub-spec-2-contracts-firmame` (preservada).

**Spec + Plan:**
- Spec: `docs/superpowers/specs/2026-05-26-sub-spec-2-contracts-firmame-design.md`
- Plan: `docs/superpowers/plans/2026-05-27-sub-spec-2-contracts-firmame.md`

**Tasks SS2 (16/26 done, 10 gated):**

| Phase | Tasks | Status |
|---|---|---|
| 1: Schema + migration + validation | T1-T5 | ✅ DONE |
| 2: Resolver + queries | T6-T7 | ✅ DONE |
| 3: Templates UI | T8-T9 | ✅ DONE |
| 4: Firmame client skeleton | T10, T12 | ✅ DONE (T11 GATED) |
| 5: Send action + wiring | T13-T15 | 🔴 GATED — Firmame API docs |
| 6: Webhook | T16-T18 | 🔴 GATED — Firmame webhook scheme |
| 7: Reminders cron | T19-T20 | ✅ DONE |
| 8: Pipeline view UI `/contratos` | T21-T24 | ✅ DONE |
| 9: Cancel + smoke | T25-T26 | ✅ DONE |

**Decisión de modelo Firmame (2026-05-27):** managed-BYO — Christian crea y opera N cuentas Firmame (una por org), pero técnicamente sigue el patrón BYO (cada `orgIntegrations` row tiene su propio API key). Cero cambios de código vs plan original. Memoria `project_firmame_account_model`.

### Sub-spec 5 — Invoice issue date vs payment date ✅ (full cycle)

11 commits TDD en main. 11/11 tasks done.

**Spec + Plan:**
- Spec: `docs/superpowers/specs/2026-05-27-invoice-issue-date-design.md`
- Plan: `docs/superpowers/plans/2026-05-27-invoice-issue-date.md`

**Cambios:**
- Schema: `invoices.issueDate: v.optional(v.number())`.
- Parser CFDI XML: `convex/lib/cfdiParser.ts` — extrae atributo `Fecha` del root `<Comprobante>` con regex (soporta CFDI 4.0, 3.3, con/sin namespace prefix, normaliza naive datetimes a UTC).
- Migración cursor-paginated: backfill `issueDate = uploadedAt` para rows pre-existentes.
- Upload action: acepta `xmlBuffer` + `issueDate` args opcionales. Resolución XML > manual > undefined.
- Mutation `updateIssueDate`: admin edita fecha post-upload; rechaza si `status='void'`; log documentEvents.
- Query `listForBilling`: acepta `issueDateFrom`, `issueDateTo`. Fallback a `uploadedAt` si `issueDate` undefined.
- UI `/facturacion`:
  - Upload form: file picker CFDI XML opcional + date input manual (deshabilitado si XML)
  - Tabla: columna "Emisión" (amber-700 si está estimada desde `uploadedAt`)
  - Filtros: "Período fiscal: [from] - [to]"
  - Acción inline "Editar fecha emisión" + modal

**NO cambia:** generación de entregables sigue triggered por `paidAt` (markPaid → scheduler → generateFromInvoice).

### Test count

- Sesión inicio (handoff previo): 873 passed | 1 skipped
- Post-SS2 partial: 905
- **Post-SS5 full: 927** (+54 totales)

---

## 🗺️ MVP Roadmap status

| Sub-spec | Status |
|---|---|
| 0 — Pricing foundation | ✅ Mergeado en main |
| 1 — Deliverable content catalog | ✅ Mergeado + hardened en main |
| 2 — Contratos + Firmame | ⚙️ Foundation mergeado en main. T11-T18 GATED en Firmame docs |
| 3 — Per-service start month | Post-MVP, ~2-3 días |
| 4 — Financial statements ingestion | Post-MVP, ~5-7 días |
| **5 — Invoice issue date vs payment** | ✅ **Mergeado en main (este turno)** |
| 6 — Year-over-year update tier | Post-MVP |
| 7 — Queue + scale infra | Post-MVP cuando volumen lo amerite |

---

## 🔴 Research items urgentes (próxima sesión)

### #1 — Contratos HTML iniciales (no bloquea código pero bloquea producción)

Necesito de papá:
- Min 1 contrato HTML para DESC org + 1 issuing company + 1-2 subservicios
- Variables esperadas: `{{cliente.nombre}}`, `{{cliente.rfc}}`, `{{contrato.monto_total}}`, `{{contrato.vigencia_inicio}}`, `{{contrato.vigencia_fin}}`, `{{empresa.legalName}}`, `{{empresa.rfc}}`, `{{servicio.nombre}}`, `{{ai.diagnostico}}`
- Formato similar a SS1 deliverables HTML

### #2 — Firmame API docs + sandbox key (BLOQUEA SS2 T11-T18)

Necesito documentación de Firmame.com:
- Endpoints base URL (sandbox + producción)
- Auth scheme (Bearer? Basic? custom header?)
- Payload de `POST /documents` (campos exactos: pdf upload, signers array, title, deadline)
- Webhook event names (`signed`, `rejected`, `expired`, `cancelled`)
- Webhook payload shape
- HMAC verification scheme (header name + algoritmo + qué firmar)

Además preguntas operativas del modelo managed-BYO:
1. ¿Múltiples cuentas bajo mismo email/RFC? O role-emails?
2. ¿Webhook URL configurable por cuenta o único global?
3. Descuentos por volumen / programa partner?
4. ¿Branding personalizado por cuenta (logo + sender name)?

### #3 — Modelo económico Firmame (research paralelo, NO bloquea impl)

Memoria `project_firmame_account_model` documenta la decisión MVP (managed-BYO) y los research items para evaluar Master/Hybrid post-MVP.

---

## Pendientes operativos

### Migración invoices

Cuando merge a prod: correr migración en prod via:
```bash
npx convex run internal:functions:migrations:invoiceIssueDate:migrate '{"cursor":null}' --prod
```
En dev se corre automáticamente al ejecutar.

### Push a origin/main

Branch `main` 37 commits ahead. Sin push (per memoria `feedback_no_push_default`). Pendiente OK explícito para `git push origin main`.

### Railway custom domain

Sin cambios: `www.businessinteligencehub.com` da 404 en routing. Investigar Railway dashboard cuando haya tiempo.

---

## Cómo arrancar próxima sesión

```bash
cd /Users/christiandarrelcoverlozano/Desktop/Projects/DESC
git status                              # working tree clean
git log --oneline -10                   # ver últimos commits
npm test 2>&1 | tail -3                 # baseline 927
npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -5  # clean
```

### Si tienes Firmame docs

1. Cambiar a branch SS2: `git checkout feature/sub-spec-2-contracts-firmame`
2. Rebase con main: `git rebase main`
3. Ejecutar T11-T18 del plan SS2 (Tasks 11, 13, 14, 15, 16, 17, 18 — T11 desbloquea los demás)
4. Smoke E2E con sandbox Firmame
5. Merge SS2-integration a main con `--no-ff`

### Si NO tienes Firmame docs

1. Atacar próximo sub-spec del backlog:
   - **SS3** (per-service start month, 2-3 días) — wizard + engine + UI matriz
   - **SS6** (year-over-year update tier, 2-3 días) — definir si % fijo o cotización manual
   - **SS4** (financial statements ingestion, 5-7 días) — pesado, dedicar bloque
2. O cargar contratos HTML iniciales vía bulk-import CLI cuando papá los provea

---

## Action items manuales (Christian)

1. **Conseguir Firmame API docs + sandbox key** — bloquea SS2 T11-T18 (8 tareas, ~3-4 días)
2. **Crear contratos HTML iniciales** para org DESC (mínimo 1 empresa × 1-2 subservicios)
3. **Push a origin/main** si quieres backup remoto (37 commits ahead local)
4. **Decidir** próximo sub-spec mientras esperas Firmame
5. **Llenar 32 plantillas deliverable** restantes (legacy item de SS1)
6. **Smoke browser** `/contratos` + `/facturacion` (UI nueva de SS2 + SS5) si quieres validar antes de prod

---

## Stack arquitectónico

| Capa | Tech | Notas |
|---|---|---|
| Frontend | Next.js 15 + React 19 + Tailwind + shadcn | Deploy Railway |
| Backend | Convex | 19+ tablas; nuevos campos SS2 + SS5 |
| Auth | Clerk Organizations | Test mode dev |
| Email | Resend | FROM `noreply@businessinteligencehub.com` |
| AI | Claude API | `claude-sonnet-4-20250514` |
| Blob storage | Railway S3 | PDFs/facturas; metadata en Convex |
| PDF gen | Puppeteer-core en Vercel | post-MVP: worker Railway |
| Firma | **Firmame** (skeleton listo, integración pendiente docs) | branch + plan listos |
| CFDI parsing | `convex/lib/cfdiParser.ts` (regex-based, no DOM) | NEW SS5 |

---

## Rules of engagement (sin cambios)

- Brainstorming → spec → writing-plans → subagent-driven (workflow validado SS0/SS1/SS2/SS5)
- Default: feature branch + merge `--no-ff` para tareas grandes; main directo para tareas pequeñas (SS5 fue main directo)
- Tras cada merge: `npx gitnexus analyze --embeddings`
- `gitnexus_impact` antes de edit a símbolos
- Smoke E2E manual hace Christian (browser)
- Push branch requiere OK explícito (memoria `feedback_no_push_default`)
- Memoria: full dump en design phases sin pausar por sección (`feedback_design_full_dump`)
