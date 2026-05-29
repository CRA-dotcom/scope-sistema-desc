import { describe, it, expect } from "vitest";
import { setupTest, ORG_A } from "../../../../tests/harness";
import { api } from "../../../_generated/api";

function asUserOfOrg(orgId: string, userId = "user_1") {
  return {
    subject: userId,
    issuer: "test",
    tokenIdentifier: `test|user|${orgId}`,
    orgId,
    orgRole: "org:admin",
  };
}

async function seedQuestionnaire(
  t: ReturnType<typeof setupTest>,
  status: "draft" | "sent" | "in_progress" | "completed"
) {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId: ORG_A, name: "C", rfc: "X", industry: "S",
      annualRevenue: 0, billingFrequency: "mensual" as const,
      isArchived: false, createdAt: Date.now(),
    });
    const projectionId = await ctx.db.insert("projections", {
      orgId: ORG_A, clientId, year: 2026,
      annualSales: 0, totalBudget: 0, commissionRate: 0,
      seasonalityData: [], status: "active" as const,
      createdAt: Date.now(), updatedAt: Date.now(),
    });
    return await ctx.db.insert("questionnaireResponses", {
      orgId: ORG_A, clientId, projectionId,
      responses: [],
      status,
      createdAt: Date.now(),
    });
  });
}

describe("questionnaireResponses.updateStatus guards", () => {
  it("allows draft → sent", async () => {
    const t = setupTest();
    const id = await seedQuestionnaire(t, "draft");
    await t
      .withIdentity(asUserOfOrg(ORG_A))
      .mutation(api.functions.questionnaires.mutations.updateStatus, {
        id, status: "sent",
      });
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.status).toBe("sent");
  });

  it("allows sent → in_progress", async () => {
    const t = setupTest();
    const id = await seedQuestionnaire(t, "sent");
    await t
      .withIdentity(asUserOfOrg(ORG_A))
      .mutation(api.functions.questionnaires.mutations.updateStatus, {
        id, status: "in_progress",
      });
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.status).toBe("in_progress");
  });

  it("allows in_progress → completed (set completedAt)", async () => {
    const t = setupTest();
    const id = await seedQuestionnaire(t, "in_progress");
    await t
      .withIdentity(asUserOfOrg(ORG_A))
      .mutation(api.functions.questionnaires.mutations.updateStatus, {
        id, status: "completed",
      });
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.status).toBe("completed");
    expect(after?.completedAt).toBeGreaterThan(0);
  });

  it("allows draft → in_progress (cliente empieza sin send explícito)", async () => {
    const t = setupTest();
    const id = await seedQuestionnaire(t, "draft");
    await t
      .withIdentity(asUserOfOrg(ORG_A))
      .mutation(api.functions.questionnaires.mutations.updateStatus, {
        id, status: "in_progress",
      });
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.status).toBe("in_progress");
  });

  it("is idempotent (completed → completed no throw)", async () => {
    const t = setupTest();
    const id = await seedQuestionnaire(t, "completed");
    const result = await t
      .withIdentity(asUserOfOrg(ORG_A))
      .mutation(api.functions.questionnaires.mutations.updateStatus, {
        id, status: "completed",
      });
    expect(result).toBeNull();
  });

  it("throws INVALID_TRANSITION on completed → in_progress (debe ir por reopen)", async () => {
    const t = setupTest();
    const id = await seedQuestionnaire(t, "completed");
    await expect(
      t
        .withIdentity(asUserOfOrg(ORG_A))
        .mutation(api.functions.questionnaires.mutations.updateStatus, {
          id, status: "in_progress",
        })
    ).rejects.toThrow(/INVALID_TRANSITION|completed.*in_progress/i);
  });

  it("throws INVALID_TRANSITION on sent → draft (reversa)", async () => {
    const t = setupTest();
    const id = await seedQuestionnaire(t, "sent");
    await expect(
      t
        .withIdentity(asUserOfOrg(ORG_A))
        .mutation(api.functions.questionnaires.mutations.updateStatus, {
          id, status: "draft",
        })
    ).rejects.toThrow(/INVALID_TRANSITION|sent.*draft/i);
  });

  it("throws INVALID_TRANSITION on draft → completed (saltó in_progress)", async () => {
    const t = setupTest();
    const id = await seedQuestionnaire(t, "draft");
    await expect(
      t
        .withIdentity(asUserOfOrg(ORG_A))
        .mutation(api.functions.questionnaires.mutations.updateStatus, {
          id, status: "completed",
        })
    ).rejects.toThrow(/INVALID_TRANSITION|draft.*completed/i);
  });
});
