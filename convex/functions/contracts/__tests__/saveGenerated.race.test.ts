import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

async function seedFKs(
  t: ReturnType<typeof convexTest>,
  orgId: string
): Promise<{
  clientId: Id<"clients">;
  projServiceId: Id<"projectionServices">;
  quotationId: Id<"quotations">;
}> {
  return t.run(async (ctx) => {
    const now = Date.now();

    const serviceId = await ctx.db.insert("services", {
      orgId: undefined,
      name: "S",
      type: "base" as const,
      minPct: 0,
      maxPct: 100,
      defaultPct: 10,
      isDefault: true,
      sortOrder: 0,
    });

    const clientId = await ctx.db.insert("clients", {
      orgId,
      name: "C",
      rfc: "X",
      industry: "S",
      annualRevenue: 0,
      billingFrequency: "mensual" as const,
      isArchived: false,
      createdAt: now,
    });

    const projectionId = await ctx.db.insert("projections", {
      orgId,
      clientId,
      year: 2026,
      annualSales: 0,
      totalBudget: 0,
      commissionRate: 0,
      seasonalityData: [],
      status: "active" as const,
      createdAt: now,
      updatedAt: now,
    });

    const projServiceId = await ctx.db.insert("projectionServices", {
      orgId,
      projectionId,
      serviceId,
      serviceName: "S",
      chosenPct: 10,
      isActive: true,
      annualAmount: 0,
      normalizedWeight: 1,
    });

    const quotationId = await ctx.db.insert("quotations", {
      orgId,
      projServiceId,
      clientId,
      serviceName: "S",
      content: "<p/>",
      status: "approved" as const,
      createdAt: now,
    });

    return { clientId, projServiceId, quotationId };
  });
}

describe("contracts.saveGenerated unique guard", () => {
  it("returns existing contract ID if one already exists for the quotation (race guard)", async () => {
    const t = convexTest(schema);
    const orgId = "org_A";
    const { quotationId, projServiceId, clientId } = await seedFKs(t, orgId);

    const firstId = await t.mutation(
      internal.functions.contracts.mutations.saveGenerated,
      {
        orgId,
        quotationId,
        projServiceId,
        clientId,
        serviceName: "S",
        content: "<p>first</p>",
      }
    );

    const secondId = await t.mutation(
      internal.functions.contracts.mutations.saveGenerated,
      {
        orgId,
        quotationId,
        projServiceId,
        clientId,
        serviceName: "S",
        content: "<p>second</p>",
      }
    );

    // Race winner: second call must return the SAME id as the first
    expect(secondId).toBe(firstId);

    // Only one contract should exist
    const contracts = await t.run((ctx) =>
      ctx.db.query("contracts").collect()
    );
    expect(contracts).toHaveLength(1);

    // Content must be preserved from the first call — NOT overwritten
    expect(contracts[0].content).toBe("<p>first</p>");
  });
});
