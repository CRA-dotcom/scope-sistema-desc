import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setupTest, ORG_A } from "../../../../tests/harness";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

/**
 * Tests for `deliverableEligibility.run` (R1 §12.9 — NEVER generates).
 * Asserts:
 *  - Notifies only clients with eligible (subservice, month) and no paid invoice / existing deliverable.
 *  - Cap 1 reminder/client/24h via documentEvents lookback.
 */

async function seedOrgAndClient(
  t: ReturnType<typeof setupTest>,
  opts: {
    orgId: string;
    notificationEmail?: string;
    clientName?: string;
  }
): Promise<{
  clientId: Id<"clients">;
  projectionId: Id<"projections">;
  projServiceId: Id<"projectionServices">;
  subserviceId: Id<"subservices">;
}> {
  return await t.run(async (ctx) => {
    await ctx.db.insert("organizations", {
      clerkOrgId: opts.orgId,
      name: `Org-${opts.orgId}`,
      status: "active" as const,
      plan: "basic" as const,
      createdAt: Date.now(),
    });
    if (opts.notificationEmail) {
      await ctx.db.insert("orgConfigs", {
        orgId: opts.orgId,
        calculationMode: "weighted" as const,
        commissionMode: "proportional" as const,
        seasonalityEnabled: false,
        featureFlags: {
          advancedConfigVisible: true,
          customServicesVisible: true,
          seasonalityEditable: false,
          manualOverrideAllowed: true,
        },
        notificationEmail: opts.notificationEmail,
        updatedAt: Date.now(),
      });
    }
    const clientId = await ctx.db.insert("clients", {
      orgId: opts.orgId,
      name: opts.clientName ?? "Cliente Test",
      rfc: "TST240115ABC",
      industry: "x",
      annualRevenue: 1,
      billingFrequency: "mensual" as const,
      isArchived: false,
      createdAt: Date.now(),
    });
    const projectionId = await ctx.db.insert("projections", {
      orgId: opts.orgId,
      clientId,
      year: new Date().getFullYear(),
      annualSales: 1,
      totalBudget: 1,
      commissionRate: 0,
      seasonalityData: [],
      status: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const serviceId = await ctx.db.insert("services", {
      orgId: opts.orgId,
      name: "Marketing",
      type: "base" as const,
      minPct: 0.1,
      maxPct: 0.3,
      defaultPct: 0.18,
      isDefault: true,
      sortOrder: 1,
    });
    const subserviceId = await ctx.db.insert("subservices", {
      orgId: opts.orgId,
      parentServiceId: serviceId,
      name: "Boletín",
      slug: "boletin",
      defaultFrequency: "mensual" as const,
      isActive: true,
      isDefault: true,
      sortOrder: 10,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const projServiceId = await ctx.db.insert("projectionServices", {
      orgId: opts.orgId,
      projectionId,
      serviceId,
      serviceName: "Marketing",
      subserviceId,
      chosenPct: 0.18,
      isActive: true,
      annualAmount: 1,
      normalizedWeight: 0,
    });
    // Template so selector returns a match.
    await ctx.db.insert("deliverableTemplates", {
      orgId: opts.orgId,
      serviceName: "Marketing",
      subserviceId,
      type: "deliverable_short" as const,
      name: "tpl",
      htmlTemplate: "<p/>",
      variables: [],
      version: 1,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { clientId, projectionId, projServiceId, subserviceId };
  });
}

const originalOps = process.env.OPS_NOTIFICATION_EMAIL;

beforeEach(() => {
  delete process.env.OPS_NOTIFICATION_EMAIL;
  vi.useFakeTimers();
  // Pin to a weekday (Wed 2026-05-20 17:00 UTC ≈ 11:00 CDMX Wed).
  vi.setSystemTime(new Date("2026-05-20T17:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  if (originalOps) process.env.OPS_NOTIFICATION_EMAIL = originalOps;
  else delete process.env.OPS_NOTIFICATION_EMAIL;
});

describe("cron.deliverableEligibility.run", () => {
  it("only notifies clients without paid invoice / existing deliverable", async () => {
    const t = setupTest();
    // Client A: eligible, no invoice, no deliverable.
    const a = await seedOrgAndClient(t, {
      orgId: ORG_A,
      notificationEmail: "ops@org-a.test",
      clientName: "Cliente A",
    });
    // Client B (same org): also seeded, but has a paid invoice for current month.
    const b = await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: ORG_A,
        name: "Cliente B",
        rfc: "BBB240115ABC",
        industry: "x",
        annualRevenue: 1,
        billingFrequency: "mensual" as const,
        isArchived: false,
        createdAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: ORG_A,
        clientId,
        year: new Date().getFullYear(),
        annualSales: 1,
        totalBudget: 1,
        commissionRate: 0,
        seasonalityData: [],
        status: "active" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      // Reuse the existing service/subservice from client A's seed via lookup.
      const services = await ctx.db.query("services").collect();
      const subservices = await ctx.db.query("subservices").collect();
      const projServiceId = await ctx.db.insert("projectionServices", {
        orgId: ORG_A,
        projectionId,
        serviceId: services[0]._id,
        serviceName: "Marketing",
        subserviceId: subservices[0]._id,
        chosenPct: 0.18,
        isActive: true,
        annualAmount: 1,
        normalizedWeight: 0,
      });
      // Paid invoice for current month + subservice.
      const now = new Date();
      await ctx.db.insert("invoices", {
        orgId: ORG_A,
        clientId,
        projectionId,
        projServiceId,
        subserviceId: subservices[0]._id,
        serviceName: "Marketing",
        month: now.getUTCMonth() + 1,
        year: now.getUTCFullYear(),
        amount: 1,
        bucketKey: "x.pdf",
        contentType: "application/pdf",
        sizeBytes: 1,
        filename: "f.pdf",
        status: "paid" as const,
        uploadedAt: Date.now(),
        uploadedBy: "u",
        paidAt: Date.now(),
        paidBy: "u",
        createdAt: Date.now(),
      });
      return { clientId };
    });

    const result = (await t.action(
      internal.functions.cron.deliverableEligibility.run,
      {}
    )) as { totalReminders: number; orgsScanned: number };

    expect(result.orgsScanned).toBe(1);
    expect(result.totalReminders).toBe(1);

    const events = await t.run(async (ctx) =>
      ctx.db.query("documentEvents").collect()
    );
    const reminders = events.filter((e) => e.eventType === "reminder_sent");
    expect(reminders.length).toBe(1);
    expect(reminders[0].clientId).toBe(a.clientId);
    // No reminder for client B.
    expect(reminders.find((r) => r.clientId === b.clientId)).toBeUndefined();
  });

  it("cap 1 email/client/day: a recent reminder_sent (2h ago) suppresses today's", async () => {
    const t = setupTest();
    const a = await seedOrgAndClient(t, {
      orgId: ORG_A,
      notificationEmail: "ops@org-a.test",
    });

    // Insert a recent reminder_sent (2h ago) for this client.
    await t.run(async (ctx) =>
      ctx.db.insert("documentEvents", {
        orgId: ORG_A,
        clientId: a.clientId,
        entityType: "deliverable" as const,
        entityId: "x",
        eventType: "reminder_sent" as const,
        severity: "info" as const,
        actorType: "cron" as const,
        message: "test",
        createdAt: Date.now() - 2 * 60 * 60 * 1000,
      })
    );

    const result = (await t.action(
      internal.functions.cron.deliverableEligibility.run,
      {}
    )) as { totalReminders: number; totalSkipped: number };

    expect(result.totalReminders).toBe(0);
    expect(result.totalSkipped).toBe(1);
  });
});
