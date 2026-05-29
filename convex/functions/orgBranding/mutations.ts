import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import {
  getOrgId,
  getOrgIdMutation,
  isSuperAdminFromIdentity,
  requireAdmin,
  requireAuth,
} from "../../lib/authHelpers";

/**
 * Upsert branding. D2 §3.2:
 *
 * - Super-admin: may pass any `orgId` and edit cross-org.
 * - Org-admin: may omit `orgId` (defaults to caller's own) or pass their
 *   own; passing a different `orgId` throws.
 */
export const upsert = mutation({
  args: {
    orgId: v.optional(v.string()),
    companyName: v.string(),
    logoStorageId: v.optional(v.id("_storage")),
    primaryColor: v.string(),
    secondaryColor: v.string(),
    accentColor: v.optional(v.string()),
    fontFamily: v.string(),
    headerText: v.optional(v.string()),
    footerText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireAuth(ctx);
    const isSuper = isSuperAdminFromIdentity(identity);

    let targetOrgId: string;
    if (isSuper && args.orgId) {
      targetOrgId = args.orgId;
    } else {
      await requireAdmin(ctx);
      targetOrgId = await getOrgIdMutation(ctx);
      if (args.orgId !== undefined && args.orgId !== targetOrgId) {
        throw new Error("No puedes editar branding de otra organización.");
      }
    }

    const existing = await ctx.db
      .query("orgBranding")
      .withIndex("by_orgId", (q) => q.eq("orgId", targetOrgId))
      .unique();

    const data = {
      orgId: targetOrgId,
      companyName: args.companyName,
      logoStorageId: args.logoStorageId,
      primaryColor: args.primaryColor,
      secondaryColor: args.secondaryColor,
      accentColor: args.accentColor,
      fontFamily: args.fontFamily,
      headerText: args.headerText,
      footerText: args.footerText,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, data);
      return existing._id;
    }

    return await ctx.db.insert("orgBranding", data);
  },
});

/**
 * Generate a storage upload URL for branding logos. D2 §3.2: accepts both
 * super-admin and org-admin callers.
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await requireAuth(ctx);
    if (!isSuperAdminFromIdentity(identity)) {
      await requireAdmin(ctx);
    }
    return await ctx.storage.generateUploadUrl();
  },
});
