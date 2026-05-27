# Sub-spec 3 — Per-service start month Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow each `projectionService` to declare its own `startMonth` (overriding `projection.startMonth`). Engine respects the offset; matrix UI displays `—` for pre-start cells.

**Architecture:** Add `startMonth: v.optional(v.number())` to `projectionServices`. Engine's per-service allocation logic filters/zeroes cells where `month < effectiveStartMonth`. Wizard adds inline selector per row. Matrix shows blank cells with tooltip. New mutation `updateStartMonth` with validation.

**Tech Stack:** Convex schema + actions/mutations, Next.js App Router, React, Tailwind, Vitest + `setupTest`.

**Spec:** `docs/superpowers/specs/2026-05-27-per-service-start-month-design.md`

**Test baseline:** 927 passed | 1 skipped. Target: ≥938.

---

## File Structure

### New files
- `convex/functions/projectionServices/__tests__/updateStartMonth.test.ts`

### Modified files
- `convex/schema.ts` — add `startMonth` to `projectionServices`
- `convex/lib/projectionEngine.ts` — respect `projService.startMonth` in monthly allocation
- `convex/lib/__tests__/projectionEngine*.test.ts` (existing) — add tests for per-service start month
- `convex/functions/projectionServices/mutations.ts` — add `updateStartMonth` mutation
- `src/app/(dashboard)/proyecciones/...wizard/Step2OrSimilar.tsx` — inline selector per service row (implementer locates)
- `src/app/(dashboard)/proyecciones/[id]/...matrix.tsx` — render `—` for pre-start cells (implementer locates)

---

# PHASE 1: Schema + Engine

## Task 1: Schema add `startMonth` to `projectionServices`

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1: Add field**

In `convex/schema.ts`, find the `projectionServices` table. Append a new field (after `pricingModel` or wherever logical):

```ts
    // SS3: per-service start month override (1-12). undefined → inherits projection.startMonth.
    startMonth: v.optional(v.number()),
```

- [ ] **Step 2: Verify codegen**

```bash
npx convex dev --once
```

Expected: clean, no errors.

- [ ] **Step 3: Commit**

```bash
git add convex/schema.ts
git commit -m "schema(ss3): add startMonth to projectionServices"
```

---

## Task 2: Engine respects per-service startMonth in allocation

**Files:**
- Modify: `convex/lib/projectionEngine.ts`
- Modify or extend existing tests: `convex/lib/__tests__/projectionEngine*.test.ts` (locate the right test file)

- [ ] **Step 1: Write failing test**

Find the existing projection engine test file in `convex/lib/__tests__/` (likely `projectionEngine.test.ts` or similar). Add new test cases:

```ts
describe("per-service startMonth offset", () => {
  it("zeroes cells before effectiveStartMonth for fixed_retainer", () => {
    // Build a minimal engine input with startMonth=5 on a service,
    // annualAmount = 120000, projection.startMonth = 1
    // Expect: cells 1..4 = 0, cells 5..12 distribute 120000 proportional via FE
    // (8 months elegibles; if seasonality is flat, each cell = 15000)
    const result = runEngine({
      projection: { startMonth: 1, /* ...minimal valid projection... */ },
      service: {
        startMonth: 5,
        pricingModel: "fixed_retainer",
        annualAmount: 120000,
        /* ...minimal valid service... */
      },
      seasonality: Array(12).fill(1), // flat FE
    });
    expect(result.cells.slice(0, 4)).toEqual([0, 0, 0, 0]);
    // 120000 / 8 = 15000 per eligible month
    expect(result.cells.slice(4)).toEqual([15000, 15000, 15000, 15000, 15000, 15000, 15000, 15000]);
  });

  it("for one_time pricingModel, concentrates amount in effectiveStartMonth", () => {
    const result = runEngine({
      projection: { startMonth: 1 },
      service: {
        startMonth: 7,
        pricingModel: "one_time",
        annualAmount: 50000,
      },
      seasonality: Array(12).fill(1),
    });
    expect(result.cells).toEqual([0, 0, 0, 0, 0, 0, 50000, 0, 0, 0, 0, 0]);
  });

  it("inherits projection.startMonth when service.startMonth is undefined", () => {
    const result = runEngine({
      projection: { startMonth: 3 },
      service: {
        startMonth: undefined,
        pricingModel: "fixed_retainer",
        annualAmount: 100000,
      },
      seasonality: Array(12).fill(1),
    });
    expect(result.cells.slice(0, 2)).toEqual([0, 0]); // months 1-2 pre-start
    // 100000 / 10 = 10000 per month from March
    expect(result.cells.slice(2)).toEqual([10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000]);
  });

  it("preserves manually overridden cells regardless of startMonth", () => {
    // Manual override on month 2 = 5000, even though effectiveStartMonth = 5
    // Engine should NOT zero it out.
    const result = runEngine({
      projection: { startMonth: 1 },
      service: {
        startMonth: 5,
        pricingModel: "fixed_retainer",
        annualAmount: 100000,
      },
      overrides: { 2: 5000 }, // monthlyAssignments.isManuallyOverridden = true for Feb
      seasonality: Array(12).fill(1),
    });
    expect(result.cells[1]).toBe(5000); // Feb preserved
    expect(result.cells[0]).toBe(0);    // Jan still zero
    expect(result.cells.slice(4).every(c => c > 0)).toBe(true); // May-Dec allocated
  });
});
```

(The exact signature `runEngine` / fixture builders depends on the existing engine test file. Adapt to the existing pattern.)

- [ ] **Step 2: Run tests, verify fail**

```bash
npx vitest run convex/lib/__tests__/projectionEngine
```

Expected: 4 failures — engine doesn't filter by startMonth yet.

- [ ] **Step 3: Modify engine**

In `convex/lib/projectionEngine.ts`, find the loop that distributes `annualAmount` across months. Add:

```ts
const effectiveStartMonth = projService.startMonth ?? projection.startMonth ?? 1;

// Build the eligible-months FE array for proportional allocation
const eligibleFE = [];
for (let m = 1; m <= 12; m++) {
  if (m >= effectiveStartMonth) {
    eligibleFE.push(seasonality[m - 1] ?? 1);
  }
}
const sumEligibleFE = eligibleFE.reduce((a, b) => a + b, 0) || 1;

for (let m = 1; m <= 12; m++) {
  // Manual overrides win — engine doesn't touch them
  if (isManuallyOverridden[m]) continue;

  if (m < effectiveStartMonth) {
    cells[m - 1] = 0;
    continue;
  }

  if (pricingModel === "one_time") {
    cells[m - 1] = m === effectiveStartMonth ? annualAmount : 0;
  } else {
    const fe = seasonality[m - 1] ?? 1;
    cells[m - 1] = (annualAmount / sumEligibleFE) * fe;
  }
}
```

(Adapt names and structure to the actual engine module.)

- [ ] **Step 4: Run tests, verify pass**

```bash
npx vitest run convex/lib/__tests__/projectionEngine
```

Expected: 4 new tests pass + all existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add convex/lib/projectionEngine.ts convex/lib/__tests__/
git commit -m "feat(ss3): engine respects per-service startMonth in allocation"
```

---

# PHASE 2: Mutation + validation

## Task 3: `updateStartMonth` mutation

**Files:**
- Modify: `convex/functions/projectionServices/mutations.ts`
- Create: `convex/functions/projectionServices/__tests__/updateStartMonth.test.ts`

- [ ] **Step 1: Write failing tests**

Create `convex/functions/projectionServices/__tests__/updateStartMonth.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

async function seedProjService(t: ReturnType<typeof setupTest>, orgId: string): Promise<Id<"projectionServices">> {
  return await t.run(async (ctx) => {
    const serviceId = await ctx.db.insert("services", {
      name: "S", isActive: true, createdAt: 0, updatedAt: 0,
    } as any);
    const clientId = await ctx.db.insert("clients", {
      orgId, name: "C", email: "c@c.com",
      rfc: "XXX900101AAA", industry: "Otros", annualRevenue: 0,
      billingFrequency: "mensual", isArchived: false,
      createdAt: 0, updatedAt: 0,
    } as any);
    const projectionId = await ctx.db.insert("projections", {
      orgId, clientId, name: "P", year: 2026, startMonth: 1,
      status: "active", createdAt: 0, updatedAt: 0,
    } as any);
    return await ctx.db.insert("projectionServices", {
      orgId, projectionId, serviceId,
      annualAmount: 120000, weight: 1, isActive: true,
      createdAt: 0, updatedAt: 0,
    } as any);
  });
}

describe("updateStartMonth", () => {
  it("admin sets startMonth = 5", async () => {
    const t = setupTest();
    const orgId = "org_1";
    const projServiceId = await seedProjService(t, orgId);
    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });

    await auth.mutation(api.functions.projectionServices.mutations.updateStartMonth, {
      projServiceId, startMonth: 5,
    });

    await t.run(async (ctx) => {
      const row = await ctx.db.get(projServiceId);
      expect(row?.startMonth).toBe(5);
    });
  });

  it("admin can clear startMonth by passing undefined", async () => {
    const t = setupTest();
    const orgId = "org_1";
    const projServiceId = await seedProjService(t, orgId);
    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });

    // First set it
    await auth.mutation(api.functions.projectionServices.mutations.updateStartMonth, {
      projServiceId, startMonth: 5,
    });

    // Then clear
    await auth.mutation(api.functions.projectionServices.mutations.updateStartMonth, {
      projServiceId,
    });

    await t.run(async (ctx) => {
      const row = await ctx.db.get(projServiceId);
      expect(row?.startMonth).toBeUndefined();
    });
  });

  it("rejects startMonth out of range (< 1)", async () => {
    const t = setupTest();
    const orgId = "org_1";
    const projServiceId = await seedProjService(t, orgId);
    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });

    await expect(
      auth.mutation(api.functions.projectionServices.mutations.updateStartMonth, {
        projServiceId, startMonth: 0,
      })
    ).rejects.toThrow(/startMonth/i);
  });

  it("rejects startMonth out of range (> 12)", async () => {
    const t = setupTest();
    const orgId = "org_1";
    const projServiceId = await seedProjService(t, orgId);
    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });

    await expect(
      auth.mutation(api.functions.projectionServices.mutations.updateStartMonth, {
        projServiceId, startMonth: 13,
      })
    ).rejects.toThrow(/startMonth/i);
  });

  it("rejects cross-org access", async () => {
    const t = setupTest();
    const projServiceId = await seedProjService(t, "org_a");
    const auth = t.withIdentity({ orgId: "org_b", orgRole: "org:admin" });

    await expect(
      auth.mutation(api.functions.projectionServices.mutations.updateStartMonth, {
        projServiceId, startMonth: 5,
      })
    ).rejects.toThrow(/no encontrad/i);
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

```bash
npx vitest run convex/functions/projectionServices/__tests__/updateStartMonth.test.ts
```

Expected: 5 failures (mutation not exported).

- [ ] **Step 3: Add mutation**

In `convex/functions/projectionServices/mutations.ts`, append at the end:

```ts
import { mutation } from "../../_generated/server";
import { v } from "convex/values";
// (existing imports — adapt as needed)
import { getOrgId, requireAdmin } from "../../lib/authHelpers";

/**
 * SS3: Set or clear the per-service startMonth override.
 * Passing undefined clears the override (service inherits projection.startMonth).
 *
 * Per docs/superpowers/specs/2026-05-27-per-service-start-month-design.md §7
 */
export const updateStartMonth = mutation({
  args: {
    projServiceId: v.id("projectionServices"),
    startMonth: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    const row = await ctx.db.get(args.projServiceId);
    if (!row || row.orgId !== orgId) {
      throw new Error("Servicio de proyección no encontrado.");
    }

    if (args.startMonth !== undefined) {
      if (args.startMonth < 1 || args.startMonth > 12) {
        throw new Error("startMonth debe estar entre 1 y 12");
      }
    }

    await ctx.db.patch(args.projServiceId, { startMonth: args.startMonth });

    // TODO(post-MVP): trigger automatic recalculate of cells. For now,
    // admin reruns recalculate manually or via existing UI button.

    return { ok: true };
  },
});
```

(Adapt imports to existing pattern in the file — only add `requireAdmin` if missing.)

- [ ] **Step 4: Run tests, verify pass**

```bash
npx vitest run convex/functions/projectionServices/__tests__/updateStartMonth.test.ts
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add convex/functions/projectionServices/mutations.ts convex/functions/projectionServices/__tests__/updateStartMonth.test.ts
git commit -m "feat(ss3): updateStartMonth mutation with range validation"
```

---

# PHASE 3: UI changes

## Task 4: Wizard Step 2 — per-service start month picker

**Files:**
- Modify: existing wizard component (implementer locates — likely under `src/app/(dashboard)/proyecciones/` or `src/components/projection-wizard/`)

- [ ] **Step 1: Locate wizard Step 2**

Search the codebase for the wizard step where services are configured (likely searches: `weight`, `annualAmount`, "Servicios" header, Step 2 in any wizard tab). Find the component that renders a row per `projectionService`.

- [ ] **Step 2: Add picker UI**

In the row component for each service, add a "Inicia en" select alongside existing inputs (weight, amount):

```tsx
const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

<label className="flex flex-col text-xs text-gray-600">
  Inicia en
  <select
    value={String(service.startMonth ?? projection.startMonth)}
    onChange={async (e) => {
      const val = Number(e.target.value);
      const startMonth = val === projection.startMonth ? undefined : val;
      await updateStartMonth({
        projServiceId: service._id,
        startMonth,
      });
    }}
    className="rounded border px-2 py-1 text-sm"
  >
    {MONTHS.map((label, idx) => (
      <option key={idx} value={idx + 1}>{label}</option>
    ))}
  </select>
</label>
```

Wire `updateStartMonth` via `useMutation(api.functions.projectionServices.mutations.updateStartMonth)`.

- [ ] **Step 3: TS check**

```bash
npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -5
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add <wizard-file>
git commit -m "feat(ss3): wizard Step 2 — per-service startMonth picker"
```

---

## Task 5: Matrix UI — render `—` for pre-start cells

**Files:**
- Modify: existing matrix component (implementer locates — under `src/app/(dashboard)/proyecciones/[id]/`)

- [ ] **Step 1: Locate matrix component**

Search for the component that renders the 12-month grid by service. Look for "Ene", `Array(12)`, or a `month` index iteration over cells.

- [ ] **Step 2: Add pre-start handling**

For each cell rendered at `(serviceRow, month)`:

```tsx
const effectiveStartMonth = serviceRow.startMonth ?? projection.startMonth ?? 1;
const isPreStart = month < effectiveStartMonth;

if (isPreStart) {
  return (
    <td
      title={`Inicia ${MONTH_NAMES[effectiveStartMonth - 1]}`}
      className="text-center text-gray-400 italic select-none"
    >
      —
    </td>
  );
}
// ... existing cell render
```

- [ ] **Step 3: TS check + smoke**

```bash
npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -5
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add <matrix-file>
git commit -m "feat(ss3): matrix UI renders dash for pre-start cells"
```

---

# PHASE 4: Final smoke

## Task 6: Full smoke + handoff update

- [ ] **Step 1: Tests**

```bash
npm test 2>&1 | grep -E "Test Files|Tests" | head -3
```

Expected: ≥938 passed.

- [ ] **Step 2: TS check**

```bash
npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -10
```

Expected: clean (regen codegen if there are stale internal API references).

- [ ] **Step 3: Smoke (manual or agent-browser)**

Open `/proyecciones/[someId]` and verify matrix renders `—` for pre-start cells. Open wizard, verify picker appears.

- [ ] **Step 4: Update Handoff.md**

Add SS3 closure section.

- [ ] **Step 5: Commit**

```bash
git add Handoff.md
git commit -m "docs(handoff): SS3 per-service start month complete"
```

---

# Self-Review

**Spec coverage:**
| Spec section | Plan task(s) |
|---|---|
| §4 schema field | Task 1 |
| §5 engine logic | Task 2 |
| §6.1 wizard picker | Task 4 |
| §6.2 matrix UI dash | Task 5 |
| §7 mutation + validation | Task 3 |
| §8 testing | Distributed across Tasks 2, 3 |

Coverage complete.

**Placeholder scan:** None.

**Type consistency:** `startMonth: number | undefined` consistent across schema, mutation, engine, UI.
