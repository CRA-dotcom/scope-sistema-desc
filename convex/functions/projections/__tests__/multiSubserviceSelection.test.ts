import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import { setupTest, ORG_A } from "../../../../tests/harness";

/**
 * #9 — Multi-subservice selection per service.
 *
 * projectionServices.subserviceIds (array field) is written when the
 * caller passes serviceConfigs[].subserviceIds. The legacy scalar
 * subserviceId has been dropped from projectionServices schema.
 */

function admin(orgId: string) {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `user_admin_${orgId}`,
    orgId,
    orgRole: "org:admin",
  };
}

async function seedClient(
  t: ReturnType<typeof setupTest>,
  orgId: string
): Promise<Id<"clients">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("clients", {
      orgId,
      name: "Multi-Sub Client",
      rfc: "AAA010101AAA",
      industry: "Marketing",
      annualRevenue: 2_000_000,
      billingFrequency: "mensual" as const,
      isArchived: false,
      createdAt: Date.now(),
    });
  });
}

async function seedService(
  t: ReturnType<typeof setupTest>
): Promise<Id<"services">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("services", {
      orgId: undefined,
      name: "Marketing",
      type: "base" as const,
      minPct: 0.05,
      maxPct: 0.15,
      defaultPct: 0.1,
      isDefault: true,
      isCommission: false,
      isCustom: false,
      sortOrder: 10,
    });
  });
}

async function seedSubservice(
  t: ReturnType<typeof setupTest>,
  parentId: Id<"services">,
  slug: string
): Promise<Id<"subservices">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("subservices", {
      orgId: undefined,
      parentServiceId: parentId,
      name: slug,
      slug,
      defaultFrequency: "mensual" as const,
      isActive: true,
      isDefault: true,
      sortOrder: 10,
      createdAt: now,
      updatedAt: now,
    });
  });
}

const evenSeasonality = Array.from({ length: 12 }, (_, i) => ({
  month: i + 1,
  monthlySales: 2_000_000 / 12,
  feFactor: 1,
}));

describe("projections.create — multi-subservice (#9)", () => {
  it("writes subserviceIds array when caller passes subserviceIds: [id1, id2]", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const serviceId = await seedService(t);
    const sub1 = await seedSubservice(t, serviceId, "branding");
    const sub2 = await seedSubservice(t, serviceId, "social-media");

    const projectionId = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.projections.mutations.create, {
        clientId,
        year: 2026,
        annualSales: 2_000_000,
        totalBudget: 200_000,
        commissionRate: 0,
        seasonalityData: evenSeasonality,
        serviceConfigs: [
          {
            serviceId,
            chosenPct: 0.1,
            isActive: true,
            subserviceIds: [sub1, sub2],
          },
        ],
      });

    expect(projectionId).toBeDefined();

    // Verify the projectionServices row has subserviceIds set correctly.
    const ps = await t.run(async (ctx) => {
      return await ctx.db
        .query("projectionServices")
        .withIndex("by_projectionId", (q) => q.eq("projectionId", projectionId))
        .first();
    });

    expect(ps).not.toBeNull();
    expect(ps!.subserviceIds).toEqual([sub1, sub2]);
  });

  it("single subservice: subserviceIds: [sub1] writes correctly", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const serviceId = await seedService(t);
    const sub1 = await seedSubservice(t, serviceId, "branding");

    const projectionId = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.projections.mutations.create, {
        clientId,
        year: 2026,
        annualSales: 2_000_000,
        totalBudget: 200_000,
        commissionRate: 0,
        seasonalityData: evenSeasonality,
        serviceConfigs: [
          {
            serviceId,
            chosenPct: 0.1,
            isActive: true,
            subserviceIds: [sub1],
          },
        ],
      });

    expect(projectionId).toBeDefined();

    const ps = await t.run(async (ctx) => {
      return await ctx.db
        .query("projectionServices")
        .withIndex("by_projectionId", (q) => q.eq("projectionId", projectionId))
        .first();
    });

    expect(ps).not.toBeNull();
    expect(ps!.subserviceIds).toEqual([sub1]);
  });

  it("validation: missing subserviceIds throws when subservices exist", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const serviceId = await seedService(t);
    await seedSubservice(t, serviceId, "branding");

    await expect(
      t.withIdentity(admin(ORG_A)).mutation(
        api.functions.projections.mutations.create,
        {
          clientId,
          year: 2026,
          annualSales: 2_000_000,
          totalBudget: 200_000,
          commissionRate: 0,
          seasonalityData: evenSeasonality,
          serviceConfigs: [
            {
              serviceId,
              chosenPct: 0.1,
              isActive: true,
              // both omitted intentionally
            },
          ],
        }
      )
    ).rejects.toThrow(/requiere subservicio/);
  });
});
