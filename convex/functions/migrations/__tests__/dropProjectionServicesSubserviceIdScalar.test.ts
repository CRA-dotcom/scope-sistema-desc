import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { internal } from "../../../_generated/api";

/**
 * Tests for the dropProjectionServicesSubserviceIdScalar migration.
 *
 * The migration ran on dev with 7 rows migrated (backfilled subserviceIds
 * from the legacy scalar). The scalar has been dropped from the schema.
 * These tests confirm the migration stub is a safe no-op.
 */
describe("dropProjectionServicesSubserviceIdScalar migration", () => {
  it("returns zero migrations on a clean DB (scalar field dropped)", async () => {
    const t = convexTest(schema);
    const result = await t.mutation(
      internal.functions.migrations
        .dropProjectionServicesSubserviceIdScalar.run,
      {}
    );
    expect(result.migrated).toBe(0);
  });

  it("is idempotent on rows that already have subserviceIds array", async () => {
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
      const projectionId = await ctx.db.insert("projections", {
        orgId: "org_A",
        clientId,
        year: 2026,
        annualSales: 0,
        totalBudget: 0,
        commissionRate: 0,
        seasonalityData: [],
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const serviceId = await ctx.db.insert("services", {
        name: "S",
        type: "base",
        minPct: 0,
        maxPct: 100,
        defaultPct: 10,
        isDefault: true,
        sortOrder: 0,
      });
      const subId = await ctx.db.insert("subservices", {
        parentServiceId: serviceId,
        name: "Sub",
        slug: "sub",
        defaultFrequency: "mensual",
        isActive: true,
        isDefault: false,
        sortOrder: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("projectionServices", {
        orgId: "org_A",
        projectionId,
        serviceId,
        serviceName: "S",
        subserviceIds: [subId],
        chosenPct: 10,
        isActive: true,
        annualAmount: 0,
        normalizedWeight: 1,
      });
    });
    const result = await t.mutation(
      internal.functions.migrations
        .dropProjectionServicesSubserviceIdScalar.run,
      {}
    );
    expect(result.migrated).toBe(0);
  });
});
