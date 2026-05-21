# Handoff — Debugging Session (Sprint v2 post-merge)

**Sesión origen:** 2026-05-20 noche
**Sesión target:** próxima sesión, debugging visual de las páginas nuevas
**Estado código:** Sprint v2 beta ✅ completo, 6 sub-specs mergeados a main
**Estado prod:** ⛔ NO pusheado todavía (54 commits ahead de origin/main)

---

## Cómo arrancar

1. **Leer este archivo** (estás aquí).
2. **Pre-flight**:
   ```bash
   git status                              # working tree limpio o solo Handoff.md
   git log --oneline -5                    # main con 54 commits del sprint
   npm test 2>&1 | tail -3                 # baseline: 781 passed | 1 skipped
   npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -5   # clean
   lsof -i :3002 2>&1 | head -3            # verificar si Next sigue corriendo
   ```
3. **Si los servers ya no corren**:
   ```bash
   npx convex dev          # terminal 1, espera "Convex functions ready"
   npm run dev             # terminal 2, NextJS turbopack, levanta en :3000 o :3002 si ocupado
   ```
4. **Abrir** `http://localhost:3002` (o el puerto que tomó Next).

---

## Cambios visuales recientes (desde sprint merge)

| Cambio | Archivo | Estado |
|---|---|---|
| QA Service borrado del DB | `convex/functions/quotations/qaCleanup.ts` (already-run) | ✅ ejecutado, 18 filas |
| Subservicios seed corrido | `convex/functions/subservices/seed.ts` | ✅ 33 globales creados |
| Templates seed corrido | `convex/functions/deliverableTemplates/seedDefaults.ts` | ✅ 1 plantilla global |
| Drawer matrix-cell redesigned | `src/components/projections/matrix-cell-detail.tsx` | 🆕 **no committed todavía** |
| `/facturacion` acepta `?year=&month=` deep-link | `src/app/(dashboard)/facturacion/page.tsx` | 🆕 **no committed todavía** |

**Pending commits** (working tree dirty):
```bash
git diff --stat HEAD
# src/app/(dashboard)/facturacion/page.tsx     | ~6 lines
# src/components/projections/matrix-cell-detail.tsx | full rewrite (~330 LOC)
```

Decisión: ¿commitearlos antes de seguir debug? El user dijo redesign quedó listo, conviene commit para tener checkpoint estable.

---

## Lo que el user dijo el 20-may noche

1. **"Quita lo de QA Service"** → ✅ Hecho.
2. **"Estos botones no me dicen absolutamente nada"** (status Pendiente/Info/Progreso/Entregado + Sin Facturar/Facturado/Pagado en el drawer):
   - Eran chips legacy de `monthlyAssignments.invoiceStatus` que NO disparan generación.
   - Redesign hecho: stepper visual + CTA contextual + manual override colapsado bajo "Avanzado" con warning.
3. **"No veo dónde se suben las facturas"** → flow correcto es `/facturacion` (A3 Phase 2). Drawer ahora tiene CTA primaria que linkea ahí con deep-link.
4. **"Carga todo lo nuevo"** → seeds corridos (subservicios 33, templates 1).

---

## URLs a probar visualmente

Sign-in con cualquier user del org `org_3Bc04Ld76zZeepkBpOLRSK9XLOg` (Org1, plan enterprise). Clientes existentes: Katimi, ACME SA CV.

| Ruta | Validar |
|---|---|
| `/configuracion` | Hub 9 cards en 5 secciones (Catálogo/Equipo/Comunicación/Identidad/Proveedores) |
| `/configuracion/subservicios` | Lista 33 subservicios globales agrupados por servicio padre |
| `/configuracion/plantillas` | Árbol Servicio→Subservicio→Plantilla |
| `/configuracion/usuarios` | Memberships Clerk + drawer + invitar |
| `/configuracion/branding` | Editor org-admin con preview |
| `/configuracion/integraciones` | Resend / Firmame / Railway chips |
| `/configuracion/notificaciones` | Form + test send |
| `/configuracion/frecuencias` | Read-only redirect |
| `/facturacion` | Columna PDF + modal upload + markPaid + admin void |
| `/facturacion?year=2026&month=5` | Deep-link debe pre-seleccionar Mayo 2026 |
| `/clientes/[id]` | Panel "Servicios contratados" (B1) + modal "Agregar subservicio mid-year" |
| `/cotizaciones/[id]` | Si tiene `parentQuotationId`, banner suplementaria |
| `/proyecciones/[id]` | Matrix cell click → drawer nuevo con stepper + CTA |
| `/platform/metrics` | KPIs + LineChart 30d + tabla per-org (super-admin) |
| `/platform/billing` | Tabla billing + plan filter + totals |
| `/platform/audit` | Filtros org/cliente/entidad/severidad + paginación |
| `/platform/subservices` | CRUD globales con clones modal |
| `/platform/orgs/[id]?tab=metrics` | 4 tabs Detalles/Métricas/Billing/Audit |

---

## Cosas que pueden romper visualmente

1. **Drawer nuevo MatrixCellDetail**:
   - No probado en browser end-to-end (solo TSC + unit tests).
   - Verificar que `deliverable === undefined` (loading) no rompa el stepper.
   - Verificar que el deep-link funcione (`?year=&month=`).
   - Verificar que el override avanzado todavía funcione (mutations updateStatus / updateInvoiceStatus).
2. **Subservicios vacíos por org**:
   - Los 33 son globales (`orgId: undefined`). Las orgs no tienen clones aún.
   - `/configuracion/subservicios` debería mostrarlos como "Globales" / readonly.
3. **Plantillas vacías por org**:
   - Solo 1 plantilla global. Si abres `/configuracion/plantillas` puede verse muy vacío.
4. **Sidebar super-admin**:
   - `/platform/layout.tsx` y `src/components/layout/sidebar.tsx` ambos tienen el group de 7 entries — verificar que no se dupliquen.
5. **`/facturacion` deep-link**:
   - Solo lee `searchParams` en mount inicial. Si el user cambia el dropdown, el URL NO se sincroniza (acceptable — el deep-link es one-way del drawer).

---

## Sub-features que NO se probaron en código aunque tests pasan

- **Upload PDF real**: el modal `UploadInvoiceDialog` lee file como ArrayBuffer y llama `invoices.upload` action. Probar con un PDF de 100-500KB real.
- **markPaid → generateFromInvoice**: requiere `ANTHROPIC_API_KEY` válida en `.env.local` para que Claude llene placeholders. Si key inválida → log error pero NO crash.
- **Cron eligibility**: solo testeable forzándolo via Convex dashboard (`Run scheduled function`). Probar que NO genera, solo notifica.
- **Firmame**: stub. `testFirmameConnection` retorna `{ok: false, reason: "Backlog post-beta..."}`.
- **Resend test send**: si no hay `RESEND_API_KEY` en env, retorna `{sent: false, reason}` graceful.
- **Invite-user Clerk**: requiere `CLERK_SECRET_KEY` en `.env.local`. Si no, 500.

---

## Datos en DB (dev deployment)

```
organizations: 2 (Org1 active enterprise, otra legacy)
clients: 5 (Katimi, ACME SA CV, Empresa test, etc.)
services: 9 globales (los padre originales)
subservices: 33 globales (recién seedados)
deliverableTemplates: 5 (4 originales + 1 nueva seed)
projections: varias por cliente
projectionServices: varias por proyección
monthlyAssignments: ~12/projection/year
deliverables: cero por ahora (no invoice flow corrido aún)
invoices: cero
documentEvents: algunos eventos de seed/configuración
```

`org_qa_screenshot` y `Cliente QA` ya NO existen (purgados).

---

## Si encuentras un bug

1. Reproducirlo en browser, capturar consola DevTools.
2. Verificar si es regresión: `git diff HEAD~1 -- <archivo>` (último commit antes del trabajo del 20-may).
3. Bug de tipos/runtime: `npx tsc --noEmit` + ver el archivo afectado.
4. Bug de query: `npx convex logs --dev` para ver errores backend.
5. Bug de schema: `npx convex codegen` por si quedó stale.
6. Para bugs visuales: pegar screenshot + ruta exacta del browser donde ocurrió.

---

## Próximos pasos (cuando termine el debug)

1. Commitear el redesign del drawer si quedó bien: `feat(projections): rediseñar drawer matrix cell con stepper + CTAs`.
2. Push a origin/main (`git push origin main`).
3. `npx convex deploy --prod` con env vars verificadas.
4. E2E manual checklist completo de `docs/superpowers/specs/2026-05-31-beta-e2e-checklist.md` §2.
5. Catálogo subservicios validado con papá → re-correr `subservices/seed:seedDefaultSubservices` en prod (idempotente).
6. Branch `feature/client-documents-tab` (38e0579) → refactor filtro Servicio→Subservicio antes de merge.

---

## Features nuevas a diseñar/implementar (post-debug)

### F1 — Fechas de generación por servicio en proyección

**Problema:** Hoy la proyección agenda entregables/cotizaciones a granularidad **mes** (`selectDeliverableForMonth` evalúa por mes calendario). No se puede decir "este servicio genera entregable el día 5 de cada mes" — solo "este mes sí, este mes no".

**Requerimiento del operador:** Definir el **día exacto del mes** en que cada servicio dispara su deliverable/cotización dentro de la vigencia de la proyección. Permite agendas tipo:
- Plan Anual Marketing → genera entregable el día 1 de cada mes
- Cotización inicial → se manda el día 15 del primer mes de proyección
- EE.FF. Mensuales → día 10 del mes siguiente al cierre

**Esbozo de scope:**
- **Schema:** `projectionServices.generationDayOfMonth` opcional `v.number()` (1–28 para evitar problemas con febrero; meses cortos clampean al último día).
  - Opcional: separar `quotationDayOfMonth` vs `deliverableDayOfMonth` si el caso lo amerita; default mismo día si solo se setea uno.
- **Selector A3:** `selectDeliverableForMonth` ya filtra por mes; añadir gate de día. Si hoy < día y mes coincide → todavía no toca; si hoy ≥ día → elegible.
- **Cron eligibility (A3 §3.4):** revisa día en TZ local de la org (no UTC) — reusar `getLocalToday` helper. Sat/Sun skip sigue aplicando.
- **UI wizard `/proyecciones/nueva`:** control de fecha por cada servicio agregado. Si no se setea, default = "cualquier día del mes" (comportamiento actual).
- **UI panel "Servicios contratados" (B1) en `/clientes/[id]`:** mostrar "Próximo: día N de mes M" en cada row, no solo "mes M".
- **Tests:** day clamp (día 31 en feb → 28/29), TZ-local edge cases, override per cliente diferido a junio (mantener consistente con R1 §5.2).

**Dependencias:** A3 selector ya respeta `applicableMonths` + `startMonth/endMonth` (B1). Day gate es una extensión natural en el mismo lugar (después de `applicableMonths`, antes de frequency).

### F2 — Empresa emitente por servicio en proyección

**Problema:** Hoy `issuingCompanies` (tabla pre-existente) existe a nivel org — el operador puede tener N empresas que él emite. Pero NO está linkeado a servicios específicos en proyecciones. Toda la facturación/cotización/contrato sale con la empresa default del org.

**Requerimiento del operador:** Asignar con qué empresa emitente se factura cada servicio durante toda la vigencia de la proyección. Permite casos tipo:
- Cliente Acme tiene 3 servicios; Legal sale de "Despacho Legal SC", Marketing de "Marketing Studio SA de CV", Contable de la principal.
- La proyección preserva ese mapping todo el año.
- Si el cliente firma nuevo contrato anual, el operador puede mantener o cambiar la empresa por servicio.

**Esbozo de scope:**
- **Schema:** `projectionServices.issuingCompanyId` opcional `v.id("issuingCompanies")`. Backward-compat: rows sin valor → usa default del org (comportamiento actual).
- **Mutation:** `projections.create` y `recalculate` aceptan `issuingCompanyId` por servicio; `addSubserviceMidYear` también (B1).
- **Selector PDF:** `generateFromInvoice` y `quotations.generate` y `contracts.send` leen el `issuingCompanyId` del `projectionService`. PDF header usa **branding + RFC + dirección + footer** de esa empresa, NO del org default.
- **Invoice flow A3:** `invoices.upload` debe prellenar `issuingCompanyId` desde el projectionService asociado (operador puede override en el modal si necesario).
- **UI wizard `/proyecciones/nueva`:** dropdown de empresa emitente por cada servicio en el step de configuración. Default = primera empresa del org.
- **UI panel "Servicios contratados" (B1):** mostrar badge "Emitido por: {empresa}" en cada row.
- **UI `/configuracion/empresas-emitentes`:** ya existe (no se toca). Solo se consume.
- **Multi-tenant:** verificar que `issuingCompanyId` referencia siempre del mismo org (`requireSameOrg` guard en mutations).
- **Tests:** mapping per-service preserved across recalculate, multi-tenant cross-org rejected, PDF render con branding correcto.

**Dependencias:** A2 (snapshot por valor en deliverables — debería extenderse para snapshotear `issuingCompanyName` + `rfc` + `branding` también, para que un PDF generado en marzo siga reproducible si la empresa cambia en agosto). Reusa la pattern de `templateVersion`/`templateHtmlSnapshot`.

**Decisión pendiente:** ¿qué pasa cuando una `issuingCompany` se borra y hay projectionServices referenciándola? Mirror A1 pattern (`subservices.remove` bloquea si hay refs).

---

### Cronograma estimado

| Feature | Días est. | Bloqueante |
|---|---|---|
| F1 fechas generación | 1.5 (schema + selector + cron + UI + tests) | No bloquea beta del 31-may; junio fit |
| F2 empresa emitente per service | 2 (schema + mutations + UI + PDF render + snapshot extension) | Útil pre-beta si papá tiene multi-entity (caso QWave) |

**Sugerencia priorización:** F2 primero si papá factura desde 2+ empresas. F1 después porque hoy "fin del mes" + gate humano via markPaid ya da control suficiente al operador para 90% de los casos.

---

## Memorias / contexto

- `project_sprint_v2_timeline` — sprint v2 cerrado, 11 días buffer.
- `project_firma_provider` — Firmame.com (NO MiFiel).
- `project_blob_storage` — Railway S3 para PDFs.
- `reference_anthropic_api_key` — Keychain account `christian`, rotar after 2026-05-14.

---

## Comandos útiles durante debug

```bash
# Logs convex
npx convex logs --dev | tail -30

# Inspect tabla específica
npx convex data invoices
npx convex data deliverables

# Re-correr seed (idempotente)
npx convex run functions/subservices/seed:seedDefaultSubservices

# Limpiar bucket Railway (si experimentos dejan blobs huérfanos)
# Manual — no hay script CLI todavía (R8 R1 §10)

# Ver estado git en dev
git log --oneline -10
git diff --stat HEAD

# GitNexus refresh si el índice se queda stale
npx gitnexus analyze
```

---

**No improvises lógica de negocio.** Si te atoras en algo ambiguo, los specs son fuente de verdad:
- `docs/superpowers/specs/2026-05-20-prod-readiness-revision.md` — R1 maestro
- `docs/superpowers/specs/2026-05-2{1,2,3,6,7,8}-*.md` — los 6 sub-specs (A1, A2, A3, B1, D1, D2)
- `docs/superpowers/specs/2026-05-31-beta-e2e-checklist.md` — E2E
