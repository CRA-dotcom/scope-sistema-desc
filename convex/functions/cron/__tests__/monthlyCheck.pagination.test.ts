import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { internal } from "../../../_generated/api";

describe("monthlyCheck pagination", () => {
  it("listActiveProjectionsByOrg returns only active in that org", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      const cA = await ctx.db.insert("clients", {
        orgId: "org_A", name: "CA", rfc: "X", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      await ctx.db.insert("projections", {
        orgId: "org_A", clientId: cA, year: 2026,
        annualSales: 0, totalBudget: 0, commissionRate: 0,
        seasonalityData: [], status: "active",
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      await ctx.db.insert("projections", {
        orgId: "org_A", clientId: cA, year: 2026,
        annualSales: 0, totalBudget: 0, commissionRate: 0,
        seasonalityData: [], status: "draft",
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      const cB = await ctx.db.insert("clients", {
        orgId: "org_B", name: "CB", rfc: "Y", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      await ctx.db.insert("projections", {
        orgId: "org_B", clientId: cB, year: 2026,
        annualSales: 0, totalBudget: 0, commissionRate: 0,
        seasonalityData: [], status: "active",
        createdAt: Date.now(), updatedAt: Date.now(),
      });
    });

    const result = await t.query(
      internal.functions.cron.monthlyCheck.listActiveProjectionsByOrg,
      { orgId: "org_A" }
    );
    expect(result).toHaveLength(1);
    expect(result[0].orgId).toBe("org_A");
  });

  it("listAssignmentsForMonthByOrg uses by_orgId_year_month", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      const cId = await ctx.db.insert("clients", {
        orgId: "org_A", name: "C", rfc: "X", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      const pId = await ctx.db.insert("projections", {
        orgId: "org_A", clientId: cId, year: 2026,
        annualSales: 0, totalBudget: 0, commissionRate: 0,
        seasonalityData: [], status: "active",
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      const sId = await ctx.db.insert("services", {
        name: "S", type: "base", minPct: 0, maxPct: 100,
        defaultPct: 10, isDefault: true, sortOrder: 0,
      });
      const psId = await ctx.db.insert("projectionServices", {
        orgId: "org_A", projectionId: pId, serviceId: sId, serviceName: "S",
        chosenPct: 10, isActive: true, annualAmount: 0, normalizedWeight: 1,
      });
      await ctx.db.insert("monthlyAssignments", {
        orgId: "org_A", projServiceId: psId, projectionId: pId, clientId: cId,
        serviceName: "S", month: 3, year: 2026, amount: 100, feFactor: 1,
        status: "pending", invoiceStatus: "not_invoiced",
      });
      await ctx.db.insert("monthlyAssignments", {
        orgId: "org_A", projServiceId: psId, projectionId: pId, clientId: cId,
        serviceName: "S", month: 3, year: 2026, amount: 100, feFactor: 1,
        status: "delivered", invoiceStatus: "paid",
      });
      await ctx.db.insert("monthlyAssignments", {
        orgId: "org_A", projServiceId: psId, projectionId: pId, clientId: cId,
        serviceName: "S", month: 4, year: 2026, amount: 100, feFactor: 1,
        status: "pending", invoiceStatus: "not_invoiced",
      });
    });

    const result = await t.query(
      internal.functions.cron.monthlyCheck.listAssignmentsForMonthByOrg,
      { orgId: "org_A", month: 3, year: 2026 }
    );
    expect(result).toHaveLength(2);
  });
});
