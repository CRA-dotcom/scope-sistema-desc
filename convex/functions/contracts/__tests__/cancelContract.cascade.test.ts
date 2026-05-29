import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

describe("cancelContract cascade", () => {
  it("deactivates projService and cancels future MAs when contract is cancelled", async () => {
    const t = convexTest(schema);
    const orgId = "org_test";
    const futureYear = new Date().getFullYear() + 1;

    let contractId: Id<"contracts">;
    let projServiceId: Id<"projectionServices">;

    await t.run(async (ctx) => {
      const now = Date.now();

      const serviceId = await ctx.db.insert("services", {
        orgId: undefined,
        name: "S",
        type: "base" as const,
        minPct: 0,
        maxPct: 100,
        defaultPct: 10,
        isDefault: true,
        sortOrder: 0,
      });

      const clientId = await ctx.db.insert("clients", {
        orgId,
        name: "C",
        rfc: "X",
        industry: "S",
        annualRevenue: 0,
        billingFrequency: "mensual" as const,
        isArchived: false,
        createdAt: now,
      });

      const projectionId = await ctx.db.insert("projections", {
        orgId,
        clientId,
        year: futureYear,
        annualSales: 0,
        totalBudget: 0,
        commissionRate: 0,
        seasonalityData: [],
        status: "active" as const,
        createdAt: now,
        updatedAt: now,
      });

      const psId = await ctx.db.insert("projectionServices", {
        orgId,
        projectionId,
        serviceId,
        serviceName: "S",
        chosenPct: 10,
        isActive: true,
        annualAmount: 0,
        normalizedWeight: 1,
      });
      projServiceId = psId;

      await ctx.db.insert("monthlyAssignments", {
        orgId,
        projServiceId: psId,
        projectionId,
        clientId,
        serviceName: "S",
        month: 6,
        year: futureYear,
        amount: 100,
        feFactor: 1,
        status: "pending" as const,
        invoiceStatus: "not_invoiced" as const,
      });

      const quotationId = await ctx.db.insert("quotations", {
        orgId,
        projServiceId: psId,
        clientId,
        serviceName: "S",
        content: "<p/>",
        status: "approved" as const,
        createdAt: now,
      });

      contractId = await ctx.db.insert("contracts", {
        orgId,
        quotationId,
        projServiceId: psId,
        clientId,
        serviceName: "S",
        content: "<p/>",
        status: "sent" as const,
        createdAt: now,
      });
    });

    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });
    await auth.mutation(api.functions.contracts.mutations.cancelContract, {
      contractId: contractId!,
      reason: "Cliente desistió",
    });

    await t.run(async (ctx) => {
      const c = await ctx.db.get(contractId!);
      expect(c?.status).toBe("cancelled");

      const ps = await ctx.db.get(projServiceId!);
      expect(ps?.isActive).toBe(false);

      const mas = await ctx.db
        .query("monthlyAssignments")
        .withIndex("by_projServiceId", (q) =>
          q.eq("projServiceId", projServiceId!)
        )
        .collect();
      expect(mas).toHaveLength(0);
    });
  });
});
