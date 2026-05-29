import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { internal } from "../../../_generated/api";

describe("overdueCheck pagination", () => {
  it("listOrgIds returns clerkOrgIds from organizations table (active only)", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("organizations", {
        clerkOrgId: "org_A", name: "Org A", status: "active",
        plan: "basic", createdAt: Date.now(),
      });
      await ctx.db.insert("organizations", {
        clerkOrgId: "org_B", name: "Org B", status: "active",
        plan: "basic", createdAt: Date.now(),
      });
      await ctx.db.insert("organizations", {
        clerkOrgId: "org_inactive", name: "Org C", status: "inactive",
        plan: "basic", createdAt: Date.now(),
      });
    });

    const ids = await t.query(internal.functions.cron.overdueCheck.listOrgIds, {});
    expect(ids.sort()).toEqual(["org_A", "org_B"]);
  });

  it("listPendingAssignmentsByOrg uses index and respects org boundary", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      const cA = await ctx.db.insert("clients", {
        orgId: "org_A", name: "CA", rfc: "X", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      const pA = await ctx.db.insert("projections", {
        orgId: "org_A", clientId: cA, year: 2026,
        annualSales: 0, totalBudget: 0, commissionRate: 0,
        seasonalityData: [], status: "active",
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      const sId = await ctx.db.insert("services", {
        name: "S", type: "base", minPct: 0, maxPct: 100,
        defaultPct: 10, isDefault: true, sortOrder: 0,
      });
      const psA = await ctx.db.insert("projectionServices", {
        orgId: "org_A", projectionId: pA, serviceId: sId, serviceName: "S",
        chosenPct: 10, isActive: true, annualAmount: 0, normalizedWeight: 1,
      });
      // org_A: 1 pending, 1 delivered
      await ctx.db.insert("monthlyAssignments", {
        orgId: "org_A", projServiceId: psA, projectionId: pA, clientId: cA,
        serviceName: "S", month: 1, year: 2026, amount: 100, feFactor: 1,
        status: "pending", invoiceStatus: "not_invoiced",
      });
      await ctx.db.insert("monthlyAssignments", {
        orgId: "org_A", projServiceId: psA, projectionId: pA, clientId: cA,
        serviceName: "S", month: 2, year: 2026, amount: 100, feFactor: 1,
        status: "delivered", invoiceStatus: "paid",
      });
      // org_B: 1 pending
      const cB = await ctx.db.insert("clients", {
        orgId: "org_B", name: "CB", rfc: "Y", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      const pB = await ctx.db.insert("projections", {
        orgId: "org_B", clientId: cB, year: 2026,
        annualSales: 0, totalBudget: 0, commissionRate: 0,
        seasonalityData: [], status: "active",
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      const psB = await ctx.db.insert("projectionServices", {
        orgId: "org_B", projectionId: pB, serviceId: sId, serviceName: "S",
        chosenPct: 10, isActive: true, annualAmount: 0, normalizedWeight: 1,
      });
      await ctx.db.insert("monthlyAssignments", {
        orgId: "org_B", projServiceId: psB, projectionId: pB, clientId: cB,
        serviceName: "S", month: 1, year: 2026, amount: 100, feFactor: 1,
        status: "pending", invoiceStatus: "not_invoiced",
      });
    });

    const result = await t.query(
      internal.functions.cron.overdueCheck.listPendingAssignmentsByOrg,
      { orgId: "org_A" }
    );
    expect(result).toHaveLength(1);
    expect(result[0].orgId).toBe("org_A");
  });
});
