import { describe, it, expect } from "vitest";
import { setupTest, ORG_A } from "../../../../tests/harness";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

function admin(orgId: string) {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `user_admin_${orgId}`,
    orgId,
    orgRole: "org:admin",
  };
}

function member(orgId: string) {
  return {
    tokenIdentifier: `test|member_${orgId}`,
    subject: `user_member_${orgId}`,
    orgId,
    orgRole: "org:member",
  };
}

type Seeded = {
  clientId: Id<"clients">;
  projServiceId: Id<"projectionServices">;
  quotationId: Id<"quotations">;
};

async function seedDeps(
  t: ReturnType<typeof setupTest>,
  orgId: string
): Promise<Seeded> {
  return await t.run(async (ctx) => {
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
      name: "Acme SA",
      rfc: "ACM240115ABC",
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

describe("getContractsForPipeline", () => {
  it("filters by status=sent and sorts by days unsigned desc (oldest sentAt first)", async () => {
    const t = setupTest();
    const now = Date.now();
    const { clientId, projServiceId, quotationId } = await seedDeps(t, ORG_A);

    await t.run(async (ctx) => {
      await ctx.db.insert("contracts", {
        orgId: ORG_A,
        quotationId,
        projServiceId,
        clientId,
        serviceName: "Legal",
        content: "x",
        status: "sent" as const,
        sentAt: now - 10 * 24 * 3600 * 1000, // 10 days ago
        createdAt: now,
      });
      await ctx.db.insert("contracts", {
        orgId: ORG_A,
        quotationId,
        projServiceId,
        clientId,
        serviceName: "Contable",
        content: "x",
        status: "sent" as const,
        sentAt: now - 5 * 24 * 3600 * 1000, // 5 days ago
        createdAt: now,
      });
      await ctx.db.insert("contracts", {
        orgId: ORG_A,
        quotationId,
        projServiceId,
        clientId,
        serviceName: "Marketing",
        content: "x",
        status: "signed" as const,
        sentAt: now - 30 * 24 * 3600 * 1000,
        signedAt: now - 25 * 24 * 3600 * 1000,
        createdAt: now,
      });
    });

    const result = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.contracts.queries.getContractsForPipeline, {
        statusFilter: "sent",
      });

    expect(result.length).toBe(2);
    expect(result[0].serviceName).toBe("Legal"); // 10d oldest (unsigned longest)
    expect(result[1].serviceName).toBe("Contable"); // 5d
  });

  it("filters by minDaysWithoutSigning — only sent contracts older than threshold", async () => {
    const t = setupTest();
    const now = Date.now();
    const { clientId, projServiceId, quotationId } = await seedDeps(t, ORG_A);

    await t.run(async (ctx) => {
      await ctx.db.insert("contracts", {
        orgId: ORG_A,
        quotationId,
        projServiceId,
        clientId,
        serviceName: "A",
        content: "x",
        status: "sent" as const,
        sentAt: now - 8 * 24 * 3600 * 1000, // 8 days → above threshold
        createdAt: now,
      });
      await ctx.db.insert("contracts", {
        orgId: ORG_A,
        quotationId,
        projServiceId,
        clientId,
        serviceName: "B",
        content: "x",
        status: "sent" as const,
        sentAt: now - 2 * 24 * 3600 * 1000, // 2 days → below threshold
        createdAt: now,
      });
    });

    const result = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.contracts.queries.getContractsForPipeline, {
        statusFilter: "sent",
        minDaysWithoutSigning: 7,
      });

    expect(result.length).toBe(1);
    expect(result[0].serviceName).toBe("A");
  });

  it("allows non-admin role (org:member) — pipeline es vista de trabajo del operador", async () => {
    const t = setupTest();
    const result = await t
      .withIdentity(member(ORG_A))
      .query(api.functions.contracts.queries.getContractsForPipeline, {
        statusFilter: "all",
      });
    // Member sees pipeline; org isolation still enforced via orgId filter
    expect(Array.isArray(result)).toBe(true);
  });
});
