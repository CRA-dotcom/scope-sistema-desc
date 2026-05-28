import { describe, it, expect } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { api } from "../../../_generated/api";

function asUserOfOrg(orgId: string, userId = "user_admin_1") {
  return {
    subject: userId,
    issuer: "test",
    tokenIdentifier: `test|user|${orgId}`,
    orgId,
  };
}

describe("projectionDrafts.listMyActiveDrafts", () => {
  it("returns drafts for the current user/org with client name resolved", async () => {
    const t = setupTest();
    const { draftId, clientId } = await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: "org_a", name: "ACME", rfc: "AAA010101AAA", industry: "X",
        annualRevenue: 1_000_000, billingFrequency: "mensual" as const,
        isArchived: false, assignedTo: "user_admin_1", createdAt: Date.now(),
      });
      const draftId = await ctx.db.insert("projectionDrafts", {
        orgId: "org_a",
        userId: "user_admin_1",
        clientId,
        state: { step: 2, year: 2026 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return { draftId, clientId };
    });
    const result = await t
      .withIdentity(asUserOfOrg("org_a"))
      .query(api.functions.projectionDrafts.queries.listMyActiveDrafts, {});
    expect(result).toHaveLength(1);
    expect(result[0]._id).toBe(draftId);
    expect(result[0].clientName).toBe("ACME");
    expect(result[0].year).toBe(2026);
    expect(result[0].step).toBe(2);
  });

  it("excludes drafts from other users and other orgs", async () => {
    const t = setupTest();
    await t.run(async (ctx) => {
      // Draft owned by another user in same org
      await ctx.db.insert("projectionDrafts", {
        orgId: "org_a",
        userId: "user_other",
        state: { step: 0 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      // Draft owned by same user but different org
      await ctx.db.insert("projectionDrafts", {
        orgId: "org_other",
        userId: "user_admin_1",
        state: { step: 0 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const result = await t
      .withIdentity(asUserOfOrg("org_a"))
      .query(api.functions.projectionDrafts.queries.listMyActiveDrafts, {});
    expect(result).toHaveLength(0);
  });
});
