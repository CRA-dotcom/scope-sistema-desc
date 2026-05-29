import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { internal } from "../../../_generated/api";

describe("notifyFiscalCloseEvents pagination", () => {
  it("processes only active projections via by_orgId_status (skips draft)", async () => {
    const t = convexTest(schema);
    const now = new Date();
    const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
    const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

    await t.run(async (ctx) => {
      await ctx.db.insert("organizations", {
        clerkOrgId: "org_A", name: "Org A", status: "active",
        plan: "basic", createdAt: Date.now(),
      });
      const cId = await ctx.db.insert("clients", {
        orgId: "org_A", name: "C", rfc: "X", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      // Active fiscal projection — pretend its window just closed previous month.
      // startMonth chosen so that endMonth = prevMonth, monthCount=12.
      const startMonth = prevMonth === 12 ? 1 : prevMonth + 1;
      const startYear = prevMonth === 12 ? prevYear : prevYear - 1;
      await ctx.db.insert("projections", {
        orgId: "org_A", clientId: cId, year: startYear,
        annualSales: 0, totalBudget: 0, commissionRate: 0,
        seasonalityData: [], status: "active",
        startMonth, projectionMode: "fiscal", monthCount: 12,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      // Draft projection — should be SKIPPED regardless of fiscal close
      await ctx.db.insert("projections", {
        orgId: "org_A", clientId: cId, year: startYear,
        annualSales: 0, totalBudget: 0, commissionRate: 0,
        seasonalityData: [], status: "draft",
        startMonth, projectionMode: "fiscal", monthCount: 12,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
    });

    await t.mutation(internal.functions.projections.cron.notifyFiscalCloseEvents, {});

    const notifications = await t.run((ctx) =>
      ctx.db.query("notifications").collect()
    );

    // Get the draft projection IDs to verify NONE are referenced.
    const draftIds = await t.run(async (ctx) => {
      const drafts = await ctx.db
        .query("projections")
        .withIndex("by_orgId_status", (q) =>
          q.eq("orgId", "org_A").eq("status", "draft")
        )
        .collect();
      return drafts.map((d) => d._id);
    });
    for (const n of notifications) {
      expect(draftIds).not.toContain(n.relatedProjectionId);
    }
  });

  it("skips orgs whose status is not active", async () => {
    const t = convexTest(schema);
    const now = new Date();
    const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
    const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const startMonth = prevMonth === 12 ? 1 : prevMonth + 1;
    const startYear = prevMonth === 12 ? prevYear : prevYear - 1;

    await t.run(async (ctx) => {
      // Inactive org — its projection should NOT generate a notification
      await ctx.db.insert("organizations", {
        clerkOrgId: "org_inactive", name: "Org I", status: "inactive",
        plan: "basic", createdAt: Date.now(),
      });
      const cId = await ctx.db.insert("clients", {
        orgId: "org_inactive", name: "C", rfc: "X", industry: "S",
        annualRevenue: 0, billingFrequency: "mensual",
        isArchived: false, createdAt: Date.now(),
      });
      await ctx.db.insert("projections", {
        orgId: "org_inactive", clientId: cId, year: startYear,
        annualSales: 0, totalBudget: 0, commissionRate: 0,
        seasonalityData: [], status: "active",
        startMonth, projectionMode: "fiscal", monthCount: 12,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
    });

    await t.mutation(internal.functions.projections.cron.notifyFiscalCloseEvents, {});

    const notifications = await t.run((ctx) =>
      ctx.db.query("notifications").collect()
    );
    expect(notifications).toHaveLength(0);
  });
});
