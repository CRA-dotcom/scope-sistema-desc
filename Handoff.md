# Handoff — Próxima sesión (post 2026-05-27 EOD)

**Misión:** Sacar a mercado lo más rápido posible. SS0, SS1, SS2-foundation, SS3, SS5, SS6 cerrados en `main`. SS4 spec+plan ready, ejecución diferida. **Adversarial review entregó 14 findings — 3 críticos requieren fix antes de demo.**

**Sesión origen:** 2026-05-26 → 2026-05-27 (SS2 brainstorm + ejecución parcial + SS5 + SS3 + SS6 full cycle + SS4 spec/plan + adversarial review)
**Estado código:** `main` **63 commits** ahead de `origin/main`. Tests **951 passed | 1 skipped**. TypeScript clean (excepto pre-existing `useDebouncedAutosave` ortogonal). Sin push (per `feedback_no_push_default`).

---

## 🚨 ADVERSARIAL REVIEW — 14 FINDINGS

Ejecutado al cierre del turno. Revisor adversarial con persona "Codex hizo todo, malhumorado". Pidió ver SS3 + SS5 + SS6 (range `76140d8..HEAD`).

### CRÍTICO — fix antes de cualquier demo

**F1. `setAnnualAmount` (SS6 mutation) rompe dynamic_retainer**
`convex/functions/projectionServices/mutations.ts:90-104`
- Patcha `annualAmount` directo, NO toca `monthlyAssignments`.
- Para `dynamic_retainer` (cells `isManuallyOverridden=true`): suma mensual deja de cuadrar con `annualAmount`.
- Botón "Aplicar año 2+" en `/proyecciones/[id]` dispara esto.
- **Fix:** o llamar recalc, o avisar al admin si hay overrides activos, o deshabilitar el botón en presencia de overrides.

**F2. `setYearOverYearDiscount` lee antes de auth check**
`convex/functions/subservices/mutations.ts:382-414`
- `db.get(subserviceId)` precede a `requireAdmin`/`requireSuperAdmin`. Hoy no leak directo, patrón incorrecto si helpers cambian.
- **Fix:** auth first, read second.

**F3. `discount=0` ≠ `discount=undefined` — bug semántico SS6**
`convex/functions/subservices/queries.ts:138`
- `getYearOverYearHint` filtra `discount===0` como "no available".
- Admin escribe "0" en config → guarda 0 → hint dice "no configurado" silenciosamente.
- **Fix:** distinguir 0 (explícito, sin descuento) de undefined (sin configurar) en hint logic + UI.

### IMPORTANTE — fix antes de prod

**F4. `getYearOverYearHint` escán completo de projections del org por celda**
`convex/functions/subservices/queries.ts:143-150`
- `.withIndex("by_orgId").collect()` + filter en memoria por clientId.
- Llamado dentro de `useQuery` por cada `projectionService` activo.
- O(N_proyecciones × N_servicios) por render.
- **Fix:** usar `by_clientId` index o agregar `by_orgId_clientId` index.

**F5. CFDI parser solo matchea doble comillas**
`convex/lib/cfdiParser.ts:5`
- `FECHA_REGEX = /\bFecha\s*=\s*"([^"]+)"/`
- PACs que serializan con single quotes (Facturama) fallan → "missing Fecha".
- **Fix:** regex que acepte ambos.

**F6. CFDI date treatment como UTC — bug fiscal 🔥**
`convex/lib/cfdiParser.ts:33-37`
- Comment dice "treat as UTC for consistent storage"; SAT `Fecha` es hora LOCAL México.
- Factura emitida 31-ene 23:30 CDMX → guardada como 1-feb UTC → pierde el mes fiscal correcto.
- **Validar con contador antes de cualquier filtro fiscal mensual.**
- **Fix:** parsear como CDMX (-06:00 / -05:00 DST) o guardar string original sin parsing, depende de cómo se use downstream.

**F7. Engine SS3: división por FE patológicamente bajo**
`convex/lib/projectionEngine.ts:447-463`
- Si ventana = 1 mes con FE muy chico (ej 0.001), `monthlyBase = annualAmount/0.001 = 1000×`.
- Guard `sumFE > 0` no lo atrapa.
- **Fix:** clamp mínimo de sumFE o fallback a distribución uniforme.

**F8. `updateContractualWindow` no recalcula — UI miente 🔥**
`convex/functions/projectionServices/mutations.ts:121-163`
- Cambiar window [1..12] → [7..12] persiste field pero `monthlyAssignments` quedan intactos.
- Matrix muestra `—` en meses 1-6 PERO los amounts reales siguen >0.
- Total anual visible diverge del total mensual.
- **Fix:** mutation debe llamar recalc engine + patch monthly assignments.

**F9. UI window picker default-mixing**
`src/app/(dashboard)/proyecciones/[id]/page.tsx:365-417`
- Logic `newStart = val === projection.startMonth && svc.endMonth === undefined ? undefined : val` mezcla "default proyección" con "ventana servicio".
- Si projection.startMonth=7, admin escogiendo "julio" se interpreta como "clear override" pero pudo ser explícito.
- **Fix:** botón "Reset" explícito o lógica más clara.

### MEDIO

**F10.** Migration `invoiceIssueDate.migrate` no atómica entre invocaciones (idempotente sí, eficiente no). Aceptable.

**F11.** CFDI parser: tests no cubren XML con declaración namespace en root sin prefijo.

**F12.** `listForBilling` ya hace full scan por org (pre-existente); nuevo filtro empeora pero no introduce regresión.

### MENOR

**F13.** Test "one_time startMonth=undefined" pasa por casualidad (comportamiento legacy), no certifica nada nuevo.

**F14.** `<YearOverYearChip>` componente correcto vs rules-of-hooks; crea N+1 `useQuery` (N = servicios activos). Aceptable hasta 30+ servicios; revisar con volumen real.

---

## 🎯 Lo que se cerró este turno

### Sub-spec 2 — Contratos + Firmame (foundation merged)

Merge `76140d8` previo a este turno. Branch `feature/sub-spec-2-contracts-firmame` preservada. 16/26 tasks done. T11-T18 GATED en Firmame API docs.

### Sub-spec 5 — Invoice issue date ✅

11 commits TDD. Schema + CFDI parser + migración + mutation + query + UI. **⚠ F6 bug fiscal pendiente.**

### Sub-spec 3 — Per-service start month + endMonth window ✅

5 commits + 2 docs. Hallazgo: `startMonth`+`endMonth` ya existían en schema (B1 add-on). Engine, mutation, UI window picker + matrix dash. **⚠ F8 critical: mutation no recalc.**

### Sub-spec 6 — Year-over-year update tier ✅

5 commits + 2 docs. Schema + mutation + query + UI config + matrix chip. Decisión autopilot: % fijo per subservicio, admin opt-in. **⚠ F1 + F3 críticos pendientes.**

### Sub-spec 4 — Financial statements ingestion 📋 (spec + plan only)

`docs/superpowers/specs/2026-05-27-financial-statements-ingestion-design.md` + `docs/superpowers/plans/2026-05-27-financial-statements-ingestion.md`.
- V1 Excel only (PDF/OCR diferido V2)
- AI extraction con Claude
- ~14 tareas, 5-7 días
- Ejecución diferida a próxima sesión por scope

### Test count progression

| Punto | Tests |
|---|---|
| Inicio turno (post SS2 merge) | 905 |
| Post-SS5 | 927 |
| Post-SS3 | 941 |
| Post-SS6 | 951 |
| **Final session** | **951 passed / 1 skipped** |

(+78 tests, ningún test broken)

---

## 🗺️ MVP Roadmap status

| Sub-spec | Status |
|---|---|
| 0 — Pricing foundation | ✅ main |
| 1 — Deliverable content catalog | ✅ main + hardened |
| 2 — Contratos + Firmame | ⚙️ Foundation main. T11-T18 GATED |
| 3 — Per-service start month | ✅ main (⚠ F7 + F8 + F9) |
| 4 — Financial statements ingestion | 📋 Spec + plan ready, exec diferida |
| 5 — Invoice issue date | ✅ main (⚠ F5 + F6) |
| 6 — Year-over-year tier | ✅ main (⚠ F1 + F2 + F3 + F4) |
| 7 — Queue + scale infra | Post-MVP |

---

## 🔴 Research items pendientes

### #1 — Contratos HTML iniciales (papá)
Min 1 contrato HTML para DESC org + 1 issuing company + 1-2 subservicios. Bloquea producción SS2, no código.

### #2 — Firmame API docs + sandbox key
Bloquea SS2 T11-T18 (8 tareas, ~3-4 días). Modelo: managed-BYO (memoria `project_firmame_account_model`).

### #3 — Validar timezone CFDI con contador (F6)
Antes de cualquier filtro fiscal mensual en producción, confirmar con contador si `issueDate` debe ser local CDMX o UTC. F6 puede llevarse facturas al mes anterior/siguiente.

---

## Cómo arrancar próxima sesión

```bash
cd /Users/christiandarrelcoverlozano/Desktop/Projects/DESC
git status                              # working tree clean
git log --oneline -10                   # ver últimos commits
npm test 2>&1 | tail -3                 # baseline 951
npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -5  # clean
```

### Opción A — Atacar findings críticos del adversarial review

1. **F1** (`setAnnualAmount` rompe dynamic_retainer)
2. **F3** (`discount=0` semántico)
3. **F8** (`updateContractualWindow` no recalcula → UI miente)
4. **F6** (CFDI timezone — validar primero con contador)

Estimado: 0.5-1 día. Recomendado ANTES de cualquier demo a papá.

### Opción B — Ejecutar SS4 (financial statements V1)

Plan listo en `docs/superpowers/plans/2026-05-27-financial-statements-ingestion.md`. 14 tareas, 5-7 días. Independiente de las correcciones del adversarial review.

### Opción C — Continuar SS2 si tienes Firmame docs

Branch `feature/sub-spec-2-contracts-firmame` preservada. T11-T18 desbloqueados con docs.

---

## Action items manuales (Christian)

1. **Decidir prioridad findings adversarial** — fix antes de demo vs aceptar deuda
2. **Conseguir Firmame API docs + sandbox key** — SS2 final
3. **Crear contratos HTML iniciales** para DESC
4. **Validar timezone CFDI con contador** (F6)
5. **Decidir push a origin/main** (63 commits ahead)
6. **Smoke browser** flows nuevos (`/contratos`, `/facturacion`, `/proyecciones/[id]`, `/clientes/[id]/finanzas` solo schema)

---

## Specs + Plans nuevos este turno

| Path | Status |
|---|---|
| `docs/superpowers/specs/2026-05-26-sub-spec-2-contracts-firmame-design.md` | SS2 — spec (foundation merged) |
| `docs/superpowers/plans/2026-05-27-sub-spec-2-contracts-firmame.md` | SS2 — plan (T11-T18 gated) |
| `docs/superpowers/specs/2026-05-27-invoice-issue-date-design.md` | SS5 — spec ✅ |
| `docs/superpowers/plans/2026-05-27-invoice-issue-date.md` | SS5 — plan ✅ |
| `docs/superpowers/specs/2026-05-27-per-service-start-month-design.md` | SS3 — spec ✅ |
| `docs/superpowers/plans/2026-05-27-per-service-start-month.md` | SS3 — plan ✅ |
| `docs/superpowers/specs/2026-05-27-year-over-year-tier-design.md` | SS6 — spec ✅ |
| `docs/superpowers/plans/2026-05-27-year-over-year-tier.md` | SS6 — plan ✅ |
| `docs/superpowers/specs/2026-05-27-financial-statements-ingestion-design.md` | SS4 — spec (exec deferred) |
| `docs/superpowers/plans/2026-05-27-financial-statements-ingestion.md` | SS4 — plan (exec deferred) |

---

## Memorias actualizadas

- `feedback_design_full_dump` — full dump en design phases (creado este turno)
- `project_firmame_account_model` — managed-BYO (creado este turno)

---

## Rules of engagement (sin cambios)

- Brainstorming → spec → writing-plans → subagent-driven (workflow validado en 5 sub-specs ya)
- Feature branch + merge `--no-ff` para tareas grandes; main directo para tareas pequeñas (SS3/SS5/SS6 fueron main directo este turno)
- Tras cada merge: `npx gitnexus analyze --embeddings`
- `gitnexus_impact` antes de editar símbolos
- Smoke E2E manual hace Christian (browser)
- Push branch requiere OK explícito (memoria `feedback_no_push_default`)
- Full dump en design phases sin pausar por sección (memoria `feedback_design_full_dump`)

---

## Stack arquitectónico

| Capa | Tech | Notas |
|---|---|---|
| Frontend | Next.js 15 + React 19 + Tailwind + shadcn | Deploy Railway |
| Backend | Convex | 19+ tablas; nuevos campos SS3 + SS5 + SS6 este turno |
| Auth | Clerk Organizations | Test mode dev |
| Email | Resend | FROM `noreply@businessinteligencehub.com` |
| AI | Claude API | `claude-sonnet-4-20250514` |
| Blob storage | Railway S3 | PDFs/facturas; metadata en Convex |
| PDF gen | Puppeteer-core en Vercel | post-MVP: worker Railway |
| Firma | Firmame (skeleton listo, integración pendiente docs) | branch + plan listos |
| CFDI parsing | `convex/lib/cfdiParser.ts` (regex-based, ⚠ F5+F6 issues) | SS5 |
| Excel parsing | `xlsx` (planeado SS4, no instalado todavía) | SS4 |
