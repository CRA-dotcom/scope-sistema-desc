# Handoff — Próxima sesión (post 2026-05-27)

**Misión:** Sacar a mercado lo más rápido posible. SS0, SS1, y SS2-foundation cerradas. Lo que falta para MVP funcional end-to-end de contratos: **integración real con Firmame** (research items pendientes).

**Sesión origen:** 2026-05-26 → 2026-05-27 (SS2 brainstorm/spec/plan + ejecución partial)
**Estado código:** branch `feature/sub-spec-2-contracts-firmame` (NO mergeada a `main` todavía) — 20 commits ahead. Tests **905 passed | 1 skipped**. TypeScript clean (excepto pre-existing `useDebouncedAutosave` ortogonal).

---

## 🎯 Lo que se cerró este turno (SS2 partial)

### Sub-spec 2 — Contratos por empresa emisora + Firmame ⚙️ (parcial)

20 commits TDD via subagent-driven workflow. Branch: `feature/sub-spec-2-contracts-firmame`.

**Spec + Plan:**
- Spec: `docs/superpowers/specs/2026-05-26-sub-spec-2-contracts-firmame-design.md` (343 líneas, 16 secciones)
- Plan: `docs/superpowers/plans/2026-05-27-sub-spec-2-contracts-firmame.md` (26 tareas en 9 fases)

**Tasks completed (16/26):**

| Phase | Tasks | Status |
|---|---|---|
| 1: Schema + migration + validation | T1-T5 | ✅ DONE |
| 2: Resolver + queries | T6-T7 | ✅ DONE |
| 3: Templates UI (bulk import + página empresas) | T8-T9 | ✅ DONE |
| 4: Firmame client skeleton | T10, T12 | ✅ DONE (T11 GATED) |
| 5: Send action + wiring | T13-T15 | 🔴 GATED — Firmame API docs |
| 6: Webhook | T16-T18 | 🔴 GATED — Firmame webhook scheme |
| 7: Reminders cron | T19-T20 | ✅ DONE |
| 8: Pipeline view UI | T21-T24 | ✅ DONE |
| 9: Cancel + smoke | T25-T26 | ✅ DONE |

**Schema changes (Phase 1):**
- `deliverableTemplates`: nuevos campos `issuingCompanyId` + `signerMode` + índice `by_orgId_type_issuingCompanyId_subserviceId`
- `contracts`: campos Firmame (`firmameDocumentId`, `firmameSignUrl`, `firmameStatus`, `signedPdfBucketKey`) + reminders (`sentAt`, `lastReminderAt`, `reminderCount`) + `signerMode` (snapshot) + `cancellationReason` + índice `by_firmameDocumentId`
- `orgIntegrations.provider`: agregado literal `firmame` + migración cursor-paginada para rows `other`+`firmame` → `firmame`
- Validación en mutations: `type='contract'` requiere `issuingCompanyId` + org-scoped (NO globals)

**Funcionalidad lista para uso ahora mismo (sin Firmame):**
- ✅ UI `/configuracion/empresas-emitentes/[id]/contratos` — listar contract templates por empresa
- ✅ UI `/contratos` — pipeline view con filtros (status, días sin firmar), tabla de contratos, StuckBanner para >7d, acciones (Ver Firmame link, Cancelar con razón)
- ✅ Bulk-import CLI: filename convention `<empresa-slug>__<subservice-slug>-contract.html` con env var `IMPORT_ORG_ID`
- ✅ Mutation `cancelContract` (admin-only, rejects signed)
- ✅ Cron `contractRemindersTick` daily 16:00 UTC (10AM CDMX) — eligibility 3d/7d/14d con `reminderCount` progression. Action `sendContractReminder` + `logReminder` mutation insertan en `emailLog` + `documentEvents` (envío via Resend pendiente de wiring real, ahora solo log)
- ✅ Firmame client skeleton (`convex/lib/firmameClient.ts`) con createDocument/downloadSignedPdf/verifyWebhookSignature — endpoints TBD pero estructura lista

**BLOQUEADO (necesita inputs Christian):**

| Task | Bloqueador |
|---|---|
| T11 — Real Firmame endpoints | Firmame API docs (sandbox key + endpoint URLs + auth scheme + payload shape) |
| T13 — `sendContractToFirmameInternal` action | T11 docs (payload de createDocument) |
| T14 — Wire `acceptQuotation` → `scheduler.runAfter(sendContract)` | depende de T13 |
| T15 — `saveSent` internal mutation (insert contract row) | pairs con T13 |
| T16 — Next.js `/api/webhooks/firmame/route.ts` | T11 docs (webhook header name + HMAC algo) |
| T17 — `handleFirmameWebhook` action | T11 docs (event names + payload shape) |
| T18 — `markSigned` + `markCancelled` mutations | pairs con T17 |

### Test count

- Baseline session inicio: 873 passed | 1 skipped
- Final SS2 turn: **905 passed | 1 skipped** (+32 nuevos)

### Bug fix en branch

`fix(templates): propagate UserIdentity from requireTemplateEditAccess` (commit `9ecb929` en main) — el fix audit-log orphan que el handoff previo dejó uncommitted. Pendiente: mergear con SS2.

---

## 🗺️ MVP Roadmap status

| Sub-spec | Status |
|---|---|
| 0 — Pricing foundation | ✅ Mergeado en main |
| 1 — Deliverable content catalog | ✅ Mergeado + hardened en main |
| 2 — Contratos + Firmame | ⚙️ **Branch SS2 — 16/26 tareas. Falta Firmame integration (gated)** |
| 3-7 | Post-MVP |

---

## 🔴 Research items urgentes (próxima sesión)

### #1 — Contratos HTML iniciales (no bloquea código pero bloquea producción)

Necesito de papá:
- Min 1 contrato HTML para DESC org + 1 issuing company + 1-2 subservicios
- Variables esperadas: `{{cliente.nombre}}`, `{{cliente.rfc}}`, `{{contrato.monto_total}}`, `{{contrato.vigencia_inicio}}`, `{{contrato.vigencia_fin}}`, `{{empresa.legalName}}`, `{{empresa.rfc}}`, `{{servicio.nombre}}`, `{{ai.diagnostico}}`
- Formato similar a SS1 deliverables HTML

### #2 — Firmame API docs + sandbox key

Necesito documentación de Firmame.com:
- Endpoints base URL (sandbox + producción)
- Auth scheme (Bearer? Basic? custom header?)
- Payload de `POST /documents` (campos exactos: pdf upload, signers array, title, deadline)
- Webhook event names (`signed`, `rejected`, `expired`, `cancelled`)
- Webhook payload shape
- HMAC verification scheme (header name + algoritmo + qué firmar)

Sin esto, T11-T18 quedan bloqueados.

### #3 — Modelo económico Firmame (research paralelo, NO bloquea impl)

Investigar:
- Pricing real per signature / per documento / volume tiers
- ¿Firmame soporta multi-tenant routing (1 cuenta nuestra, webhooks per tenant)?
- Competidores: MiFiel, DocuSign, AdobeSign — pricing & features
- Break-even: ¿a partir de cuántas firmas/mes Master account se vuelve más rentable que BYO?
- ¿Firmame ofrece reseller / white-label / partner program?

Para MVP: modelo BYO (cada org trae su API key). Documentado como decisión MVP-only en spec §13.

---

## Cómo arrancar próxima sesión

1. **Mergeable check:**
   ```bash
   git checkout feature/sub-spec-2-contracts-firmame
   git log --oneline main..HEAD  # 20 commits
   npm test 2>&1 | tail -3       # baseline 905
   npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -5  # clean
   ```

2. **Si tienes Firmame docs:**
   - Implementar T11 (real endpoints en `convex/lib/firmameClient.ts`)
   - Implementar T13 (`sendContractToFirmameInternal` action en `convex/functions/contracts/actions.ts`) + T15 (`saveSent`)
   - Implementar T14 (scheduler hook en `convex/functions/quotations/publicActions.ts`)
   - Implementar T16-T18 (webhook + handler + markSigned/markCancelled)
   - Smoke E2E con sandbox Firmame

3. **Si NO tienes Firmame docs aún:**
   - Mergear branch SS2 a main con `--no-ff` (todo lo unblocked está listo para producción)
   - Cargar contratos HTML iniciales vía bulk-import CLI (cuando papá los provea)
   - Probar `/contratos` pipeline view en producción (verás solo contratos draft hasta que Firmame esté integrado)

---

## Estado catálogo de plantillas

Sin cambios desde SS1 session previa:
- 44 plantillas en deliverableTemplates de dev: 32 placeholder + 12 ready
- Pendiente: papá llena las 32 restantes vía bulk-import workflow

---

## Stack arquitectónico (estable post-SS2 foundation)

| Capa | Tech | Notas |
|---|---|---|
| Frontend | Next.js 15 + React 19 + Tailwind + shadcn | Deploy Railway |
| Backend | Convex | 19+ tablas (3+ adds en SS2) |
| Auth | Clerk Organizations | Test mode dev |
| Email | Resend | FROM `noreply@businessinteligencehub.com` |
| AI | Claude API | `claude-sonnet-4-20250514` |
| Blob storage | Railway S3 | PDFs/facturas; metadata en Convex |
| PDF gen | Puppeteer-core en Vercel | post-MVP: worker Railway |
| Firma | **Firmame** (skeleton listo, integración pendiente docs) | branch SS2 |

---

## Pendientes infraestructura (sin cambios)

- Railway custom domain `www.businessinteligencehub.com` — 404 en routing
- GitHub auth — gh auth switch a `CRA-dotcom` antes de push
- Crons deshabilitados en `convex/crons.ts` excepto contract-reminders (registrado pero no probado)

---

## Action items manuales (Christian, no agente)

1. **Conseguir Firmame API docs + sandbox key** — bloquea Phase 4-6 (8 tareas)
2. **Crear contratos HTML iniciales** para org DESC (mínimo 1 empresa × 1-2 subservicios)
3. **Decidir si mergear branch SS2 a main YA** (foundation lista) o esperar a tener Firmame integration completa
4. **Llenar 32 plantillas deliverable** restantes (legacy item de SS1)

---

## Rules of engagement (sin cambios)

- Brainstorming → spec → writing-plans → subagent-driven (workflow validado SS0, SS1, SS2-partial)
- Default: feature branch + merge `--no-ff`
- Tras cada merge: `npx gitnexus analyze --embeddings`
- `gitnexus_impact` antes de edit a símbolos
- Smoke E2E manual hace Christian (browser)
- Push branch requiere OK explícito (memoria `feedback_no_push_default`)

---

## Lo que NO está en este handoff

- Detalle de cada commit de SS2 — vive en `git log feature/sub-spec-2-contracts-firmame`
- Detalle de cada task del plan — vive en `docs/superpowers/plans/2026-05-27-sub-spec-2-contracts-firmame.md`
- Decisiones de marketing / pricing / sales motion
- Análisis del modelo Firmame Master vs BYO (queda como research item #3)
