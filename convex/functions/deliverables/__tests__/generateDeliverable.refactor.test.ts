import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

// ── Anthropic SDK mock ───────────────────────────────────────────────────
// Default response fills every AI placeholder used by TEMPLATE_HTML below.
// Individual tests can override via `mockImplementationOnce` on the
// `default` (constructor) export to swap in a partial-response stub.

vi.mock("@anthropic-ai/sdk", () => {
  const defaultCreate = vi.fn(async () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          ai_finding_a1: "Hallazgo de prueba 1",
          ai_finding_a2: "Hallazgo de prueba 2",
          ai_score_overall: "82",
        }),
      },
    ],
    usage: {
      input_tokens: 1000,
      output_tokens: 100,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  }));
  // Constructable mock — `new Anthropic({...})` must work.
  return {
    default: vi.fn().mockImplementation(function (this: { messages: { create: typeof defaultCreate } }) {
      this.messages = { create: defaultCreate };
    }),
  };
});

const TEMPLATE_HTML = `
<html><body>
  <h1>{{client_name}} — {{service_name}}</h1>
  <p>Año: {{projection_year}}, presupuesto: {{projection_total_budget}}</p>
  <p>Generado el {{current_date}} por {{branding_company_name}}</p>
  <section>
    <h2>Hallazgos</h2>
    <ul>
      <li>{{ai_finding_a1}}</li>
      <li>{{ai_finding_a2}}</li>
    </ul>
    <p>Score global: {{ai_score_overall}}</p>
  </section>
</body></html>
`;

const ORG_ID = "org_test_deliverable_refactor";

type SeededIds = {
  clientId: Id<"clients">;
  projectionId: Id<"projections">;
  serviceId: Id<"services">;
  projServiceId: Id<"projectionServices">;
  assignmentId: Id<"monthlyAssignments">;
};

async function seedFixture(t: ReturnType<typeof setupTest>): Promise<SeededIds> {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId: ORG_ID,
      name: "Katimi SA",
      rfc: "KAT240115ABC",
      industry: "Manufactura",
      annualRevenue: 31_200_000,
      billingFrequency: "mensual",
      isArchived: false,
      createdAt: Date.now(),
    });

    const projectionId = await ctx.db.insert("projections", {
      orgId: ORG_ID,
      clientId,
      year: 2026,
      annualSales: 31_200_000,
      totalBudget: 4_500_000,
      commissionRate: 0,
      seasonalityData: [],
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const serviceId = await ctx.db.insert("services", {
      orgId: ORG_ID,
      name: "Marketing",
      type: "base",
      minPct: 0.05,
      maxPct: 0.3,
      defaultPct: 0.18,
      isDefault: true,
      sortOrder: 1,
    });

    const projServiceId = await ctx.db.insert("projectionServices", {
      orgId: ORG_ID,
      projectionId,
      serviceId,
      serviceName: "Marketing",
      chosenPct: 0.18,
      isActive: true,
      annualAmount: 810_000,
      normalizedWeight: 0.18,
    });

    const assignmentId = await ctx.db.insert("monthlyAssignments", {
      orgId: ORG_ID,
      projServiceId,
      projectionId,
      clientId,
      serviceName: "Marketing",
      month: 5,
      year: 2026,
      amount: 67_500,
      feFactor: 1,
      status: "pending",
      invoiceStatus: "not_invoiced",
    });

    await ctx.db.insert("deliverableTemplates", {
      orgId: ORG_ID,
      serviceName: "Marketing",
      type: "deliverable_long",
      name: "Marketing — Refactor test template",
      htmlTemplate: TEMPLATE_HTML,
      variables: [],
      version: 1,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return { clientId, projectionId, serviceId, projServiceId, assignmentId };
  });
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
});

describe("generateDeliverable (refactored) — end-to-end", () => {
  it("renders all static + AI placeholders; persists deliverable as pending", async () => {
    const t = setupTest();
    const { clientId, projServiceId, assignmentId } = await seedFixture(t);

    const deliverableId = await t.action(
      api.functions.deliverables.actions.generateDeliverable,
      {
        assignmentId,
        projServiceId,
        clientId,
        templateType: "deliverable_long",
      }
    );

    const saved = await t.run(async (ctx) =>
      ctx.db.get(deliverableId as Id<"deliverables">)
    );

    expect(saved).toBeTruthy();
    expect(saved!.longContent).toBeTruthy();
    expect(saved!.shortContent).toBe("");

    // No raw {{key}} placeholders remain
    expect(/\{\{[a-zA-Z0-9_]+\}\}/.test(saved!.longContent)).toBe(false);
    // Static fills
    expect(saved!.longContent).toContain("Katimi SA");
    expect(saved!.longContent).toContain("Marketing");
    expect(saved!.longContent).toContain("2026");
    expect(saved!.longContent).toContain("Projex"); // branding default companyName
    // AI fills
    expect(saved!.longContent).toContain("Hallazgo de prueba 1");
    expect(saved!.longContent).toContain("Hallazgo de prueba 2");
    expect(saved!.longContent).toContain("82");

    // Audit status pending (no unfilled keys, scheduled audit hasn't run)
    expect(saved!.auditStatus).toBe("pending");
    expect(saved!.auditFeedback).toBeUndefined();

    // At least one aiLog entry (one chunk)
    expect((saved!.aiLog ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it("marks deliverable rejected with unfilledKeys when AI returns partial JSON", async () => {
    // Override the Anthropic constructor for THIS test only — every
    // client.messages.create() call returns the partial response.
    const AnthropicModule = await import("@anthropic-ai/sdk");
    const partialCreate = vi.fn(async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({ ai_finding_a1: "Solo este" }),
        },
      ],
      usage: {
        input_tokens: 1000,
        output_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    }));
    (
      AnthropicModule.default as unknown as ReturnType<typeof vi.fn>
    ).mockImplementationOnce(function (this: { messages: { create: typeof partialCreate } }) {
      this.messages = { create: partialCreate };
    });

    const t = setupTest();
    const { clientId, projServiceId, assignmentId } = await seedFixture(t);

    const deliverableId = await t.action(
      api.functions.deliverables.actions.generateDeliverable,
      {
        assignmentId,
        projServiceId,
        clientId,
        templateType: "deliverable_long",
      }
    );

    const saved = await t.run(async (ctx) =>
      ctx.db.get(deliverableId as Id<"deliverables">)
    );

    expect(saved).toBeTruthy();
    expect(saved!.auditStatus).toBe("rejected");
    expect(saved!.auditFeedback).toBeDefined();

    const fb = JSON.parse(saved!.auditFeedback!) as {
      reason: string;
      unfilledKeys: string[];
      costUsd: number | null;
    };
    expect(fb.reason).toBe("incomplete_render");
    // ai_finding_a1 was filled; the other two AI keys were not
    expect(fb.unfilledKeys).toEqual(["ai_finding_a2", "ai_score_overall"]);

    // Unfilled keys render as visible <em>[key]</em> markers in the HTML
    expect(saved!.longContent).toContain('<em style="color:#94a3b8">[ai_finding_a2]</em>');
    expect(saved!.longContent).toContain('<em style="color:#94a3b8">[ai_score_overall]</em>');
    // Filled key shows its value, not a marker
    expect(saved!.longContent).toContain("Solo este");
    // No raw {{...}} braces remain
    expect(/\{\{[a-zA-Z0-9_]+\}\}/.test(saved!.longContent)).toBe(false);
  });
});
