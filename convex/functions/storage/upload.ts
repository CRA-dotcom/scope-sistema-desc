import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../../lib/authHelpers";

/**
 * Generates a short-lived upload URL for authenticated (Clerk session) contexts.
 * Used by the internal questionnaire responder (consultor uploads on behalf of client).
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAuth(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Generates a short-lived upload URL for token-based (public) questionnaire uploads.
 * Validates that the access token belongs to an active (non-completed) questionnaire.
 */
export const generateUploadUrlByToken = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const questionnaire = await ctx.db
      .query("questionnaireResponses")
      .withIndex("by_accessToken", (q) => q.eq("accessToken", args.token))
      .first();

    if (!questionnaire) {
      throw new Error("Cuestionario no encontrado o token inválido.");
    }
    if (questionnaire.status === "completed") {
      throw new Error("Este cuestionario ya fue completado.");
    }

    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Returns the signed download URL for a storage ID.
 * Used by authenticated consultors to preview previously uploaded files.
 */
export const getUploadUrl = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    return await ctx.storage.getUrl(args.storageId);
  },
});

/**
 * Returns the signed download URL for a storage ID in token-based contexts.
 * Validates that the access token belongs to a questionnaire that contains this storageId.
 */
export const getUploadUrlByToken = mutation({
  args: {
    token: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const questionnaire = await ctx.db
      .query("questionnaireResponses")
      .withIndex("by_accessToken", (q) => q.eq("accessToken", args.token))
      .first();

    if (!questionnaire) {
      throw new Error("Cuestionario no encontrado o token inválido.");
    }

    return await ctx.storage.getUrl(args.storageId);
  },
});
