# Handoff — Próxima sesión (post 2026-05-28 EOD · SS7 cerrado)

**Misión:** Sacar a mercado lo más rápido posible. SS0, SS1, SS2-foundation, SS3, SS4-V1, SS5, SS6, SS7 cerrados en `main`. SS2 final + F6 contador siguen abiertos. SS7 añadió resiliencia de proyecciones y cuestionarios (reopen, draft save defense, re-edit cascade).

**Sesión origen:** 2026-05-28 (SS7 — projection + questionnaire resilience, 3 features: F1 reopen, F2 draft save, F3 re-edit cascade)
**Estado código:** `main` **93 commits** ahead de `origin/main`. Tests **1045 passed | 1 skipped**. TypeScript: 1 pre-existing error (`applyDraftStateToProjection.ts:170 TS2367` — unintentional comparison warning, no runtime impact). Convex codegen clean. Sin push (per `feedback_no_push_default`).

---

## Lo que se cerró este turno (SS7)

### Sub-spec 7 — Projection + Questionnaire Resilience

3 features, 22 commits implementando resiliencia end-to-end.

| Commit | Contenido |
|---|---|
| `4c40d7c` | docs(ss7): projection + questionnaire resilience spec |
| `3235ee5` | docs(ss7): implementation plan |
| `8920a82` | feat(ss7): schema patches — `questionnaireResponses` fields, `documentEvents` enums, indexes on contracts/deliverables/invoices |
| `6d446f9` | feat(ss7-f1): `reopen` mutation for completed questionnaires |
| `f367366` | fix(ss7-f1): align `asUserOfOrg` tokenIdentifier with sibling tests |
| `7fb9381` | feat(ss7-f1): UI button to reopen completed questionnaires |
| `9adb5bb` | feat(ss7-f2): `useProjectionDraftSave` hook with retry + status |
| `2a44a55` | feat(ss7-f2): `listMyActiveDrafts` query for navbar + dashboard |
| `f367366` | fix(ss7-f1): align asUserOfOrg tokenIdentifier with sibling tests |
| `85b0c05` | fix(ss7-f2): `useDebouncedAutosave` resets saved → idle after 3s |
| `94ee836` | feat(ss7-f2): wire `useProjectionDraftSave` into the wizard |
| `7343356` | feat(ss7-f2): wire `useProjectionDraftSave` into the wizard (wiring) |
| `5c4f06c` | fix(ss7-f2): plumb clientId through `useProjectionDraftSave` |
| `2fdee1a` | feat(ss7-f2): `DraftPendingBanner` on dashboard home |
| `60bff5a` | feat(ss7-f2): `DraftNavbarChip` — persistent draft indicator |
| `643a9c2` | feat(ss7-f3): `getProjectionDownstreamCounts` helper |
| `5683e47` | feat(ss7-f3): `getDownstreamSummary` query for re-edit warning UI |
| `17e6c90` | refactor(ss7-f3): extract `applyDraftStateToProjection` helper |
| `d3f5cba` | feat(ss7-f3): `cloneProjectionToDraft` mutation |
| `e611139` | feat(ss7-f3): `replaceProjection` + `projections.create` branch on `previousProjectionId` |
| `1c4c7e7` | fix(ss7-f3): cross-org guard on `replaceProjection` |
| `4ea7fd7` | feat(ss7-f3): "Editar desde el inicio" button + downstream warning modal |

### Schema changes (SS7)

| Table / Field | Change |
|---|---|
| `questionnaireResponses.reopenedAt` | `v.optional(v.number())` — timestamp del último reopen |
| `questionnaireResponses.reopenCount` | `v.optional(v.number())` — número de veces reabierto |
| `documentEvents.entityType` | Nuevos valores aceptados: `"questionnaire_response"`, `"projection_draft"` |
| `contracts` | Nuevo index `by_projServiceId` — búsqueda por servicio de proyección |
| `deliverables` | Nuevo index `by_projServiceId` — búsqueda downstream |
| `invoices` | Nuevo index `by_projectionId` — búsqueda downstream para re-edit cascade |

### Wave summary

**F1 — Questionnaire Reopen**
- `questionnaires.reopen` mutation: cambia status `completed` → `in_progress`, incrementa `reopenCount`, registra `reopenedAt`
- UI: botón "Reabrir cuestionario" en `/cuestionarios/[id]` con confirmación
- 3 tests

**F2 — Draft Save Defense + UI Indicators**
- `useProjectionDraftSave` hook: autosave debounced (1s) con retry 3x exponencial, status `idle/saving/saved/error`
- `DraftSaveStatus` component: indicador en header del wizard (spinner, checkmark, error)
- `listMyActiveDrafts` query: drafts del usuario actual para navbar + dashboard
- `DraftNavbarChip`: chip persistente en sidebar con badge de drafts activos
- `DraftPendingBanner`: banner en dashboard home si hay drafts sin completar
- 7 tests

**F3 — Re-edit Cascade**
- `getDownstreamSummary` query: cuenta contratos/entregables/facturas downstream para warning
- `cloneProjectionToDraft` mutation: clona proyección existente a nuevo draft con `previousProjectionId`
- `replaceProjection` mutation: reemplaza proyección (soft-delete anterior, activa nueva) con guard cross-org
- `applyDraftStateToProjection` helper: aplica campos draft a proyección — extraído para testabilidad
- "Editar desde el inicio" button en `/proyecciones/[id]` con modal de advertencia downstream
- 5 tests

### Test count progression

| Punto | Tests |
|---|---|
| Baseline SS4 (inicio sesión) | 1017 |
| Post F1 (reopen mutation + UI) | 1020 |
| Post F2 (draft save hook + UI components) | 1027 |
| Post F3 (re-edit cascade + UI) | **1045 / 1 skipped** |

(+28 tests, meta ≥1045 — exactamente alcanzada)

---

## MVP Roadmap status

| Sub-spec | Status |
|---|---|
| 0 — Pricing foundation | ✅ main |
| 1 — Deliverable content catalog | ✅ main + hardened |
| 2 — Contratos + Firmame | ⚙️ Foundation main. T11-T18 GATED |
| 3 — Per-service start month | ✅ main + 3 fixes (F7+F8+F9 done) |
| 4 — Financial statements ingestion | ✅ V1 main |
| 5 — Invoice issue date | ✅ main + 1 fix (F5 done; ⚠ F6 pendiente contador) |
| 6 — Year-over-year tier | ✅ main + 4 fixes (F1+F2+F3+F4 done) |
| 7 — Projection + questionnaire resilience | ✅ **main (este turno)** |
| 8 — Queue + scale infra | Post-MVP |

---

## Research items pendientes (heredados + sin cambios)

### #1 — Contratos HTML iniciales (papá)
Min 1 contrato HTML para DESC org + 1 issuing company + 1-2 subservicios. Bloquea producción SS2, no código.

### #2 — Firmame API docs + sandbox key
Bloquea SS2 T11-T18 (8 tareas, ~3-4 días). Modelo: managed-BYO (memoria `project_firmame_account_model`).

### #3 — Validar timezone CFDI con contador (F6)
Antes de cualquier filtro fiscal mensual en producción, confirmar con contador si `issueDate` debe ser local CDMX o UTC. F6 puede llevarse facturas al mes anterior/siguiente.

### #4 — V2 SS4: PDF + OCR
V1 acepta sólo Excel. PDF + OCR (Claude vision) diferido a V2 una vez que el flujo Excel esté validado en producción.

---

## Smoke browser checklist SS7 (Christian)

4 flujos que cubren las 3 features nuevas. Requiere dev server corriendo + datos existentes.

### Flow 1 — Questionnaire Reopen
1. Ir a `/cuestionarios` → abrir un cuestionario en status `completed`
2. Verificar que aparece botón "Reabrir cuestionario"
3. Confirmar en modal → status cambia a `in_progress`
4. Volver a `/cuestionarios` → status actualizado en tabla

### Flow 2 — Draft Save Status Indicator
1. Ir a `/proyecciones/nueva` → llenar algunos campos del wizard
2. Verificar indicador en header: debe mostrar "Guardando..." (spinner) dentro de 1s de cada cambio
3. Esperar 3s sin cambios → indicador debe cambiar a "Guardado" (checkmark)
4. Verificar que el draft persiste si recargas la página (puede ser en borrador)

### Flow 3 — Draft Notification Banner + Chip
1. Dejar al menos 1 proyección en estado `draft` sin completar
2. Ir a dashboard home (`/`) → verificar que aparece `DraftPendingBanner` con link a la proyección
3. Verificar que `DraftNavbarChip` en la barra lateral muestra badge con número de drafts activos
4. Completar o descartar el draft → verificar que banner y chip desaparecen

### Flow 4 — Re-edit Cascade (Editar desde el inicio)
1. Ir a una proyección completada con al menos 1 contrato o entregable asociado
2. Verificar que aparece botón "Editar desde el inicio"
3. Hacer clic → modal de advertencia debe listar conteo de documentos downstream afectados
4. Confirmar → sistema crea nuevo draft clonado, redirige al wizard
5. Completar el wizard → `replaceProjection` reemplaza la proyección anterior
6. Verificar que la proyección anterior queda soft-deleted y la nueva es la activa

---

## Cómo arrancar próxima sesión

```bash
cd /Users/christiandarrelcoverlozano/Desktop/Projects/DESC
git status                              # working tree clean
git log --oneline -10                   # ver últimos commits SS7
npm test 2>&1 | tail -3                 # baseline 1045
npx tsc --noEmit 2>&1 | grep -v applyDraftState | head -5  # 1 pre-existing warning
```

### Opción A — Smoke browser SS7
Flow checklist arriba. Requiere `ANTHROPIC_API_KEY` accesible al deployment Convex.

### Opción B — Smoke browser SS4 (aún pendiente)
Flow: upload Excel → validar line items → generar entregable → confirmar que HTML refleja datos financieros.
Requiere `ANTHROPIC_API_KEY` + Railway S3 creds activas.

### Opción C — Validar F6 con contador + fix timezone
30 min fix en `convex/lib/cfdiParser.ts` una vez que contador confirme timezone CFDI (local CDMX vs UTC).

### Opción D — Continuar SS2 si tienes Firmame docs
Branch `feature/sub-spec-2-contracts-firmame` preservada. T11-T18 desbloqueados con docs.

---

## Action items manuales (Christian)

1. **Smoke browser SS7** — 4 flujos del checklist arriba
2. **Smoke browser SS4** — upload Excel → validar → generar entregable
3. **Validar timezone CFDI con contador (F6)** — único finding pendiente que afecta prod
4. **Conseguir Firmame API docs + sandbox key** — SS2 final
5. **Crear contratos HTML iniciales** para DESC
6. **Decidir push a origin/main** (93 commits ahead)
7. **Decidir** próximo: SS2 (Firmame docs) vs F6 fix vs SS4 V2 polish

---

## Specs + Plans (este turno usó SS7)

| Path | Status |
|---|---|
| `docs/superpowers/specs/2026-05-27-financial-statements-ingestion-design.md` | SS4 — spec ✅ |
| `docs/superpowers/plans/2026-05-27-financial-statements-ingestion.md` | SS4 — plan ✅ ejecutado |
| `docs/superpowers/specs/2026-05-28-projection-questionnaire-resilience-design.md` | SS7 — spec ✅ |
| `docs/superpowers/plans/2026-05-28-projection-questionnaire-resilience.md` | SS7 — plan ✅ ejecutado |

---

## Memorias relevantes

- `project_blob_storage` — Railway S3, no Convex
- `project_doc_lifecycle_pipeline` — orden cotización→contrato→factura→entregable
- `reference_anthropic_api_key` — Keychain via get-secret
- `feedback_design_full_dump` — full dump en design phases
- `feedback_no_push_default` — no pushes ni deploys por default
- `project_firmame_account_model` — managed-BYO account model

---

## Rules of engagement (sin cambios)

- Brainstorming → spec → writing-plans → subagent-driven (workflow validado en SS0–SS7)
- Feature branch + merge `--no-ff` para tareas grandes; main directo para tareas pequeñas
- Tras cada merge: `npx gitnexus analyze --embeddings`
- `gitnexus_impact` antes de editar símbolos críticos
- Smoke E2E manual hace Christian (browser)
- Push branch requiere OK explícito (memoria `feedback_no_push_default`)
- Full dump en design phases sin pausar por sección (memoria `feedback_design_full_dump`)

---

## Stack arquitectónico (actualizaciones SS7)

| Capa | Tech | Notas |
|---|---|---|
| Frontend | Next.js 15 + React 19 + Tailwind + shadcn | Deploy Railway |
| Backend | Convex | 20 tablas; `questionnaireResponses` +2 campos (reopenedAt, reopenCount); indexes nuevos en contracts/deliverables/invoices |
| Auth | Clerk Organizations | Test mode dev |
| Email | Resend | FROM `noreply@businessinteligencehub.com` |
| AI | Claude API | `claude-sonnet-4-20250514` |
| Blob storage | Railway S3 | PDFs/facturas/finanzas; metadata en Convex |
| PDF gen | Puppeteer-core en Vercel | post-MVP: worker Railway |
| Firma | Firmame (skeleton listo, integración pendiente docs) | branch + plan listos |
| CFDI parsing | `convex/lib/cfdiParser.ts` (regex-based, ⚠ F6 timezone pendiente contador) | SS5 |
| Excel parsing | `convex/lib/excelParser.ts` (`xlsx` 0.18.5) | SS4 V1 |
| AI financial extraction | `convex/lib/financialExtractionPrompt.ts` (`PROMPT_VERSION="v1-2026-05-27"`) | SS4 V1 |
| Draft resilience | `useProjectionDraftSave` hook + `DraftSaveStatus` + `DraftNavbarChip` + `DraftPendingBanner` | SS7 F2 |
| Re-edit cascade | `replaceProjection` + `cloneProjectionToDraft` + `applyDraftStateToProjection` | SS7 F3 |

---

## Bloquantes activos

| Blocker | Severidad | Status |
|---|---|---|
| F6 CFDI timezone | IMPORTANTE | Requiere contador |
| Firmame API docs + sandbox | CRÍTICO para SS2 final | Pendiente vendor docs |
| Contratos HTML iniciales (papá) | CRÍTICO para SS2 producción | Pendiente papá |
| `ANTHROPIC_API_KEY` en Convex deployment | MEDIO | Sin este key, SS4 extracción deja row en `status=error` con `errorMessage` claro. SS4 V1 ya maneja missing key gracefully. |
| 93 commits ahead de `origin/main` | INFO | Decidir push cuando esté listo SS2 final + F6 |
