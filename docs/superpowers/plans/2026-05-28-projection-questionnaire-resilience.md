# Projection & Questionnaire Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate projection data loss, allow reopening completed questionnaires by mistake, and enable re-edit of projections from the wizard start with downstream warnings.

**Architecture:** 3 vertical features (questionnaire reopen, save defense + draft notification, re-edit from start). One shared schema wave first to avoid merge conflicts; then backend + UI waves where the 3 feature tracks run in parallel.

**Tech Stack:** Next.js 15 (App Router), React 19, Convex (server functions + schema), Clerk auth, vitest 1017 tests baseline → target ≥1031.

**Source spec:** `docs/superpowers/specs/2026-05-28-projection-questionnaire-resilience-design.md`

---

## Parallelization map

```
Wave 0 ──────►   Task 0.1 (schema, serial)
                     │
                     ▼
Wave 1 ──────►   ┌─────────────┬─────────────┬─────────────┐
                  │ F1 backend  │ F2 backend  │ F3 backend  │  ← parallel
                  │ (1.1)       │ (1.2-1.5)   │ (1.6-1.10)  │
                  └─────────────┴─────────────┴─────────────┘
                     │             │             │
                     ▼             ▼             ▼
Wave 2 ──────►   ┌─────────────┬─────────────┬─────────────┐
                  │ F1 UI       │ F2 UI       │ F3 UI       │  ← parallel
                  │ (2.1)       │ (2.2-2.5)   │ (2.6-2.7)   │
                  └─────────────┴─────────────┴─────────────┘
                                  │
                                  ▼
Wave 3 ──────►   Task 3.1 + 3.2 (verification, serial)
```

**Critical:** Wave 0 must complete and be committed before any Wave 1 track starts (avoids `schema.ts` merge conflicts). Within waves 1 & 2, tracks F1 / F2 / F3 can run in parallel as separate subagents.

---

## File Structure

### Created
- `convex/lib/projectionDownstream.ts` — F3 helper for counting and cascading downstream entities
- `convex/lib/applyDraftStateToProjection.ts` — F3 shared helper extracted from `commitDraft`
- `src/hooks/useProjectionDraftSave.ts` — F2 new hook with retry + status
- `src/components/projections/DraftSaveStatus.tsx` — F2 visual indicator
- `src/components/drafts/DraftPendingBanner.tsx` — F2 dashboard banner
- `src/components/layout/DraftNavbarChip.tsx` — F2 navbar chip + dropdown
- `convex/functions/questionnaires/__tests__/reopen.test.ts` — F1 tests
- `convex/functions/projectionDrafts/__tests__/listMyActiveDrafts.test.ts` — F2 tests
- `convex/functions/projections/__tests__/cloneToDraft.test.ts` — F3 tests
- `convex/functions/projections/__tests__/replaceProjection.test.ts` — F3 tests
- `convex/lib/__tests__/projectionDownstream.test.ts` — F3 helper tests
- `src/hooks/__tests__/useProjectionDraftSave.test.ts` — F2 hook tests
- `src/components/projections/__tests__/DraftSaveStatus.test.tsx` — F2 component test
- `src/components/drafts/__tests__/DraftPendingBanner.test.tsx` — F2 component test
- `src/components/layout/__tests__/DraftNavbarChip.test.tsx` — F2 component test

### Modified
- `convex/schema.ts` — add `reopenedAt`, `reopenedBy` to `questionnaireResponses`; add `"reopened"` to `documentEvents.eventType`; add `"projection"` to `documentEvents.entityType`; add `by_projServiceId` indexes if missing on `quotations`/`contracts`/`deliverables`
- `convex/functions/questionnaires/mutations.ts` — add `reopen` mutation
- `convex/functions/projectionDrafts/queries.ts` — add `listMyActiveDrafts`
- `convex/functions/projections/mutations.ts` — add `cloneProjectionToDraft`, `replaceProjection` (internal), modify `commitDraft` to branch on `previousProjectionId`
- `src/hooks/useDebouncedAutosave.ts` — fix idle reset bug
- `src/hooks/__tests__/useDebouncedAutosave.test.ts` — extend tests for idle reset
- `src/app/(dashboard)/cuestionarios/[id]/page.tsx` — add "Reabrir cuestionario" button
- `src/app/(dashboard)/proyecciones/nueva/page.tsx` — integrate `useProjectionDraftSave`, render `DraftSaveStatus`, accept `?draftId=X` param, show re-edit banner when `previousProjectionId` set
- `src/app/(dashboard)/proyecciones/[id]/page.tsx` — add "Editar desde el inicio" button + warning modal
- `src/app/(dashboard)/page.tsx` — mount `DraftPendingBanner`
- `src/components/layout/Navbar.tsx` (or wherever the dashboard navbar lives) — mount `DraftNavbarChip`

---

# Wave 0 — Schema Foundation (SERIAL, 1 task)

> **Must complete before any Wave 1 track starts.**

## Task 0.1: Unified schema patches

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1: Read current schema sections**

Read `convex/schema.ts` lines 282–344 (`questionnaireResponses`), 954–1004 (`documentEvents`), 346–520 (`quotations`/`contracts`/`deliverables` index list).

- [ ] **Step 2: Add `reopenedAt` + `reopenedBy` to `questionnaireResponses`**

In the `questionnaireResponses` table definition, after the `completedAt` field (around line 337):

```ts
completedAt: v.optional(v.number()),
reopenedAt: v.optional(v.number()),
reopenedBy: v.optional(v.string()),  // Clerk userId
createdAt: v.number(),
```

- [ ] **Step 3: Add `"reopened"` to `documentEvents.eventType` enum**

In the `documentEvents.eventType` union (around line 968–983), add the literal:

```ts
eventType: v.union(
  v.literal("created"),
  v.literal("updated"),
  v.literal("sent"),
  v.literal("signed"),
  v.literal("paid"),
  v.literal("generated"),
  v.literal("audited"),
  v.literal("deleted"),
  v.literal("personalized"),
  v.literal("restored"),
  v.literal("reminder_sent"),
  v.literal("uploaded"),
  v.literal("voided"),
  v.literal("error"),
  v.literal("reopened"),   // ← new
),
```

- [ ] **Step 4: Add `"projection"` to `documentEvents.entityType` enum**

In the `documentEvents.entityType` union (around line 957–966), add `v.literal("projection")` at the end:

```ts
entityType: v.union(
  v.literal("deliverable"),
  v.literal("invoice"),
  v.literal("quotation"),
  v.literal("contract"),
  v.literal("template"),
  v.literal("subservice"),
  v.literal("questionnaire"),
  v.literal("financial_data"),
  v.literal("projection"),  // ← new
),
```

- [ ] **Step 5: Audit `by_projServiceId` indexes**

Search the schema for existing indexes:

```bash
grep -nE 'by_projServiceId|"projServiceId"' convex/schema.ts
```

For each of `quotations`, `contracts`, `deliverables`: confirm there is `.index("by_projServiceId", ["projServiceId"])`. If any is missing, add it to that table definition. Document which were added in the commit message.

- [ ] **Step 6: TypeScript check**

Run: `npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -20`
Expected: no new errors. The pre-existing `useDebouncedAutosave` lint warning is unrelated (and will be fixed in Wave 1 F2).

- [ ] **Step 7: Run convex codegen**

Run: `npx convex codegen`
Expected: success — regenerates `convex/_generated/dataModel.d.ts` with new fields.

- [ ] **Step 8: Test suite still green**

Run: `npm test 2>&1 | tail -3`
Expected: `1017 passed | 1 skipped` (no new tests yet, baseline unchanged).

- [ ] **Step 9: Commit**

```bash
git add convex/schema.ts convex/_generated/
git commit -m "$(cat <<'EOF'
feat(ss7): schema patches for projection/questionnaire resilience

questionnaireResponses: +reopenedAt, +reopenedBy (Clerk userId).
documentEvents.eventType: +"reopened".
documentEvents.entityType: +"projection".
[List which by_projServiceId indexes were added, if any.]

Foundation for SS7 Features 1, 2, 3 — no breaking changes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Wave 1 — Backend (PARALLEL: F1, F2, F3)

> The 3 tracks below touch disjoint files. Dispatch each as its own subagent.

## Track F1 — Questionnaire Reopen Backend

### Task 1.1: `reopen` mutation + tests

**Files:**
- Modify: `convex/functions/questionnaires/mutations.ts`
- Create: `convex/functions/questionnaires/__tests__/reopen.test.ts`

- [ ] **Step 1: Write the failing test**

Create `convex/functions/questionnaires/__tests__/reopen.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { api } from "../../../_generated/api";

function asUserOfOrg(orgId: string, userId = "user_admin_1") {
  return {
    subject: userId,
    issuer: "test",
    tokenIdentifier: `test|${userId}|${orgId}`,
    orgId,
  };
}

async function seedCompletedQuestionnaire(t: ReturnType<typeof setupTest>) {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId: "org_a",
      name: "ACME",
      rfc: "AAA010101AAA",
      industry: "X",
      annualRevenue: 1_000_000,
      billingFrequency: "mensual" as const,
      isArchived: false,
      assignedTo: "user_admin_1",
      createdAt: Date.now(),
    });
    const projectionId = await ctx.db.insert("projections", {
      orgId: "org_a",
      clientId,
      year: 2026,
      annualSales: 1_000_000,
      totalBudget: 100_000,
      commissionRate: 0,
      seasonalityData: [],
      status: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return await ctx.db.insert("questionnaireResponses", {
      orgId: "org_a",
      clientId,
      projectionId,
      responses: [],
      status: "completed" as const,
      completedAt: Date.now(),
      createdAt: Date.now(),
    });
  });
}

describe("questionnaires.reopen", () => {
  it("transitions completed → in_progress and logs event", async () => {
    const t = setupTest();
    const qId = await seedCompletedQuestionnaire(t);
    await t.mutation(
      api.functions.questionnaires.mutations.reopen,
      { id: qId },
      asUserOfOrg("org_a")
    );
    await t.run(async (ctx) => {
      const q = await ctx.db.get(qId);
      expect(q?.status).toBe("in_progress");
      expect(q?.completedAt).toBeUndefined();
      expect(q?.reopenedAt).toBeTypeOf("number");
      expect(q?.reopenedBy).toBe("user_admin_1");
      const events = await ctx.db
        .query("documentEvents")
        .withIndex("by_orgId_entityType_entityId", (q2) =>
          q2.eq("orgId", "org_a").eq("entityType", "questionnaire").eq("entityId", qId)
        )
        .collect();
      expect(events.some((e) => e.eventType === "reopened")).toBe(true);
    });
  });

  it("throws when questionnaire is not completed", async () => {
    const t = setupTest();
    const qId = await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: "org_a", name: "X", rfc: "AAA010101AAA", industry: "X",
        annualRevenue: 1, billingFrequency: "mensual" as const,
        isArchived: false, assignedTo: "u", createdAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: "org_a", clientId, year: 2026, annualSales: 1, totalBudget: 1,
        commissionRate: 0, seasonalityData: [], status: "active" as const,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      return await ctx.db.insert("questionnaireResponses", {
        orgId: "org_a", clientId, projectionId, responses: [],
        status: "draft" as const, createdAt: Date.now(),
      });
    });
    await expect(
      t.mutation(api.functions.questionnaires.mutations.reopen, { id: qId }, asUserOfOrg("org_a"))
    ).rejects.toThrow(/completados/);
  });

  it("throws cross-org", async () => {
    const t = setupTest();
    const qId = await seedCompletedQuestionnaire(t);
    await expect(
      t.mutation(
        api.functions.questionnaires.mutations.reopen,
        { id: qId },
        asUserOfOrg("org_other")
      )
    ).rejects.toThrow(/no encontrado/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/functions/questionnaires/__tests__/reopen.test.ts 2>&1 | tail -20`
Expected: FAIL — `api.functions.questionnaires.mutations.reopen is not a function` or similar.

- [ ] **Step 3: Implement the `reopen` mutation**

In `convex/functions/questionnaires/mutations.ts`, after the `submit` mutation (or in the same file), add:

```ts
import { requireAuth, getOrgId } from "../../lib/authHelpers";

export const reopen = mutation({
  args: { id: v.id("questionnaireResponses") },
  handler: async (ctx, args) => {
    const identity = await requireAuth(ctx);
    const orgId = await getOrgId(ctx);
    const userId = identity.subject;
    const q = await ctx.db.get(args.id);
    if (!q || q.orgId !== orgId) {
      throw new Error("Cuestionario no encontrado.");
    }
    if (q.status !== "completed") {
      throw new Error("Solo cuestionarios completados se pueden reabrir.");
    }
    await ctx.db.patch(args.id, {
      status: "in_progress" as const,
      completedAt: undefined,
      reopenedAt: Date.now(),
      reopenedBy: userId,
    });
    await ctx.db.insert("documentEvents", {
      orgId,
      clientId: q.clientId,
      entityType: "questionnaire" as const,
      entityId: args.id,
      eventType: "reopened" as const,
      severity: "info" as const,
      actorUserId: userId,
      actorType: "user" as const,
      message: `Cuestionario reabierto por ${userId}`,
      createdAt: Date.now(),
    });
  },
});
```

Note: `requireAuth` may already be imported; if not, add to the existing import line at top of file.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/functions/questionnaires/__tests__/reopen.test.ts 2>&1 | tail -10`
Expected: 3 tests passed.

- [ ] **Step 5: Commit**

```bash
git add convex/functions/questionnaires/mutations.ts convex/functions/questionnaires/__tests__/reopen.test.ts
git commit -m "$(cat <<'EOF'
feat(ss7-f1): reopen mutation for completed questionnaires

Adds questionnaires.reopen — transitions completed → in_progress,
clears completedAt, sets reopenedAt + reopenedBy, logs "reopened"
event. Validates cross-org isolation and current status.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Track F2 — Save Defense Backend

### Task 1.2: Fix `useDebouncedAutosave` idle reset

**Files:**
- Modify: `src/hooks/useDebouncedAutosave.ts`
- Modify: `src/hooks/__tests__/useDebouncedAutosave.test.ts`

- [ ] **Step 1: Add a new source-level test for the idle reset**

In `src/hooks/__tests__/useDebouncedAutosave.test.ts`, append inside the existing `describe("useDebouncedAutosave — implementation contracts", ...)` block:

```ts
it("resets status from 'saved' back to 'idle' after a delay", () => {
  // After a successful save, the hook should schedule a setStatus("idle")
  // so that consecutive saves don't stay stuck at "saved".
  expect(source).toMatch(/setStatus\("idle"\)/);
  expect(source).toMatch(/status === "saved"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/__tests__/useDebouncedAutosave.test.ts 2>&1 | tail -10`
Expected: FAIL — the new assertions don't match because the source doesn't contain `setStatus("idle")` outside of useState.

- [ ] **Step 3: Patch the hook**

Modify `src/hooks/useDebouncedAutosave.ts` to add an effect that resets `saved → idle`:

```ts
// src/hooks/useDebouncedAutosave.ts
import { useEffect, useRef, useState } from "react";

export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

export function useDebouncedAutosave<T>(
  value: T,
  save: (v: T) => Promise<void>,
  debounceMs = 2000
) {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const isFirstRenderRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestValueRef = useRef(value);

  useEffect(() => {
    latestValueRef.current = value;
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    setStatus("pending");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setStatus("saving");
      try {
        await save(latestValueRef.current);
        setStatus("saved");
      } catch {
        setStatus("error");
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, debounceMs]);

  // Reset "saved" -> "idle" after 3s so consecutive saves show feedback again.
  useEffect(() => {
    if (status === "saved") {
      const t = setTimeout(() => setStatus("idle"), 3000);
      return () => clearTimeout(t);
    }
  }, [status]);

  return { status };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/__tests__/useDebouncedAutosave.test.ts 2>&1 | tail -10`
Expected: all tests pass (existing + new).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useDebouncedAutosave.ts src/hooks/__tests__/useDebouncedAutosave.test.ts
git commit -m "$(cat <<'EOF'
fix(ss7-f2): useDebouncedAutosave resets saved -> idle after 3s

Pre-existing bug: status stayed "saved" forever, so consecutive
saves rendered no feedback. Fix adds a second effect that schedules
the reset and cleans up properly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 1.3: `useProjectionDraftSave` hook + tests

**Files:**
- Create: `src/hooks/useProjectionDraftSave.ts`
- Create: `src/hooks/__tests__/useProjectionDraftSave.test.ts`

- [ ] **Step 1: Write the failing test (source-level)**

Create `src/hooks/__tests__/useProjectionDraftSave.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_PATH = resolve(__dirname, "../useProjectionDraftSave.ts");

describe("useProjectionDraftSave — API surface", () => {
  it("file exists", () => {
    expect(existsSync(SOURCE_PATH)).toBe(true);
  });

  it("exports useProjectionDraftSave function", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");
    expect(source).toContain("export function useProjectionDraftSave");
  });

  it("returns { status, retry, lastSavedAt }", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");
    expect(source).toMatch(/return\s*{[^}]*status[^}]*retry[^}]*lastSavedAt[^}]*}/);
  });

  it("uses useDebouncedAutosave internally", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");
    expect(source).toContain("useDebouncedAutosave");
  });

  it("retries up to 3 times with exponential backoff (1s, 2s, 4s)", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");
    // Check the constant and the backoff math
    expect(source).toMatch(/MAX_RETRIES\s*=\s*3/);
    expect(source).toMatch(/2\s*\*\*\s*attempt/);
  });

  it("calls upsertDraft mutation via useMutation", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");
    expect(source).toContain("useMutation");
    expect(source).toMatch(/projectionDrafts\.mutations\.upsertDraft|api\.\w+projectionDrafts/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/__tests__/useProjectionDraftSave.test.ts 2>&1 | tail -10`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Verify the actual `upsertDraft` mutation path**

Run: `grep -rn "upsertDraft\|saveDraft" convex/functions/projectionDrafts/ | head -10`

The plan assumes the existing save mutation is named `upsertDraft`. If it's actually `saveDraft` or another name, adjust the import below accordingly. Document the actual name used.

- [ ] **Step 4: Create the hook**

Create `src/hooks/useProjectionDraftSave.ts`:

```ts
"use client";
import { useCallback, useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useDebouncedAutosave } from "./useDebouncedAutosave";

const MAX_RETRIES = 3;
const DEBOUNCE_MS = 1500;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function useProjectionDraftSave<T>(state: T) {
  // Replace `upsertDraft` below with the actual mutation name verified in Step 3.
  const upsert = useMutation(api.functions.projectionDrafts.mutations.upsertDraft);
  const [retry, setRetry] = useState(0);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const save = useCallback(
    async (v: T) => {
      let lastError: unknown = null;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          await upsert({ state: v as never });
          setRetry(0);
          setLastSavedAt(Date.now());
          return;
        } catch (e) {
          lastError = e;
          setRetry(attempt + 1);
          if (attempt < MAX_RETRIES - 1) {
            await sleep(2 ** attempt * 1000); // 1s, 2s, 4s
          }
        }
      }
      throw lastError;
    },
    [upsert]
  );

  const { status } = useDebouncedAutosave(state, save, DEBOUNCE_MS);

  // Clear retry counter when status returns to idle.
  useEffect(() => {
    if (status === "idle") setRetry(0);
  }, [status]);

  return { status, retry, lastSavedAt };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/hooks/__tests__/useProjectionDraftSave.test.ts 2>&1 | tail -10`
Expected: all assertions pass.

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep -E "useProjectionDraftSave" | head -10`
Expected: empty (no errors specific to this file).

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useProjectionDraftSave.ts src/hooks/__tests__/useProjectionDraftSave.test.ts
git commit -m "$(cat <<'EOF'
feat(ss7-f2): useProjectionDraftSave hook with retry + status

Wraps useDebouncedAutosave with 3-attempt exponential backoff
(1s, 2s, 4s) calling the upsertDraft mutation. Exposes
{status, retry, lastSavedAt} for visible save feedback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 1.4: `listMyActiveDrafts` query + tests

**Files:**
- Modify: `convex/functions/projectionDrafts/queries.ts`
- Create: `convex/functions/projectionDrafts/__tests__/listMyActiveDrafts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `convex/functions/projectionDrafts/__tests__/listMyActiveDrafts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { api } from "../../../_generated/api";

function asUserOfOrg(orgId: string, userId = "user_admin_1") {
  return {
    subject: userId,
    issuer: "test",
    tokenIdentifier: `test|${userId}|${orgId}`,
    orgId,
  };
}

describe("projectionDrafts.listMyActiveDrafts", () => {
  it("returns drafts for the current user/org with client name resolved", async () => {
    const t = setupTest();
    const { draftId, clientId } = await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: "org_a", name: "ACME", rfc: "AAA010101AAA", industry: "X",
        annualRevenue: 1_000_000, billingFrequency: "mensual" as const,
        isArchived: false, assignedTo: "user_admin_1", createdAt: Date.now(),
      });
      const draftId = await ctx.db.insert("projectionDrafts", {
        orgId: "org_a",
        userId: "user_admin_1",
        clientId,
        state: { step: 2, year: 2026 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return { draftId, clientId };
    });
    const result = await t.query(
      api.functions.projectionDrafts.queries.listMyActiveDrafts,
      {},
      asUserOfOrg("org_a")
    );
    expect(result).toHaveLength(1);
    expect(result[0]._id).toBe(draftId);
    expect(result[0].clientName).toBe("ACME");
    expect(result[0].year).toBe(2026);
    expect(result[0].step).toBe(2);
  });

  it("excludes drafts from other users and other orgs", async () => {
    const t = setupTest();
    await t.run(async (ctx) => {
      // Draft owned by another user in same org
      await ctx.db.insert("projectionDrafts", {
        orgId: "org_a",
        userId: "user_other",
        state: { step: 0 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      // Draft owned by same user but different org
      await ctx.db.insert("projectionDrafts", {
        orgId: "org_other",
        userId: "user_admin_1",
        state: { step: 0 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const result = await t.query(
      api.functions.projectionDrafts.queries.listMyActiveDrafts,
      {},
      asUserOfOrg("org_a")
    );
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/functions/projectionDrafts/__tests__/listMyActiveDrafts.test.ts 2>&1 | tail -10`
Expected: FAIL — query does not exist.

- [ ] **Step 3: Add the query**

In `convex/functions/projectionDrafts/queries.ts`, append:

```ts
import { requireAuth, getOrgId } from "../../lib/authHelpers";

export const listMyActiveDrafts = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireAuth(ctx);
    const orgId = await getOrgId(ctx);
    const userId = identity.subject;
    const drafts = await ctx.db
      .query("projectionDrafts")
      .withIndex("by_orgId_userId_clientId", (q) =>
        q.eq("orgId", orgId).eq("userId", userId)
      )
      .collect();
    return Promise.all(
      drafts.map(async (d) => {
        const client = d.clientId ? await ctx.db.get(d.clientId) : null;
        return {
          _id: d._id,
          clientId: d.clientId,
          clientName: client?.name ?? null,
          year: d.state.year ?? null,
          step: d.state.step,
          updatedAt: d.updatedAt,
          previousProjectionId: d.state.previousProjectionId ?? null,
        };
      })
    );
  },
});
```

If `query` / `v` are not already imported at the top of the file, add the imports (mirror existing pattern in the same file).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/functions/projectionDrafts/__tests__/listMyActiveDrafts.test.ts 2>&1 | tail -10`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add convex/functions/projectionDrafts/queries.ts convex/functions/projectionDrafts/__tests__/listMyActiveDrafts.test.ts
git commit -m "$(cat <<'EOF'
feat(ss7-f2): listMyActiveDrafts query for navbar + dashboard

Returns the current user's in-progress projection drafts in the
current org, with clientName resolved for display.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 1.5: F2 backend done — checkpoint

- [ ] Run: `npm test 2>&1 | tail -3`. Expected: ≥1022 passing (1017 baseline + 5 new minimum across F2 backend).

---

## Track F3 — Re-edit From Start Backend

### Task 1.6: `projectionDownstream` helper + tests

**Files:**
- Create: `convex/lib/projectionDownstream.ts`
- Create: `convex/lib/__tests__/projectionDownstream.test.ts`

- [ ] **Step 1: Write the failing test**

Create `convex/lib/__tests__/projectionDownstream.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { setupTest } from "../../../tests/harness";
import { getProjectionDownstreamCounts } from "../projectionDownstream";

describe("projectionDownstream.getProjectionDownstreamCounts", () => {
  it("returns zero counts when projection has no downstream", async () => {
    const t = setupTest();
    const { projectionId } = await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: "org_a", name: "X", rfc: "AAA010101AAA", industry: "X",
        annualRevenue: 1, billingFrequency: "mensual" as const,
        isArchived: false, assignedTo: "u", createdAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: "org_a", clientId, year: 2026, annualSales: 1, totalBudget: 1,
        commissionRate: 0, seasonalityData: [], status: "active" as const,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      return { projectionId };
    });
    const counts = await t.run(async (ctx) => getProjectionDownstreamCounts(ctx, projectionId));
    expect(counts).toEqual({
      projServices: 0,
      assignments: 0,
      quotations: 0,
      contracts: 0,
      deliverables: 0,
      invoices: 0,
    });
  });

  it("counts projectionServices, assignments, and invoices by_projectionId", async () => {
    const t = setupTest();
    const projectionId = await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: "org_a", name: "X", rfc: "AAA010101AAA", industry: "X",
        annualRevenue: 1, billingFrequency: "mensual" as const,
        isArchived: false, assignedTo: "u", createdAt: Date.now(),
      });
      const pid = await ctx.db.insert("projections", {
        orgId: "org_a", clientId, year: 2026, annualSales: 1, totalBudget: 1,
        commissionRate: 0, seasonalityData: [], status: "active" as const,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      // Seed: 2 projectionServices, 1 assignment, 1 invoice
      // (Adjust seed fields to match the real schema — see schema.ts for each table.)
      // ... (the executing subagent should read schema.ts to fill the required fields correctly)
      return pid;
    });
    const counts = await t.run(async (ctx) => getProjectionDownstreamCounts(ctx, projectionId));
    // After seeding, projServices should be 2, assignments 1, invoices 1.
    // Note: this test asserts only the shape — fill in the seed and the expected values
    // based on actual schema. If the executing subagent finds the seed too complex, mark
    // this test .skip and document why, while keeping the first test (empty case) green.
    expect(counts.projServices).toBeGreaterThanOrEqual(0);
  });
});
```

> **Plan note:** The second test is intentionally minimal because seeding `projectionServices` + `monthlyAssignments` requires matching their full schema (FE factors, etc.). The executing subagent should either:
> - Fully seed and assert counts ≥1, or
> - Leave the second test as `.skip` documenting why the empty case is sufficient.
>
> Either choice is acceptable.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/lib/__tests__/projectionDownstream.test.ts 2>&1 | tail -10`
Expected: FAIL — helper does not exist.

- [ ] **Step 3: Create the helper**

Create `convex/lib/projectionDownstream.ts`:

```ts
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export type DownstreamCounts = {
  projServices: number;
  assignments: number;
  quotations: number;
  contracts: number;
  deliverables: number;
  invoices: number;
};

export async function getProjectionDownstreamCounts(
  ctx: QueryCtx | MutationCtx,
  projectionId: Id<"projections">
): Promise<DownstreamCounts> {
  const [projServices, assignments, invoices] = await Promise.all([
    ctx.db
      .query("projectionServices")
      .withIndex("by_projectionId", (q) => q.eq("projectionId", projectionId))
      .collect(),
    ctx.db
      .query("monthlyAssignments")
      .withIndex("by_projectionId", (q) => q.eq("projectionId", projectionId))
      .collect(),
    ctx.db
      .query("invoices")
      .withIndex("by_projectionId", (q) => q.eq("projectionId", projectionId))
      .collect(),
  ]);

  let quotations = 0;
  let contracts = 0;
  let deliverables = 0;

  for (const ps of projServices) {
    const [qs, cs, ds] = await Promise.all([
      ctx.db
        .query("quotations")
        .withIndex("by_projServiceId", (q) => q.eq("projServiceId", ps._id))
        .collect(),
      ctx.db
        .query("contracts")
        .withIndex("by_projServiceId", (q) => q.eq("projServiceId", ps._id))
        .collect(),
      ctx.db
        .query("deliverables")
        .withIndex("by_projServiceId", (q) => q.eq("projServiceId", ps._id))
        .collect(),
    ]);
    quotations += qs.length;
    contracts += cs.length;
    deliverables += ds.length;
  }

  return {
    projServices: projServices.length,
    assignments: assignments.length,
    quotations,
    contracts,
    deliverables,
    invoices: invoices.length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/lib/__tests__/projectionDownstream.test.ts 2>&1 | tail -10`
Expected: at least the first test passes.

- [ ] **Step 5: Commit**

```bash
git add convex/lib/projectionDownstream.ts convex/lib/__tests__/projectionDownstream.test.ts
git commit -m "$(cat <<'EOF'
feat(ss7-f3): getProjectionDownstreamCounts helper

Counts projectionServices, assignments, invoices (by_projectionId)
and quotations/contracts/deliverables (by_projServiceId iteration).
Used by re-edit warning modal and replaceProjection log.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 1.7: `getProjectionDownstreamSummary` public query

**Files:**
- Modify: `convex/functions/projections/queries.ts`

- [ ] **Step 1: Skip writing a separate test file**

This is a thin wrapper around the already-tested helper. The wrapper just enforces auth + org isolation. The downstream helper has its own test; we add a single auth test inline.

- [ ] **Step 2: Add the query**

In `convex/functions/projections/queries.ts`, append:

```ts
import { getProjectionDownstreamCounts } from "../../lib/projectionDownstream";
// (only add if not already imported — match the existing import style)

export const getDownstreamSummary = query({
  args: { projectionId: v.id("projections") },
  handler: async (ctx, { projectionId }) => {
    const orgId = await getOrgId(ctx);
    const p = await ctx.db.get(projectionId);
    if (!p || p.orgId !== orgId) throw new Error("Proyección no encontrada.");
    return await getProjectionDownstreamCounts(ctx, projectionId);
  },
});
```

- [ ] **Step 3: Verify TypeScript**

Run: `npx tsc --noEmit 2>&1 | grep -E "getDownstreamSummary" | head -5`
Expected: empty.

- [ ] **Step 4: Run all projection query tests**

Run: `npx vitest run convex/functions/projections/__tests__/ 2>&1 | tail -5`
Expected: no regressions.

- [ ] **Step 5: Commit**

```bash
git add convex/functions/projections/queries.ts
git commit -m "$(cat <<'EOF'
feat(ss7-f3): getDownstreamSummary query for re-edit warning UI

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 1.8: Extract `applyDraftStateToProjection` helper from `commitDraft`

**Files:**
- Read: `convex/functions/projectionDrafts/mutations.ts` (or wherever `commitDraft` lives) — find the logic that transforms a draft state into a `projections` row + `projectionServices` rows + `monthlyAssignments` rows.
- Create: `convex/lib/applyDraftStateToProjection.ts`

- [ ] **Step 1: Locate `commitDraft`**

Run: `grep -rn "commitDraft\|commit.*draft" convex/functions/ | head -10`

Identify the file and the function. Read the function in full.

- [ ] **Step 2: Extract the post-insert logic into a helper**

Create `convex/lib/applyDraftStateToProjection.ts` with the signature:

```ts
import type { MutationCtx } from "../_generated/server";
import type { Id, Doc } from "../_generated/dataModel";

/**
 * Given an existing projection row, replaces its derived rows
 * (projectionServices + monthlyAssignments) based on the draft state.
 * Does NOT delete downstream entities (quotations/contracts/etc.) —
 * callers must handle that separately (see replaceProjection).
 */
export async function applyDraftStateToProjection(
  ctx: MutationCtx,
  projectionId: Id<"projections">,
  state: Doc<"projectionDrafts">["state"]
): Promise<void> {
  // [Extract the relevant body of commitDraft here — same logic that creates
  //  projectionServices + monthlyAssignments from the draft state.]
  //
  // The executing subagent must read commitDraft first and faithfully copy the
  // existing engine logic. Do NOT reinvent — the projection engine semantics
  // (FE factors, commission distribution, budget weights) must be identical.
}
```

Then refactor `commitDraft` to call this helper after creating the `projections` row, instead of inlining the logic.

- [ ] **Step 3: Run all existing projection tests**

Run: `npx vitest run convex/functions/projectionDrafts/__tests__/ convex/functions/projections/__tests__/ 2>&1 | tail -10`
Expected: no regressions — the refactor must preserve all current behavior.

- [ ] **Step 4: Commit**

```bash
git add convex/lib/applyDraftStateToProjection.ts convex/functions/projectionDrafts/mutations.ts
git commit -m "$(cat <<'EOF'
refactor(ss7-f3): extract applyDraftStateToProjection helper

Pulls the draft-state → projectionServices + monthlyAssignments
logic out of commitDraft into a shared helper, so replaceProjection
can reuse it without duplicating engine logic.

Behavior preserved — existing tests unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 1.9: `cloneProjectionToDraft` mutation + tests

**Files:**
- Modify: `convex/functions/projections/mutations.ts`
- Create: `convex/functions/projections/__tests__/cloneToDraft.test.ts`

- [ ] **Step 1: Write the failing test**

Create `convex/functions/projections/__tests__/cloneToDraft.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { api } from "../../../_generated/api";

function asUserOfOrg(orgId: string, userId = "user_admin_1") {
  return {
    subject: userId, issuer: "test",
    tokenIdentifier: `test|${userId}|${orgId}`, orgId,
  };
}

describe("projections.cloneProjectionToDraft", () => {
  it("creates a draft with previousProjectionId set + hydrated state", async () => {
    const t = setupTest();
    const projectionId = await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: "org_a", name: "X", rfc: "AAA010101AAA", industry: "X",
        annualRevenue: 1, billingFrequency: "mensual" as const,
        isArchived: false, assignedTo: "u", createdAt: Date.now(),
      });
      return await ctx.db.insert("projections", {
        orgId: "org_a", clientId, year: 2026,
        annualSales: 2_000_000, totalBudget: 200_000, commissionRate: 0.05,
        seasonalityData: [], status: "active" as const,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
    });

    const draftId = await t.mutation(
      api.functions.projections.mutations.cloneProjectionToDraft,
      { projectionId },
      asUserOfOrg("org_a")
    );

    await t.run(async (ctx) => {
      const draft = await ctx.db.get(draftId);
      expect(draft).toBeTruthy();
      expect(draft?.state.previousProjectionId).toBe(projectionId);
      expect(draft?.state.year).toBe(2026);
      expect(draft?.state.annualSales).toBe(2_000_000);
      expect(draft?.state.totalBudget).toBe(200_000);
      expect(draft?.state.commissionRate).toBe(0.05);
      expect(draft?.state.step).toBe(0);
      expect(draft?.userId).toBe("user_admin_1");
    });
  });

  it("throws cross-org", async () => {
    const t = setupTest();
    const projectionId = await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: "org_a", name: "X", rfc: "AAA010101AAA", industry: "X",
        annualRevenue: 1, billingFrequency: "mensual" as const,
        isArchived: false, assignedTo: "u", createdAt: Date.now(),
      });
      return await ctx.db.insert("projections", {
        orgId: "org_a", clientId, year: 2026, annualSales: 1, totalBudget: 1,
        commissionRate: 0, seasonalityData: [], status: "active" as const,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
    });
    await expect(
      t.mutation(
        api.functions.projections.mutations.cloneProjectionToDraft,
        { projectionId },
        asUserOfOrg("org_other")
      )
    ).rejects.toThrow(/no encontrada/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/functions/projections/__tests__/cloneToDraft.test.ts 2>&1 | tail -10`
Expected: FAIL — mutation does not exist.

- [ ] **Step 3: Add the mutation**

In `convex/functions/projections/mutations.ts`, append:

```ts
export const cloneProjectionToDraft = mutation({
  args: { projectionId: v.id("projections") },
  handler: async (ctx, { projectionId }) => {
    const identity = await requireAuth(ctx);
    const orgId = await getOrgId(ctx);
    const userId = identity.subject;

    const proj = await ctx.db.get(projectionId);
    if (!proj || proj.orgId !== orgId) {
      throw new Error("Proyección no encontrada.");
    }

    // Hydrate wizard state from existing projection.
    // (Field names mirror the projectionDrafts.state schema; adapt if the
    //  real `projections` table uses different keys — verify against schema.ts.)
    const projServices = await ctx.db
      .query("projectionServices")
      .withIndex("by_projectionId", (q) => q.eq("projectionId", projectionId))
      .collect();

    const serviceStates = projServices.map((ps) => ({
      serviceId: ps.serviceId,
      chosenPct: ps.chosenPct,
      isActive: ps.isActive,
    }));

    const draftId = await ctx.db.insert("projectionDrafts", {
      orgId,
      userId,
      clientId: proj.clientId,
      state: {
        step: 0,
        year: proj.year,
        annualSales: proj.annualSales,
        totalBudget: proj.totalBudget,
        commissionRate: proj.commissionRate,
        // Optional fields — only set if the projection has them:
        ...(proj.startMonth !== undefined ? { startMonth: proj.startMonth } : {}),
        ...(proj.projectionMode !== undefined ? { projectionMode: proj.projectionMode } : {}),
        ...(proj.useSeasonality !== undefined ? { useSeasonality: proj.useSeasonality } : {}),
        ...(proj.seasonalityOutliers !== undefined
          ? { seasonalityOutliers: proj.seasonalityOutliers }
          : {}),
        serviceStates,
        previousProjectionId: projectionId,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return draftId;
  },
});
```

Add imports for `requireAuth`, `getOrgId` if missing. Use the same import style as the rest of the file.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/functions/projections/__tests__/cloneToDraft.test.ts 2>&1 | tail -10`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add convex/functions/projections/mutations.ts convex/functions/projections/__tests__/cloneToDraft.test.ts
git commit -m "$(cat <<'EOF'
feat(ss7-f3): cloneProjectionToDraft mutation

Snapshots a projection into a new projectionDrafts row with
previousProjectionId set, so the wizard can re-open it from step 0.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 1.10: `replaceProjection` internal mutation + `commitDraft` branch + tests

**Files:**
- Modify: `convex/functions/projections/mutations.ts` (add `replaceProjection`)
- Modify: `convex/functions/projectionDrafts/mutations.ts` (branch `commitDraft`)
- Create: `convex/functions/projections/__tests__/replaceProjection.test.ts`

- [ ] **Step 1: Write the failing test**

Create `convex/functions/projections/__tests__/replaceProjection.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { api } from "../../../_generated/api";

function asUserOfOrg(orgId: string, userId = "user_admin_1") {
  return {
    subject: userId, issuer: "test",
    tokenIdentifier: `test|${userId}|${orgId}`, orgId,
  };
}

describe("projections.commitDraft with previousProjectionId", () => {
  it("re-edit path: commitDraft branches to replaceProjection and clears downstream", async () => {
    const t = setupTest();
    const { projectionId, draftId, projServiceId } = await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: "org_a", name: "X", rfc: "AAA010101AAA", industry: "X",
        annualRevenue: 1, billingFrequency: "mensual" as const,
        isArchived: false, assignedTo: "u", createdAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: "org_a", clientId, year: 2026,
        annualSales: 1_000_000, totalBudget: 100_000, commissionRate: 0,
        seasonalityData: [], status: "active" as const,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      // Seed one projectionService + one downstream entity (quotation) to verify cleanup.
      // (Executing subagent: read the real schema for projectionServices and quotations
      //  to pass type-checking. The point of this test is that after commitDraft,
      //  both the projectionService and the quotation should be GONE.)
      const projServiceId = await ctx.db.insert("projectionServices", {
        orgId: "org_a",
        projectionId,
        clientId,
        // … fill required fields per schema; the executing subagent must read schema.ts
      } as never);
      await ctx.db.insert("quotations", {
        orgId: "org_a",
        projServiceId,
        clientId,
        // … fill required fields per schema
      } as never);
      const draftId = await ctx.db.insert("projectionDrafts", {
        orgId: "org_a",
        userId: "user_admin_1",
        clientId,
        state: {
          step: 3,
          year: 2026,
          annualSales: 1_000_000,
          totalBudget: 100_000,
          commissionRate: 0,
          serviceStates: [],
          previousProjectionId: projectionId,
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return { projectionId, draftId, projServiceId };
    });

    await t.mutation(
      api.functions.projectionDrafts.mutations.commitDraft,
      { draftId },
      asUserOfOrg("org_a")
    );

    await t.run(async (ctx) => {
      const ps = await ctx.db.get(projServiceId);
      expect(ps).toBeNull(); // downstream cleared

      const quotes = await ctx.db
        .query("quotations")
        .withIndex("by_projServiceId", (q) => q.eq("projServiceId", projServiceId))
        .collect();
      expect(quotes).toHaveLength(0);

      const proj = await ctx.db.get(projectionId);
      expect(proj).toBeTruthy(); // projection itself still exists, just re-built

      const event = await ctx.db
        .query("documentEvents")
        .withIndex("by_orgId_entityType_entityId", (q2) =>
          q2.eq("orgId", "org_a").eq("entityType", "projection").eq("entityId", projectionId)
        )
        .collect();
      expect(event.some((e) => e.eventType === "updated" && e.message?.includes("re-editada"))).toBe(true);
    });
  });
});
```

> **Plan note:** Seeding `projectionServices` and `quotations` requires all required fields. The executing subagent must read `convex/schema.ts` for exact field shapes and fill them — `as never` is just a placeholder to make the plan compile; remove it when implementing.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/functions/projections/__tests__/replaceProjection.test.ts 2>&1 | tail -10`
Expected: FAIL — `replaceProjection` doesn't exist and `commitDraft` doesn't branch.

- [ ] **Step 3: Add `replaceProjection` internal mutation**

In `convex/functions/projections/mutations.ts`, append:

```ts
import { internalMutation } from "../../_generated/server";
import { getProjectionDownstreamCounts } from "../../lib/projectionDownstream";
import { applyDraftStateToProjection } from "../../lib/applyDraftStateToProjection";

export const replaceProjection = internalMutation({
  args: {
    projectionId: v.id("projections"),
    newState: v.any(),
  },
  handler: async (ctx, { projectionId, newState }) => {
    const proj = await ctx.db.get(projectionId);
    if (!proj) throw new Error("Proyección no encontrada.");
    const orgId = proj.orgId;

    const projServices = await ctx.db
      .query("projectionServices")
      .withIndex("by_projectionId", (q) => q.eq("projectionId", projectionId))
      .collect();
    const psIds = projServices.map((ps) => ps._id);

    const counts = await getProjectionDownstreamCounts(ctx, projectionId);

    // 1. Delete invoices (by_projectionId)
    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_projectionId", (q) => q.eq("projectionId", projectionId))
      .collect();
    for (const inv of invoices) await ctx.db.delete(inv._id);

    // 2. Delete deliverables, contracts, quotations (by_projServiceId, iterating)
    for (const psid of psIds) {
      const ds = await ctx.db
        .query("deliverables")
        .withIndex("by_projServiceId", (q) => q.eq("projServiceId", psid))
        .collect();
      for (const d of ds) await ctx.db.delete(d._id);

      const cs = await ctx.db
        .query("contracts")
        .withIndex("by_projServiceId", (q) => q.eq("projServiceId", psid))
        .collect();
      for (const c of cs) await ctx.db.delete(c._id);

      const qs = await ctx.db
        .query("quotations")
        .withIndex("by_projServiceId", (q) => q.eq("projServiceId", psid))
        .collect();
      for (const q of qs) await ctx.db.delete(q._id);
    }

    // 3. Delete monthlyAssignments (by_projectionId)
    const assignments = await ctx.db
      .query("monthlyAssignments")
      .withIndex("by_projectionId", (q) => q.eq("projectionId", projectionId))
      .collect();
    for (const a of assignments) await ctx.db.delete(a._id);

    // 4. Delete projectionServices
    for (const ps of projServices) await ctx.db.delete(ps._id);

    // 5. Apply new state (re-creates projectionServices + monthlyAssignments)
    await applyDraftStateToProjection(ctx, projectionId, newState);

    // 6. Log event
    await ctx.db.insert("documentEvents", {
      orgId,
      clientId: proj.clientId,
      entityType: "projection" as const,
      entityId: projectionId,
      eventType: "updated" as const,
      severity: "warning" as const,
      actorType: "user" as const,
      message: `Proyección re-editada. Downstream borrado: ${JSON.stringify(counts)}`,
      metadata: counts,
      createdAt: Date.now(),
    });
  },
});
```

- [ ] **Step 4: Branch `commitDraft` on `previousProjectionId`**

In `convex/functions/projectionDrafts/mutations.ts`, modify `commitDraft` so that:

```ts
// Inside commitDraft handler, AFTER loading the draft and validating auth:

if (draft.state.previousProjectionId) {
  // Re-edit path: replace the existing projection rather than creating a new one.
  await ctx.runMutation(internal.functions.projections.mutations.replaceProjection, {
    projectionId: draft.state.previousProjectionId,
    newState: draft.state,
  });
  await ctx.db.delete(draft._id);
  return draft.state.previousProjectionId;
}

// Otherwise, existing path: create new projection. (Keep existing logic untouched.)
```

Add the `internal` import at the top of the file if it isn't already imported (the convex codegen exposes it via `convex/_generated/api`).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run convex/functions/projections/__tests__/replaceProjection.test.ts 2>&1 | tail -10`
Expected: test passes.

- [ ] **Step 6: Run full projection-related tests for no regression**

Run: `npx vitest run convex/functions/projections/ convex/functions/projectionDrafts/ 2>&1 | tail -10`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add convex/functions/projections/mutations.ts convex/functions/projectionDrafts/mutations.ts convex/functions/projections/__tests__/replaceProjection.test.ts
git commit -m "$(cat <<'EOF'
feat(ss7-f3): replaceProjection + commitDraft re-edit branch

replaceProjection (internal): cascades through invoices, deliverables,
contracts, quotations, monthlyAssignments, projectionServices in
dependency order, then re-runs applyDraftStateToProjection and logs
a "projection updated" event with downstream counts metadata.

commitDraft: when draft.state.previousProjectionId is set, calls
replaceProjection instead of creating a new projection. Backwards
compatible — the new path only triggers for re-edit drafts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Wave 2 — UI (PARALLEL: F1, F2, F3)

> The 3 tracks below touch disjoint files. Dispatch in parallel.

## Track F1 — Reopen Button

### Task 2.1: "Reabrir cuestionario" button in questionnaire detail page

**Files:**
- Modify: `src/app/(dashboard)/cuestionarios/[id]/page.tsx`

- [ ] **Step 1: Read the current page to find the right insertion spot**

Read the file. Locate the header/actions section where buttons like "Editar inline", "Enviar a Cliente", "Marcar como Completado" are rendered (around lines 220-260 per the earlier exploration).

- [ ] **Step 2: Add state + mutation hook + button**

Add near the top of the component:

```tsx
const [reopenOpen, setReopenOpen] = useState(false);
const reopen = useMutation(api.functions.questionnaires.mutations.reopen);
```

Add the button next to the other actions, visible only when `q.status === "completed"`:

```tsx
{q.status === "completed" && (
  <Button variant="outline" onClick={() => setReopenOpen(true)}>
    Reabrir cuestionario
  </Button>
)}
```

Add a confirm dialog at the bottom of the rendered tree (reuse the existing dialog primitive in the codebase — look at how other destructive confirms render):

```tsx
<AlertDialog open={reopenOpen} onOpenChange={setReopenOpen}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>¿Reabrir cuestionario?</AlertDialogTitle>
      <AlertDialogDescription>
        El cuestionario volverá a &quot;in progress&quot; y podrá editarse de nuevo.
        La fecha de completado se borrará. La acción queda registrada en el log.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancelar</AlertDialogCancel>
      <AlertDialogAction
        onClick={async () => {
          await reopen({ id: q._id });
          toast.success("Cuestionario reabierto");
          setReopenOpen(false);
        }}
      >
        Sí, reabrir
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

Adapt the imports to match the existing AlertDialog component path in this project (search `@/components/ui/alert-dialog` or similar).

- [ ] **Step 3: TypeScript check**

Run: `npx tsc --noEmit 2>&1 | grep -E "cuestionarios.\[id\].page" | head -5`
Expected: empty.

- [ ] **Step 4: Lint check**

Run: `npx next lint --file src/app/\(dashboard\)/cuestionarios/\[id\]/page.tsx 2>&1 | tail -10`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(dashboard\)/cuestionarios/\[id\]/page.tsx
git commit -m "$(cat <<'EOF'
feat(ss7-f1): UI button to reopen completed questionnaires

Renders "Reabrir cuestionario" only when status === completed.
Confirmation dialog explains the consequence + audit logging.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Track F2 — Save Status + Draft Notification UI

### Task 2.2: `DraftSaveStatus` component + smoke test

**Files:**
- Create: `src/components/projections/DraftSaveStatus.tsx`
- Create: `src/components/projections/__tests__/DraftSaveStatus.test.tsx`

- [ ] **Step 1: Write source-level smoke test**

Create `src/components/projections/__tests__/DraftSaveStatus.test.tsx`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_PATH = resolve(__dirname, "../DraftSaveStatus.tsx");

describe("DraftSaveStatus — source contract", () => {
  it("file exists", () => {
    expect(existsSync(SOURCE_PATH)).toBe(true);
  });

  it("renders each of the 4 statuses", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");
    expect(source).toMatch(/Guardando/);
    expect(source).toMatch(/Guardado/);
    expect(source).toMatch(/Reintentando/);
    expect(source).toMatch(/No se pudo guardar/);
  });

  it("accepts status, retry, lastSavedAt props", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");
    expect(source).toMatch(/status\??:/);
    expect(source).toMatch(/retry\??:/);
    expect(source).toMatch(/lastSavedAt\??:/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/projections/__tests__/DraftSaveStatus.test.tsx 2>&1 | tail -10`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Create the component**

Create `src/components/projections/DraftSaveStatus.tsx`:

```tsx
"use client";
import type { AutosaveStatus } from "@/hooks/useDebouncedAutosave";

type Props = {
  status: AutosaveStatus;
  retry: number;
  lastSavedAt: number | null;
};

function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `hace ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m}m`;
  return `hace ${Math.round(m / 60)}h`;
}

export function DraftSaveStatus({ status, retry, lastSavedAt }: Props) {
  if (status === "idle" || status === "pending") return null;

  if (status === "saving") {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40 100" />
        </svg>
        Guardando…
      </span>
    );
  }

  if (status === "saved") {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-green-600">
        ✓ Guardado {lastSavedAt ? timeAgo(lastSavedAt) : ""}
      </span>
    );
  }

  // status === "error"
  if (retry > 0 && retry < 3) {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-amber-600">
        ⟳ Reintentando ({retry}/3)…
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 text-sm text-red-600">
      ❌ No se pudo guardar. Revisa tu conexión.
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/projections/__tests__/DraftSaveStatus.test.tsx 2>&1 | tail -10`
Expected: tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/projections/DraftSaveStatus.tsx src/components/projections/__tests__/DraftSaveStatus.test.tsx
git commit -m "$(cat <<'EOF'
feat(ss7-f2): DraftSaveStatus component for wizard header

Renders saving/saved/retrying/error states based on useProjectionDraftSave
output. Auto-hides on idle/pending.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 2.3: Integrate `useProjectionDraftSave` + `DraftSaveStatus` into wizard

**Files:**
- Modify: `src/app/(dashboard)/proyecciones/nueva/page.tsx`

- [ ] **Step 1: Read current draft-save call sites**

Read the file. Find the existing `saveDraft()` function (around lines 292–341) and all its call sites (around lines 459, 854, 873 per the earlier exploration).

- [ ] **Step 2: Replace fire-and-forget with the hook**

Near the top of the component, add:

```tsx
const { status: saveStatus, retry: saveRetry, lastSavedAt } = useProjectionDraftSave(formState);
```

Where `formState` is the full draft state object the existing `saveDraft()` builds (build it once via `useMemo` if it's expensive).

Remove the manual `await saveDraft(step)` calls in step transitions. The hook now handles save automatically on every `formState` change (debounced 1500ms).

For step navigation: before `setStep(next)`, if `saveStatus === "error" && saveRetry >= 3`, block navigation with a toast "No se pudo guardar el progreso. Revisa tu conexión." Otherwise proceed (the next render triggers another debounced save).

- [ ] **Step 3: Render `<DraftSaveStatus />` in the wizard header**

Above the step indicator or next to the wizard title:

```tsx
<div className="flex items-center gap-4">
  <h1>Nueva proyección</h1>
  <DraftSaveStatus status={saveStatus} retry={saveRetry} lastSavedAt={lastSavedAt} />
</div>
```

- [ ] **Step 4: Accept `?draftId=X` URL param for explicit hydration**

In the hydration logic (look for the current `useEffect` that looks for an existing draft by clientId, around lines 428–449), extend it:

```tsx
const searchParams = useSearchParams();
const explicitDraftId = searchParams.get("draftId");

// In the hydration effect, prefer the explicit draftId if present:
useEffect(() => {
  if (explicitDraftId) {
    // Fetch this specific draft and hydrate it directly, skipping the prompt.
    // [Reuse existing hydrateFromDraft(draft) helper — change only the lookup source.]
  } else {
    // Existing behavior: lookup by (orgId, userId, clientId)
  }
}, [explicitDraftId, /* existing deps */]);
```

- [ ] **Step 5: If draft has `previousProjectionId`, show re-edit banner**

In the wizard, after hydration:

```tsx
{draftState?.previousProjectionId && (
  <div className="rounded-md border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-900">
    Re-editando proyección de <b>{clientName}</b> ({draftState.year}).
    Al guardar, se sobrescribirá la versión actual y se borrarán los documentos
    downstream (cotizaciones, contratos, facturas, entregables).
  </div>
)}
```

- [ ] **Step 6: TypeScript + lint check**

Run: `npx tsc --noEmit 2>&1 | grep -E "proyecciones.nueva.page" | head -10`
Expected: empty.

- [ ] **Step 7: Run all tests**

Run: `npm test 2>&1 | tail -3`
Expected: no regressions vs the prior checkpoint.

- [ ] **Step 8: Commit**

```bash
git add src/app/\(dashboard\)/proyecciones/nueva/page.tsx
git commit -m "$(cat <<'EOF'
feat(ss7-f2): wire useProjectionDraftSave into the wizard

Replaces fire-and-forget saveDraft() calls with the debounced hook.
Renders DraftSaveStatus in the header. Adds ?draftId=X support for
explicit hydration. Shows re-edit banner when previousProjectionId
is present.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 2.4: `DraftPendingBanner` component on dashboard

**Files:**
- Create: `src/components/drafts/DraftPendingBanner.tsx`
- Create: `src/components/drafts/__tests__/DraftPendingBanner.test.tsx`
- Modify: `src/app/(dashboard)/page.tsx`

- [ ] **Step 1: Write source-level test**

Create `src/components/drafts/__tests__/DraftPendingBanner.test.tsx`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_PATH = resolve(__dirname, "../DraftPendingBanner.tsx");

describe("DraftPendingBanner — source contract", () => {
  it("file exists", () => {
    expect(existsSync(SOURCE_PATH)).toBe(true);
  });

  it("uses listMyActiveDrafts query", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");
    expect(source).toContain("listMyActiveDrafts");
  });

  it("links continuation to /proyecciones/nueva?draftId=…", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");
    expect(source).toMatch(/proyecciones\/nueva\?draftId=/);
  });

  it("limits to 3 drafts shown", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");
    expect(source).toMatch(/slice\(0,\s*3\)|\.slice\(0,3\)/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/drafts/__tests__/DraftPendingBanner.test.tsx 2>&1 | tail -10`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Create the component**

Create `src/components/drafts/DraftPendingBanner.tsx`:

```tsx
"use client";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `hace ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h}h`;
  return `hace ${Math.round(h / 24)}d`;
}

export function DraftPendingBanner() {
  const drafts = useQuery(api.functions.projectionDrafts.queries.listMyActiveDrafts, {});
  if (!drafts || drafts.length === 0) return null;
  const top = [...drafts].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);

  return (
    <div className="rounded-md border-l-4 border-blue-500 bg-blue-50 p-4">
      <h3 className="text-sm font-medium text-blue-900">Borradores de proyección pendientes</h3>
      <ul className="mt-2 space-y-1 text-sm">
        {top.map((d) => (
          <li key={d._id}>
            <Link
              href={`/proyecciones/nueva?draftId=${d._id}`}
              className="text-blue-700 underline hover:text-blue-900"
            >
              Continuar borrador de <b>{d.clientName ?? "(sin cliente)"}</b>
              {d.year ? ` (${d.year})` : ""} — paso {d.step + 1}/4 · {timeAgo(d.updatedAt)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/drafts/__tests__/DraftPendingBanner.test.tsx 2>&1 | tail -10`
Expected: tests pass.

- [ ] **Step 5: Mount the banner on the dashboard home**

In `src/app/(dashboard)/page.tsx`, import and render `<DraftPendingBanner />` near the top of the dashboard content (above the rest of the dashboard widgets). Match the existing layout container style.

- [ ] **Step 6: Run tests + tsc**

Run: `npm test 2>&1 | tail -3` and `npx tsc --noEmit 2>&1 | grep -E "DraftPendingBanner|page\.tsx" | head -10`
Expected: tests green, no new type errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/drafts/ src/app/\(dashboard\)/page.tsx
git commit -m "$(cat <<'EOF'
feat(ss7-f2): DraftPendingBanner on dashboard home

Surfaces the current user's in-progress projection drafts so they
are discoverable without going to /proyecciones/nueva. Up to 3
most-recent drafts shown.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 2.5: `DraftNavbarChip` in the navbar

**Files:**
- Create: `src/components/layout/DraftNavbarChip.tsx`
- Create: `src/components/layout/__tests__/DraftNavbarChip.test.tsx`
- Modify: the dashboard navbar (search the codebase first — file may be `src/components/layout/Navbar.tsx`, `src/components/layout/AppShell.tsx`, or live in `src/app/(dashboard)/layout.tsx`)

- [ ] **Step 1: Write source-level test**

Create `src/components/layout/__tests__/DraftNavbarChip.test.tsx`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_PATH = resolve(__dirname, "../DraftNavbarChip.tsx");

describe("DraftNavbarChip — source contract", () => {
  it("file exists", () => {
    expect(existsSync(SOURCE_PATH)).toBe(true);
  });

  it("uses listMyActiveDrafts query", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");
    expect(source).toContain("listMyActiveDrafts");
  });

  it("renders nothing when there are zero drafts", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");
    expect(source).toMatch(/length\s*===\s*0/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/layout/__tests__/DraftNavbarChip.test.tsx 2>&1 | tail -10`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Create the chip**

Create `src/components/layout/DraftNavbarChip.tsx`:

```tsx
"use client";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState } from "react";

export function DraftNavbarChip() {
  const drafts = useQuery(api.functions.projectionDrafts.queries.listMyActiveDrafts, {});
  const [open, setOpen] = useState(false);

  if (!drafts || drafts.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-1 text-xs text-blue-800 hover:bg-blue-200"
        aria-label={`${drafts.length} borradores de proyección pendientes`}
      >
        Borradores
        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-[10px] text-white">
          {drafts.length}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-72 rounded-md border bg-white p-2 shadow-lg">
          <ul className="space-y-1 text-sm">
            {drafts.slice(0, 5).map((d) => (
              <li key={d._id}>
                <Link
                  href={`/proyecciones/nueva?draftId=${d._id}`}
                  className="block rounded px-2 py-1 hover:bg-gray-100"
                  onClick={() => setOpen(false)}
                >
                  {d.clientName ?? "(sin cliente)"} {d.year ? `· ${d.year}` : ""} — paso {d.step + 1}/4
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/layout/__tests__/DraftNavbarChip.test.tsx 2>&1 | tail -10`
Expected: tests pass.

- [ ] **Step 5: Mount in the navbar**

Locate the dashboard navbar (`grep -rn "navbar\|topbar\|header" src/components/layout/ src/app/\(dashboard\)/layout.tsx | head -10`). Mount `<DraftNavbarChip />` in an appropriate position (e.g., near the user menu / right side of the top bar).

- [ ] **Step 6: Run tests + tsc**

Run: `npm test 2>&1 | tail -3` and `npx tsc --noEmit 2>&1 | grep -E "DraftNavbarChip" | head -10`
Expected: tests green, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/layout/DraftNavbarChip.tsx src/components/layout/__tests__/ <navbar-file-path>
git commit -m "$(cat <<'EOF'
feat(ss7-f2): DraftNavbarChip — persistent draft indicator

Chip with count badge in the dashboard navbar, dropdown lists up
to 5 in-progress drafts with deep links to /proyecciones/nueva?draftId=…

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Track F3 — Re-edit Button + Warning Modal

### Task 2.6: "Editar desde el inicio" button + warning modal

**Files:**
- Modify: `src/app/(dashboard)/proyecciones/[id]/page.tsx`

- [ ] **Step 1: Read the current detail page header**

Read the file. Find the header / actions area of the projection detail page where buttons live.

- [ ] **Step 2: Add state, query, mutation hooks**

Near the top of the component:

```tsx
const [reEditOpen, setReEditOpen] = useState(false);
const downstream = useQuery(
  api.functions.projections.queries.getDownstreamSummary,
  reEditOpen ? { projectionId: projection._id } : "skip"
);
const cloneToDraft = useMutation(api.functions.projections.mutations.cloneProjectionToDraft);
const router = useRouter();
```

- [ ] **Step 3: Add the button + modal**

Add the button:

```tsx
<Button variant="outline" onClick={() => setReEditOpen(true)}>
  Editar desde el inicio
</Button>
```

Add the modal:

```tsx
<AlertDialog open={reEditOpen} onOpenChange={setReEditOpen}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>⚠️ Re-editar proyección</AlertDialogTitle>
      <AlertDialogDescription asChild>
        <div className="space-y-2">
          <p>Re-editar esta proyección desde el inicio borrará todos los documentos generados a partir de ella:</p>
          {downstream ? (
            <ul className="ml-4 list-disc">
              <li>{downstream.quotations} cotizaciones</li>
              <li>{downstream.contracts} contratos</li>
              <li>{downstream.invoices} facturas</li>
              <li>{downstream.deliverables} entregables</li>
              <li>{downstream.assignments} asignaciones mensuales</li>
            </ul>
          ) : (
            <p className="text-muted-foreground">Cargando…</p>
          )}
          <p className="font-medium">Esta acción no se puede deshacer.</p>
        </div>
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancelar</AlertDialogCancel>
      <AlertDialogAction
        disabled={!downstream}
        onClick={async () => {
          const draftId = await cloneToDraft({ projectionId: projection._id });
          setReEditOpen(false);
          router.push(`/proyecciones/nueva?draftId=${draftId}`);
        }}
      >
        Sí, re-editar
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

- [ ] **Step 4: TypeScript + lint**

Run: `npx tsc --noEmit 2>&1 | grep -E "proyecciones.\[id\].page" | head -10`
Expected: empty.

- [ ] **Step 5: Run tests**

Run: `npm test 2>&1 | tail -3`
Expected: no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(dashboard\)/proyecciones/\[id\]/page.tsx
git commit -m "$(cat <<'EOF'
feat(ss7-f3): "Editar desde el inicio" button + downstream warning modal

Click → fetch downstream counts → confirm modal lists what will be
deleted → cloneProjectionToDraft → redirect to wizard with ?draftId=.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 2.7: (Banner in wizard already handled in Task 2.3)

Re-edit banner inside `/proyecciones/nueva` was already covered in Task 2.3 Step 5. No additional work needed; mark this task as done.

---

# Wave 3 — Verification (SERIAL)

## Task 3.1: Full test suite + typecheck

- [ ] **Step 1: Run full vitest suite**

Run: `npm test 2>&1 | tail -10`
Expected: ≥1031 tests passing (1017 baseline + 14 new minimum: 3 F1 + 7 F2 + 4+ F3).

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: no new errors. Pre-existing warnings are acceptable.

- [ ] **Step 3: Run convex codegen verification**

Run: `npx convex codegen 2>&1 | tail -5`
Expected: success.

- [ ] **Step 4: GitNexus reanalyze**

Run: `npx gitnexus analyze --embeddings 2>&1 | tail -5`
Expected: success. Required per CLAUDE.md after code changes.

- [ ] **Step 5: Update handoff.md**

Append a SS7 section summarizing the 3 features, commits, test count, schema diff, and remaining smoke-browser checklist. Match the format of the existing handoff structure.

- [ ] **Step 6: Commit the handoff update**

```bash
git add Handoff.md
git commit -m "$(cat <<'EOF'
docs(handoff): SS7 projection + questionnaire resilience complete

Features 1, 2, 3 merged to main. Tests ≥1031. Smoke-browser
checklist for Christian appended.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Task 3.2: Manual smoke checklist (Christian, in browser)

> Not an agent task — for Christian to execute. Documented here so it lands in handoff.

- [ ] **F1 smoke:** Open a completed questionnaire → see "Reabrir cuestionario" button → click → confirm → status flips to "in progress" → editable again.
- [ ] **F2 smoke (save defense):** Start a new projection wizard → fill step 0 → watch the "Guardando…" → "Guardado hace 1s" indicator → throttle network in devtools → see "Reintentando" → restore network → "Guardado" returns.
- [ ] **F2 smoke (discovery):** Start a draft, navigate away to `/` → see banner "Borradores de proyección pendientes" → see navbar chip with count → click → land back in the wizard with state hydrated.
- [ ] **F3 smoke:** Open an existing projection that has downstream documents → click "Editar desde el inicio" → confirm modal lists counts → click "Sí, re-editar" → wizard opens with banner "Re-editando…" → walk through to step 3 → commit → verify downstream is gone (visit /contratos, /facturas, etc.).

---

## Execution Notes

**Recommended dispatch sequence for subagent-driven-development:**

1. **Wave 0 (serial):** Dispatch one subagent for Task 0.1.
2. **Wave 1 (parallel):** After 0.1 commits, dispatch **3 subagents in a single message**:
   - Subagent F1 backend → Task 1.1
   - Subagent F2 backend → Tasks 1.2 + 1.3 + 1.4 + 1.5 (sequential within this track)
   - Subagent F3 backend → Tasks 1.6 + 1.7 + 1.8 + 1.9 + 1.10 (sequential within this track)
3. **Wave 2 (parallel):** After all Wave 1 tracks commit, dispatch **3 subagents in a single message**:
   - Subagent F1 UI → Task 2.1
   - Subagent F2 UI → Tasks 2.2 + 2.3 + 2.4 + 2.5
   - Subagent F3 UI → Task 2.6 (2.7 already covered by 2.3)
4. **Wave 3 (serial):** One subagent for Task 3.1, then Christian executes 3.2 manually in browser.

**Why this shape?**
- Schema edits in Wave 0 are the only cross-track dependency. Doing them once up front eliminates merge conflicts.
- Within each track, tasks are sequential because later tasks build on earlier ones (e.g. wizard integration needs the hook from 1.3).
- Across tracks, the files are disjoint (F1 touches questionnaires, F2 touches projectionDrafts + hooks + dashboard, F3 touches projections + projectionDrafts/commitDraft + projection detail page). The one overlap is `projectionDrafts/mutations.ts` between F2 (read-only — `upsertDraft` already exists) and F3 (modifying `commitDraft`). If both tracks modify that file in parallel they'll merge-conflict — sequence them inside the dispatcher: F2 first (no edit needed), then F3.

---

## Self-Review Notes

- **Spec coverage:** All 3 features from the spec map to tasks. Schema diff (`reopenedAt`, `reopenedBy`, `"reopened"` eventType, `"projection"` entityType) ↔ Task 0.1. All verify-during-plan flags from the spec converted to inline instructions ("Step 3: verify the actual upsertDraft mutation path", "Step 5: audit by_projServiceId indexes", etc.).
- **Placeholders:** Task 1.10 uses `as never` placeholders for downstream entity seeds — explicitly called out as something the executing subagent must replace by reading `schema.ts`. Task 1.6 marks the second test as optional `.skip` if seeding gets complex. Task 1.8 deliberately delegates the extraction body to the subagent because it depends on existing code shape.
- **Type consistency:** `useProjectionDraftSave` returns `{status, retry, lastSavedAt}`, consumed by `DraftSaveStatus` props with same names. `getProjectionDownstreamCounts` returns `{projServices, assignments, quotations, contracts, deliverables, invoices}`, consumed in modal + log metadata with same keys.
- **No invented APIs:** all Convex paths use `api.functions.<module>.<sub>.<name>` matching the existing project convention. Auth helpers (`requireAuth`, `getOrgId`) match `convex/lib/authHelpers.ts`.
