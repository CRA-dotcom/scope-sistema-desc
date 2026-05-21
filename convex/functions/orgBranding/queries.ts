import { query } from "../../_generated/server";
import { v } from "convex/values";
import {
  getOrgIdSafe,
  isSuperAdminFromIdentity,
  requireSuperAdmin,
} from "../../lib/authHelpers";

/**
 * Get branding for the current user's org (org admin / member use).
 */
export const getByOrgId = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;

    return await ctx.db
      .query("orgBranding")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .unique();
  },
});

/**
 * Get branding for a specific org (super admin use).
 */
export const getByOrgIdForAdmin = query({
  args: { orgId: v.string() },
  handler: async (ctx, args) => {
    try {
      await requireSuperAdmin(ctx);
    } catch {
      return null;
    }

    return await ctx.db
      .query("orgBranding")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .unique();
  },
});

/**
 * Get the logo URL for a branding record.
 *
 * D2 §3.2: super-admin can read any logo; operator can read only their own
 * org's logo (validated by matching `storageId` against the caller org's
 * `orgBranding.logoStorageId`).
 */
export const getLogoUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    if (isSuperAdminFromIdentity(identity)) {
      return await ctx.storage.getUrl(args.storageId);
    }

    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;
    const branding = await ctx.db
      .query("orgBranding")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .unique();
    if (!branding || branding.logoStorageId !== args.storageId) return null;
    return await ctx.storage.getUrl(args.storageId);
  },
});
