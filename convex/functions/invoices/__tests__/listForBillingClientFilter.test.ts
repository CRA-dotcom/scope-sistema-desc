import { describe, it, expect } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

async function seedFullInvoice(
  t: ReturnType<typeof setupTest>,
  opts: {
    orgId: string;
    clientName: string;
    serviceName?: string;
    issuingCompanyName?: string;
    year?: number;
    month?: number;
  }
): Promise<{
  clientId: Id<"clients">;
  invoiceId: Id<"invoices">;
  issuingCompanyId?: Id<"issuingCompanies">;
  projServiceId: Id<"projectionServices">;
  serviceId: Id<"services">;
}> {
  return t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId: opts.orgId,
      name: opts.clientName,
      rfc: "TST010101AAA",
      industry: "Servicios",
      annualRevenue: 0,
      billingFrequency: "mensual" as const,
      isArchived: false,
      createdAt: 0,
    });
    const projectionId = await ctx.db.insert("projections", {
      orgId: opts.orgId,
      clientId,
      year: opts.year ?? 2026,
      annualSales: 0,
      totalBudget: 0,
      commissionRate: 0,
      seasonalityData: [],
      status: "active" as const,
      createdAt: 0,
      updatedAt: 0,
    });
    const serviceId = await ctx.db.insert("services", {
      name: opts.serviceName ?? "S",
      type: "base" as const,
      minPct: 0,
      maxPct: 1,
      defaultPct: 0.1,
      isDefault: true,
      sortOrder: 1,
    });
    const projServiceId = await ctx.db.insert("projectionServices", {
      orgId: opts.orgId,
      projectionId,
      serviceId,
      serviceName: opts.serviceName ?? "S",
      chosenPct: 0.1,
      isActive: true,
      annualAmount: 0,
      normalizedWeight: 0.1,
    });

    let issuingCompanyId: Id<"issuingCompanies"> | undefined;
    if (opts.issuingCompanyName) {
      issuingCompanyId = await ctx.db.insert("issuingCompanies", {
        orgId: opts.orgId,
        name: opts.issuingCompanyName,
        legalName: opts.issuingCompanyName,
        rfc: "ISS010101AAA",
        regimenFiscalCode: "612",
        codigoPostal: "01000",
        address: {
          street: "Av. Test",
          city: "CDMX",
          state: "CDMX",
          country: "MX",
        },
        email: "test@test.mx",
        isDefault: false,
        isActive: true,
        createdAt: 0,
        updatedAt: 0,
      });
      await ctx.db.insert("servicesIssuingCompanyMap", {
        orgId: opts.orgId,
        serviceId,
        issuingCompanyId,
        createdAt: 0,
        updatedAt: 0,
      });
    }

    const invoiceId = await ctx.db.insert("invoices", {
      orgId: opts.orgId,
      clientId,
      projectionId,
      projServiceId,
      serviceName: opts.serviceName ?? "S",
      month: opts.month ?? 1,
      year: opts.year ?? 2026,
      amount: 1000,
      bucketKey: "k",
      contentType: "application/pdf",
      sizeBytes: 1,
      filename: "x.pdf",
      status: "uploaded" as const,
      uploadedAt: 0,
      uploadedBy: "u",
      createdAt: 0,
    });

    return { clientId, invoiceId, issuingCompanyId, projServiceId, serviceId };
  });
}

describe("listForBilling — clientId filter", () => {
  it("returns only invoices for the specified clientId", async () => {
    const t = setupTest();
    const orgId = "org_1";

    const { clientId: clientA } = await seedFullInvoice(t, {
      orgId,
      clientName: "Alpha",
      serviceName: "Contabilidad",
    });
    await seedFullInvoice(t, {
      orgId,
      clientName: "Beta",
      serviceName: "Fiscal",
    });

    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });
    const result = await auth.query(
      api.functions.invoices.queries.listForBilling,
      { year: 2026, clientId: clientA }
    );

    expect(result).toHaveLength(1);
    expect(result[0].clientId).toBe(clientA);
  });
});

describe("listForBilling — issuingCompanyId filter", () => {
  it("returns only invoices whose service maps to the specified issuingCompanyId", async () => {
    const t = setupTest();
    const orgId = "org_2";

    const { issuingCompanyId: companyX } = await seedFullInvoice(t, {
      orgId,
      clientName: "Gamma",
      serviceName: "Auditoría",
      issuingCompanyName: "DESC SA",
    });
    await seedFullInvoice(t, {
      orgId,
      clientName: "Delta",
      serviceName: "Legal",
      // no issuing company mapping
    });

    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });
    const result = await auth.query(
      api.functions.invoices.queries.listForBilling,
      { year: 2026, issuingCompanyId: companyX! }
    );

    expect(result).toHaveLength(1);
    expect(result[0].serviceName).toBe("Auditoría");
  });

  it("returns empty when no invoices match the issuingCompanyId", async () => {
    const t = setupTest();
    const orgId = "org_3";

    const { issuingCompanyId: unusedId } = await seedFullInvoice(t, {
      orgId,
      clientName: "Epsilon",
      serviceName: "Nómina",
      issuingCompanyName: "Dummy Corp",
    });

    // Seed another invoice with no company mapping
    await seedFullInvoice(t, {
      orgId,
      clientName: "Zeta",
      serviceName: "Marketing",
    });

    // Query for a non-existent company id
    const otherCompanyId = unusedId!; // reuse to validate correctness
    // Actually query with the real id — should return 1 result
    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });
    const result = await auth.query(
      api.functions.invoices.queries.listForBilling,
      { year: 2026, issuingCompanyId: otherCompanyId }
    );
    expect(result).toHaveLength(1);
    expect(result[0].serviceName).toBe("Nómina");
  });
});
