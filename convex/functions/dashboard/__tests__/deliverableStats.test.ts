import { describe, it, expect } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { api } from "../../../_generated/api";

const ORG_A = "org_test_A";

function asUserOfOrg(orgId: string, userSubject: string = `user|${orgId}`) {
  return {
    subject: userSubject,
    issuer: "test",
    tokenIdentifier: `test|${userSubject}`,
    orgId,
  };
}

describe("dashboard.deliverableStats", () => {
  it("returns correct counts by status for the requested year", async () => {
    const t = setupTest();
    const targetYear = 2099; // future year so "overdue" logic doesn't fire

    await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: ORG_A, name: "C", rfc: "X", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: ORG_A, clientId, year: targetYear,
        annualSales: 0, totalBudget: 0, commissionRate: 0,
        seasonalityData: [], status: "active",
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      const serviceId = await ctx.db.insert("services", {
        name: "S", type: "base", minPct: 0, maxPct: 100,
        defaultPct: 10, isDefault: true, sortOrder: 0,
      });
      const psId = await ctx.db.insert("projectionServices", {
        orgId: ORG_A, projectionId, serviceId, serviceName: "S",
        chosenPct: 10, isActive: true, annualAmount: 0, normalizedWeight: 1,
      });
      const statuses = ["pending", "pending", "in_progress", "delivered"] as const;
      for (let i = 0; i < statuses.length; i++) {
        await ctx.db.insert("monthlyAssignments", {
          orgId: ORG_A, projServiceId: psId, projectionId, clientId,
          serviceName: "S", month: i + 1, year: targetYear,
          amount: 100, feFactor: 1,
          status: statuses[i],
          invoiceStatus: "not_invoiced",
        });
      }
      // assignment in a DIFFERENT year — must NOT be counted
      await ctx.db.insert("monthlyAssignments", {
        orgId: ORG_A, projServiceId: psId, projectionId, clientId,
        serviceName: "S", month: 1, year: targetYear + 1,
        amount: 100, feFactor: 1,
        status: "delivered", invoiceStatus: "paid",
      });
    });

    const result = await t
      .withIdentity(asUserOfOrg(ORG_A))
      .query(api.functions.dashboard.queries.deliverableStats, { year: targetYear });

    expect(result.pending).toBe(2);
    expect(result.in_progress).toBe(1);
    expect(result.delivered).toBe(1);
    expect(result.info_received).toBe(0);
    expect(result.overdue).toBe(0);
  });

  it("isolates by org (does not count assignments from other orgs)", async () => {
    const t = setupTest();
    const targetYear = 2099;
    await t.run(async (ctx) => {
      const cA = await ctx.db.insert("clients", {
        orgId: ORG_A, name: "CA", rfc: "XA", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      const pA = await ctx.db.insert("projections", {
        orgId: ORG_A, clientId: cA, year: targetYear,
        annualSales: 0, totalBudget: 0, commissionRate: 0,
        seasonalityData: [], status: "active",
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      const sId = await ctx.db.insert("services", {
        name: "S", type: "base", minPct: 0, maxPct: 100,
        defaultPct: 10, isDefault: true, sortOrder: 0,
      });
      const psA = await ctx.db.insert("projectionServices", {
        orgId: ORG_A, projectionId: pA, serviceId: sId, serviceName: "S",
        chosenPct: 10, isActive: true, annualAmount: 0, normalizedWeight: 1,
      });
      await ctx.db.insert("monthlyAssignments", {
        orgId: ORG_A, projServiceId: psA, projectionId: pA, clientId: cA,
        serviceName: "S", month: 1, year: targetYear, amount: 100, feFactor: 1,
        status: "pending", invoiceStatus: "not_invoiced",
      });
      const cB = await ctx.db.insert("clients", {
        orgId: "org_test_B", name: "CB", rfc: "XB", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      const pB = await ctx.db.insert("projections", {
        orgId: "org_test_B", clientId: cB, year: targetYear,
        annualSales: 0, totalBudget: 0, commissionRate: 0,
        seasonalityData: [], status: "active",
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      const psB = await ctx.db.insert("projectionServices", {
        orgId: "org_test_B", projectionId: pB, serviceId: sId, serviceName: "S",
        chosenPct: 10, isActive: true, annualAmount: 0, normalizedWeight: 1,
      });
      await ctx.db.insert("monthlyAssignments", {
        orgId: "org_test_B", projServiceId: psB, projectionId: pB, clientId: cB,
        serviceName: "S", month: 1, year: targetYear, amount: 100, feFactor: 1,
        status: "delivered", invoiceStatus: "paid",
      });
    });

    const result = await t
      .withIdentity(asUserOfOrg(ORG_A))
      .query(api.functions.dashboard.queries.deliverableStats, { year: targetYear });
    expect(result.pending).toBe(1);
    expect(result.delivered).toBe(0);
  });
});
