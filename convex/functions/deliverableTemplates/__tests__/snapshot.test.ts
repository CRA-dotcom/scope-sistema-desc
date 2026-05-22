import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { api, internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

// ── Anthropic SDK mock (matches generateDeliverable.refactor.test.ts) ─────
vi.mock("@anthropic-ai/sdk", () => {
  const create = vi.fn(async () => ({
    content: [{ type: "text", text: JSON.stringify({}) }],
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  }));
  return {
    default: vi
      .fn()
      .mockImplementation(function (this: {
        messages: { create: typeof create };
      }) {
        this.messages = { create };
      }),
  };
});

const ORG_ID = "org_test_snapshot";
const TEMPLATE_HTML = "<p>Hola {{client_name}} — {{branding_company_name}}</p>";

type Seed = {
  clientId: Id<"clients">;
  projServiceId: Id<"projectionServices">;
  assignmentId: Id<"monthlyAssignments">;
  templateId: Id<"deliverableTemplates">;
};

async function seedFixture(
  t: ReturnType<typeof setupTest>,
  templateOverrides: Partial<{
    version: number;
    htmlTemplate: string;
    isActive: boolean;
  }> = {},
): Promise<Seed> {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId: ORG_ID,
      name: "Snapshot Client",
      rfc: "SNA240115ABC",
      industry: "x",
      annualRevenue: 1000,
      billingFrequency: "mensual" as const,
      isArchived: false,
      createdAt: Date.now(),
    });
    const projectionId = await ctx.db.insert("projections", {
      orgId: ORG_ID,
      clientId,
      year: 2026,
      annualSales: 1000,
      totalBudget: 100,
      commissionRate: 0,
      seasonalityData: [],
      status: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const serviceId = await ctx.db.insert("services", {
      orgId: ORG_ID,
      name: "Marketing",
      type: "base" as const,
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
      annualAmount: 18,
      normalizedWeight: 0.18,
    });
    const subserviceId = await ctx.db.insert("subservices", {
      orgId: ORG_ID,
      parentServiceId: serviceId,
      name: "Test Subservice",
      slug: "test-subservice",
      defaultFrequency: "mensual",
      isActive: true,
      isDefault: true,
      sortOrder: 10,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const assignmentId = await ctx.db.insert("monthlyAssignments", {
      orgId: ORG_ID,
      projServiceId,
      projectionId,
      clientId,
      serviceName: "Marketing",
      subserviceId,
      month: 5,
      year: 2026,
      amount: 1,
      feFactor: 1,
      status: "pending" as const,
      invoiceStatus: "not_invoiced" as const,
    });
    const templateId = await ctx.db.insert("deliverableTemplates", {
      orgId: ORG_ID,
      serviceId,
      serviceName: "Marketing",
      type: "deliverable_long",
      name: "Snapshot template",
      htmlTemplate: templateOverrides.htmlTemplate ?? TEMPLATE_HTML,
      variables: [],
      version: templateOverrides.version ?? 5,
      isActive: templateOverrides.isActive ?? true,
      parentTemplateId: undefined,
      originalVersionAtClone: undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { clientId, projServiceId, assignmentId, templateId };
  });
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
});

describe("deliverables snapshot por valor (A2)", () => {
  // Test #12 — deliverables row stores templateId + version + html snapshot
  it("guarda templateId, templateVersion y templateHtmlSnapshot al generar", async () => {
    const t = setupTest();
    const seed = await seedFixture(t, {
      version: 5,
      htmlTemplate: TEMPLATE_HTML,
    });

    const deliverableId = await t.action(
      api.functions.deliverables.actions.generateDeliverable,
      {
        assignmentId: seed.assignmentId,
        projServiceId: seed.projServiceId,
        clientId: seed.clientId,
        templateType: "deliverable_long",
      },
    );

    const saved = await t.run((ctx) =>
      ctx.db.get(deliverableId as Id<"deliverables">),
    );
    expect(saved).toBeTruthy();
    expect(saved!.templateId).toBe(seed.templateId);
    expect(saved!.templateVersion).toBe(5);
    expect(saved!.templateHtmlSnapshot).toBe(TEMPLATE_HTML);
  });

  // Test #13 — re-render with snapshot survives template mutation.
  it("audit re-render usa el snapshot aunque la plantilla cambie luego", async () => {
    const t = setupTest();
    const seed = await seedFixture(t, {
      version: 5,
      htmlTemplate: "<h1>A {{client_name}}</h1>",
    });

    const deliverableId = await t.action(
      api.functions.deliverables.actions.generateDeliverable,
      {
        assignmentId: seed.assignmentId,
        projServiceId: seed.projServiceId,
        clientId: seed.clientId,
        templateType: "deliverable_long",
      },
    );

    // Plantilla muta a HTML completamente distinto + version 6.
    await t.run(async (ctx) => {
      await ctx.db.patch(seed.templateId, {
        htmlTemplate: "<h1>B {{client_name}}</h1>",
        version: 6,
        updatedAt: Date.now(),
      });
    });

    const saved = await t.run((ctx) =>
      ctx.db.get(deliverableId as Id<"deliverables">),
    );
    // El snapshot conserva el HTML al momento de generación, no el mutado.
    expect(saved!.templateHtmlSnapshot).toBe("<h1>A {{client_name}}</h1>");
    expect(saved!.templateHtmlSnapshot).not.toContain("<h1>B");
    // El contenido renderizado (longContent) también refleja la versión vieja.
    expect(saved!.longContent).toContain("Snapshot Client");
  });
});

describe("internalQueries.getResolvedForGeneration", () => {
  it("resuelve org-scoped sobre global con mismo type", async () => {
    const t = setupTest();
    const seed = await seedFixture(t);
    const got = await t.run((ctx) =>
      ctx.runQuery(
        internal.functions.deliverables.internalQueries
          .getResolvedForGeneration,
        {
          orgId: ORG_ID,
          type: "deliverable_long",
          serviceName: "Marketing",
        },
      ),
    );
    expect(got?._id).toBe(seed.templateId);
  });
});
