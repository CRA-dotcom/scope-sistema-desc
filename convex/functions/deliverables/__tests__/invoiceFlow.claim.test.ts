import { describe, it, expect } from "vitest";
import { setupTest, ORG_A } from "../../../../tests/harness";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

// ─── Seed helpers ────────────────────────────────────────────────────────────

type ClaimSeed = {
  invoiceId: Id<"invoices">;
  clientId: Id<"clients">;
  projectionId: Id<"projections">;
  serviceId: Id<"services">;
  subserviceId: Id<"subservices">;
  projServiceId: Id<"projectionServices">;
  monthlyAssignmentId: Id<"monthlyAssignments">;
};

async function seedPaidInvoice(
  t: ReturnType<typeof setupTest>,
  orgId: string
): Promise<ClaimSeed> {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId,
      name: "ClaimCo",
      rfc: "CLM240115XYZ",
      industry: "Tech",
      annualRevenue: 500_000,
      billingFrequency: "mensual" as const,
      isArchived: false,
      contactEmail: "ops@claimco.test",
      createdAt: Date.now(),
    });

    const projectionId = await ctx.db.insert("projections", {
      orgId,
      clientId,
      year: 2026,
      annualSales: 500_000,
      totalBudget: 50_000,
      commissionRate: 0,
      seasonalityData: [],
      status: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const serviceId = await ctx.db.insert("services", {
      orgId,
      name: "SEO",
      type: "base" as const,
      minPct: 0.1,
      maxPct: 0.3,
      defaultPct: 0.15,
      isDefault: true,
      sortOrder: 1,
    });

    const subserviceId = await ctx.db.insert("subservices", {
      orgId,
      parentServiceId: serviceId,
      name: "Posicionamiento",
      slug: "posicionamiento",
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
      serviceName: "SEO",
      subserviceId,
      chosenPct: 0.15,
      isActive: true,
      annualAmount: 75_000,
      normalizedWeight: 0.15,
    });

    const monthlyAssignmentId = await ctx.db.insert("monthlyAssignments", {
      orgId,
      projServiceId,
      projectionId,
      clientId,
      serviceName: "SEO",
      subserviceId,
      month: 5,
      year: 2026,
      amount: 6_250,
      feFactor: 1,
      status: "pending" as const,
      invoiceStatus: "paid" as const,
    });

    const invoiceId = await ctx.db.insert("invoices", {
      orgId,
      clientId,
      projectionId,
      projServiceId,
      subserviceId,
      serviceName: "SEO",
      monthlyAssignmentId,
      month: 5,
      year: 2026,
      amount: 6_250,
      bucketKey: "test/claim.pdf",
      contentType: "application/pdf",
      sizeBytes: 1,
      filename: "factura-claim.pdf",
      status: "paid" as const,
      uploadedAt: Date.now(),
      uploadedBy: "u",
      paidAt: Date.now(),
      paidBy: "u",
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
    };
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("deliverables.invoiceFlow.claimInvoiceForGeneration", () => {
  it("first call returns true and inserts a placeholder deliverable", async () => {
    const t = setupTest();
    const seed = await seedPaidInvoice(t, ORG_A);

    const claimed = await t.mutation(
      internal.functions.deliverables.invoiceFlow.claimInvoiceForGeneration,
      { invoiceId: seed.invoiceId }
    );

    expect(claimed).toBe(true);

    // Verify placeholder was inserted with the right fields.
    const deliverables = await t.run(async (ctx) =>
      ctx.db.query("deliverables").collect()
    );
    expect(deliverables.length).toBe(1);

    const placeholder = deliverables[0];
    expect(placeholder.triggerInvoiceId).toBe(seed.invoiceId);
    expect(placeholder.auditStatus).toBe("pending");
    expect(placeholder.shortContent).toBe("");
    expect(placeholder.triggerSource).toBe("invoice_paid");
  });

  it("second call returns false and does not insert duplicate", async () => {
    const t = setupTest();
    const seed = await seedPaidInvoice(t, ORG_A);

    const first = await t.mutation(
      internal.functions.deliverables.invoiceFlow.claimInvoiceForGeneration,
      { invoiceId: seed.invoiceId }
    );
    const second = await t.mutation(
      internal.functions.deliverables.invoiceFlow.claimInvoiceForGeneration,
      { invoiceId: seed.invoiceId }
    );

    expect(first).toBe(true);
    expect(second).toBe(false);

    // Only one deliverable — no duplicate inserted.
    const deliverables = await t.run(async (ctx) =>
      ctx.db.query("deliverables").collect()
    );
    expect(deliverables.length).toBe(1);
  });
});
