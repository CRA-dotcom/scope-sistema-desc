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

/**
 * Seed a projectionService with 12 monthly cells (even distribution, feFactor=1).
 * Returns all inserted IDs plus a helper to read all cells.
 */
async function seedWithFullYearCells(
  t: ReturnType<typeof convexTest>,
  orgId: string,
  opts: {
    annualAmount: number;
    /** cells that should be isManuallyOverridden=true */
    overriddenMonths?: number[];
  }
) {
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
      name: "Cliente F8",
      rfc: "CF8240101AAA",
      industry: "tecnologia",
      annualRevenue: 2_000_000,
      billingFrequency: "mensual" as const,
      isArchived: false,
      createdAt: now,
    });

    const seasonalityData = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      monthlySales: 100_000,
      feFactor: 1,
    }));

    const projectionId = await ctx.db.insert("projections", {
      orgId,
      clientId,
      year: 2026,
      annualSales: 1_200_000,
      totalBudget: opts.annualAmount,
      commissionRate: 0,
      seasonalityData,
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
      annualAmount: opts.annualAmount,
      normalizedWeight: 1,
    });

    const perMonth = opts.annualAmount / 12;
    for (let m = 1; m <= 12; m++) {
      await ctx.db.insert("monthlyAssignments", {
        orgId,
        projServiceId,
        projectionId,
        clientId,
        serviceName: "Consultoría",
        month: m,
        year: 2026,
        amount: perMonth,
        feFactor: 1,
        status: "pending" as const,
        invoiceStatus: "not_invoiced" as const,
        isManuallyOverridden: opts.overriddenMonths?.includes(m) ?? false,
      });
    }

    return { projServiceId, projectionId, clientId };
  });
}

describe("projectionServices.updateContractualWindow — recalc behavior (F8)", () => {
  it("zeros out-of-window cells after narrowing window to [7..12]", async () => {
    const t = convexTest(schema);
    const orgId = "org_f8a";
    const asAdmin = t.withIdentity({ orgId, orgRole: "org:admin" });

    // 12 cells at 10_000 each = 120_000 total
    const { projServiceId } = await seedWithFullYearCells(t, orgId, {
      annualAmount: 120_000,
    });

    // Narrow window to months 7–12
    await asAdmin.mutation(
      api.functions.projectionServices.mutations.updateContractualWindow,
      { projServiceId, startMonth: 7, endMonth: 12 }
    );

    const cells = await t.run(async (ctx) =>
      ctx.db
        .query("monthlyAssignments")
        .withIndex("by_projServiceId", (q) => q.eq("projServiceId", projServiceId))
        .collect()
    );

    // Months 1–6 must be zero (out of window)
    for (let m = 1; m <= 6; m++) {
      const cell = cells.find((c) => c.month === m);
      expect(cell?.amount).toBe(0);
    }

    // Months 7–12 must be non-zero and sum to full annualAmount
    const inWindowSum = cells
      .filter((c) => c.month >= 7 && c.month <= 12)
      .reduce((s, c) => s + c.amount, 0);
    expect(inWindowSum).toBeCloseTo(120_000, 0);
  });

  it("preserves manually overridden cells even when they fall outside the new window", async () => {
    const t = convexTest(schema);
    const orgId = "org_f8b";
    const asAdmin = t.withIdentity({ orgId, orgRole: "org:admin" });

    // Month 3 is manually overridden
    const { projServiceId } = await seedWithFullYearCells(t, orgId, {
      annualAmount: 120_000,
      overriddenMonths: [3],
    });

    // Narrow window to months 7–12 (month 3 is now outside the window but overridden)
    await asAdmin.mutation(
      api.functions.projectionServices.mutations.updateContractualWindow,
      { projServiceId, startMonth: 7, endMonth: 12 }
    );

    const cells = await t.run(async (ctx) =>
      ctx.db
        .query("monthlyAssignments")
        .withIndex("by_projServiceId", (q) => q.eq("projServiceId", projServiceId))
        .collect()
    );

    const month3 = cells.find((c) => c.month === 3);
    // Manual override is preserved regardless of window
    expect(month3?.isManuallyOverridden).toBe(true);
    expect(month3?.amount).toBeCloseTo(10_000, 0); // original seeded value

    // Non-overridden out-of-window months 1,2,4,5,6 are zeroed
    for (const m of [1, 2, 4, 5, 6]) {
      const cell = cells.find((c) => c.month === m);
      expect(cell?.amount).toBe(0);
    }
  });

  it("restores all-month amounts when window is cleared (no startMonth/endMonth)", async () => {
    const t = convexTest(schema);
    const orgId = "org_f8c";
    const asAdmin = t.withIdentity({ orgId, orgRole: "org:admin" });

    const { projServiceId } = await seedWithFullYearCells(t, orgId, {
      annualAmount: 120_000,
    });

    // First narrow to [7..12]
    await asAdmin.mutation(
      api.functions.projectionServices.mutations.updateContractualWindow,
      { projServiceId, startMonth: 7, endMonth: 12 }
    );

    // Then clear the window — full year should receive amounts again
    await asAdmin.mutation(
      api.functions.projectionServices.mutations.updateContractualWindow,
      { projServiceId }
    );

    const cells = await t.run(async (ctx) =>
      ctx.db
        .query("monthlyAssignments")
        .withIndex("by_projServiceId", (q) => q.eq("projServiceId", projServiceId))
        .collect()
    );

    // All 12 months in-window → total sum = annualAmount
    const totalSum = cells.reduce((s, c) => s + c.amount, 0);
    expect(totalSum).toBeCloseTo(120_000, 0);

    // All months non-zero (even split, feFactor=1)
    for (const cell of cells) {
      expect(cell.amount).toBeGreaterThan(0);
    }
  });
});
