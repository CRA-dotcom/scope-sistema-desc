import { query } from "../../_generated/server";
import { v } from "convex/values";
import { requireSuperAdmin } from "../../lib/authHelpers";
import { monthStartMs } from "../../lib/date";

/**
 * D1 — Super-admin metrics queries.
 *
 * Per docs/superpowers/specs/2026-05-27-super-admin-panels-design.md §3.1
 *
 * Live queries (R1 §11 O9): no materialization. With <100 orgs and ~10K total
 * deliverables in beta, full `collect()` scans fit in the Convex query budget.
 * TODO post-beta (RD1): if rows grow >10K, materialize via `metricsDaily` cron.
 */

const MS_DAY = 24 * 60 * 60 * 1000;
const MS_30D = 30 * MS_DAY;

/**
 * Cross-org overview for `/platform/metrics`. Returns totals + per-org rollup
 * + 30-day deliverables timeseries. Non-super-admin callers get an empty
 * structure (NOT a throw) so SSR/reactivity doesn't error while Clerk loads.
 */
export const getOverviewAll = query({
  args: {},
  handler: async (ctx) => {
    try {
      await requireSuperAdmin(ctx);
    } catch {
      return {
        totals: {
          orgsActive: 0,
          deliverablesMonth: 0,
          quotationsMonth: 0,
          aiCostUsdMonth: 0,
          clientsTotal: 0,
        },
        perOrg: [],
        last30Days: [],
      };
    }

    const now = Date.now();
    const startOfMonth = monthStartMs();
    const thirtyDaysAgo = now - MS_30D;

    // 1. Active orgs.
    const orgs = await ctx.db
      .query("organizations")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    // 2. Deliverables — cross-org collect. RD1: monitor budget if growth >10K.
    const allDeliverables = await ctx.db.query("deliverables").collect();
    const deliverablesMonth = allDeliverables.filter(
      (d) => d.createdAt >= startOfMonth
    );
    const deliverables30d = allDeliverables.filter(
      (d) => d.createdAt >= thirtyDaysAgo
    );

    // 3. Quotations (pipeline signal).
    const allQuotations = await ctx.db.query("quotations").collect();
    const quotationsMonth = allQuotations.filter(
      (q) => q.createdAt >= startOfMonth
    );

    // 4. Clients — total (no archive filter so historical delta stays stable).
    const allClients = await ctx.db.query("clients").collect();

    // 5. Active subservices per org (org-scoped only; globals don't count as
    //    "usage" of any single org).
    const allSubservices = await ctx.db.query("subservices").collect();

    // 6. AI cost: sum aiLog[].costUsd per org for the month.
    const costUsdByOrg = new Map<string, number>();
    let aiCostUsdTotal = 0;
    for (const d of deliverablesMonth) {
      const log = d.aiLog ?? [];
      const orgCost = log.reduce(
        (acc, entry) => acc + (entry.costUsd ?? 0),
        0
      );
      costUsdByOrg.set(
        d.orgId,
        (costUsdByOrg.get(d.orgId) ?? 0) + orgCost
      );
      aiCostUsdTotal += orgCost;
    }

    // 7. Per-org rollup.
    const perOrg = orgs
      .map((org) => {
        const clientsOfOrg = allClients.filter(
          (c) => c.orgId === org.clerkOrgId
        );
        const delivOfOrg = deliverablesMonth.filter(
          (d) => d.orgId === org.clerkOrgId
        );
        const subsOfOrg = allSubservices.filter(
          (s) => s.orgId === org.clerkOrgId && s.isActive
        );
        const lastDeliv = allDeliverables
          .filter((d) => d.orgId === org.clerkOrgId)
          .sort((a, b) => b.createdAt - a.createdAt)[0];
        return {
          orgId: org.clerkOrgId,
          name: org.name,
          plan: org.plan,
          clientsCount: clientsOfOrg.length,
          deliverablesMonth: delivOfOrg.length,
          aiCostUsdMonth: costUsdByOrg.get(org.clerkOrgId) ?? 0,
          activeSubservices: subsOfOrg.length,
          lastActivityMs: lastDeliv?.createdAt ?? null,
        };
      })
      .sort((a, b) => b.deliverablesMonth - a.deliverablesMonth);

    // 8. last30Days timeseries (one bucket per UTC day).
    const buckets = new Map<number, number>();
    for (let i = 0; i < 30; i++) {
      const dayStart = now - i * MS_DAY;
      const d = new Date(dayStart);
      d.setUTCHours(0, 0, 0, 0);
      buckets.set(d.getTime(), 0);
    }
    for (const d of deliverables30d) {
      const day = new Date(d.createdAt);
      day.setUTCHours(0, 0, 0, 0);
      const key = day.getTime();
      if (buckets.has(key)) buckets.set(key, buckets.get(key)! + 1);
    }
    const last30Days = Array.from(buckets.entries())
      .map(([dateMs, deliverables]) => ({ dateMs, deliverables }))
      .sort((a, b) => a.dateMs - b.dateMs);

    return {
      totals: {
        orgsActive: orgs.length,
        deliverablesMonth: deliverablesMonth.length,
        quotationsMonth: quotationsMonth.length,
        aiCostUsdMonth: aiCostUsdTotal,
        clientsTotal: allClients.length,
      },
      perOrg,
      last30Days,
    };
  },
});

/**
 * Single-org drill-down for `/platform/orgs/[id]?tab=metrics`. Non-super-admin
 * callers receive `null` (NOT a throw) so the tab renders an empty state.
 */
export const getOrgDetails = query({
  args: { orgId: v.string() },
  handler: async (ctx, args) => {
    try {
      await requireSuperAdmin(ctx);
    } catch {
      return null;
    }

    const org = await ctx.db
      .query("organizations")
      .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", args.orgId))
      .unique();
    if (!org) return null;

    const startOfMonth = monthStartMs();

    const deliverables = await ctx.db
      .query("deliverables")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .collect();
    const deliverablesMonth = deliverables.filter(
      (d) => d.createdAt >= startOfMonth
    );

    // Top clients by deliverables this month.
    const byClient = new Map<string, { count: number; cost: number }>();
    for (const d of deliverablesMonth) {
      const entry = byClient.get(d.clientId) ?? { count: 0, cost: 0 };
      entry.count += 1;
      entry.cost += (d.aiLog ?? []).reduce(
        (acc, e) => acc + (e.costUsd ?? 0),
        0
      );
      byClient.set(d.clientId, entry);
    }

    const clients = await ctx.db
      .query("clients")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .collect();
    const clientName = new Map(
      clients.map((c) => [c._id as string, c.name])
    );

    const topClients = Array.from(byClient.entries())
      .map(([clientId, agg]) => ({
        clientId,
        clientName: clientName.get(clientId) ?? "(cliente borrado)",
        deliverablesMonth: agg.count,
        aiCostUsdMonth: agg.cost,
      }))
      .sort((a, b) => b.deliverablesMonth - a.deliverablesMonth)
      .slice(0, 10);

    // Distribution by subservice (concentration signal).
    const bySubservice = new Map<string, number>();
    for (const d of deliverablesMonth) {
      const key = (d.subserviceId as string | undefined) ?? d.serviceName ?? "unknown";
      bySubservice.set(key, (bySubservice.get(key) ?? 0) + 1);
    }

    return {
      org: {
        id: org._id,
        name: org.name,
        plan: org.plan,
        status: org.status,
        createdAt: org.createdAt,
      },
      monthTotals: {
        deliverables: deliverablesMonth.length,
        aiCostUsd: deliverablesMonth.reduce(
          (acc, d) =>
            acc +
            (d.aiLog ?? []).reduce((a, e) => a + (e.costUsd ?? 0), 0),
          0
        ),
        clientsActive: clients.filter((c) => !c.isArchived).length,
      },
      topClients,
      distributionBySubservice: Array.from(bySubservice.entries()).map(
        ([key, count]) => ({ key, count })
      ),
    };
  },
});
