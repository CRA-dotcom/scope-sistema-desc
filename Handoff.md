# Handoff — Próxima sesión

**Fecha cierre:** 2026-05-28 · **Misión:** Sacar a mercado lo más rápido posible.

---

## Estado código

| | |
|---|---|
| Branch | `main` |
| Commits totales | **561** |
| Commits ahead de `origin/main` | **560+** (sin push per `feedback_no_push_default`) |
| Tests | **1096 passed / 1 skipped** |
| TypeScript | **0 errores** |
| Convex codegen | clean |
| GitNexus | actualizado (10,017 nodes / 11,225 edges) |
| Working tree no-commiteado | `AGENTS.md`, `CLAUDE.md` (mods triviales), `docs/superpowers/plans/2026-05-28-fase4-…md` (untracked) |

---

## Doc del papá (`Puntos a modificar de BIHive - 28052026.docx`) — 17/26 done

### ✅ Done (17)

`#1` post-creación picker subservicios · `#2` banner cliente en proyección · `#3` deliverable list por servicio · `#4` re-edit desde el inicio · `#5` cotizaciones batch · `#8` autosave + draft discovery · `#9` multi-subservicio · `#10` cliente en wizard header · `#12` budget widget monthly avg · `#13` tooltip Margen · `#14` checkbox Comisiones · `#16` reabrir cuestionario · `#19` Construcción seedeada · `#21c` cuestionario por sección · `#22a/b/c/d` cotizaciones (delete + manual + empresa selector + por subservicio) · `#23` empresa en contratos · `#24` matriz docs cliente · `#25` generar entregable por celda · `#25-bis` filtros facturación + sidebar reorder

### ⏳ Bloqueados por papá (4)

| # | Pregunta que necesitamos respondida |
|---|---|
| **#6** | Tabulador fiscal — ¿qué fórmula? ¿tarifa por hora/unidad/tier? |
| **#15** | Distribución inteligente — ¿algoritmo? (peso mercado / proporcional / otro) |
| **#17** | Redondeo — ¿múltiplos de $10K o $10M? (parece typo en doc) |
| **#26-B** | Matriz docs cliente — ¿qué documentos exactos en checklist? (acta, INE, socios, nómina + qué más) |

### 🚫 Deferido a v2 (1)

**#26-A** multi-plataforma (Digma/SIEN/SOESSI etc anidadas) — rompe Clerk Orgs, re-tenant completo. Acuerdo previo.

### 📝 N/A (4)

`#7` no existe en doc · `#11` "¿qué muestra esta imagen?" feedback · `#18` aclaración de copy · `#20` subsumido por #9

---

## Firmame — modelo de cuentas confirmado

**Decisión 2026-05-27:** **managed-BYO** (memoria `project_firmame_account_model`).

- **1 cuenta Firmame por organización** en Projex.
- **Christian abre y administra** todas las cuentas. El despacho cliente NO se registra en Firmame, no la ve, no la toca.
- Cliente final del despacho recibe email con remitente "Despacho X" (no "Projex") — branding limpio.
- Aislamiento de riesgo: una cuenta suspendida no afecta a las demás.
- Modelo de negocio: Christian paga Firmame N veces + markup en suscripción Projex o por firma.

Código actual de SS2 ya soporta esto sin cambios — `orgIntegrations` es per-org con su propio `apiKeySecretRef` + `webhookSecretRef`.

### 4 preguntas pendientes para Firmame (research items)

1. ¿Permite múltiples cuentas bajo mismo email/RFC operador? O usar email aliases (`firmame+desc@christian.com`)?
2. ¿Webhook URL custom por cuenta o única global? (afecta routing en `/api/webhooks/firmame`)
3. ¿Descuentos por volumen / programa partner cuando opere 5+ o 10+ cuentas?
4. ¿Branding personalizado por cuenta (logo + sender name del despacho)?

**Bloquea:** SS2 T11-T18 (8 tareas, ~3-4 días) — además de los API docs + sandbox key.

---

## Bloqueantes activos

| # | Bloqueante | Severidad | Acción |
|---|---|---|---|
| 1 | F6 CFDI timezone | IMPORTANTE | Validar con contador (CFDI `Fecha` local CDMX o UTC) |
| 2 | Firmame API docs + sandbox key | CRÍTICO SS2 | Pedir a vendor + las 4 preguntas de arriba |
| 3 | Contratos HTML iniciales | CRÍTICO SS2 | Pendiente papá |
| 4 | 4 decisiones papá (doc puntos #6/#15/#17/#26-B) | MEDIO | Enviar email con preguntas concretas |
| 5 | Smoke seed data (test org sin proyecciones `active` ni empresas emitentes) | MEDIO | Seedear para validar #22b/c/#23 end-to-end |
| 6 | 560+ commits ahead de `origin/main` | INFO | Decidir push (durante beta = no push per memoria) |
| 7 | Pre-existing `useDebouncedAutosave` lint warning | LOW | Ortogonal, no afecta runtime |

---

## Lo último que se cerró (esta sesión 2026-05-28)

72 commits desde SS4-V1 (`e347be3`). Incluye:

- **SS7** (3 features: F1 reabrir cuestionario, F2 save defense + draft discovery, F3 re-edit cascade)
- **5 fix-groups adversarial** post-SS7 (clientId collision multi-tab, cross-org guard cascade, duplicate draft prevention, etc.)
- **17 puntos del doc del papá** (6 quick wins + 4 fases grandes + 4 fix-groups adversarial)
- **3 bugs CRÍTICOS atajados antes de prod:**
  - `cloneProjectionToDraft` duplicaba drafts → wizard crash
  - `replaceProjection` sin cross-org guard → data leak
  - `useProjectionDraftSave` clientId collision multi-tab
- **Bug crítico Fase 3 atajado:** `issuingCompanyId` override se guardaba pero nunca se leía en PDF/send → feature completamente rota end-to-end, ahora fixed.
- **Multi-subservicio plumbing real:** deliverable gen + cron + quotations gen leían solo `subserviceId` scalar; agregamos `effectiveSubserviceIds(ps)` helper que prefiere `subserviceIds` array (Option A — primario, no fan-out).

---

## Próxima sesión — opciones concretas

### Opción A — Bloque F real (pipeline papa-doc #6 + financiero)
Requiere primero respuestas del papá sobre tabulador. Si llegan, atacamos #6 + refinamos pricing model en contratos.

### Opción B — SS2 finalización
Cuando lleguen Firmame API docs + sandbox key + respuestas a las 4 preguntas, atacamos T11-T18 (8 tareas).

### Opción C — Seed + smoke real
Agregar a test org: 1 proyección `active` + 1 empresa emisora + 1 contrato firmado. Re-smokear #22b, #22c, #23 end-to-end en browser para tener evidencia visual.

### Opción D — F6 CFDI timezone con contador
Único finding pendiente de SS5 que afecta producción. 30 min de código después de tener el input del contador.

### Opción E — Push decision + cleanup
Decidir push a `origin/main` (560+ ahead). Probablemente prematuro si la app está en beta interna.

### Opción F — Bloque G/H futuro (matriz docs cliente / multi-plataforma)
G requiere respuesta papá (#26-B). H está deferido a v2 — solo arrancar si vamos a producto general.

---

## Cómo arrancar la próxima sesión

```bash
cd /Users/christiandarrelcoverlozano/Desktop/Projects/DESC
git status                                  # working tree clean (mods triviales OK)
git log --oneline | head -20                # últimos commits
npm test 2>&1 | tail -3                     # baseline 1096
npx tsc --noEmit 2>&1 | head -5             # clean
ls docs/superpowers/specs/ | tail -10       # specs recientes
ls docs/superpowers/plans/ | tail -10       # plans recientes
```

**Pre-flight obligatorio si vas a tocar código:** `npx gitnexus analyze --embeddings` si la indexación es stale.

---

## Memorias relevantes

- `project_firmame_account_model` — managed-BYO confirmado
- `project_doc_lifecycle_pipeline` — orden cot → contrato → factura → entregable
- `project_blob_storage` — Railway S3 (NO Convex)
- `feedback_no_push_default` — no push durante beta v2
- `feedback_design_full_dump` — full dump en design phases sin pausar por sección
- `reference_anthropic_api_key` — `~/.claude/bin/get-secret anthropic-api-key`
- `reference_ops_notification_email` — christiancover81@gmail.com
- `project_global_audit_gap` — edits a catálogo global (orgId=undefined) NO se logean

---

## Stack arquitectónico

| Capa | Tech | Notas |
|---|---|---|
| Frontend | Next.js 15 + React 19 + Tailwind + shadcn | Deploy Railway |
| Backend | Convex | 20+ tablas, schema fields nuevos por SS7 + papá-doc |
| Auth | Clerk Organizations | per-org isolation airtight (verificado adversarial) |
| Email | Resend | FROM `noreply@businessinteligencehub.com` |
| AI | Claude API | `claude-sonnet-4-20250514` |
| Blob storage | Railway S3 | metadata en Convex |
| PDF | Puppeteer-core en Vercel | post-MVP: worker Railway |
| Firma | Firmame (managed-BYO) | pendiente docs + sandbox vendor |
| CFDI parsing | `convex/lib/cfdiParser.ts` | ⚠ F6 timezone pendiente contador |
| Excel parsing | `convex/lib/excelParser.ts` (`xlsx` 0.18.5) | SS4 V1 |
| AI financial extraction | `convex/lib/financialExtractionPrompt.ts` (`PROMPT_VERSION="v1-2026-05-27"`) | SS4 V1 |

---

## Rules of engagement (sin cambios)

- Brainstorming → spec → writing-plans → subagent-driven (workflow validado)
- Smoke E2E manual en browser (test data limitada en test org — seedear si necesitas validar)
- Push branch requiere OK explícito (memoria `feedback_no_push_default`)
- Full dump en design phases sin pausar (memoria `feedback_design_full_dump`)
- Adversarial pass por feature antes de cerrar (validado 4 veces esta sesión, encontró bugs CRÍTICOS reales)
- Subagents para todo trabajo no-coordinación (per directiva user de esta sesión)
