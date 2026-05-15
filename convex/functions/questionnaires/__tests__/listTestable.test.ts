import { describe, it, expect } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { api } from "../../../_generated/api";

function asUserOfOrg(orgId: string, userSubject: string = `user|${orgId}`) {
  return {
    subject: userSubject,
    issuer: "test",
    tokenIdentifier: `test|${userSubject}`,
    orgId,
  };
}

async function seedQuestionnaireInOrg(
  t: ReturnType<typeof setupTest>,
  orgId: string,
  status: "draft" | "in_progress" | "completed" | "sent",
  clientName: string = "ACME"
) {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId,
      name: clientName,
      rfc: "AAA010101AAA",
      industry: "X",
      annualRevenue: 1_000_000,
      billingFrequency: "mensual" as const,
      isArchived: false,
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
      responses: [
        { questionId: "q1", questionText: "P1", answer: "R1", serviceNames: [] },
      ],
      status,
      createdAt: Date.now(),
    });
  });
}

describe("questionnaires.listTestable", () => {
  it("returns completed and in_progress responses for the current org", async () => {
    const t = setupTest();
    await seedQuestionnaireInOrg(t, "org_a", "completed", "Catimi");
    await seedQuestionnaireInOrg(t, "org_a", "in_progress", "Empresa Test");
    await seedQuestionnaireInOrg(t, "org_a", "draft", "Skip-Me");
    await seedQuestionnaireInOrg(t, "org_a", "sent", "Skip-Sent");

    const result = await t
      .withIdentity(asUserOfOrg("org_a"))
      .query(api.functions.questionnaires.queries.listTestable, {});

    expect(result).toHaveLength(2);
    const names = result.map((r) => r.clientName).sort();
    expect(names).toEqual(["Catimi", "Empresa Test"]);
  });

  it("excludes drafts and sent (no responses yet)", async () => {
    const t = setupTest();
    await seedQuestionnaireInOrg(t, "org_a", "draft");
    await seedQuestionnaireInOrg(t, "org_a", "sent");

    const result = await t
      .withIdentity(asUserOfOrg("org_a"))
      .query(api.functions.questionnaires.queries.listTestable, {});

    expect(result).toHaveLength(0);
  });

  it("multi-tenant isolation: org_b cannot see org_a's responses", async () => {
    const t = setupTest();
    await seedQuestionnaireInOrg(t, "org_a", "completed");

    const result = await t
      .withIdentity(asUserOfOrg("org_b"))
      .query(api.functions.questionnaires.queries.listTestable, {});

    expect(result).toHaveLength(0);
  });

  it("returns enriched fields: _id, clientName, projectionYear, status, responseCount", async () => {
    const t = setupTest();
    await seedQuestionnaireInOrg(t, "org_a", "completed", "Catimi");

    const result = await t
      .withIdentity(asUserOfOrg("org_a"))
      .query(api.functions.questionnaires.queries.listTestable, {});

    expect(result).toHaveLength(1);
    const row = result[0];
    expect(row._id).toBeDefined();
    expect(row.clientName).toBe("Catimi");
    expect(row.projectionYear).toBe(2026);
    expect(row.status).toBe("completed");
    expect(row.responseCount).toBe(1);
  });
});
