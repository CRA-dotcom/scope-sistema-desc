import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgId, getOrgIdMutation, requireAdmin } from "../../lib/authHelpers";

/**
 * D2 §3.1 — `assignToClient`
 *
 * Assigns the given Clerk `userId` as the `assignedTo` executive of the
 * client. Requires `org:admin` role. Cross-org assignment is blocked.
 */
export const assignToClient = mutation({
  args: {
    clientId: v.id("clients"),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgIdMutation(ctx);

    const client = await ctx.db.get(args.clientId);
    if (!client) throw new Error("Cliente no encontrado.");
    if (client.orgId !== orgId) {
      throw new Error("No puedes asignar clientes de otra organización.");
    }

    await ctx.db.patch(args.clientId, { assignedTo: args.userId });
    return { ok: true, clientId: args.clientId, userId: args.userId };
  },
});

/**
 * D2 §3.1 — `unassign`
 *
 * Clears the `assignedTo` field on a client. Requires `org:admin` role.
 * Cross-org access is blocked.
 */
export const unassign = mutation({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgIdMutation(ctx);

    const client = await ctx.db.get(args.clientId);
    if (!client || client.orgId !== orgId) {
      throw new Error("Cliente no encontrado.");
    }
    await ctx.db.patch(args.clientId, { assignedTo: undefined });
    return { ok: true, clientId: args.clientId };
  },
});
