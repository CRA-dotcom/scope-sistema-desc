# Deliverables — Sub-proyecto F (test generator) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an ephemeral "Probar con datos reales" modal on `/platform/templates` that pairs a saved template with an already-answered questionnaire, runs the full Claude AI pipeline server-side via a new `previewDeliverable` action, and renders the resulting HTML in an iframe with token/cost/latency metrics. No persistence.

**Architecture:** Three thin layers. (1) Three new internal queries that fetch `template`, `questionnaire`, and the matching `projectionService` by ids; (2) a new public `previewDeliverable` action that reuses the existing `resolveNonAiVariables` + `callClaudeWithRetry` helpers from `generateDeliverable` but returns `{ html, aiLog, tokensUsed, costUsd, elapsedMs }` without writing to the `deliverables` table; (3) a modal component triggered from the template card.

**Tech Stack:** Convex (action + queries), Next.js App Router, React 19, vitest + convex-test, Anthropic SDK (already wired). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-12-deliverables-test-generator-F-design.md`

---

## File Structure

**Files modified:**
- `convex/functions/deliverables/internalQueries.ts` — add `getTemplateById`, `getQuestionnaireById`, `findProjServiceByServiceAndProjection`.
- `convex/functions/deliverables/actions.ts` — add `previewDeliverable` action at the end (reusing existing helpers).
- `convex/functions/questionnaires/queries.ts` — add `listTestable` public query.
- `src/app/platform/templates/page.tsx` — add "🧪 Probar con datos reales" button per template + modal mount state.

**Files created:**
- `convex/functions/deliverables/__tests__/previewDeliverable.test.ts` — TDD tests for the action.
- `convex/functions/questionnaires/__tests__/listTestable.test.ts` — tests for the dropdown query.
- `src/components/templates/test-deliverable-modal.tsx` — modal with dropdown + iframe + metrics row.

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
Expected: 334+ tests PASS (no behavior changes yet).

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

## Phase 3 — `previewDeliverable` action (TDD)

### Task 4: Write failing tests for `previewDeliverable`

**Files:**
- Create: `convex/functions/deliverables/__tests__/previewDeliverable.test.ts`

- [ ] **Step 1: Read the existing action test pattern**

Run: `head -90 convex/functions/deliverables/__tests__/generateDeliverable.refactor.test.ts`

Note: mocks `@anthropic-ai/sdk`, seeds clients/projections/templates, calls actions via `t.action(...)`.

- [ ] **Step 2: Write the test file**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

vi.mock("@anthropic-ai/sdk", () => {
  const defaultCreate = vi.fn(async () => ({
    content: [{ type: "text", text: "Mocked AI content." }],
    usage: {
      input_tokens: 500,
      output_tokens: 100,
      cache_creation_input_tokens: 0,
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

const TEMPLATE_HTML_NON_AI = `<p>Cliente: {{client_name}}, ventas: {{projection_annual_sales}}</p>`;

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
      variables: [
        { key: "client_name", label: "Nombre del cliente", source: "client" as const, required: true },
        { key: "projection_annual_sales", label: "Ventas anuales", source: "projection" as const, required: true },
      ],
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
      variables: [
        { key: "client_name", label: "Nombre del cliente", source: "client" as const, required: true },
        { key: "ai_summary", label: "Resumen ejecutivo", source: "ai" as const, required: true },
      ],
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
  it("template without AI variables: html contains substitutions, aiLog empty, no DB writes", async () => {
    const t = setupTest();
    const { questionnaireId, templateNonAiId } = await seedFixture(t, ORG_A);

    const before = await t.run(async (ctx) =>
      (await ctx.db.query("deliverables").collect()).length
    );

    const result = await t.action(
      api.functions.deliverables.actions.previewDeliverable,
      { templateId: templateNonAiId, questionnaireId }
    );

    expect(result.html).toContain("Catimi");
    expect(result.html).toContain("60,000,000");
    expect(result.aiLog).toEqual([]);
    expect(result.tokensUsed).toBe(0);
    expect(result.costUsd).toBe(0);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);

    const after = await t.run(async (ctx) =>
      (await ctx.db.query("deliverables").collect()).length
    );
    expect(after).toBe(before);
  });

  it("template with AI variables: calls Claude, returns aiLog and metrics", async () => {
    const t = setupTest();
    const { questionnaireId, templateWithAiId } = await seedFixture(t, ORG_A);

    const result = await t.action(
      api.functions.deliverables.actions.previewDeliverable,
      { templateId: templateWithAiId, questionnaireId }
    );

    expect(result.html).toContain("Catimi");
    expect(result.html).toContain("Mocked AI content.");
    expect(result.aiLog.length).toBeGreaterThan(0);
    expect(result.tokensUsed).toBeGreaterThan(0);
    expect(result.costUsd).toBeGreaterThan(0);
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
        variables: [
          { key: "client_name", label: "Cliente", source: "client" as const, required: true },
        ],
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
});
```

- [ ] **Step 3: Run to confirm FAIL**

Run: `npx vitest run convex/functions/deliverables/__tests__/previewDeliverable.test.ts`
Expected: all 6 tests FAIL with "previewDeliverable is not a function" or "Could not find module".

- [ ] **Step 4: Do NOT commit yet** (Task 5 implements + commits Phase 3 together)

---

### Task 5: Implement `previewDeliverable`

**Files:**
- Modify: `convex/functions/deliverables/actions.ts` (append after `auditDeliverable` action, before any closing barriers)

- [ ] **Step 1: Locate the end of the existing action exports**

Run: `grep -n "^export const\|^export async" convex/functions/deliverables/actions.ts`

Expected outputs include `generateDeliverable` (line 156), `auditDeliverable` (line 338), `regenerateDeliverable` (line 468). Find the line AFTER the closing `});` of `auditDeliverable`'s handler. Append the new export there. (`regenerateDeliverable` is an `internalAction` — keep it where it is.)

- [ ] **Step 2: Append the action**

Insert this code in `convex/functions/deliverables/actions.ts` after `auditDeliverable`:

```ts
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

    const [client, projection] = await Promise.all([
      ctx.runQuery(
        internal.functions.deliverables.internalQueries.getClientData,
        { clientId: questionnaire.clientId }
      ),
      ctx.runQuery(
        internal.functions.deliverables.internalQueries.getProjectionByProjService,
        { projectionId: questionnaire.projectionId }
      ),
    ]);
    if (!client) throw new Error("Cliente del cuestionario no encontrado.");
    if (!projection) throw new Error("Proyección del cuestionario no encontrada.");

    let projService: {
      serviceName?: string;
      chosenPct?: number;
      annualAmount?: number;
    } | null = null;
    if (template.serviceId) {
      projService = await ctx.runQuery(
        internal.functions.deliverables.internalQueries.findProjServiceByServiceAndProjection,
        { projectionId: questionnaire.projectionId, serviceId: template.serviceId }
      );
    }

    const context = {
      client: client as unknown as Record<string, unknown>,
      projection: projection as unknown as Record<string, unknown>,
      service: (projService ?? {}) as unknown as Record<string, unknown>,
    };
    const { html: htmlAfterNonAi, aiVariables } = resolveNonAiVariables(
      template.htmlTemplate,
      template.variables,
      context
    );

    const anthropic = getAnthropicClient();
    if (aiVariables.length > 0 && !anthropic) {
      throw new Error(
        "ANTHROPIC_API_KEY no configurada. Agrega la key en .env.local para correr generaciones AI."
      );
    }

    const questionnaireContext = questionnaire.responses
      ? questionnaire.responses
          .map(
            (r: { questionText: string; answer: string }) =>
              `P: ${r.questionText}\nR: ${r.answer}`
          )
          .join("\n\n")
      : "Sin respuestas de cuestionario disponibles.";

    const projectionContext = `Ventas anuales: $${projection.annualSales.toLocaleString(
      "es-MX"
    )}, Presupuesto total: $${projection.totalBudget.toLocaleString(
      "es-MX"
    )}, Comision: ${projection.commissionRate * 100}%`;

    let resolvedHtml = htmlAfterNonAi;
    const aiLogs: AiLogEntry[] = [];

    for (const aiVar of aiVariables) {
      const result = await callClaudeWithRetry(
        anthropic!,
        `Eres un consultor profesional${
          projService?.serviceName ? ` de ${projService.serviceName}` : ""
        }. Genera contenido para un entregable empresarial.`,
        `Variable: ${aiVar.label}.\n\nContexto del cliente: ${client.name}, industria: ${client.industry}.\n\nDatos financieros: ${projectionContext}\n\n${
          projService?.serviceName
            ? `Servicio: ${projService.serviceName} (${projService.chosenPct}% del presupuesto, monto anual: $${(projService.annualAmount ?? 0).toLocaleString("es-MX")})\n\n`
            : ""
        }Respuestas del cuestionario:\n${questionnaireContext}\n\nGenera el contenido en español profesional. Responde únicamente con el contenido solicitado, sin encabezados ni explicaciones adicionales.`
      );

      resolvedHtml = resolvedHtml.replace(
        new RegExp(escapeRegex(`{{${aiVar.key}}}`), "g"),
        result.text
      );
      resolvedHtml = resolvedHtml.replace(
        new RegExp(escapeRegex("[AI_PENDIENTE]"), "g"),
        ""
      );
      aiLogs.push(result.log);
    }

    const tokensUsed = aiLogs.reduce(
      (acc, l) => acc + l.inputTokens + l.outputTokens,
      0
    );
    const costUsd = aiLogs.reduce((acc, l) => acc + l.costUsd, 0);
    const elapsedMs = Date.now() - t0;

    return { html: resolvedHtml, aiLog: aiLogs, tokensUsed, costUsd, elapsedMs };
  },
});
```

- [ ] **Step 3: Regenerate types**

Run: `npx convex dev --once`
Expected: success.

- [ ] **Step 4: Run the test file**

Run: `npx vitest run convex/functions/deliverables/__tests__/previewDeliverable.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 6: Commit Phase 3**

```bash
git add convex/functions/deliverables/actions.ts convex/functions/deliverables/__tests__/previewDeliverable.test.ts convex/_generated/
git commit -m "$(cat <<'EOF'
feat(deliverables): previewDeliverable action for real-data test runs

Pairs a saved template with an already-answered questionnaire, runs the
full Claude pipeline (reusing resolveNonAiVariables + callClaudeWithRetry
from generateDeliverable), and returns the resolved HTML plus token/cost
/latency metrics. No persistence — output is intended for an ephemeral
preview modal.

Enforces cross-org safety: org-scoped templates must match the
questionnaire's org; global templates (orgId undefined) work everywhere.

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
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Variables AI: {output.aiLog.length} · Tokens:{" "}
                  {output.tokensUsed.toLocaleString("es-MX")} · ~$
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

- [ ] **Step 1: Add the import + state**

Find the existing imports at the top. Add:

```ts
import { TestDeliverableModal } from "@/components/templates/test-deliverable-modal";
```

Find the existing component-level `useState` declarations (search for `useState<` near the top of the default-exported component). Add alongside them:

```ts
const [testTemplateId, setTestTemplateId] = useState<Id<"deliverableTemplates"> | null>(null);
```

(`Id` should already be imported from the dataModel since other state already uses it; if not, add `import { Id } from "../../../../convex/_generated/api"` style import that the file already uses.)

- [ ] **Step 2: Add the trigger button next to the existing "Vista Previa"**

Find the existing `handlePreview` invocation. The button is rendered around line 566 inside a template card. Add a sibling button right after it:

```tsx
<button
  onClick={() => setTestTemplateId(template._id as Id<"deliverableTemplates">)}
  className="inline-flex items-center gap-2 rounded-md border border-accent/40 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/5 cursor-pointer"
>
  🧪 Probar con datos reales
</button>
```

(Inspect the existing "Vista Previa" button to copy its container/layout class — match indentation and surrounding flex container.)

- [ ] **Step 3: Mount the modal at the end of the JSX**

At the very end of the component's return statement, before the closing tag, add:

```tsx
{testTemplateId && (
  <TestDeliverableModal
    templateId={testTemplateId}
    onClose={() => setTestTemplateId(null)}
  />
)}
```

- [ ] **Step 4: Verify TypeScript + tests**

Run: `npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -10`
Expected: no new errors.

Run: `npm test`
Expected: all tests PASS (no behavior change in test surface).

- [ ] **Step 5: Commit Phase 4**

```bash
git add src/components/templates/test-deliverable-modal.tsx src/app/platform/templates/page.tsx
git commit -m "$(cat <<'EOF'
feat(templates): Probar con datos reales modal

Adds a per-template '🧪 Probar con datos reales' button alongside the
existing 'Vista Previa' (which uses synthetic sample data). The new
button opens a modal that lets the operator pick an already-answered
questionnaire, runs the full AI pipeline via previewDeliverable, and
renders the resolved HTML in a sandboxed iframe with token/cost/latency
metrics. Output is ephemeral; closing discards.

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
# Confirm Next.js on 3001
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001
# Should print 200 or 404 (not connection refused).

# Convex dev
ps aux | grep "convex dev" | grep -v grep | head -1
# Should show the process.

# Agent-browser profile
ps aux | grep "projex-e2e-chrome" | grep -v grep | head -1
# Should show the headed Chrome process.
```

If any is missing, restart per sub-proyecto A's QA pattern.

- [ ] **Step 2: Verify ANTHROPIC_API_KEY is set in `.env.local`**

Run: `grep -c ANTHROPIC_API_KEY .env.local || echo 0`
Expected: `1` (key present). If `0`, ask the operator to add it before continuing — the AI path needs a real key (the tests use a mock; the browser uses the real client).

- [ ] **Step 3: Navigate to the platform templates page**

```bash
npx agent-browser open http://localhost:3001/platform/templates
sleep 2
npx agent-browser snapshot -i | head -40
```

Verify the page loaded with template cards. If redirected to `/sign-in`, the Chrome session expired — re-authenticate per sub-proyecto A's pattern.

- [ ] **Step 4: Click the "🧪 Probar con datos reales" button on the first template**

```bash
npx agent-browser eval "(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Probar con datos reales'));
  if (btn) btn.click();
  return btn ? 'clicked' : 'not-found';
})()"
sleep 1
npx agent-browser snapshot -i | grep -B1 -A2 'Probar\|Cuestionario\|Selecciona' | head -20
```

Expected: modal appears with the title "Probar con datos reales", template name, and a dropdown labeled "Cuestionario de origen".

- [ ] **Step 5: Pick a questionnaire and generate**

```bash
npx agent-browser eval "(() => {
  const setSelect = (el, val) => {
    const p = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    p.call(el, val);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const sel = Array.from(document.querySelectorAll('select')).find(s => s.options.length > 1);
  if (sel) setSelect(sel, sel.options[1].value);
  return sel ? 'picked' : 'no-options';
})()"
sleep 1
npx agent-browser eval "(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Generar prueba');
  if (btn) btn.click();
  return btn ? 'generating' : 'no-button';
})()"
# Wait up to 60s for AI generation
sleep 30
npx agent-browser snapshot -i | head -30
```

Expected: an iframe with rendered HTML appears. Below it, a metrics row showing `Variables AI: N · Tokens: ...K · ~$0.... USD · ...ms`.

- [ ] **Step 6: Regenerate and verify it re-runs**

```bash
npx agent-browser eval "(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Regenerar');
  if (btn) btn.click();
  return btn ? 'regen-clicked' : 'not-found';
})()"
sleep 30
npx agent-browser eval "(() => {
  // Capture the metrics row text
  const ps = Array.from(document.querySelectorAll('span,p,div'));
  const metrics = ps.find(p => /Variables AI:.*Tokens:.*USD.*ms/.test(p.textContent || ''));
  return metrics?.textContent?.trim() || 'metrics-not-found';
})()"
```

Expected: a second `Variables AI: ... · Tokens: ... · ~$... USD · ...ms` line appears (metrics may differ slightly due to Claude sampling).

- [ ] **Step 7: Copy HTML and confirm clipboard pickup**

```bash
npx agent-browser eval "(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim().startsWith('Copiar'));
  if (btn) btn.click();
  return btn ? 'copied' : 'not-found';
})()"
sleep 1
npx agent-browser eval "(() => {
  return Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Copiado') ? 'feedback-shown' : 'no-feedback';
})()"
```

Expected: button briefly flips to "Copiado".

- [ ] **Step 8: Verify NO deliverable rows were created**

```bash
COUNT=$(npx convex data deliverables --limit 1 2>&1 | grep -c '"_id"')
echo "Deliverable count: $COUNT"
```

The count should be the same as before Step 4. (If a row was created, the action is leaking persistence — bug.)

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
- § 3 (`previewDeliverable` action) → Task 5.
- § 4 (3 new internal queries) → Task 1.
- § 5 (`listTestable` public query) → Tasks 2, 3.
- § 6 (tests) → Tasks 4 (action tests), 2 (query tests).
- R1 (cost runaway): metrics row in Task 6 surfaces the cost AFTER the run; no confirm dialog v1 (spec deferred).
- R2 (missing API key): action throws (`"ANTHROPIC_API_KEY no configurada..."`), modal shows in error banner (Task 6 handles this generically via the `error` state).
- R3 (cross-org): explicit guard in Task 5's action code; covered by test "cross-org pairing throws" and "global template works" in Task 4.
- R4 (no `serviceId`): Task 5's action treats `projService` as null and the AI prompts omit the service line.
- R5 (empty `responses`): the `questionnaireContext` falls back to `"Sin respuestas de cuestionario disponibles."` — visible to the operator via the rendered output.

**Placeholder scan:** No `TBD`/`TODO`/"implement later"/"add appropriate error handling" patterns. The single `// TODO: component tests deferred` comment in `test-deliverable-modal.tsx` is a documented deferral matching the precedent from sub-proyecto B Task 3 and C Task 3.

**Type consistency:**
- `previewDeliverable` return type `{ html, aiLog, tokensUsed, costUsd, elapsedMs }` → consistent across Task 4 test expectations, Task 5 action signature, Task 6 modal's `PreviewOutput` type.
- `listTestable` return shape `{ _id, clientName, projectionYear, status, responseCount }` → consistent across Task 2 tests, Task 3 implementation, Task 6 dropdown rendering.
- Argument shapes `{ templateId, questionnaireId }` → consistent in action signature (Task 5), test calls (Task 4), and modal action call (Task 6).
- Internal query names `getTemplateById`, `getQuestionnaireById`, `findProjServiceByServiceAndProjection` → consistent between definition (Task 1) and consumption (Task 5).

No inconsistencies found.
