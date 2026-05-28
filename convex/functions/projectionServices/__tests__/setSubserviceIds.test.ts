import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import schema from "../../../schema";

/**
 * #1 — Post-creation subservices picker.
 *
 * setSubserviceIds patches both subserviceIds (array) and the legacy
 * subserviceId scalar on a projectionServices row. Cross-org access throws.
 */

async function setupFixture(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId: "org_test",
      name: "Test Client",
      rfc: "XAXX010101000",
      industry: "marketing",
      annualRevenue: 2_000_000,
      billingFrequency: "mensual",
      isArchived: false,
      createdAt: Date.now(),
    });
    const serviceId = await ctx.db.insert("services", {
      orgId: undefined,
      name: "Marketing",
      type: "base",
      minPct: 0,
      maxPct: 100,
      defaultPct: 10,
      isDefault: true,
      sortOrder: 1,
    });
    const projectionId = await ctx.db.insert("projections", {
      orgId: "org_test",
      clientId,
      year: 2026,
      annualSales: 2_000_000,
      totalBudget: 200_000,
      commissionRate: 0,
      seasonalityData: [],
      status: "draft",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const projServiceId = await ctx.db.insert("projectionServices", {
      orgId: "org_test",
      projectionId,
      serviceId,
      serviceName: "Marketing",
      chosenPct: 0.1,
      isActive: true,
      annualAmount: 20_000,
      normalizedWeight: 1,
    });
    const sub1 = await ctx.db.insert("subservices", {
      orgId: undefined,
      parentServiceId: serviceId,
      name: "Branding",
      slug: "branding",
      defaultFrequency: "mensual",
      isActive: true,
      isDefault: true,
      sortOrder: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const sub2 = await ctx.db.insert("subservices", {
      orgId: undefined,
      parentServiceId: serviceId,
      name: "Social Media",
      slug: "social-media",
      defaultFrequency: "mensual",
      isActive: true,
      isDefault: false,
      sortOrder: 2,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { projServiceId, sub1, sub2 };
  });
}

const asAdmin = {
  subject: "u",
  tokenIdentifier: "t|u",
  org_id: "org_test",
  org_role: "org:admin",
};

const asOtherOrg = {
  subject: "u2",
  tokenIdentifier: "t|u2",
  org_id: "org_other",
  org_role: "org:admin",
};

describe("projectionServices.setSubserviceIds (#1)", () => {
  it("patches subserviceIds and backcompat subserviceId (first element)", async () => {
    const t = convexTest(schema);
    const { projServiceId, sub1, sub2 } = await setupFixture(t);

    await t.withIdentity(asAdmin).mutation(
      api.functions.projectionServices.mutations.setSubserviceIds,
      {
        projServiceId,
        subserviceIds: [sub1, sub2],
      }
    );

    const ps = await t.run((ctx) => ctx.db.get(projServiceId));
    expect(ps!.subserviceIds).toEqual([sub1, sub2]);
    // Legacy backcompat: first element
    expect(ps!.subserviceId).toBe(sub1);
  });

  it("cross-org access throws", async () => {
    const t = convexTest(schema);
    const { projServiceId, sub1 } = await setupFixture(t);

    await expect(
      t.withIdentity(asOtherOrg).mutation(
        api.functions.projectionServices.mutations.setSubserviceIds,
        {
          projServiceId,
          subserviceIds: [sub1],
        }
      )
    ).rejects.toThrow(/Servicio no encontrado/);
  });
});
