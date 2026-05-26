import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import schema from "../../../schema";

describe("projections.create with dynamic_retainer subservice", () => {
  it("seeds monthlyAssignments with isManuallyOverridden=true", async () => {
    const t = convexTest(schema);
    const asAdmin = t.withIdentity({
      subject: "user_abc",
      tokenIdentifier: "test|user_abc",
      org_id: "org_test",
      org_role: "org:admin",
    });

    const { clientId, serviceId, subserviceId } = await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: "org_test",
        name: "Test",
        rfc: "XAXX010101000",
        industry: "tecnologia",
        annualRevenue: 1_200_000,
        billingFrequency: "mensual" as const,
        isArchived: false,
        createdAt: Date.now(),
      });
      const serviceId = await ctx.db.insert("services", {
        orgId: undefined,
        name: "Legal",
        type: "base" as const,
        minPct: 0,
        maxPct: 100,
        defaultPct: 30,
        isDefault: true,
        sortOrder: 1,
      });
      const subserviceId = await ctx.db.insert("subservices", {
        orgId: undefined,
        parentServiceId: serviceId,
        name: "Asesoría Legal",
        slug: "asesoria-legal",
        defaultFrequency: "mensual" as const,
        defaultPricingModel: "dynamic_retainer" as const,
        isActive: true,
        isDefault: false,
        sortOrder: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return { clientId, serviceId, subserviceId };
    });

    const projectionId = await asAdmin.mutation(api.functions.projections.mutations.create, {
      clientId,
      year: 2026,
      annualSales: 1_200_000,
      totalBudget: 120_000,
      commissionRate: 0,
      seasonalityData: Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        monthlySales: 100_000,
        feFactor: 1,
      })),
      serviceConfigs: [
        {
          serviceId,
          subserviceId,
          chosenPct: 100,
          isActive: true,
        },
      ],
    });

    const cells = await t.run(async (ctx) => {
      return await ctx.db
        .query("monthlyAssignments")
        .withIndex("by_projectionId", (q) => q.eq("projectionId", projectionId))
        .collect();
    });

    expect(cells.length).toBe(12);
    expect(cells.every((c) => c.isManuallyOverridden === true)).toBe(true);
  });

  it("seeds monthlyAssignments with isManuallyOverridden=false for fixed_retainer subservice", async () => {
    const t = convexTest(schema);
    const asAdmin = t.withIdentity({
      subject: "user_abc",
      tokenIdentifier: "test|user_abc",
      org_id: "org_test",
      org_role: "org:admin",
    });

    const { clientId, serviceId, subserviceId } = await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: "org_test",
        name: "Test Fixed",
        rfc: "XAXX010101001",
        industry: "tecnologia",
        annualRevenue: 1_200_000,
        billingFrequency: "mensual" as const,
        isArchived: false,
        createdAt: Date.now(),
      });
      const serviceId = await ctx.db.insert("services", {
        orgId: undefined,
        name: "Contabilidad",
        type: "base" as const,
        minPct: 0,
        maxPct: 100,
        defaultPct: 30,
        isDefault: true,
        sortOrder: 2,
      });
      const subserviceId = await ctx.db.insert("subservices", {
        orgId: undefined,
        parentServiceId: serviceId,
        name: "Contabilidad General",
        slug: "contabilidad-general",
        defaultFrequency: "mensual" as const,
        defaultPricingModel: "fixed_retainer" as const,
        isActive: true,
        isDefault: false,
        sortOrder: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return { clientId, serviceId, subserviceId };
    });

    const projectionId = await asAdmin.mutation(api.functions.projections.mutations.create, {
      clientId,
      year: 2026,
      annualSales: 1_200_000,
      totalBudget: 120_000,
      commissionRate: 0,
      seasonalityData: Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        monthlySales: 100_000,
        feFactor: 1,
      })),
      serviceConfigs: [
        {
          serviceId,
          subserviceId,
          chosenPct: 100,
          isActive: true,
        },
      ],
    });

    const cells = await t.run(async (ctx) => {
      return await ctx.db
        .query("monthlyAssignments")
        .withIndex("by_projectionId", (q) => q.eq("projectionId", projectionId))
        .collect();
    });

    expect(cells.length).toBe(12);
    // fixed_retainer → isManuallyOverridden should be false (not set to true)
    expect(cells.every((c) => c.isManuallyOverridden !== true)).toBe(true);
  });
});
