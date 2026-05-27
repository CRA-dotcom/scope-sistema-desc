# Sub-spec 6 — Year-over-year update tier Implementation Plan

> **For agentic workers:** Subagent-driven. Steps use `- [ ]` checkboxes.

**Goal:** Per-subservice `yearOverYearDiscount` (%) that admin opt-in applies when creating projection for client who previously had that subservice. Reduces `annualAmount` at projection creation/edit; engine unchanged.

**Architecture:** Schema field on `subservices`, mutation to set, query to detect "year 2+" eligibility, UI hint + apply button in wizard/matrix.

**Tech Stack:** Convex, Next.js, Tailwind.

**Spec:** `docs/superpowers/specs/2026-05-27-year-over-year-tier-design.md`

**Test baseline:** 941. Target: ≥952.

---

## File Structure

### New files
- `convex/functions/subservices/__tests__/setYearOverYearDiscount.test.ts`
- `convex/functions/subservices/__tests__/getYearOverYearHint.test.ts`

### Modified files
- `convex/schema.ts` — add `yearOverYearDiscount` to `subservices`
- `convex/functions/subservices/mutations.ts` — add `setYearOverYearDiscount`
- `convex/functions/subservices/queries.ts` — add `getYearOverYearHint`
- `src/app/(dashboard)/configuracion/servicios/...` — discount input UI (locate)
- `src/app/(dashboard)/proyecciones/[id]/page.tsx` — chip + apply button

---

## Task 1: Schema add `yearOverYearDiscount`

**Files:** `convex/schema.ts`

- [ ] **Step 1:** In `subservices` table, append:
```ts
    // SS6: % discount for year 2+ tier (admin opt-in via wizard).
    yearOverYearDiscount: v.optional(v.number()),
```

- [ ] **Step 2:** `npx convex dev --once` — verify clean.

- [ ] **Step 3:** Commit:
```bash
git add convex/schema.ts
git commit -m "schema(ss6): add yearOverYearDiscount to subservices"
```

---

## Task 2: `setYearOverYearDiscount` mutation

**Files:**
- Modify: `convex/functions/subservices/mutations.ts`
- Create: `convex/functions/subservices/__tests__/setYearOverYearDiscount.test.ts`

- [ ] **Step 1: Write failing tests**

Create `convex/functions/subservices/__tests__/setYearOverYearDiscount.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

async function seedOrgSubservice(t: ReturnType<typeof setupTest>, orgId: string): Promise<Id<"subservices">> {
  return await t.run(async (ctx) => {
    const parentServiceId = await ctx.db.insert("services", {
      name: "S", isActive: true, createdAt: 0, updatedAt: 0,
    } as any);
    return await ctx.db.insert("subservices", {
      orgId, parentServiceId, name: "Sub", slug: "sub",
      defaultFrequency: "mensual", isDefault: false, sortOrder: 0,
      isActive: true,
      createdAt: 0, updatedAt: 0,
    } as any);
  });
}

async function seedGlobalSubservice(t: ReturnType<typeof setupTest>): Promise<Id<"subservices">> {
  return await t.run(async (ctx) => {
    const parentServiceId = await ctx.db.insert("services", {
      name: "S", isActive: true, createdAt: 0, updatedAt: 0,
    } as any);
    return await ctx.db.insert("subservices", {
      orgId: undefined, parentServiceId, name: "Global", slug: "global",
      defaultFrequency: "mensual", isDefault: false, sortOrder: 0,
      isActive: true,
      createdAt: 0, updatedAt: 0,
    } as any);
  });
}

describe("setYearOverYearDiscount", () => {
  it("admin sets discount=25 on org subservice", async () => {
    const t = setupTest();
    const orgId = "org_1";
    const subserviceId = await seedOrgSubservice(t, orgId);
    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });

    await auth.mutation(api.functions.subservices.mutations.setYearOverYearDiscount, {
      subserviceId, discount: 25,
    });

    await t.run(async (ctx) => {
      const row = await ctx.db.get(subserviceId);
      expect(row?.yearOverYearDiscount).toBe(25);
    });
  });

  it("clears discount by passing undefined", async () => {
    const t = setupTest();
    const orgId = "org_1";
    const subserviceId = await seedOrgSubservice(t, orgId);
    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });

    await auth.mutation(api.functions.subservices.mutations.setYearOverYearDiscount, {
      subserviceId, discount: 25,
    });
    await auth.mutation(api.functions.subservices.mutations.setYearOverYearDiscount, {
      subserviceId,
    });

    await t.run(async (ctx) => {
      const row = await ctx.db.get(subserviceId);
      expect(row?.yearOverYearDiscount).toBeUndefined();
    });
  });

  it("rejects discount < 0", async () => {
    const t = setupTest();
    const orgId = "org_1";
    const subserviceId = await seedOrgSubservice(t, orgId);
    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });

    await expect(
      auth.mutation(api.functions.subservices.mutations.setYearOverYearDiscount, {
        subserviceId, discount: -1,
      })
    ).rejects.toThrow(/0 y 100|discount/i);
  });

  it("rejects discount > 100", async () => {
    const t = setupTest();
    const orgId = "org_1";
    const subserviceId = await seedOrgSubservice(t, orgId);
    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });

    await expect(
      auth.mutation(api.functions.subservices.mutations.setYearOverYearDiscount, {
        subserviceId, discount: 101,
      })
    ).rejects.toThrow(/0 y 100|discount/i);
  });

  it("requires super_admin for global subservices", async () => {
    const t = setupTest();
    const subserviceId = await seedGlobalSubservice(t);
    const auth = t.withIdentity({ orgId: "org_x", orgRole: "org:admin" });

    await expect(
      auth.mutation(api.functions.subservices.mutations.setYearOverYearDiscount, {
        subserviceId, discount: 10,
      })
    ).rejects.toThrow(/super|admin/i);
  });

  it("rejects cross-org access on org subservice", async () => {
    const t = setupTest();
    const subserviceId = await seedOrgSubservice(t, "org_a");
    const auth = t.withIdentity({ orgId: "org_b", orgRole: "org:admin" });

    await expect(
      auth.mutation(api.functions.subservices.mutations.setYearOverYearDiscount, {
        subserviceId, discount: 25,
      })
    ).rejects.toThrow(/no.*org|forbidden/i);
  });
});
```

- [ ] **Step 2:** Run tests, verify fail:
```bash
npx vitest run convex/functions/subservices/__tests__/setYearOverYearDiscount.test.ts
```

- [ ] **Step 3:** Append mutation to `convex/functions/subservices/mutations.ts`:

```ts
import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgId, requireAdmin, requireSuperAdmin } from "../../lib/authHelpers";

/**
 * SS6: Set or clear the year-over-year discount % for a subservice.
 *
 * - Global subservices (orgId === undefined): requires super_admin.
 * - Org subservices: requires requireAdmin + same orgId.
 *
 * Per docs/superpowers/specs/2026-05-27-year-over-year-tier-design.md §6
 */
export const setYearOverYearDiscount = mutation({
  args: {
    subserviceId: v.id("subservices"),
    discount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const sub = await ctx.db.get(args.subserviceId);
    if (!sub) throw new Error("Subservicio no encontrado");

    if (sub.orgId === undefined) {
      await requireSuperAdmin(ctx);
    } else {
      await requireAdmin(ctx);
      const orgId = await getOrgId(ctx);
      if (sub.orgId !== orgId) {
        throw new Error("Subservicio no pertenece al org");
      }
    }

    if (args.discount !== undefined) {
      if (args.discount < 0 || args.discount > 100) {
        throw new Error("discount debe estar entre 0 y 100");
      }
    }

    await ctx.db.patch(args.subserviceId, {
      yearOverYearDiscount: args.discount,
      updatedAt: Date.now(),
    });

    return { ok: true };
  },
});
```

Adapt imports to the existing file pattern (only add missing helpers).

- [ ] **Step 4:** Run tests, verify pass.

- [ ] **Step 5:** Commit:
```bash
git add convex/functions/subservices/mutations.ts convex/functions/subservices/__tests__/setYearOverYearDiscount.test.ts
git commit -m "feat(ss6): setYearOverYearDiscount mutation with validation"
```

---

## Task 3: `getYearOverYearHint` query

**Files:**
- Modify: `convex/functions/subservices/queries.ts`
- Create: `convex/functions/subservices/__tests__/getYearOverYearHint.test.ts`

- [ ] **Step 1: Write failing tests**

Create `convex/functions/subservices/__tests__/getYearOverYearHint.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

async function seed(t: ReturnType<typeof setupTest>) {
  return await t.run(async (ctx) => {
    const orgId = "org_1";
    const parentServiceId = await ctx.db.insert("services", {
      name: "S", isActive: true, createdAt: 0, updatedAt: 0,
    } as any);
    const subserviceId = await ctx.db.insert("subservices", {
      orgId, parentServiceId, name: "Sub", slug: "sub",
      defaultFrequency: "mensual", isDefault: false, sortOrder: 0,
      isActive: true, yearOverYearDiscount: 30,
      createdAt: 0, updatedAt: 0,
    } as any);
    const clientId = await ctx.db.insert("clients", {
      orgId, name: "C", email: "c@c.com",
      rfc: "XXX900101AAA", industry: "Otros", annualRevenue: 0,
      billingFrequency: "mensual", isArchived: false,
      createdAt: 0, updatedAt: 0,
    } as any);
    return { orgId, parentServiceId, subserviceId, clientId };
  });
}

describe("getYearOverYearHint", () => {
  it("returns available=true when client has prior projection with subservicio", async () => {
    const t = setupTest();
    const { orgId, parentServiceId, subserviceId, clientId } = await seed(t);

    await t.run(async (ctx) => {
      const projectionId = await ctx.db.insert("projections", {
        orgId, clientId, name: "P2026", year: 2026, startMonth: 1,
        status: "active", createdAt: 0, updatedAt: 0,
      } as any);
      await ctx.db.insert("projectionServices", {
        orgId, projectionId, serviceId: parentServiceId, subserviceId,
        annualAmount: 30000, weight: 1, isActive: true,
        createdAt: 0, updatedAt: 0,
      } as any);
    });

    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });
    const r = await auth.query(api.functions.subservices.queries.getYearOverYearHint, {
      clientId, subserviceId,
    });
    expect(r.available).toBe(true);
    expect(r.priorProjectionYear).toBe(2026);
    expect(r.discount).toBe(30);
  });

  it("returns available=false when no prior projection", async () => {
    const t = setupTest();
    const { orgId, subserviceId, clientId } = await seed(t);
    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });
    const r = await auth.query(api.functions.subservices.queries.getYearOverYearHint, {
      clientId, subserviceId,
    });
    expect(r.available).toBe(false);
  });

  it("returns available=false when subservice has no discount configured", async () => {
    const t = setupTest();
    const { orgId, parentServiceId, clientId } = await seed(t);

    // Create another subservice WITHOUT a discount
    const noDiscountSub = await t.run(async (ctx) =>
      ctx.db.insert("subservices", {
        orgId, parentServiceId, name: "NoDisc", slug: "nodisc",
        defaultFrequency: "mensual", isDefault: false, sortOrder: 1,
        isActive: true,
        createdAt: 0, updatedAt: 0,
      } as any)
    );

    await t.run(async (ctx) => {
      const projectionId = await ctx.db.insert("projections", {
        orgId, clientId, name: "P2026", year: 2026, startMonth: 1,
        status: "active", createdAt: 0, updatedAt: 0,
      } as any);
      await ctx.db.insert("projectionServices", {
        orgId, projectionId, serviceId: parentServiceId, subserviceId: noDiscountSub,
        annualAmount: 10000, weight: 1, isActive: true,
        createdAt: 0, updatedAt: 0,
      } as any);
    });

    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });
    const r = await auth.query(api.functions.subservices.queries.getYearOverYearHint, {
      clientId, subserviceId: noDiscountSub,
    });
    expect(r.available).toBe(false);
  });

  it("ignores draft projections", async () => {
    const t = setupTest();
    const { orgId, parentServiceId, subserviceId, clientId } = await seed(t);

    await t.run(async (ctx) => {
      const projectionId = await ctx.db.insert("projections", {
        orgId, clientId, name: "P2026", year: 2026, startMonth: 1,
        status: "draft", createdAt: 0, updatedAt: 0,
      } as any);
      await ctx.db.insert("projectionServices", {
        orgId, projectionId, serviceId: parentServiceId, subserviceId,
        annualAmount: 30000, weight: 1, isActive: true,
        createdAt: 0, updatedAt: 0,
      } as any);
    });

    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });
    const r = await auth.query(api.functions.subservices.queries.getYearOverYearHint, {
      clientId, subserviceId,
    });
    expect(r.available).toBe(false);
  });
});
```

- [ ] **Step 2:** Run tests, verify fail.

- [ ] **Step 3:** Add query to `convex/functions/subservices/queries.ts`:

```ts
export const getYearOverYearHint = query({
  args: {
    clientId: v.id("clients"),
    subserviceId: v.id("subservices"),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgId(ctx);
    if (!orgId) return { available: false };

    const sub = await ctx.db.get(args.subserviceId);
    if (!sub) return { available: false };
    if (!sub.yearOverYearDiscount || sub.yearOverYearDiscount === 0) {
      return { available: false };
    }

    // Find prior projections for this client in this org
    const allProjections = await ctx.db
      .query("projections")
      .withIndex("by_orgId", q => q.eq("orgId", orgId))
      .collect();

    const clientProjections = allProjections.filter(
      p => p.clientId === args.clientId && p.status !== "draft"
    );

    for (const proj of clientProjections) {
      const projServices = await ctx.db
        .query("projectionServices")
        .withIndex("by_projectionId", q => q.eq("projectionId", proj._id))
        .collect();

      const hasMatch = projServices.some(ps => ps.subserviceId === args.subserviceId);
      if (hasMatch) {
        return {
          available: true,
          priorProjectionYear: proj.year,
          discount: sub.yearOverYearDiscount,
        };
      }
    }

    return { available: false };
  },
});
```

Adapt imports / requireAuth helpers to existing pattern in the file.

- [ ] **Step 4:** Run tests, verify pass.

- [ ] **Step 5:** Commit:
```bash
git add convex/functions/subservices/queries.ts convex/functions/subservices/__tests__/getYearOverYearHint.test.ts
git commit -m "feat(ss6): getYearOverYearHint query"
```

---

## Task 4: UI — discount input in `/configuracion/servicios` + apply chip in matrix

**Files:**
- Modify: `src/app/(dashboard)/configuracion/servicios/...` (locate config page)
- Modify: `src/app/(dashboard)/proyecciones/[id]/page.tsx`

- [ ] **Step 1: Config UI**

Locate `/configuracion/servicios` page (search for subservice listing). For each subservice row, add a small numeric input "Descuento año 2+ (%)":

```tsx
<input
  type="number"
  min={0}
  max={100}
  value={sub.yearOverYearDiscount ?? ""}
  placeholder="—"
  onBlur={async (e) => {
    const raw = e.target.value.trim();
    const discount = raw === "" ? undefined : Number(raw);
    await setYearOverYearDiscount({ subserviceId: sub._id, discount });
  }}
  className="w-16 rounded border px-1 py-0.5 text-sm text-right"
/>
```

Wire `useMutation(api.functions.subservices.mutations.setYearOverYearDiscount)`.

- [ ] **Step 2: Matrix UI chip + apply**

In `src/app/(dashboard)/proyecciones/[id]/page.tsx`, for each `projectionService` row, call `getYearOverYearHint({ clientId, subserviceId })` (or batch fetch upfront). If `hint.available`:

```tsx
<div className="inline-flex items-center gap-1">
  <span className="rounded bg-blue-500/10 px-2 py-0.5 text-xs text-blue-400">
    Año 2+: -{hint.discount}% disponible
  </span>
  <button
    onClick={async () => {
      const newAmount = row.annualAmount * (1 - hint.discount / 100);
      await updateProjectionServiceAmount({
        projServiceId: row._id,
        annualAmount: newAmount,
      });
    }}
    className="text-xs text-blue-500 underline"
  >
    Aplicar
  </button>
</div>
```

(Use whatever the existing mutation name is for updating `annualAmount` on a `projectionServices` row. Probably `updateAnnualAmount` or similar — search the existing mutations.)

- [ ] **Step 3:** TS clean check.

- [ ] **Step 4:** Commit:
```bash
git add src/app/\(dashboard\)/configuracion/servicios "src/app/(dashboard)/proyecciones/[id]/page.tsx"
git commit -m "feat(ss6): config UI + matrix chip for year-over-year discount"
```

---

## Task 5: Smoke + handoff

- [ ] Run `npm test 2>&1 | tail -3` — expect ≥952.
- [ ] Run `npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -5` — clean.
- [ ] Update `Handoff.md` with SS6 closure.
- [ ] Commit `docs(handoff): SS6 year-over-year tier complete`.

---

## Self-Review

Spec coverage:
- §4 schema → T1 ✓
- §5 detection logic → T3 (query) ✓
- §6 mutation → T2 ✓
- §7 UI → T4 ✓
- §9 testing → T2+T3 ✓

No placeholders. Type consistency OK.
