import { query } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgIdSafe } from "../../lib/authHelpers";

/**
 * S7-07: Financial summary for dashboard charts.
 * Returns monthly totals (projected sales vs service payments) for bar chart.
 */
export const financialSummary = query({
  args: {
    year: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    const year = args.year ?? new Date().getFullYear();

    // Get all active projections for the year
    const projections = await ctx.db
      .query("projections")
      .withIndex("by_orgId_year", (q) => q.eq("orgId", orgId).eq("year", year))
      .collect();

    // Get all monthly assignments for the year
    const assignments = await ctx.db
      .query("monthlyAssignments")
      .withIndex("by_orgId_year_month", (q) =>
        q.eq("orgId", orgId).eq("year", year)
      )
      .collect();

    // Build per-month summary
    const months = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;

      // Sum projected sales from seasonality data across all active projections
      const projectedSales = projections
        .filter((p) => p.status === "active")
        .reduce((sum, p) => {
          const monthData = p.seasonalityData.find((s) => s.month === month);
          return sum + (monthData?.monthlySales ?? 0);
        }, 0);

      // Sum service payment amounts for this month
      const monthAssignments = assignments.filter((a) => a.month === month);
      const servicePayments = monthAssignments.reduce(
        (sum, a) => sum + a.amount,
        0
      );

      return {
        month,
        projectedSales: Math.round(projectedSales * 100) / 100,
        servicePayments: Math.round(servicePayments * 100) / 100,
        variance:
          Math.round((projectedSales - servicePayments) * 100) / 100,
      };
    });

    return months;
  },
});

/**
 * S7-08: Deliverable/assignment status distribution for dashboard.
 * Returns counts by status.
 */
export const deliverableStats = query({
  args: {
    year: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId)
      return {
        pending: 0,
        info_received: 0,
        in_progress: 0,
        delivered: 0,
        overdue: 0,
      };

    const year = args.year ?? new Date().getFullYear();
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const assignments = await ctx.db
      .query("monthlyAssignments")
      .withIndex("by_orgId_year", (q) => q.eq("orgId", orgId).eq("year", year))
      .collect();

    const pending = assignments.filter((a) => a.status === "pending").length;
    const info_received = assignments.filter(
      (a) => a.status === "info_received"
    ).length;
    const in_progress = assignments.filter(
      (a) => a.status === "in_progress"
    ).length;
    const delivered = assignments.filter(
      (a) => a.status === "delivered"
    ).length;

    // Overdue: pending assignments from past months
    const overdue = assignments.filter(
      (a) =>
        a.status !== "delivered" &&
        (a.year < currentYear ||
          (a.year === currentYear && a.month < currentMonth))
    ).length;

    return { pending, info_received, in_progress, delivered, overdue };
  },
});

/**
 * S7-09: Per-client summary cards for dashboard.
 * Returns client-level aggregated data. Respects role-based visibility.
 */
export const clientSummary = query({
  args: {
    year: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    const identity = await ctx.auth.getUserIdentity();
    const role = (identity?.orgRole as string) ?? "org:member";
    const year = args.year ?? new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;

    // Get clients (role-filtered)
    let clients = await ctx.db
      .query("clients")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect()
      .then((all) => all.filter((c) => !c.isArchived));

    if (role === "org:member") {
      clients = clients.filter((c) => c.assignedTo === identity?.subject);
    }

    // Get all assignments for the year
    const assignments = await ctx.db
      .query("monthlyAssignments")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect()
      .then((all) => all.filter((a) => a.year === year));

    // Get active projections
    const projections = await ctx.db
      .query("projections")
      .withIndex("by_orgId_year", (q) => q.eq("orgId", orgId).eq("year", year))
      .collect()
      .then((all) => all.filter((p) => p.status === "active"));

    // Build per-client summary
    return clients.map((client) => {
      const clientAssignments = assignments.filter(
        (a) => a.clientId === client._id
      );
      const activeProjections = projections.filter(
        (p) => p.clientId === client._id
      );

      // Count unique active service names
      const activeServiceNames = new Set(
        clientAssignments
          .filter((a) => a.status !== "delivered")
          .map((a) => a.serviceName)
      );

      // Delivered this month
      const deliveredThisMonth = clientAssignments.filter(
        (a) => a.month === currentMonth && a.status === "delivered"
      ).length;

      // Pending payments (not_invoiced or invoiced but not paid)
      const pendingPayments = clientAssignments.filter(
        (a) => a.invoiceStatus !== "paid"
      ).length;

      return {
        clientId: client._id,
        clientName: client.name,
        industry: client.industry,
        activeServices: activeServiceNames.size,
        activeProjections: activeProjections.length,
        deliveredThisMonth,
        pendingPayments,
        totalAssignments: clientAssignments.length,
      };
    });
  },
});

/**
 * S7-10: Alerts for overdue and unpaid items.
 */
export const alerts = query({
  args: {
    year: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return { overdueAssignments: [], unpaidInvoices: [] };

    const identity = await ctx.auth.getUserIdentity();
    const role = (identity?.orgRole as string) ?? "org:member";
    const year = args.year ?? new Date().getFullYear();
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    // Get assignments
    const assignments = await ctx.db
      .query("monthlyAssignments")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect()
      .then((all) => all.filter((a) => a.year === year));

    // Role filter: get accessible client IDs
    let accessibleClientIds: Set<string> | null = null;
    if (role === "org:member") {
      const clients = await ctx.db
        .query("clients")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect()
        .then((all) =>
          all.filter((c) => c.assignedTo === identity?.subject)
        );
      accessibleClientIds = new Set(clients.map((c) => c._id));
    }

    const filtered = accessibleClientIds
      ? assignments.filter((a) => accessibleClientIds!.has(a.clientId))
      : assignments;

    // Overdue: past months, not delivered
    const overdueAssignments = filtered
      .filter(
        (a) =>
          a.status !== "delivered" &&
          (a.year < currentYear ||
            (a.year === currentYear && a.month < currentMonth))
      )
      .slice(0, 10);

    // Unpaid: invoiced but not paid
    const unpaidInvoices = filtered
      .filter((a) => a.invoiceStatus === "invoiced")
      .slice(0, 10);

    // Enrich with client names
    const clientIds = [
      ...new Set([
        ...overdueAssignments.map((a) => a.clientId),
        ...unpaidInvoices.map((a) => a.clientId),
      ]),
    ];
    const clients = await Promise.all(clientIds.map((id) => ctx.db.get(id)));
    const clientMap = new Map(
      clients.filter(Boolean).map((c) => [c!._id, c!.name])
    );

    return {
      overdueAssignments: overdueAssignments.map((a) => ({
        ...a,
        clientName: clientMap.get(a.clientId) ?? "Cliente desconocido",
      })),
      unpaidInvoices: unpaidInvoices.map((a) => ({
        ...a,
        clientName: clientMap.get(a.clientId) ?? "Cliente desconocido",
      })),
    };
  },
});
