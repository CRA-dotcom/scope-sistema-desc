import { internalQuery, internalAction } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { getOrgNotificationEmail } from "../email/resolveRecipients";

/**
 * A3 — Helpers for the daily eligibility cron.
 *
 * Per docs/superpowers/specs/2026-05-23-document-lifecycle-design.md §3.4
 */

export const listActiveOrgs = internalQuery({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db
      .query("organizations")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    return orgs.map((o) => ({ orgId: o.clerkOrgId, name: o.name }));
  },
});

export const listActiveClients = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("clients")
      .withIndex("by_orgId_archived", (q) =>
        q.eq("orgId", args.orgId).eq("isArchived", false)
      )
      .collect();
  },
});

export const listProjServicesForClient = internalQuery({
  args: {
    orgId: v.string(),
    clientId: v.id("clients"),
    year: v.number(),
  },
  handler: async (ctx, args) => {
    // Find the client's active projection(s) for the year.
    const projections = await ctx.db
      .query("projections")
      .withIndex("by_clientId_year", (q) =>
        q.eq("clientId", args.clientId).eq("year", args.year)
      )
      .collect();
    const active = projections.filter(
      (p) => p.orgId === args.orgId && p.status === "active"
    );
    if (active.length === 0) return [];

    const result: Array<{
      _id: string;
      projectionId: string;
      serviceId: string;
      serviceName: string;
      subserviceId?: string;
    }> = [];
    for (const p of active) {
      const services = await ctx.db
        .query("projectionServices")
        .withIndex("by_projectionId_active", (q) =>
          q.eq("projectionId", p._id).eq("isActive", true)
        )
        .collect();
      for (const s of services) {
        result.push({
          _id: s._id,
          projectionId: p._id,
          serviceId: s.serviceId,
          serviceName: s.serviceName,
          subserviceId: s.subserviceId,
        });
      }
    }
    return result;
  },
});

/**
 * Find the most recent `reminder_sent` documentEvent for a (org, client) pair
 * within the supplied lookback window.
 *
 * Correctness note: must filter via the `by_orgId_eventType_createdAt` index
 * (not `by_orgId_clientId_createdAt` + in-memory eventType filter). If a
 * client accumulates many non-reminder events newer than their last reminder
 * (uploaded / paid / sent / voided / …), a `.take(N)` cap on the clientId
 * index would silently drop the reminder and the cron would re-send,
 * violating the "1 email per client per 24h" guarantee.
 *
 * Because clientIds are sparse per (orgId, eventType="reminder_sent")
 * partition, scanning the per-eventType slice within the 24h window and
 * matching `clientId` in-memory is cheap.
 */
export const findRecentReminder = internalQuery({
  args: {
    orgId: v.string(),
    clientId: v.id("clients"),
    sinceMs: v.number(),
  },
  handler: async (ctx, args) => {
    const events = await ctx.db
      .query("documentEvents")
      .withIndex("by_orgId_eventType_createdAt", (q) =>
        q
          .eq("orgId", args.orgId)
          .eq("eventType", "reminder_sent" as const)
          .gte("createdAt", args.sinceMs)
      )
      .collect();
    return events.find((e) => e.clientId === args.clientId) ?? null;
  },
});

export const findPaidInvoiceForMonth = internalQuery({
  args: {
    orgId: v.string(),
    clientId: v.id("clients"),
    subserviceId: v.optional(v.id("subservices")),
    year: v.number(),
    month: v.number(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("invoices")
      .withIndex("by_orgId_clientId_year_month", (q) =>
        q
          .eq("orgId", args.orgId)
          .eq("clientId", args.clientId)
          .eq("year", args.year)
          .eq("month", args.month)
      )
      .collect();
    return (
      rows.find(
        (r) =>
          r.status === "paid" &&
          (args.subserviceId
            ? r.subserviceId === args.subserviceId
            : true)
      ) ?? null
    );
  },
});

export const getOrgConfig = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("orgConfigs")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .unique();
  },
});

export const getRecipientForOrg = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, args): Promise<string | null> => {
    return await getOrgNotificationEmail(ctx, args.orgId);
  },
});

export const getClientName = internalQuery({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args): Promise<string | null> => {
    const c = await ctx.db.get(args.clientId);
    return c?.name ?? null;
  },
});

/**
 * Send a reminder to the operator: "factura pendiente para mes M".
 * Uses `getOrgNotificationEmail` + env fallback (notification recipient spec).
 */
export const sendReminderEmail = internalAction({
  args: {
    orgId: v.string(),
    clientId: v.id("clients"),
    subserviceName: v.string(),
    month: v.number(),
    year: v.number(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ sent: boolean; reason?: string; id?: string }> => {
    const recipient: string | null = await ctx.runQuery(
      internal.functions.cron.eligibilityHelpers.getRecipientForOrg,
      { orgId: args.orgId }
    );
    if (!recipient) {
      console.warn(
        `[sendReminderEmail] no notification email for org ${args.orgId} — skip`
      );
      return { sent: false, reason: "no_recipient" };
    }

    const client: string | null = await ctx.runQuery(
      internal.functions.cron.eligibilityHelpers.getClientName,
      { clientId: args.clientId }
    );

    const subject = `Recordatorio: subir factura ${args.month}/${args.year} — ${args.subserviceName}`;
    const html = `<p>Hola,</p>
<p>Toca subir la factura de ${args.subserviceName} para ${client ?? "este cliente"} (mes ${args.month}/${args.year}).</p>
<p>Sube el PDF y márcala como pagada en /facturacion para disparar el entregable.</p>`;
    return await ctx.runAction(
      internal.functions.email.send.sendEmailInternal,
      { to: recipient, subject, html }
    );
  },
});
