import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import schema from "../../../schema";

describe("projectionServices.changePricingModel", () => {
  async function setup(t: ReturnType<typeof convexTest>) {
    return await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: "org_test",
        name: "Test",
        rfc: "XAXX010101000",
        industry: "tecnologia",
        annualRevenue: 5_000_000,
        billingFrequency: "mensual",
        isArchived: false,
        createdAt: Date.now(),
      });
      const serviceId = await ctx.db.insert("services", {
        orgId: undefined,
        name: "TI",
        type: "base",
        minPct: 0,
        maxPct: 100,
        defaultPct: 30,
        isDefault: true,
        sortOrder: 1,
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
      const projServiceId = await ctx.db.insert("projectionServices", {
        orgId: "org_test",
        projectionId,
        serviceId,
        serviceName: "TI",
        chosenPct: 100,
        isActive: true,
        annualAmount: 120_000,
        normalizedWeight: 1,
        pricingModel: "fixed_retainer",
      });
      for (let m = 1; m <= 12; m++) {
        await ctx.db.insert("monthlyAssignments", {
          orgId: "org_test",
          projServiceId,
          projectionId,
          clientId,
          serviceName: "TI",
          month: m,
          year: 2026,
          amount: 10_000,
          feFactor: 1,
          status: "pending",
          invoiceStatus: "not_invoiced",
          isManuallyOverridden: false,
        });
      }
      return { projServiceId, projectionId };
    });
  }

  it("fixed_retainer → dynamic_retainer flips all cells to isManuallyOverridden=true", async () => {
    const t = convexTest(schema);
    const asAdmin = t.withIdentity({
      subject: "u",
      tokenIdentifier: "t|u",
      org_id: "org_test",
      org_role: "org:admin",
    });
    const { projServiceId } = await setup(t);

    await asAdmin.mutation(
      api.functions.projectionServices.mutations.changePricingModel,
      { id: projServiceId, newModel: "dynamic_retainer", confirmReset: true }
    );

    const cells = await t.run(async (ctx) =>
      ctx.db
        .query("monthlyAssignments")
        .withIndex("by_projServiceId", (q) => q.eq("projServiceId", projServiceId))
        .collect()
    );
    expect(cells.every((c) => c.isManuallyOverridden === true)).toBe(true);

    const ps = await t.run(async (ctx) => ctx.db.get(projServiceId));
    expect(ps?.pricingModel).toBe("dynamic_retainer");
  });

  it("dynamic_retainer → fixed_retainer flips all cells to isManuallyOverridden=false", async () => {
    const t = convexTest(schema);
    const asAdmin = t.withIdentity({
      subject: "u",
      tokenIdentifier: "t|u",
      org_id: "org_test",
      org_role: "org:admin",
    });
    const { projServiceId } = await setup(t);

    await t.run(async (ctx) => {
      await ctx.db.patch(projServiceId, { pricingModel: "dynamic_retainer" });
      const cells = await ctx.db
        .query("monthlyAssignments")
        .withIndex("by_projServiceId", (q) => q.eq("projServiceId", projServiceId))
        .collect();
      for (const c of cells) {
        await ctx.db.patch(c._id, { isManuallyOverridden: true });
      }
    });

    await asAdmin.mutation(
      api.functions.projectionServices.mutations.changePricingModel,
      { id: projServiceId, newModel: "fixed_retainer", confirmReset: true }
    );

    const cells = await t.run(async (ctx) =>
      ctx.db
        .query("monthlyAssignments")
        .withIndex("by_projServiceId", (q) => q.eq("projServiceId", projServiceId))
        .collect()
    );
    expect(cells.every((c) => c.isManuallyOverridden === false)).toBe(true);
  });

  it("throws when confirmReset is false", async () => {
    const t = convexTest(schema);
    const asAdmin = t.withIdentity({
      subject: "u",
      tokenIdentifier: "t|u",
      org_id: "org_test",
      org_role: "org:admin",
    });
    const { projServiceId } = await setup(t);

    await expect(
      asAdmin.mutation(
        api.functions.projectionServices.mutations.changePricingModel,
        { id: projServiceId, newModel: "dynamic_retainer", confirmReset: false }
      )
    ).rejects.toThrow(/confirmReset/);
  });
});
