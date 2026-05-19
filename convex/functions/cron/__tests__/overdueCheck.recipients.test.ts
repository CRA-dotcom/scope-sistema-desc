import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { internal } from "../../../_generated/api";

const originalOps = process.env.OPS_NOTIFICATION_EMAIL;

describe("overdueCheck recipient resolution", () => {
  beforeEach(() => {
    delete process.env.OPS_NOTIFICATION_EMAIL;
    vi.restoreAllMocks();
  });
  afterEach(() => {
    if (originalOps) process.env.OPS_NOTIFICATION_EMAIL = originalOps;
    else delete process.env.OPS_NOTIFICATION_EMAIL;
  });

  async function seedOverdue(
    t: ReturnType<typeof setupTest>,
    orgId: string,
    notificationEmail?: string
  ) {
    await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId,
        name: "ACME",
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
      const serviceId = await ctx.db.insert("services", {
        orgId,
        name: "Contable",
        type: "base" as const,
        minPct: 0,
        maxPct: 100,
        defaultPct: 10,
        isDefault: true,
        sortOrder: 1,
      });
      const projServiceId = await ctx.db.insert("projectionServices", {
        orgId,
        projectionId,
        serviceId,
        serviceName: "Contable",
        chosenPct: 10,
        isActive: true,
        annualAmount: 10_000,
        normalizedWeight: 1,
      });
      await ctx.db.insert("monthlyAssignments", {
        orgId,
        clientId,
        projectionId,
        projServiceId,
        serviceName: "Contable",
        month: 1,
        year: 2020,
        amount: 833,
        feFactor: 1,
        status: "pending" as const,
        invoiceStatus: "not_invoiced" as const,
      });
      if (notificationEmail !== undefined) {
        await ctx.db.insert("orgConfigs", {
          orgId,
          calculationMode: "weighted" as const,
          commissionMode: "proportional" as const,
          seasonalityEnabled: true,
          featureFlags: {
            advancedConfigVisible: true,
            customServicesVisible: true,
            seasonalityEditable: true,
            manualOverrideAllowed: true,
          },
          notificationEmail,
          updatedAt: Date.now(),
        });
      }
    });
  }

  it("sends the overdue alert to the org notificationEmail", async () => {
    const t = setupTest();
    await seedOverdue(t, "org_a", "responsable@empresa.com");

    await t.action(internal.functions.cron.overdueCheck.run, {});

    const emails = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect()
    );
    const args = emails.map((e: any) => e.args?.[0]);
    expect(args.some((a: any) => a?.to === "responsable@empresa.com")).toBe(
      true
    );
  });

  it("skips + warns when no recipient is resolvable", async () => {
    const t = setupTest();
    await seedOverdue(t, "org_a"); // no orgConfig, no env
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await t.action(internal.functions.cron.overdueCheck.run, {});

    const emails = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect()
    );
    expect(emails.length).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
