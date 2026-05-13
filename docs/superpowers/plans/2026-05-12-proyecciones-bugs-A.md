# Proyecciones — Sub-proyecto A (bugs críticos) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three projection bugs reported in the 2026-05-12 partner call (proration semantics, missing-from-list after create, lost wizard progress on exit) plus 3 microcopy fixes, so the wizard is demo-ready for the 2026-05-15 sprint deadline.

**Architecture:** Three independent bug fixes plus copy. Bug 1 modifies the engine's `effectiveBudget` derivation in one helper and a few callers, no schema migration. Bug 2 ships defensive guardrails first (visible error on create, post-create verification) and adds structured logs to enable diagnosis. Bug 3 introduces a new `projectionDrafts` table with `upsertDraft` / `getMyDraft` / `deleteMyDraft` / `listMyDrafts`, autosaved on step transitions from the wizard. Copy fixes are inline JSX text changes.

**Tech Stack:** Convex (DB + functions), Next.js 15 App Router, React 19, vitest + convex-test for testing, Clerk Organizations for auth, Tailwind for styling.

**Spec:** `docs/superpowers/specs/2026-05-12-proyecciones-bugs-A-design.md`

---

## File Structure

**Files modified:**
- `convex/lib/projectionContext.ts` — drop fiscal proration of `effectiveBudget`.
- `convex/lib/__tests__/projectionContext.test.ts` — update fiscal-mode assertions.
- `convex/lib/__tests__/projectionEngine.context.test.ts` — update fiscal-mode assertions; add repro test.
- `convex/lib/__tests__/projectionEngine.residual.test.ts` — light update on `effectiveBudget` inputs only.
- `convex/functions/projections/mutations.ts` — drop proration in `recalculate`; add `[projections.create]` log.
- `convex/functions/projections/queries.ts` — no functional change; only used by Bug 2 defensive verification.
- `convex/schema.ts` — add `projectionDrafts` table.
- `src/app/(dashboard)/proyecciones/nueva/page.tsx` — drop proration in preview; add submit error state + post-create verify; wire draft hydration banner, autosave on step transitions, delete on submit; apply copy fixes 1 and 2; copy fix 3 inside Step 2.
- `src/components/projections/projection-period-selector.tsx` — replace "Presupuesto prorrateado" block with single contract-distribution copy.

**Files created:**
- `convex/functions/projectionDrafts/mutations.ts`
- `convex/functions/projectionDrafts/queries.ts`
- `convex/functions/projectionDrafts/__tests__/mutations.test.ts`
- `convex/functions/projectionDrafts/__tests__/queries.test.ts`

---

## Phase 1 — Bug 1: Eliminate proration semantics

### Task 1: Add failing repro test for "10M en 8 meses → 1.25M/mes"

**Files:**
- Modify: `convex/lib/__tests__/projectionEngine.context.test.ts` (append a new `it()` inside the existing `describe` block, or add a new `describe` at the end)

- [ ] **Step 1: Read the existing file** so the new test slots cleanly

Run: `cat convex/lib/__tests__/projectionEngine.context.test.ts | tail -30`

Note the existing imports and the surrounding `describe` block name.

- [ ] **Step 2: Append the new failing test**

Add at the end of the existing top-level `describe(...)` block (i.e. before its closing `});`):

```ts
  it("Bug 1 repro: 10M contract in 8 fiscal months distributes as 1.25M/month", () => {
    const result = calculateProjection({
      annualSales: 60_000_000,
      totalBudget: 10_000_000,
      commissionRate: 0,
      services: [],
      seasonalityData: generateEvenSeasonality(60_000_000),
      startMonth: 5,
      monthCount: 8,
      effectiveBudget: undefined,
      projectionMode: "fiscal",
    });

    // 8 months covered, each receiving 10M / 8 = 1.25M (no services so commission=0 and remaining=10M is unallocated, but monthlyTotals reflects the budget shape).
    expect(result.remainingBudget).toBe(10_000_000);
    expect(result.monthlyTotals).toHaveLength(8);
    // Each month should equal 0 here because there are no services; this verifies remainingBudget alone.
  });

  it("Bug 1 repro with one service: 10M / 8 months with one 100% service yields 1.25M/month", () => {
    const result = calculateProjection({
      annualSales: 60_000_000,
      totalBudget: 10_000_000,
      commissionRate: 0,
      services: [
        {
          serviceId: "svc1",
          serviceName: "Legal",
          type: "base",
          minPct: 0.01,
          maxPct: 0.99,
          chosenPct: 0.05,
          isActive: true,
          isCommission: false,
        },
      ],
      seasonalityData: generateEvenSeasonality(60_000_000),
      startMonth: 5,
      monthCount: 8,
      projectionMode: "fiscal",
    });
    // With only one active service, it absorbs the full remainingBudget = 10M.
    expect(result.services[0].annualAmount).toBe(10_000_000);
    expect(result.monthlyTotals).toHaveLength(8);
    for (const m of result.monthlyTotals) {
      expect(m.total).toBeCloseTo(1_250_000, 2);
    }
  });
```

If `calculateProjection` and `generateEvenSeasonality` are not already imported at the top of the file, add them:

```ts
import { calculateProjection, generateEvenSeasonality } from "../projectionEngine";
```

- [ ] **Step 3: Run the new tests to confirm they FAIL**

Run: `npx vitest run convex/lib/__tests__/projectionEngine.context.test.ts -t "Bug 1 repro"`

Expected: both new tests FAIL. The first one's `remainingBudget` is probably `6_666_666.67` (10M * 8/12) instead of `10_000_000`. The second one's `annualAmount` matches that prorated value, and each `monthlyTotals[i].total` is `~833_333` instead of `1_250_000`.

If they pass already, the bug is somehow not present — stop and re-read the spec before continuing.

- [ ] **Step 4: Do NOT commit yet** (we land the fix in the next task and commit together)

---

### Task 2: Drop proration in `projectionContext.ts` and make tests green

**Files:**
- Modify: `convex/lib/projectionContext.ts:25-32`

- [ ] **Step 1: Make the edit**

Open `convex/lib/projectionContext.ts`. Replace this block:

```ts
  const computedMonthCount =
    projectionMode === "fiscal" ? Math.max(1, 13 - startMonth) : 12;
  const monthCount = p.monthCount ?? computedMonthCount;
  const computedEffective =
    projectionMode === "fiscal" ? p.totalBudget * (monthCount / 12) : p.totalBudget;
  const effectiveBudget = p.effectiveBudget ?? computedEffective;
```

with:

```ts
  const computedMonthCount =
    projectionMode === "fiscal" ? Math.max(1, 13 - startMonth) : 12;
  const monthCount = p.monthCount ?? computedMonthCount;
  // 2026-05-12: dropped proration. `totalBudget` is the contracted amount to
  // distribute across `monthCount` months in both rolling and fiscal modes.
  // `effectiveBudget` is kept in the type for back-compat with stored rows
  // (prior rows may still have a prorated value) but is no longer load-bearing;
  // callers should treat it as equal to `totalBudget`.
  const effectiveBudget = p.totalBudget;
```

- [ ] **Step 2: Run repro tests to verify they PASS**

Run: `npx vitest run convex/lib/__tests__/projectionEngine.context.test.ts -t "Bug 1 repro"`

Expected: both new tests PASS.

- [ ] **Step 3: Run the full projectionContext test file to find regressions**

Run: `npx vitest run convex/lib/__tests__/projectionContext.test.ts`

Expected: several existing fiscal-mode tests FAIL because they asserted the old proration. Capture the failing test names. Examples likely to fail: any test that mentions "fiscal" and asserts `effectiveBudget < totalBudget`.

- [ ] **Step 4: Do NOT commit yet** (next task fixes the failing tests)

---

### Task 3: Update `projectionContext.test.ts` to reflect new semantics

**Files:**
- Modify: `convex/lib/__tests__/projectionContext.test.ts` (all fiscal-mode `effectiveBudget` assertions)

- [ ] **Step 1: List the failing tests from Task 2 Step 3**

You captured them. For each failing test, the change is: any assertion `expect(r.effectiveBudget).toBe(<prorated value>)` becomes `expect(r.effectiveBudget).toBe(totalBudget_from_input)`.

- [ ] **Step 2: Apply the edits**

For each failing test, change the prorated expected value to the input `totalBudget`. Example transformation:

```ts
// BEFORE
it("fiscal startMonth=5 → 8 months May-Dec, prorated effective budget", () => {
  const r = resolveProjectionContext({
    totalBudget: 24_000_000, year: 2026,
    projectionMode: "fiscal", startMonth: 5,
  });
  expect(r.monthCount).toBe(8);
  expect(r.effectiveBudget).toBe(16_000_000); // 24M * 8/12
});

// AFTER
it("fiscal startMonth=5 → 8 months May-Dec, full budget distributed", () => {
  const r = resolveProjectionContext({
    totalBudget: 24_000_000, year: 2026,
    projectionMode: "fiscal", startMonth: 5,
  });
  expect(r.monthCount).toBe(8);
  expect(r.effectiveBudget).toBe(24_000_000); // full contract, distributed across 8 months
});
```

Apply the analogous fix to every failing assertion in this file.

- [ ] **Step 3: Run the file to verify GREEN**

Run: `npx vitest run convex/lib/__tests__/projectionContext.test.ts`

Expected: all tests PASS.

- [ ] **Step 4: Do NOT commit yet**

---

### Task 4: Update `projectionEngine.context.test.ts` and `projectionEngine.residual.test.ts`

**Files:**
- Modify: `convex/lib/__tests__/projectionEngine.context.test.ts`
- Modify: `convex/lib/__tests__/projectionEngine.residual.test.ts`

- [ ] **Step 1: Run both files**

Run: `npx vitest run convex/lib/__tests__/projectionEngine.context.test.ts convex/lib/__tests__/projectionEngine.residual.test.ts`

Expected: some fiscal-mode assertions fail. Capture names.

- [ ] **Step 2: Update assertions**

Same pattern as Task 3: where a test passed an explicit `effectiveBudget` that was the prorated value, change to the full `totalBudget`. Where an assertion expected `remainingBudget` to be derived from a prorated budget, recompute against the full budget.

Concrete example in `residual.test.ts`:

```ts
// BEFORE
{ name: "fiscal 8 months", totalBudget: 24_000_000, annualSales: 31_200_000, weights: [0.1, 0.1] }
// (test passed effectiveBudget = 16_000_000 implicitly via projectionMode: "fiscal")

// AFTER
// Same input. Engine now uses 24_000_000 as effectiveBudget. Adjust any assertion that
// summed expected service annualAmounts to total 16M → now they total 24M.
```

- [ ] **Step 3: Run both files to verify GREEN**

Run: `npx vitest run convex/lib/__tests__/projectionEngine.context.test.ts convex/lib/__tests__/projectionEngine.residual.test.ts`

Expected: all tests PASS.

- [ ] **Step 4: Run the entire test suite**

Run: `npm test`

Expected: all tests PASS, including the integration tests in `convex/lib/__tests__/integration.test.ts` and others. If any other file fails because of the proration change, apply the same value transformation.

- [ ] **Step 5: Commit Bug 1 engine + tests**

```bash
git add convex/lib/projectionContext.ts convex/lib/__tests__/
git commit -m "$(cat <<'EOF'
fix(projections): drop budget proration in fiscal mode

Engine now treats totalBudget as the contracted amount distributed across
monthCount months in both rolling and fiscal modes. Reproduces the 10M/8mo
= 1.25M/mo case from the 2026-05-12 partner call. effectiveBudget field is
kept for back-compat with stored rows but no longer load-bearing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Apply Bug 1 fix in `recalculate` mutation

**Files:**
- Modify: `convex/functions/projections/mutations.ts:231-236`

- [ ] **Step 1: Edit the mutation**

Replace:

```ts
    const monthCount = projection.monthCount ?? 12;
    const projectionMode = projection.projectionMode ?? "rolling";
    const effectiveBudget =
      projectionMode === "fiscal"
        ? totalBudget * (monthCount / 12)
        : totalBudget;
```

with:

```ts
    const monthCount = projection.monthCount ?? 12;
    const projectionMode = projection.projectionMode ?? "rolling";
    // 2026-05-12: dropped proration. See projectionContext.ts for rationale.
    const effectiveBudget = totalBudget;
```

(`projectionMode` and `monthCount` stay for downstream `calculateProjection` call.)

- [ ] **Step 2: Run mutation tests if any exist**

Run: `npx vitest run convex/functions/projections/`

Expected: PASS. If no mutation tests, this just confirms no regressions.

- [ ] **Step 3: Commit**

```bash
git add convex/functions/projections/mutations.ts
git commit -m "fix(projections): drop proration in recalculate mutation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Apply Bug 1 fix in wizard preview

**Files:**
- Modify: `src/app/(dashboard)/proyecciones/nueva/page.tsx:87-91`

- [ ] **Step 1: Edit the wizard's `effectiveBudget` derivation**

Replace:

```ts
  // Derive monthCount and effectiveBudget live
  const monthCount = projectionMode === "fiscal" ? Math.max(1, 13 - startMonth) : 12;
  const effectiveBudget = projectionMode === "fiscal"
    ? totalBudget * (monthCount / 12)
    : totalBudget;
```

with:

```ts
  // Derive monthCount and effectiveBudget live
  const monthCount = projectionMode === "fiscal" ? Math.max(1, 13 - startMonth) : 12;
  // 2026-05-12: dropped proration. effectiveBudget = totalBudget in both modes.
  const effectiveBudget = totalBudget;
```

- [ ] **Step 2: Verify the type checks**

Run: `npx tsc --noEmit`

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/proyecciones/nueva/page.tsx
git commit -m "fix(projections): drop proration in wizard live preview

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Replace "Presupuesto prorrateado" widget in ProjectionPeriodSelector

**Files:**
- Modify: `src/components/projections/projection-period-selector.tsx:37-39, 126-138`

- [ ] **Step 1: Drop proration in the `effectiveBudget` line**

Replace lines 37-39:

```ts
  const monthCount = mode === "fiscal" ? Math.max(1, 13 - startMonth) : 12;
  const effectiveBudget =
    mode === "fiscal" ? totalBudget * (monthCount / 12) : totalBudget;
```

with:

```ts
  const monthCount = mode === "fiscal" ? Math.max(1, 13 - startMonth) : 12;
  const effectiveBudget = totalBudget;
  const monthlyDistribution = monthCount > 0 ? totalBudget / monthCount : 0;
```

- [ ] **Step 2: Replace the "Presupuesto prorrateado" block (fiscal option, lines 126-138)**

Replace:

```tsx
            {mode === "fiscal" && (
              <>
                <p className="text-xs">
                  Presupuesto prorrateado:{" "}
                  <span className="font-medium">
                    {formatCurrency(totalBudget)}
                  </span>
                  {" × "}
                  {monthCount}/12 ={" "}
                  <span className="font-medium">
                    {formatCurrency(effectiveBudget)}
                  </span>
                </p>
                {endMonth === 12 && (
                  <p className="text-xs text-muted-foreground italic">
                    ⓘ En enero {endYear + 1} deberás crear una nueva proyección
                    12 meses
                  </p>
                )}
              </>
            )}
```

with:

```tsx
            {mode === "fiscal" && (
              <>
                <p className="text-xs">
                  Presupuesto contratado:{" "}
                  <span className="font-medium">
                    {formatCurrency(totalBudget)}
                  </span>
                  {" distribuido en "}
                  <span className="font-medium">{monthCount} meses</span>
                  {" (~"}
                  <span className="font-medium">
                    {formatCurrency(monthlyDistribution)}
                  </span>
                  {"/mes)"}
                </p>
                {endMonth === 12 && (
                  <p className="text-xs text-muted-foreground italic">
                    ⓘ En enero {endYear + 1} deberás crear una nueva proyección
                    12 meses
                  </p>
                )}
              </>
            )}
```

- [ ] **Step 3: Also update the rolling option (lines 84-91) for symmetry**

Replace:

```tsx
            {mode === "rolling" && (
              <p className="text-xs">
                Presupuesto contratado:{" "}
                <span className="font-medium">
                  {formatCurrency(effectiveBudget)}
                </span>
              </p>
            )}
```

with:

```tsx
            {mode === "rolling" && (
              <p className="text-xs">
                Presupuesto contratado:{" "}
                <span className="font-medium">
                  {formatCurrency(totalBudget)}
                </span>
                {" distribuido en 12 meses (~"}
                <span className="font-medium">
                  {formatCurrency(monthlyDistribution)}
                </span>
                {"/mes)"}
              </p>
            )}
```

- [ ] **Step 4: Verify type-check**

Run: `npx tsc --noEmit`

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/projections/projection-period-selector.tsx
git commit -m "fix(projections): replace prorated widget with contract distribution

Show 'Presupuesto contratado: \$X distribuido en N meses (~\$X/N/mes)' for
both rolling and fiscal modes. Drops the confusing '× N/12 = Y' calculation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 — Bug 2: List doesn't show newly-created projection

### Task 8: Add instrumentation logs (Phase 1 of the diagnostic plan)

**Files:**
- Modify: `convex/functions/projections/mutations.ts` (after the `ctx.db.insert("projections", ...)` call in `create`)
- Modify: `src/app/(dashboard)/proyecciones/nueva/page.tsx:handleSubmit` (after `await createProjection(...)`)

- [ ] **Step 1: Add log in mutation**

In `convex/functions/projections/mutations.ts`, immediately after the `const projectionId = await ctx.db.insert("projections", { ... });` line (around line 146), insert:

```ts
    console.log("[projections.create] inserted", {
      projectionId,
      orgId,
      clientId: args.clientId,
      status: "draft",
      hasMonthCount: args.monthCount !== undefined,
      hasProjectionMode: args.projectionMode !== undefined,
    });
```

- [ ] **Step 2: Add log in wizard**

In `src/app/(dashboard)/proyecciones/nueva/page.tsx`, inside `handleSubmit`, immediately after `const projId = await createProjection({ ... });`, insert:

```ts
      if (process.env.NODE_ENV !== "production") {
        console.log("[wizard.submit] created", { projId });
      }
```

- [ ] **Step 3: Commit (instrumentation lands on its own so we can revert/keep cleanly)**

```bash
git add convex/functions/projections/mutations.ts src/app/\(dashboard\)/proyecciones/nueva/page.tsx
git commit -m "chore(projections): instrument create flow for Bug 2 diagnosis

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Add defensive post-create verification + visible error state

**Files:**
- Modify: `src/app/(dashboard)/proyecciones/nueva/page.tsx`

- [ ] **Step 1: Import `useConvex` and add `convex` ref at top of component**

In `src/app/(dashboard)/proyecciones/nueva/page.tsx`, find the existing imports from `convex/react`:

```ts
import { useMutation, useQuery } from "convex/react";
```

Replace with:

```ts
import { useMutation, useQuery, useConvex } from "convex/react";
```

Inside `NuevaProyeccionContent`, after the existing `useAuth()` line, add:

```ts
  const convex = useConvex();
```

- [ ] **Step 2: Add submit error state**

Near the top of `NuevaProyeccionContent` where the other `useState` hooks live, add:

```ts
  const [submitError, setSubmitError] = useState<string | null>(null);
```

- [ ] **Step 3: Replace `alert` and add verification in `handleSubmit`**

Replace the existing `handleSubmit` function body. Locate:

```ts
  async function handleSubmit() {
    if (!clientId) return;
    setLoading(true);
    try {
      const projId = await createProjection({
        // ... existing args ...
      });
      router.push(`/proyecciones/${projId}`);
    } catch (err) {
      alert((err as Error).message || "Error al crear la proyección");
    } finally {
      setLoading(false);
    }
  }
```

Replace with:

```ts
  async function handleSubmit() {
    if (!clientId) return;
    setLoading(true);
    setSubmitError(null);
    try {
      const projId = await createProjection({
        // ... KEEP all existing args unchanged ...
      });

      if (process.env.NODE_ENV !== "production") {
        console.log("[wizard.submit] created", { projId });
      }

      // Defensive: verify the row is readable by this user/org before redirecting.
      const verify = await convex.query(
        api.functions.projections.queries.getById,
        { id: projId }
      );
      if (!verify) {
        setSubmitError(
          "Proyección creada pero no aparece en tu organización. Refresca la página o contacta soporte."
        );
        return; // Do NOT redirect.
      }

      router.push(`/proyecciones/${projId}`);
    } catch (err) {
      setSubmitError((err as Error).message || "Error al crear la proyección");
    } finally {
      setLoading(false);
    }
  }
```

(Keep the existing `createProjection({ ... })` argument block intact — only the surrounding error handling is changing.)

If the previous task already added the `console.log("[wizard.submit] created"...)` line, leave it but make sure it isn't duplicated.

- [ ] **Step 4: Render the error message under the submit button**

Locate the submit button block in the JSX (around line 606-615):

```tsx
        ) : (
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex items-center gap-2 rounded-md bg-accent px-6 py-2 text-sm font-medium text-primary hover:bg-accent/90 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {loading ? "Creando..." : "Crear Proyección"}
            <Check size={14} />
          </button>
        )}
```

Wrap it in a flex column so the error appears below:

```tsx
        ) : (
          <div className="flex flex-col items-end gap-2">
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="flex items-center gap-2 rounded-md bg-accent px-6 py-2 text-sm font-medium text-primary hover:bg-accent/90 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {loading ? "Creando..." : "Crear Proyección"}
              <Check size={14} />
            </button>
            {submitError && (
              <p className="max-w-sm text-right text-xs text-destructive">
                {submitError}
              </p>
            )}
          </div>
        )}
```

If the project's color token for errors is named differently (e.g. `text-red-500` or `text-warning`), use that instead of `text-destructive`. Grep `text-destructive\|text-red\|text-warning` in `src/app` and pick the one already used for error messages.

- [ ] **Step 5: Verify type-check and dev server boots**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(dashboard\)/proyecciones/nueva/page.tsx
git commit -m "$(cat <<'EOF'
fix(projections): defensive post-create verification + visible submit errors

Verifies the new projection is readable by the same user/org before
redirecting; surfaces errors inline below the submit button instead of via
alert(). Mitigates Bug 2 even if the underlying cause is not yet diagnosed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — Bug 3: Wizard draft autosave

### Task 10: Add `projectionDrafts` table to schema

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1: Insert the new table definition**

In `convex/schema.ts`, immediately after the closing `})` and indexes of the `projections` table (around line 89, after the `.index("by_clientId_year", ...)` line), and before the next `services: defineTable(...)`, insert:

```ts
  projectionDrafts: defineTable({
    orgId: v.string(),
    userId: v.string(),
    clientId: v.optional(v.id("clients")),
    state: v.object({
      step: v.number(),
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
        v.array(
          v.object({
            month: v.number(),
            deltaPercent: v.number(),
          })
        )
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

- [ ] **Step 2: Boot Convex dev to validate the schema**

In a separate terminal (or noting it down if Convex dev is already running), run:

```bash
npx convex dev
```

Expected: schema is accepted; no validation errors mentioning `projectionDrafts`. Stop the process once confirmed.

If Convex dev errors out on `v.optional(v.id("clients"))` inside an indexed field, the index `by_orgId_userId_clientId` cannot contain an optional field. Convex DOES support optional fields in indexes (filter by `null`), but if this complains, fall back to two indexes: `by_orgId_userId` and a filter on `clientId` inside the mutation/query.

- [ ] **Step 3: Commit the schema change on its own**

```bash
git add convex/schema.ts
git commit -m "feat(schema): add projectionDrafts table for wizard autosave

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Write failing tests for `projectionDrafts.upsertDraft`

**Files:**
- Create: `convex/functions/projectionDrafts/__tests__/mutations.test.ts`

- [ ] **Step 1: Create the test file**

Write the following to `convex/functions/projectionDrafts/__tests__/mutations.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api } from "../../../_generated/api";

function asUserOfOrg(orgId: string, userSubject: string = `user|${orgId}`) {
  return {
    subject: userSubject,
    issuer: "test",
    tokenIdentifier: `test|${userSubject}`,
    orgId,
  };
}

const emptyState = (step: number = 0) => ({ step });

describe("projectionDrafts.upsertDraft", () => {
  it("creates a draft when none exists for (orgId, userId, clientId)", async () => {
    const t = convexTest(schema);
    const id = await t
      .withIdentity(asUserOfOrg("org_a"))
      .mutation(api.functions.projectionDrafts.mutations.upsertDraft, {
        clientId: undefined,
        state: emptyState(0),
      });
    expect(id).toBeDefined();

    const drafts = await t.run(async (ctx) => {
      return await ctx.db.query("projectionDrafts").collect();
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].orgId).toBe("org_a");
    expect(drafts[0].state.step).toBe(0);
  });

  it("patches the existing draft when one already exists for (orgId, userId, clientId)", async () => {
    const t = convexTest(schema);
    const ident = asUserOfOrg("org_a");

    const id1 = await t.withIdentity(ident).mutation(
      api.functions.projectionDrafts.mutations.upsertDraft,
      { clientId: undefined, state: emptyState(0) }
    );
    const id2 = await t.withIdentity(ident).mutation(
      api.functions.projectionDrafts.mutations.upsertDraft,
      { clientId: undefined, state: emptyState(2) }
    );
    expect(id1).toBe(id2);

    const drafts = await t.run(async (ctx) => {
      return await ctx.db.query("projectionDrafts").collect();
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].state.step).toBe(2);
  });

  it("multi-tenant isolation: drafts of org_a are not visible from org_b", async () => {
    const t = convexTest(schema);

    await t.withIdentity(asUserOfOrg("org_a")).mutation(
      api.functions.projectionDrafts.mutations.upsertDraft,
      { clientId: undefined, state: emptyState(0) }
    );

    const fromB = await t.withIdentity(asUserOfOrg("org_b")).query(
      api.functions.projectionDrafts.queries.getMyDraft,
      { clientId: undefined }
    );
    expect(fromB).toBeNull();
  });

  it("clearPreClientDraft removes the (clientId=null) slot when promoting to a real client", async () => {
    const t = convexTest(schema);
    const ident = asUserOfOrg("org_a");

    // Seed a clientId=null draft
    await t.withIdentity(ident).mutation(
      api.functions.projectionDrafts.mutations.upsertDraft,
      { clientId: undefined, state: emptyState(0) }
    );

    // Seed a client and upsert with that clientId + clearPreClientDraft: true
    const clientId = await t.run(async (ctx) =>
      ctx.db.insert("clients", {
        orgId: "org_a",
        name: "Catimi",
        rfc: "CTM010101AAA",
        industry: "Seguros",
        annualRevenue: 60_000_000,
        billingFrequency: "mensual" as const,
        isArchived: false,
        createdAt: Date.now(),
      })
    );

    await t.withIdentity(ident).mutation(
      api.functions.projectionDrafts.mutations.upsertDraft,
      { clientId, state: emptyState(1), clearPreClientDraft: true }
    );

    const drafts = await t.run(async (ctx) =>
      ctx.db.query("projectionDrafts").collect()
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].clientId).toBe(clientId);
  });
});

describe("projectionDrafts.deleteMyDraft", () => {
  it("deletes the matching draft", async () => {
    const t = convexTest(schema);
    const ident = asUserOfOrg("org_a");

    await t.withIdentity(ident).mutation(
      api.functions.projectionDrafts.mutations.upsertDraft,
      { clientId: undefined, state: emptyState(0) }
    );

    await t.withIdentity(ident).mutation(
      api.functions.projectionDrafts.mutations.deleteMyDraft,
      { clientId: undefined }
    );

    const drafts = await t.run(async (ctx) =>
      ctx.db.query("projectionDrafts").collect()
    );
    expect(drafts).toHaveLength(0);
  });

  it("is a no-op when no matching draft", async () => {
    const t = convexTest(schema);
    await t.withIdentity(asUserOfOrg("org_a")).mutation(
      api.functions.projectionDrafts.mutations.deleteMyDraft,
      { clientId: undefined }
    );
    // No throw, no assertion needed.
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm tests FAIL**

Run: `npx vitest run convex/functions/projectionDrafts/__tests__/mutations.test.ts`

Expected: FAIL with "module not found" or "Cannot find api.functions.projectionDrafts.mutations.upsertDraft" — because the mutations don't exist yet.

- [ ] **Step 3: Do NOT commit yet** (the next task creates the file and brings them to green)

---

### Task 12: Implement `projectionDrafts/mutations.ts`

**Files:**
- Create: `convex/functions/projectionDrafts/mutations.ts`

- [ ] **Step 1: Write the file**

Write the following to `convex/functions/projectionDrafts/mutations.ts`:

```ts
import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { requireAuth, getOrgId } from "../../lib/authHelpers";

const stateValidator = v.object({
  step: v.number(),
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
    v.array(
      v.object({
        month: v.number(),
        deltaPercent: v.number(),
      })
    )
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
});

export const upsertDraft = mutation({
  args: {
    clientId: v.optional(v.id("clients")),
    state: stateValidator,
    clearPreClientDraft: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await requireAuth(ctx);
    const orgId = await getOrgId(ctx);
    const userId = identity.subject;

    // If promoting from clientId=null to a real client, optionally clear the null slot.
    if (args.clientId !== undefined && args.clearPreClientDraft === true) {
      const preClient = await ctx.db
        .query("projectionDrafts")
        .withIndex("by_orgId_userId_clientId", (q) =>
          q.eq("orgId", orgId).eq("userId", userId).eq("clientId", undefined)
        )
        .unique();
      if (preClient) {
        await ctx.db.delete(preClient._id);
      }
    }

    const existing = await ctx.db
      .query("projectionDrafts")
      .withIndex("by_orgId_userId_clientId", (q) =>
        q.eq("orgId", orgId).eq("userId", userId).eq("clientId", args.clientId)
      )
      .unique();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        state: args.state,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("projectionDrafts", {
      orgId,
      userId,
      clientId: args.clientId,
      state: args.state,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const deleteMyDraft = mutation({
  args: {
    clientId: v.optional(v.id("clients")),
  },
  handler: async (ctx, { clientId }) => {
    const identity = await requireAuth(ctx);
    const orgId = await getOrgId(ctx);
    const userId = identity.subject;

    const existing = await ctx.db
      .query("projectionDrafts")
      .withIndex("by_orgId_userId_clientId", (q) =>
        q.eq("orgId", orgId).eq("userId", userId).eq("clientId", clientId)
      )
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: no new errors. If Convex's `_generated/api.d.ts` doesn't yet know about this module, run `npx convex dev --once` (or `npx convex codegen`) to regenerate it, then re-run `tsc`.

- [ ] **Step 3: Do NOT commit yet** (queries are still missing for the test file to work end-to-end)

---

### Task 13: Write failing tests for `projectionDrafts.getMyDraft` + `listMyDrafts`

**Files:**
- Create: `convex/functions/projectionDrafts/__tests__/queries.test.ts`

- [ ] **Step 1: Write the test file**

Write the following to `convex/functions/projectionDrafts/__tests__/queries.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api } from "../../../_generated/api";

function asUserOfOrg(orgId: string, userSubject: string = `user|${orgId}`) {
  return {
    subject: userSubject,
    issuer: "test",
    tokenIdentifier: `test|${userSubject}`,
    orgId,
  };
}

const emptyState = (step: number = 0) => ({ step });

describe("projectionDrafts.getMyDraft", () => {
  it("returns null when there is no draft", async () => {
    const t = convexTest(schema);
    const r = await t.withIdentity(asUserOfOrg("org_a")).query(
      api.functions.projectionDrafts.queries.getMyDraft,
      { clientId: undefined }
    );
    expect(r).toBeNull();
  });

  it("returns the user's draft for clientId=null", async () => {
    const t = convexTest(schema);
    const ident = asUserOfOrg("org_a");

    await t.withIdentity(ident).mutation(
      api.functions.projectionDrafts.mutations.upsertDraft,
      { clientId: undefined, state: { step: 2, year: 2026 } }
    );

    const r = await t.withIdentity(ident).query(
      api.functions.projectionDrafts.queries.getMyDraft,
      { clientId: undefined }
    );
    expect(r).not.toBeNull();
    expect(r!.state.step).toBe(2);
    expect(r!.state.year).toBe(2026);
  });
});

describe("projectionDrafts.listMyDrafts", () => {
  it("returns the user's drafts (both null-slot and per-client)", async () => {
    const t = convexTest(schema);
    const ident = asUserOfOrg("org_a");

    const clientId = await t.run(async (ctx) =>
      ctx.db.insert("clients", {
        orgId: "org_a",
        name: "C", rfc: "CCC010101AAA", industry: "X",
        annualRevenue: 1_000_000,
        billingFrequency: "mensual" as const,
        isArchived: false,
        createdAt: Date.now(),
      })
    );

    await t.withIdentity(ident).mutation(
      api.functions.projectionDrafts.mutations.upsertDraft,
      { clientId: undefined, state: emptyState(0) }
    );
    await t.withIdentity(ident).mutation(
      api.functions.projectionDrafts.mutations.upsertDraft,
      { clientId, state: emptyState(1) }
    );

    const r = await t.withIdentity(ident).query(
      api.functions.projectionDrafts.queries.listMyDrafts,
      {}
    );
    expect(r).toHaveLength(2);
  });

  it("does not return drafts from other orgs", async () => {
    const t = convexTest(schema);

    await t.withIdentity(asUserOfOrg("org_a")).mutation(
      api.functions.projectionDrafts.mutations.upsertDraft,
      { clientId: undefined, state: emptyState(0) }
    );

    const r = await t.withIdentity(asUserOfOrg("org_b")).query(
      api.functions.projectionDrafts.queries.listMyDrafts,
      {}
    );
    expect(r).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to confirm FAIL**

Run: `npx vitest run convex/functions/projectionDrafts/__tests__/queries.test.ts`

Expected: FAIL because `queries` module is missing.

- [ ] **Step 3: Do NOT commit yet**

---

### Task 14: Implement `projectionDrafts/queries.ts`

**Files:**
- Create: `convex/functions/projectionDrafts/queries.ts`

- [ ] **Step 1: Write the file**

```ts
import { query } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgIdSafe } from "../../lib/authHelpers";

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

- [ ] **Step 2: Regenerate Convex API types**

Run: `npx convex dev --once`

Expected: success; `_generated/api.d.ts` now exposes `api.functions.projectionDrafts.queries.*` and `.mutations.*`.

- [ ] **Step 3: Run both test files**

Run: `npx vitest run convex/functions/projectionDrafts/__tests__/`

Expected: ALL tests PASS.

- [ ] **Step 4: Commit drafts module + tests**

```bash
git add convex/functions/projectionDrafts/
git commit -m "$(cat <<'EOF'
feat(projectionDrafts): server-side wizard autosave module

Adds upsertDraft / deleteMyDraft / getMyDraft / listMyDrafts with
multi-tenant isolation and a clearPreClientDraft flag for promoting a
clientId=null wizard state to a real client. Tests cover create, patch,
isolation, and promotion.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Wire wizard — draft hydration banner and resume

**Files:**
- Modify: `src/app/(dashboard)/proyecciones/nueva/page.tsx`

- [ ] **Step 1: Add the draft query and the banner state**

Near the existing `useQuery` calls inside `NuevaProyeccionContent`, add:

```ts
  const draftClientId = clientId
    ? (clientId as Id<"clients">)
    : undefined;
  const existingDraft = useQuery(
    api.functions.projectionDrafts.queries.getMyDraft,
    authReady ? { clientId: draftClientId } : "skip"
  );

  const upsertDraft = useMutation(
    api.functions.projectionDrafts.mutations.upsertDraft
  );
  const deleteDraft = useMutation(
    api.functions.projectionDrafts.mutations.deleteMyDraft
  );

  const [draftDismissed, setDraftDismissed] = useState(false);
  const [draftHydrated, setDraftHydrated] = useState(false);
```

- [ ] **Step 2: Add a hydrate helper and a "dismiss/continue" pair**

Inside the same component, after the state declarations:

```ts
  function hydrateFromDraft() {
    if (!existingDraft) return;
    const s = existingDraft.state;
    if (s.year !== undefined) setYear(s.year);
    if (s.annualSales !== undefined) setAnnualSales(s.annualSales);
    if (s.totalBudget !== undefined) setTotalBudget(s.totalBudget);
    if (s.commissionRate !== undefined) setCommissionRate(s.commissionRate);
    if (s.startMonth !== undefined) setStartMonth(s.startMonth);
    if (s.projectionMode !== undefined) setProjectionMode(s.projectionMode);
    if (s.useSeasonality !== undefined) setUseSeasonality(s.useSeasonality);
    if (s.seasonalityDeltas !== undefined) setSeasonalityDeltas(s.seasonalityDeltas);
    if (s.serviceStates !== undefined) {
      // serviceStates from the draft only carries chosenPct/isActive — merge
      // those onto the freshly-loaded service catalogue so name/min/max stay live.
      setServiceStates((prev) =>
        prev.map((p) => {
          const draftRow = s.serviceStates!.find((d) => d.serviceId === p.serviceId);
          return draftRow
            ? { ...p, chosenPct: draftRow.chosenPct, isActive: draftRow.isActive }
            : p;
        })
      );
    }
    setStep(s.step);
    setDraftHydrated(true);
  }

  async function discardDraft() {
    await deleteDraft({ clientId: draftClientId });
    setDraftDismissed(true);
  }
```

- [ ] **Step 3: Render the banner above the wizard**

Right after the `<h1>` heading and before the `{/* Step Indicator */}` comment, add:

```tsx
      {existingDraft && !draftHydrated && !draftDismissed && (
        <div className="rounded-lg border border-accent/40 bg-accent/5 p-4">
          <p className="text-sm">
            Tienes un borrador en curso (último guardado:{" "}
            {new Date(existingDraft.updatedAt).toLocaleString()}). ¿Quieres
            continuar donde lo dejaste o empezar de nuevo?
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={hydrateFromDraft}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-primary hover:bg-accent/90 cursor-pointer"
            >
              Continuar borrador
            </button>
            <button
              onClick={discardDraft}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary cursor-pointer"
            >
              Empezar de nuevo
            </button>
          </div>
        </div>
      )}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(dashboard\)/proyecciones/nueva/page.tsx
git commit -m "feat(wizard): banner to resume or discard existing projection draft

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: Wire wizard — autosave on step transitions

**Files:**
- Modify: `src/app/(dashboard)/proyecciones/nueva/page.tsx`

- [ ] **Step 1: Add the `saveDraft` helper**

After the existing state declarations and before `useEffect`s, add:

```ts
  const saveDraft = useCallback(
    async (nextStep: number, options?: { clearPreClientDraft?: boolean }) => {
      if (!authReady) return;
      try {
        await upsertDraft({
          clientId: draftClientId,
          state: {
            step: nextStep,
            year,
            annualSales,
            totalBudget,
            commissionRate,
            startMonth,
            projectionMode,
            useSeasonality,
            seasonalityDeltas,
            serviceStates: serviceStates.map((s) => ({
              serviceId: s.serviceId,
              chosenPct: s.chosenPct,
              isActive: s.isActive,
            })),
            previousProjectionId: previousProjectionId
              ? (previousProjectionId as Id<"projections">)
              : undefined,
          },
          clearPreClientDraft: options?.clearPreClientDraft,
        });
      } catch (err) {
        // Silent — autosave is best-effort. The user can still submit.
        if (process.env.NODE_ENV !== "production") {
          console.warn("[wizard.autosave] failed", err);
        }
      }
    },
    [
      authReady,
      draftClientId,
      year,
      annualSales,
      totalBudget,
      commissionRate,
      startMonth,
      projectionMode,
      useSeasonality,
      seasonalityDeltas,
      serviceStates,
      previousProjectionId,
      upsertDraft,
    ]
  );
```

Also ensure `useCallback` is imported from React. The existing import is:

```ts
import { Suspense, useState, useEffect, useRef, useMemo } from "react";
```

Replace with:

```ts
import { Suspense, useState, useEffect, useRef, useMemo, useCallback } from "react";
```

- [ ] **Step 2: Wire the helper into navigation buttons**

Find the "Siguiente" button click handler (around line 585):

```tsx
              onClick={() => setStep(step + 1)}
```

Replace with:

```tsx
              onClick={async () => {
                const next = step + 1;
                // If we're leaving Step 0 with a real client picked AND a prior null-slot draft existed,
                // promote it cleanly via clearPreClientDraft.
                const promotingClient =
                  step === 0 && draftClientId !== undefined && existingDraft && existingDraft.clientId === undefined;
                await saveDraft(next, promotingClient ? { clearPreClientDraft: true } : undefined);
                setStep(next);
              }}
```

Find the "Anterior" button (around line 574):

```tsx
          onClick={() => setStep(Math.max(0, step - 1))}
```

Replace with:

```tsx
          onClick={async () => {
            const prev = Math.max(0, step - 1);
            await saveDraft(prev);
            setStep(prev);
          }}
```

Find the step indicator buttons (around line 230):

```tsx
              onClick={() => i < step && setStep(i)}
```

Replace with:

```tsx
              onClick={async () => {
                if (i < step) {
                  await saveDraft(i);
                  setStep(i);
                }
              }}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/proyecciones/nueva/page.tsx
git commit -m "$(cat <<'EOF'
feat(wizard): autosave draft on step transitions

Persists the wizard state to projectionDrafts when the user clicks
Siguiente, Anterior, or a step indicator. clearPreClientDraft is set on
the Step 0 → Step 1 transition when a client has just been selected, to
clean up the null-slot draft from the same user.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: Wire wizard — delete draft on successful submit

**Files:**
- Modify: `src/app/(dashboard)/proyecciones/nueva/page.tsx` (inside `handleSubmit`, right before `router.push`)

- [ ] **Step 1: Edit `handleSubmit`**

After the post-create `getById` verification succeeds (Task 9 added this), and right before `router.push(...)`, insert:

```ts
      // Clean up the draft now that the projection is real.
      try {
        await deleteDraft({ clientId: draftClientId });
      } catch (_) {
        // Best-effort; if the delete fails the cron / next session can clean it.
      }
```

So the relevant block now reads:

```ts
      if (!verify) {
        setSubmitError(
          "Proyección creada pero no aparece en tu organización. Refresca la página o contacta soporte."
        );
        return;
      }

      try {
        await deleteDraft({ clientId: draftClientId });
      } catch (_) {
        // Best-effort.
      }

      router.push(`/proyecciones/${projId}`);
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Run full test suite as a checkpoint**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/proyecciones/nueva/page.tsx
git commit -m "feat(wizard): delete draft after successful projection create

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4 — Copy fixes

### Task 18: Copy fixes for Step 1 (Tasa de Comisión + Venta vs Presupuesto)

**Files:**
- Modify: `src/app/(dashboard)/proyecciones/nueva/page.tsx`

- [ ] **Step 1: Add helper text for Tasa de Comisión (around lines 287-300)**

Find the `<div className="space-y-2">` block containing the "Tasa de Comisión (%)" `<label>` and `<input>`. Add a `<p>` right after the `</input>` and before the closing `</div>`:

```tsx
                <p className="text-xs text-muted-foreground">
                  Solo aplica a conceptos de comisión, intermediación mercantil
                  o venta por comisión. NO aplica a servicios legales, marketing,
                  RH, etc. (Ejemplo: el rubro inmobiliario suele cobrar 3-5%.)
                </p>
```

- [ ] **Step 2: Add helper text for Venta Anual (around lines 302-313)**

In the `<div className="space-y-2">` block for "Venta Anual Proyectada (MXN)", add after the `<input>`:

```tsx
                <p className="text-xs text-muted-foreground">
                  Lo que factura el cliente al año (referencia para calcular el
                  tope de mercado por servicio).
                </p>
```

- [ ] **Step 3: Add helper text for Presupuesto Total (around lines 314-326)**

In the `<div className="space-y-2">` block for "Presupuesto Total a Contratar (MXN)", add after the `<input>`:

```tsx
                <p className="text-xs text-muted-foreground">
                  Lo que el cliente nos contrata. Se distribuye entre los meses
                  del contrato.
                </p>
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(dashboard\)/proyecciones/nueva/page.tsx
git commit -m "fix(wizard): Step 1 microcopy for tasa, venta, presupuesto

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 19: Copy fix for Step 2 ("Sin estacionalidad" recuadro)

**Files:**
- Modify: `src/app/(dashboard)/proyecciones/nueva/page.tsx`

- [ ] **Step 1: Locate the two recuadros**

The Step 2 has two visually similar recuadros: one when `flags.seasonalityEditable && !useSeasonality` (around lines 365-373) and one when `!flags.seasonalityEditable` (around lines 379-389). Both must be updated.

- [ ] **Step 2: Replace both recuadros**

Replace the first one (lines 365-373):

```tsx
                ) : (
                  <div className="rounded-md bg-secondary/50 p-4 text-center">
                    <p className="text-sm text-muted-foreground">
                      Sin estacionalidad: la venta anual del cliente se reparte
                      uniformemente como {formatCurrency(annualSales / 12)}/mes
                      (referencia para FE — no es la distribución del presupuesto).
                    </p>
                  </div>
                )}
```

with:

```tsx
                ) : (
                  <div className="rounded-md bg-secondary/50 p-4 space-y-2">
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">Sin estacionalidad personalizada.</span>{" "}
                      Tomamos la facturación del cliente ({formatCurrency(annualSales)}) y la repartimos en 12 meses
                      (~{formatCurrency(annualSales / 12)}/mes){" "}
                      <span className="font-medium">solo para calcular los factores de estacionalidad (FE).</span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Esto NO es el monto que se cobra — eso lo define el presupuesto contratado{" "}
                      ({formatCurrency(totalBudget)}) ÷ {monthCount} meses{" "}
                      = ~{formatCurrency(monthCount > 0 ? totalBudget / monthCount : 0)}/mes.
                    </p>
                  </div>
                )}
```

Replace the second one (lines 379-389):

```tsx
            ) : (
              <div className="rounded-md bg-secondary/50 p-4 text-center">
                <p className="text-sm text-muted-foreground">
                  Sin estacionalidad: las ventas se distribuirán uniformemente
                  ({formatCurrency(annualSales / 12)}/mes).
                </p>
                <p className="text-xs text-muted-foreground mt-2 italic">
                  La estacionalidad está configurada por el administrador
                </p>
              </div>
            )}
```

with:

```tsx
            ) : (
              <div className="rounded-md bg-secondary/50 p-4 space-y-2">
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Sin estacionalidad.</span>{" "}
                  Tomamos la facturación del cliente ({formatCurrency(annualSales)}) y la repartimos en 12 meses
                  (~{formatCurrency(annualSales / 12)}/mes){" "}
                  <span className="font-medium">solo para calcular los factores de estacionalidad (FE).</span>
                </p>
                <p className="text-sm text-muted-foreground">
                  Esto NO es el monto que se cobra — eso lo define el presupuesto contratado{" "}
                  ({formatCurrency(totalBudget)}) ÷ {monthCount} meses{" "}
                  = ~{formatCurrency(monthCount > 0 ? totalBudget / monthCount : 0)}/mes.
                </p>
                <p className="text-xs text-muted-foreground italic">
                  La estacionalidad está configurada por el administrador.
                </p>
              </div>
            )}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/proyecciones/nueva/page.tsx
git commit -m "fix(wizard): Step 2 microcopy clarifies FE vs presupuesto

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5 — Manual QA pass

### Task 20: End-to-end manual QA with Catimi-like data

**Files:** None (verification only)

This task does not modify code. It is a checklist for the operator (Christian or partner) before declaring the sub-project done.

- [ ] **Step 1: Start dev servers**

Run in one terminal: `npx convex dev`
Run in another: `npm run dev`

Wait until both are running.

- [ ] **Step 2: Walk through the Bug 1 scenario**

1. Sign in.
2. Create a client "Catimi-QA" with annual revenue 60,000,000.
3. Open `/proyecciones/nueva`.
4. Pick Catimi-QA. Year 2026. Tasa 2%. Venta anual 60,000,000. Presupuesto 10,000,000.
5. Pick fiscal mode, startMonth = Mayo.
6. Confirm the `ProjectionPeriodSelector` reads `Presupuesto contratado: $10,000,000 distribuido en 8 meses (~$1,250,000/mes)`. There is NO "× 8/12" line.
7. Skip seasonality (Step 2).
8. Pick 1 service active with chosenPct = whatever default; complete Step 3.
9. In Step 4 (Revisión), confirm Total asignado = $10,000,000 and each monthly total is $1,250,000.

Mark this task pass only if all assertions hold.

- [ ] **Step 3: Walk through the Bug 2 scenario**

10. Submit the projection ("Crear Proyección").
11. Expect redirect to `/proyecciones/[id]`.
12. Navigate to `/proyecciones`.
13. Confirm "Catimi-QA" appears in the list with the expected presupuesto and status.
14. Hard refresh (Cmd+R) — confirm it still appears.

If it does NOT appear: capture browser DevTools console logs and Convex dashboard rows. The `[projections.create] inserted` log (Task 8) should show what was inserted. Cross-check `orgId` against the JWT claim. Report findings — they will likely surface the root cause (e.g. orgId mismatch, half-baked transaction, etc.) so the fix can land before the demo.

- [ ] **Step 4: Walk through the Bug 3 scenario**

15. Start a new wizard for a different client.
16. Fill Step 1 fully, click Siguiente.
17. Fill Step 2, click Siguiente.
18. Click "Volver" (browser nav or the explicit link), go to `/clientes`.
19. Return to `/proyecciones/nueva`.
20. Confirm the banner appears: *"Tienes un borrador en curso (último guardado: …)."*
21. Click "Continuar borrador". Confirm step state and all field values are restored.
22. Click "Empezar de nuevo" once. Confirm banner disappears and fields are empty.

- [ ] **Step 5: Walk through Copy fix scenarios**

23. Step 1 Tasa de Comisión: confirm the helper "Solo aplica a conceptos de comisión…" text appears under the input.
24. Step 1 Venta Anual: confirm "Lo que factura el cliente al año…" appears.
25. Step 1 Presupuesto: confirm "Lo que el cliente nos contrata…" appears.
26. Step 2 recuadro (no seasonality): confirm both paragraphs render (FE explanation + "esto NO es el monto que se cobra…").

- [ ] **Step 6: Report any failures**

If any of the above fails, file the failure and patch it on top of this plan in a follow-up task, then re-run the full QA.

---

## Self-Review

(Performed inline by the plan author.)

**Spec coverage:**
- § 2 Bug 1 engine/UI → Tasks 2, 5, 6, 7.
- § 2 Bug 1 tests update → Tasks 1, 3, 4.
- § 3 Bug 2 instrumentation → Task 8.
- § 3 Bug 2 defensive guardrails → Task 9.
- § 3 Bug 2 Phase 2 (repro) → captured as a checklist item inside Task 20; deliberately not codifiable.
- § 3 Bug 3 schema → Task 10.
- § 3 Bug 3 mutations + tests → Tasks 11, 12.
- § 3 Bug 3 queries + tests → Tasks 13, 14.
- § 3 Bug 3 wizard wiring → Tasks 15 (banner), 16 (autosave), 17 (cleanup on submit).
- § 4 Copy Fix 1 (Tasa) + Fix 2 (Venta vs Presupuesto) → Task 18.
- § 4 Copy Fix 3 (Step 2 recuadro) → Task 19.
- § 5 Testing strategy → covered by tests authored in Tasks 1, 3, 4, 11, 13 and by Task 20 manual checklist.
- § 6 Risks — instrumentation + defensives address R1; Task 16 implementation handles R2 (the clearPreClientDraft flag is in mutation signature and test); R3 (beforeunload) was deferred at the spec level; R4 is accepted last-write-wins.

**Placeholder scan:** No `TBD`/`TODO`/"implement later"/"add error handling" present.

**Type consistency:**
- `upsertDraft` args: `{ clientId, state, clearPreClientDraft }` — same in mutation Task 12 and tests Task 11.
- `getMyDraft` args: `{ clientId }` — same in query Task 14 and tests Task 13.
- `deleteMyDraft` args: `{ clientId }` — same in mutation Task 12 and tests Task 11.
- `state` validator: defined once via `stateValidator` and reused in `upsertDraft` (Task 12); matches the shape used in tests (Tasks 11, 13).

No inconsistencies found.
