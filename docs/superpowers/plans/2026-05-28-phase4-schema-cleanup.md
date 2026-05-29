# Phase 4 — Schema cleanup (drops seguros)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar zombies del schema sin riesgo: tabla `satConcepts` (0 refs en toda la base), campo `projections.seasonalityMode` (write-only, 3 writers sin reader), 4 índices con 0 refs. Reducir superficie de mantenimiento sin tocar funcionalidad.

**Architecture:** Solo schema + writers. Cero tests legacy se rompen porque los targets no se leen. `seasonalityDeltas` y `projectionServices.subserviceId` scalar quedan FUERA de scope (siguen siendo readers en fallback paths legacy — requieren migración separada).

**Tech Stack:** Convex schema + mutations. Vitest baseline. Sin migración de datos en runtime (estamos en beta — no hay rows en prod).

---

## Pre-flight

- [ ] **Step 0.1: Baseline limpio**

Run: `npm test 2>&1 | grep "Tests" | tail -1 && npx tsc --noEmit 2>&1 | tail -3`
Expected: `Tests 1177 passed | 1 skipped` + 0 TS errors.

- [ ] **Step 0.2: Working tree**

Run: `git status --short`
Expected: solo `?? docs/superpowers/plans/2026-05-28-fase4-...` (papá-doc untracked, unrelated). Si hay otros mods, pausar.

---

## Task 1: Drop tabla `satConcepts` completa

**Files:**
- Modify: `convex/schema.ts` (remove `satConcepts` defineTable + 4 indexes)

**Contexto:** Tabla zombie confirmed por Phase 1 audit: 0 refs fuera de schema.ts. No existen `convex/functions/satConcepts/`. Tabla con 15 campos + 4 índices (by_orgId, by_claveProdServ, by_orgId_active, by_orgId_isDefault).

Schema-only drop. No migration needed (no consumers).

- [ ] **Step 1.1: Verificar 0 refs**

Run: `grep -rn "satConcepts\|claveProdServ\|claveUnidad" convex/ src/ tests/ 2>/dev/null | grep -v schema.ts | grep -v _generated`
Expected: vacío. Si hay alguna ref, reportar BLOCKED y NO drop.

- [ ] **Step 1.2: Drop del schema**

En `convex/schema.ts`, encontrar y eliminar el bloque completo `satConcepts: defineTable({ ... }).index(...).index(...).index(...).index(...),` (alrededor de líneas 840-864). Verificar que la coma del bloque anterior y la sintaxis quedan consistentes.

- [ ] **Step 1.3: Codegen + tests**

Run: `npx convex codegen 2>&1 | tail -3 && npm test 2>&1 | grep "Tests" | tail -1`
Expected: codegen clean, 1177 tests pass (sin regresión).

- [ ] **Step 1.4: tsc clean**

Run: `npx tsc --noEmit 2>&1 | tail -3`
Expected: 0 errors. Si hay errores que referencian `satConcepts`, es que el grep falló — investigar.

- [ ] **Step 1.5: Commit**

```bash
git add convex/schema.ts
git commit -m "$(cat <<'EOF'
chore(schema): drop tabla satConcepts (zombie, 0 refs)

Phase 4 §4.1. Confirmed por audit: ningún query/mutation/action/component
referenciaba la tabla. 15 campos + 4 índices eliminados.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Drop campo `projections.seasonalityMode` + writers

**Files:**
- Modify: `convex/schema.ts:72` (drop field)
- Modify: `convex/functions/projections/mutations.ts:54, 149, 249, 406` (drop writer args + writes)
- Modify: `src/app/(dashboard)/proyecciones/nueva/page.tsx:412` (drop frontend write)

**Contexto:** Campo write-only confirmed: 3 writers (mutations.ts líneas 149, 406; frontend línea 412), 0 readers fuera de schema. Nadie ramifica lógica sobre este valor — el motor seasonality usa `seasonalityData` directo.

- [ ] **Step 2.1: Verificar 0 readers**

Run: `grep -rn "seasonalityMode" convex/ src/ 2>/dev/null | grep -v schema.ts | grep -v _generated`
Expected: ver writers + arg definitions, NO ningún `if (X.seasonalityMode ...)` ni read en JSX.

Sites esperados (writes/args/types, NO reads):
- `convex/functions/projections/mutations.ts:54` — type annotation in helper signature
- `convex/functions/projections/mutations.ts:149-150` — write en `applyDraftStateToProjection` helper
- `convex/functions/projections/mutations.ts:249` — arg validator en `replaceProjection`
- `convex/functions/projections/mutations.ts:406-407` — write en `replaceProjection`
- `src/app/(dashboard)/proyecciones/nueva/page.tsx:412` — write en commit del wizard

- [ ] **Step 2.2: Drop del schema**

En `convex/schema.ts`, encontrar el bloque `seasonalityMode: v.optional(v.union(...))` en `projections` defineTable (alrededor de líneas 72-78). Eliminar el bloque completo. Verificar que la sintaxis del bloque circundante queda consistente (comas).

- [ ] **Step 2.3: Drop de writers en `projections/mutations.ts`**

En `convex/functions/projections/mutations.ts`:

1. **Línea 54** (type annotation en helper): eliminar la línea `seasonalityMode?: "legacy" | "delta_percent" | "outliers";` del type.

2. **Líneas 149-150** (write en helper): eliminar las 2 líneas que escriben `seasonalityMode: newArgs.seasonalityMode ?? <fallback>,`. NO eliminar el `seasonalityDeltas` writer (out of scope).

3. **Línea 249** (arg validator en `replaceProjection`): eliminar el bloque `seasonalityMode: v.optional(v.union(...)),` del args validator.

4. **Líneas 406-407** (write en `replaceProjection`): eliminar las líneas que escriben `seasonalityMode: args.seasonalityMode ?? <fallback>,`.

- [ ] **Step 2.4: Drop del frontend**

En `src/app/(dashboard)/proyecciones/nueva/page.tsx:412`, eliminar la línea:
```ts
seasonalityMode: useSeasonality ? "outliers" : "legacy",
```

Verificar que el objeto literal queda válido (sin coma colgante).

- [ ] **Step 2.5: Codegen + tsc + tests**

Run: `npx convex codegen 2>&1 | tail -3 && npx tsc --noEmit 2>&1 | tail -3 && npm test 2>&1 | grep "Tests" | tail -1`
Expected: codegen clean, 0 TS errors, 1177 tests pass.

- [ ] **Step 2.6: Commit**

```bash
git add convex/schema.ts convex/functions/projections/mutations.ts src/app/\(dashboard\)/proyecciones/nueva/page.tsx
git commit -m "$(cat <<'EOF'
chore(schema): drop projections.seasonalityMode (write-only)

Phase 4 §4.1. Campo write-only confirmed por audit: 3 writers
(2 backend + 1 frontend), 0 readers. El motor seasonality consume
seasonalityData directo, no necesita esta metadata.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Drop 4 índices unused

**Files:**
- Modify: `convex/schema.ts`

**Contexto:** Audit Phase 1 §6.4 listó 11 índices con 0 refs. De esos:
- `satConcepts.*` — ya droppeados con la tabla en Task 1 ✓
- KEEP (uso reservado documentado): `contracts.by_firmameDocumentId`, `clients.by_orgId_industry` (ya usado por clients.list Phase 2), `quotations.by_parentQuotationId`, `subservices.by_parentSubserviceId`, `deliverableTemplates.by_subservice_contentStatus`, `emailLog.by_orgId_type`
- DROP en este task: `clientFinancialData.by_orgId_clientId_period`, `documentEvents.by_orgId_eventType`, `invoices.by_monthlyAssignmentId`, `emailLog.by_relatedId`

- [ ] **Step 3.1: Verificar 0 refs por cada índice**

Run:
```bash
echo "=== clientFinancialData.by_orgId_clientId_period ===" && grep -rn 'by_orgId_clientId_period' convex/ src/ | grep -v schema.ts | grep -v _generated
echo "=== documentEvents.by_orgId_eventType ===" && grep -rn '"by_orgId_eventType"' convex/ src/ | grep -v schema.ts | grep -v _generated
echo "=== invoices.by_monthlyAssignmentId ===" && grep -rn 'by_monthlyAssignmentId' convex/ src/ | grep -v schema.ts | grep -v _generated
echo "=== emailLog.by_relatedId ===" && grep -rn '"by_relatedId"' convex/ src/ | grep -v schema.ts | grep -v _generated
```
Expected: cada uno vacío. Si alguno tiene ref, reportar BLOCKED para ESE específico, mantenerlo, drop solo los confirmados libres.

NOTA importante para `documentEvents.by_orgId_eventType`: en schema hay también `by_orgId_eventType_createdAt` (con sufijo). Ese SÍ se usa. Solo dropear el sin sufijo.

- [ ] **Step 3.2: Drop de los 4 índices**

En `convex/schema.ts`:

1. **`clientFinancialData`**: encontrar `.index("by_orgId_clientId_period", [...])` (línea ~970) y eliminar la línea (mantener `by_orgId_clientId` y `by_orgId_status`).

2. **`documentEvents`**: encontrar `.index("by_orgId_eventType", ["orgId", "eventType"])` (NO el `_createdAt` variant) y eliminar la línea.

3. **`invoices`**: encontrar `.index("by_monthlyAssignmentId", ["monthlyAssignmentId"])` (línea ~912) y eliminar la línea.

4. **`emailLog`**: encontrar `.index("by_relatedId", ["relatedId"])` (línea ~769) y eliminar la línea.

- [ ] **Step 3.3: Codegen + tests**

Run: `npx convex codegen 2>&1 | tail -3 && npm test 2>&1 | grep "Tests" | tail -1 && npx tsc --noEmit 2>&1 | tail -3`
Expected: clean.

- [ ] **Step 3.4: Commit**

```bash
git add convex/schema.ts
git commit -m "$(cat <<'EOF'
chore(schema): drop 4 índices unused

Phase 4 §6.4. Confirmed 0 refs cada uno:
- clientFinancialData.by_orgId_clientId_period (redundante con by_orgId_clientId)
- documentEvents.by_orgId_eventType (hay _createdAt variant que sí se usa)
- invoices.by_monthlyAssignmentId
- emailLog.by_relatedId

Reservados con uso futuro documentado se mantienen
(by_firmameDocumentId, by_parentQuotationId, etc.)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Verificación final

**Files:** ninguno

- [ ] **Step 4.1: Suite completa**

Run: `npm test 2>&1 | grep "Tests" | tail -1`
Expected: `Tests 1177 passed | 1 skipped` (sin nuevos tests; este phase solo dropea código).

- [ ] **Step 4.2: TypeScript clean**

Run: `npx tsc --noEmit 2>&1 | tail -3`
Expected: 0 errors.

- [ ] **Step 4.3: Convex codegen**

Run: `npx convex codegen 2>&1 | tail -3`
Expected: clean.

- [ ] **Step 4.4: GitNexus reindex**

Run: `npx gitnexus analyze --embeddings 2>&1 | tail -3` (background OK)

- [ ] **Step 4.5: Summary del diff**

Run: `git log --oneline c536d4c..HEAD && echo "" && git diff c536d4c..HEAD --stat | tail -10`
Expected: 3 commits Phase 4 (1 table drop + 1 field drop + 1 indexes drop). Mostly deletions in schema.ts.

---

## Notas finales

- Cada task = 1 commit independiente.
- NO push (`feedback_no_push_default`).
- **Items deferidos de spec §4** (siguen siendo legitimately needed, NO dead):
  - `seasonalityDeltas` (read en applyDraftStateToProjection.ts:84-85 + replaceProjection línea 356 + frontend línea 324 como legacy draft fallback) — requiere migración propia
  - `projectionServices.subserviceId` scalar (helper effectiveSubserviceIds lo usa como fallback) — requiere backfill array
  - `organizations.assignedServiceIds` — KEEP per user decision
  - `subservices.applicableMonths/cooldownMonths/defaultPricingHint` — KEEP per user decision (cron activo)
- Phase 5 (polish: crypto.randomUUID + orgIntegrations enum tighten) sigue después.
