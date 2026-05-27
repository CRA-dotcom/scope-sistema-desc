import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import schema from "../../../schema";
import type { Id } from "../../../_generated/dataModel";

/**
 * Seed the minimal FK rows required to insert a projectionServices row.
 * Pattern mirrors cancelContract.test.ts — no `as any` for FK fields.
 */
async function seedFKs(
  t: ReturnType<typeof convexTest>,
  orgId: string
): Promise<{ projServiceId: Id<"projectionServices"> }> {
  return t.run(async (ctx) => {
    const now = Date.now();

    const serviceId = await ctx.db.insert("services", {
      orgId: undefined,
      name: "Consultoría",
      type: "base" as const,
      minPct: 0,
      maxPct: 100,
      defaultPct: 30,
      isDefault: true,
      sortOrder: 1,
    });

    const clientId = await ctx.db.insert("clients", {
      orgId,
      name: "Cliente Ventana",
      rfc: "CVX240101AAA",
      industry: "tecnologia",
      annualRevenue: 2_000_000,
      billingFrequency: "mensual" as const,
      isArchived: false,
      createdAt: now,
    });

    const projectionId = await ctx.db.insert("projections", {
      orgId,
      clientId,
      year: 2026,
      annualSales: 2_000_000,
      totalBudget: 200_000,
      commissionRate: 0,
      seasonalityData: [],
      status: "draft" as const,
      createdAt: now,
      updatedAt: now,
    });

    const projServiceId = await ctx.db.insert("projectionServices", {
      orgId,
      projectionId,
      serviceId,
      serviceName: "Consultoría",
      chosenPct: 100,
      isActive: true,
      annualAmount: 200_000,
      normalizedWeight: 1,
    });

    return { projServiceId };
  });
}

describe("projectionServices.updateContractualWindow", () => {
  it("sets both startMonth and endMonth on the row", async () => {
    const t = convexTest(schema);
    const orgId = "org_test";
    const asAdmin = t.withIdentity({ orgId, orgRole: "org:admin" });
    const { projServiceId } = await seedFKs(t, orgId);

    await asAdmin.mutation(
      api.functions.projectionServices.mutations.updateContractualWindow,
      { projServiceId, startMonth: 7, endMonth: 12 }
    );

    const ps = await t.run((ctx) => ctx.db.get(projServiceId));
    expect(ps?.startMonth).toBe(7);
    expect(ps?.endMonth).toBe(12);
  });

  it("clears both startMonth and endMonth when both are omitted (undefined)", async () => {
    const t = convexTest(schema);
    const orgId = "org_test";
    const asAdmin = t.withIdentity({ orgId, orgRole: "org:admin" });
    const { projServiceId } = await seedFKs(t, orgId);

    // first set them
    await asAdmin.mutation(
      api.functions.projectionServices.mutations.updateContractualWindow,
      { projServiceId, startMonth: 3, endMonth: 9 }
    );

    // then clear
    await asAdmin.mutation(
      api.functions.projectionServices.mutations.updateContractualWindow,
      { projServiceId }
    );

    const ps = await t.run((ctx) => ctx.db.get(projServiceId));
    expect(ps?.startMonth).toBeUndefined();
    expect(ps?.endMonth).toBeUndefined();
  });

  it("rejects startMonth=0 (below range)", async () => {
    const t = convexTest(schema);
    const orgId = "org_test";
    const asAdmin = t.withIdentity({ orgId, orgRole: "org:admin" });
    const { projServiceId } = await seedFKs(t, orgId);

    await expect(
      asAdmin.mutation(
        api.functions.projectionServices.mutations.updateContractualWindow,
        { projServiceId, startMonth: 0 }
      )
    ).rejects.toThrow(/startMonth/);
  });

  it("rejects startMonth=13 (above range)", async () => {
    const t = convexTest(schema);
    const orgId = "org_test";
    const asAdmin = t.withIdentity({ orgId, orgRole: "org:admin" });
    const { projServiceId } = await seedFKs(t, orgId);

    await expect(
      asAdmin.mutation(
        api.functions.projectionServices.mutations.updateContractualWindow,
        { projServiceId, startMonth: 13 }
      )
    ).rejects.toThrow(/startMonth/);
  });

  it("rejects endMonth=0 (below range)", async () => {
    const t = convexTest(schema);
    const orgId = "org_test";
    const asAdmin = t.withIdentity({ orgId, orgRole: "org:admin" });
    const { projServiceId } = await seedFKs(t, orgId);

    await expect(
      asAdmin.mutation(
        api.functions.projectionServices.mutations.updateContractualWindow,
        { projServiceId, endMonth: 0 }
      )
    ).rejects.toThrow(/endMonth/);
  });

  it("rejects endMonth=13 (above range)", async () => {
    const t = convexTest(schema);
    const orgId = "org_test";
    const asAdmin = t.withIdentity({ orgId, orgRole: "org:admin" });
    const { projServiceId } = await seedFKs(t, orgId);

    await expect(
      asAdmin.mutation(
        api.functions.projectionServices.mutations.updateContractualWindow,
        { projServiceId, endMonth: 13 }
      )
    ).rejects.toThrow(/endMonth/);
  });

  it("rejects inverted window where startMonth > endMonth", async () => {
    const t = convexTest(schema);
    const orgId = "org_test";
    const asAdmin = t.withIdentity({ orgId, orgRole: "org:admin" });
    const { projServiceId } = await seedFKs(t, orgId);

    await expect(
      asAdmin.mutation(
        api.functions.projectionServices.mutations.updateContractualWindow,
        { projServiceId, startMonth: 8, endMonth: 3 }
      )
    ).rejects.toThrow(/invertida|mayor/);
  });

  it("rejects cross-org access with 'no encontrado' error", async () => {
    const t = convexTest(schema);
    const { projServiceId } = await seedFKs(t, "org_owner");
    const asOtherAdmin = t.withIdentity({ orgId: "org_other", orgRole: "org:admin" });

    await expect(
      asOtherAdmin.mutation(
        api.functions.projectionServices.mutations.updateContractualWindow,
        { projServiceId, startMonth: 1, endMonth: 6 }
      )
    ).rejects.toThrow(/no encontrado/i);
  });
});
