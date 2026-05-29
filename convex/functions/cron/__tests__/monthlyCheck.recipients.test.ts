import { describe, it, expect, vi } from "vitest";
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

/**
 * Seeds the data needed so that monthlyCheck.run actually reaches the
 * per-client reminder loop. In addition to client+projection+questionnaire,
 * we need a projectionServices row and a monthlyAssignments row for the
 * CURRENT month/year so that listAssignmentsForMonth returns a non-empty
 * result and clientProjectionPairs.length > 0 is satisfied.
 */
async function seedPendingWithCurrentMonthAssignment(
  t: ReturnType<typeof setupTest>,
  contactEmail?: string
) {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  return await t.run(async (ctx) => {
    // Required so listOrgIds (overdueCheck) returns "org_a" for the run handler.
    await ctx.db.insert("organizations", {
      clerkOrgId: "org_a",
      name: "Org A",
      status: "active" as const,
      plan: "basic",
      createdAt: Date.now(),
    });

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
      year: currentYear,
      annualSales: 1_000_000,
      totalBudget: 100_000,
      commissionRate: 0,
      seasonalityData: [],
      status: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // projectionServices requires a valid serviceId
    const serviceId = await ctx.db.insert("services", {
      name: "Contable",
      type: "base" as const,
      minPct: 0,
      maxPct: 100,
      defaultPct: 10,
      isDefault: true,
      sortOrder: 1,
    });

    const projServiceId = await ctx.db.insert("projectionServices", {
      orgId: "org_a",
      projectionId,
      serviceId,
      serviceName: "Contable",
      chosenPct: 10,
      isActive: true,
      annualAmount: 10_000,
      normalizedWeight: 1,
    });

    // monthlyAssignment for the current month/year, status "pending" — this
    // ensures listAssignmentsForMonth returns a row and clientProjectionPairs
    // is non-empty, so the action enters the per-client reminder loop.
    await ctx.db.insert("monthlyAssignments", {
      orgId: "org_a",
      projServiceId,
      projectionId,
      clientId,
      serviceName: "Contable",
      month: currentMonth,
      year: currentYear,
      amount: 833,
      feFactor: 1.0,
      status: "pending" as const,
      invoiceStatus: "not_invoiced" as const,
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
    // Seed a client with NO contactEmail, but WITH a current-month assignment
    // so the action actually reaches the per-client skip+count branch.
    await seedPendingWithCurrentMonthAssignment(t); // no contactEmail

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const summary = await t.action(
      internal.functions.cron.monthlyCheck.run,
      {}
    );

    expect(summary).toBeDefined();

    // No email scheduled — the skip branch ran instead of the send branch.
    const emails = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect()
    );
    expect(emails.length).toBe(0);

    // The skip+count branch executed and logged the omission warning.
    expect(warn).toHaveBeenCalled();
    const warnArgs = warn.mock.calls.flat().join(" ");
    expect(warnArgs).toContain("omitido");

    warn.mockRestore();
  });
});
