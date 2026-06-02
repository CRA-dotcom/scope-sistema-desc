import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { internal } from "../../../_generated/api";

/**
 * Tests for the dropSeasonalityDeltas migration.
 *
 * The migration ran on dev with 0 rows affected (no legacy projections had
 * seasonalityDeltas without outliers). The field has been dropped from the
 * schema. These tests confirm the migration is a safe no-op on a clean DB.
 */
describe("dropSeasonalityDeltas migration", () => {
  it("returns zero migrations on a clean DB (no legacy rows)", async () => {
    const t = convexTest(schema);
    const result = await t.mutation(
      internal.functions.migrations.dropSeasonalityDeltas.run,
      {}
    );
    expect(result.projectionsMigrated).toBe(0);
    expect(result.draftsMigrated).toBe(0);
  });

  it("skips projections that already have outliers", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: "org_A",
        name: "C",
        rfc: "X",
        industry: "S",
        annualRevenue: 0,
        billingFrequency: "mensual",
        isArchived: false,
        createdAt: Date.now(),
      });
      await ctx.db.insert("projections", {
        orgId: "org_A",
        clientId,
        year: 2026,
        annualSales: 0,
        totalBudget: 0,
        commissionRate: 0,
        seasonalityData: [],
        status: "active",
        seasonalityOutliers: [{ month: 5, value: 50, unit: "amount" as const }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const result = await t.mutation(
      internal.functions.migrations.dropSeasonalityDeltas.run,
      {}
    );
    // Projection has outliers and no deltas (field dropped), so skipped.
    expect(result.projectionsMigrated).toBe(0);
    const proj = await t.run((ctx) =>
      ctx.db.query("projections").collect().then((rs) => rs[0])
    );
    // Outliers preserved untouched.
    expect(proj?.seasonalityOutliers).toEqual([
      { month: 5, value: 50, unit: "amount" },
    ]);
  });

  it("is idempotent on a draft with outliers already set", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectionDrafts", {
        orgId: "org_A",
        userId: "user_X",
        state: {
          step: 2,
          seasonalityOutliers: [{ month: 3, value: 25, unit: "percent" as const }],
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const result = await t.mutation(
      internal.functions.migrations.dropSeasonalityDeltas.run,
      {}
    );
    expect(result.draftsMigrated).toBe(0);
    const draft = await t.run((ctx) =>
      ctx.db.query("projectionDrafts").collect().then((rs) => rs[0])
    );
    expect(draft?.state.seasonalityOutliers).toEqual([
      { month: 3, value: 25, unit: "percent" },
    ]);
  });
});
