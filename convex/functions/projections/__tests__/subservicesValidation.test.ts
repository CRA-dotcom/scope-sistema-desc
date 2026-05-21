import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import { setupTest, ORG_A } from "../../../../tests/harness";

/**
 * A1 Phase 2 review fix: server-side validation in projections.create.
 *
 * Mirrors the wizard UI contract — if the parent service has any active
 * subservices available (org-scoped or global), the caller MUST pass a
 * subserviceId for that serviceConfig.
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
      name: "ACME Test",
      rfc: "AAA010101AAA",
      industry: "Marketing",
      annualRevenue: 1_000_000,
      billingFrequency: "mensual" as const,
      isArchived: false,
      createdAt: Date.now(),
    });
  });
}

async function seedMarketingService(
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

async function seedGlobalSubservice(
  t: ReturnType<typeof setupTest>,
  parentId: Id<"services">,
  slug = "branding"
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
  monthlySales: 1_000_000 / 12,
  feFactor: 1,
}));

describe("projections.create — subservice validation (A1 Phase 2)", () => {
  it("rejects when parent service has active subservices and caller omits subserviceId", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const marketingId = await seedMarketingService(t);
    await seedGlobalSubservice(t, marketingId, "branding");

    await expect(
      t.withIdentity(admin(ORG_A)).mutation(
        api.functions.projections.mutations.create,
        {
          clientId,
          year: 2026,
          annualSales: 1_000_000,
          totalBudget: 100_000,
          commissionRate: 0,
          seasonalityData: evenSeasonality,
          serviceConfigs: [
            {
              serviceId: marketingId,
              chosenPct: 0.1,
              isActive: true,
              // subserviceId omitted intentionally
            },
          ],
        }
      )
    ).rejects.toThrow(
      /El servicio Marketing requiere subservicio\. Selecciónalo antes de crear la proyección\./
    );
  });

  it("accepts when subserviceId is provided", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const marketingId = await seedMarketingService(t);
    const subId = await seedGlobalSubservice(t, marketingId, "branding");

    const projectionId = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.projections.mutations.create, {
        clientId,
        year: 2026,
        annualSales: 1_000_000,
        totalBudget: 100_000,
        commissionRate: 0,
        seasonalityData: evenSeasonality,
        serviceConfigs: [
          {
            serviceId: marketingId,
            chosenPct: 0.1,
            isActive: true,
            subserviceId: subId,
          },
        ],
      });

    expect(projectionId).toBeDefined();
    const doc = await t.run((ctx) => ctx.db.get(projectionId));
    expect(doc?.orgId).toBe(ORG_A);
    expect(doc?.status).toBe("draft");
  });

  it("accepts when service has NO active subservices (legacy path stays open)", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const marketingId = await seedMarketingService(t);
    // Note: no subservices seeded → wizard would not show the dropdown either.

    const projectionId = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.projections.mutations.create, {
        clientId,
        year: 2026,
        annualSales: 1_000_000,
        totalBudget: 100_000,
        commissionRate: 0,
        seasonalityData: evenSeasonality,
        serviceConfigs: [
          {
            serviceId: marketingId,
            chosenPct: 0.1,
            isActive: true,
          },
        ],
      });

    expect(projectionId).toBeDefined();
  });

  it("ignores inactive serviceConfigs (no validation needed)", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const marketingId = await seedMarketingService(t);
    await seedGlobalSubservice(t, marketingId, "branding");

    // Service is inactive → no subservice required, projection should be
    // created successfully even though Marketing has globals.
    const projectionId = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.projections.mutations.create, {
        clientId,
        year: 2026,
        annualSales: 1_000_000,
        totalBudget: 100_000,
        commissionRate: 0,
        seasonalityData: evenSeasonality,
        serviceConfigs: [
          {
            serviceId: marketingId,
            chosenPct: 0.1,
            isActive: false,
          },
        ],
      });

    expect(projectionId).toBeDefined();
  });
});
