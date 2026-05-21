import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import { setupTest, ORG_A } from "../../../../tests/harness";

const SUPER_ADMIN = {
  tokenIdentifier: "test|super_admin",
  subject: "user_super_admin",
  publicMetadata: { role: "super_admin" } as const,
};

async function seedOrgWithDeliverables(
  t: ReturnType<typeof setupTest>,
  orgClerkId: string,
  plan: "basic" | "pro" | "enterprise",
  deliverablesCount: number,
  costUsdEach: number
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("organizations", {
      clerkOrgId: orgClerkId,
      name: `Org ${orgClerkId}`,
      status: "active" as const,
      plan,
      createdAt: Date.now(),
    });
  });

  const clientId = await t.run(async (ctx) => {
    return await ctx.db.insert("clients", {
      orgId: orgClerkId,
      name: "Cliente",
      rfc: "AAA010101AAA",
      industry: "x",
      annualRevenue: 1_000_000,
      billingFrequency: "mensual" as const,
      isArchived: false,
      createdAt: Date.now(),
    });
  });

  const now = Date.now();
  const year = new Date(now).getUTCFullYear();
  const month = new Date(now).getUTCMonth() + 1;

  for (let i = 0; i < deliverablesCount; i++) {
    await t.run(async (ctx) => {
      const svc = await ctx.db.insert("services", {
        orgId: undefined,
        name: `S${i}`,
        type: "base" as const,
        minPct: 0.01,
        maxPct: 0.03,
        defaultPct: 0.02,
        isDefault: true,
        sortOrder: 1,
      });
      const projId = await ctx.db.insert("projections", {
        orgId: orgClerkId,
        clientId: clientId as Id<"clients">,
        year,
        annualSales: 100,
        totalBudget: 10,
        commissionRate: 0,
        seasonalityData: [],
        status: "active" as const,
        createdAt: now,
        updatedAt: now,
      });
      const ps = await ctx.db.insert("projectionServices", {
        orgId: orgClerkId,
        projectionId: projId,
        serviceId: svc,
        serviceName: "S",
        chosenPct: 0.02,
        isActive: true,
        annualAmount: 100,
        normalizedWeight: 0.5,
      });
      const ma = await ctx.db.insert("monthlyAssignments", {
        orgId: orgClerkId,
        projServiceId: ps,
        projectionId: projId,
        clientId: clientId as Id<"clients">,
        serviceName: "S",
        month,
        year,
        amount: 100,
        feFactor: 1,
        status: "pending" as const,
        invoiceStatus: "not_invoiced" as const,
      });
      await ctx.db.insert("deliverables", {
        orgId: orgClerkId,
        assignmentId: ma,
        projServiceId: ps,
        clientId: clientId as Id<"clients">,
        serviceName: "S",
        month,
        year,
        shortContent: "x",
        longContent: "x",
        auditStatus: "approved" as const,
        retryCount: 0,
        aiLog: [
          {
            role: "draft",
            model: "claude-sonnet",
            inputTokens: 1,
            outputTokens: 1,
            costUsd: costUsdEach,
            timestamp: now,
          },
        ],
        createdAt: now,
      });
    });
  }
}

describe("superAdmin.billing.getUsage", () => {
  it("calcula billable, costo IA (USD+MXN), pct uso y status correctos", async () => {
    const t = setupTest();
    // 10 deliverables, plan=pro (cap 200), costUsd=0.5 each
    await seedOrgWithDeliverables(t, ORG_A, "pro", 10, 0.5);

    const result = await t
      .withIdentity(SUPER_ADMIN)
      .query(api.functions.superAdmin.billing.getUsage, {});

    expect(result.rows.length).toBe(1);
    const row = result.rows[0];
    expect(row.orgId).toBe(ORG_A);
    expect(row.plan).toBe("pro");
    expect(row.deliverablesMonth).toBe(10);
    expect(row.deliverablesCap).toBe(200);
    expect(row.deliverablesPct).toBe(5); // 10/200 = 5%
    // billableMxn = 10 * 850
    expect(row.billableMxn).toBe(8500);
    // aiCostUsd = 10 * 0.5
    expect(row.aiCostUsd).toBeCloseTo(5.0, 5);
    // aiCostMxn = 5 * 17.5
    expect(row.aiCostMxn).toBeCloseTo(87.5, 5);
    // margenMxn = 8500 - 87.5
    expect(row.marginMxn).toBeCloseTo(8412.5, 5);
    expect(row.status).toBe("por_cobrar");
  });
});
