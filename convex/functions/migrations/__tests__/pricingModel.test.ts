import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal } from "../../../_generated/api";
import schema from "../../../schema";

describe("migrations.pricingModel.migrate", () => {
  async function seedFixtures(t: ReturnType<typeof convexTest>) {
    return await t.run(async (ctx) => {
      const svcCommission = await ctx.db.insert("services", {
        orgId: undefined,
        name: "Comisiones",
        type: "base",
        minPct: 0,
        maxPct: 100,
        defaultPct: 5,
        isDefault: true,
        isCommission: true,
        sortOrder: 1,
      });
      const svcTI = await ctx.db.insert("services", {
        orgId: undefined,
        name: "TI",
        type: "base",
        minPct: 0,
        maxPct: 100,
        defaultPct: 30,
        isDefault: true,
        sortOrder: 2,
      });

      const subCom = await ctx.db.insert("subservices", {
        orgId: undefined,
        parentServiceId: svcCommission,
        name: "Sub Comisión",
        slug: "sub-comision",
        defaultFrequency: "mensual",
        isCommission: true,
        isActive: true,
        isDefault: false,
        sortOrder: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const subOneShot = await ctx.db.insert("subservices", {
        orgId: undefined,
        parentServiceId: svcTI,
        name: "Identidad Corporativa",
        slug: "identidad-corporativa",
        defaultFrequency: "una_vez",
        isActive: true,
        isDefault: false,
        sortOrder: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const subNormal = await ctx.db.insert("subservices", {
        orgId: undefined,
        parentServiceId: svcTI,
        name: "Soporte",
        slug: "soporte",
        defaultFrequency: "mensual",
        isActive: true,
        isDefault: false,
        sortOrder: 2,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const clientId = await ctx.db.insert("clients", {
        orgId: "org_test",
        name: "Test",
        rfc: "XAXX010101000",
        industry: "tech",
        annualRevenue: 1_200_000,
        billingFrequency: "mensual",
        isArchived: false,
        createdAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: "org_test",
        clientId,
        year: 2026,
        annualSales: 1_200_000,
        totalBudget: 120_000,
        commissionRate: 0,
        seasonalityData: [],
        status: "draft",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const psCom = await ctx.db.insert("projectionServices", {
        orgId: "org_test",
        projectionId,
        serviceId: svcCommission,
        serviceName: "Comisiones",
        subserviceId: subCom,
        chosenPct: 5,
        isActive: true,
        annualAmount: 60000,
        normalizedWeight: 0,
      });
      const psTI = await ctx.db.insert("projectionServices", {
        orgId: "org_test",
        projectionId,
        serviceId: svcTI,
        serviceName: "TI",
        chosenPct: 30,
        isActive: true,
        annualAmount: 36000,
        normalizedWeight: 0.5,
      });

      for (const psId of [psCom, psTI]) {
        for (const m of [1, 2]) {
          await ctx.db.insert("monthlyAssignments", {
            orgId: "org_test",
            projServiceId: psId,
            projectionId,
            clientId,
            serviceName: "x",
            month: m,
            year: 2026,
            amount: 1000,
            feFactor: 1,
            status: "pending",
            invoiceStatus: "not_invoiced",
          });
        }
      }
      return { subCom, subOneShot, subNormal, psCom, psTI };
    });
  }

  it("dry run reports counts without patching", async () => {
    const t = convexTest(schema);
    await seedFixtures(t);

    const result = await t.mutation(
      internal.functions.migrations.pricingModel.migrate,
      { dryRun: true }
    );

    expect(result.dryRun).toBe(true);
    expect(result.subservices).toBe(3);
    expect(result.projectionServices).toBe(2);
    expect(result.monthlyAssignments).toBe(4);

    const subs = await t.run(async (ctx) => ctx.db.query("subservices").collect());
    expect(subs.every((s) => s.defaultPricingModel === undefined)).toBe(true);
  });

  it("apply patches each row with correct derived model", async () => {
    const t = convexTest(schema);
    const { subCom, subOneShot, subNormal, psCom, psTI } = await seedFixtures(t);

    await t.mutation(internal.functions.migrations.pricingModel.migrate, { dryRun: false });

    const subCommission = await t.run(async (ctx) => ctx.db.get(subCom));
    const subOne = await t.run(async (ctx) => ctx.db.get(subOneShot));
    const subN = await t.run(async (ctx) => ctx.db.get(subNormal));
    expect(subCommission?.defaultPricingModel).toBe("commission");
    expect(subOne?.defaultPricingModel).toBe("one_time");
    expect(subN?.defaultPricingModel).toBe("fixed_retainer");

    const psC = await t.run(async (ctx) => ctx.db.get(psCom));
    const psT = await t.run(async (ctx) => ctx.db.get(psTI));
    expect(psC?.pricingModel).toBe("commission");
    expect(psT?.pricingModel).toBe("fixed_retainer");

    const cells = await t.run(async (ctx) => ctx.db.query("monthlyAssignments").collect());
    expect(cells.every((c) => c.isManuallyOverridden === false)).toBe(true);
  });

  it("is idempotent — second run patches 0 rows", async () => {
    const t = convexTest(schema);
    await seedFixtures(t);

    await t.mutation(internal.functions.migrations.pricingModel.migrate, { dryRun: false });
    const second = await t.mutation(
      internal.functions.migrations.pricingModel.migrate,
      { dryRun: false }
    );

    expect(second.subservices).toBe(0);
    expect(second.projectionServices).toBe(0);
    expect(second.monthlyAssignments).toBe(0);
  });

  it("verifyComplete returns 0 pending after apply", async () => {
    const t = convexTest(schema);
    await seedFixtures(t);
    await t.mutation(internal.functions.migrations.pricingModel.migrate, { dryRun: false });

    const verify = await t.query(
      internal.functions.migrations.pricingModel.verifyComplete,
      {}
    );
    expect(verify.subservicesPending).toBe(0);
    expect(verify.projectionServicesPending).toBe(0);
    expect(verify.cellsPending).toBe(0);
  });
});
