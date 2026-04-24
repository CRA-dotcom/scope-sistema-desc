"use node";
import { action } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";
import { hashToken } from "./tokenHelpers";

export const acceptQuotation = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const tokenHash = hashToken(args.token);
    const result = await ctx.runMutation(
      internal.functions.quotations.internalMutations.applyAcceptance,
      { tokenHash }
    );
    await ctx.scheduler.runAfter(
      0,
      internal.functions.contracts.actions.generateContractFromQuotationInternal,
      { quotationId: result.quotationId, orgId: result.orgId }
    );
    return { status: "approved" as const, quotationId: result.quotationId };
  },
});

export const declineQuotation = action({
  args: {
    token: v.string(),
    declineReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tokenHash = hashToken(args.token);
    const result = await ctx.runMutation(
      internal.functions.quotations.internalMutations.applyDecline,
      { tokenHash, declineReason: args.declineReason }
    );
    return { status: "rejected" as const, quotationId: result.quotationId };
  },
});
