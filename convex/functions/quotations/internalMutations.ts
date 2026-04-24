import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";

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
