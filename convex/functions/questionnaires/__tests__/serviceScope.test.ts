/**
 * Isolated test for serviceScope filtering in the generate mutation.
 *
 * The real MASTER_QUESTIONS currently has no entries with `serviceScope`,
 * so the filtering code path is untested by generate.test.ts. This file
 * mocks the masterQuestionnaire module to inject a synthetic seed with
 * scoped + unscoped entries and asserts the filter excludes/includes
 * correctly based on active service names.
 */
import { describe, it, expect, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api } from "../../../_generated/api";

// IMPORTANT: vi.mock is hoisted by vitest — it must be at module top-level.
// We replace MASTER_QUESTIONS with a synthetic 3-entry array.
vi.mock("../masterQuestionnaire", () => ({
  MASTER_QUESTIONS: [
    {
      key: "q_all",
      section: "1. Test",
      subsection: "1.1 Test",
      text: "Applies to all services",
      type: "text",
    },
    {
      key: "q_marketing_only",
      section: "1. Test",
      subsection: "1.1 Test",
      text: "Applies only to Marketing",
      type: "text",
      serviceScope: ["Marketing"],
    },
    {
      key: "q_contable_only",
      section: "1. Test",
      subsection: "1.1 Test",
      text: "Applies only to Contable",
      type: "text",
      serviceScope: ["Contable"],
    },
  ],
}));

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

async function seedProjection(
  t: ReturnType<typeof convexTest>,
  orgId: string,
  services: string[]
) {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId,
      name: "Test Client",
      rfc: "TEST010101XYZ",
      industry: "Test",
      annualRevenue: 1000000,
      billingFrequency: "mensual" as const,
      isArchived: false,
      createdAt: Date.now(),
    });
    const projectionId = await ctx.db.insert("projections", {
      orgId,
      clientId,
      year: 2026,
      annualSales: 1000000,
      totalBudget: 100000,
      commissionRate: 0.1,
      seasonalityData: seasonalityFixture(),
      status: "draft" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    for (const serviceName of services) {
      const serviceId = await ctx.db.insert("services", {
        name: serviceName,
        type: "base" as const,
        minPct: 0,
        maxPct: 1,
        defaultPct: 0.1,
        isDefault: false,
        sortOrder: 1,
      });
      await ctx.db.insert("projectionServices", {
        orgId,
        projectionId,
        serviceId,
        serviceName,
        chosenPct: 0.1,
        isActive: true,
        annualAmount: 100000,
        normalizedWeight: 0.5,
      });
    }
    return { projectionId, clientId };
  });
}

describe("generate — serviceScope filtering", () => {
  it("includes all unscoped questions plus only the scoped questions matching active services", async () => {
    const t = convexTest(schema);
    const orgA = "org_A";
    // Only Marketing is active — Contable-scoped question should be excluded.
    const { projectionId } = await seedProjection(t, orgA, ["Marketing"]);

    const id = await t
      .withIdentity(asUserOfOrg(orgA))
      .mutation(api.functions.questionnaires.mutations.generate, {
        projectionId,
      });
    const doc = await t.run((ctx) => ctx.db.get(id));
    const keys = doc!.responses.map((r) => r.questionId);

    expect(keys).toContain("q_all");
    expect(keys).toContain("q_marketing_only");
    expect(keys).not.toContain("q_contable_only");
    expect(keys.length).toBe(2);
  });

  it("excludes a scoped question when its scope's service is not active", async () => {
    const t = convexTest(schema);
    const orgA = "org_A";
    // Only Contable active — Marketing-scoped question should be excluded.
    const { projectionId } = await seedProjection(t, orgA, ["Contable"]);

    const id = await t
      .withIdentity(asUserOfOrg(orgA))
      .mutation(api.functions.questionnaires.mutations.generate, {
        projectionId,
      });
    const doc = await t.run((ctx) => ctx.db.get(id));
    const keys = doc!.responses.map((r) => r.questionId);

    expect(keys).toContain("q_all");
    expect(keys).toContain("q_contable_only");
    expect(keys).not.toContain("q_marketing_only");
    expect(keys.length).toBe(2);
  });

  it("includes both scoped questions when both their scopes' services are active", async () => {
    const t = convexTest(schema);
    const orgA = "org_A";
    const { projectionId } = await seedProjection(t, orgA, ["Marketing", "Contable"]);

    const id = await t
      .withIdentity(asUserOfOrg(orgA))
      .mutation(api.functions.questionnaires.mutations.generate, {
        projectionId,
      });
    const doc = await t.run((ctx) => ctx.db.get(id));
    const keys = doc!.responses.map((r) => r.questionId);

    expect(keys).toContain("q_all");
    expect(keys).toContain("q_marketing_only");
    expect(keys).toContain("q_contable_only");
    expect(keys.length).toBe(3);
  });
});
