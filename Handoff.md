# Handoff — Próxima sesión (post 2026-05-23)

**Misión:** **Sacar a mercado lo más rápido posible.** El sistema es grande pero NO todas las features son MVP. Este handoff identifica el MVP, los siguientes pasos concretos, y todo lo que se difiere a post-launch.

**Sesión origen:** 2026-05-23 noche (papá list + spec stub ampliado)
**Sesión target:** próxima — empezar Sub-spec 0 (pricing foundation)
**Estado código:** main al día. ~89 commits ahead de origin/main (push bloqueado por GitHub auth).

---

## 🎯 MVP para launch (lo único que importa ahora)

Del spec stub con 7 sub-specs, **solo 3 son MVP**:

| # | Sub-spec | Por qué MVP | Estimado |
|---|---|---|---|
| **0** | Pricing model + frequency foundation (schema) | Bloquea 1, 3, 6. Necesario para que `dynamic_retainer` funcione | 2-3 días |
| **1** | Catálogo de entregables por subservicio | Sin contenido real, las generaciones salen placeholder | 2 días code + N días papá llena |
| **2** | Contratos por empresa emisora + Firmame | Sin esto no cerramos ventas | 4-5 días |

**Total MVP: ~8-10 días de impl + contenido papá en paralelo.**

### Lo que se DIFIERE a post-launch

| # | Sub-spec | Por qué difer | Workaround pre-launch |
|---|---|---|---|
| 3 | Per-service start month | No bloquea | Operador no activa ese servicio en meses fuera de scope |
| 4 | Financial statements ingestion | Técnico pesado | Entregables que requieren finanzas → papá los carga manual / sample |
| 5 | Invoice issue date vs payment date | Conveniencia contable | Operador anota offline mientras tanto |
| 6 | Year-over-year update tier | Año 2 todavía no llega | — |
| 7 | Queue + scale infra | Volumen actual << 2000/mes | — |

---

## Cómo arrancar próxima sesión

1. **Leer este archivo** (estás aquí).
2. **Pre-flight (paralelo):**
   ```bash
   git status                              # solo AGENTS.md + CLAUDE.md aceptable
   git log --oneline -15                   # últimos commits del 22-23 may
   npm test 2>&1 | tail -3                 # baseline: 810 passed | 1 skipped
   npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -5   # clean
   lsof -i :3000 2>&1 | head -3            # next dev
   ```
3. **Si servers no corren:**
   ```bash
   npx convex dev          # terminal 1
   npm run dev             # terminal 2 (puerto :3000)
   ```
4. **Verificar API key (rotada 2026-05-21):**
   ```bash
   diff <(~/.claude/bin/get-secret anthropic-api-key) <(npx convex env get ANTHROPIC_API_KEY) && echo OK || echo "MISMATCH — re-sync"
   ```
5. **Decir:** `vamos con Sub-spec 0` → invoco brainstorming con el stub spec como contexto.

---

## Status del catálogo de plantillas (post 2026-05-23)

- **33 plantillas globales** (1 `deliverable_long` por subservicio activo). Borradas las 33 short el 2026-05-23.
- **Todas con HTML placeholder** marcado claramente. Papá necesita reemplazar con contenido real.
- **Estructura visible:** `/configuracion/plantillas` (tree Servicio → Subservicio → Plantilla) y `/platform/subservicios` (badge "1 largo" en cada subservicio).
- **Variables disponibles en cada plantilla:** `{{cliente.nombre}}`, `{{cliente.rfc}}`, `{{proyeccion.mes}}`, `{{proyeccion.año}}`, `{{ai.diagnostico}}`. Sub-spec 1 extenderá según necesidad de cada subservicio.

---

## Stack arquitectónico actual (estable)

| Capa | Tech | Notas relevantes |
|---|---|---|
| Frontend | Next.js 15 + React 19 + Tailwind + shadcn | Vercel deploy |
| Backend | Convex | DB + queries + mutations + actions + scheduler + crons |
| Auth | Clerk Organizations | JWT con orgId + orgRole. `org:admin` / `org:member` |
| Email | Resend | FROM `noreply@businessinteligencehub.com` |
| AI | Claude API | `claude-sonnet-4-20250514`, retry 3x, cost tracking |
| Blob storage | Railway S3 | PDFs, facturas; metadata en Convex |
| PDF gen | Puppeteer-core en Vercel | Pre-MVP: caso local Mac usa `CHROMIUM_PATH=/Applications/Google Chrome.app/...`. Post-MVP: worker dedicado en Railway. |
| Firma | Firmame (pendiente integración) | Sub-spec 2 |

Diagrama completo en `docs/system-architecture.md` (6 Mermaid diagrams).

---

## Specs y plans relevantes

- **Stub maestro:** `docs/superpowers/specs/2026-05-22-papa-call-scale-pending-detailed-spec.md` — los 7 sub-specs decomposed.
- **System overview:** `docs/system-architecture.md` — diagramas Mermaid renderizables en VS Code/GitHub.
- **Specs mergeados recientes (referencia):**
  - `2026-05-22-engine-fefactor-rescale-design.md` (fix Katimi)
  - `2026-05-22-monthly-subservice-selection-design.md`
  - `2026-05-21-subservices-visible-in-matrix-design.md`
  - `2026-05-21-deliverable-manual-override-design.md`

---

## ClickUp queue restante (real, post-22-may)

| Due | Pri | Ticket | Status / nota |
|---|---|---|---|
| 25-may | high | `86ahfh6fr` WhatsApp via Gowa | Pendiente Gowa |
| 25-may | low | `86ahfh6g7` Módulo de contrato post-cotización | **Absorbido por Sub-spec 2** |
| 27-may | high | `86ahjaqtq` Railway prod (env vars + DNS + TLS) | Infra deploy, separate de Sub-spec 7 |
| 28-may | normal | `86ahjar1x` SSRF en `/api/generate-pdf` + headers | Security fix |
| 28-may | normal | `86ahfh6g0` Cuestionario subcampos gastos variables | **Probable absorbido por Sub-spec 4** |
| 29-may | low | `86ahfh6g6` Signos $ y % en proyección | UI polish |
| 30-may | high | `86agucmh4` Test E2E completo | QA, post-MVP |

---

## Action items manuales (Christian, no agente)

1. **GitHub access** — push falló con 403 (`christiancover26` sin write access a `CRA-dotcom/projex`). Resolver auth para poder push antes de launch.
2. **PROD Convex env:** cuando deployes, cambiar `OPS_NOTIFICATION_EMAIL = christiancover81@gmail.com` en dashboard de prod.
3. **Papá llena las 33 plantillas placeholder** — en paralelo con impl. Sin esto, MVP no se ve real al cliente.
4. **Captar el último detalle pendiente** (TBD de la call con papá): year-over-year tier (Sub-spec 6 lo resolverá), formato exacto de Excel financiero (Sub-spec 4), endpoints Firmame (Sub-spec 2).

---

## Known limitations / followups menores

- **Banner de error del override** muestra stack trace crudo del backend. Polish menor: branch por código de error, friendly message.
- **`generate-pdf` route** hardcodea Chrome path para Mac via `CHROMIUM_PATH`. Para que funcione en otra Mac sin setup manual, fallback `darwin → /Applications/...`. Quick win.
- **Wizard validation:** no valida que `sum(monthlyAmount) ≈ annualSales`. El bug Katimi vino de esa incoherencia. Sub-spec menor.
- **Quotation/questionnaire templates** quedaron como orphan (sin subserviceId) por design — son union per servicio padre, no per-subservicio.
- **Plantillas placeholder** = 33 long. Generar entregables hoy produce content placeholder hasta que papá escriba HTML real.

---

## Rules of engagement (recordatorios)

- Cualquier tarea sustancial: brainstorming → spec → writing-plans → subagentes (no skip).
- Default: feature en branch + merge `--no-ff`. Fixes pequeños van directo a main.
- Tras cada merge: `npx gitnexus analyze`. Hoy hay ~3 commits doc-only sin refresh acumulados.
- Antes de edit a un símbolo: `gitnexus_impact({ target, direction: "upstream" })`.
- Smoke E2E manual lo hace Christian (browser).
- WhatsApp queda fuera hasta Gowa (lunes 25).

---

## Si algo se rompe

- **Tests fallan en baseline:** revisar último merge, probable Convex codegen — corre `npx convex dev` 1 min.
- **PDF generation falla:** `CHROMIUM_PATH` en `.env.local` + chequear que Google Chrome existe.
- **Email no llega:** `orgConfigs.notificationEmail` del org en Convex dashboard. Fallback `OPS_NOTIFICATION_EMAIL` (env).
- **Override no aparece en drawer:** `orgConfigs.featureFlags.manualOverrideAllowed = true` Y user es `org:admin`.
- **Subservicio dropdown 403:** verificar que `setSubservice` usa `requireAuth` no `requireAdmin` (fix `c0f8b41` del 22-may).
- **Bug "todo a mayo" reaparece:** `convex/lib/projectionEngine.ts` Step 5 — `monthlyBase = annualAmount / sumFE` (fix `49d92aa` del 22-may).

---

## Lo que NO está en este handoff

- Detalle de cada sub-spec (eso vive en `docs/superpowers/specs/2026-05-22-papa-call-scale-pending-detailed-spec.md` § 3).
- Costos estimados detallados (Claude API + Railway + Resend a volumen). Pendiente cuando lleguemos a Sub-spec 7.
- Decisiones de marketing / pricing al cliente final / sales motion. Eso es Christian + papá business side, fuera del scope técnico.
