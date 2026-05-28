# Handoff — Próxima sesión (post 2026-05-27 EOD · SS4 V1 cerrada)

**Misión:** Sacar a mercado lo más rápido posible. SS0, SS1, SS2-foundation, SS3, SS4-V1, SS5, SS6 cerrados en `main`. SS2 final + F6 contador siguen abiertos.

**Sesión origen:** 2026-05-27 (SS4 V1 full cycle — schema + xlsx + parsers + actions + mutations + queries + UI + feed deliverable)
**Estado código:** `main` **70 commits** ahead de `origin/main`. Tests **1017 passed | 1 skipped**. TypeScript clean (excepto pre-existing `useDebouncedAutosave` ortogonal). Sin push (per `feedback_no_push_default`).

---

## 🎯 Lo que se cerró este turno (SS4 V1)

### Sub-spec 4 — Estados financieros ingestion ✅

10 commits implementando V1 completo (Excel + AI extraction + UI + feed a Claude).

| Commit | Contenido |
|---|---|
| `b34a339` | T1 schema: tabla `clientFinancialData` + flag `subservices.isFinancialRelated` |
| `a1b5478` | T2 xlsx dependency |
| `419d457` | T3 `excelParser` helper + 6 tests (TDD) |
| `2c24822` | T4 `financialExtractionPrompt` + parser + 13 tests |
| `1faeffc` | T5 upload + extractInternal actions + 6 upload tests |
| `94f455d` | T6 extractInternal tests (5 tests; retry/error/idempotence) |
| `0caf0b0` | T7 validation mutations (markValidated/markRejected/manuallySetLineItems) + deleteRecord action + 13 tests |
| `3cbf8f5` | T8+T9 listByClient + getFinancialContext queries + 9 tests |
| `de555d2` | T10-T12 UI page + UploadForm + PeriodsTable + ViewerDrawer |
| `c1b0a1d` | T13 generateDeliverable feeds financial context + checkbox UI subservicios + 4 tests |

**Side schema changes (no breaking):**
- `documentEvents.entityType` ahora acepta `"financial_data"`
- `ClientScopedBlobKind` ahora acepta `"finanzas"` (Railway S3 path `<orgId>/<clientId>/finanzas/<period>-<filename>`)
- `subservices.isFinancialRelated: v.optional(v.boolean())`
- `subservices.create` y `update` mutations aceptan `isFinancialRelated`

**Flujo end-to-end (admin):**
1. Admin marca subservicio como "Relacionado a finanzas" en `/configuracion/subservicios`.
2. Admin va a `/clientes/[id]/finanzas`, sube Excel + periodo + tipo.
3. Sistema sube blob a Railway S3, inserta row `status=uploaded`, schedule `extractInternal`.
4. `extractInternal` descarga blob, parsea Excel, llama Claude con prompt versionado, patcha row con `lineItems[]` + `aiExtraction { model, promptVersion, costUsd, rawSnippet }`, `status=extracted`. Retry 3x con backoff exponencial; fallo total → `status=error` + `errorMessage`.
5. Admin revisa line items agrupados por categoría en `ViewerDrawer`. Acciones: Validar / Rechazar (con razón) / Borrar / Descargar.
6. Cuando se genera entregable para subservicio con `isFinancialRelated=true`, `generateDeliverable` busca el row validado más reciente `period <= ${year}-${month}` y lo inyecta al prompt Claude en sección `DATOS FINANCIEROS DEL CLIENTE` agrupada por categoría.

### Test count progression

| Punto | Tests |
|---|---|
| Inicio sesión (post adversarial fixes) | 961 |
| Post T3 excelParser | 967 |
| Post T4 prompt parser | 980 |
| Post T5 upload action | 986 |
| Post T6 extractInternal | 991 |
| Post T7 mutations | 1004 |
| Post T8+T9 queries | 1013 |
| **Post T13 final (financial context test)** | **1017 / 1 skipped** |

(+56 tests, meta T14 era ≥970 — superada con margen)

---

## 🗺️ MVP Roadmap status

| Sub-spec | Status |
|---|---|
| 0 — Pricing foundation | ✅ main |
| 1 — Deliverable content catalog | ✅ main + hardened |
| 2 — Contratos + Firmame | ⚙️ Foundation main. T11-T18 GATED |
| 3 — Per-service start month | ✅ main + 3 fixes (F7+F8+F9 done) |
| 4 — Financial statements ingestion | ✅ **V1 main** (este turno) |
| 5 — Invoice issue date | ✅ main + 1 fix (F5 done; ⚠ F6 pendiente contador) |
| 6 — Year-over-year tier | ✅ main + 4 fixes (F1+F2+F3+F4 done) |
| 7 — Queue + scale infra | Post-MVP |

---

## 🔴 Research items pendientes (sin cambios desde turno previo)

### #1 — Contratos HTML iniciales (papá)
Min 1 contrato HTML para DESC org + 1 issuing company + 1-2 subservicios. Bloquea producción SS2, no código.

### #2 — Firmame API docs + sandbox key
Bloquea SS2 T11-T18 (8 tareas, ~3-4 días). Modelo: managed-BYO (memoria `project_firmame_account_model`).

### #3 — Validar timezone CFDI con contador (F6)
Antes de cualquier filtro fiscal mensual en producción, confirmar con contador si `issueDate` debe ser local CDMX o UTC. F6 puede llevarse facturas al mes anterior/siguiente.

### #4 — V2 SS4: PDF + OCR
V1 acepta sólo Excel. PDF + OCR (Claude vision) diferido a V2 una vez que el flujo Excel esté validado en producción.

---

## Cómo arrancar próxima sesión

```bash
cd /Users/christiandarrelcoverlozano/Desktop/Projects/DESC
git status                              # working tree clean
git log --oneline -10                   # ver últimos commits SS4
npm test 2>&1 | tail -3                 # baseline 1017
npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -5  # clean
```

### Opción A — Smoke browser SS4
Único pendiente antes de declarar SS4 producción-ready. Flow:
1. `/configuracion/subservicios` → marcar 1 subservicio como "Relacionado a finanzas".
2. `/clientes/[id]/finanzas` → subir un Excel real, ver row `uploaded` → `extracted` en unos segundos.
3. Abrir drawer, revisar line items agrupados, validar.
4. Generar entregable de ese subservicio para el mes → confirmar que el HTML resultante refleja los datos financieros (o pedir a Claude que los cite explícitamente vía template variable AI).

Necesita `ANTHROPIC_API_KEY` accesible al deployment Convex + Railway S3 creds activas.

### Opción B — Validar F6 con contador + fix timezone
Único finding pendiente que afecta producción. Decide con contador: ¿CFDI `Fecha` es hora local CDMX o UTC? Después del input, fix en `convex/lib/cfdiParser.ts` toma 30 min.

### Opción C — Continuar SS2 si tienes Firmame docs
Branch `feature/sub-spec-2-contracts-firmame` preservada. T11-T18 desbloqueados con docs.

### Opción D — SS4 polish / V2 prep
- Validación adversarial del flujo SS4 entero (ya cerrado V1 pero sin adversarial pass).
- Considerar PDF+OCR (V2).
- Edit inline de line items (V2; V1 tiene `manuallySetLineItems` replace-all).
- Comparativas multi-periodo (V2 dashboard).

---

## Action items manuales (Christian)

1. **Smoke browser SS4** — flow upload Excel → validar → generar entregable
2. **Validar timezone CFDI con contador (F6)** — único finding pendiente que afecta prod
3. **Conseguir Firmame API docs + sandbox key** — SS2 final
4. **Crear contratos HTML iniciales** para DESC
5. **Decidir push a origin/main** (70 commits ahead)
6. **Decidir** próximo: SS2 (Firmame docs) vs F6 fix vs SS4 V2 polish

---

## Specs + Plans (este turno usó SS4)

| Path | Status |
|---|---|
| `docs/superpowers/specs/2026-05-27-financial-statements-ingestion-design.md` | SS4 — spec ✅ |
| `docs/superpowers/plans/2026-05-27-financial-statements-ingestion.md` | SS4 — plan ✅ ejecutado |

---

## Memorias (sin cambios este turno)

Memorias relevantes para SS4 (consulta si necesitas contexto):
- `project_blob_storage` — Railway S3, no Convex
- `project_doc_lifecycle_pipeline` — orden cotización→contrato→factura→entregable
- `reference_anthropic_api_key` — Keychain via get-secret
- `feedback_design_full_dump` — full dump en design phases
- `feedback_no_push_default` — no pushes ni deploys por default

---

## Rules of engagement (sin cambios)

- Brainstorming → spec → writing-plans → subagent-driven (workflow validado en 6 sub-specs ya, ahora SS4 incluido)
- Feature branch + merge `--no-ff` para tareas grandes; main directo para tareas pequeñas (SS3/SS4/SS5/SS6 fueron main directo — SS4 fue 10 commits main directo per decisión Christian arranque del turno)
- Tras cada merge: `npx gitnexus analyze --embeddings`
- `gitnexus_impact` antes de editar símbolos críticos
- Smoke E2E manual hace Christian (browser)
- Push branch requiere OK explícito (memoria `feedback_no_push_default`)
- Full dump en design phases sin pausar por sección (memoria `feedback_design_full_dump`)

---

## Stack arquitectónico (actualizaciones SS4)

| Capa | Tech | Notas |
|---|---|---|
| Frontend | Next.js 15 + React 19 + Tailwind + shadcn | Deploy Railway |
| Backend | Convex | 20 tablas (+`clientFinancialData` este turno); `subservices.isFinancialRelated` flag nuevo |
| Auth | Clerk Organizations | Test mode dev |
| Email | Resend | FROM `noreply@businessinteligencehub.com` |
| AI | Claude API | `claude-sonnet-4-20250514` (mismo modelo para deliverables y SS4 extraction) |
| Blob storage | Railway S3 | PDFs/facturas/finanzas (nuevo kind `finanzas` este turno); metadata en Convex |
| PDF gen | Puppeteer-core en Vercel | post-MVP: worker Railway |
| Firma | Firmame (skeleton listo, integración pendiente docs) | branch + plan listos |
| CFDI parsing | `convex/lib/cfdiParser.ts` (regex-based, ⚠ F6 timezone pendiente contador) | SS5 |
| Excel parsing | `convex/lib/excelParser.ts` (`xlsx` 0.18.5) | SS4 V1 |
| AI financial extraction | `convex/lib/financialExtractionPrompt.ts` (`PROMPT_VERSION="v1-2026-05-27"`) | SS4 V1 |

---

## Bloquantes activos

| Blocker | Severidad | Status |
|---|---|---|
| F6 CFDI timezone | IMPORTANTE | 🔴 Requiere contador |
| Firmame API docs + sandbox | CRÍTICO para SS2 final | 🔴 Pendiente vendor docs |
| Contratos HTML iniciales (papá) | CRÍTICO para SS2 producción | 🔴 Pendiente papá |
| `ANTHROPIC_API_KEY` en Convex deployment | MEDIO | Sin este key, SS4 extracción deja row en `status=error` con `errorMessage` claro. SS4 V1 ya maneja missing key gracefully. |
| 70 commits ahead de `origin/main` | INFO | Decidir push cuando esté listo SS2 final + F6 |
