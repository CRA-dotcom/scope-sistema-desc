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
 * #22b — createManualQuotation
 * #22c — issuingCompanyId propagation
 * #22d — subserviceId propagation
 */

async function seedScenario(
  t: ReturnType<typeof setupTest>,
  orgId: string
): Promise<{
  clientId: Id<"clients">;
  projectionId: Id<"projections">;
  projServiceId: Id<"projectionServices">;
  subserviceId: Id<"subservices">;
  issuingCompanyId: Id<"issuingCompanies">;
}> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const clientId = await ctx.db.insert("clients", {
      orgId,
      name: "Acme Corp",
      rfc: "ACM010101AAA",
      industry: "Tech",
      annualRevenue: 500_000,
      billingFrequency: "mensual" as const,
      isArchived: false,
      createdAt: now,
    });
    const serviceId = await ctx.db.insert("services", {
      orgId: undefined,
      name: "Consultoría",
      type: "base" as const,
      minPct: 0,
      maxPct: 1,
      defaultPct: 0.1,
      isDefault: true,
      sortOrder: 1,
    });
    const subserviceId = await ctx.db.insert("subservices", {
      orgId: undefined,
      parentServiceId: serviceId,
      name: "Auditoría",
      slug: "auditoria",
      defaultFrequency: "mensual" as const,
      isActive: true,
      isDefault: true,
      sortOrder: 1,
      createdAt: now,
      updatedAt: now,
    });
    const projectionId = await ctx.db.insert("projections", {
      orgId,
      clientId,
      year: 2026,
      annualSales: 500_000,
      totalBudget: 50_000,
      commissionRate: 0.05,
      seasonalityData: [],
      status: "active" as const,
      createdAt: now,
      updatedAt: now,
    });
    const projServiceId = await ctx.db.insert("projectionServices", {
      orgId,
      projectionId,
      serviceId,
      serviceName: "Consultoría",
      chosenPct: 0.1,
      isActive: true,
      annualAmount: 5_000,
      normalizedWeight: 1,
    });
    const issuingCompanyId = await ctx.db.insert("issuingCompanies", {
      orgId,
      name: "Empresa Emisora SA",
      legalName: "Empresa Emisora SA de CV",
      rfc: "EEM010101AAA",
      regimenFiscalCode: "601",
      codigoPostal: "06600",
      address: {
        street: "Calle 1",
        city: "CDMX",
        state: "Ciudad de México",
        country: "México",
      },
      email: "emisora@example.com",
      isActive: true,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    });
    return { clientId, projectionId, projServiceId, subserviceId, issuingCompanyId };
  });
}

describe("quotations.createManualQuotation (#22b)", () => {
  it("creates a draft quotation for the given projServiceId", async () => {
    const t = setupTest();
    const { projServiceId, clientId } = await seedScenario(t, ORG_A);

    const quotationId = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.quotations.mutations.createManualQuotation, {
        projServiceId,
      });

    expect(quotationId).toBeDefined();

    await t.run(async (ctx) => {
      const q = await ctx.db.get(quotationId);
      expect(q).not.toBeNull();
      expect(q!.status).toBe("draft");
      expect(q!.clientId).toBe(clientId);
      expect(q!.projServiceId).toBe(projServiceId);
      expect(q!.orgId).toBe(ORG_A);
      expect(q!.content).toBeTruthy();
      // issuingCompanyId not set when not passed
      expect(q!.issuingCompanyId).toBeUndefined();
    });
  });

  it("persists issuingCompanyId and subserviceId (#22c, #22d)", async () => {
    const t = setupTest();
    const { projServiceId, issuingCompanyId, subserviceId } = await seedScenario(
      t,
      ORG_A
    );

    const quotationId = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.quotations.mutations.createManualQuotation, {
        projServiceId,
        issuingCompanyId,
        subserviceId,
      });

    await t.run(async (ctx) => {
      const q = await ctx.db.get(quotationId);
      expect(q!.issuingCompanyId).toBe(issuingCompanyId);
      expect(q!.subserviceId).toBe(subserviceId);
    });
  });

  it("rejects projServiceId from another org (cross-org guard)", async () => {
    const t = setupTest();
    // Seed projServiceId in ORG_B
    const { projServiceId } = await seedScenario(t, ORG_B);

    // Attempt to create from ORG_A context
    await expect(
      t
        .withIdentity(admin(ORG_A))
        .mutation(api.functions.quotations.mutations.createManualQuotation, {
          projServiceId,
        })
    ).rejects.toThrow();
  });

  it("rejects issuingCompanyId from another org", async () => {
    const t = setupTest();
    const { projServiceId } = await seedScenario(t, ORG_A);
    const { issuingCompanyId: otherOrgCompany } = await seedScenario(t, ORG_B);

    await expect(
      t
        .withIdentity(admin(ORG_A))
        .mutation(api.functions.quotations.mutations.createManualQuotation, {
          projServiceId,
          issuingCompanyId: otherOrgCompany,
        })
    ).rejects.toThrow(/Empresa emitente no encontrada/);
  });
});

describe("quotations.generateAllForProjection (#5)", () => {
  it("creates one quotation per active service and returns correct count", async () => {
    const t = setupTest();
    const { projectionId, projServiceId } = await seedScenario(t, ORG_A);

    // Seed a second active projService
    await t.run(async (ctx) => {
      const now = Date.now();
      const svc2 = await ctx.db.insert("services", {
        orgId: undefined,
        name: "Marketing",
        type: "base" as const,
        minPct: 0,
        maxPct: 1,
        defaultPct: 0.1,
        isDefault: true,
        sortOrder: 2,
      });
      await ctx.db.insert("projectionServices", {
        orgId: ORG_A,
        projectionId,
        serviceId: svc2,
        serviceName: "Marketing",
        chosenPct: 0.1,
        isActive: true,
        annualAmount: 3_000,
        normalizedWeight: 1,
      });
    });

    const result = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.quotations.mutations.generateAllForProjection, {
        projectionId,
      });

    expect(result.created).toBe(2);
    expect(result.skipped).toBe(0);

    // Run again — both should be skipped
    const result2 = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.quotations.mutations.generateAllForProjection, {
        projectionId,
      });
    expect(result2.created).toBe(0);
    expect(result2.skipped).toBe(2);
  });

  it("skips inactive services", async () => {
    const t = setupTest();
    const { projectionId, projServiceId } = await seedScenario(t, ORG_A);

    // Mark the service as inactive
    await t.run(async (ctx) => {
      await ctx.db.patch(projServiceId, { isActive: false });
    });

    const result = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.quotations.mutations.generateAllForProjection, {
        projectionId,
      });

    expect(result.created).toBe(0);
  });

  it("rejects projectionId from another org", async () => {
    const t = setupTest();
    const { projectionId } = await seedScenario(t, ORG_B);

    await expect(
      t
        .withIdentity(admin(ORG_A))
        .mutation(api.functions.quotations.mutations.generateAllForProjection, {
          projectionId,
        })
    ).rejects.toThrow();
  });
});

describe("quotations.updateIssuingCompany (#22c)", () => {
  it("sets and clears issuingCompanyId on a draft quotation", async () => {
    const t = setupTest();
    const { projServiceId, issuingCompanyId } = await seedScenario(t, ORG_A);

    const quotationId = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.quotations.mutations.createManualQuotation, {
        projServiceId,
      });

    // Set
    await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.quotations.mutations.updateIssuingCompany, {
        id: quotationId,
        issuingCompanyId,
      });
    await t.run(async (ctx) => {
      const q = await ctx.db.get(quotationId);
      expect(q!.issuingCompanyId).toBe(issuingCompanyId);
    });

    // Clear
    await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.quotations.mutations.updateIssuingCompany, {
        id: quotationId,
        issuingCompanyId: null,
      });
    await t.run(async (ctx) => {
      const q = await ctx.db.get(quotationId);
      expect(q!.issuingCompanyId).toBeUndefined();
    });
  });
});
