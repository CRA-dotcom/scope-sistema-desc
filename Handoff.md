# Handoff — 22-may tasks

**Sesión origen:** 2026-05-21 (override manual + subservicios + email notif + 6 fixes)
**Sesión target:** hoy 2026-05-22 — ejecutar las 3 tareas con due 22-may
**Estado código:** main al día con todo de ayer mergeado
**Estado prod:** ⛔ 77 commits ahead de `origin/main`, sin push

---

## Cómo arrancar

1. **Leer este archivo.**
2. **Pre-flight (paralelo):**
   ```bash
   git status                              # solo AGENTS.md + CLAUDE.md (GitNexus auto-refresh, no urgente)
   git log --oneline -10                   # ver merges recientes de ayer
   npm test 2>&1 | tail -3                 # baseline: 796 passed | 1 skipped
   npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -5   # clean
   lsof -i :3000 2>&1 | head -3            # verificar Next dev
   ```
3. **Si servers no corren:**
   ```bash
   npx convex dev          # terminal 1
   npm run dev             # terminal 2 (puerto :3000 default)
   ```
4. **Abrir** http://localhost:3000.
5. **Verificar la rotación de ANTHROPIC_API_KEY:**
   ```bash
   diff <(~/.claude/bin/get-secret anthropic-api-key) <(npx convex env get ANTHROPIC_API_KEY) && echo OK || echo "MISMATCH — re-sync"
   ```
   Si MISMATCH: `npx convex env set ANTHROPIC_API_KEY "$(~/.claude/bin/get-secret anthropic-api-key)"`.

---

## Lo que se shipeó ayer (contexto, 11 commits)

| Commit | Qué |
|---|---|
| `4685594` | feat: email notif al completar cuestionario via token público (cierra `86ahmwqjt`) |
| `f17891f` | fix: remove pending status gate del override (chip legacy no se auto-actualiza) |
| `866ea99` | fix: override default a deliverable_long (era short) |
| `ca32887` | fix: empty state en /entregables cuando short/long es null |
| `f7f93a3` | fix: PDF gen `networkidle0` → DCL + `document.fonts.ready` (timeout 30s) |
| `531a615` | fix: deliverable HTML en `<iframe srcDoc sandbox="">` (CSS leak) |
| `ab205c5` | merge: subservicios visibles en matriz + drawer header |
| `40852dc` | refactor: remove chips legacy del bloque Avanzado |
| `4844a41` | merge: override manual (cierra ClickUp `86ahfh6f5`) |

**Sub-specs nuevos en `docs/superpowers/specs/`:**
- `2026-05-21-deliverable-manual-override-design.md`
- `2026-05-21-subservices-visible-in-matrix-design.md`

**ClickUp cerrados ayer:** `86ahfh6f5`, `86ahmwqjt`.

---

## Lo que falta — queue 22-may (3 tareas)

| ID | Pri | Tarea | Notas |
|---|---|---|---|
| [`86ahk8pnx`](https://app.clickup.com/t/86ahk8pnx) | **high** | Configurar recepción de mail en `businessinteligencehub.com` | Infra: DNS/MX + Resend domain verify. Acción manual (no código) + setup en Resend dashboard. ~30 min. |
| [`86ahfh6fy`](https://app.clickup.com/t/86ahfh6fy) | **high** | [Servicios] Banco de servicios específicos por área | **Sustancial.** Schema + seed + CRUD UI por subservicio. ~2-3h. Needs brainstorming antes de tocar código — alcance no claro. |
| [`86ahfh6g2`](https://app.clickup.com/t/86ahfh6g2) | normal | [Entregables] Selección de entregables dentro de proyección | **Brainstorming territory.** "Selección" = ¿multi-select de subservicios al crear proyección? ¿O override por mes? Confirmar con Christian. ~1-2h. |

### Orden recomendado

1. **`86ahk8pnx` primero** — independiente, infra externa, sin código. Puedes hacerlo en paralelo mientras revisas las otras.
2. **`86ahfh6g2`** — brainstorming corto + impl chico si scope se aclara rápido.
3. **`86ahfh6fy`** — más grande, dejar para el final del día. Probable sub-spec con writing-plans + subagentes.

---

## Decisiones pendientes para Christian

Estas necesitan input ANTES de tocar código:

1. **Servicios por área** (`86ahfh6fy`):
   - ¿Es una tabla nueva (`services_by_area`) o se reutiliza `subservices` con un campo de área?
   - ¿Las áreas son las 9 hardcodeadas (Legal, Contable, etc.) o configurables?
   - ¿UI: árbol en `/configuracion/servicios`, o flat list filtrable por área?

2. **Selección de entregables en proyección** (`86ahfh6g2`):
   - ¿Significa: al crear proyección, picker de cuáles subservicios entregables se generarán?
   - ¿O un calendar editor por mes para forzar/saltar generación?
   - ¿Bloqueante para arranque o "nice to have"?

3. **Push a origin/main:**
   - 77 commits ahead. ¿Push hoy o seguir local?
   - Si hay CI/Vercel, el push dispara deploys.

---

## Queue post-hoy (planeación)

| Due | Pri | Ticket | Bloqueante hoy |
|---|---|---|---|
| 25-may | low | `86ahfh6g7` Módulo contrato post-cotización | No, grande, sub-spec aparte |
| 25-may | high | `86ahfh6fr` WhatsApp via Gowa | No, depende Gowa |
| 27-may | high | `86ahjaqtq` Railway prod (env vars + DNS + TLS) | No, infra |
| 28-may | normal | `86ahjar1x` SSRF en `/api/generate-pdf` + headers | No, security fix |
| 28-may | normal | `86ahfh6g0` Cuestionario subcampos gastos variables | No, schema work |
| 29-may | low | `86ahfh6g6` Signos $ y % en proyección | No, UI polish |
| 30-may | high | `86agucmh4` Test E2E completo del ciclo | QA — al final |

---

## Known limitations (documentar si surgen durante smoke)

- **`assignment.status` legacy nunca se auto-actualiza.** Lo confirmamos ayer. Si surge una tarea de "estado real del ciclo", abrir sub-spec separado para sincronizar el field con questionnaire/invoice events. Hoy NO se necesita.
- **El override genera solo `deliverable_long`.** Si Christian pide alternar short/long, agregar dropdown (out-of-scope confirmado ayer).
- **El error banner del override muestra mensajes crudos del backend.** Ayer salió un stack trace feo. Polish menor pendiente: branch por código de error (401, network, etc.) → mensaje friendly.
- **`generate-pdf` route hardcodea Chrome path para Mac.** Funciona vía `CHROMIUM_PATH` en `.env.local`. Para que otro dev en otra Mac no tope este bug, agregar fallback `darwin → /Applications/Google Chrome.app/...` en el código. Quick win.

---

## Rules of engagement (Christian recordatorios)

- Para cualquier tarea sustancial: **brainstorming → spec → writing-plans → subagentes** (no skip).
- Default a commit en branch + merge con `--no-ff` cuando sea feature. Fixes pequeños van directo a main.
- Tras cada merge: `npx gitnexus analyze` para mantener el index fresco.
- Antes de cualquier edit a un símbolo: `gitnexus_impact({ target: "X", direction: "upstream" })` (per CLAUDE.md).
- Antes de commit: `gitnexus_detect_changes()` (per CLAUDE.md).
- WhatsApp queda explícitamente fuera hasta Gowa (lunes 25).
- Smoke E2E manual requiere browser → Christian lo hace, no el agente.

---

## Si algo se rompe

- **Tests fallan en baseline:** revisar último merge, probable problema de Convex codegen — corre `npx convex dev` 1 min para regenerar `api.d.ts`.
- **PDF generation falla:** revisar `CHROMIUM_PATH` en `.env.local` y `lsof "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`.
- **Email no llega al completar cuestionario:** verificar `orgConfigs.notificationEmail` del org en Convex dashboard. Si está vacío, cae al fallback `OPS_NOTIFICATION_EMAIL` (env).
- **Override manual no aparece en drawer:** verificar `orgConfigs.featureFlags.manualOverrideAllowed = true` Y que el user sea `org:admin`.
