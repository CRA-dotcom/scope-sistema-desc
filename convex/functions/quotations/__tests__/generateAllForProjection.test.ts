import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import { setupTest, ORG_A, ORG_B } from "../../../../tests/harness";

/**
 * #5 — generateAllForProjection
 *
 * Batch-generate one draft quotation per active projectionService for a
 * projection. Triggered from the proyecciones detail page when the
 * questionnaire is completed.
 */

function admin(orgId: string) {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `admin_${orgId}`,
    orgId,
    orgRole: "org:admin",
  };
}

async function seedProjection(
  t: ReturnType<typeof setupTest>,
  orgId: string,
  serviceCount = 1
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const clientId = await ctx.db.insert("clients", {
      orgId,
      name: "BatchClient",
      rfc: "BAT010101AAA",
      industry: "Finance",
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
      status: "active" as const,
      createdAt: now,
      updatedAt: now,
    });
    const projServiceIds = [];
    for (let i = 0; i < serviceCount; i++) {
      const svcId = await ctx.db.insert("services", {
        orgId: undefined,
        name: `Service${i}`,
        type: "base" as const,
        minPct: 0,
        maxPct: 1,
        defaultPct: 0.1,
        isDefault: true,
        sortOrder: i,
      });
      const psId = await ctx.db.insert("projectionServices", {
        orgId,
        projectionId,
        serviceId: svcId,
        serviceName: `Service${i}`,
        chosenPct: 0.1,
        isActive: true,
        annualAmount: 10_000 * (i + 1),
        normalizedWeight: 1,
      });
      projServiceIds.push(psId);
    }
    return { clientId, projectionId, projServiceIds };
  });
}

describe("quotations.generateAllForProjection (#5)", () => {
  it("creates one quotation per active service (3 services → 3 quotations)", async () => {
    const t = setupTest();
    const { projectionId } = await seedProjection(t, ORG_A, 3);

    const result = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.quotations.mutations.generateAllForProjection, {
        projectionId,
      });

    expect(result.created).toBe(3);
    expect(result.skipped).toBe(0);

    // All three are drafts in ORG_A
    await t.run(async (ctx) => {
      const quotations = await ctx.db
        .query("quotations")
        .withIndex("by_orgId", (q) => q.eq("orgId", ORG_A))
        .collect();
      expect(quotations).toHaveLength(3);
      expect(quotations.every((q) => q.status === "draft")).toBe(true);
    });
  });

  it("skips services that already have a quotation", async () => {
    const t = setupTest();
    const { projectionId, projServiceIds } = await seedProjection(t, ORG_A, 2);

    // Pre-create a quotation for the first service
    await t.run(async (ctx) => {
      const ps = await ctx.db.get(projServiceIds[0]);
      const proj = await ctx.db.get(projectionId);
      await ctx.db.insert("quotations", {
        orgId: ORG_A,
        projServiceId: projServiceIds[0],
        clientId: proj!.clientId,
        serviceName: ps!.serviceName,
        content: "<p>pre-existing</p>",
        status: "sent" as const,
        createdAt: Date.now(),
      });
    });

    const result = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.quotations.mutations.generateAllForProjection, {
        projectionId,
      });

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it("returns { created: 0, skipped: 0 } when no active services exist", async () => {
    const t = setupTest();
    const { projectionId, projServiceIds } = await seedProjection(t, ORG_A, 1);

    // Deactivate the only service
    await t.run(async (ctx) => {
      await ctx.db.patch(projServiceIds[0], { isActive: false });
    });

    const result = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.quotations.mutations.generateAllForProjection, {
        projectionId,
      });

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it("rejects cross-org projectionId", async () => {
    const t = setupTest();
    const { projectionId } = await seedProjection(t, ORG_B, 1);

    await expect(
      t
        .withIdentity(admin(ORG_A))
        .mutation(api.functions.quotations.mutations.generateAllForProjection, {
          projectionId,
        })
    ).rejects.toThrow(/Proyección no encontrada/);
  });
});
