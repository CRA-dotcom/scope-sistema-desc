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

    expect(result.html).toContain("Catimi");
    expect(result.html).toContain("60,000,000");
    expect(result.html).toContain("2026");
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
    expect(result.aiLog.length).toBe(1);
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

    expect(result.html).toContain("Catimi");
    expect(result.unfilledKeys).toEqual(["ai_summary"]);
    expect(result.html).toContain("[ai_summary]");
    expect(result.aiLog).toEqual([]);
    expect(result.tokensUsed).toBe(0);
    expect(result.costUsd).toBe(0);

    process.env.ANTHROPIC_API_KEY = "test-key";
  });
});
