import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import { setupTest, ORG_A, ORG_B } from "../../../../tests/harness";

const SUPER_ADMIN = {
  tokenIdentifier: "test|super_admin",
  subject: "user_super_admin",
  publicMetadata: { role: "super_admin" } as const,
};

function admin(orgId: string) {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `user_admin_${orgId}`,
    orgId,
    orgRole: "org:admin" as const,
  };
}

async function seedOrg(
  t: ReturnType<typeof setupTest>,
  clerkOrgId: string,
  name: string,
  plan: "basic" | "pro" | "enterprise" = "pro"
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("organizations", {
      clerkOrgId,
      name,
      status: "active" as const,
      plan,
      createdAt: Date.now(),
    });
  });
}

async function seedClient(
  t: ReturnType<typeof setupTest>,
  orgId: string,
  name: string
): Promise<Id<"clients">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("clients", {
      orgId,
      name,
      rfc: "TEST010101AAA",
      industry: "x",
      annualRevenue: 1_000_000,
      billingFrequency: "mensual" as const,
      isArchived: false,
      createdAt: Date.now(),
    });
  });
}

/**
 * Seed a deliverable + the minimum required FK chain
 * (projections, projectionServices, monthlyAssignments).
 */
async function seedDeliverable(
  t: ReturnType<typeof setupTest>,
  orgId: string,
  clientId: Id<"clients">,
  costUsd: number,
  createdAt: number = Date.now()
): Promise<Id<"deliverables">> {
  return await t.run(async (ctx) => {
    const year = new Date(createdAt).getUTCFullYear();
    const month = new Date(createdAt).getUTCMonth() + 1;
    const svc = await ctx.db.insert("services", {
      orgId: undefined,
      name: `S-${Math.random()}`,
      type: "base" as const,
      minPct: 0.01,
      maxPct: 0.03,
      defaultPct: 0.02,
      isDefault: true,
      sortOrder: 1,
    });
    const projId = await ctx.db.insert("projections", {
      orgId,
      clientId,
      year,
      annualSales: 1_000_000,
      totalBudget: 100_000,
      commissionRate: 0,
      seasonalityData: [],
      status: "active" as const,
      createdAt,
      updatedAt: createdAt,
    });
    const ps = await ctx.db.insert("projectionServices", {
      orgId,
      projectionId: projId,
      serviceId: svc,
      serviceName: "S",
      chosenPct: 0.02,
      isActive: true,
      annualAmount: 100,
      normalizedWeight: 0.5,
    });
    const ma = await ctx.db.insert("monthlyAssignments", {
      orgId,
      projServiceId: ps,
      projectionId: projId,
      clientId,
      serviceName: "S",
      month,
      year,
      amount: 100,
      feFactor: 1,
      status: "pending" as const,
      invoiceStatus: "not_invoiced" as const,
    });
    return await ctx.db.insert("deliverables", {
      orgId,
      assignmentId: ma,
      projServiceId: ps,
      clientId,
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
          inputTokens: 100,
          outputTokens: 100,
          costUsd,
          timestamp: createdAt,
        },
      ],
      createdAt,
    });
  });
}

describe("superAdmin.metrics.getOverviewAll", () => {
  it("agrega correctamente cross-org (totals + perOrg)", async () => {
    const t = setupTest();
    await seedOrg(t, ORG_A, "Acme");
    await seedOrg(t, ORG_B, "Beta");

    const cA = await seedClient(t, ORG_A, "Cliente A");
    const cB = await seedClient(t, ORG_B, "Cliente B");

    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      await seedDeliverable(t, ORG_A, cA, 0.5, now);
      await seedDeliverable(t, ORG_B, cB, 0.25, now);
    }

    const result = await t
      .withIdentity(SUPER_ADMIN)
      .query(api.functions.superAdmin.metrics.getOverviewAll, {});

    expect(result.totals.orgsActive).toBe(2);
    expect(result.totals.deliverablesMonth).toBe(6);
    // 3 * 0.5 + 3 * 0.25 = 2.25
    expect(result.totals.aiCostUsdMonth).toBeCloseTo(2.25, 5);
    expect(result.totals.clientsTotal).toBe(2);
    expect(result.perOrg.length).toBe(2);

    const acme = result.perOrg.find((o) => o.orgId === ORG_A)!;
    const beta = result.perOrg.find((o) => o.orgId === ORG_B)!;
    expect(acme.deliverablesMonth).toBe(3);
    expect(acme.aiCostUsdMonth).toBeCloseTo(1.5, 5);
    expect(beta.deliverablesMonth).toBe(3);
    expect(beta.aiCostUsdMonth).toBeCloseTo(0.75, 5);
  });

  it("requiere super-admin — org:admin recibe estructura vacía (NO throw)", async () => {
    const t = setupTest();
    await seedOrg(t, ORG_A, "Acme");
    const cA = await seedClient(t, ORG_A, "Cliente A");
    await seedDeliverable(t, ORG_A, cA, 0.5);

    const result = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.superAdmin.metrics.getOverviewAll, {});

    expect(result.totals.orgsActive).toBe(0);
    expect(result.totals.deliverablesMonth).toBe(0);
    expect(result.perOrg).toEqual([]);
    expect(result.last30Days).toEqual([]);
  });
});

describe("superAdmin.metrics.getOrgDetails", () => {
  it("retorna topClients ordenados desc por deliverablesMonth + multi-tenant guard", async () => {
    const t = setupTest();
    await seedOrg(t, ORG_A, "Acme");

    const c1 = await seedClient(t, ORG_A, "Cliente1");
    const c2 = await seedClient(t, ORG_A, "Cliente2");
    const c3 = await seedClient(t, ORG_A, "Cliente3");

    const now = Date.now();
    for (let i = 0; i < 5; i++) await seedDeliverable(t, ORG_A, c1, 0.1, now);
    for (let i = 0; i < 3; i++) await seedDeliverable(t, ORG_A, c2, 0.1, now);
    await seedDeliverable(t, ORG_A, c3, 0.1, now);

    const result = await t
      .withIdentity(SUPER_ADMIN)
      .query(api.functions.superAdmin.metrics.getOrgDetails, {
        orgId: ORG_A,
      });

    expect(result).not.toBeNull();
    expect(result!.monthTotals.deliverables).toBe(9);
    expect(result!.topClients.length).toBe(3);
    expect(result!.topClients[0].deliverablesMonth).toBe(5);
    expect(result!.topClients[1].deliverablesMonth).toBe(3);
    expect(result!.topClients[2].deliverablesMonth).toBe(1);

    // Multi-tenant guard: non-super-admin → null.
    const denied = await t
      .withIdentity(admin(ORG_B))
      .query(api.functions.superAdmin.metrics.getOrgDetails, {
        orgId: ORG_A,
      });
    expect(denied).toBeNull();
  });
});
