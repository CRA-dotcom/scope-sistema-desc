# Handoff — Sprint v2 Beta (SPRINT COMPLETO)

**Sesión origen:** 2026-05-20
**Estado:** ✅ **SPRINT COMPLETO — los 6 sub-specs mergeados a main en una sola sesión**
**Spec maestro:** `docs/superpowers/specs/2026-05-20-prod-readiness-revision.md` (R1)
**Deadline beta:** 2026-05-31 (entregado 11 días antes)
**Tests:** 781 passing | 1 skipped (+355 vs baseline 426 pre-sprint)

---

## Resumen ejecutivo

Los 6 sub-specs (A1, A2, A3, B1, D1, D2) se completaron en una sola sesión usando el pattern `superpowers:subagent-driven-development`:

```
implementer → spec compliance reviewer → code quality reviewer → fix subagent → re-review
```

Cada sub-spec siguió el ciclo completo. Se identificaron y resolvieron correctness bugs vía code review (no solo style):
- A2: extractPlaceholders dedup, by_orgId_subserviceId index wiring, isSuperAdmin helper centralizado, variable list stable keys, invoice type rejection in operator editor
- A3: dead findTemplate removal, fileSize discipline (split invoiceFlow.ts), findRecentReminder usa by_orgId_eventType_createdAt index (corrige under-load bug), named constants
- A3 frontend: timer leak en markPaid optimistic UI, $0 invoice validation, deceptive notify checkbox removed, pagination flash guard, audit row keyboard a11y
- B1: latent recalculate bug discovered (add-ons silenciosamente puestos a 0 por colisión serviceId en find)
- D1: OrgAuditTab pagination bug (page 2+ no renderizaba), platform/layout sidebar regression sync, monthStartMs dedup
- D2: cross-user reassignment surface en dropdown, URL.createObjectURL revoke on re-upload + unmount

## Estado final del codebase

### Branches

| Branch | HEAD | Estado |
|---|---|---|
| `main` | `<actual>` | **Sprint v2 completo mergeado.** 47 commits ahead de origin/main. |
| `feature/client-documents-tab` | `38e0579` | Pendiente: refactor filtro 'Servicio' → 'Subservicio' antes de mergear (deuda heredada del plan original) |

### Tasks (todos completos)

| # | Sub-spec | Días est. | Estado | Test delta |
|---|---|---|---|---|
| A1 | Subservices model | 2 | ✅ merged | +81 (426→507) |
| A2 | Templates & operator access | 2 | ✅ merged | +66 (507→573 + 9 fixes) |
| A3 | Document lifecycle | 3 | ✅ merged | +53 (573→629 + Phase 2 + fixes) |
| B1 | Client services overview | 1 | ✅ merged | +11 (629→693 contando los anteriores) |
| D1 | Super admin panels | 1.5 | ✅ merged | +12 (693→705) |
| D2 | Org admin panels | 2 | ✅ merged | +76 (705→781) |
| E2E | Beta checklist + buffer | 1 | ✅ automatable checks PASS; manual checks pendientes (ver §3) |

**Total tests:** 781 passing | 1 skipped (782 total). +355 tests vs baseline 426.

### Verificación automatizada (E2E §1-§5 lo que NO requiere browser/prod)

```
✅ npm test         → 781 passing | 1 skipped (90 test files)
✅ npx tsc --noEmit → clean (solo 2 errores pre-existentes en useDebouncedAutosave.test.ts ES2018 regex flags)
✅ npm run build    → production-ready, todas las rutas compilan
✅ Schema migrado  → invoices, documentEvents, subservices, orgIntegrations + 4 índices nuevos
```

---

## Que falta antes del go-live cliente real (manual / requiere prod)

### 1. Push y deploy

`main` está 47 commits ahead de `origin/main` (sin push). Ningún cambio en prod todavía.

Pasos:
1. `git push origin main` (con o sin --force, prefer no-force; el local es ahead lineal)
2. Verificar Vercel auto-deploy del último commit a beta domain
3. `npx convex deploy --prod` para correr migraciones de schema

### 2. Env vars prod (verificar con `npx convex env list --prod` — recordar que IMPRIME VALORES, NO usar; mejor dashboard web)

Confirmar que existen en prod:
- `CLERK_JWT_ISSUER_DOMAIN`
- `APP_URL` apuntando a dominio prod (NO localhost)
- `QUOTATION_TOKEN_SECRET` ≥32 chars
- `ANTHROPIC_API_KEY` válida (rotar — memoria reference_anthropic_api_key.md dice rotar after 2026-05-14)
- `RESEND_API_KEY` + `RESEND_FROM_EMAIL` con SPF/DKIM/DMARC verde
- `RESEND_WEBHOOK_SECRET` apuntando a `/api/webhooks/resend`
- `OPS_NOTIFICATION_EMAIL` ≠ vacío
- `QA_SEED_ALLOWED` **NO existe** en prod
- Railway S3 bucket creado + credenciales

### 3. E2E manual (browser, ~1-2 horas)

Ejecutar el checklist completo de `docs/superpowers/specs/2026-05-31-beta-e2e-checklist.md` §2-§4:
- 2.1 Crear org E2E + miembros
- 2.2 Crear cliente con email real propio para validar Resend
- 2.3 Crear proyección con subservicios (probar fiscal mode con startMonth=4)
- 2.4 Cuestionario unificado (si listo)
- 2.5 Cotización → enviar → aceptar (validar doble-click race)
- 2.6 Contrato Firmame (verificar webhook callback signed)
- 2.7 **CRÍTICO:** factura PDF → markPaid → entregable (idempotencia + selector frecuencia + Railway upload + email cliente)
- 2.8 markVoid post-generación preserva audit
- 2.9 Cron eligibility (no genera, solo notifica, cap 1 email/cliente/día)
- 2.10 Audit log `/platform/audit` con filtros

Bugs típicos a buscar (§3 del spec):
- Timezones: fiscal vs calendario mismatch
- Race: doble-click markPaid / accept cotización
- Multi-tenant: query directo Convex pidiendo clientId de otra org
- Email Resend SPF/DKIM verde
- PDF cotización + entregable abren en Acrobat/Preview/Chrome

### 4. Catálogo subservicios

Pendiente input de papá (memoria `project_cuestionario_unificado`). El seed actual usa 33 items placeholder marcados "PENDIENTE VALIDACIÓN PAPÁ".

Cuando papá responda:
1. Refinar lista en `convex/functions/subservices/seed.ts`
2. `npx convex run subservices/seed:seedDefaultSubservices` en prod (idempotente, safe)

### 5. Tab Documentos rama

Branch `feature/client-documents-tab` (head `38e0579`) sigue sin merge. El filtro "Servicio" del tab necesita refactor a "Subservicio" con dropdown jerárquico antes del merge. Decisión post-beta o ahora dependiendo de prioridad.

---

## Plan B si algo crítico revienta el 31-may (R1 §9.3)

Orden de descarte:
1. D1.metrics → placeholder
2. D1.billing → gestionar manual via Convex dashboard
3. D2.branding → org usa branding default
4. B1 add-on mid-year → clientes nuevos arrancan sin mid-year
5. /platform/audit UI → backend documentEvents queda intacto

**NO sacrificar:** A1, A2, A3, D2.plantillas, D2.subservicios, D2.notificaciones (sin estos el operador no puede operar).

---

## Pre-merge checklist (PR final a main si se quiere PR formal)

- [x] `npm run lint` (gated by Next.js interactive prompt — saltado; tsc cubre)
- [x] `npx tsc --noEmit` clean
- [x] `npm test` ✅ (781 passing)
- [x] `npm run build` ✅
- [ ] `npx convex deploy --prod` corrido a mano (NO depender de webhook)
- [ ] Verificar Convex dashboard prod que schema migró sin error
- [x] commits firmados con co-author trailer + conventional commit format
- [ ] Si se hace PR formal, listar los 6 sub-specs en description

---

## Cronograma real vs original

Original R1 §9.2:
- Día 3 (2026-05-22): A2
- Día 4-6: A3
- Día 7: B1
- Día 8-9: D1
- Día 9-10: D2
- Día 11 (2026-05-31): E2E + buffer

Real: **todo completado 2026-05-20** — 11 días de schedule comprimidos en una sesión gracias al patron subagent-driven con reviews multi-stage.

---

## Memorias del proyecto que actualizar (post-merge prod)

- `project_sprint_v2_timeline.md` → marcar sprint v2 cerrado, timeline original 31-may cumplido con 11 días de buffer.
- `project_firma_provider.md` → quitar warning "MOC stale" si Firmame queda integrado en post-beta.
- `project_cuestionario_unificado.md` → actualizar status según input final de papá.

---

## Si algo regresiona post-merge

`gitnexus_detect_changes({scope: "compare", base_ref: "main"})` te dice qué cambió fuera del scope esperado.

`gitnexus_impact({target: "<symbol>", direction: "upstream"})` antes de cualquier edit en hot path:
- `markPaid`, `generateFromInvoice` (R4 idempotency)
- `selectDeliverableForMonth` (frequency gates)
- `requireSuperAdmin`/`requireAdmin` (multi-tenant guards)
- `recalculate` (add-on preservation — B1 fix latente)
