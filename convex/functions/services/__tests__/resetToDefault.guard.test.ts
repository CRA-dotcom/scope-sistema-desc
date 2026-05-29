/**
 * Phase 1 §3.4 — resetToDefault ref guard tests.
 *
 * Verifies that `services.mutations.resetToDefault` throws HAS_ACTIVE_REFS
 * (via ConvexError) when the service-override row is still referenced by
 * downstream tables, and succeeds when there are no refs.
 */
import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import { setupTest, ORG_A } from "../../../../tests/harness";

function admin(orgId: string) {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `user_admin_${orgId}`,
    orgId,
    orgRole: "org:admin" as const,
  };
}

/**
 * Seed an org-scoped service override (isDefault=false, orgId=ORG_A).
 * This is the kind of row that resetToDefault can delete.
 */
async function seedOrgService(
  t: ReturnType<typeof setupTest>,
  name = "Marketing Override"
): Promise<Id<"services">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("services", {
      orgId: ORG_A,
      name,
      type: "base" as const,
      minPct: 0.01,
      maxPct: 0.05,
      defaultPct: 0.02,
      isDefault: false,
      isCommission: false,
      isCustom: false,
      sortOrder: 1,
    });
  });
}

async function seedIssuingCompany(
  t: ReturnType<typeof setupTest>,
  rfc = "EFA010101AAA"
): Promise<Id<"issuingCompanies">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("issuingCompanies", {
      orgId: ORG_A,
      name: "Empresa Facturadora SA",
      legalName: "Empresa Facturadora SA de CV",
      rfc,
      regimenFiscalCode: "601",
      codigoPostal: "64000",
      address: { street: "Av. Principal", city: "CDMX", state: "CDMX", country: "MX" },
      email: "facturacion@empresa.com",
      isDefault: false,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
}

// ── projectionServices ────────────────────────────────────────────────────────

describe("services.mutations.resetToDefault – ref guard", () => {
  it("throws HAS_ACTIVE_REFS when service has projectionServices referencing it", async () => {
    const t = setupTest();
    const serviceId = await seedOrgService(t, "Marketing PS");

    // Create a projection and a projectionService row pointing to serviceId.
    await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: ORG_A,
        name: "ACME",
        rfc: "AAA010101AAA",
        industry: "Tech",
        annualRevenue: 1_000_000,
        billingFrequency: "mensual" as const,
        isArchived: false,
        createdAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: ORG_A,
        clientId,
        year: 2026,
        annualSales: 1_000_000,
        totalBudget: 120_000,
        commissionRate: 0,
        seasonalityData: [],
        status: "active" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("projectionServices", {
        orgId: ORG_A,
        projectionId,
        serviceId,
        serviceName: "Marketing PS",
        chosenPct: 0.05,
        isActive: true,
        annualAmount: 60_000,
        normalizedWeight: 0.5,
      });
    });

    await expect(
      t
        .withIdentity(admin(ORG_A))
        .mutation(api.functions.services.mutations.resetToDefault, {
          serviceId,
        })
    ).rejects.toThrow(/HAS_ACTIVE_REFS|en uso|active refs/i);

    // Service must NOT have been deleted.
    const still = await t.run((ctx) => ctx.db.get(serviceId));
    expect(still).not.toBeNull();
  });

  // ── subservices ─────────────────────────────────────────────────────────────

  it("throws HAS_ACTIVE_REFS when service has subservices referencing it", async () => {
    const t = setupTest();
    const serviceId = await seedOrgService(t, "Legal Sub");

    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("subservices", {
        orgId: ORG_A,
        parentServiceId: serviceId,
        name: "Compliance",
        slug: "compliance",
        defaultFrequency: "mensual" as const,
        isActive: true,
        isDefault: false,
        sortOrder: 10,
        createdAt: now,
        updatedAt: now,
      });
    });

    await expect(
      t
        .withIdentity(admin(ORG_A))
        .mutation(api.functions.services.mutations.resetToDefault, {
          serviceId,
        })
    ).rejects.toThrow(/HAS_ACTIVE_REFS|en uso|active refs/i);

    const still = await t.run((ctx) => ctx.db.get(serviceId));
    expect(still).not.toBeNull();
  });

  // ── deliverableTemplates ─────────────────────────────────────────────────────

  it("throws HAS_ACTIVE_REFS when service has deliverableTemplates referencing it", async () => {
    const t = setupTest();
    const serviceId = await seedOrgService(t, "Legal Tpl");

    await t.run(async (ctx) => {
      await ctx.db.insert("deliverableTemplates", {
        orgId: ORG_A,
        serviceId,
        serviceName: "Legal Tpl",
        type: "contract" as const,
        name: "Contrato Base",
        htmlTemplate: "<p>{{clientName}}</p>",
        variables: [],
        version: 1,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await expect(
      t
        .withIdentity(admin(ORG_A))
        .mutation(api.functions.services.mutations.resetToDefault, {
          serviceId,
        })
    ).rejects.toThrow(/HAS_ACTIVE_REFS|en uso|active refs/i);

    const still = await t.run((ctx) => ctx.db.get(serviceId));
    expect(still).not.toBeNull();
  });

  // ── servicesIssuingCompanyMap ────────────────────────────────────────────────

  it("throws HAS_ACTIVE_REFS when service has servicesIssuingCompanyMap referencing it", async () => {
    const t = setupTest();
    const serviceId = await seedOrgService(t, "Fiscal Map");
    const issuingCompanyId = await seedIssuingCompany(t, "EFA010101AAA");

    await t.run(async (ctx) => {
      await ctx.db.insert("servicesIssuingCompanyMap", {
        orgId: ORG_A,
        serviceId,
        issuingCompanyId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await expect(
      t
        .withIdentity(admin(ORG_A))
        .mutation(api.functions.services.mutations.resetToDefault, {
          serviceId,
        })
    ).rejects.toThrow(/HAS_ACTIVE_REFS|en uso|active refs/i);

    const still = await t.run((ctx) => ctx.db.get(serviceId));
    expect(still).not.toBeNull();
  });

  // ── clientIssuingCompanyOverride ─────────────────────────────────────────────

  it("throws HAS_ACTIVE_REFS when service has clientIssuingCompanyOverride referencing it", async () => {
    const t = setupTest();
    const serviceId = await seedOrgService(t, "Fiscal Override");
    const issuingCompanyId = await seedIssuingCompany(t, "EOV010101AAA");

    await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: ORG_A,
        name: "Cliente Override",
        rfc: "COV010101AAA",
        industry: "Legal",
        annualRevenue: 500_000,
        billingFrequency: "mensual" as const,
        isArchived: false,
        createdAt: Date.now(),
      });
      await ctx.db.insert("clientIssuingCompanyOverride", {
        orgId: ORG_A,
        clientId,
        serviceId,
        issuingCompanyId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await expect(
      t
        .withIdentity(admin(ORG_A))
        .mutation(api.functions.services.mutations.resetToDefault, {
          serviceId,
        })
    ).rejects.toThrow(/HAS_ACTIVE_REFS|en uso|active refs/i);

    const still = await t.run((ctx) => ctx.db.get(serviceId));
    expect(still).not.toBeNull();
  });

  // ── happy path ───────────────────────────────────────────────────────────────

  it("deletes service when there are no refs", async () => {
    const t = setupTest();
    const serviceId = await seedOrgService(t, "Unused Service");

    await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.services.mutations.resetToDefault, {
        serviceId,
      });

    const gone = await t.run((ctx) => ctx.db.get(serviceId));
    expect(gone).toBeNull();
  });
});
