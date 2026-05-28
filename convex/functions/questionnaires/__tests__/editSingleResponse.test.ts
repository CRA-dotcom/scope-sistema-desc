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
      responses: [
        { questionId: "q1", questionText: "¿Nombre empresa?", answer: "Vieja respuesta", serviceNames: [] },
        { questionId: "q2", questionText: "¿RFC?", answer: "AAA010101AAA", serviceNames: [] },
      ],
      status: "completed" as const,
      completedAt: Date.now(),
      createdAt: Date.now(),
    });
  });
}

describe("questionnaires.editSingleResponse", () => {
  it("edit on completed questionnaire works; specific response updated; audit logged", async () => {
    const t = setupTest();
    const qId = await seedCompletedQuestionnaire(t);

    await t
      .withIdentity(asUserOfOrg("org_a"))
      .mutation(api.functions.questionnaires.mutations.editSingleResponse, {
        id: qId,
        questionId: "q1",
        answer: "Nueva respuesta",
      });

    await t.run(async (ctx) => {
      const q = await ctx.db.get(qId);
      expect(q).not.toBeNull();
      expect(q?.status).toBe("completed"); // status unchanged

      const updated = q?.responses.find((r) => r.questionId === "q1");
      expect(updated?.answer).toBe("Nueva respuesta");

      const untouched = q?.responses.find((r) => r.questionId === "q2");
      expect(untouched?.answer).toBe("AAA010101AAA"); // other answers untouched

      const events = await ctx.db
        .query("documentEvents")
        .withIndex("by_orgId_entityType_entityId", (q2) =>
          q2.eq("orgId", "org_a").eq("entityType", "questionnaire").eq("entityId", qId)
        )
        .collect();
      expect(events.some((e) => e.eventType === "updated")).toBe(true);
      const updatedEvent = events.find((e) => e.eventType === "updated");
      expect(updatedEvent?.message).toContain("q1");
    });
  });

  it("non-admin throws", async () => {
    const t = setupTest();
    const qId = await seedCompletedQuestionnaire(t);

    await expect(
      t
        .withIdentity(asUserOfOrg("org_a", "user_member_1", "org:member"))
        .mutation(api.functions.questionnaires.mutations.editSingleResponse, {
          id: qId,
          questionId: "q1",
          answer: "hack",
        })
    ).rejects.toThrow("Acceso denegado. Se requiere rol de Administrador.");
  });
});
