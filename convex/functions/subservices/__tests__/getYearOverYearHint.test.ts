import { describe, it, expect } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

async function seed(t: ReturnType<typeof setupTest>) {
  return await t.run(async (ctx) => {
    const orgId = "org_1";
    const parentServiceId = await ctx.db.insert("services", {
      name: "S",
      type: "base" as const,
      minPct: 0.01, maxPct: 0.03, defaultPct: 0.02,
      isDefault: true, isCommission: false, sortOrder: 1,
    });
    const subserviceId = await ctx.db.insert("subservices", {
      orgId, parentServiceId, name: "Sub", slug: "sub",
      defaultFrequency: "mensual" as const, isDefault: false, sortOrder: 0,
      isActive: true, yearOverYearDiscount: 30,
      createdAt: 0, updatedAt: 0,
    });
    const clientId = await ctx.db.insert("clients", {
      orgId, name: "C",
      rfc: "XXX900101AAA", industry: "Otros", annualRevenue: 0,
      billingFrequency: "mensual" as const, isArchived: false,
      createdAt: 0,
    });
    return { orgId, parentServiceId, subserviceId, clientId };
  });
}

describe("getYearOverYearHint", () => {
  it("returns available=true when client has prior projection with subservicio", async () => {
    const t = setupTest();
    const { orgId, parentServiceId, subserviceId, clientId } = await seed(t);

    await t.run(async (ctx) => {
      const projectionId = await ctx.db.insert("projections", {
        orgId, clientId, year: 2026, startMonth: 1,
        status: "active" as const,
        annualSales: 0, totalBudget: 0, commissionRate: 0,
        seasonalityData: [],
        createdAt: 0, updatedAt: 0,
      });
      await ctx.db.insert("projectionServices", {
        orgId, projectionId, serviceId: parentServiceId, subserviceIds: [subserviceId],
        serviceName: "S",
        annualAmount: 30000, chosenPct: 0.02, normalizedWeight: 1, isActive: true,
      });
    });

    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });
    const r = await auth.query(api.functions.subservices.queries.getYearOverYearHint, {
      clientId, subserviceId,
    });
    expect(r.available).toBe(true);
    expect(r.priorProjectionYear).toBe(2026);
    expect(r.discount).toBe(30);
  });

  it("returns available=false when no prior projection", async () => {
    const t = setupTest();
    const { orgId, subserviceId, clientId } = await seed(t);
    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });
    const r = await auth.query(api.functions.subservices.queries.getYearOverYearHint, {
      clientId, subserviceId,
    });
    expect(r.available).toBe(false);
  });

  it("returns available=false when subservice has no discount configured", async () => {
    const t = setupTest();
    const { orgId, parentServiceId, clientId } = await seed(t);

    // Create another subservice WITHOUT a discount
    const noDiscountSub = await t.run(async (ctx) =>
      ctx.db.insert("subservices", {
        orgId, parentServiceId, name: "NoDisc", slug: "nodisc",
        defaultFrequency: "mensual" as const, isDefault: false, sortOrder: 1,
        isActive: true,
        createdAt: 0, updatedAt: 0,
      })
    );

    await t.run(async (ctx) => {
      const projectionId = await ctx.db.insert("projections", {
        orgId, clientId, year: 2026, startMonth: 1,
        status: "active" as const,
        annualSales: 0, totalBudget: 0, commissionRate: 0,
        seasonalityData: [],
        createdAt: 0, updatedAt: 0,
      });
      await ctx.db.insert("projectionServices", {
        orgId, projectionId, serviceId: parentServiceId, subserviceIds: [noDiscountSub],
        serviceName: "S",
        annualAmount: 10000, chosenPct: 0.02, normalizedWeight: 1, isActive: true,
      });
    });

    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });
    const r = await auth.query(api.functions.subservices.queries.getYearOverYearHint, {
      clientId, subserviceId: noDiscountSub,
    });
    expect(r.available).toBe(false);
  });

  it("ignores draft projections", async () => {
    const t = setupTest();
    const { orgId, parentServiceId, subserviceId, clientId } = await seed(t);

    await t.run(async (ctx) => {
      const projectionId = await ctx.db.insert("projections", {
        orgId, clientId, year: 2026, startMonth: 1,
        status: "draft" as const,
        annualSales: 0, totalBudget: 0, commissionRate: 0,
        seasonalityData: [],
        createdAt: 0, updatedAt: 0,
      });
      await ctx.db.insert("projectionServices", {
        orgId, projectionId, serviceId: parentServiceId, subserviceIds: [subserviceId],
        serviceName: "S",
        annualAmount: 30000, chosenPct: 0.02, normalizedWeight: 1, isActive: true,
      });
    });

    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });
    const r = await auth.query(api.functions.subservices.queries.getYearOverYearHint, {
      clientId, subserviceId,
    });
    expect(r.available).toBe(false);
  });
});
