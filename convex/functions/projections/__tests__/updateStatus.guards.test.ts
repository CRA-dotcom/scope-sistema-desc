import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api } from "../../../_generated/api";

const ORG_A = "org_test_A";

async function seedProjection(
  t: ReturnType<typeof convexTest>,
  status: "draft" | "active" | "archived"
) {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId: ORG_A, name: "C", rfc: "X", industry: "S",
      annualRevenue: 0, billingFrequency: "mensual",
      isArchived: false, createdAt: Date.now(),
    });
    return await ctx.db.insert("projections", {
      orgId: ORG_A, clientId, year: 2026,
      annualSales: 0, totalBudget: 0, commissionRate: 0,
      seasonalityData: [], status,
      createdAt: Date.now(), updatedAt: Date.now(),
    });
  });
}

describe("projections.updateStatus guards", () => {
  it("allows draft → active", async () => {
    const t = convexTest(schema);
    const id = await seedProjection(t, "draft");
    await t
      .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
      .mutation(api.functions.projections.mutations.updateStatus, {
        id, status: "active",
      });
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.status).toBe("active");
  });

  it("allows active → archived", async () => {
    const t = convexTest(schema);
    const id = await seedProjection(t, "active");
    await t
      .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
      .mutation(api.functions.projections.mutations.updateStatus, {
        id, status: "archived",
      });
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.status).toBe("archived");
  });

  it("allows archived → active (re-activación)", async () => {
    const t = convexTest(schema);
    const id = await seedProjection(t, "archived");
    await t
      .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
      .mutation(api.functions.projections.mutations.updateStatus, {
        id, status: "active",
      });
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.status).toBe("active");
  });

  it("is idempotent (active → active no throw)", async () => {
    const t = convexTest(schema);
    const id = await seedProjection(t, "active");
    const result = await t
      .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
      .mutation(api.functions.projections.mutations.updateStatus, {
        id, status: "active",
      });
    expect(result).toBeNull();
  });

  it("throws INVALID_TRANSITION on active → draft (debe ir por replaceProjection)", async () => {
    const t = convexTest(schema);
    const id = await seedProjection(t, "active");
    await expect(
      t
        .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
        .mutation(api.functions.projections.mutations.updateStatus, {
          id, status: "draft",
        })
    ).rejects.toThrow(/INVALID_TRANSITION|active.*draft/i);
  });

  it("throws INVALID_TRANSITION on archived → draft", async () => {
    const t = convexTest(schema);
    const id = await seedProjection(t, "archived");
    await expect(
      t
        .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
        .mutation(api.functions.projections.mutations.updateStatus, {
          id, status: "draft",
        })
    ).rejects.toThrow(/INVALID_TRANSITION|archived.*draft/i);
  });

  it("throws INVALID_TRANSITION on draft → archived (saltó active)", async () => {
    const t = convexTest(schema);
    const id = await seedProjection(t, "draft");
    await expect(
      t
        .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
        .mutation(api.functions.projections.mutations.updateStatus, {
          id, status: "archived",
        })
    ).rejects.toThrow(/INVALID_TRANSITION|draft.*archived/i);
  });
});
