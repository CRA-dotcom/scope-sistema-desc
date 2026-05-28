# Sub-spec 7 — Projection & Questionnaire Resilience

**Fecha:** 2026-05-28
**Estado:** Spec aprobado, pendiente plan
**Bloque del documento del papá (28-may-2026):** B — primer bloque atacado

## Objetivo

Eliminar data loss en el flow de proyección y permitir recuperación de cuestionario marcado como completado por error. Habilitar re-edit de proyección desde el inicio (hoy sólo existe edit manual de celdas).

## Puntos del papá cubiertos

| # | Punto | Cómo se cubre |
|---|---|---|
| **#16** | "marcar como completado sin que estuviera completado y ya no me deja deshacer" | Feature 1 — Questionnaire reopen |
| **#8** | "que siempre se quede donde la dejaste + aviso de pendiente + se me borró todo lo avanzado" | Feature 2 — Save defense + draft notification |
| **#4** | "poder entrar de nuevo a la proyección para editarla desde el inicio" | Feature 3 — Re-edit from start |

## Out of scope (próximos sub-specs)

- #1, #9, #19, #20 — catálogo servicios/subservicios → bloque C
- #2, #10, #11, #12, #13, #14, #18 — UI polish proyección → bloque A
- #15, #17 — distribución inteligente + redondeo → bloque D
- #21 — cuestionarios v2 (secciones, edit cerrado, imprimir) → bloque E
- #5, #6, #22, #23, #24, #25 — pipeline Cot→Contrato→Entregable→Factura → bloque F
- #26 primera mitad — multi-plataforma → v2 (rompe Clerk Orgs)
- #26 segunda mitad — matriz documentos cliente → bloque G

## Estructura de entrega

3 features verticales independientes, cada una merge a `main` directo cuando sus tests pasen:

1. **Feature 1 — Questionnaire Reopen** (~3-4 commits, sesión corta)
2. **Feature 2 — Projection Save Defense + Draft Notification** (~6-8 commits, sesión media)
3. **Feature 3 — Projection Re-edit From Start** (~4-5 commits, sesión media)

Pueden trabajarse en orden o paralelo. Recomendación: empezar con F1 (más crítico — data loss real reportado por usuario).

---

## Feature 1 — Questionnaire Reopen

### Estado actual

- Tabla `questionnaireResponses` (schema:282) con `status: "draft" | "sent" | "in_progress" | "completed"`.
- `submitQuestionnaire` mutation marca `completed` sin validar respuestas llenas (mutations.ts:189-206).
- Mutations de edit rechazan writes cuando `status === "completed"` (mutations.ts:149-150, 199-200).
- **No existe mutation ni UI para downgrade desde `completed`.**

### Cambios

#### Schema (`convex/schema.ts`)

```ts
// questionnaireResponses — agregar:
reopenedAt: v.optional(v.number()),
reopenedBy: v.optional(v.string()),   // Clerk userId, mismo tipo que otros campos *By

// documentEvents.eventType — agregar literal:
v.literal("reopened"),
```

`questionnaireResponses` ya soporta cross-org isolation via `orgId`. No hay índices nuevos requeridos.

#### Mutation nueva (`convex/functions/questionnaires/mutations.ts`)

```ts
export const reopenQuestionnaire = mutation({
  args: { questionnaireId: v.id("questionnaireResponses") },
  handler: async (ctx, { questionnaireId }) => {
    const { user } = await requireUserAndOrg(ctx);
    const q = await ctx.db.get(questionnaireId);
    if (!q || q.orgId !== user.orgId) throw new Error("Cuestionario no encontrado");
    if (q.status !== "completed") throw new Error("Solo cuestionarios completados se pueden reabrir");

    await ctx.db.patch(questionnaireId, {
      status: "in_progress",
      completedAt: undefined,
      reopenedAt: Date.now(),
      reopenedBy: user.userId,
    });

    await ctx.db.insert("documentEvents", {
      orgId: user.orgId,
      clientId: q.clientId,
      entityType: "questionnaire",
      entityId: questionnaireId,
      eventType: "reopened",
      severity: "info",
      actorUserId: user.userId,
      actorType: "user",
      message: `Cuestionario reabierto por ${user.userId}`,
      createdAt: Date.now(),
    });
  },
});
```

#### UI (`src/app/(dashboard)/cuestionarios/[id]/page.tsx`)

Agregar botón "Reabrir cuestionario" visible sólo cuando `status === "completed"`:

```tsx
{q.status === "completed" && (
  <Button variant="outline" onClick={() => setReopenOpen(true)}>
    Reabrir cuestionario
  </Button>
)}
<ConfirmDialog
  open={reopenOpen}
  title="¿Reabrir cuestionario?"
  body="El cuestionario volverá a 'in progress' y podrá editarse de nuevo. La fecha de completado se borrará. Quedará registrado en el log."
  confirmLabel="Sí, reabrir"
  onConfirm={async () => {
    await reopen({ questionnaireId: q._id });
    toast.success("Cuestionario reabierto");
    setReopenOpen(false);
  }}
/>
```

`ConfirmDialog` ya existe en el design system del repo (usado en delete operations).

### Tests (`convex/functions/questionnaires/mutations.test.ts`)

1. `reopenQuestionnaire` con cuestionario `completed` → status pasa a `in_progress`, `completedAt` undefined, `reopenedAt` set, evento "reopened" insertado en `documentEvents`.
2. `reopenQuestionnaire` con cuestionario en otro status (draft/sent/in_progress) → throws.
3. `reopenQuestionnaire` cross-org (mismo questionnaireId pero distinto orgId del caller) → throws.

### Risk
- **Bajo.** Cambio aditivo. La transición `completed → in_progress` ya estaba implícita en el state machine (las mutations re-aceptarán writes naturalmente).

---

## Feature 2 — Projection Save Defense + Draft Notification

### Estado actual

- Wizard en `src/app/(dashboard)/proyecciones/nueva/page.tsx`.
- Save explícito en step transitions (`saveDraft()` líneas 292-341).
- **Fire-and-forget:** catch silencia errors en console (líneas 321-324). Usuario no se entera de fallos.
- Hidratación al re-abrir: prompt "Continuar borrador / Empezar de nuevo" (líneas 428-449).
- **No hay descubrimiento global de drafts** — sólo aparece si entras a `/proyecciones/nueva` con clientId que coincida.
- Hook `useDebouncedAutosave` (`src/hooks/useDebouncedAutosave.ts`) usado sólo en `/q/[token]` para cuestionario público.
- **Bug pre-existing:** status del hook nunca regresa de "saved" a "idle". Saves consecutivos confunden la UI.

### Cambios

#### Fix del hook (`src/hooks/useDebouncedAutosave.ts`)

Después de transicionar a `"saved"`, programar `setTimeout` para resetear a `"idle"` después de 3000ms. Cancelar timeout en cleanup y al recibir nuevo input.

```ts
// Pseudocódigo del fix:
useEffect(() => {
  if (status === "saved") {
    const t = setTimeout(() => setStatus("idle"), 3000);
    return () => clearTimeout(t);
  }
}, [status]);
```

Tests del hook expandirse para cubrir el reset.

#### Hook nuevo: `useProjectionDraftSave` (`src/hooks/useProjectionDraftSave.ts`)

Encapsula la lógica de save del wizard reusando `useDebouncedAutosave`:

```ts
export function useProjectionDraftSave(state: ProjectionDraftState) {
  const saveMutation = useMutation(api.projectionDrafts.upsertDraft);
  const [retry, setRetry] = useState(0);

  const save = useCallback(async (value: ProjectionDraftState) => {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await saveMutation({ state: value });
        setRetry(0);
        return;
      } catch (e) {
        lastError = e;
        setRetry(attempt + 1);
        await sleep(2 ** attempt * 1000); // 1s, 2s, 4s
      }
    }
    throw lastError;
  }, [saveMutation]);

  const { status, lastSavedAt } = useDebouncedAutosave(state, save, 1500);
  return { status, retry, lastSavedAt };
}
```

#### Componente nuevo: `DraftSaveStatus` (`src/components/projections/DraftSaveStatus.tsx`)

Chip inline en el header del wizard:

| Status | Render |
|---|---|
| `idle` | (vacío) |
| `saving` | spinner + "Guardando..." |
| `saved` | check verde + "Guardado hace Xs" (auto-fade vía hook reset) |
| `error` (retry < 3) | badge amarillo + "Reintentando ({retry}/3)..." |
| `error` (retry === 3) | badge rojo + "❌ No se pudo guardar. Revisa tu conexión." |

#### Wizard: cambio en `page.tsx`

Reemplazar `saveDraft()` fire-and-forget por `useProjectionDraftSave(formState)`. Renderizar `<DraftSaveStatus />` en el header del wizard.

Step transitions ya no llaman `saveDraft()` — el hook se encarga vía debounce. Antes de avanzar, esperar a que `status !== "saving"` y `status !== "error"` (o mostrar warning si error).

#### Query nueva: `listMyActiveDrafts` (`convex/functions/projectionDrafts/queries.ts`)

```ts
export const listMyActiveDrafts = query({
  handler: async (ctx) => {
    const { user } = await requireUserAndOrg(ctx);
    const drafts = await ctx.db
      .query("projectionDrafts")
      .withIndex("by_orgId_userId_clientId", q =>
        q.eq("orgId", user.orgId).eq("userId", user.userId)
      )
      .collect();
    return Promise.all(drafts.map(async d => {
      const client = d.clientId ? await ctx.db.get(d.clientId) : null;
      return {
        _id: d._id,
        clientId: d.clientId,
        clientName: client?.name ?? null,
        year: d.state.year,
        step: d.state.step,
        updatedAt: d.updatedAt,
        previousProjectionId: d.state.previousProjectionId ?? null,
      };
    }));
  },
});
```

Reusa el índice compuesto existente `by_orgId_userId_clientId` con prefix match sobre `(orgId, userId)`.

#### Componente nuevo: `DraftPendingBanner` (`src/components/drafts/DraftPendingBanner.tsx`)

- Se monta en `src/app/(dashboard)/page.tsx` (dashboard home).
- Muestra hasta 3 drafts más recientes.
- Cada item: "Continuar borrador de **{clientName}** ({year}) — paso {step}/4 · iniciado hace {timeAgo}".
- Click → `router.push(\`/proyecciones/nueva?draftId={d._id}\`)`.
- Si lista vacía, no renderea nada.

#### Componente nuevo: `DraftNavbarChip` (`src/components/layout/DraftNavbarChip.tsx`)

- Chip permanente en navbar con badge count.
- Click → dropdown popover con la misma lista del banner.
- Reutiliza `listMyActiveDrafts`.

#### Hidratación por draftId

`/proyecciones/nueva` debe aceptar `?draftId=X` para hidratar un draft específico (no sólo el que coincide con clientId). Modificar el lookup actual.

### Tests

**Hook `useDebouncedAutosave` (`src/hooks/__tests__/useDebouncedAutosave.test.ts`):**
1. Status pasa idle → saving → saved → idle (after 3s).
2. Nuevo input mientras `saving` no rompe la state machine.

**Hook `useProjectionDraftSave` (`src/hooks/__tests__/useProjectionDraftSave.test.ts`):**
3. Save exitoso al primer intento → retry queda en 0.
4. Save falla 2 veces, exitoso al 3er intento → retry visible 1, 2, vuelve a 0.
5. Save falla las 3 veces → throws + retry queda en 3 (UI muestra error rojo).

**Query `listMyActiveDrafts` (`convex/functions/projectionDrafts/queries.test.ts`):**
6. Retorna sólo drafts del user actual en el org actual.
7. Incluye `clientName` correctamente cuando `clientId` está set.

**Componentes:**
- Smoke render para `DraftPendingBanner` (0 drafts → null; N drafts → lista).
- Smoke render para `DraftNavbarChip`.

### Risk
- **Medio.** Cambia el save model del wizard. `/q/[token]` (único consumer del hook fix) puede verse afectado — tests del hook + smoke E2E manual de cuestionario público.

---

## Feature 3 — Projection Re-edit From Start

### Estado actual

- `/proyecciones/[id]` permite edición manual celda por celda vía `MatrixCellDetail` y mutations `setMonthSubservice`, `updateContractualWindow`, `setAnnualAmount`.
- **No existe path para reabrir el wizard.**
- `projectionDrafts.state.previousProjectionId` ya existe en schema (línea 145) — campo subutilizado, perfecto para reusar.

### Cambios

#### Helper nuevo: `getProjectionDownstreamCounts` (`convex/lib/projectionDownstream.ts`)

`quotations`/`contracts`/`deliverables` NO tienen `projectionId` directo — referencian vía `projServiceId`. Helper itera correctamente:

```ts
export async function getProjectionDownstreamCounts(ctx, projectionId: Id<"projections">) {
  const projServices = await ctx.db
    .query("projectionServices")
    .withIndex("by_projectionId", q => q.eq("projectionId", projectionId))
    .collect();
  const projServiceIds = projServices.map(ps => ps._id);

  const [assignments, invoices] = await Promise.all([
    ctx.db.query("monthlyAssignments").withIndex("by_projectionId", q => q.eq("projectionId", projectionId)).collect(),
    ctx.db.query("invoices").withIndex("by_projectionId", q => q.eq("projectionId", projectionId)).collect(),
  ]);

  // Para quotations/contracts/deliverables, no hay índice by_projectionId.
  // Iteramos por projServiceId. Si la performance importa, agregar índice
  // by_projServiceId existe en cada tabla downstream (verify-during-plan).
  let quotations = 0, contracts = 0, deliverables = 0;
  for (const psid of projServiceIds) {
    quotations += (await ctx.db.query("quotations").withIndex("by_projServiceId", q => q.eq("projServiceId", psid)).collect()).length;
    contracts += (await ctx.db.query("contracts").withIndex("by_projServiceId", q => q.eq("projServiceId", psid)).collect()).length;
    deliverables += (await ctx.db.query("deliverables").withIndex("by_projServiceId", q => q.eq("projServiceId", psid)).collect()).length;
  }

  return { quotations, contracts, invoices: invoices.length, deliverables, assignments: assignments.length, projServices: projServices.length };
}
```

**Verify-during-plan:** confirmar que existen índices `by_projServiceId` en `quotations`/`contracts`/`deliverables`. Si no, agregarlos al schema como parte de F3.

#### Query: `getProjectionDownstreamSummary`

Wrapper público sobre el helper para que la UI muestre el modal de warning con counts.

#### Mutation nueva: `cloneProjectionToDraft` (`convex/functions/projections/mutations.ts`)

```ts
export const cloneProjectionToDraft = mutation({
  args: { projectionId: v.id("projections") },
  handler: async (ctx, { projectionId }) => {
    const { user } = await requireUserAndOrg(ctx);
    const proj = await ctx.db.get(projectionId);
    if (!proj || proj.orgId !== user.orgId) throw new Error("Proyección no encontrada");

    // Reconstruir state del wizard desde la projection
    const projServices = await ctx.db.query("projectionServices")
      .withIndex("by_projectionId", q => q.eq("projectionId", projectionId)).collect();
    const serviceStates = projServices.map(ps => ({
      serviceId: ps.serviceId,
      chosenPct: ps.chosenPct,
      isActive: ps.isActive,
    }));

    const draftId = await ctx.db.insert("projectionDrafts", {
      orgId: user.orgId,
      userId: user.userId,
      clientId: proj.clientId,
      state: {
        step: 0,  // arranca desde el inicio
        year: proj.year,
        annualSales: proj.annualSales,
        totalBudget: proj.totalBudget,
        commissionRate: proj.commissionRate,
        startMonth: proj.startMonth,
        projectionMode: proj.projectionMode,
        useSeasonality: proj.useSeasonality,
        seasonalityOutliers: proj.seasonalityOutliers,
        serviceStates,
        previousProjectionId: projectionId,  // ← marca de re-edit (reusa campo existente)
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return draftId;
  },
});
```

#### Mutation nueva: `replaceProjection` (`convex/functions/projections/mutations.ts`)

Atómica. Llamada internamente desde `commitDraft` cuando `previousProjectionId` está set:

```ts
export const replaceProjection = internalMutation({
  args: { projectionId: v.id("projections"), newState: v.any() },
  handler: async (ctx, { projectionId, newState }) => {
    // Orden de borrado respetando dependencias:
    // invoices → deliverables → contracts → quotations → monthlyAssignments → projectionServices
    // (luego patch projection)

    // Recolectar IDs de projectionServices (para cascada quotations/contracts/deliverables)
    const projServices = await ctx.db.query("projectionServices")
      .withIndex("by_projectionId", q => q.eq("projectionId", projectionId)).collect();
    const psIds = projServices.map(ps => ps._id);

    // 1. Snapshot para audit log (antes de borrar)
    const counts = await getProjectionDownstreamCounts(ctx, projectionId);

    // 2. Borrar invoices (by_projectionId)
    const invoices = await ctx.db.query("invoices").withIndex("by_projectionId",
      q => q.eq("projectionId", projectionId)).collect();
    for (const inv of invoices) await ctx.db.delete(inv._id);

    // 3. Borrar deliverables, contracts, quotations (by_projServiceId iterando psIds)
    for (const psid of psIds) {
      for (const d of await ctx.db.query("deliverables").withIndex("by_projServiceId", q => q.eq("projServiceId", psid)).collect()) {
        await ctx.db.delete(d._id);
      }
      for (const c of await ctx.db.query("contracts").withIndex("by_projServiceId", q => q.eq("projServiceId", psid)).collect()) {
        await ctx.db.delete(c._id);
      }
      for (const q of await ctx.db.query("quotations").withIndex("by_projServiceId", q => q.eq("projServiceId", psid)).collect()) {
        await ctx.db.delete(q._id);
      }
    }

    // 4. Borrar monthlyAssignments (by_projectionId)
    const assignments = await ctx.db.query("monthlyAssignments")
      .withIndex("by_projectionId", q => q.eq("projectionId", projectionId)).collect();
    for (const a of assignments) await ctx.db.delete(a._id);

    // 5. Borrar projectionServices
    for (const ps of projServices) await ctx.db.delete(ps._id);

    // 6. Patch projection con nuevo state (rerun del engine)
    // **Verify-during-plan:** la lógica de "draft → projection + projectionServices + monthlyAssignments"
    // hoy vive dentro de `commitDraft`. Para reusarla aquí sin duplicar, extraer a un helper
    // `applyDraftStateToProjection(ctx, projectionId, newState)` que sea llamado tanto por
    // `commitDraft` (nuevo path) como por `replaceProjection` (re-edit path).
    await applyDraftStateToProjection(ctx, projectionId, newState);

    // 7. Log evento
    await ctx.db.insert("documentEvents", {
      orgId: (await ctx.db.get(projectionId))!.orgId,
      entityType: "deliverable", // (no hay "projection" entityType — verify-during-plan si agregar)
      entityId: projectionId,
      eventType: "updated",
      severity: "warning",
      actorType: "user",
      message: `Proyección re-editada. Downstream borrado: ${JSON.stringify(counts)}`,
      metadata: counts,
      createdAt: Date.now(),
    });
  },
});
```

**Verify-during-plan:** `entityType` no tiene `"projection"` literal. Decisión: (a) agregar al enum, (b) reusar `"deliverable"` como hoy (no ideal), o (c) crear evento bajo `"contract"` o el entityType más afectado. Recomiendo (a).

#### Modificar `commitDraft` (mutation existente)

Detectar `state.previousProjectionId` y bifurcar:
- Set → llamar `replaceProjection(previousProjectionId, state)` en lugar de crear nueva.
- Unset → comportamiento actual (crear projection nueva).

#### UI (`src/app/(dashboard)/proyecciones/[id]/page.tsx`)

Botón "Editar desde el inicio" en header de la proyección. Click flow:
1. Llama `getProjectionDownstreamSummary` (query).
2. Abre modal warning:
   ```
   ⚠️ Re-editar borrará:
   • 3 cotizaciones
   • 1 contrato
   • 12 facturas
   • 4 entregables
   • 36 asignaciones mensuales

   Esta acción no se puede deshacer. ¿Continuar?
   [Cancelar]  [Sí, re-editar]
   ```
3. Si confirma: llama `cloneProjectionToDraft` → recibe `draftId` → `router.push(\`/proyecciones/nueva?draftId={draftId}\`)`.
4. En el wizard, si `draft.state.previousProjectionId` está set, mostrar banner persistente arriba:
   > "Re-editando proyección de {clientName} ({year}). Los cambios sobreescribirán la versión actual y borrarán los documentos downstream."

### Tests

1. `getProjectionDownstreamCounts` con projection que tiene N de cada → counts correctos.
2. `cloneProjectionToDraft` → crea draft con `previousProjectionId` set, `step: 0`, state hidratado correctamente.
3. `cloneProjectionToDraft` cross-org → throws.
4. `replaceProjection` → borra todo el downstream, regenera projectionServices + assignments, log evento con metadata.
5. `commitDraft` con `previousProjectionId` set → llama `replaceProjection`. Sin set → crea nueva.

### Risk
- **Alto.** Cascada de borrados destructiva. Mitigación:
  - Modal de confirmación con counts visibles.
  - Log evento "updated" con metadata `counts` para auditoría (incluso si se necesita reconstruir manualmente).
  - Tests específicos de roundtrip: projection → clone → re-commit → mismo state semánticamente.
  - Botón "Editar desde el inicio" sólo visible a roles admin/super-admin (verify-during-plan).

---

## Architecture overview

```
┌─────────────────────────────────────────────────────────────────┐
│ FEATURE 1 — Questionnaire Reopen                                │
│   Schema:    +reopenedAt, +reopenedBy, eventType "reopened"     │
│   Mutation:  reopenQuestionnaire                                │
│   UI:        button on /cuestionarios/[id]                      │
├─────────────────────────────────────────────────────────────────┤
│ FEATURE 2 — Projection Save Defense + Draft Notification        │
│   Hook fix:  useDebouncedAutosave (idle reset after 3s)         │
│   Hook new:  useProjectionDraftSave (retry 3x backoff + status) │
│   Query:     listMyActiveDrafts                                 │
│   UI:        DraftSaveStatus (wizard header)                    │
│              DraftPendingBanner (dashboard home)                │
│              DraftNavbarChip (global navbar)                    │
│   Wizard:    accept ?draftId=X for explicit hydration           │
├─────────────────────────────────────────────────────────────────┤
│ FEATURE 3 — Re-edit From Start                                  │
│   Lib:       projectionDownstream.getCounts                     │
│   Query:     getProjectionDownstreamSummary                     │
│   Mutations: cloneProjectionToDraft, replaceProjection (internal)│
│              commitDraft modified to branch on previousProj…    │
│   UI:        button + warning modal in /proyecciones/[id]       │
│              banner in /proyecciones/nueva when re-editing      │
└─────────────────────────────────────────────────────────────────┘
```

## Error handling philosophy

- **Cross-org access:** todas las mutations validan `orgId`. Errores genéricos para no leak existence.
- **Status invariants:** reopen sólo en `completed`. `replaceProjection` sólo si el caller del wrapper (`commitDraft`) confirmó el flow.
- **Save failures:** visible status + retry exponencial + no silently swallow.
- **Atomic operations:** `replaceProjection` corre dentro de una sola Convex mutation (atomicidad garantizada por el runtime).

## Testing strategy

- Test count meta: **1017 → ~1031+** (mínimo 14 nuevos: 3 + 6 + 5).
- TDD para mutations (red → green).
- UI components: smoke render (no E2E aquí — Christian valida en browser).
- Adversarial pass post-implementation siguiendo el patrón de SS1-SS6.

## Schema diff resumido

```diff
questionnaireResponses:
+ reopenedAt: v.optional(v.number())
+ reopenedBy: v.optional(v.string())

documentEvents.eventType:
+ "reopened"

documentEvents.entityType (verify-during-plan):
? "projection"   // si agregamos, o reusamos "deliverable"

projectionDrafts.state.previousProjectionId:
  (ya existe — reusamos para marcar re-edits)

(verify-during-plan: índices by_projServiceId en quotations/contracts/deliverables)
```

## Risk assessment

| Risk | Mitigation |
|---|---|
| `replaceProjection` borra datos productivos por error de usuario | Modal de confirmación con counts visibles; log con metadata para forense; sólo roles elevados |
| `useDebouncedAutosave` fix rompe `/q/[token]` (único consumer hoy) | Tests del hook ampliados; smoke browser de cuestionario público |
| Hidratación del draft desde projection clonada falla | Test de roundtrip explícito (Feature 3 test #2 cubre) |
| Usuario abre mismo draft en 2 tabs | Convex es source of truth, last-write-wins. Aceptado YAGNI. |
| Performance de `getDownstreamCounts` con muchas projectionServices | Aceptable para N típico (< 50 services). Si crece, optimizar con índice compuesto. |
| Indices `by_projServiceId` no existen en alguna tabla downstream | Verify-during-plan; agregar si falta |
| Field names en `projection` no coinciden 1:1 con `draft.state` (ej. `commissionRate` vs `commissionPercentage`) | Verify-during-plan: hidratación de `cloneProjectionToDraft` debe mapear contra el schema real, no contra los nombres asumidos en este spec |

## Memorias y referencias

- `project_doc_lifecycle_pipeline` — orden cotización → contrato → factura → entregable (relevante para `replaceProjection` cascada)
- `feedback_no_push_default` — no push durante beta
- `feedback_design_full_dump` — usado en este brainstorming
- Handoff 2026-05-27 — SS4 V1 cerrado, baseline 1017 tests, 70 commits ahead de origin/main

## Próximo paso

Una vez aprobado este spec por Christian: invocar `superpowers:writing-plans` para generar el plan de implementación detallado con tareas TDD enumeradas.
