import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import schema from "../../../schema";

describe("projections.recalculate preserves overridden cells", () => {
  it("does NOT clobber a cell with isManuallyOverridden=true when annualSales changes", async () => {
    const t = convexTest(schema);
    const asAdmin = t.withIdentity({
      subject: "user_abc",
      tokenIdentifier: "test|user_abc",
      org_id: "org_test",
      org_role: "org:admin",
    });

    const { clientId, serviceId } = await t.run(async (ctx) => {
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
        name: "TI",
        type: "base" as const,
        minPct: 0,
        maxPct: 100,
        defaultPct: 30,
        isDefault: true,
        sortOrder: 1,
      });
      return { clientId, serviceId };
    });

    const newProjectionId = await asAdmin.mutation(api.functions.projections.mutations.create, {
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
      serviceConfigs: [{ serviceId, chosenPct: 100, isActive: true }],
    });

    // Override the March cell to 99_000
    const marchCell = await t.run(async (ctx) => {
      const cells = await ctx.db
        .query("monthlyAssignments")
        .withIndex("by_projectionId", (q) => q.eq("projectionId", newProjectionId))
        .collect();
      return cells.find((c) => c.month === 3)!;
    });

    await asAdmin.mutation(api.functions.monthlyAssignments.mutations.updateAmount, {
      id: marchCell._id,
      amount: 99_000,
    });

    // Now recalculate with new annualSales
    await asAdmin.mutation(api.functions.projections.mutations.recalculate, {
      projectionId: newProjectionId,
      annualSales: 2_400_000,
      totalBudget: 240_000,
      commissionRate: 0,
      seasonalityData: Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        monthlySales: 200_000,
        feFactor: 1,
      })),
    });

    const cellsAfter = await t.run(async (ctx) => {
      return await ctx.db
        .query("monthlyAssignments")
        .withIndex("by_projectionId", (q) => q.eq("projectionId", newProjectionId))
        .collect();
    });

    const marchAfter = cellsAfter.find((c) => c.month === 3);
    expect(marchAfter?.amount).toBe(99_000); // PRESERVED
    expect(marchAfter?.isManuallyOverridden).toBe(true);

    const aprilAfter = cellsAfter.find((c) => c.month === 4);
    expect(aprilAfter?.amount).toBeCloseTo(20_000, 0);
    expect(aprilAfter?.isManuallyOverridden).toBe(false);
  });

  it("dynamic_retainer: annualAmount stays in sync with cells after recalc (consistency fix)", async () => {
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
        defaultFrequency: "mensual",
        defaultPricingModel: "dynamic_retainer",
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
      serviceConfigs: [{ serviceId, subserviceIds: [subserviceId], chosenPct: 100, isActive: true }],
    });

    // Verify initial state: cells sum = annualAmount = 120k
    const initialState = await t.run(async (ctx) => {
      const cells = await ctx.db
        .query("monthlyAssignments")
        .withIndex("by_projectionId", (q) => q.eq("projectionId", projectionId))
        .collect();
      const ps = await ctx.db
        .query("projectionServices")
        .withIndex("by_projectionId", (q) => q.eq("projectionId", projectionId))
        .collect();
      return {
        cellsSum: cells.reduce((s, c) => s + c.amount, 0),
        annualAmount: ps[0].annualAmount,
      };
    });
    expect(initialState.cellsSum).toBeCloseTo(120_000, 0);
    expect(initialState.annualAmount).toBeCloseTo(120_000, 0);

    // Recalculate with doubled annualSales (and proportional totalBudget)
    await asAdmin.mutation(api.functions.projections.mutations.recalculate, {
      projectionId,
      annualSales: 2_400_000,
      totalBudget: 240_000,
      commissionRate: 0,
      seasonalityData: Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        monthlySales: 200_000,
        feFactor: 1,
      })),
    });

    // dynamic_retainer cells should be frozen at the original seed (120k total).
    // annualAmount should match the actual cells, NOT the engine's new 240k.
    const finalState = await t.run(async (ctx) => {
      const cells = await ctx.db
        .query("monthlyAssignments")
        .withIndex("by_projectionId", (q) => q.eq("projectionId", projectionId))
        .collect();
      const ps = await ctx.db
        .query("projectionServices")
        .withIndex("by_projectionId", (q) => q.eq("projectionId", projectionId))
        .collect();
      return {
        cellsSum: cells.reduce((s, c) => s + c.amount, 0),
        annualAmount: ps[0].annualAmount,
        cellsAllFlagged: cells.every((c) => c.isManuallyOverridden === true),
      };
    });

    expect(finalState.cellsAllFlagged).toBe(true);
    expect(finalState.cellsSum).toBeCloseTo(120_000, 0);
    expect(finalState.annualAmount).toBeCloseTo(120_000, 0);
  });
});
