import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import { setupTest, ORG_A, ORG_B } from "../../../../tests/harness";

function admin(orgId: string) {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `admin_${orgId}`,
    orgId,
    orgRole: "org:admin",
  };
}

/**
 * #23 — contracts.updateIssuingCompany
 */

async function seedScenario(
  t: ReturnType<typeof setupTest>,
  orgId: string
): Promise<{
  contractId: Id<"contracts">;
  issuingCompanyId: Id<"issuingCompanies">;
}> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const clientId = await ctx.db.insert("clients", {
      orgId,
      name: "Test Client",
      rfc: "TCL010101AAA",
      industry: "Finance",
      annualRevenue: 1_000_000,
      billingFrequency: "mensual" as const,
      isArchived: false,
      createdAt: now,
    });
    const serviceId = await ctx.db.insert("services", {
      orgId: undefined,
      name: "Contabilidad",
      type: "base" as const,
      minPct: 0,
      maxPct: 1,
      defaultPct: 0.1,
      isDefault: true,
      sortOrder: 1,
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
      createdAt: now,
      updatedAt: now,
    });
    const projServiceId = await ctx.db.insert("projectionServices", {
      orgId,
      projectionId,
      serviceId,
      serviceName: "Contabilidad",
      chosenPct: 0.1,
      isActive: true,
      annualAmount: 10_000,
      normalizedWeight: 1,
    });
    const quotationId = await ctx.db.insert("quotations", {
      orgId,
      projServiceId,
      clientId,
      serviceName: "Contabilidad",
      content: "<p>draft</p>",
      status: "approved" as const,
      createdAt: now,
    });
    const contractId = await ctx.db.insert("contracts", {
      orgId,
      quotationId,
      projServiceId,
      clientId,
      serviceName: "Contabilidad",
      content: "<p>contrato</p>",
      status: "draft" as const,
      createdAt: now,
    });
    const issuingCompanyId = await ctx.db.insert("issuingCompanies", {
      orgId,
      name: "Emisora SA",
      legalName: "Emisora SA de CV",
      rfc: "EMI010101AAA",
      regimenFiscalCode: "601",
      codigoPostal: "06600",
      address: {
        street: "Av. Reforma 1",
        city: "CDMX",
        state: "Ciudad de México",
        country: "México",
      },
      email: "emisora@test.com",
      isActive: true,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    });
    return { contractId, issuingCompanyId };
  });
}

describe("contracts.updateIssuingCompany (#23)", () => {
  it("sets issuingCompanyId on a draft contract", async () => {
    const t = setupTest();
    const { contractId, issuingCompanyId } = await seedScenario(t, ORG_A);

    await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.contracts.mutations.updateIssuingCompany, {
        id: contractId,
        issuingCompanyId,
      });

    await t.run(async (ctx) => {
      const c = await ctx.db.get(contractId);
      expect(c!.issuingCompanyId).toBe(issuingCompanyId);
    });
  });

  it("clears issuingCompanyId when null is passed", async () => {
    const t = setupTest();
    const { contractId, issuingCompanyId } = await seedScenario(t, ORG_A);

    await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.contracts.mutations.updateIssuingCompany, {
        id: contractId,
        issuingCompanyId,
      });
    await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.contracts.mutations.updateIssuingCompany, {
        id: contractId,
        issuingCompanyId: null,
      });

    await t.run(async (ctx) => {
      const c = await ctx.db.get(contractId);
      expect(c!.issuingCompanyId).toBeUndefined();
    });
  });

  it("rejects issuingCompanyId from another org", async () => {
    const t = setupTest();
    const { contractId } = await seedScenario(t, ORG_A);
    const { issuingCompanyId: otherOrgCompany } = await seedScenario(t, ORG_B);

    await expect(
      t
        .withIdentity(admin(ORG_A))
        .mutation(api.functions.contracts.mutations.updateIssuingCompany, {
          id: contractId,
          issuingCompanyId: otherOrgCompany,
        })
    ).rejects.toThrow(/Empresa emitente no encontrada/);
  });
});
