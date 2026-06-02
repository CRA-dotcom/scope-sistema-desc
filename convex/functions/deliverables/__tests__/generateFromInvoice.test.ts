import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTest, ORG_A, ORG_B } from "../../../../tests/harness";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

// Mock Anthropic so generateDeliverable doesn't actually call the API.
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

const TEMPLATE_HTML = "<p>{{client_name}} - Marketing - {{current_date}}</p>";

type Seeded = {
  invoiceId: Id<"invoices">;
  clientId: Id<"clients">;
  projectionId: Id<"projections">;
  serviceId: Id<"services">;
  subserviceId: Id<"subservices">;
  projServiceId: Id<"projectionServices">;
  monthlyAssignmentId: Id<"monthlyAssignments">;
  templateId: Id<"deliverableTemplates">;
};

async function seedWithTemplate(
  t: ReturnType<typeof setupTest>,
  orgId: string,
  opts: { paid: boolean; createTemplate: boolean } = {
    paid: true,
    createTemplate: true,
  }
): Promise<Seeded> {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId,
      name: "Acme",
      rfc: "ACM240115ABC",
      industry: "X",
      annualRevenue: 1_000_000,
      billingFrequency: "mensual" as const,
      isArchived: false,
      contactEmail: "ops@acme.test",
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
    const serviceId = await ctx.db.insert("services", {
      orgId,
      name: "Marketing",
      type: "base" as const,
      minPct: 0.1,
      maxPct: 0.3,
      defaultPct: 0.18,
      isDefault: true,
      sortOrder: 1,
    });
    const subserviceId = await ctx.db.insert("subservices", {
      orgId,
      parentServiceId: serviceId,
      name: "Boletín",
      slug: "boletin",
      defaultFrequency: "mensual" as const,
      isActive: true,
      isDefault: true,
      sortOrder: 10,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const projServiceId = await ctx.db.insert("projectionServices", {
      orgId,
      projectionId,
      serviceId,
      serviceName: "Marketing",
      subserviceIds: [subserviceId],
      chosenPct: 0.18,
      isActive: true,
      annualAmount: 180_000,
      normalizedWeight: 0.18,
    });
    const monthlyAssignmentId = await ctx.db.insert("monthlyAssignments", {
      orgId,
      projServiceId,
      projectionId,
      clientId,
      serviceName: "Marketing",
      subserviceId,
      month: 5,
      year: 2026,
      amount: 15_000,
      feFactor: 1,
      status: "pending" as const,
      invoiceStatus: opts.paid ? ("paid" as const) : ("not_invoiced" as const),
    });
    let templateId: Id<"deliverableTemplates">;
    if (opts.createTemplate) {
      templateId = await ctx.db.insert("deliverableTemplates", {
        orgId,
        serviceName: "Marketing",
        subserviceId,
        type: "deliverable_short" as const,
        name: "Marketing short",
        htmlTemplate: TEMPLATE_HTML,
        variables: [],
        version: 3,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    } else {
      // Insert a sentinel template for a different subservice so the lookup
      // still has DB rows but no match.
      templateId = await ctx.db.insert("deliverableTemplates", {
        orgId,
        serviceName: "Otro",
        type: "deliverable_short" as const,
        name: "irrelevant",
        htmlTemplate: "<p/>",
        variables: [],
        version: 1,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    const invoiceId = await ctx.db.insert("invoices", {
      orgId,
      clientId,
      projectionId,
      projServiceId,
      subserviceId,
      serviceName: "Marketing",
      monthlyAssignmentId,
      month: 5,
      year: 2026,
      amount: 15_000,
      bucketKey: "k/x.pdf",
      contentType: "application/pdf",
      sizeBytes: 1,
      filename: "factura.pdf",
      status: opts.paid ? ("paid" as const) : ("uploaded" as const),
      uploadedAt: Date.now(),
      uploadedBy: "u",
      paidAt: opts.paid ? Date.now() : undefined,
      paidBy: opts.paid ? "u" : undefined,
      createdAt: Date.now(),
    });
    return {
      invoiceId,
      clientId,
      projectionId,
      serviceId,
      subserviceId,
      projServiceId,
      monthlyAssignmentId,
      templateId,
    };
  });
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
});

describe("deliverables.invoiceFlow.generateFromInvoice", () => {
  it("happy path: inserts deliverable with snapshot + trigger fields, emits generated event", async () => {
    const t = setupTest();
    const seed = await seedWithTemplate(t, ORG_A);

    const result = (await t.action(
      internal.functions.deliverables.invoiceFlow.generateFromInvoice,
      { invoiceId: seed.invoiceId }
    )) as { ok: boolean; deliverableId?: Id<"deliverables"> };
    expect(result.ok).toBe(true);
    expect(result.deliverableId).toBeTruthy();

    const deliverable = await t.run(async (ctx) =>
      ctx.db.get(result.deliverableId!)
    );
    expect(deliverable).toBeTruthy();
    expect(deliverable!.triggerSource).toBe("invoice_paid");
    expect(deliverable!.triggerInvoiceId).toBe(seed.invoiceId);
    expect(deliverable!.templateId).toBe(seed.templateId);
    expect(deliverable!.templateVersion).toBe(3);
    expect(deliverable!.templateHtmlSnapshot).toBe(TEMPLATE_HTML);

    const events = await t.run(async (ctx) =>
      ctx.db.query("documentEvents").collect()
    );
    expect(
      events.some(
        (e) =>
          e.eventType === "generated" &&
          e.severity === "info" &&
          e.entityType === "deliverable"
      )
    ).toBe(true);
  });

  it("no template → logs warning + scheduled notifyOperatorNoTemplate + returns no_template", async () => {
    const t = setupTest();
    const seed = await seedWithTemplate(t, ORG_A, {
      paid: true,
      createTemplate: false,
    });

    const result = (await t.action(
      internal.functions.deliverables.invoiceFlow.generateFromInvoice,
      { invoiceId: seed.invoiceId }
    )) as { ok: boolean; reason?: string };
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no_template");

    // No deliverable.
    const deliverables = await t.run(async (ctx) =>
      ctx.db.query("deliverables").collect()
    );
    expect(deliverables.length).toBe(0);

    // Warning event present.
    const events = await t.run(async (ctx) =>
      ctx.db.query("documentEvents").collect()
    );
    expect(
      events.some(
        (e) => e.severity === "warning" && e.eventType === "error"
      )
    ).toBe(true);

    // notifyOperatorNoTemplate scheduled.
    const scheduled = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect()
    );
    expect(scheduled.length).toBeGreaterThan(0);
  });

  it("invoice not paid → aborts without generating", async () => {
    const t = setupTest();
    const seed = await seedWithTemplate(t, ORG_A, {
      paid: false,
      createTemplate: true,
    });

    const result = (await t.action(
      internal.functions.deliverables.invoiceFlow.generateFromInvoice,
      { invoiceId: seed.invoiceId }
    )) as { ok: boolean; reason?: string };
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invoice_not_paid");

    const deliverables = await t.run(async (ctx) =>
      ctx.db.query("deliverables").collect()
    );
    expect(deliverables.length).toBe(0);
  });

  it("idempotent: second call skips AI (already_claimed); only one deliverable", async () => {
    const t = setupTest();
    const seed = await seedWithTemplate(t, ORG_A);

    const first = (await t.action(
      internal.functions.deliverables.invoiceFlow.generateFromInvoice,
      { invoiceId: seed.invoiceId }
    )) as { ok: boolean; deliverableId?: Id<"deliverables"> };
    expect(first.ok).toBe(true);

    const second = (await t.action(
      internal.functions.deliverables.invoiceFlow.generateFromInvoice,
      { invoiceId: seed.invoiceId }
    )) as { skipped?: string; ok?: boolean };
    // Phase 1 §3.7: atomic claim — race loser skips AI entirely.
    expect(second.skipped).toBe("already_claimed");

    const deliverables = await t.run(async (ctx) =>
      ctx.db.query("deliverables").collect()
    );
    expect(deliverables.length).toBe(1);
  });
});
