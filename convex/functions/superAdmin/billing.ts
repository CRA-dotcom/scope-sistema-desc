import { query } from "../../_generated/server";
import { v } from "convex/values";
import { requireSuperAdmin } from "../../lib/authHelpers";

/**
 * D1 — Super-admin billing query (read-only).
 *
 * Per docs/superpowers/specs/2026-05-27-super-admin-panels-design.md §3.2
 * R1 §11 O10: info-only in beta; no Stripe / no invoice emission. Super-admin
 * reads the numbers, charges out-of-band.
 */

// Soft per-plan caps. Beta hardcoded.
// TODO post-beta (RD3): move to a `plans` table editable from `/platform`.
const PLAN_CAPS: Record<
  string,
  { deliverablesMonth: number; clientsTotal: number }
> = {
  basic: { deliverablesMonth: 50, clientsTotal: 5 },
  pro: { deliverablesMonth: 200, clientsTotal: 25 },
  enterprise: { deliverablesMonth: 999, clientsTotal: 999 },
};

// Claude USD → MXN conversion (audit only). FX ref 2026-05.
// TODO post-beta: pull from a live FX feed or org pricing config.
const USD_TO_MXN = 17.5;

// MXN suggested billable per deliverable (what the despacho charges its client).
// TODO post-beta: read from `organizations.pricingPerDeliverable` or `plans`.
const SUGGESTED_PRICE_MXN_PER_DELIVERABLE = 850;

export const getUsage = query({
  args: { orgId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    try {
      await requireSuperAdmin(ctx);
    } catch {
      return { rows: [] };
    }

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const monthStartMs = monthStart.getTime();

    let orgs;
    if (args.orgId) {
      const single = await ctx.db
        .query("organizations")
        .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", args.orgId!))
        .unique();
      orgs = single ? [single] : [];
    } else {
      orgs = await ctx.db.query("organizations").collect();
    }

    const allDeliverables = await ctx.db.query("deliverables").collect();
    const allClients = await ctx.db.query("clients").collect();

    const rows = orgs.map((org) => {
      const delivMonth = allDeliverables.filter(
        (d) => d.orgId === org.clerkOrgId && d.createdAt >= monthStartMs
      );
      const clientsActive = allClients.filter(
        (c) => c.orgId === org.clerkOrgId && !c.isArchived
      );
      const aiCostUsd = delivMonth.reduce(
        (acc, d) =>
          acc + (d.aiLog ?? []).reduce((a, e) => a + (e.costUsd ?? 0), 0),
        0
      );
      const aiCostMxn = aiCostUsd * USD_TO_MXN;
      const billableMxn =
        delivMonth.length * SUGGESTED_PRICE_MXN_PER_DELIVERABLE;
      const caps = PLAN_CAPS[org.plan] ?? PLAN_CAPS.basic;
      const deliverablesPct = Math.min(
        100,
        Math.round((delivMonth.length / caps.deliverablesMonth) * 100)
      );
      const clientsPct = Math.min(
        100,
        Math.round((clientsActive.length / caps.clientsTotal) * 100)
      );

      // Status heuristic (signal-only; not enforcement).
      let status: "al_dia" | "por_cobrar" | "sobre_limite" = "al_dia";
      if (delivMonth.length > caps.deliverablesMonth) status = "sobre_limite";
      else if (billableMxn > 0) status = "por_cobrar";

      return {
        orgId: org.clerkOrgId,
        orgName: org.name,
        plan: org.plan,
        status,
        deliverablesMonth: delivMonth.length,
        deliverablesCap: caps.deliverablesMonth,
        deliverablesPct,
        clientsActive: clientsActive.length,
        clientsCap: caps.clientsTotal,
        clientsPct,
        billableMxn,
        aiCostUsd,
        aiCostMxn,
        marginMxn: billableMxn - aiCostMxn,
      };
    });

    return { rows: rows.sort((a, b) => b.billableMxn - a.billableMxn) };
  },
});
