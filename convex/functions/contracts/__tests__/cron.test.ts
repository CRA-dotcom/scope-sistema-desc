import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { internal } from "../../../_generated/api";
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
      name: "Cliente Cron",
      rfc: "CCR240101AAA",
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

describe("contractRemindersTick", () => {
  it("picks up contracts sent > 3d ago with reminderCount=0", async () => {
    const t = convexTest(schema);
    const orgId = "org_test";
    const now = Date.now();
    const { clientId, projServiceId, quotationId } = await seedFKs(t, orgId);
    let contractId: Id<"contracts">;

    await t.run(async (ctx) => {
      contractId = await ctx.db.insert("contracts", {
        orgId,
        quotationId,
        projServiceId,
        clientId,
        serviceName: "Legal",
        content: "x",
        status: "sent",
        sentAt: now - 4 * 24 * 3600 * 1000,
        reminderCount: 0,
        createdAt: now,
      });
    });

    const result = await t.mutation(
      internal.functions.contracts.cron.contractRemindersTick,
      {}
    );
    expect(result.scheduled).toBe(1);

    await t.run(async (ctx) => {
      const updated = await ctx.db.get(contractId!);
      expect(updated?.reminderCount).toBe(1);
      expect(updated?.lastReminderAt).toBeTruthy();
    });
  });

  it("does NOT pick up signed contracts", async () => {
    const t = convexTest(schema);
    const orgId = "org_x";
    const now = Date.now();
    const { clientId, projServiceId, quotationId } = await seedFKs(t, orgId);

    await t.run(async (ctx) => {
      await ctx.db.insert("contracts", {
        orgId,
        quotationId,
        projServiceId,
        clientId,
        serviceName: "Legal",
        content: "x",
        status: "signed",
        sentAt: now - 30 * 24 * 3600 * 1000,
        signedAt: now - 25 * 24 * 3600 * 1000,
        createdAt: now,
      });
    });

    const result = await t.mutation(
      internal.functions.contracts.cron.contractRemindersTick,
      {}
    );
    expect(result.scheduled).toBe(0);
  });

  it("respects 3d/7d/14d boundaries and reminderCount progression", async () => {
    const t = convexTest(schema);
    const orgId = "org_test";
    const now = Date.now();
    const { clientId, projServiceId, quotationId } = await seedFKs(t, orgId);

    await t.run(async (ctx) => {
      // Contract A: 2d, count=0 → not picked (below 3d threshold)
      await ctx.db.insert("contracts", {
        orgId,
        quotationId,
        projServiceId,
        clientId,
        serviceName: "A",
        content: "x",
        status: "sent",
        sentAt: now - 2 * 24 * 3600 * 1000,
        reminderCount: 0,
        createdAt: now,
      });
      // Contract B: 5d, count=0 → picked, level 1
      await ctx.db.insert("contracts", {
        orgId,
        quotationId,
        projServiceId,
        clientId,
        serviceName: "B",
        content: "x",
        status: "sent",
        sentAt: now - 5 * 24 * 3600 * 1000,
        reminderCount: 0,
        createdAt: now,
      });
      // Contract C: 8d sent, count=1, lastReminder 5d ago → picked, level 2
      await ctx.db.insert("contracts", {
        orgId,
        quotationId,
        projServiceId,
        clientId,
        serviceName: "C",
        content: "x",
        status: "sent",
        sentAt: now - 8 * 24 * 3600 * 1000,
        reminderCount: 1,
        lastReminderAt: now - 5 * 24 * 3600 * 1000,
        createdAt: now,
      });
      // Contract D: 16d sent, count=2, lastReminder 9d ago → picked, level 3
      await ctx.db.insert("contracts", {
        orgId,
        quotationId,
        projServiceId,
        clientId,
        serviceName: "D",
        content: "x",
        status: "sent",
        sentAt: now - 16 * 24 * 3600 * 1000,
        reminderCount: 2,
        lastReminderAt: now - 9 * 24 * 3600 * 1000,
        createdAt: now,
      });
      // Contract E: 20d, count=3 → not picked (max reached)
      await ctx.db.insert("contracts", {
        orgId,
        quotationId,
        projServiceId,
        clientId,
        serviceName: "E",
        content: "x",
        status: "sent",
        sentAt: now - 20 * 24 * 3600 * 1000,
        reminderCount: 3,
        lastReminderAt: now - 6 * 24 * 3600 * 1000,
        createdAt: now,
      });
    });

    const result = await t.mutation(
      internal.functions.contracts.cron.contractRemindersTick,
      {}
    );
    expect(result.scheduled).toBe(3); // B, C, D
  });
});
