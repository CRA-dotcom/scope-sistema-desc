import { describe, it, expect } from "vitest";
import { internal } from "../../../_generated/api";
import { api } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../__tests__/harness";

function admin(orgId: string) {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `user_admin_${orgId}`,
    orgId,
    orgRole: "org:admin",
  };
}

const companyBase = {
  name: "Test Co",
  legalName: "Test Co S.A. de C.V.",
  rfc: "TCO200101ABC",
  regimenFiscalCode: "601",
  codigoPostal: "11550",
  address: {
    street: "Av. Uno",
    city: "CDMX",
    state: "CDMX",
    country: "México",
  },
  email: "test@test.mx",
};

describe("resolveIssuingCompanyQuery (internalQuery wrapper)", () => {
  it("is callable via runQuery and returns the default company with source='org_default'", async () => {
    const t = setupTest();
    const companyId = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.issuingCompanies.mutations.create, companyBase);

    // Create a dummy client + service to satisfy resolver args
    const clientId = await t.run(async (ctx) =>
      ctx.db.insert("clients", {
        orgId: ORG_A,
        name: "ACME",
        rfc: "ACM100101ABC",
        industry: "Servicios",
        annualRevenue: 1000000,
        billingFrequency: "mensual" as const,
        isArchived: false,
        createdAt: Date.now(),
      })
    );
    const serviceId = await t.run(async (ctx) =>
      ctx.db.insert("services", {
        orgId: ORG_A,
        name: "Contable",
        type: "base" as const,
        minPct: 0.05,
        maxPct: 0.3,
        defaultPct: 0.15,
        isDefault: false,
        sortOrder: 1,
      })
    );

    const result = await t.run(async (ctx) =>
      ctx.runQuery(
        internal.functions.issuingCompanies.resolve.resolveIssuingCompanyQuery,
        { orgId: ORG_A, clientId, serviceId }
      )
    );

    expect(result.source).toBe("org_default");
    expect(result.issuingCompany._id).toBe(companyId);
  });
});
