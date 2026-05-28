import { describe, it, expect } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { api } from "../../../_generated/api";

function asUserOfOrg(orgId: string, userId = "user_admin_1") {
  return {
    subject: userId, issuer: "test",
    tokenIdentifier: `test|user|${orgId}`, orgId,
  };
}

describe("projections.cloneProjectionToDraft", () => {
  it("creates a draft with previousProjectionId set + hydrated state", async () => {
    const t = setupTest();
    const projectionId = await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: "org_a", name: "X", rfc: "AAA010101AAA", industry: "X",
        annualRevenue: 1, billingFrequency: "mensual" as const,
        isArchived: false, assignedTo: "u", createdAt: Date.now(),
      });
      return await ctx.db.insert("projections", {
        orgId: "org_a", clientId, year: 2026,
        annualSales: 2_000_000, totalBudget: 200_000, commissionRate: 0.05,
        seasonalityData: [], status: "active" as const,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
    });

    const draftId = await t
      .withIdentity(asUserOfOrg("org_a"))
      .mutation(api.functions.projections.mutations.cloneProjectionToDraft, { projectionId });

    await t.run(async (ctx) => {
      const draft = await ctx.db.get(draftId);
      expect(draft).toBeTruthy();
      expect(draft?.state.previousProjectionId).toBe(projectionId);
      expect(draft?.state.year).toBe(2026);
      expect(draft?.state.annualSales).toBe(2_000_000);
      expect(draft?.state.totalBudget).toBe(200_000);
      expect(draft?.state.commissionRate).toBe(0.05);
      expect(draft?.state.step).toBe(0);
      expect(draft?.userId).toBe("user_admin_1");
    });
  });

  it("deletes any pre-existing draft for the same client before cloning", async () => {
    const t = setupTest();
    const projectionId = await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: "org_a", name: "X", rfc: "AAA010101AAA", industry: "X",
        annualRevenue: 1, billingFrequency: "mensual" as const,
        isArchived: false, assignedTo: "u", createdAt: Date.now(),
      });
      // Pre-existing draft for this user+client (simulates them being mid-wizard)
      await ctx.db.insert("projectionDrafts", {
        orgId: "org_a",
        userId: "user_admin_1",
        clientId,
        state: { step: 1, year: 2025 },  // stale data
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return await ctx.db.insert("projections", {
        orgId: "org_a", clientId, year: 2026,
        annualSales: 2_000_000, totalBudget: 200_000, commissionRate: 0.05,
        seasonalityData: [], status: "active" as const,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
    });

    const newDraftId = await t
      .withIdentity(asUserOfOrg("org_a"))
      .mutation(api.functions.projections.mutations.cloneProjectionToDraft, { projectionId });

    await t.run(async (ctx) => {
      // Only the new draft should exist for this (orgId, userId, clientId)
      const clientId = (await ctx.db.get(newDraftId))?.clientId;
      expect(clientId).toBeTruthy();
      const drafts = await ctx.db
        .query("projectionDrafts")
        .withIndex("by_orgId_userId_clientId", (q) =>
          q.eq("orgId", "org_a").eq("userId", "user_admin_1").eq("clientId", clientId!)
        )
        .collect();
      expect(drafts).toHaveLength(1);
      expect(drafts[0]._id).toBe(newDraftId);
      expect(drafts[0].state.previousProjectionId).toBe(projectionId);
    });
  });

  it("throws cross-org", async () => {
    const t = setupTest();
    const projectionId = await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: "org_a", name: "X", rfc: "AAA010101AAA", industry: "X",
        annualRevenue: 1, billingFrequency: "mensual" as const,
        isArchived: false, assignedTo: "u", createdAt: Date.now(),
      });
      return await ctx.db.insert("projections", {
        orgId: "org_a", clientId, year: 2026, annualSales: 1, totalBudget: 1,
        commissionRate: 0, seasonalityData: [], status: "active" as const,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
    });
    await expect(
      t.withIdentity(asUserOfOrg("org_other"))
        .mutation(api.functions.projections.mutations.cloneProjectionToDraft, { projectionId })
    ).rejects.toThrow(/no encontrada/i);
  });
});
