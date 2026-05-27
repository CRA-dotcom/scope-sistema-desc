import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

/**
 * Seed the minimal FK rows required to insert a contract.
 * Returns { clientId, projServiceId, quotationId }.
 */
async function seedFKs(
  t: ReturnType<typeof convexTest>,
  orgId: string
): Promise<{
  clientId: Id<"clients">;
  projServiceId: Id<"projectionServices">;
  quotationId: Id<"quotations">;
}> {
  return t.run(async (ctx) => {
    const now = Date.now();

    const serviceId = await ctx.db.insert("services", {
      orgId: undefined,
      name: "Legal",
      type: "base" as const,
      minPct: 0.01,
      maxPct: 0.03,
      defaultPct: 0.02,
      isDefault: true,
      sortOrder: 1,
    });

    const clientId = await ctx.db.insert("clients", {
      orgId,
      name: "Cliente Cancel",
      rfc: "CCX240101AAA",
      industry: "Servicios",
      annualRevenue: 1_000_000,
      billingFrequency: "mensual" as const,
      isArchived: false,
      createdAt: now,
    });

    const projectionId = await ctx.db.insert("projections", {
      orgId,
      clientId,
      year: 2026,
      annualSales: 1_000_000,
      totalBudget: 100_000,
      commissionRate: 0,
      seasonalityData: [],
      status: "active" as const,
      createdAt: now,
      updatedAt: now,
    });

    const projServiceId = await ctx.db.insert("projectionServices", {
      orgId,
      projectionId,
      serviceId,
      serviceName: "Legal",
      chosenPct: 0.02,
      isActive: true,
      annualAmount: 20_000,
      normalizedWeight: 0.02,
    });

    const quotationId = await ctx.db.insert("quotations", {
      orgId,
      projServiceId,
      clientId,
      serviceName: "Legal",
      content: "stub",
      status: "approved" as const,
      createdAt: now,
    });

    return { clientId, projServiceId, quotationId };
  });
}

describe("cancelContract", () => {
  it("admin can cancel sent contract", async () => {
    const t = convexTest(schema);
    const orgId = "org_test";
    const { clientId, projServiceId, quotationId } = await seedFKs(t, orgId);
    let contractId: Id<"contracts">;

    await t.run(async (ctx) => {
      contractId = await ctx.db.insert("contracts", {
        orgId,
        quotationId,
        projServiceId,
        clientId,
        serviceName: "Legal",
        content: "stub",
        status: "sent",
        sentAt: Date.now(),
        createdAt: Date.now(),
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
      expect(c?.cancellationReason).toBe("Cliente desistió");

      // documentEvents row should be created
      const events = await ctx.db
        .query("documentEvents")
        .withIndex("by_orgId_entityType_entityId", (q) =>
          q.eq("orgId", orgId).eq("entityType", "contract").eq("entityId", contractId!)
        )
        .collect();
      expect(events.length).toBe(1);
      expect(events[0].eventType).toBe("voided");
      expect(events[0].actorType).toBe("user");
    });
  });

  it("rejects cancel of already-signed contract", async () => {
    const t = convexTest(schema);
    const orgId = "org_test";
    const { clientId, projServiceId, quotationId } = await seedFKs(t, orgId);
    let contractId: Id<"contracts">;

    await t.run(async (ctx) => {
      contractId = await ctx.db.insert("contracts", {
        orgId,
        quotationId,
        projServiceId,
        clientId,
        serviceName: "Legal",
        content: "stub",
        status: "signed",
        signedAt: Date.now(),
        createdAt: Date.now(),
      });
    });

    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });
    await expect(
      auth.mutation(api.functions.contracts.mutations.cancelContract, {
        contractId: contractId!,
        reason: "x",
      })
    ).rejects.toThrow(/signed/i);
  });
});
