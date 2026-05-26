import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import schema from "../../../schema";

const PLACEHOLDER_HTML = `<div class="placeholder">x</div>`;
const REAL_HTML = `<h1>Real</h1>`;

describe("projections.subservicesMissingContent", () => {
  async function setup(t: ReturnType<typeof convexTest>) {
    return await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: "org_test",
        name: "Test",
        rfc: "XAXX010101000",
        industry: "TI",
        annualRevenue: 1_200_000,
        billingFrequency: "mensual",
        isArchived: false,
        createdAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: "org_test",
        clientId,
        year: 2026,
        annualSales: 1_200_000,
        totalBudget: 120_000,
        commissionRate: 0,
        seasonalityData: [],
        status: "draft",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const serviceId = await ctx.db.insert("services", {
        orgId: undefined,
        name: "TI",
        type: "base",
        minPct: 0,
        maxPct: 100,
        defaultPct: 30,
        isDefault: true,
        sortOrder: 1,
      });

      const subA = await ctx.db.insert("subservices", {
        orgId: undefined,
        parentServiceId: serviceId,
        name: "Sub A (ready)",
        slug: "sub-a",
        defaultFrequency: "mensual",
        isActive: true,
        isDefault: false,
        sortOrder: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("deliverableTemplates", {
        orgId: undefined,
        serviceId,
        serviceName: "TI",
        subserviceId: subA,
        type: "deliverable_long",
        name: "A tpl",
        htmlTemplate: REAL_HTML,
        variables: [],
        version: 1,
        isActive: true,
        contentStatus: "ready",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const subB = await ctx.db.insert("subservices", {
        orgId: undefined,
        parentServiceId: serviceId,
        name: "Sub B (placeholder)",
        slug: "sub-b",
        defaultFrequency: "mensual",
        isActive: true,
        isDefault: false,
        sortOrder: 2,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("deliverableTemplates", {
        orgId: undefined,
        serviceId,
        serviceName: "TI",
        subserviceId: subB,
        type: "deliverable_long",
        name: "B tpl",
        htmlTemplate: PLACEHOLDER_HTML,
        variables: [],
        version: 1,
        isActive: true,
        contentStatus: "placeholder",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await ctx.db.insert("projectionServices", {
        orgId: "org_test",
        projectionId,
        serviceId,
        serviceName: "TI",
        subserviceId: subA,
        chosenPct: 30,
        isActive: true,
        annualAmount: 36000,
        normalizedWeight: 0.5,
      });
      await ctx.db.insert("projectionServices", {
        orgId: "org_test",
        projectionId,
        serviceId,
        serviceName: "TI",
        subserviceId: subB,
        chosenPct: 30,
        isActive: true,
        annualAmount: 36000,
        normalizedWeight: 0.5,
      });
      await ctx.db.insert("projectionServices", {
        orgId: "org_test",
        projectionId,
        serviceId,
        serviceName: "TI (no sub)",
        chosenPct: 0,
        isActive: true,
        annualAmount: 0,
        normalizedWeight: 0,
      });

      return { projectionId, subA, subB };
    });
  }

  it("returns only subservices without any ready template", async () => {
    const t = convexTest(schema);
    const asUser = t.withIdentity({
      subject: "u",
      tokenIdentifier: "t|u",
      org_id: "org_test",
      org_role: "org:member",
    });
    const { projectionId, subB } = await setup(t);

    const missing = await asUser.query(
      api.functions.projections.queries.subservicesMissingContent,
      { projectionId }
    );

    expect(missing).toHaveLength(1);
    expect(missing[0].subserviceId).toBe(subB);
    expect(missing[0].subserviceName).toBe("Sub B (placeholder)");
  });

  it("returns empty array for non-existent projection", async () => {
    const t = convexTest(schema);
    const asUser = t.withIdentity({
      subject: "u",
      tokenIdentifier: "t|u",
      org_id: "org_test",
      org_role: "org:member",
    });
    const fakeId = await t.run(async (ctx) => {
      const cId = await ctx.db.insert("clients", {
        orgId: "org_test",
        name: "x",
        rfc: "XAXX010101000",
        industry: "TI",
        annualRevenue: 0,
        billingFrequency: "mensual",
        isArchived: false,
        createdAt: Date.now(),
      });
      const pId = await ctx.db.insert("projections", {
        orgId: "org_test",
        clientId: cId,
        year: 2026,
        annualSales: 0,
        totalBudget: 0,
        commissionRate: 0,
        seasonalityData: [],
        status: "draft",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.delete(pId);
      return pId;
    });

    const missing = await asUser.query(
      api.functions.projections.queries.subservicesMissingContent,
      { projectionId: fakeId }
    );
    expect(missing).toEqual([]);
  });

  it("does not leak cross-org", async () => {
    const t = convexTest(schema);
    const { projectionId } = await setup(t);

    const asOther = t.withIdentity({
      subject: "u2",
      tokenIdentifier: "t|u2",
      org_id: "org_OTHER",
      org_role: "org:member",
    });
    const missing = await asOther.query(
      api.functions.projections.queries.subservicesMissingContent,
      { projectionId }
    );
    expect(missing).toEqual([]);
  });
});
