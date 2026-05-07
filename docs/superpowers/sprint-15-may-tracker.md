# Sprint 15-May Tracker

**Sprint goal:** Producción con clientes reales de Desk (~50) el 2026-05-15.
**Spec:** `docs/superpowers/specs/2026-05-06-prod-readiness-bugfixes-design.md`
**Started:** 2026-05-06
**Calendar:**
- Fase A (días 1-2): bug fixes — **DONE locally** (branch `fix/fase-a-bugs-criticos`, 7 commits, 172/172 tests, awaiting merge)
- Fase B (días 3-5): acumulado UI + estacionalidad delta%
- Fase C (días 6-8): mes inicio + prorrateo fiscal
- Fase D (días 9-13): cuestionario unificado + 5 templates AI
- Demo intermedia: 2026-05-13
- Buffer/QA: 2026-05-14
- **Producción: 2026-05-15**

## Estado por item

| # | Categoría | Item | Esfuerzo | Owner | Status | Notas |
|---|---|---|---|---|---|---|
| 1 | Fase A — merge | Aplicar `/tmp/fase-a-bugs-criticos.patch` + push + abrir PR | XS | Christian | ⏳ Pendiente | Patch generado, push falló por permisos |
| 2 | Fase A — merge | Smoke E2E manual del wizard antes de mergear | S | Christian | ⏳ Pendiente | — |
| 3 | Fase A — post-merge | Correr `qaCleanup` con `dryRun:true` en prod, validar matches | XS | Christian | ⏳ Pendiente | — |
| 4 | Fase A — post-merge | Si dry-run sale bien, correr con `dryRun:false` | XS | Christian | ⏳ Pendiente | — |
| 5 | Fase A — post-merge | `git rm convex/functions/quotations/qaCleanup.ts` | XS | Christian | ⏳ Pendiente | — |
| 6 | Fase B | B1 — Widget acumulado wizard + lib/projection-allocation.ts | M | Code | 🔜 Próximo | Ejecución autónoma |
| 7 | Fase B | B2 — Estacionalidad delta% (schema + UI + engine path) | L | Code | 🔜 Próximo | Ejecución autónoma |
| 8 | Fase C | C1 — Schema startMonth/projectionMode/monthCount/effectiveBudget/previousProjectionId | S | Code | 🔜 Próximo | Foundational, va primero en Fase C |
| 9 | Fase C | C2 — UI wizard "Periodo de la proyección" rolling vs fiscal | M | Code | 🔜 Próximo | Depende de C1 |
| 10 | Fase C | C3 — Engine refactor (effectiveBudget + monthCount con defaults) | M | Code | 🔜 Próximo | Depende de C1 |
| 11 | Fase C | C4 — Matriz detalle dinámica (N columnas + badge fiscal) | M | Code | 🔜 Próximo | Depende de C1, C3 |
| 12 | Fase C | C5 — Cron evento corte y revaluación | S | Code | 🔜 Próximo | Independiente |
| 13 | Fase C | C6 — PDFs leen monthCount/startMonth | S | Code | 🔜 Próximo | Depende de C3 |
| 14 | Fase D | D1 — Schema cuestionario file_upload + templateVariableMappings | S | Code | 🔜 Próximo | Foundational Fase D |
| 15 | Fase D | D2 — Componente FileUploadField | M | Code | 🔜 Próximo | Depende de D1 |
| 16 | Fase D | D3 — YAML preguntas canónicas (30-50 preguntas, 6 áreas, mappings) | L | **Papá** | 🔴 Atrasado 16 días | Bloquea calidad de templates AI; seed temporal mientras |
| 17 | Fase D | D4 — Mutation populateTemplateVariables con file URLs firmadas | M | Code | 🔜 Próximo | Depende de D1 |
| 18 | Fase D | D5 — 5 templates react-pdf (Admin, RH, TI, Marketing, Legal) | L | Code | 🔜 Próximo | Paralelizable: 5 archivos independientes |
| 19 | Fase D | D6 — Variables AI con prompts contextuales + smoke test | M | Code | 🔜 Próximo | Requiere ANTHROPIC_API_KEY para validación final |
| 20 | Pre-prod blocker | `ANTHROPIC_API_KEY` agregada a `.env.local` y Vercel | XS | Christian | 🔴 Bloqueante | Sin esto Fase D no se puede testear E2E |
| 21 | Pre-prod blocker | Reactivar crons en `convex/crons.ts` al deploy del 15-may | XS | Code | ⏳ Pendiente | Último paso pre-prod |
| 22 | Pre-prod blocker | `CLERK_JWT_ISSUER_DOMAIN` hardcoded — limpiar antes de prod | XS | Code | ⏳ Pendiente | Polish |
| 23 | Decisión producto | Confirmar `commissionMode = proportional` deprecate o coexiste | — | Christian | 💭 Pendiente | No bloqueante |
| 24 | Decisión producto | Validar reframe UX (commit fa6e8cd) elimina confusión 31.2M | XS | Christian | ⏳ Pendiente | Demo 13-may |
| 25 | Hito | **Demo intermedia 2026-05-13** — A+B+C funcionando | — | Christian | 🎯 Objetivo | — |
| 26 | Hito | **Buffer/QA 2026-05-14** — bug-fixes post-demo, deploy stage | — | Christian | 🎯 Objetivo | — |
| 27 | Hito | **Producción 2026-05-15** — deploy a clientes reales | — | Christian | 🎯 Objetivo | — |
| 28 | Backlog post-15-may | Pestaña /clientes/[id]/documentos uploads sueltos + versiones | M | Code | 📋 Backlog | — |
| 29 | Backlog post-15-may | Sweep auth-gate useQuery a ~30 pages restantes | M | Code | 📋 Backlog | — |
| 30 | Backlog post-15-may | Templates adicionales por área | L | Code | 📋 Backlog | Depende de demanda real |
| 31 | Backlog post-15-may | Migrar campos legacy a required | S | Code | 📋 Backlog | — |
| 32 | Backlog post-15-may | Cleanup seasonalityData legacy | S | Code | 📋 Backlog | — |
| 33 | Backlog post-15-may | Propagar isCommission a ServiceAllocation en engine | XS | Code | 📋 Backlog | — |
| 34 | Backlog post-15-may | Subir coverage S9-09 (multi-tenant, AI retry, PDF branding) | M | Code | 📋 Backlog | — |
| 35 | Backlog post-15-may | Playwright/Cypress para E2E real del wizard | M | Code | 📋 Backlog | — |
| 36 | Backlog post-15-may | Cross-link audit-budget-paths.md desde spec/plan | XS | Code | 📋 Backlog | — |
| 37 | Backlog post-15-may | Reactivar Sprint 10 polish si post-launch lo amerita | M | Code | 📋 Backlog | — |

## Leyenda

**Esfuerzo:** XS=<1h · S=2-4h · M=½-1d · L=1-3d
**Status:** ⏳ Pendiente · 🔜 Próximo · 🔴 Bloqueante · 💭 Decisión · 🎯 Hito · 📋 Backlog · ✅ Done

## Branches

- `main` — base
- `fix/fase-a-bugs-criticos` — local, 7 commits, awaiting Christian's merge
- `feat/fase-b-...` — TBD
- `feat/fase-c-...` — TBD
- `feat/fase-d-...` — TBD

## Plans

- ✅ Fase A — `docs/superpowers/plans/2026-05-06-fase-a-bugs-criticos.md`
- ⏳ Fase B — TBD
- ⏳ Fase C — TBD
- ⏳ Fase D — TBD
