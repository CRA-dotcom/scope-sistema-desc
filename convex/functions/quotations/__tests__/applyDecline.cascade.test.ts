import { describe, it, expect } from "vitest";
import { internal } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../../tests/harness";

describe("applyDecline cascade", () => {
  it("deactivates projectionService and cancels future pending assignments", async () => {
    const t = setupTest();
    const futureYear = new Date().getFullYear() + 1;
    const { quotationId, projServiceId } = await t.run(async (ctx) => {
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
      const qId = await ctx.db.insert("quotations", {
        orgId: ORG_A, projServiceId: psId, clientId, serviceName: "S",
        content: "<p/>", status: "sent",
        accessTokenHash: "hash_v1",
        tokenExpiresAt: Date.now() + 100_000,
        createdAt: Date.now(),
      });
      return { quotationId: qId, projServiceId: psId };
    });

    await t.mutation(
      internal.functions.quotations.internalMutations.applyDecline,
      { tokenHash: "hash_v1", declineReason: "Demasiado caro" }
    );

    const ps = await t.run((ctx) => ctx.db.get(projServiceId));
    expect(ps?.isActive).toBe(false);
    const mas = await t.run((ctx) =>
      ctx.db.query("monthlyAssignments").collect()
    );
    expect(mas).toHaveLength(0);
    const q = await t.run((ctx) => ctx.db.get(quotationId));
    expect(q?.status).toBe("rejected");
    expect(q?.declineReason).toBe("Demasiado caro");
  });

  it("deactivates projectionService for supplementary add-on quotations too (§3.2-bis)", async () => {
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
        chosenPct: 0, isActive: true, annualAmount: 0, normalizedWeight: 0,
        startMonth: 7,
      });
      await ctx.db.insert("quotations", {
        orgId: ORG_A, projServiceId: psId, clientId, serviceName: "S",
        content: "<p/>", status: "sent",
        accessTokenHash: "hash_supp",
        tokenExpiresAt: Date.now() + 100_000,
        isSupplementary: true,
        createdAt: Date.now(),
      });
      return psId;
    });

    await t.mutation(
      internal.functions.quotations.internalMutations.applyDecline,
      { tokenHash: "hash_supp", declineReason: "no" }
    );

    const ps = await t.run((ctx) => ctx.db.get(projServiceId));
    // Add-on rejected → también desactivar (spec §3.2-bis)
    expect(ps?.isActive).toBe(false);
  });
});
