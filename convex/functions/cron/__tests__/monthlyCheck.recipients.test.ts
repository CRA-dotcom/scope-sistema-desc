import { describe, it, expect } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { internal } from "../../../_generated/api";

async function seedPending(
  t: ReturnType<typeof setupTest>,
  contactEmail?: string
) {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId: "org_a",
      name: "ACME",
      rfc: "AAA010101AAA",
      industry: "X",
      annualRevenue: 1_000_000,
      billingFrequency: "mensual" as const,
      isArchived: false,
      contactEmail,
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
    await ctx.db.insert("questionnaireResponses", {
      orgId: "org_a",
      clientId,
      projectionId,
      responses: [],
      status: "sent" as const,
      createdAt: Date.now(),
    });
    return { clientId, projectionId };
  });
}

describe("monthlyCheck.listPendingQuestionnaires contactEmail", () => {
  it("includes the client's contactEmail in the result", async () => {
    const t = setupTest();
    const { clientId, projectionId } = await seedPending(
      t,
      "cliente@empresa.com"
    );

    const result = await t.query(
      internal.functions.cron.monthlyCheck.listPendingQuestionnaires,
      {
        clientProjectionPairs: [
          { clientId, projectionId, serviceName: "Contable" },
        ],
      }
    );

    expect(result).toHaveLength(1);
    expect(result[0].contactEmail).toBe("cliente@empresa.com");
    expect(result[0].clientName).toBe("ACME");
  });

  it("returns contactEmail undefined when the client has none", async () => {
    const t = setupTest();
    const { clientId, projectionId } = await seedPending(t);

    const result = await t.query(
      internal.functions.cron.monthlyCheck.listPendingQuestionnaires,
      {
        clientProjectionPairs: [
          { clientId, projectionId, serviceName: "Contable" },
        ],
      }
    );

    expect(result).toHaveLength(1);
    expect(result[0].contactEmail).toBeUndefined();
  });
});

describe("monthlyCheck.run reminder dispatch", () => {
  it("does not throw and skips clients without contactEmail", async () => {
    const t = setupTest();
    await seedPending(t); // no contactEmail
    const summary = await t.action(
      internal.functions.cron.monthlyCheck.run,
      {}
    );
    expect(summary).toBeDefined();
    const emails = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect()
    );
    expect(emails.length).toBe(0);
  });
});
