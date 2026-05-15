# Deliverables — Sub-proyecto F (test generator) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an ephemeral "Probar con datos reales" modal on `/platform/templates` that pairs a saved template with an already-answered questionnaire, runs the post-refactor batched Claude pipeline server-side via a new `previewDeliverable` action, and renders the resulting HTML in an iframe with token/cost/latency metrics and unfilled-key surfacing. No persistence.

**Architecture:** Three thin layers. (1) Three new internal queries that fetch `template`, `questionnaire`, and the matching `projectionService` by ids; (2) a new public `previewDeliverable` action that reuses the post-refactor `convex/lib/deliverableEngine/` helpers (`extractPlaceholders` + `resolveStatic` + `batchFillWithClaude`) plus the file-local `buildContextBlock` / `formatToday` from `generateDeliverable`, but returns `{ html, aiLog, tokensUsed, costUsd, elapsedMs, unfilledKeys }` without writing to the `deliverables` table; (3) a modal component triggered from the template card.

**Tech Stack:** Convex (action + queries), Next.js App Router, React 19, vitest + convex-test, Anthropic SDK (already wired). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-12-deliverables-test-generator-F-design.md`

**Branch state at plan author time:** `feature/deliverable-engine-refactor` (13 commits ahead of `main`, includes the engine refactor that introduced `extractPlaceholders` / `resolveStatic` / `batchFillWithClaude` / sentinel errors). This plan targets that engine; do NOT use the legacy per-variable `callClaudeWithRetry` path that still exists in `actions.ts` for backwards compatibility.

---

## File Structure

**Files modified:**
- `convex/functions/deliverables/internalQueries.ts` — add `getTemplateById`, `getQuestionnaireById`, `findProjServiceByServiceAndProjection`.
- `convex/functions/deliverables/actions.ts` — add `previewDeliverable` action at the end (reusing the existing engine + file-local helpers).
- `convex/functions/questionnaires/queries.ts` — add `listTestable` public query.
- `src/app/platform/templates/page.tsx` — add "🧪 Probar con datos reales" button per template + modal mount state.

**Files created:**
- `convex/functions/deliverables/__tests__/previewDeliverable.test.ts` — TDD tests for the action.
- `convex/functions/questionnaires/__tests__/listTestable.test.ts` — tests for the dropdown query.
- `src/components/templates/test-deliverable-modal.tsx` — modal with dropdown + iframe + metrics + unfilled-key list.

---

## Phase 1 — Internal queries

### Task 1: Add 3 internal queries

**Files:**
- Modify: `convex/functions/deliverables/internalQueries.ts` (append to the end)

- [ ] **Step 1: Read the file** to see existing internal query patterns

Run: `head -30 convex/functions/deliverables/internalQueries.ts`

Note the imports and the existing pattern (each is a small `internalQuery` that takes one id and returns `ctx.db.get(...)`).

- [ ] **Step 2: Append the new queries**

Add at the end of `convex/functions/deliverables/internalQueries.ts`:

```ts
export const getTemplateById = internalQuery({
  args: { templateId: v.id("deliverableTemplates") },
  handler: async (ctx, { templateId }) => {
    return await ctx.db.get(templateId);
  },
});

export const getQuestionnaireById = internalQuery({
  args: { questionnaireId: v.id("questionnaireResponses") },
  handler: async (ctx, { questionnaireId }) => {
    return await ctx.db.get(questionnaireId);
  },
});

export const findProjServiceByServiceAndProjection = internalQuery({
  args: {
    projectionId: v.id("projections"),
    serviceId: v.id("services"),
  },
  handler: async (ctx, { projectionId, serviceId }) => {
    return await ctx.db
      .query("projectionServices")
      .withIndex("by_projectionId", (q) => q.eq("projectionId", projectionId))
      .filter((q) => q.eq(q.field("serviceId"), serviceId))
      .first();
  },
});
```

If the file's existing imports don't include `internalQuery` and `v`, the existing exports at the top of the file already use them (no import change needed).

- [ ] **Step 3: Verify Convex codegen + typecheck**

Run: `npx convex dev --once`
Expected: success. `_generated/api.d.ts` exposes the new internal queries.

Run: `npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -5`
Expected: no new errors.

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: existing tests still PASS (no behavior changes yet).

- [ ] **Step 5: Commit**

```bash
git add convex/functions/deliverables/internalQueries.ts convex/_generated/
git commit -m "feat(deliverables): internal queries for preview action

Adds getTemplateById, getQuestionnaireById, and
findProjServiceByServiceAndProjection — consumed by the upcoming
previewDeliverable action.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 — Public query for the dropdown

### Task 2: Write failing tests for `listTestable`

**Files:**
- Create: `convex/functions/questionnaires/__tests__/listTestable.test.ts`

- [ ] **Step 1: Read existing questionnaire test pattern**

Run: `head -30 convex/functions/questionnaires/__tests__/generate.test.ts`

Note: uses `setupTest` from `tests/harness.ts`, `asUserOfOrg(orgId)` helper for identity, seeds with `t.run`.

- [ ] **Step 2: Write the test file**

```ts
import { describe, it, expect } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { api } from "../../../_generated/api";

function asUserOfOrg(orgId: string, userSubject: string = `user|${orgId}`) {
  return {
    subject: userSubject,
    issuer: "test",
    tokenIdentifier: `test|${userSubject}`,
    orgId,
  };
}

async function seedQuestionnaireInOrg(
  t: ReturnType<typeof setupTest>,
  orgId: string,
  status: "draft" | "in_progress" | "completed" | "sent",
  clientName: string = "ACME"
) {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId,
      name: clientName,
      rfc: "AAA010101AAA",
      industry: "X",
      annualRevenue: 1_000_000,
      billingFrequency: "mensual" as const,
      isArchived: false,
      createdAt: Date.now(),
    });
    const projectionId = await ctx.db.insert("projections", {
      orgId,
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
      orgId,
      clientId,
      projectionId,
      responses: [
        { questionId: "q1", questionText: "P1", answer: "R1", serviceNames: [] },
      ],
      status,
      createdAt: Date.now(),
    });
  });
}

describe("questionnaires.listTestable", () => {
  it("returns completed and in_progress responses for the current org", async () => {
    const t = setupTest();
    await seedQuestionnaireInOrg(t, "org_a", "completed", "Catimi");
    await seedQuestionnaireInOrg(t, "org_a", "in_progress", "Empresa Test");
    await seedQuestionnaireInOrg(t, "org_a", "draft", "Skip-Me");
    await seedQuestionnaireInOrg(t, "org_a", "sent", "Skip-Sent");

    const result = await t
      .withIdentity(asUserOfOrg("org_a"))
      .query(api.functions.questionnaires.queries.listTestable, {});

    expect(result).toHaveLength(2);
    const names = result.map((r) => r.clientName).sort();
    expect(names).toEqual(["Catimi", "Empresa Test"]);
  });

  it("excludes drafts and sent (no responses yet)", async () => {
    const t = setupTest();
    await seedQuestionnaireInOrg(t, "org_a", "draft");
    await seedQuestionnaireInOrg(t, "org_a", "sent");

    const result = await t
      .withIdentity(asUserOfOrg("org_a"))
      .query(api.functions.questionnaires.queries.listTestable, {});

    expect(result).toHaveLength(0);
  });

  it("multi-tenant isolation: org_b cannot see org_a's responses", async () => {
    const t = setupTest();
    await seedQuestionnaireInOrg(t, "org_a", "completed");

    const result = await t
      .withIdentity(asUserOfOrg("org_b"))
      .query(api.functions.questionnaires.queries.listTestable, {});

    expect(result).toHaveLength(0);
  });

  it("returns enriched fields: _id, clientName, projectionYear, status, responseCount", async () => {
    const t = setupTest();
    await seedQuestionnaireInOrg(t, "org_a", "completed", "Catimi");

    const result = await t
      .withIdentity(asUserOfOrg("org_a"))
      .query(api.functions.questionnaires.queries.listTestable, {});

    expect(result).toHaveLength(1);
    const row = result[0];
    expect(row._id).toBeDefined();
    expect(row.clientName).toBe("Catimi");
    expect(row.projectionYear).toBe(2026);
    expect(row.status).toBe("completed");
    expect(row.responseCount).toBe(1);
  });
});
```

- [ ] **Step 3: Run the tests to confirm FAIL**

Run: `npx vitest run convex/functions/questionnaires/__tests__/listTestable.test.ts`
Expected: all 4 tests FAIL — `listTestable is not a function` or "Could not find module".

- [ ] **Step 4: Do NOT commit yet** (Task 3 implements + commits Phase 2 together)

---

### Task 3: Implement `listTestable`

**Files:**
- Modify: `convex/functions/questionnaires/queries.ts` (append)

- [ ] **Step 1: Check existing imports**

Run: `head -10 convex/functions/questionnaires/queries.ts`
Note: the file likely already imports `query`, `v`, and `getOrgIdSafe` for other queries. If not, add them.

- [ ] **Step 2: Append the new query**

Add at the end of `convex/functions/questionnaires/queries.ts`:

```ts
export const listTestable = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    const responses = await ctx.db
      .query("questionnaireResponses")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    const filtered = responses.filter(
      (r) => r.status === "completed" || r.status === "in_progress"
    );

    const enriched = await Promise.all(
      filtered.map(async (r) => {
        const client = await ctx.db.get(r.clientId);
        const projection = await ctx.db.get(r.projectionId);
        return {
          _id: r._id,
          clientName: client?.name ?? "Cliente",
          projectionYear: projection?.year ?? null,
          status: r.status,
          responseCount: r.responses.length,
        };
      })
    );

    return enriched.sort((a, b) =>
      (a.clientName ?? "").localeCompare(b.clientName ?? "")
    );
  },
});
```

If `getOrgIdSafe` is not imported in this file yet, add:

```ts
import { getOrgIdSafe } from "../../lib/authHelpers";
```

- [ ] **Step 3: Regenerate Convex types**

Run: `npx convex dev --once`
Expected: success.

- [ ] **Step 4: Run the test file**

Run: `npx vitest run convex/functions/questionnaires/__tests__/listTestable.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 6: Commit Phase 2**

```bash
git add convex/functions/questionnaires/queries.ts convex/functions/questionnaires/__tests__/listTestable.test.ts convex/_generated/
git commit -m "feat(questionnaires): listTestable query for preview dropdown

Returns completed + in_progress responses scoped to the caller's org,
enriched with clientName, projectionYear, status, and responseCount.
Sorted by clientName ascending. Excludes drafts and sent (no answers).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3 — `previewDeliverable` action (TDD against the refactored engine)

### Task 4: Write failing tests for `previewDeliverable`

**Files:**
- Create: `convex/functions/deliverables/__tests__/previewDeliverable.test.ts`

- [ ] **Step 1: Read the existing action test pattern**

Run: `head -90 convex/functions/deliverables/__tests__/generateDeliverable.refactor.test.ts`

Note: mocks `@anthropic-ai/sdk` returning a JSON object with all AI keys at once (because `batchFillWithClaude` requests JSON via cache_control). The mock pattern is non-trivial — copy it verbatim.

- [ ] **Step 2: Write the test file**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

// Mock Anthropic SDK. `batchFillWithClaude` expects ONE JSON object per
// chunk call with all requested keys. The default mock returns the AI
// keys used by TEMPLATE_HTML_WITH_AI below; the cross-org / not-found
// tests don't reach Claude so the mock returning a generic placeholder
// is fine.
vi.mock("@anthropic-ai/sdk", () => {
  const defaultCreate = vi.fn(async () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          ai_summary: "Resumen ejecutivo generado por la IA de prueba.",
        }),
      },
    ],
    usage: {
      input_tokens: 800,
      output_tokens: 150,
      cache_creation_input_tokens: 200,
      cache_read_input_tokens: 0,
    },
  }));
  return {
    default: vi.fn().mockImplementation(function (this: { messages: { create: typeof defaultCreate } }) {
      this.messages = { create: defaultCreate };
    }),
  };
});

const ORG_A = "org_preview_a";
const ORG_B = "org_preview_b";

// Static-only template: every placeholder maps via resolveStatic.
const TEMPLATE_HTML_NON_AI = `<p>Cliente: {{client_name}}, ventas: {{projection_annual_sales}}, año: {{projection_year}}</p>`;

// Template with one AI placeholder.
const TEMPLATE_HTML_WITH_AI = `<p>Cliente: {{client_name}}</p><p>Resumen: {{ai_summary}}</p>`;

type SeededIds = {
  clientId: Id<"clients">;
  projectionId: Id<"projections">;
  serviceId: Id<"services">;
  questionnaireId: Id<"questionnaireResponses">;
  templateNonAiId: Id<"deliverableTemplates">;
  templateWithAiId: Id<"deliverableTemplates">;
};

async function seedFixture(
  t: ReturnType<typeof setupTest>,
  orgId: string
): Promise<SeededIds> {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId,
      name: "Catimi",
      rfc: "CTM010101AAA",
      industry: "Seguros",
      annualRevenue: 60_000_000,
      billingFrequency: "mensual" as const,
      isArchived: false,
      createdAt: Date.now(),
    });
    const projectionId = await ctx.db.insert("projections", {
      orgId,
      clientId,
      year: 2026,
      annualSales: 60_000_000,
      totalBudget: 10_000_000,
      commissionRate: 0.02,
      seasonalityData: [],
      status: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const serviceId = await ctx.db.insert("services", {
      orgId,
      name: "Marketing",
      type: "base" as const,
      minPct: 0.05,
      maxPct: 0.15,
      defaultPct: 0.1,
      isDefault: true,
      sortOrder: 1,
    });
    await ctx.db.insert("projectionServices", {
      orgId,
      projectionId,
      serviceId,
      serviceName: "Marketing",
      chosenPct: 0.1,
      isActive: true,
      annualAmount: 1_000_000,
      normalizedWeight: 0.1,
    });
    const questionnaireId = await ctx.db.insert("questionnaireResponses", {
      orgId,
      clientId,
      projectionId,
      responses: [
        {
          questionId: "q1",
          questionText: "¿Cuántos canales de adquisición tienes?",
          answer: "3 canales: Google Ads, LinkedIn, referidos",
          serviceNames: ["Marketing"],
        },
      ],
      status: "completed" as const,
      createdAt: Date.now(),
    });
    const templateNonAiId = await ctx.db.insert("deliverableTemplates", {
      orgId,
      serviceId,
      serviceName: "Marketing",
      type: "deliverable_long" as const,
      name: "Marketing — Non-AI",
      htmlTemplate: TEMPLATE_HTML_NON_AI,
      // Note: template.variables is unused post-refactor (extractPlaceholders
      // discovers from HTML), but the schema still requires the array.
      variables: [],
      version: 1,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const templateWithAiId = await ctx.db.insert("deliverableTemplates", {
      orgId,
      serviceId,
      serviceName: "Marketing",
      type: "deliverable_long" as const,
      name: "Marketing — With AI",
      htmlTemplate: TEMPLATE_HTML_WITH_AI,
      variables: [],
      version: 1,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { clientId, projectionId, serviceId, questionnaireId, templateNonAiId, templateWithAiId };
  });
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
});

describe("previewDeliverable action", () => {
  it("static-only template: html resolves all keys, aiLog empty, no DB writes", async () => {
    const t = setupTest();
    const { questionnaireId, templateNonAiId } = await seedFixture(t, ORG_A);

    const before = await t.run(async (ctx) =>
      (await ctx.db.query("deliverables").collect()).length
    );

    const result = await t.action(
      api.functions.deliverables.actions.previewDeliverable,
      { templateId: templateNonAiId, questionnaireId }
    );

    // Static fills from resolveStatic: client_name, projection_annual_sales, projection_year.
    expect(result.html).toContain("Catimi");
    expect(result.html).toContain("60,000,000");
    expect(result.html).toContain("2026");
    // No raw placeholders left:
    expect(/\{\{[a-zA-Z0-9_]+\}\}/.test(result.html)).toBe(false);
    expect(result.aiLog).toEqual([]);
    expect(result.tokensUsed).toBe(0);
    expect(result.costUsd).toBe(0);
    expect(result.unfilledKeys).toEqual([]);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);

    const after = await t.run(async (ctx) =>
      (await ctx.db.query("deliverables").collect()).length
    );
    expect(after).toBe(before);
  });

  it("AI template: calls batchFillWithClaude, returns aiLog + metrics + zero unfilled", async () => {
    const t = setupTest();
    const { questionnaireId, templateWithAiId } = await seedFixture(t, ORG_A);

    const result = await t.action(
      api.functions.deliverables.actions.previewDeliverable,
      { templateId: templateWithAiId, questionnaireId }
    );

    expect(result.html).toContain("Catimi");
    expect(result.html).toContain("Resumen ejecutivo generado por la IA de prueba.");
    expect(result.aiLog.length).toBe(1); // one batch call
    expect(result.tokensUsed).toBeGreaterThan(0);
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.unfilledKeys).toEqual([]);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("template not found throws", async () => {
    const t = setupTest();
    const { questionnaireId } = await seedFixture(t, ORG_A);

    const fakeTemplateId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("deliverableTemplates", {
        orgId: ORG_A,
        serviceName: "Tmp",
        type: "deliverable_long" as const,
        name: "Tmp",
        htmlTemplate: "",
        variables: [],
        version: 1,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.delete(id);
      return id;
    });

    await expect(
      t.action(api.functions.deliverables.actions.previewDeliverable, {
        templateId: fakeTemplateId,
        questionnaireId,
      })
    ).rejects.toThrow(/Template no encontrado/);
  });

  it("questionnaire not found throws", async () => {
    const t = setupTest();
    const { templateNonAiId } = await seedFixture(t, ORG_A);

    const fakeQId = await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: ORG_A,
        name: "x",
        rfc: "X010101AAA",
        industry: "x",
        annualRevenue: 1,
        billingFrequency: "mensual" as const,
        isArchived: false,
        createdAt: Date.now(),
      });
      const projId = await ctx.db.insert("projections", {
        orgId: ORG_A,
        clientId,
        year: 2026,
        annualSales: 1,
        totalBudget: 1,
        commissionRate: 0,
        seasonalityData: [],
        status: "active" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const id = await ctx.db.insert("questionnaireResponses", {
        orgId: ORG_A,
        clientId,
        projectionId: projId,
        responses: [],
        status: "draft" as const,
        createdAt: Date.now(),
      });
      await ctx.db.delete(id);
      return id;
    });

    await expect(
      t.action(api.functions.deliverables.actions.previewDeliverable, {
        templateId: templateNonAiId,
        questionnaireId: fakeQId,
      })
    ).rejects.toThrow(/Cuestionario no encontrado/);
  });

  it("cross-org pairing throws (template in A, questionnaire in B)", async () => {
    const t = setupTest();
    const a = await seedFixture(t, ORG_A);
    const b = await seedFixture(t, ORG_B);

    await expect(
      t.action(api.functions.deliverables.actions.previewDeliverable, {
        templateId: a.templateNonAiId,
        questionnaireId: b.questionnaireId,
      })
    ).rejects.toThrow(/organizaciones distintas/);
  });

  it("global template (orgId undefined) works with any org's questionnaire", async () => {
    const t = setupTest();
    const { questionnaireId } = await seedFixture(t, ORG_A);

    const globalTemplateId = await t.run(async (ctx) =>
      ctx.db.insert("deliverableTemplates", {
        // orgId omitted = global default
        serviceName: "Marketing",
        type: "deliverable_long" as const,
        name: "Default Marketing",
        htmlTemplate: `<p>{{client_name}}</p>`,
        variables: [],
        version: 1,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    );

    const result = await t.action(
      api.functions.deliverables.actions.previewDeliverable,
      { templateId: globalTemplateId, questionnaireId }
    );

    expect(result.html).toContain("Catimi");
  });

  it("missing API key leaves AI keys unfilled with visible markers", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const t = setupTest();
    const { questionnaireId, templateWithAiId } = await seedFixture(t, ORG_A);

    const result = await t.action(
      api.functions.deliverables.actions.previewDeliverable,
      { templateId: templateWithAiId, questionnaireId }
    );

    // Static portion still renders:
    expect(result.html).toContain("Catimi");
    // AI key surfaced as marker (matches generateDeliverable's behavior):
    expect(result.unfilledKeys).toEqual(["ai_summary"]);
    expect(result.html).toContain("[ai_summary]");
    expect(result.aiLog).toEqual([]);
    expect(result.tokensUsed).toBe(0);
    expect(result.costUsd).toBe(0);

    // Re-set so other tests aren't affected.
    process.env.ANTHROPIC_API_KEY = "test-key";
  });
});
```

- [ ] **Step 3: Run to confirm FAIL**

Run: `npx vitest run convex/functions/deliverables/__tests__/previewDeliverable.test.ts`
Expected: all 7 tests FAIL with "previewDeliverable is not a function" or "Could not find module".

- [ ] **Step 4: Do NOT commit yet** (Task 5 implements + commits Phase 3 together)

---

### Task 5: Implement `previewDeliverable`

**Files:**
- Modify: `convex/functions/deliverables/actions.ts` (append after `auditDeliverable` action's closing `});`)

- [ ] **Step 1: Locate the end of `auditDeliverable`**

Run: `grep -n "^export const\|^export async" convex/functions/deliverables/actions.ts`

Expected: shows `generateDeliverable` (around line 175), `auditDeliverable` (around line 399), `regenerateDeliverable` (around line 529). Append `previewDeliverable` AFTER `auditDeliverable` and BEFORE `regenerateDeliverable` (since `regenerateDeliverable` is an `internalAction` block).

- [ ] **Step 2: Verify the imports already present**

The top of `actions.ts` should already import these (post-refactor):

```ts
import { extractPlaceholders } from "../../lib/deliverableEngine/placeholders";
import { resolveStatic, type StaticResolutionContext } from "../../lib/deliverableEngine/staticResolver";
import { batchFillWithClaude } from "../../lib/deliverableEngine/aiBatchFill";
import { CreditExhaustedError, CostCapExceededError } from "../../lib/deliverableEngine/errors";
```

If any are missing, add them (paste them next to the existing `internal` / `v` / `Anthropic` imports).

- [ ] **Step 3: Append the action**

Insert at the line after `auditDeliverable`'s closing `});` (and before `regenerateDeliverable`):

```ts
/**
 * Preview a deliverable for a given template + questionnaire pair, WITHOUT
 * persisting. Used by the "Probar con datos reales" modal on /platform/templates
 * to validate AI output quality before going live. Reuses the same engine
 * (extractPlaceholders + resolveStatic + batchFillWithClaude) as
 * generateDeliverable so the preview is faithful to production output.
 *
 * Returns { html, aiLog, tokensUsed, costUsd, elapsedMs, unfilledKeys }.
 * Operator-visible: unfilledKeys lets the UI flag broken templates or
 * exhausted credits without scanning the HTML.
 */
export const previewDeliverable = action({
  args: {
    templateId: v.id("deliverableTemplates"),
    questionnaireId: v.id("questionnaireResponses"),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    html: string;
    aiLog: AiLogEntry[];
    tokensUsed: number;
    costUsd: number;
    elapsedMs: number;
    unfilledKeys: string[];
  }> => {
    const t0 = Date.now();

    const template = await ctx.runQuery(
      internal.functions.deliverables.internalQueries.getTemplateById,
      { templateId: args.templateId }
    );
    if (!template) throw new Error("Template no encontrado.");

    const questionnaire = await ctx.runQuery(
      internal.functions.deliverables.internalQueries.getQuestionnaireById,
      { questionnaireId: args.questionnaireId }
    );
    if (!questionnaire) throw new Error("Cuestionario no encontrado.");

    // Cross-org safety: org-scoped templates must match the questionnaire's org.
    // Global templates (template.orgId === undefined) are usable against any org.
    if (template.orgId !== undefined && template.orgId !== questionnaire.orgId) {
      throw new Error(
        "Template y cuestionario pertenecen a organizaciones distintas."
      );
    }

    const [client, projection, orgBranding] = await Promise.all([
      ctx.runQuery(
        internal.functions.deliverables.internalQueries.getClientData,
        { clientId: questionnaire.clientId }
      ),
      ctx.runQuery(
        internal.functions.deliverables.internalQueries.getProjectionByProjService,
        { projectionId: questionnaire.projectionId }
      ),
      ctx.runQuery(
        internal.functions.deliverables.internalQueries.getOrgBranding,
        { orgId: questionnaire.orgId }
      ),
    ]);
    if (!client) throw new Error("Cliente del cuestionario no encontrado.");
    if (!projection) throw new Error("Proyección del cuestionario no encontrada.");

    // Optional projService when the template is service-scoped.
    let projService: {
      serviceName: string;
      chosenPct: number;
      annualAmount: number;
    } | null = null;
    if (template.serviceId) {
      const ps = await ctx.runQuery(
        internal.functions.deliverables.internalQueries.findProjServiceByServiceAndProjection,
        { projectionId: questionnaire.projectionId, serviceId: template.serviceId }
      );
      if (ps) {
        projService = {
          serviceName: ps.serviceName,
          chosenPct: ps.chosenPct,
          annualAmount: ps.annualAmount,
        };
      }
    }

    // 1. Discover placeholders from HTML.
    const placeholders = extractPlaceholders(template.htmlTemplate);

    // 2. Build the static resolution context.
    const staticCtx: StaticResolutionContext = {
      client: {
        name: client.name,
        rfc: client.rfc,
        industry: client.industry,
        annualRevenue: client.annualRevenue,
        billingFrequency: client.billingFrequency,
        contactName: client.contactName,
        contactEmail: client.contactEmail,
      },
      projection: {
        year: projection.year,
        annualSales: projection.annualSales,
        totalBudget: projection.totalBudget,
        effectiveBudget: projection.effectiveBudget,
      },
      projService,
      orgBranding: orgBranding
        ? {
            companyName: orgBranding.companyName,
            primaryColor: orgBranding.primaryColor,
            secondaryColor: orgBranding.secondaryColor,
            accentColor: orgBranding.accentColor,
            fontFamily: orgBranding.fontFamily,
            footerText: orgBranding.footerText,
          }
        : null,
      today: formatToday(),
    };

    // 3. Resolve static placeholders, collect AI keys.
    const resolved: Record<string, string> = {};
    const needsAi: string[] = [];
    for (const k of placeholders) {
      const v = resolveStatic(k, staticCtx);
      if (v !== null) resolved[k] = v;
      else needsAi.push(k);
    }

    // 4. Batched AI fill.
    const aiLogs: AiLogEntry[] = [];
    let totalCost = 0;
    let unfilledKeys: string[] = [];

    const anthropic = getAnthropicClient();
    if (anthropic && needsAi.length > 0) {
      const contextBlock = buildContextBlock({
        client,
        projection,
        projService,
        questionnaire,
      });
      try {
        const result = await batchFillWithClaude(
          anthropic,
          projService?.serviceName ?? "Consultoría",
          contextBlock,
          needsAi
        );
        Object.assign(resolved, result.resolved);
        aiLogs.push(...result.log);
        unfilledKeys = result.unfilled;
        totalCost = result.totalCost;
      } catch (err) {
        if (err instanceof CreditExhaustedError) {
          console.warn("[previewDeliverable] credit exhausted; returning partial.");
          unfilledKeys = needsAi.filter((k) => !(k in resolved));
        } else if (err instanceof CostCapExceededError) {
          console.warn(
            `[previewDeliverable] cost cap exceeded at $${err.costUsd.toFixed(4)}; returning partial.`
          );
          unfilledKeys = needsAi.filter((k) => !(k in resolved));
          totalCost = err.costUsd;
        } else {
          throw err;
        }
      }
    } else if (!anthropic && needsAi.length > 0) {
      // No API key: leave AI keys unfilled. Modal surfaces these as markers.
      unfilledKeys = needsAi;
    }

    // 5. Visible markers for unfilled keys (matches generateDeliverable behavior).
    for (const k of unfilledKeys) {
      resolved[k] = `<em style="color:#94a3b8">[${k}]</em>`;
    }

    // 6. Replace placeholders in HTML.
    let html = template.htmlTemplate;
    for (const [k, val] of Object.entries(resolved)) {
      const safe = String(val ?? "").replace(/\$/g, "$$$$");
      html = html.replace(new RegExp(escapeRegex(`{{${k}}}`), "g"), safe);
    }

    // 7. Metrics. `costUsd` prefers the batchFill total (which includes
    //    chunk costs not yet reflected in aiLogs when the cost cap throws).
    const tokensUsed = aiLogs.reduce(
      (acc, l) => acc + l.inputTokens + l.outputTokens,
      0
    );
    const costUsd =
      totalCost > 0 ? totalCost : aiLogs.reduce((acc, l) => acc + l.costUsd, 0);
    const elapsedMs = Date.now() - t0;

    return { html, aiLog: aiLogs, tokensUsed, costUsd, elapsedMs, unfilledKeys };
  },
});
```

- [ ] **Step 4: Regenerate Convex types**

Run: `npx convex dev --once`
Expected: success.

- [ ] **Step 5: Run the test file**

Run: `npx vitest run convex/functions/deliverables/__tests__/previewDeliverable.test.ts`
Expected: all 7 tests PASS.

- [ ] **Step 6: Run full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 7: Commit Phase 3**

```bash
git add convex/functions/deliverables/actions.ts convex/functions/deliverables/__tests__/previewDeliverable.test.ts convex/_generated/
git commit -m "$(cat <<'EOF'
feat(deliverables): previewDeliverable action for real-data test runs

Pairs a saved template with an already-answered questionnaire, runs the
post-refactor batched Claude pipeline (extractPlaceholders + resolveStatic
+ batchFillWithClaude), and returns the resolved HTML plus token/cost
/latency metrics and the unfilledKeys list. No persistence — intended
for an ephemeral preview modal.

Cross-org safety: org-scoped templates must match the questionnaire's
org; global templates (orgId undefined) work everywhere. Missing API
key leaves AI keys as visible [key] markers instead of throwing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — UI

### Task 6: Create `<TestDeliverableModal>` component

**Files:**
- Create: `src/components/templates/test-deliverable-modal.tsx`

- [ ] **Step 1: Write the file**

```tsx
"use client";

// TODO: component tests deferred — UI behavior verified manually in QA
// (plan F Task 8). Re-enable once React Testing Library is configured.

import { useState } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { X, Loader2, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

type PreviewOutput = {
  html: string;
  aiLog: { inputTokens: number; outputTokens: number; costUsd: number }[];
  tokensUsed: number;
  costUsd: number;
  elapsedMs: number;
  unfilledKeys: string[];
};

type Props = {
  templateId: Id<"deliverableTemplates">;
  onClose: () => void;
};

export function TestDeliverableModal({ templateId, onClose }: Props) {
  const template = useQuery(api.functions.deliverableTemplates.queries.getById, {
    id: templateId,
  });
  const testables = useQuery(api.functions.questionnaires.queries.listTestable, {});
  const previewAction = useAction(api.functions.deliverables.actions.previewDeliverable);

  const [questionnaireId, setQuestionnaireId] =
    useState<Id<"questionnaireResponses"> | null>(null);
  const [output, setOutput] = useState<PreviewOutput | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleGenerate() {
    if (!questionnaireId) return;
    setGenerating(true);
    setError(null);
    try {
      const result = await previewAction({ templateId, questionnaireId });
      setOutput(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al generar");
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopy() {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output.html);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("No se pudo copiar al portapapeles.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-full max-h-[90vh] w-full max-w-4xl flex-col rounded-lg border border-border bg-card shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-4">
          <div>
            <h3 className="text-lg font-semibold">Probar con datos reales</h3>
            {template && (
              <p className="text-xs text-muted-foreground">{template.name}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 hover:bg-secondary cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {/* Questionnaire picker */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Cuestionario de origen</label>
            <select
              value={questionnaireId ?? ""}
              onChange={(e) =>
                setQuestionnaireId(
                  e.target.value
                    ? (e.target.value as Id<"questionnaireResponses">)
                    : null
                )
              }
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:border-accent focus:outline-none cursor-pointer"
            >
              <option value="">— Selecciona un cuestionario —</option>
              {testables?.map((q) => (
                <option key={q._id} value={q._id}>
                  {q.clientName} — {q.projectionYear ?? "—"} ({q.status},{" "}
                  {q.responseCount} respuestas)
                </option>
              ))}
            </select>
            {testables && testables.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No hay cuestionarios completos o en progreso para probar.
              </p>
            )}
          </div>

          <button
            onClick={handleGenerate}
            disabled={!questionnaireId || generating}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-primary hover:bg-accent/90 disabled:opacity-50 cursor-pointer"
          >
            {generating ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Generando…
              </>
            ) : output ? (
              "Regenerar"
            ) : (
              "Generar prueba"
            )}
          </button>

          {error && (
            <div className="rounded-md border border-red-400/40 bg-red-400/5 p-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Output preview */}
          {output && (
            <div className="space-y-2">
              <iframe
                title="Preview del entregable"
                srcDoc={output.html}
                sandbox="allow-same-origin"
                className="h-[55vh] w-full rounded-md border border-border bg-white"
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  Tokens: {output.tokensUsed.toLocaleString("es-MX")} · ~$
                  {output.costUsd.toFixed(4)} USD · {output.elapsedMs}ms
                </span>
                <button
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:bg-secondary cursor-pointer"
                >
                  <Copy size={12} />
                  {copied ? "Copiado" : "Copiar HTML"}
                </button>
              </div>
              {output.unfilledKeys.length > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-600">
                  ⚠ {output.unfilledKeys.length} variable(s) sin llenar:{" "}
                  <code>{output.unfilledKeys.join(", ")}</code>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border p-4">
          <button
            onClick={onClose}
            className={cn(
              "rounded-md border border-border px-3 py-1.5 text-xs",
              "hover:bg-secondary cursor-pointer"
            )}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -10`
Expected: no new errors.

- [ ] **Step 3: Do NOT commit yet** (Task 7 wires it into the page and we commit Phase 4 together)

---

### Task 7: Wire the button into `/platform/templates`

**Files:**
- Modify: `src/app/platform/templates/page.tsx`

- [ ] **Step 1: Add the import**

Find the existing imports at the top. Add:

```ts
import { TestDeliverableModal } from "@/components/templates/test-deliverable-modal";
```

- [ ] **Step 2: Add state**

Find the existing component-level `useState` declarations near the top of the default-exported component. Add:

```ts
const [testTemplateId, setTestTemplateId] = useState<Id<"deliverableTemplates"> | null>(null);
```

(The file already imports `Id` from the dataModel for other state — verify and reuse.)

- [ ] **Step 3: Add the trigger button next to the existing "Vista Previa"**

Find the existing `handlePreview` button (search for `onClick={handlePreview}` around line 566). Add a sibling button:

```tsx
<button
  onClick={() => setTestTemplateId(template._id as Id<"deliverableTemplates">)}
  className="inline-flex items-center gap-2 rounded-md border border-accent/40 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/5 cursor-pointer"
>
  🧪 Probar con datos reales
</button>
```

(Match the indentation and surrounding flex container of the existing "Vista Previa" button.)

- [ ] **Step 4: Mount the modal at the end of the JSX**

At the very end of the component's return statement, before the closing tag of the outermost JSX wrapper, add:

```tsx
{testTemplateId && (
  <TestDeliverableModal
    templateId={testTemplateId}
    onClose={() => setTestTemplateId(null)}
  />
)}
```

- [ ] **Step 5: Verify TypeScript + tests**

Run: `npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -10`
Expected: no new errors.

Run: `npm test`
Expected: all green.

- [ ] **Step 6: Commit Phase 4**

```bash
git add src/components/templates/test-deliverable-modal.tsx src/app/platform/templates/page.tsx
git commit -m "$(cat <<'EOF'
feat(templates): Probar con datos reales modal

Adds a per-template '🧪 Probar con datos reales' button alongside the
existing 'Vista Previa' (which uses synthetic sample data). The new
button opens a modal that lets the operator pick an already-answered
questionnaire, runs the full batched AI pipeline via previewDeliverable,
and renders the resolved HTML in a sandboxed iframe with token/cost
/latency metrics. An amber warning row lists any unfilled placeholders.
Output is ephemeral; closing discards.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5 — Manual QA

### Task 8: Browser walkthrough verifying the test generator end-to-end

**Files:** None (verification only)

- [ ] **Step 1: Ensure dev servers + agent-browser Chrome are running**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001
ps aux | grep "convex dev" | grep -v grep | head -1
ps aux | grep "projex-e2e-chrome" | grep -v grep | head -1
```

If any is missing, restart per the sub-proyecto A's E2E pattern.

- [ ] **Step 2: Verify ANTHROPIC_API_KEY is set in `.env.local`**

Run: `grep -c ANTHROPIC_API_KEY .env.local || echo 0`
Expected: `1`. If `0`, ask the operator to add it before continuing.

- [ ] **Step 3: Open the templates page**

```bash
npx agent-browser open http://localhost:3001/platform/templates
sleep 2
npx agent-browser snapshot -i | head -40
```

Verify the page loaded with template cards. If redirected to `/sign-in`, re-authenticate.

- [ ] **Step 4: Click the "🧪 Probar con datos reales" button on a template**

```bash
npx agent-browser eval "(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Probar con datos reales'));
  if (btn) btn.click();
  return btn ? 'clicked' : 'not-found';
})()"
sleep 1
npx agent-browser eval "(() => /Probar con datos reales/.test(document.body.textContent || '') && /Cuestionario de origen/.test(document.body.textContent || '') ? 'modal-open' : 'no-modal')()"
```

Expected: `modal-open`.

- [ ] **Step 5: Pick a questionnaire and generate**

```bash
npx agent-browser eval "(() => {
  const setSelect = (el, val) => {
    const p = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    p.call(el, val);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const sel = Array.from(document.querySelectorAll('select')).find(s => s.options.length > 1 && /Cuestionario|—/.test(s.options[0].textContent || ''));
  if (sel) setSelect(sel, sel.options[1].value);
  return sel ? 'picked' : 'no-options';
})()"
sleep 1
npx agent-browser eval "(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Generar prueba');
  if (btn) btn.click();
  return btn ? 'generating' : 'no-button';
})()"
sleep 30
npx agent-browser eval "(() => {
  const text = document.body.textContent || '';
  return JSON.stringify({
    hasMetrics: /Tokens:.*USD.*ms/.test(text),
    hasIframe: !!document.querySelector('iframe[title=\"Preview del entregable\"]'),
    hasUnfilledWarning: /variable\\(s\\) sin llenar/.test(text),
  });
})()"
```

Expected: `hasMetrics: true`, `hasIframe: true`, `hasUnfilledWarning: false` (if all keys filled) or `true` (if some unfilled — operator decides whether the template is bad or AI failed).

- [ ] **Step 6: Regenerate and verify second run**

```bash
npx agent-browser eval "(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Regenerar');
  if (btn) btn.click();
  return btn ? 'regen-clicked' : 'not-found';
})()"
sleep 30
npx agent-browser eval "(() => {
  const metrics = Array.from(document.querySelectorAll('span')).find(s => /Tokens:.*USD.*ms/.test(s.textContent || ''));
  return metrics?.textContent?.trim() || 'metrics-not-found';
})()"
```

Expected: a metrics line shows; values may differ slightly between runs due to Claude sampling.

- [ ] **Step 7: Copy HTML and confirm clipboard pickup**

```bash
npx agent-browser eval "(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim().startsWith('Copiar'));
  if (btn) btn.click();
  return btn ? 'copied' : 'not-found';
})()"
sleep 1
npx agent-browser eval "(() => Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Copiado') ? 'feedback-shown' : 'no-feedback')()"
```

Expected: `feedback-shown`.

- [ ] **Step 8: Verify NO deliverable rows were created**

```bash
COUNT=$(npx convex data deliverables --limit 1 2>&1 | grep -c '"_id"')
echo "Deliverable count: $COUNT"
```

The count should be the same as before Step 4. If a row was created, the action is leaking persistence — bug.

- [ ] **Step 9: Close the modal and confirm clean state**

```bash
npx agent-browser eval "(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Cerrar');
  if (btn) btn.click();
  return btn ? 'closed' : 'not-found';
})()"
sleep 1
npx agent-browser eval "(() => /Probar con datos reales/.test(document.body.textContent || '') && /Cuestionario de origen/.test(document.body.textContent || '') ? 'still-open' : 'closed')()"
```

Expected: `closed`.

- [ ] **Step 10: Mark this task complete only if all 9 steps passed**

If any step failed, capture browser console errors and the failing step. File a follow-up before merging.

---

## Self-Review

(Performed inline by the plan author.)

**Spec coverage:**
- § 1 (trigger UI) → Task 7.
- § 2 (modal) → Task 6.
- § 3 (`previewDeliverable` action) → Tasks 4 + 5 (now targets the post-refactor engine: `extractPlaceholders` + `resolveStatic` + `batchFillWithClaude`).
- § 4 (3 new internal queries) → Task 1.
- § 5 (`listTestable` public query) → Tasks 2 + 3.
- § 6 (tests) → Tasks 4 (action tests) + 2 (query tests).
- R1 (cost runaway) — surfaced via metrics row AFTER the run; the engine's hard cap of $2 USD per call already protects against catastrophic runaway via `batchFillWithClaude`. No confirm dialog v1.
- R2 (missing API key) — handled by leaving AI keys as visible `[key]` markers (matches `generateDeliverable`'s behavior); the modal's amber warning row surfaces this to the operator.
- R3 (cross-org) — explicit guard in Task 5's action; tests in Task 4 cover the fail and the global-template allow.
- R4 (no `serviceId`) — Task 5 sets `projService = null` and the prompt context omits the service line.
- R5 (empty `responses`) — `buildContextBlock` writes "Sin respuestas de cuestionario disponibles."; AI may produce generic output; metrics row and the rendered iframe make the gap obvious.

**Placeholder scan:** No `TBD`/`TODO`/"implement later"/"add appropriate error handling" patterns. One `// TODO: component tests deferred` comment in `test-deliverable-modal.tsx` is the documented deferral matching the precedent from sub-proyectos B and C.

**Type consistency:**
- `previewDeliverable` return type `{ html, aiLog, tokensUsed, costUsd, elapsedMs, unfilledKeys }` → consistent across Task 4 test expectations, Task 5 action signature, Task 6 modal's `PreviewOutput` type.
- `listTestable` return shape `{ _id, clientName, projectionYear, status, responseCount }` → consistent across Task 2 tests, Task 3 implementation, Task 6 dropdown rendering.
- Argument shapes `{ templateId, questionnaireId }` → consistent in action signature (Task 5), test calls (Task 4), and modal action call (Task 6).
- Internal query names `getTemplateById`, `getQuestionnaireById`, `findProjServiceByServiceAndProjection` → consistent between definition (Task 1) and consumption (Task 5).
- `AiLogEntry` reused from the existing module-level type in `actions.ts` (not duplicated).

No inconsistencies found.
