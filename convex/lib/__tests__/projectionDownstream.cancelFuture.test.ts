import { describe, it, expect } from "vitest";
import { setupTest, ORG_A } from "../../../tests/harness";
import { cancelFuturePendingAssignments } from "../projectionDownstream";

describe("cancelFuturePendingAssignments", () => {
  it("deletes future pending + not_invoiced assignments", async () => {
    const t = setupTest();
    const now = new Date();
    const futureYear = now.getFullYear() + 1;

    const projServiceId = await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: ORG_A, name: "C", rfc: "X", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: ORG_A, clientId, year: futureYear,
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
      // Future + pending + not_invoiced → DEBE borrarse
      await ctx.db.insert("monthlyAssignments", {
        orgId: ORG_A, projServiceId: psId, projectionId, clientId,
        serviceName: "S", month: 6, year: futureYear, amount: 100, feFactor: 1,
        status: "pending", invoiceStatus: "not_invoiced",
      });
      // Future pero in_progress → KEEP
      await ctx.db.insert("monthlyAssignments", {
        orgId: ORG_A, projServiceId: psId, projectionId, clientId,
        serviceName: "S", month: 7, year: futureYear, amount: 100, feFactor: 1,
        status: "in_progress", invoiceStatus: "not_invoiced",
      });
      // Future pero ya facturada → KEEP
      await ctx.db.insert("monthlyAssignments", {
        orgId: ORG_A, projServiceId: psId, projectionId, clientId,
        serviceName: "S", month: 8, year: futureYear, amount: 100, feFactor: 1,
        status: "pending", invoiceStatus: "invoiced",
      });
      // Pasado pending not_invoiced → KEEP (no tocamos historia)
      await ctx.db.insert("monthlyAssignments", {
        orgId: ORG_A, projServiceId: psId, projectionId, clientId,
        serviceName: "S", month: 1, year: now.getFullYear() - 1, amount: 100, feFactor: 1,
        status: "pending", invoiceStatus: "not_invoiced",
      });
      return psId;
    });

    await t.run(async (ctx) => {
      await cancelFuturePendingAssignments(ctx, projServiceId);
    });

    const remaining = await t.run((ctx) =>
      ctx.db.query("monthlyAssignments").collect()
    );
    expect(remaining).toHaveLength(3);
    expect(remaining.find((m) => m.month === 6 && m.year === futureYear)).toBeUndefined();
  });

  it("is idempotent (second call is a no-op)", async () => {
    const t = setupTest();
    const futureYear = new Date().getFullYear() + 1;
    const projServiceId = await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: ORG_A, name: "C", rfc: "X", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: ORG_A, clientId, year: futureYear,
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
      await ctx.db.insert("monthlyAssignments", {
        orgId: ORG_A, projServiceId: psId, projectionId, clientId,
        serviceName: "S", month: 6, year: futureYear, amount: 100, feFactor: 1,
        status: "pending", invoiceStatus: "not_invoiced",
      });
      return psId;
    });

    await t.run((ctx) => cancelFuturePendingAssignments(ctx, projServiceId));
    await t.run((ctx) => cancelFuturePendingAssignments(ctx, projServiceId));

    const remaining = await t.run((ctx) =>
      ctx.db.query("monthlyAssignments").collect()
    );
    expect(remaining).toHaveLength(0);
  });
});
