import { describe, it, expect } from "vitest";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import { setupTest, ORG_A, ORG_B } from "../../../../tests/harness";

/**
 * B1 — quotations.createSupplementary (internalMutation)
 *
 * Per docs/superpowers/specs/2026-05-26-client-services-overview-design.md §5
 */

async function seedScenario(
  t: ReturnType<typeof setupTest>,
  orgId: string,
  opts: { withApprovedParent?: boolean } = {}
): Promise<{
  clientId: Id<"clients">;
  projectionId: Id<"projections">;
  projServiceId: Id<"projectionServices">;
  parentQuotationId?: Id<"quotations">;
}> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const clientId = await ctx.db.insert("clients", {
      orgId,
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
    const projectionId = await ctx.db.insert("projections", {
      orgId,
      clientId,
      year: 2026,
      annualSales: 1,
      totalBudget: 1,
      commissionRate: 0,
      seasonalityData: [],
      status: "active" as const,
      createdAt: now,
      updatedAt: now,
    });
    const projServiceId = await ctx.db.insert("projectionServices", {
      orgId,
      projectionId,
      serviceId: marketingId,
      serviceName: "Marketing",
      chosenPct: 0,
      isActive: true,
      annualAmount: 27_000,
      normalizedWeight: 0,
      startMonth: 7,
      endMonth: 12,
    });
    let parentQuotationId: Id<"quotations"> | undefined;
    if (opts.withApprovedParent) {
      parentQuotationId = await ctx.db.insert("quotations", {
        orgId,
        projServiceId,
        clientId,
        serviceName: "Marketing",
        content: "<p>parent</p>",
        status: "approved" as const,
        createdAt: now,
      });
    }
    return { clientId, projectionId, projServiceId, parentQuotationId };
  });
}

describe("quotations.createSupplementary", () => {
  it("creates a supplementary quotation with parent link, lineItems, totalAmount", async () => {
    const t = setupTest();
    const { projServiceId, parentQuotationId } = await seedScenario(t, ORG_A, {
      withApprovedParent: true,
    });

    const quotationId = await t.mutation(
      internal.functions.quotations.mutations.createSupplementary,
      {
        projServiceId,
        parentQuotationId,
        startMonth: 7,
        endMonth: 12,
        monthlyAmount: 4_500,
      }
    );

    expect(quotationId).toBeDefined();

    await t.run(async (ctx) => {
      const q = await ctx.db.get(quotationId);
      expect(q).not.toBeNull();
      expect(q!.isSupplementary).toBe(true);
      expect(q!.parentQuotationId).toBe(parentQuotationId);
      expect(q!.status).toBe("draft");
      expect(q!.totalAmount).toBe(27_000);
      expect(q!.lineItems).toHaveLength(6);
      expect(q!.lineItems!.map((li) => li.month).sort((a, b) => a - b)).toEqual(
        [7, 8, 9, 10, 11, 12]
      );
      // Labels include the year.
      expect(q!.lineItems![0].label).toMatch(/2026$/);
    });
  });

  it("rejects parentQuotationId from another org", async () => {
    const t = setupTest();
    // projService in ORG_A, parent quotation in ORG_B.
    const { projServiceId } = await seedScenario(t, ORG_A);
    const otherParentId = await t.run(async (ctx) => {
      const now = Date.now();
      const cid = await ctx.db.insert("clients", {
        orgId: ORG_B,
        name: "OtherClient",
        rfc: "BBB010101BBB",
        industry: "x",
        annualRevenue: 1,
        billingFrequency: "mensual" as const,
        isArchived: false,
        createdAt: now,
      });
      const svc = await ctx.db.insert("services", {
        orgId: undefined,
        name: "X",
        type: "base" as const,
        minPct: 0,
        maxPct: 1,
        defaultPct: 0.1,
        isDefault: true,
        sortOrder: 1,
      });
      const pid = await ctx.db.insert("projections", {
        orgId: ORG_B,
        clientId: cid,
        year: 2026,
        annualSales: 1,
        totalBudget: 1,
        commissionRate: 0,
        seasonalityData: [],
        status: "active" as const,
        createdAt: now,
        updatedAt: now,
      });
      const psid = await ctx.db.insert("projectionServices", {
        orgId: ORG_B,
        projectionId: pid,
        serviceId: svc,
        serviceName: "X",
        chosenPct: 0,
        isActive: true,
        annualAmount: 1,
        normalizedWeight: 0,
      });
      return await ctx.db.insert("quotations", {
        orgId: ORG_B,
        projServiceId: psid,
        clientId: cid,
        serviceName: "X",
        content: "<p/>",
        status: "approved" as const,
        createdAt: now,
      });
    });

    await expect(
      t.mutation(
        internal.functions.quotations.mutations.createSupplementary,
        {
          projServiceId,
          parentQuotationId: otherParentId,
          startMonth: 7,
          endMonth: 12,
          monthlyAmount: 1_000,
        }
      )
    ).rejects.toThrow(/otro org o no existe/);
  });
});
