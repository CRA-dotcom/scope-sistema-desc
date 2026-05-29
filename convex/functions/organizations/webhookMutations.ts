import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";

/**
 * Called by POST /webhooks/clerk when event.type === "organization.created".
 * Idempotent: if a row with the same clerkOrgId already exists (lazy-seed fired
 * before the webhook arrived, or duplicate delivery), returns existing _id without
 * touching anything.
 */
export const createFromClerkWebhook = internalMutation({
  args: {
    clerkOrgId: v.string(),
    name: v.string(),
    slug: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("organizations")
      .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", args.clerkOrgId))
      .first();
    if (existing) {
      // Idempotent — webhook may deliver the same event more than once,
      // or lazy-seed in getOrgIdMutation already created the row.
      return existing._id;
    }
    return await ctx.db.insert("organizations", {
      clerkOrgId: args.clerkOrgId,
      name: args.name,
      status: "active" as const,
      plan: "basic" as const, // default; super-admin can upgrade manually
      createdAt: args.createdAt,
    });
  },
});

/**
 * Called by POST /webhooks/clerk when event.type === "organization.updated".
 * Only patches fields that actually changed; no-ops if org not found.
 */
export const updateFromClerkWebhook = internalMutation({
  args: {
    clerkOrgId: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("organizations")
      .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", args.clerkOrgId))
      .first();
    if (!existing) return null;
    const patch: Record<string, unknown> = {};
    if (args.name && args.name !== existing.name) patch.name = args.name;
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(existing._id, patch);
    }
    return existing._id;
  },
});

/**
 * Called by POST /webhooks/clerk when event.type === "organization.deleted".
 * Sets status="inactive"; does NOT hard-delete so referential integrity is
 * preserved (clients, projections, invoices, etc. keep their org row).
 */
export const markInactiveFromClerkWebhook = internalMutation({
  args: { clerkOrgId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("organizations")
      .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", args.clerkOrgId))
      .first();
    if (!existing) return null;
    if (existing.status !== "inactive") {
      await ctx.db.patch(existing._id, { status: "inactive" as const });
    }
    return existing._id;
  },
});
