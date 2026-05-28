import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

// Capture every prompt Claude is called with so the test can assert what
// gets sent.
const promptCalls: { user: string }[] = [];

function flattenUserContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b: any) => (typeof b === "string" ? b : (b?.text ?? "")))
      .join("\n");
  }
  return "";
}

vi.mock("@anthropic-ai/sdk", () => {
  const defaultCreate = vi.fn(async (params: any) => {
    const userMessage = params.messages?.[0]?.content;
    promptCalls.push({ user: flattenUserContent(userMessage) });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ai_summary: "resumen ok",
          }),
        },
      ],
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    };
  });
  return {
    default: vi
      .fn()
      .mockImplementation(function (this: {
        messages: { create: typeof defaultCreate };
      }) {
        this.messages = { create: defaultCreate };
      }),
  };
});

const TEMPLATE_HTML = `<html><body>
<h1>{{client_name}} — Finanzas</h1>
<p>{{ai_summary}}</p>
</body></html>`;

const ORG_ID = "org_test_ss4_finctx";

type Seeded = {
  clientId: Id<"clients">;
  projServiceId: Id<"projectionServices">;
  assignmentId: Id<"monthlyAssignments">;
  subserviceId: Id<"subservices">;
};

async function seed(
  t: ReturnType<typeof setupTest>,
  isFinancialRelated: boolean
): Promise<Seeded> {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId: ORG_ID,
      name: "Cliente Fiscal",
      rfc: "CFS240115ABC",
      industry: "Servicios",
      annualRevenue: 12_000_000,
      billingFrequency: "mensual" as const,
      isArchived: false,
      createdAt: Date.now(),
    });
    const projectionId = await ctx.db.insert("projections", {
      orgId: ORG_ID,
      clientId,
      year: 2026,
      annualSales: 12_000_000,
      totalBudget: 2_000_000,
      commissionRate: 0,
      seasonalityData: [],
      status: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const serviceId = await ctx.db.insert("services", {
      orgId: ORG_ID,
      name: "Contable",
      type: "base" as const,
      minPct: 0.05,
      maxPct: 0.3,
      defaultPct: 0.18,
      isDefault: true,
      sortOrder: 1,
    });
    const subserviceId = await ctx.db.insert("subservices", {
      orgId: ORG_ID,
      parentServiceId: serviceId,
      name: "Estados Financieros",
      slug: "estados-financieros",
      defaultFrequency: "mensual" as const,
      isActive: true,
      isDefault: true,
      sortOrder: 1,
      isFinancialRelated,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const projServiceId = await ctx.db.insert("projectionServices", {
      orgId: ORG_ID,
      projectionId,
      serviceId,
      serviceName: "Contable",
      subserviceId,
      chosenPct: 0.18,
      isActive: true,
      annualAmount: 360_000,
      normalizedWeight: 0.18,
    });
    const assignmentId = await ctx.db.insert("monthlyAssignments", {
      orgId: ORG_ID,
      projServiceId,
      projectionId,
      clientId,
      serviceName: "Contable",
      subserviceId,
      month: 3,
      year: 2026,
      amount: 30_000,
      feFactor: 1,
      status: "pending" as const,
      invoiceStatus: "not_invoiced" as const,
    });
    await ctx.db.insert("deliverableTemplates", {
      orgId: ORG_ID,
      serviceName: "Contable",
      type: "deliverable_long" as const,
      name: "Contable — finanzas",
      htmlTemplate: TEMPLATE_HTML,
      variables: [],
      version: 1,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { clientId, projServiceId, assignmentId, subserviceId };
  });
}

async function seedValidatedFinancialData(
  t: ReturnType<typeof setupTest>,
  args: { clientId: Id<"clients">; period: string }
): Promise<Id<"clientFinancialData">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("clientFinancialData", {
      orgId: ORG_ID,
      clientId: args.clientId,
      period: args.period,
      periodType: "monthly" as const,
      bucketKey: `${ORG_ID}/${args.clientId}/finanzas/${args.period}.xlsx`,
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: 1000,
      filename: `${args.period}.xlsx`,
      lineItems: [
        { label: "Ingresos por servicios", amount: 250000, category: "ingresos" as const },
        { label: "Renta de oficina", amount: 30000, category: "gastos_operativos" as const },
        { label: "ISR provisional", amount: 25000, category: "impuestos" as const },
      ],
      status: "validated" as const,
      uploadedBy: "u1",
      uploadedAt: Date.now(),
      validatedAt: Date.now(),
      validatedBy: "u1",
    })
  );
}

beforeEach(() => {
  promptCalls.length = 0;
  process.env.ANTHROPIC_API_KEY = "test-key";
});

describe("generateDeliverable — SS4 financial context injection", () => {
  it("does NOT include financial section when subservice.isFinancialRelated=false", async () => {
    const t = setupTest();
    const { clientId, projServiceId, assignmentId } = await seed(t, false);
    await seedValidatedFinancialData(t, { clientId, period: "2026-02" });

    await t.action(api.functions.deliverables.actions.generateDeliverable, {
      assignmentId,
      projServiceId,
      clientId,
      templateType: "deliverable_long",
    });

    expect(promptCalls.length).toBeGreaterThan(0);
    const allUserPrompts = promptCalls.map((p) => p.user).join("\n");
    expect(allUserPrompts).not.toContain("DATOS FINANCIEROS DEL CLIENTE");
  });

  it("includes financial section when subservice.isFinancialRelated=true and validated data exists", async () => {
    const t = setupTest();
    const { clientId, projServiceId, assignmentId } = await seed(t, true);
    await seedValidatedFinancialData(t, { clientId, period: "2026-02" });

    await t.action(api.functions.deliverables.actions.generateDeliverable, {
      assignmentId,
      projServiceId,
      clientId,
      templateType: "deliverable_long",
    });

    expect(promptCalls.length).toBeGreaterThan(0);
    const allUserPrompts = promptCalls.map((p) => p.user).join("\n");
    expect(allUserPrompts).toContain("DATOS FINANCIEROS DEL CLIENTE");
    expect(allUserPrompts).toContain("2026-02");
    expect(allUserPrompts).toContain("Ingresos por servicios");
    expect(allUserPrompts).toContain("Renta de oficina");
    expect(allUserPrompts).toContain("ISR provisional");
  });

  it("omits financial section when isFinancialRelated=true but no validated data exists", async () => {
    const t = setupTest();
    const { clientId, projServiceId, assignmentId } = await seed(t, true);
    // No financial data seeded → context should be null and prompt unchanged.

    await t.action(api.functions.deliverables.actions.generateDeliverable, {
      assignmentId,
      projServiceId,
      clientId,
      templateType: "deliverable_long",
    });

    const allUserPrompts = promptCalls.map((p) => p.user).join("\n");
    expect(allUserPrompts).not.toContain("DATOS FINANCIEROS DEL CLIENTE");
  });

  it("ignores non-validated financial rows (extracted/rejected/uploaded)", async () => {
    const t = setupTest();
    const { clientId, projServiceId, assignmentId } = await seed(t, true);
    // Insert an extracted row (not validated) → should be ignored.
    await t.run(async (ctx) =>
      ctx.db.insert("clientFinancialData", {
        orgId: ORG_ID,
        clientId,
        period: "2026-02",
        periodType: "monthly" as const,
        bucketKey: `${ORG_ID}/${clientId}/finanzas/x.xlsx`,
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sizeBytes: 1000,
        filename: "x.xlsx",
        lineItems: [
          { label: "DEBE_FILTRARSE", amount: 100, category: "otros" as const },
        ],
        status: "extracted" as const,
        uploadedBy: "u1",
        uploadedAt: Date.now(),
      })
    );

    await t.action(api.functions.deliverables.actions.generateDeliverable, {
      assignmentId,
      projServiceId,
      clientId,
      templateType: "deliverable_long",
    });

    const allUserPrompts = promptCalls.map((p) => p.user).join("\n");
    expect(allUserPrompts).not.toContain("DEBE_FILTRARSE");
  });
});
