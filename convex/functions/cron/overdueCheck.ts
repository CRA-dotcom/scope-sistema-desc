import { internalAction, internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";

/**
 * Internal query: list active org IDs for cron pagination.
 */
export const listOrgIds = internalQuery({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db
      .query("organizations")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    return orgs.map((o) => o.clerkOrgId);
  },
});

/**
 * Internal query: pending assignments for a single org.
 */
export const listPendingAssignmentsByOrg = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("monthlyAssignments")
      .withIndex("by_orgId_status", (q) =>
        q.eq("orgId", args.orgId).eq("status", "pending")
      )
      .collect();
    return rows.map((a) => ({
      orgId: a.orgId,
      serviceName: a.serviceName,
      clientId: a.clientId,
      month: a.month,
      year: a.year,
    }));
  },
});

/**
 * Internal query: resolve client names for overdue items.
 */
export const resolveClientNames = internalQuery({
  args: {
    clientIds: v.array(v.id("clients")),
  },
  handler: async (ctx, args) => {
    const names: Record<string, string> = {};
    for (const id of args.clientIds) {
      const client = await ctx.db.get(id);
      names[id] = client?.name ?? "Desconocido";
    }
    return names;
  },
});

/**
 * Daily cron action: identify overdue assignments (pending for past months).
 */
export const run: ReturnType<typeof internalAction> = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const orgIds = await ctx.runQuery(
      internal.functions.cron.overdueCheck.listOrgIds
    );
    const allPending: Array<{ orgId: string; serviceName: string; clientId: Id<"clients">; month: number; year: number }> = [];
    for (const orgId of orgIds) {
      const orgPending = await ctx.runQuery(
        internal.functions.cron.overdueCheck.listPendingAssignmentsByOrg,
        { orgId }
      );
      allPending.push(...orgPending);
    }

    // Filter to overdue (past months only)
    const overdue = allPending.filter(
      (a: { year: number; month: number }) =>
        a.year < currentYear ||
        (a.year === currentYear && a.month < currentMonth)
    );

    // Group by orgId for summary
    const byOrg: Record<string, number> = {};
    for (const a of overdue) {
      byOrg[a.orgId] = (byOrg[a.orgId] || 0) + 1;
    }

    const summary = {
      timestamp: now.toISOString(),
      totalOverdue: overdue.length,
      byOrg,
    };

    console.log(
      `[overdueCheck] Found ${overdue.length} overdue assignments across ${Object.keys(byOrg).length} org(s)`,
      summary
    );

    // Send alert emails to org admins for each org with overdue items
    if (overdue.length > 0) {
      // Resolve client names
      const uniqueClientIds = [
        ...new Set(overdue.map((a: { clientId: any }) => a.clientId)),
      ];
      const clientNames = await ctx.runQuery(
        internal.functions.cron.overdueCheck.resolveClientNames,
        { clientIds: uniqueClientIds as any }
      );

      // Group overdue items by org for email content
      const overdueByOrg: Record<
        string,
        Array<{ clientName: string; serviceName: string; month: number; year: number }>
      > = {};
      for (const a of overdue) {
        if (!overdueByOrg[a.orgId]) {
          overdueByOrg[a.orgId] = [];
        }
        overdueByOrg[a.orgId].push({
          clientName: clientNames[a.clientId] ?? "Desconocido",
          serviceName: a.serviceName,
          month: a.month,
          year: a.year,
        });
      }

      for (const [orgId, items] of Object.entries(overdueByOrg)) {
        const itemsList = items
          .map(
            (i) =>
              `<li>${i.clientName} - ${i.serviceName} (${i.month}/${i.year})</li>`
          )
          .join("");

        // One indexed lookup per org with overdue items (not batched). Linear
        // in the number of affected orgs — fine for a cron at tenant scale.
        const opsTo = await ctx.runQuery(
          internal.functions.email.resolveRecipients
            .resolveOrgNotificationEmail,
          { orgId }
        );
        if (!opsTo) {
          console.warn(
            `[overdueCheck] Sin email de notificación para org ${orgId} ` +
              `(orgConfigs.notificationEmail / OPS_NOTIFICATION_EMAIL); ` +
              `omitiendo alerta de ${items.length} vencidos.`
          );
          continue;
        }
        await ctx.scheduler.runAfter(
          0,
          internal.functions.email.send.sendEmailInternal,
          {
            to: opsTo,
            subject: `Alerta: Entregables vencidos - ${items.length} pendientes`,
            html: `<p>Alerta: Hay ${items.length} entregables vencidos para su organización.</p><ul>${itemsList}</ul>`,
          }
        );
      }

      console.log(
        `[overdueCheck] Sent overdue alert emails to ${Object.keys(overdueByOrg).length} org(s)`
      );
    }

    return summary;
  },
});
