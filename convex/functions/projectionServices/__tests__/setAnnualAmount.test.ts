/**
 * Tests for setAnnualAmount (F1 fix):
 * After patching annualAmount, the mutation must recalculate monthlyAssignments
 * so the monthly sum stays consistent — critical invariant for dynamic_retainer.
 */
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import schema from "../../../schema";
import type { Id } from "../../../_generated/dataModel";

async function seedWithCells(
  t: ReturnType<typeof convexTest>,
  opts: {
    orgId: string;
    annualAmount: number;
    /** cells: array of { month, amount, isManuallyOverridden } */
    cells: { month: number; amount: number; isManuallyOverridden: boolean }[];
    /** optional feFactor per month (default 1 for all) */
    feByMonth?: Map<number, number>;
  }
): Promise<{
  projServiceId: Id<"projectionServices">;
  projectionId: Id<"projections">;
  clientId: Id<"clients">;
}> {
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
      orgId: opts.orgId,
      name: "Cliente F1",
      rfc: "CF1240101AAA",
      industry: "tecnologia",
      annualRevenue: 2_000_000,
      billingFrequency: "mensual" as const,
      isArchived: false,
      createdAt: now,
    });

    // Build seasonalityData with even feFactor=1 or custom feByMonth.
    const seasonalityData = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      monthlySales: 100_000,
      feFactor: opts.feByMonth?.get(i + 1) ?? 1,
    }));

    const projectionId = await ctx.db.insert("projections", {
      orgId: opts.orgId,
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
      orgId: opts.orgId,
      projectionId,
      serviceId,
      serviceName: "Consultoría",
      chosenPct: 100,
      isActive: true,
      annualAmount: opts.annualAmount,
      normalizedWeight: 1,
    });

    for (const cell of opts.cells) {
      await ctx.db.insert("monthlyAssignments", {
        orgId: opts.orgId,
        projServiceId,
        projectionId,
        clientId,
        serviceName: "Consultoría",
        month: cell.month,
        year: 2026,
        amount: cell.amount,
        feFactor: opts.feByMonth?.get(cell.month) ?? 1,
        status: "pending" as const,
        invoiceStatus: "not_invoiced" as const,
        isManuallyOverridden: cell.isManuallyOverridden,
      });
    }

    return { projServiceId, projectionId, clientId };
  });
}

describe("projectionServices.setAnnualAmount (F1)", () => {
  it("redistributes non-overridden cells after annualAmount change — sum equals new annualAmount", async () => {
    const t = convexTest(schema);
    const orgId = "org_f1";
    const asAdmin = t.withIdentity({ orgId, orgRole: "org:admin" });

    // 12 equal cells at 10_000 each = 120_000 total; none overridden.
    const { projServiceId } = await seedWithCells(t, {
      orgId,
      annualAmount: 120_000,
      cells: Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        amount: 10_000,
        isManuallyOverridden: false,
      })),
    });

    // Set new annualAmount = 240_000
    await asAdmin.mutation(
      api.functions.projectionServices.mutations.setAnnualAmount,
      { projServiceId, annualAmount: 240_000 }
    );

    const cells = await t.run(async (ctx) =>
      ctx.db
        .query("monthlyAssignments")
        .withIndex("by_projServiceId", (q) => q.eq("projServiceId", projServiceId))
        .collect()
    );

    const totalSum = cells.reduce((s, c) => s + c.amount, 0);
    expect(totalSum).toBeCloseTo(240_000, 0);

    const ps = await t.run((ctx) => ctx.db.get(projServiceId));
    expect(ps?.annualAmount).toBe(240_000);
  });

  it("preserves isManuallyOverridden cells and distributes remainder to non-overridden (dynamic_retainer invariant)", async () => {
    const t = convexTest(schema);
    const orgId = "org_f1b";
    const asAdmin = t.withIdentity({ orgId, orgRole: "org:admin" });

    // Month 3 is manually overridden at 30_000.
    // Months 1,2,4..12 are non-overridden at 10_000 each = 110_000.
    // Total annualAmount = 120_000 (30k + 11×10k ≈ correct).
    const cells = [
      { month: 3, amount: 30_000, isManuallyOverridden: true },
      ...Array.from({ length: 11 }, (_, i) => {
        const m = i < 2 ? i + 1 : i + 2; // skip month 3
        return { month: m, amount: 10_000, isManuallyOverridden: false };
      }),
    ];

    const { projServiceId } = await seedWithCells(t, {
      orgId,
      annualAmount: 120_000,
      cells,
    });

    // Set new annualAmount = 180_000.
    // Override stays at 30_000; remaining 150_000 distributes over 11 months.
    await asAdmin.mutation(
      api.functions.projectionServices.mutations.setAnnualAmount,
      { projServiceId, annualAmount: 180_000 }
    );

    const cellsAfter = await t.run(async (ctx) =>
      ctx.db
        .query("monthlyAssignments")
        .withIndex("by_projServiceId", (q) => q.eq("projServiceId", projServiceId))
        .collect()
    );

    const overriddenCell = cellsAfter.find((c) => c.month === 3);
    expect(overriddenCell?.amount).toBe(30_000); // FROZEN
    expect(overriddenCell?.isManuallyOverridden).toBe(true);

    const nonOverriddenSum = cellsAfter
      .filter((c) => !c.isManuallyOverridden)
      .reduce((s, c) => s + c.amount, 0);
    expect(nonOverriddenSum).toBeCloseTo(150_000, 0); // 180k - 30k override

    const totalSum = cellsAfter.reduce((s, c) => s + c.amount, 0);
    expect(totalSum).toBeCloseTo(180_000, 0);
  });

  it("rejects annualAmount < 0", async () => {
    const t = convexTest(schema);
    const orgId = "org_f1c";
    const asAdmin = t.withIdentity({ orgId, orgRole: "org:admin" });

    const { projServiceId } = await seedWithCells(t, {
      orgId,
      annualAmount: 120_000,
      cells: [],
    });

    await expect(
      asAdmin.mutation(
        api.functions.projectionServices.mutations.setAnnualAmount,
        { projServiceId, annualAmount: -1 }
      )
    ).rejects.toThrow(/≥ 0/);
  });
});
