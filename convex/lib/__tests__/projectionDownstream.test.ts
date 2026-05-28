import { describe, it, expect } from "vitest";
import { setupTest } from "../../../tests/harness";
import { getProjectionDownstreamCounts } from "../projectionDownstream";

describe("projectionDownstream.getProjectionDownstreamCounts", () => {
  it("returns zero counts when projection has no downstream", async () => {
    const t = setupTest();
    const { projectionId } = await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: "org_a", name: "X", rfc: "AAA010101AAA", industry: "X",
        annualRevenue: 1, billingFrequency: "mensual" as const,
        isArchived: false, assignedTo: "u", createdAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: "org_a", clientId, year: 2026, annualSales: 1, totalBudget: 1,
        commissionRate: 0, seasonalityData: [], status: "active" as const,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      return { projectionId };
    });
    const counts = await t.run(async (ctx) => getProjectionDownstreamCounts(ctx, projectionId));
    expect(counts).toEqual({
      projServices: 0,
      assignments: 0,
      quotations: 0,
      contracts: 0,
      deliverables: 0,
      invoices: 0,
    });
  });
});
