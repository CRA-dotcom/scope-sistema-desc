import { describe, it, expect, vi, afterEach } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { api } from "../../../_generated/api";

const originalOps = process.env.OPS_NOTIFICATION_EMAIL;
afterEach(() => {
  if (originalOps) process.env.OPS_NOTIFICATION_EMAIL = originalOps;
  else delete process.env.OPS_NOTIFICATION_EMAIL;
});

function asUserOfOrg(orgId: string) {
  return {
    subject: `user|${orgId}`,
    issuer: "test",
    tokenIdentifier: `test|user|${orgId}`,
    orgId,
  };
}

async function seedSentQuestionnaire(t: ReturnType<typeof setupTest>) {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId: "org_a",
      name: "ACME",
      rfc: "AAA010101AAA",
      industry: "X",
      annualRevenue: 1_000_000,
      billingFrequency: "mensual" as const,
      isArchived: false,
      assignedTo: "user_exec_1",
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
    await ctx.db.insert("orgConfigs", {
      orgId: "org_a",
      calculationMode: "weighted" as const,
      commissionMode: "proportional" as const,
      seasonalityEnabled: true,
      featureFlags: {
        advancedConfigVisible: true,
        customServicesVisible: true,
        seasonalityEditable: true,
        manualOverrideAllowed: true,
      },
      notificationEmail: "responsable@empresa.com",
      updatedAt: Date.now(),
    });
    return await ctx.db.insert("questionnaireResponses", {
      orgId: "org_a",
      clientId,
      projectionId,
      responses: [],
      status: "sent" as const,
      createdAt: Date.now(),
    });
  });
}

async function seedSentQuestionnaireNoOrgConfig(
  t: ReturnType<typeof setupTest>
) {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId: "org_b",
      name: "Beta Corp",
      rfc: "BBB010101BBB",
      industry: "Y",
      annualRevenue: 500_000,
      billingFrequency: "mensual" as const,
      isArchived: false,
      assignedTo: "user_exec_2",
      createdAt: Date.now(),
    });
    const projectionId = await ctx.db.insert("projections", {
      orgId: "org_b",
      clientId,
      year: 2026,
      annualSales: 500_000,
      totalBudget: 50_000,
      commissionRate: 0,
      seasonalityData: [],
      status: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    // Intentionally NO orgConfigs row inserted — simulates unconfigured org.
    return await ctx.db.insert("questionnaireResponses", {
      orgId: "org_b",
      clientId,
      projectionId,
      responses: [],
      status: "sent" as const,
      createdAt: Date.now(),
    });
  });
}

describe("questionnaires.submit notification", () => {
  it("schedules the completed-notification to the org notificationEmail", async () => {
    const t = setupTest();
    const id = await seedSentQuestionnaire(t);

    await t
      .withIdentity(asUserOfOrg("org_a"))
      .mutation(api.functions.questionnaires.mutations.submit, { id });

    const scheduled = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect()
    );
    const tos = scheduled.map((s: any) => s.args?.[0]?.to);
    expect(tos).toContain("responsable@empresa.com");
  });

  it("does NOT schedule an email and warns when org has no notificationEmail and OPS_NOTIFICATION_EMAIL is unset", async () => {
    delete process.env.OPS_NOTIFICATION_EMAIL;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const t = setupTest();
    const id = await seedSentQuestionnaireNoOrgConfig(t);

    await t
      .withIdentity(asUserOfOrg("org_b"))
      .mutation(api.functions.questionnaires.mutations.submit, { id });

    const scheduled = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect()
    );
    expect(scheduled.length).toBe(0);
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });
});
