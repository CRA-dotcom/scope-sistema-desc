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

  it("does NOT collapse contracts across different orgs sharing a quotationId (cross-org isolation)", async () => {
    // Defensive: quotation IDs are globally unique so this collision cannot
    // happen via normal user flows, but the orgId check in the guard
    // (`existing.orgId === args.orgId`) is the only thing preventing a
    // silent cross-tenant collision if data corruption ever surfaced it.
    const t = convexTest(schema);
    const orgA = "org_A";
    const orgB = "org_B";
    const seedA = await seedFKs(t, orgA);
    const seedB = await seedFKs(t, orgB);

    // Manually plant a contract in org A pointing to org B's quotationId
    // (simulating the corruption / leak scenario the guard defends against).
    await t.run((ctx) =>
      ctx.db.insert("contracts", {
        orgId: orgA,
        quotationId: seedB.quotationId,
        projServiceId: seedA.projServiceId,
        clientId: seedA.clientId,
        serviceName: "S",
        content: "<p>org_A planted</p>",
        status: "draft" as const,
        createdAt: Date.now(),
      })
    );

    // Now org B calls saveGenerated for ITS OWN quotation. The by_quotationId
    // lookup will find the planted org_A contract, but the orgId guard must
    // reject the early-return and fall through to insert a new org_B contract.
    const orgBId = await t.mutation(
      internal.functions.contracts.mutations.saveGenerated,
      {
        orgId: orgB,
        quotationId: seedB.quotationId,
        projServiceId: seedB.projServiceId,
        clientId: seedB.clientId,
        serviceName: "S",
        content: "<p>org_B legit</p>",
      }
    );

    const contracts = await t.run((ctx) =>
      ctx.db.query("contracts").collect()
    );

    // Two contracts now exist for the same quotationId — one per org.
    expect(contracts).toHaveLength(2);
    const orgBContract = contracts.find((c) => c._id === orgBId);
    expect(orgBContract).toBeDefined();
    expect(orgBContract!.orgId).toBe(orgB);
    expect(orgBContract!.content).toBe("<p>org_B legit</p>");

    // The planted org_A contract is untouched.
    const orgAContract = contracts.find((c) => c.orgId === orgA);
    expect(orgAContract!.content).toBe("<p>org_A planted</p>");
  });
});
