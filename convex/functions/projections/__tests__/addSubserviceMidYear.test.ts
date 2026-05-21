import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import { setupTest, ORG_A, ORG_B } from "../../../../tests/harness";

/**
 * B1 — projections.addSubserviceMidYear
 *
 * Per docs/superpowers/specs/2026-05-26-client-services-overview-design.md §5
 */

function admin(orgId: string) {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `user_admin_${orgId}`,
    orgId,
    orgRole: "org:admin",
  };
}

async function seedBase(
  t: ReturnType<typeof setupTest>,
  orgId: string,
  opts: { subserviceOrgId?: string | undefined } = {}
): Promise<{
  clientId: Id<"clients">;
  projectionId: Id<"projections">;
  marketingId: Id<"services">;
  subserviceId: Id<"subservices">;
}> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const clientId = await ctx.db.insert("clients", {
      orgId,
      name: "ACME",
      rfc: "AAA010101AAA",
      industry: "Marketing",
      annualRevenue: 1_000_000,
      billingFrequency: "mensual" as const,
      isArchived: false,
      createdAt: now,
    });
    const marketingId = await ctx.db.insert("services", {
      orgId: undefined,
      name: "Marketing",
      type: "base" as const,
      minPct: 0.05,
      maxPct: 0.15,
      defaultPct: 0.1,
      isDefault: true,
      sortOrder: 10,
    });
    const subserviceOrgId =
      opts.subserviceOrgId === undefined ? undefined : opts.subserviceOrgId;
    const subserviceId = await ctx.db.insert("subservices", {
      orgId: subserviceOrgId,
      parentServiceId: marketingId,
      name: "Redes Sociales",
      slug: "redes-sociales",
      defaultFrequency: "mensual" as const,
      isActive: true,
      isDefault: true,
      sortOrder: 10,
      createdAt: now,
      updatedAt: now,
    });
    // Use NEXT year so retroactive guard never blocks the happy path.
    const futureYear = new Date().getUTCFullYear() + 1;
    const evenSeasonality = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      monthlySales: 1_000_000 / 12,
      feFactor: 1,
    }));
    const projectionId = await ctx.db.insert("projections", {
      orgId,
      clientId,
      year: futureYear,
      annualSales: 1_000_000,
      totalBudget: 120_000,
      commissionRate: 0,
      seasonalityData: evenSeasonality,
      status: "active" as const,
      createdAt: now,
      updatedAt: now,
    });
    return { clientId, projectionId, marketingId, subserviceId };
  });
}

describe("projections.addSubserviceMidYear", () => {
  it("happy path: creates projectionServices + monthlyAssignments + supplementary quotation", async () => {
    const t = setupTest();
    const { projectionId, subserviceId } = await seedBase(t, ORG_A);

    const result = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.projections.mutations.addSubserviceMidYear, {
        projectionId,
        subserviceId,
        startMonth: 7,
        endMonth: 12,
        monthlyAmount: 4_500,
      });

    expect(result.alreadyExisted).toBe(false);
    expect(result.projectionServiceId).toBeDefined();
    expect(result.quotationId).toBeDefined();

    await t.run(async (ctx) => {
      const ps = await ctx.db.get(result.projectionServiceId);
      expect(ps).not.toBeNull();
      expect(ps!.startMonth).toBe(7);
      expect(ps!.endMonth).toBe(12);
      expect(ps!.annualAmount).toBe(27_000);
      expect(ps!.chosenPct).toBe(0);
      expect(ps!.normalizedWeight).toBe(0);
      expect(ps!.supplementaryQuotationId).toBe(result.quotationId);

      const mas = await ctx.db
        .query("monthlyAssignments")
        .withIndex("by_projServiceId", (q) =>
          q.eq("projServiceId", result.projectionServiceId)
        )
        .collect();
      expect(mas).toHaveLength(6);
      const months = mas.map((m) => m.month).sort((a, b) => a - b);
      expect(months).toEqual([7, 8, 9, 10, 11, 12]);

      const quotation = await ctx.db.get(result.quotationId);
      expect(quotation).not.toBeNull();
      expect(quotation!.isSupplementary).toBe(true);
      expect(quotation!.totalAmount).toBe(27_000);
      expect(quotation!.lineItems).toHaveLength(6);
      // No parent approved quotation existed → undefined.
      expect(quotation!.parentQuotationId).toBeUndefined();
    });
  });

  it("idempotent: double call returns alreadyExisted=true with same ids and no duplicate rows", async () => {
    const t = setupTest();
    const { projectionId, subserviceId } = await seedBase(t, ORG_A);

    const first = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.projections.mutations.addSubserviceMidYear, {
        projectionId,
        subserviceId,
        startMonth: 7,
        endMonth: 12,
        monthlyAmount: 4_500,
      });

    const second = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.projections.mutations.addSubserviceMidYear, {
        projectionId,
        subserviceId,
        startMonth: 7,
        endMonth: 12,
        monthlyAmount: 4_500,
      });

    expect(second.alreadyExisted).toBe(true);
    expect(second.projectionServiceId).toBe(first.projectionServiceId);
    expect(second.quotationId).toBe(first.quotationId);

    await t.run(async (ctx) => {
      const psRows = await ctx.db
        .query("projectionServices")
        .withIndex("by_projectionId", (q) =>
          q.eq("projectionId", projectionId)
        )
        .collect();
      expect(psRows).toHaveLength(1);

      const quotations = await ctx.db
        .query("quotations")
        .withIndex("by_projServiceId", (q) =>
          q.eq("projServiceId", first.projectionServiceId)
        )
        .collect();
      expect(quotations).toHaveLength(1);
    });
  });

  it("rejects retroactive startMonth in current year", async () => {
    const t = setupTest();
    const currentYear = new Date().getUTCFullYear();
    const currentMonth = new Date().getUTCMonth() + 1;
    if (currentMonth === 1) {
      // Edge case: nothing past January in current year; skip elegantly.
      return;
    }

    // Manually seed with year = currentYear so retroactive gate fires.
    const seed = await t.run(async (ctx) => {
      const now = Date.now();
      const clientId = await ctx.db.insert("clients", {
        orgId: ORG_A,
        name: "ACME",
        rfc: "AAA010101AAA",
        industry: "Marketing",
        annualRevenue: 1,
        billingFrequency: "mensual" as const,
        isArchived: false,
        createdAt: now,
      });
      const marketingId = await ctx.db.insert("services", {
        orgId: undefined,
        name: "Marketing",
        type: "base" as const,
        minPct: 0,
        maxPct: 1,
        defaultPct: 0.1,
        isDefault: true,
        sortOrder: 1,
      });
      const subserviceId = await ctx.db.insert("subservices", {
        orgId: undefined,
        parentServiceId: marketingId,
        name: "X",
        slug: "x",
        defaultFrequency: "mensual" as const,
        isActive: true,
        isDefault: true,
        sortOrder: 1,
        createdAt: now,
        updatedAt: now,
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: ORG_A,
        clientId,
        year: currentYear,
        annualSales: 1,
        totalBudget: 1,
        commissionRate: 0,
        seasonalityData: [],
        status: "active" as const,
        createdAt: now,
        updatedAt: now,
      });
      return { projectionId, subserviceId };
    });

    await expect(
      t.withIdentity(admin(ORG_A)).mutation(
        api.functions.projections.mutations.addSubserviceMidYear,
        {
          projectionId: seed.projectionId,
          subserviceId: seed.subserviceId,
          startMonth: 1, // always retroactive (unless current month is Jan, handled above)
          endMonth: 12,
          monthlyAmount: 1_000,
        }
      )
    ).rejects.toThrow(/retroactivos en beta/);
  });

  it("recalculate preserves add-on rows and their monthlyAssignments (spec §4.3)", async () => {
    const t = setupTest();
    const { projectionId, subserviceId } = await seedBase(t, ORG_A);

    // Seed a base projectionServices row so recalculate has something to
    // operate on (otherwise serviceConfigs is empty and the engine returns
    // nothing).
    const baseServiceId = await t.run(async (ctx) => {
      const svc = await ctx.db
        .query("services")
        .filter((q) => q.eq(q.field("name"), "Marketing"))
        .first();
      const baseSvc = svc!._id;
      await ctx.db.insert("projectionServices", {
        orgId: ORG_A,
        projectionId,
        serviceId: baseSvc,
        serviceName: "Marketing",
        chosenPct: 0.1,
        isActive: true,
        annualAmount: 60_000,
        normalizedWeight: 1,
      });
      return baseSvc;
    });
    expect(baseServiceId).toBeDefined();

    const addOnResult = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.projections.mutations.addSubserviceMidYear, {
        projectionId,
        subserviceId,
        startMonth: 7,
        endMonth: 12,
        monthlyAmount: 4_500,
      });

    // Run recalculate (no service updates).
    await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.projections.mutations.recalculate, {
        projectionId,
      });

    await t.run(async (ctx) => {
      // Add-on row still present + intact (annualAmount, ventana, link).
      const addOn = await ctx.db.get(addOnResult.projectionServiceId);
      expect(addOn).not.toBeNull();
      expect(addOn!.annualAmount).toBe(27_000);
      expect(addOn!.startMonth).toBe(7);
      expect(addOn!.endMonth).toBe(12);
      expect(addOn!.supplementaryQuotationId).toBe(addOnResult.quotationId);

      // Add-on MAs preserved.
      const addOnMAs = await ctx.db
        .query("monthlyAssignments")
        .withIndex("by_projServiceId", (q) =>
          q.eq("projServiceId", addOnResult.projectionServiceId)
        )
        .collect();
      expect(addOnMAs).toHaveLength(6);
    });
  });

  it("rejects subservice from another org", async () => {
    const t = setupTest();
    // Subservice belongs to ORG_A; caller is ORG_B.
    const { projectionId, subserviceId } = await seedBase(t, ORG_A, {
      subserviceOrgId: ORG_A,
    });
    // Need an ORG_B projection to bypass the projection guard first… but the
    // subservice is org-scoped to ORG_A so it can't be added under ORG_B
    // regardless. Construct a separate ORG_B projection and a subservice in
    // ORG_A with the same parent service, then call as ORG_B.
    const orgBProjection = await t.run(async (ctx) => {
      const now = Date.now();
      const clientId = await ctx.db.insert("clients", {
        orgId: ORG_B,
        name: "ACME-B",
        rfc: "BBB010101BBB",
        industry: "Marketing",
        annualRevenue: 1,
        billingFrequency: "mensual" as const,
        isArchived: false,
        createdAt: now,
      });
      const futureYear = new Date().getUTCFullYear() + 1;
      return await ctx.db.insert("projections", {
        orgId: ORG_B,
        clientId,
        year: futureYear,
        annualSales: 1,
        totalBudget: 1,
        commissionRate: 0,
        seasonalityData: [],
        status: "active" as const,
        createdAt: now,
        updatedAt: now,
      });
    });
    // Confirm ORG_A projection isn't touched in this guard path
    expect(projectionId).toBeDefined();

    await expect(
      t.withIdentity(admin(ORG_B)).mutation(
        api.functions.projections.mutations.addSubserviceMidYear,
        {
          projectionId: orgBProjection,
          subserviceId, // subservice is org-scoped to ORG_A
          startMonth: 7,
          endMonth: 12,
          monthlyAmount: 1_000,
        }
      )
    ).rejects.toThrow(/no pertenece a tu org/);
  });
});
