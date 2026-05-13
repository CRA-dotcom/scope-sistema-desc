# Proyecciones — Sub-proyecto A (bugs críticos) — Design

**Date:** 2026-05-12
**Sprint:** v2 (toward 2026-05-15 demo, friday)
**Owner:** Christian
**Status:** Approved (pending user spec review)

---

## Context

After a call between Christian and his partner on 2026-05-12, three bugs and a copy-clarity gap were identified in the projections wizard while testing with Catimi (60M annual sales, 10M contract, May–Dec 2026, 8 months). The first real client (tu tío Joche) starts on 2026-05-15 (3 days from spec date), so these bugs block the demo and the start of production service.

Today's pain points observed in the call:
- A 10M contract for 8 months shows "$6.66M efectivo" instead of "$10M distribuido en 8 meses" → `$1.25M/mes`.
- A projection created via the wizard does not appear in `/proyecciones` afterwards, even after refresh.
- Leaving the wizard mid-flow (e.g. to edit the client) loses all progress.
- Several Step 1/Step 2 fields confused the partner (who designed the system), implying they will confuse the operators using it.

Source of truth for the user reports: the 2026-05-12 partner call transcript (paraphrased in this repo's conversation, not stored in code).

## Goals

1. Fix the proration semantics so `totalBudget = contracted amount distributed across `monthCount` months`, in both rolling and fiscal modes (Bug 1).
2. Surface and root-cause the missing-from-list bug, with defensive guardrails so no submit ever "disappears" silently again (Bug 2).
3. Persist wizard progress server-side so operators can leave and resume the wizard without losing data (Bug 3).
4. Tighten the wizard's Step 1 and Step 2 microcopy so operators understand each field without external explanation.

## Non-Goals

- Sub-proyecto **B** (service-percentages-on-sales semantic change, market-range indicator, slider/columns rework, "tasa de comisión" deeper handling). Separate spec.
- Sub-proyecto **C** (seasonality input by month with %/amount). Separate spec; existing code already implements `SeasonalityDeltaGrid` and may only need UX/discoverability work.
- Sub-proyecto **D** (questionnaire → AI → templates flow). Separate spec.
- Cotizaciones / contratos workflow. Out of scope this week per partner.
- Schema migration of existing projections (`effectiveBudget` recomputation). Not needed — no production rows yet; `recalculate` normalizes lazily.

## Scope decisions captured during brainstorming

- **Bug 1**: drop proration entirely (`effectiveBudget = totalBudget` always). Keep the `effectiveBudget` field optional in schema for backward read-compat. Remove the visible "Presupuesto prorrateado: $X × N/12 = $Y" widget in `ProjectionPeriodSelector`.
- **Bug 2**: instrumentation + repro first, then a targeted fix. Independently, add a defensive verification post-create + visible toast on error (so future failures are observable).
- **Bug 3**: dedicated `projectionDrafts` table (not reuse `projections` with `status: "draft"`, which already means "complete-but-not-activated"). One draft per `(orgId, userId, clientId)` with `clientId=null` slot for pre-client wizard state. Auto-save fires **on step transition only** (not per keystroke).
- **Copy fixes**: 3 minimal fixes in Step 1 and Step 2. No structural UI changes.

---

## Design

### § 1. Bug 1 — Eliminate proration semantics

**Files touched:**
- `convex/lib/projectionContext.ts:25-32`
- `convex/functions/projections/mutations.ts:231-236` (`recalculate`)
- `src/app/(dashboard)/proyecciones/nueva/page.tsx:87-91`
- `src/components/projections/projection-period-selector.tsx:37-39, 126-138`

**Engine change (`projectionContext.ts`):**

Replace:
```ts
const computedEffective =
  projectionMode === "fiscal" ? p.totalBudget * (monthCount / 12) : p.totalBudget;
```
with:
```ts
const computedEffective = p.totalBudget;
```

Result: `effectiveBudget` always equals `totalBudget`, regardless of mode. The engine's per-month math (`monthlyBase = annualAmount / monthCount`) then distributes the full contracted budget over the projection's `monthCount` months → e.g. `10M / 8 = $1.25M/mes`.

**Mutation change (`projections/mutations.ts:recalculate`):**

The inline `effectiveBudget` computation (lines 231-236) must match the same rule:
```ts
const effectiveBudget = totalBudget;
```

**Wizard change (`nueva/page.tsx:87-91`):**

The form's live preview also computes effectiveBudget. Same change.

**UI change (`projection-period-selector.tsx`):**

- Remove the "Presupuesto prorrateado: $X × monthCount/12 = $Y" copy block from the fiscal mode option (lines 126-138).
- For both rolling and fiscal modes, the per-mode help text becomes:
  - Rolling: *"Presupuesto contratado: `$totalBudget` distribuido en 12 meses (~`$totalBudget/12`/mes)"*
  - Fiscal:  *"Presupuesto contratado: `$totalBudget` distribuido en `${monthCount}` meses (~`$totalBudget/monthCount`/mes)"*
- The fiscal-mode warning "En enero {endYear + 1} deberás crear una nueva proyección 12 meses" stays unchanged.

**Schema:** No change. `effectiveBudget` stays optional. Existing rows with the old prorated value are not touched; `recalculate` normalizes lazily, and the field is no longer load-bearing for the engine (it always re-derives from `totalBudget` via context).

**Tests updated:**
- `convex/lib/__tests__/projectionContext.test.ts`: all "fiscal" assertions that expected `totalBudget * monthCount/12` → `totalBudget`.
- `convex/lib/__tests__/projectionEngine.context.test.ts`: same.
- `convex/lib/__tests__/projectionEngine.residual.test.ts`: only the `effectiveBudget` setup needs to change; residual reconciliation logic itself is unaffected.

**Tests added:**
- One new repro test in `projectionEngine.context.test.ts` (or a dedicated file) named "10M en 8 meses fiscal → 1.25M/mes" that asserts:
  - `totalBudget: 10_000_000`, `monthCount: 8`, `startMonth: 5`, `projectionMode: "fiscal"`, no services → `monthlyTotals` each ≈ `1_250_000` (within IEEE-754 tolerance).

### § 2. Bug 2 — List does not show newly-created projection

This is split into three phases. Phase 1 and 3 ship even if Phase 2 doesn't reproduce; Phase 2 informs the root-cause fix.

**Phase 1 — Instrumentation.**

Add structured logs (no `console.log` ship-by-mistake — wrap in `if (process.env.NODE_ENV !== "production")` for the frontend; Convex logs go to dashboard regardless):

- `convex/functions/projections/mutations.ts:create`, after `ctx.db.insert("projections", ...)`:
  ```ts
  console.log("[projections.create] inserted", {
    projectionId, orgId, clientId: args.clientId, status: "draft",
  });
  ```
- `src/app/(dashboard)/proyecciones/nueva/page.tsx:handleSubmit`, after `await createProjection(...)`:
  ```ts
  if (process.env.NODE_ENV !== "production") {
    console.log("[wizard.submit] created", { projId });
  }
  ```
- `convex/lib/authHelpers.ts:getOrgId` and `getOrgIdSafe`: log `{ tokenIdentifier, orgId, org_id }` on first call per request (gated by env flag).

**Phase 2 — Repro and root-cause.**

Run the wizard end-to-end with Catimi-like data (10M / 8 months / Mayo–Dic / 60M sales). Capture:
- DevTools console: were `[projections.create]` and `[wizard.submit]` logged?
- Convex dashboard: does the row exist in `projections`?
- Convex dashboard: what `orgId` does it have?

Decision tree:
- **Row not inserted** → mutation throws or short-circuits silently. Fix: audit the `create` mutation's throw paths (`requireAuth`, `getOrgId`, `ctx.db.get(args.clientId)` ownership check, service lookups). Likely culprit: `client.orgId !== orgId` after a client edit that mutated the client's `orgId` (unlikely but possible).
- **Row inserted with mismatched `orgId`** → JWT claim drift between mutations (uses `org_id` snake_case fallback) and queries (uses `orgId` first). Fix in `getOrgId`/`getOrgIdSafe` to normalize before reading.
- **Row inserted correctly, just not visible** → frontend reactive subscription stale. Fix: force-refetch in the list page on focus / mount; verify no Suspense boundary swallows the second render.

**Phase 3 — Defensive guardrails (ship regardless of Phase 2 outcome).**

In `nueva/page.tsx:handleSubmit`, use `useConvex()` (from `convex/react`) at component scope to enable an imperative query call after the mutation:

```ts
const convex = useConvex();
// ...
const projId = await createProjection({ ... });
// Defensive: verify it's readable by the same user/org.
const verify = await convex.query(api.functions.projections.queries.getById, { id: projId });
if (!verify) {
  // toast.error if a toast lib is wired; otherwise inline error block.
  setSubmitError("Proyección creada pero no encontrada en tu organización. Contacta soporte.");
  return; // Do NOT redirect.
}
router.push(`/proyecciones/${projId}`);
```

Replace the existing `alert(err.message)` with the same `setSubmitError(...)` state pattern → render an error block below the submit button (no new dep added in this sub-project). If a toast library is already a dependency by the time the plan executes, the planner may swap the inline block for a toast — both are acceptable.

In `convex/functions/projections/queries.ts:list`: leave as-is. Reactive `useQuery` is correct; if Phase 2 reveals it's stale, that fix lands in Phase 2 changes, not here.

**Tests:** No new unit tests. Manual repro QA is the validation.

### § 3. Bug 3 — Server-side wizard draft autosave

**New table (`convex/schema.ts`):**

```ts
projectionDrafts: defineTable({
  orgId: v.string(),
  userId: v.string(),                       // identity.subject
  clientId: v.optional(v.id("clients")),    // null until Step 1 picks a client
  state: v.object({
    step: v.number(),                       // 0..3
    year: v.optional(v.number()),
    annualSales: v.optional(v.number()),
    totalBudget: v.optional(v.number()),
    commissionRate: v.optional(v.number()),
    startMonth: v.optional(v.number()),
    projectionMode: v.optional(
      v.union(v.literal("rolling"), v.literal("fiscal"))
    ),
    useSeasonality: v.optional(v.boolean()),
    seasonalityDeltas: v.optional(
      v.array(v.object({ month: v.number(), deltaPercent: v.number() }))
    ),
    serviceStates: v.optional(
      v.array(
        v.object({
          serviceId: v.string(),
          chosenPct: v.number(),
          isActive: v.boolean(),
        })
      )
    ),
    previousProjectionId: v.optional(v.id("projections")),
  }),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_orgId", ["orgId"])
  .index("by_orgId_userId_clientId", ["orgId", "userId", "clientId"]),
```

Uniqueness assumption: at most one draft per `(orgId, userId, clientId)`. Enforced in mutation logic (find-or-create), not by a DB constraint. The `clientId=null` slot is one slot per user (pre-client-selection wizard state).

**New mutations/queries (`convex/functions/projectionDrafts/`):**

```ts
// mutations.ts
export const upsertDraft = mutation({
  args: {
    clientId: v.optional(v.id("clients")),
    state: v.object({ ...same shape as schema... }),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const orgId = await getOrgId(ctx);
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity!.subject;

    const existing = await ctx.db
      .query("projectionDrafts")
      .withIndex("by_orgId_userId_clientId", (q) =>
        q.eq("orgId", orgId).eq("userId", userId).eq("clientId", args.clientId)
      )
      .unique();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { state: args.state, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("projectionDrafts", {
      orgId, userId, clientId: args.clientId,
      state: args.state, createdAt: now, updatedAt: now,
    });
  },
});

export const deleteMyDraft = mutation({
  args: { clientId: v.optional(v.id("clients")) },
  handler: async (ctx, { clientId }) => {
    await requireAuth(ctx);
    const orgId = await getOrgId(ctx);
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity!.subject;
    const existing = await ctx.db
      .query("projectionDrafts")
      .withIndex("by_orgId_userId_clientId", (q) =>
        q.eq("orgId", orgId).eq("userId", userId).eq("clientId", clientId)
      )
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

// queries.ts
export const getMyDraft = query({
  args: { clientId: v.optional(v.id("clients")) },
  handler: async (ctx, { clientId }) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await ctx.db
      .query("projectionDrafts")
      .withIndex("by_orgId_userId_clientId", (q) =>
        q.eq("orgId", orgId).eq("userId", identity.subject).eq("clientId", clientId)
      )
      .unique();
  },
});

export const listMyDrafts = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("projectionDrafts")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .filter((q) => q.eq(q.field("userId"), identity.subject))
      .collect();
  },
});
```

`listMyDrafts` is ancillary for a future "mis borradores" view; not required by the immediate UX, but cheap to add now and saves a second round-trip later.

**Wizard wiring (`nueva/page.tsx`):**

1. On mount, with the current `clientId` from URL params (may be empty string → treated as `undefined`), query `getMyDraft({ clientId })`.
   - If a draft exists, show a banner above the wizard: *"Tienes un borrador en curso (último guardado: hace X). ¿Continuar o empezar de nuevo?"* with two buttons:
     - **Continuar**: hydrate the wizard state from `draft.state`, set `step` accordingly.
     - **Empezar de nuevo**: call `deleteMyDraft({ clientId })`, keep the wizard empty.
2. Add a `saveDraft()` helper:
   ```ts
   const saveDraft = useCallback(async (nextStep: number) => {
     await upsertDraft({
       clientId: clientId ? (clientId as Id<"clients">) : undefined,
       state: { step: nextStep, year, annualSales, totalBudget, commissionRate,
                startMonth, projectionMode, useSeasonality, seasonalityDeltas,
                serviceStates: serviceStates.map(...),
                previousProjectionId: previousProjectionId as Id<"projections"> | undefined },
     });
   }, [clientId, year, annualSales, totalBudget, commissionRate, startMonth,
       projectionMode, useSeasonality, seasonalityDeltas, serviceStates, previousProjectionId]);
   ```
3. Trigger `saveDraft(nextStep)` on:
   - "Siguiente" button click (before `setStep`)
   - Step-indicator backward click (before `setStep`)
   - "Anterior" button click (before `setStep`)
   - Optional `beforeunload` listener that fires a final `saveDraft(step)` — best-effort, may not complete on tab close, but Convex mutation is fire-and-forget at this point.
4. On final "Crear Proyección" submit success, after `router.push(...)`, call `deleteMyDraft({ clientId })`.

Note: if the user selects a client mid-wizard (Step 0 → choosing in dropdown), and there was a `clientId=null` draft, that draft is *not* automatically migrated to the new clientId. Two valid resolutions:
- **Flag-driven**: when the user picks a client in Step 0, the next `saveDraft` call passes `clearPreClientDraft: true`, and `upsertDraft` deletes the `clientId=null` slot for this user in the same transaction. Recommended for v1 — small, deterministic.
- **Lazy two-draft**: accept that both rows can coexist briefly. No cleanup scheduled; the `null` slot may sit indefinitely until the user starts a fresh wizard. Acceptable but leaves orphans.

The implementation plan should pick flag-driven and add `clearPreClientDraft: v.optional(v.boolean())` to `upsertDraft`'s args.

**Tests (`convex/functions/projectionDrafts/__tests__/*.test.ts`):**
- `upsertDraft` creates a draft when none exists.
- `upsertDraft` patches the same row when one exists for the same `(orgId, userId, clientId)`.
- `getMyDraft` returns `null` when no draft.
- `deleteMyDraft` is idempotent.
- Multi-tenant isolation: drafts for org A are not visible to org B. (Pattern from `questionnaires.test.ts`.)

### § 4. Copy fixes

**Fix 1 — Step 1, Tasa de Comisión** (`nueva/page.tsx:288-300`):

Add a `<p>` helper text below the input:
> *Solo aplica a conceptos de comisión, intermediación mercantil o venta por comisión. NO aplica a servicios legales, marketing, RH, etc. (Ejemplo: el rubro inmobiliario suele cobrar 3-5%.)*

Styling: same `text-xs text-muted-foreground` already used for other helper text in the page.

**Fix 2 — Step 1, Venta Anual vs Presupuesto** (`nueva/page.tsx:302-327`):

Below "Venta Anual Proyectada (MXN)":
> *Lo que factura el cliente al año (referencia para calcular el tope de mercado por servicio).*

Below "Presupuesto Total a Contratar (MXN)":
> *Lo que el cliente nos contrata. Se distribuye entre los meses del contrato.*

**Fix 3 — Step 2, "Sin estacionalidad" recuadro** (`nueva/page.tsx:366-373, 379-389`):

Replace the existing recuadro text with:
> *Sin estacionalidad personalizada: tomamos la facturación del cliente (`$annualSales`) y la repartimos en 12 meses (~`$annualSales/12`/mes) **solo para calcular los factores de estacionalidad (FE)**. Esto NO es el monto que se cobra — eso lo define el presupuesto contratado (`$effectiveBudget` ÷ `{monthCount}` meses = ~`$effectiveBudget/monthCount`/mes).*

Hardcoded values are formatted with `formatCurrency`. `monthCount` is the live-computed value.

---

## Test strategy summary

- **Unit tests**: update existing proration tests (~10 changes); add 1 repro test for Bug 1; add ~4 tests for `projectionDrafts` mutations/queries (multi-tenant isolation included).
- **Manual QA before friday**: run full wizard with Catimi-like data, verify all 3 bugs + 3 copy fixes. Use this checklist:
  1. Create projection 10M / fiscal / mayo-dic → resumen shows monthly total ≈ 1.25M.
  2. Submit → land on detail page → navigate back to `/proyecciones` → projection appears.
  3. Start wizard, fill Step 1, navigate to `/clientes`, come back to `/nueva` → banner offers to resume.
  4. Resume → state hydrated; finish wizard → draft deleted; new projection visible in list.
  5. Step 1: hover/read the three helper texts; verify language is clear.
  6. Step 2: with no seasonality, read the recuadro; verify it explains the 5M/mes confusion.
- **Convex schema deploy**: confirm `npx convex dev` accepts the new table without errors.

## Risks and open questions

- **R1 (Bug 2 root cause unknown)**: defensive guardrails ensure the bug is observable next time, but if Phase 2 doesn't reproduce locally before friday, the fix may still be theoretical. Mitigation: ship defensives + ask partner to test live, capture logs.
- **R2 (Draft per `clientId=null` slot)**: if a user starts the wizard, picks client A, abandons, then starts again without picking, the `clientId=null` slot is re-used. Acceptable, but means there's no "drafts for multiple clients" UX in v1 — partner did not ask for it.
- **R3 (Beforeunload save)**: not all browsers reliably complete fetch-on-unload; treat as best-effort. The user always has the step-transition save as ground truth.
- **R4 (Concurrent edits)**: two browser tabs open to the same wizard for the same `(user, client)` will race. Last-write-wins is acceptable given the use case (single operator).
- **OQ1**: when Phase 2 of Bug 2 reproduces, the spec doesn't predetermine the fix. The implementation plan will branch on the diagnosis.

## Appendix — Files added or modified

**Added:**
- `convex/functions/projectionDrafts/mutations.ts`
- `convex/functions/projectionDrafts/queries.ts`
- `convex/functions/projectionDrafts/__tests__/mutations.test.ts`
- `convex/functions/projectionDrafts/__tests__/queries.test.ts`
- New repro test case for "10M en 8 meses" (location TBD by writing-plans).

**Modified:**
- `convex/schema.ts` (+1 table)
- `convex/lib/projectionContext.ts` (Bug 1 logic)
- `convex/functions/projections/mutations.ts` (Bug 1 in `recalculate`; Bug 2 instrumentation)
- `convex/lib/authHelpers.ts` (Bug 2 instrumentation; possibly normalization fix from Phase 2)
- `src/app/(dashboard)/proyecciones/nueva/page.tsx` (Bug 1 live preview; Bug 3 wizard wiring; Bug 2 verify+toast; copy fixes 1–3)
- `src/components/projections/projection-period-selector.tsx` (Bug 1 UI; copy)
- `convex/lib/__tests__/projectionContext.test.ts` (Bug 1 tests)
- `convex/lib/__tests__/projectionEngine.context.test.ts` (Bug 1 tests)
- `convex/lib/__tests__/projectionEngine.residual.test.ts` (Bug 1 tests, light)
