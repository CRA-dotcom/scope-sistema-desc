import { internalQuery } from "../../_generated/server";
import { v } from "convex/values";

export const isClientAssignedToUser = internalQuery({
  args: {
    clientId: v.id("clients"),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientId);
    if (!client) return false;
    return client.assignedTo === args.userId;
  },
});

export const getByIdForResend = internalQuery({
  args: {
    id: v.id("emailLog"),
    orgId: v.string(),
  },
  handler: async (ctx, args) => {
    const log = await ctx.db.get(args.id);
    if (!log || log.orgId !== args.orgId) return null;
    return log;
  },
});
