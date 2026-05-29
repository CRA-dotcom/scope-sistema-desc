import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api } from "../../../_generated/api";

const ORG_A = "org_test_A";

describe("dashboard.clientSummary", () => {
  it("returns per-client summary for the requested year", async () => {
    const t = convexTest(schema);
    const targetYear = 2099;
    await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: ORG_A, name: "Acme", rfc: "ACM010101AAA", industry: "Tech",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: ORG_A, clientId, year: targetYear,
        annualSales: 0, totalBudget: 0, commissionRate: 0,
        seasonalityData: [], status: "active",
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      const sId = await ctx.db.insert("services", {
        name: "S", type: "base", minPct: 0, maxPct: 100,
        defaultPct: 10, isDefault: true, sortOrder: 0,
      });
      const psId = await ctx.db.insert("projectionServices", {
        orgId: ORG_A, projectionId, serviceId: sId, serviceName: "S",
        chosenPct: 10, isActive: true, annualAmount: 0, normalizedWeight: 1,
      });
      await ctx.db.insert("monthlyAssignments", {
        orgId: ORG_A, projServiceId: psId, projectionId, clientId,
        serviceName: "S", month: 1, year: targetYear, amount: 100, feFactor: 1,
        status: "pending", invoiceStatus: "not_invoiced",
      });
      await ctx.db.insert("monthlyAssignments", {
        orgId: ORG_A, projServiceId: psId, projectionId, clientId,
        serviceName: "S", month: 2, year: targetYear, amount: 100, feFactor: 1,
        status: "delivered", invoiceStatus: "paid",
      });
      await ctx.db.insert("monthlyAssignments", {
        orgId: ORG_A, projServiceId: psId, projectionId, clientId,
        serviceName: "S", month: 1, year: targetYear - 1, amount: 100, feFactor: 1,
        status: "delivered", invoiceStatus: "paid",
      });
    });

    const result = await t
      .withIdentity({
        subject: "u", tokenIdentifier: "u", orgId: ORG_A, orgRole: "org:admin",
      } as any)
      .query(api.functions.dashboard.queries.clientSummary, { year: targetYear });

    expect(result).toHaveLength(1);
    expect(result[0].clientName).toBe("Acme");
    expect(result[0].totalAssignments).toBe(2);
    expect(result[0].activeProjections).toBe(1);
    expect(result[0].activeServices).toBe(1);
    expect(result[0].pendingPayments).toBe(1);
  });
});
