import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgId, requireAuth } from "../../lib/authHelpers";

/**
 * Mark a notification as read. Only the user it is assigned to (or any
 * org member for org-wide notifications) may mark it read.
 */
export const markRead = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const orgId = await getOrgId(ctx);

    const notification = await ctx.db.get(args.notificationId);
    if (!notification || notification.orgId !== orgId) {
      throw new Error("Notificación no encontrada.");
    }

    await ctx.db.patch(args.notificationId, { readAt: Date.now() });
  },
});

/**
 * C5: createFiscalCloseNotification — public mutation surface in case
 * callers need to create a fiscal-close notification manually (e.g., from
 * tests or admin tooling). The cron normally calls the internal mutation
 * in convex/functions/projections/cron.ts directly.
 */
export const createFiscalCloseNotification = mutation({
  args: {
    projectionId: v.id("projections"),
    clientId: v.id("clients"),
    message: v.string(),
    assignedTo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const orgId = await getOrgId(ctx);

    // Verify projection belongs to this org
    const projection = await ctx.db.get(args.projectionId);
    if (!projection || projection.orgId !== orgId) {
      throw new Error("Proyección no encontrada.");
    }

    // Idempotency guard
    const existing = await ctx.db
      .query("notifications")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .filter((q) =>
        q.and(
          q.eq(q.field("relatedProjectionId"), args.projectionId),
          q.eq(q.field("type"), "fiscal_close")
        )
      )
      .first();

    if (existing) return existing._id;

    return await ctx.db.insert("notifications", {
      orgId,
      assignedTo: args.assignedTo,
      type: "fiscal_close",
      message: args.message,
      relatedProjectionId: args.projectionId,
      relatedClientId: args.clientId,
      createdAt: Date.now(),
    });
  },
});
