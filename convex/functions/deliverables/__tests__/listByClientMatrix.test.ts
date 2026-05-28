import { describe, it, expect } from "vitest";
import { setupTest, ORG_A } from "../../../../tests/harness";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

async function seedDeliverable(
  t: ReturnType<typeof setupTest>,
  opts: {
    orgId: string;
    clientId: Id<"clients">;
    projServiceId: Id<"projectionServices">;
    serviceName: string;
    month: number;
    year: number;
  }
): Promise<Id<"deliverables">> {
  return await t.run(async (ctx) => {
    const projectionId = await ctx.db.insert("projections", {
      orgId: opts.orgId,
      clientId: opts.clientId,
      year: opts.year,
      annualSales: 0,
      totalBudget: 0,
      commissionRate: 0,
      seasonalityData: [],
      status: "active" as const,
      createdAt: 0,
      updatedAt: 0,
    });
    const assignmentId = await ctx.db.insert("monthlyAssignments", {
      orgId: opts.orgId,
      projServiceId: opts.projServiceId,
      projectionId,
      clientId: opts.clientId,
      serviceName: opts.serviceName,
      month: opts.month,
      year: opts.year,
      amount: 1000,
      feFactor: 1,
      status: "pending" as const,
      invoiceStatus: "not_invoiced" as const,
    });
    return await ctx.db.insert("deliverables", {
      orgId: opts.orgId,
      assignmentId,
      projServiceId: opts.projServiceId,
      clientId: opts.clientId,
      serviceName: opts.serviceName,
      month: opts.month,
      year: opts.year,
      shortContent: "",
      longContent: "",
      auditStatus: "pending" as const,
      retryCount: 0,
      createdAt: Date.now(),
    });
  });
}

describe("listByClientMatrix", () => {
  it("returns empty for client with no deliverables", async () => {
    const t = setupTest();
    const orgId = ORG_A;
    const clientId = await t.run(async (ctx) =>
      ctx.db.insert("clients", {
        orgId,
        name: "Test",
        rfc: "TEST010101AAA",
        industry: "Servicios",
        annualRevenue: 0,
        billingFrequency: "mensual" as const,
        isArchived: false,
        createdAt: 0,
      })
    );

    const auth = t.withIdentity({ orgId, orgRole: "org:member" });
    const result = await auth.query(
      api.functions.deliverables.queries.listByClientMatrix,
      { clientId }
    );
    expect(result.services).toEqual([]);
    expect(result.months).toEqual([]);
  });

  it("groups deliverables by projServiceId and collects months", async () => {
    const t = setupTest();
    const orgId = ORG_A;

    const clientId = await t.run(async (ctx) =>
      ctx.db.insert("clients", {
        orgId,
        name: "Acme",
        rfc: "ACM010101AAA",
        industry: "Servicios",
        annualRevenue: 0,
        billingFrequency: "mensual" as const,
        isArchived: false,
        createdAt: 0,
      })
    );
    const serviceId = await t.run(async (ctx) =>
      ctx.db.insert("services", {
        name: "Contabilidad",
        type: "base" as const,
        minPct: 0,
        maxPct: 1,
        defaultPct: 0.1,
        isDefault: true,
        sortOrder: 1,
      })
    );
    const projServiceId = await t.run(async (ctx) => {
      const projectionId = await ctx.db.insert("projections", {
        orgId,
        clientId,
        year: 2026,
        annualSales: 0,
        totalBudget: 0,
        commissionRate: 0,
        seasonalityData: [],
        status: "active" as const,
        createdAt: 0,
        updatedAt: 0,
      });
      return ctx.db.insert("projectionServices", {
        orgId,
        projectionId,
        serviceId,
        serviceName: "Contabilidad",
        chosenPct: 0.1,
        isActive: true,
        annualAmount: 120000,
        normalizedWeight: 0.1,
      });
    });

    await seedDeliverable(t, {
      orgId,
      clientId,
      projServiceId,
      serviceName: "Contabilidad",
      month: 1,
      year: 2026,
    });
    await seedDeliverable(t, {
      orgId,
      clientId,
      projServiceId,
      serviceName: "Contabilidad",
      month: 3,
      year: 2026,
    });

    const auth = t.withIdentity({ orgId, orgRole: "org:member" });
    const result = await auth.query(
      api.functions.deliverables.queries.listByClientMatrix,
      { clientId }
    );

    expect(result.services).toHaveLength(1);
    expect(result.services[0].projServiceId).toBe(projServiceId);
    expect(result.services[0].serviceName).toBe("Contabilidad");
    expect(result.services[0].deliverables).toHaveLength(2);
    expect(result.months).toEqual([1, 3]);
  });

  it("excludes deliverables from other orgs", async () => {
    const t = setupTest();
    const orgId = ORG_A;
    const otherOrg = "org_other";

    const clientId = await t.run(async (ctx) =>
      ctx.db.insert("clients", {
        orgId,
        name: "Mine",
        rfc: "MNE010101AAA",
        industry: "Servicios",
        annualRevenue: 0,
        billingFrequency: "mensual" as const,
        isArchived: false,
        createdAt: 0,
      })
    );

    const serviceId = await t.run(async (ctx) =>
      ctx.db.insert("services", {
        name: "S",
        type: "base" as const,
        minPct: 0,
        maxPct: 1,
        defaultPct: 0.1,
        isDefault: true,
        sortOrder: 1,
      })
    );
    const projServiceId = await t.run(async (ctx) => {
      const projectionId = await ctx.db.insert("projections", {
        orgId,
        clientId,
        year: 2026,
        annualSales: 0,
        totalBudget: 0,
        commissionRate: 0,
        seasonalityData: [],
        status: "active" as const,
        createdAt: 0,
        updatedAt: 0,
      });
      return ctx.db.insert("projectionServices", {
        orgId,
        projectionId,
        serviceId,
        serviceName: "S",
        chosenPct: 0.1,
        isActive: true,
        annualAmount: 0,
        normalizedWeight: 0.1,
      });
    });

    // Seed one for this org, one for a different org (same clientId structure)
    await seedDeliverable(t, {
      orgId,
      clientId,
      projServiceId,
      serviceName: "S",
      month: 2,
      year: 2026,
    });

    // Insert a "cross-org" deliverable directly
    await t.run(async (ctx) => {
      const otherProjectionId = await ctx.db.insert("projections", {
        orgId: otherOrg,
        clientId,
        year: 2026,
        annualSales: 0,
        totalBudget: 0,
        commissionRate: 0,
        seasonalityData: [],
        status: "active" as const,
        createdAt: 0,
        updatedAt: 0,
      });
      const assignmentId = await ctx.db.insert("monthlyAssignments", {
        orgId: otherOrg,
        projServiceId,
        projectionId: otherProjectionId,
        clientId,
        serviceName: "S",
        month: 5,
        year: 2026,
        amount: 0,
        feFactor: 1,
        status: "pending" as const,
        invoiceStatus: "not_invoiced" as const,
      });
      await ctx.db.insert("deliverables", {
        orgId: otherOrg,
        assignmentId,
        projServiceId,
        clientId,
        serviceName: "S",
        month: 5,
        year: 2026,
        shortContent: "",
        longContent: "",
        auditStatus: "pending" as const,
        retryCount: 0,
        createdAt: Date.now(),
      });
    });

    const auth = t.withIdentity({ orgId, orgRole: "org:member" });
    const result = await auth.query(
      api.functions.deliverables.queries.listByClientMatrix,
      { clientId }
    );

    // Only month 2 from orgId is visible
    expect(result.months).toEqual([2]);
    expect(result.services[0].deliverables).toHaveLength(1);
  });
});
