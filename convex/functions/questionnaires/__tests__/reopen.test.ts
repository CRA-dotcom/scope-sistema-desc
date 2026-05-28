import { describe, it, expect } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { api } from "../../../_generated/api";

function asUserOfOrg(orgId: string, userId = "user_admin_1", orgRole = "org:admin") {
  return {
    subject: userId,
    issuer: "test",
    tokenIdentifier: `test|user|${orgId}`,
    orgId,
    orgRole,
  };
}

async function seedCompletedQuestionnaire(t: ReturnType<typeof setupTest>) {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId: "org_a",
      name: "ACME",
      rfc: "AAA010101AAA",
      industry: "X",
      annualRevenue: 1_000_000,
      billingFrequency: "mensual" as const,
      isArchived: false,
      assignedTo: "user_admin_1",
      createdAt: Date.now(),
    });
    const projectionId = await ctx.db.insert("projections", {
      orgId: "org_a",
      clientId,
      year: 2026,
      annualSales: 1_000_000,
      totalBudget: 100_000,
      commissionRate: 0,
      seasonalityData: [],
      status: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return await ctx.db.insert("questionnaireResponses", {
      orgId: "org_a",
      clientId,
      projectionId,
      responses: [],
      status: "completed" as const,
      completedAt: Date.now(),
      createdAt: Date.now(),
    });
  });
}

describe("questionnaires.reopen", () => {
  it("transitions completed → in_progress and logs event", async () => {
    const t = setupTest();
    const qId = await seedCompletedQuestionnaire(t);
    await t
      .withIdentity(asUserOfOrg("org_a"))
      .mutation(api.functions.questionnaires.mutations.reopen, { id: qId });
    await t.run(async (ctx) => {
      const q = await ctx.db.get(qId);
      expect(q?.status).toBe("in_progress");
      expect(q?.completedAt).toBeUndefined();
      expect(q?.reopenedAt).toBeTypeOf("number");
      expect(q?.reopenedBy).toBe("user_admin_1");
      const events = await ctx.db
        .query("documentEvents")
        .withIndex("by_orgId_entityType_entityId", (q2) =>
          q2.eq("orgId", "org_a").eq("entityType", "questionnaire").eq("entityId", qId)
        )
        .collect();
      expect(events.some((e) => e.eventType === "reopened")).toBe(true);
      const reopenedEvent = events.find((e) => e.eventType === "reopened");
      expect(reopenedEvent?.message).not.toMatch(/user_/);
    });
  });

  it("throws when questionnaire is not completed", async () => {
    const t = setupTest();
    const qId = await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: "org_a", name: "X", rfc: "AAA010101AAA", industry: "X",
        annualRevenue: 1, billingFrequency: "mensual" as const,
        isArchived: false, assignedTo: "u", createdAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: "org_a", clientId, year: 2026, annualSales: 1, totalBudget: 1,
        commissionRate: 0, seasonalityData: [], status: "active" as const,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      return await ctx.db.insert("questionnaireResponses", {
        orgId: "org_a", clientId, projectionId, responses: [],
        status: "draft" as const, createdAt: Date.now(),
      });
    });
    await expect(
      t
        .withIdentity(asUserOfOrg("org_a"))
        .mutation(api.functions.questionnaires.mutations.reopen, { id: qId })
    ).rejects.toThrow(/completados/);
  });

  it("throws cross-org", async () => {
    const t = setupTest();
    const qId = await seedCompletedQuestionnaire(t);
    await expect(
      t
        .withIdentity(asUserOfOrg("org_other"))
        .mutation(api.functions.questionnaires.mutations.reopen, { id: qId })
    ).rejects.toThrow(/no encontrado/i);
  });

  it("throws when caller is not an admin (org:member)", async () => {
    const t = setupTest();
    const qId = await seedCompletedQuestionnaire(t);
    await expect(
      t
        .withIdentity(asUserOfOrg("org_a", "user_member_1", "org:member"))
        .mutation(api.functions.questionnaires.mutations.reopen, { id: qId })
    ).rejects.toThrow("Acceso denegado. Se requiere rol de Administrador.");
  });

  it("audit log message does not contain raw userId", async () => {
    const t = setupTest();
    const qId = await seedCompletedQuestionnaire(t);
    await t
      .withIdentity(asUserOfOrg("org_a"))
      .mutation(api.functions.questionnaires.mutations.reopen, { id: qId });
    await t.run(async (ctx) => {
      const events = await ctx.db
        .query("documentEvents")
        .withIndex("by_orgId_entityType_entityId", (q2) =>
          q2.eq("orgId", "org_a").eq("entityType", "questionnaire").eq("entityId", qId)
        )
        .collect();
      expect(events[0].message).not.toMatch(/user_/);
    });
  });

  it("clears reopenedAt and reopenedBy after re-submission", async () => {
    const t = setupTest();
    const qId = await seedCompletedQuestionnaire(t);
    // Reopen the questionnaire
    await t
      .withIdentity(asUserOfOrg("org_a"))
      .mutation(api.functions.questionnaires.mutations.reopen, { id: qId });
    // Verify it's now in_progress with reopenedAt set
    await t.run(async (ctx) => {
      const q = await ctx.db.get(qId);
      expect(q?.status).toBe("in_progress");
      expect(q?.reopenedAt).toBeTypeOf("number");
    });
    // Re-submit via the internal submit mutation (authenticated path)
    await t
      .withIdentity(asUserOfOrg("org_a"))
      .mutation(api.functions.questionnaires.mutations.submit, { id: qId });
    // Verify reopened fields are cleared
    await t.run(async (ctx) => {
      const q = await ctx.db.get(qId);
      expect(q?.status).toBe("completed");
      expect(q?.reopenedAt).toBeUndefined();
      expect(q?.reopenedBy).toBeUndefined();
    });
  });
});
