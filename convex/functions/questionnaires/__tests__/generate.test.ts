import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api } from "../../../_generated/api";
import { MASTER_QUESTIONS } from "../masterQuestionnaire";

// Helper: create a fake authenticated identity for an org.
function asUserOfOrg(orgId: string) {
  return {
    subject: `user|${orgId}`,
    issuer: "test",
    tokenIdentifier: `test|user|${orgId}`,
    orgId,
  };
}

function seasonalityFixture() {
  return Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    monthlySales: 10000,
    feFactor: 1,
  }));
}

async function seedProjection(t: ReturnType<typeof convexTest>, orgId: string) {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId,
      name: "Test Client",
      rfc: "TST010101ABC",
      industry: "Tecnología",
      annualRevenue: 1200000,
      billingFrequency: "mensual" as const,
      isArchived: false,
      createdAt: Date.now(),
    });

    const projectionId = await ctx.db.insert("projections", {
      orgId,
      clientId,
      year: 2026,
      annualSales: 120000,
      totalBudget: 60000,
      commissionRate: 0.05,
      seasonalityData: seasonalityFixture(),
      status: "draft" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const serviceId = await ctx.db.insert("services", {
      name: "Contable",
      type: "base" as const,
      minPct: 10,
      maxPct: 40,
      defaultPct: 25,
      isDefault: true,
      sortOrder: 1,
    });

    const serviceId2 = await ctx.db.insert("services", {
      name: "Marketing",
      type: "base" as const,
      minPct: 10,
      maxPct: 40,
      defaultPct: 25,
      isDefault: true,
      sortOrder: 2,
    });

    await ctx.db.insert("projectionServices", {
      orgId,
      projectionId,
      serviceId,
      serviceName: "Contable",
      chosenPct: 25,
      isActive: true,
      annualAmount: 30000,
      normalizedWeight: 0.5,
    });

    await ctx.db.insert("projectionServices", {
      orgId,
      projectionId,
      serviceId: serviceId2,
      serviceName: "Marketing",
      chosenPct: 25,
      isActive: true,
      annualAmount: 30000,
      normalizedWeight: 0.5,
    });

    return { projectionId, clientId };
  });
}

async function seedTemplate(
  t: ReturnType<typeof convexTest>,
  orgId: string,
  serviceName: string,
  variableKeys: string[]
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("deliverableTemplates", {
      orgId,
      serviceName,
      type: "deliverable_long" as const,
      name: `${serviceName} Template`,
      htmlTemplate: "<html></html>",
      variables: variableKeys.map((key) => ({
        key,
        label: key,
        source: "client" as const,
        required: false,
      })),
      version: 1,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  );
}

describe("questionnaires.generate (master questionnaire)", () => {
  it("creates one questionnaire with all applicable master questions", async () => {
    const t = convexTest(schema);
    const orgA = "org_A";
    const { projectionId } = await seedProjection(t, orgA);

    const id = await t
      .withIdentity(asUserOfOrg(orgA))
      .mutation(api.functions.questionnaires.mutations.generate, {
        projectionId,
      });

    const doc = await t.run((ctx) => ctx.db.get(id));
    expect(doc).not.toBeNull();
    // No question in the master is service-scoped today → all apply.
    expect(doc!.responses.length).toBe(MASTER_QUESTIONS.length);
  });

  it("populates section and subsection on each response", async () => {
    const t = convexTest(schema);
    const orgA = "org_A";
    const { projectionId } = await seedProjection(t, orgA);

    const id = await t
      .withIdentity(asUserOfOrg(orgA))
      .mutation(api.functions.questionnaires.mutations.generate, {
        projectionId,
      });
    const doc = await t.run((ctx) => ctx.db.get(id));
    for (const r of doc!.responses) {
      expect(r.section, `missing section on ${r.questionId}`).toBeDefined();
      expect(r.subsection, `missing subsection on ${r.questionId}`).toBeDefined();
    }
  });

  it("resolves templateVariableMappings for variableKey hits", async () => {
    const t = convexTest(schema);
    const orgA = "org_A";
    const { projectionId } = await seedProjection(t, orgA);

    // Marketing template knows company_rfc; Contable template knows company_industry.
    const mktTemplate = await seedTemplate(t, orgA, "Marketing", ["company_rfc"]);
    const ctTemplate = await seedTemplate(t, orgA, "Contable", ["company_industry"]);

    const id = await t
      .withIdentity(asUserOfOrg(orgA))
      .mutation(api.functions.questionnaires.mutations.generate, {
        projectionId,
      });
    const doc = await t.run((ctx) => ctx.db.get(id));

    const rfcQuestion = doc!.responses.find((r) => r.questionId === "company_rfc");
    const industryQuestion = doc!.responses.find((r) => r.questionId === "company_industry");

    expect(rfcQuestion!.templateVariableMappings).toEqual([
      { templateId: mktTemplate, variableName: "company_rfc" },
    ]);
    expect(industryQuestion!.templateVariableMappings).toEqual([
      { templateId: ctTemplate, variableName: "company_industry" },
    ]);
  });

  it("leaves templateVariableMappings undefined for questions without variableKey", async () => {
    const t = convexTest(schema);
    const orgA = "org_A";
    const { projectionId } = await seedProjection(t, orgA);

    const id = await t
      .withIdentity(asUserOfOrg(orgA))
      .mutation(api.functions.questionnaires.mutations.generate, {
        projectionId,
      });
    const doc = await t.run((ctx) => ctx.db.get(id));

    // history_origin has no variableKey
    const r = doc!.responses.find((r) => r.questionId === "history_origin");
    expect(r!.templateVariableMappings).toBeUndefined();
  });

  it("does not include templates from other orgs", async () => {
    const t = convexTest(schema);
    const orgA = "org_A";
    const orgB = "org_B";
    const { projectionId } = await seedProjection(t, orgA);
    // orgB has a template that would match company_rfc — must NOT leak into orgA's questionnaire.
    await seedTemplate(t, orgB, "Marketing", ["company_rfc"]);

    const id = await t
      .withIdentity(asUserOfOrg(orgA))
      .mutation(api.functions.questionnaires.mutations.generate, {
        projectionId,
      });
    const doc = await t.run((ctx) => ctx.db.get(id));
    const rfcQuestion = doc!.responses.find((r) => r.questionId === "company_rfc");
    // company_rfc has a variableKey, so the mutation always produces an array for it;
    // when no templates from this org match, the array is empty (not undefined).
    // The important thing is that orgB's template did NOT leak into orgA's result.
    expect(rfcQuestion!.templateVariableMappings).toEqual([]);
  });

  it("rejects when no active services exist", async () => {
    const t = convexTest(schema);
    const orgA = "org_A";
    const { projectionId } = await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: orgA,
        name: "Test",
        rfc: "TST010101XYZ",
        industry: "Comercio",
        annualRevenue: 500000,
        billingFrequency: "mensual" as const,
        isArchived: false,
        createdAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: orgA,
        clientId,
        year: 2026,
        annualSales: 60000,
        totalBudget: 30000,
        commissionRate: 0.05,
        seasonalityData: seasonalityFixture(),
        status: "draft" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return { projectionId };
    });

    await expect(
      t
        .withIdentity(asUserOfOrg(orgA))
        .mutation(api.functions.questionnaires.mutations.generate, {
          projectionId,
        })
    ).rejects.toThrow(/servicios activos/);
  });

  it("rejects when projection belongs to a different org", async () => {
    const t = convexTest(schema);
    const orgA = "org_A";
    const orgB = "org_B";
    const { projectionId } = await seedProjection(t, orgA);

    await expect(
      t
        .withIdentity(asUserOfOrg(orgB))
        .mutation(api.functions.questionnaires.mutations.generate, {
          projectionId,
        })
    ).rejects.toThrow(/Proyección no encontrada/);
  });
});
