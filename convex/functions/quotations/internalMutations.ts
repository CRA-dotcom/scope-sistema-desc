import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import { cancelFuturePendingAssignments } from "../../lib/projectionDownstream";

export const rotateTokenAndMarkSent = internalMutation({
  args: {
    quotationId: v.id("quotations"),
    tokenHash: v.string(),
    tokenIssuedAt: v.number(),
    tokenExpiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const quotation = await ctx.db.get(args.quotationId);
    if (!quotation) throw new Error("Cotización no encontrada.");
    const prev = quotation.sendCount ?? 0;
    await ctx.db.patch(args.quotationId, {
      status: "sent",
      lastSentAt: Date.now(),
      sendCount: prev + 1,
      accessTokenHash: args.tokenHash,
      tokenIssuedAt: args.tokenIssuedAt,
      tokenExpiresAt: args.tokenExpiresAt,
    });
    return { sendCount: prev + 1, tokenExpiresAt: args.tokenExpiresAt };
  },
});

export const applyAcceptance = internalMutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    const quotation = await ctx.db
      .query("quotations")
      .withIndex("by_accessTokenHash", (q) =>
        q.eq("accessTokenHash", args.tokenHash)
      )
      .unique();
    if (!quotation) throw new Error("invalid_token");
    if (quotation.status !== "sent") throw new Error("already_responded");
    if (
      !quotation.tokenExpiresAt ||
      quotation.tokenExpiresAt < Date.now()
    ) {
      throw new Error("expired");
    }
    await ctx.db.patch(quotation._id, {
      status: "approved",
      respondedAt: Date.now(),
      accessTokenHash: undefined,
    });
    // TODO(pipeline-visibility): emit notifications.insert when §3B.10 ships.
    const projService = await ctx.db.get(quotation.projServiceId);
    return {
      quotationId: quotation._id,
      orgId: quotation.orgId,
      clientId: quotation.clientId,
      projServiceId: quotation.projServiceId,
      serviceId: projService?.serviceId,
    };
  },
});

export const applyDecline = internalMutation({
  args: {
    tokenHash: v.string(),
    declineReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const quotation = await ctx.db
      .query("quotations")
      .withIndex("by_accessTokenHash", (q) =>
        q.eq("accessTokenHash", args.tokenHash)
      )
      .unique();
    if (!quotation) throw new Error("invalid_token");
    if (quotation.status !== "sent") throw new Error("already_responded");
    if (
      !quotation.tokenExpiresAt ||
      quotation.tokenExpiresAt < Date.now()
    ) {
      throw new Error("expired");
    }
    const reasonTrimmed = args.declineReason?.slice(0, 500);
    const reason = reasonTrimmed && reasonTrimmed.length > 0 ? reasonTrimmed : undefined;
    await ctx.db.patch(quotation._id, {
      status: "rejected",
      respondedAt: Date.now(),
      declineReason: reason,
      accessTokenHash: undefined,
    });
    // Phase 1 §3.2 — cascade: desactivar projService y cancelar MAs futuros pending
    // Aplica tanto a base como a supplementary add-ons (§3.2-bis).
    const projService = await ctx.db.get(quotation.projServiceId);
    if (projService && projService.isActive) {
      await ctx.db.patch(projService._id, { isActive: false });
      await cancelFuturePendingAssignments(ctx, projService._id);
    }
    // TODO(pipeline-visibility): emit notifications.insert when §3B.10 ships.
    return {
      quotationId: quotation._id,
      orgId: quotation.orgId,
    };
  },
});
