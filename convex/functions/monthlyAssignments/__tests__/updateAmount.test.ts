import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import schema from "../../../schema";

describe("monthlyAssignments.updateAmount", () => {
  it("sets isManuallyOverridden=true when amount changes", async () => {
    const t = convexTest(schema);
    const asUser = t.withIdentity({
      subject: "user_abc",
      tokenIdentifier: "test|user_abc",
      org_id: "org_test",
      org_role: "org:member",
    });

    const cellId = await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: "org_test",
        name: "Test Client",
        rfc: "XAXX010101000",
        industry: "tecnologia",
        annualRevenue: 5_000_000,
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
        commissionRate: 0.02,
        seasonalityData: [],
        status: "draft",
        createdAt: Date.now(),
        updatedAt: Date.now(),
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
      const projServiceId = await ctx.db.insert("projectionServices", {
        orgId: "org_test",
        projectionId,
        serviceId,
        serviceName: "TI",
        chosenPct: 30,
        isActive: true,
        annualAmount: 36000,
        normalizedWeight: 1,
      });
      return await ctx.db.insert("monthlyAssignments", {
        orgId: "org_test",
        projServiceId,
        projectionId,
        clientId,
        serviceName: "TI",
        month: 1,
        year: 2026,
        amount: 3000,
        feFactor: 1,
        status: "pending",
        invoiceStatus: "not_invoiced",
        isManuallyOverridden: false,
      });
    });

    await asUser.mutation(api.functions.monthlyAssignments.mutations.updateAmount, {
      id: cellId,
      amount: 99_000,
    });

    const updated = await t.run(async (ctx) => await ctx.db.get(cellId));
    expect(updated?.amount).toBe(99_000);
    expect(updated?.isManuallyOverridden).toBe(true);
  });
});
