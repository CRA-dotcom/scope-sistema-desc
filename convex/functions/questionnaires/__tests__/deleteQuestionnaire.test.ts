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

async function seedQuestionnaire(t: ReturnType<typeof setupTest>, orgId = "org_a") {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId,
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
      orgId,
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
      orgId,
      clientId,
      projectionId,
      responses: [{ questionId: "q1", questionText: "¿Nombre?", answer: "resp", serviceNames: [] }],
      status: "completed" as const,
      completedAt: Date.now(),
      createdAt: Date.now(),
    });
  });
}

describe("questionnaires.deleteQuestionnaire", () => {
  it("admin can delete; audit log inserted with eventType=deleted; doc gone", async () => {
    const t = setupTest();
    const qId = await seedQuestionnaire(t);

    await t
      .withIdentity(asUserOfOrg("org_a"))
      .mutation(api.functions.questionnaires.mutations.deleteQuestionnaire, { id: qId });

    await t.run(async (ctx) => {
      const q = await ctx.db.get(qId);
      expect(q).toBeNull();

      const events = await ctx.db
        .query("documentEvents")
        .withIndex("by_orgId_entityType_entityId", (q2) =>
          q2.eq("orgId", "org_a").eq("entityType", "questionnaire").eq("entityId", qId)
        )
        .collect();
      expect(events.length).toBeGreaterThan(0);
      expect(events.some((e) => e.eventType === "deleted")).toBe(true);
    });
  });

  it("non-admin (org:member) throws 'Acceso denegado'", async () => {
    const t = setupTest();
    const qId = await seedQuestionnaire(t);

    await expect(
      t
        .withIdentity(asUserOfOrg("org_a", "user_member_1", "org:member"))
        .mutation(api.functions.questionnaires.mutations.deleteQuestionnaire, { id: qId })
    ).rejects.toThrow("Acceso denegado. Se requiere rol de Administrador.");
  });

  it("cross-org throws 'no encontrado'", async () => {
    const t = setupTest();
    const qId = await seedQuestionnaire(t, "org_a");

    await expect(
      t
        .withIdentity(asUserOfOrg("org_other"))
        .mutation(api.functions.questionnaires.mutations.deleteQuestionnaire, { id: qId })
    ).rejects.toThrow(/no encontrado/i);
  });
});
