# Handoff — sesión siguiente (post 2026-05-22)

**Sesión origen:** 2026-05-22 (queue de 22-may completa + bugs Katimi + reseed templates + Miro Q)
**Sesión target:** próxima — terminar lista funcional de la llamada con papá + spec de escala
**Estado código:** main al día con todo de hoy mergeado
**Estado prod:** ⛔ ~88 commits ahead de `origin/main`, push bloqueado (auth GitHub)

---

## Cómo arrancar

1. **Leer este archivo.**
2. **Pre-flight (paralelo):**
   ```bash
   git status                              # solo AGENTS.md + CLAUDE.md (GitNexus auto-refresh, no urgente)
   git log --oneline -15                   # ver commits del 22-may
   npm test 2>&1 | tail -3                 # baseline: 810 passed | 1 skipped
   npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -5   # clean
   lsof -i :3000 2>&1 | head -3            # verificar Next dev
   ```
3. **Si servers no corren:**
   ```bash
   npx convex dev          # terminal 1
   npm run dev             # terminal 2 (puerto :3000)
   ```
4. **Abrir** http://localhost:3000.
5. **Verificar API key (rotation 2026-05-21):**
   ```bash
   diff <(~/.claude/bin/get-secret anthropic-api-key) <(npx convex env get ANTHROPIC_API_KEY) && echo OK || echo "MISMATCH — re-sync"
   ```

---

## Lo que se shipeó hoy 22-may (resumen)

| Commit | Qué |
|---|---|
| `c89f14e` | fix(subservice-picker): popover en React portal, no se traslapa con tabla |
| `49d92aa` | **fix(engine)**: rescale `monthlyBase = annualAmount / sum(feFactor)`. Resuelve bug Katimi "todo a mayo" (Mayo absorbía 90% del budget) |
| `c0f8b41` | fix(monthly-subservice): `setSubservice` abierto a cualquier miembro (no admin-only) |
| `df8cc01` | feat(platform-subservices): badge "X corto · Y largo" o "Sin plantillas" por subservicio |
| (data) | **66 plantillas globales nuevas** (33 short + 33 long) asignadas a subserviceId, via internal reseed. Borradas las 18 orphan deliverable templates. |

**Antes en sesión 22-may (commits 7e97703 hasta 235c00b):**
- Email notif al completar cuestionario via token público
- Sub-spec + impl: selección de subservicio por mes en la matriz
- ClickUp `86ahmwqjt`, `86ahfh6fy`, `86ahfh6g2`, `86ahk8pnx` todos cerrados
- WhatsApp/Gowa task movida a 2026-05-25
- OPS_NOTIFICATION_EMAIL → `christiancover81@gmail.com` (DEV; pendiente PROD)

**Specs nuevos del 22-may en `docs/superpowers/specs/`:**
- `2026-05-22-monthly-subservice-selection-design.md`
- `2026-05-22-engine-fefactor-rescale-design.md`
- `2026-05-22-papa-call-scale-pending-detailed-spec.md` ⬅ **STUB, requiere detalle**

---

## 🟡 Prioridad #1 próxima sesión

**Aterrizar el spec completo de la llamada con papá 22-may.**

Christian dijo: *"necesitamos varias cosas en el sistema para hacerlo mucho mejor"* + escala objetivo **2,000 contratos/mes y 2,000 entregables/mes**.

Capturado en `docs/superpowers/specs/2026-05-22-papa-call-scale-pending-detailed-spec.md`:

✅ Sí sabemos:
- Escala objetivo (2000/mes c/u, picos hasta ~200 batch)
- Arquitectura propuesta de queue + Railway worker Puppeteer + Claude Batch API
- Estimado de ~3-5 días de infra para soportarlo

❓ Falta capturar de papá:
- Tipos nuevos de documentos?
- Cambios al wizard / cuestionario?
- Reportes / analytics / KPIs?
- Integraciones nuevas (SAT / FacturAPI / DocuSign)?
- Workflow / aprobaciones multi-step?
- Branding / white-label?

**Acción:** Christian recoge la lista funcional con papá (otra call o por escrito). Cuando esté, abrimos `superpowers:brainstorming` con la lista completa y decomponemos en sub-specs.

---

## ClickUp queue restante (post 22-may)

| Due | Pri | Ticket | Notas |
|---|---|---|---|
| 25-may | high | `86ahfh6fr` WhatsApp via Gowa | Bloqueado hasta Gowa |
| 25-may | low | `86ahfh6g7` Módulo de contrato post-cotización | Probable absorbido por spec grande de papá |
| 27-may | high | `86ahjaqtq` Railway prod env + DNS + TLS | Infra deploy |
| 28-may | normal | `86ahjar1x` SSRF en `/api/generate-pdf` + headers | Security fix |
| 28-may | normal | `86ahfh6g0` Cuestionario subcampos gastos variables | Schema work |
| 29-may | low | `86ahfh6g6` Signos $ y % en proyección | UI polish |
| 30-may | high | `86agucmh4` Test E2E completo | QA |

---

## Acciones manuales pendientes (Christian, no agente)

1. **GitHub access** — push falló con 403. Necesitas auth con cuenta del org `CRA-dotcom` o que te agreguen como member.
2. **PROD Convex env:** cambiar `OPS_NOTIFICATION_EMAIL = christiancover81@gmail.com` en el dashboard de prod (cuando exista).
3. **Llamar a papá** y aterrizar la lista funcional para el spec grande pendiente.
4. **Editar las 66 plantillas placeholder** — abrir `/configuracion/plantillas`, reemplazar HTML genérico con contenido real por subservicio. Variables disponibles: `{{cliente.nombre}}`, `{{cliente.rfc}}`, `{{proyeccion.mes}}`, `{{proyeccion.año}}`, `{{ai.diagnostico}}`.
5. **Smoke E2E** del feature de selección por mes en Katimi + verificar que el bug de "todo a mayo" ya no aparece.

---

## Known limitations / followups menores

- **Banner de error del override:** muestra stack trace crudo del backend (feo). Polish menor: branch por código de error, friendly message.
- **`generate-pdf` route:** hardcodea Chrome path para Mac via `CHROMIUM_PATH` env. Para que funcione en otra Mac sin setup manual, fallback `darwin → /Applications/Google Chrome.app/...`. Quick win.
- **Wizard validation:** no valida que `sum(monthlyAmount) ≈ annualSales`. El bug de Katimi vino de esa incoherencia (operador metió ventas que sumaban al budget, no al annualSales declarado). Sub-spec menor.
- **Quotation/questionnaire templates** quedaron como orphan (sin subserviceId) por design — esos NO son per-subservicio. Si en algún momento se quiere normalizar, sub-spec aparte.
- **Plantillas placeholder** tienen HTML genérico. Aunque el match a subservicio funciona, generar entregables hoy producirá content placeholder hasta que papá/Christian escriba el HTML real.

---

## Pregunta abierta resuelta hoy: ¿Miro API para mapear el sistema?

**Respuesta: no vale la pena ahorita.** Detalle en mi respuesta de la sesión 22-may. TL;DR:
- GitNexus ya nos da el code graph (calls, processes, impact analysis)
- Para 1-2 devs, el setup + mantenimiento de Miro integration > beneficio
- Mejor alternativa: Mermaid diagrams en markdown (junto al código) + Excalidraw ad-hoc cuando hay que explicar visualmente a papá
- Si el equipo crece a 3+ devs o trabajamos con designers/legal/contables, reconsiderar

---

## Rules of engagement (recordatorios Christian)

- Cualquier tarea sustancial: brainstorming → spec → writing-plans → subagentes (no skip).
- Default: feature en branch + merge `--no-ff`. Fixes pequeños van directo a main.
- Tras cada merge: `npx gitnexus analyze`. Hoy hay ~10 commits sin refresh acumulados; lo corre el hook automático o me dices y lo corro.
- Antes de edit a un símbolo: `gitnexus_impact({ target, direction: "upstream" })` (CLAUDE.md).
- WhatsApp queda fuera hasta Gowa (lunes 25).
- Smoke E2E manual lo hace Christian (browser).

---

## Si algo se rompe

- **Tests fallan en baseline:** revisar último merge, probable Convex codegen — corre `npx convex dev` 1 min.
- **PDF generation falla:** revisar `CHROMIUM_PATH` en `.env.local` + `lsof "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`.
- **Email no llega:** verificar `orgConfigs.notificationEmail` del org en Convex dashboard. Fallback `OPS_NOTIFICATION_EMAIL` (env).
- **Override no aparece en drawer:** verificar `orgConfigs.featureFlags.manualOverrideAllowed = true` Y user es `org:admin` (aunque para `setSubservice` ya no requiere admin desde 2026-05-22).
- **Subservicio dropdown da error 403:** verificar el `setSubservice` mutation (debe usar `requireAuth`, no `requireAdmin` — fix `c0f8b41`).
- **Bug "todo a mayo" reaparece:** revisar `convex/lib/projectionEngine.ts` Step 5 — `monthlyBase = annualAmount / sumFE` debe estar. Si fue revertido, revertir el revert.
