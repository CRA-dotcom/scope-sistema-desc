/**
 * Phase 1 §3.6 — issuingCompanies.remove guard
 * Verifies that `remove` blocks deletion when the issuingCompany is
 * referenced by quotations, contracts, or deliverableTemplates.
 */
import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../../tests/harness";

function withAdmin(orgId: string) {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `user_admin_${orgId}`,
    orgId,
    orgRole: "org:admin",
  };
}

const icBase = {
  name: "Empresa Guard",
  legalName: "Empresa Guard S.A. de C.V.",
  rfc: "EGU200101GRD",
  regimenFiscalCode: "601",
  codigoPostal: "06600",
  address: {
    street: "Av. Guard",
    city: "CDMX",
    state: "CDMX",
    country: "México",
  },
  email: "guard@test.mx",
};

// Second non-default company so the first one can be removed (not guarded by isDefault)
const icDefault = {
  name: "Default Co",
  legalName: "Default Co S.A. de C.V.",
  rfc: "DCO200101DEF",
  regimenFiscalCode: "601",
  codigoPostal: "06600",
  address: {
    street: "Av. Default",
    city: "CDMX",
    state: "CDMX",
    country: "México",
  },
  email: "default@test.mx",
};

/**
 * Seeds the minimum required records to get a valid projServiceId + clientId
 * so we can insert a quotation.
 */
async function seedProjectionService(
  t: ReturnType<typeof setupTest>,
  orgId: string,
) {
  return await t.run(async (ctx) => {
    const now = Date.now();

    const serviceId = await ctx.db.insert("services", {
      orgId: undefined,
      name: "Test Service",
      type: "base" as const,
      minPct: 0,
      maxPct: 100,
      defaultPct: 10,
      isDefault: true,
      sortOrder: 0,
    });

    const clientId = await ctx.db.insert("clients", {
      orgId,
      name: "Test Client",
      rfc: "CLI200101TST",
      industry: "Tech",
      annualRevenue: 0,
      billingFrequency: "mensual" as const,
      isArchived: false,
      createdAt: now,
    });

    const projectionId = await ctx.db.insert("projections", {
      orgId,
      clientId,
      year: 2026,
      annualSales: 0,
      totalBudget: 0,
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
      serviceName: "Test Service",
      chosenPct: 10,
      isActive: true,
      annualAmount: 0,
      normalizedWeight: 1,
    });

    return { projServiceId, clientId };
  });
}

describe("issuingCompanies.remove — active refs guard (Phase 1 §3.6)", () => {
  it("throws when issuingCompanyId is referenced by a quotation", async () => {
    const t = setupTest();

    // Create the default IC first, then create the one we'll try to remove
    await t.withIdentity(withAdmin(ORG_A)).mutation(
      api.functions.issuingCompanies.mutations.create,
      icDefault,
    );
    const icId = await t.withIdentity(withAdmin(ORG_A)).mutation(
      api.functions.issuingCompanies.mutations.create,
      icBase,
    );

    const { projServiceId, clientId } = await seedProjectionService(t, ORG_A);

    // Seed a quotation referencing this issuingCompany
    await t.run(async (ctx) => {
      await ctx.db.insert("quotations", {
        orgId: ORG_A,
        projServiceId,
        clientId,
        serviceName: "Test Service",
        content: "<p/>",
        status: "draft" as const,
        issuingCompanyId: icId,
        createdAt: Date.now(),
      });
    });

    // remove should throw
    await expect(
      t
        .withIdentity(withAdmin(ORG_A))
        .mutation(api.functions.issuingCompanies.mutations.remove, { id: icId }),
    ).rejects.toThrow();

    // Company must NOT have been deleted
    const still = await t.run((ctx) => ctx.db.get(icId));
    expect(still).not.toBeNull();
  });

  it("throws when issuingCompanyId is referenced by a contract", async () => {
    const t = setupTest();

    await t.withIdentity(withAdmin(ORG_A)).mutation(
      api.functions.issuingCompanies.mutations.create,
      icDefault,
    );
    const icId = await t.withIdentity(withAdmin(ORG_A)).mutation(
      api.functions.issuingCompanies.mutations.create,
      icBase,
    );

    const { projServiceId, clientId } = await seedProjectionService(t, ORG_A);

    // Seed a quotation (required FK for contract), then a contract referencing this IC
    await t.run(async (ctx) => {
      const now = Date.now();
      const quotationId = await ctx.db.insert("quotations", {
        orgId: ORG_A,
        projServiceId,
        clientId,
        serviceName: "Test Service",
        content: "<p/>",
        status: "approved" as const,
        createdAt: now,
      });
      await ctx.db.insert("contracts", {
        orgId: ORG_A,
        quotationId,
        projServiceId,
        clientId,
        serviceName: "Test Service",
        content: "<p/>",
        status: "draft" as const,
        issuingCompanyId: icId,
        createdAt: now,
      });
    });

    await expect(
      t
        .withIdentity(withAdmin(ORG_A))
        .mutation(api.functions.issuingCompanies.mutations.remove, { id: icId }),
    ).rejects.toThrow();

    const still = await t.run((ctx) => ctx.db.get(icId));
    expect(still).not.toBeNull();
  });

  it("throws when issuingCompanyId is referenced by a deliverableTemplate", async () => {
    const t = setupTest();

    await t.withIdentity(withAdmin(ORG_A)).mutation(
      api.functions.issuingCompanies.mutations.create,
      icDefault,
    );
    const icId = await t.withIdentity(withAdmin(ORG_A)).mutation(
      api.functions.issuingCompanies.mutations.create,
      icBase,
    );

    // Seed a deliverableTemplate referencing this IC
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("deliverableTemplates", {
        orgId: ORG_A,
        serviceName: "Test Service",
        type: "contract" as const,
        name: "Guard Template",
        htmlTemplate: "<p>{{client_name}}</p>",
        variables: [],
        version: 1,
        isActive: true,
        issuingCompanyId: icId,
        createdAt: now,
        updatedAt: now,
      });
    });

    await expect(
      t
        .withIdentity(withAdmin(ORG_A))
        .mutation(api.functions.issuingCompanies.mutations.remove, { id: icId }),
    ).rejects.toThrow();

    const still = await t.run((ctx) => ctx.db.get(icId));
    expect(still).not.toBeNull();
  });
});
