import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgId, requireAuth } from "../../lib/authHelpers";

export const create = mutation({
  args: {
    name: v.string(),
    rfc: v.string(),
    industry: v.string(),
    annualRevenue: v.number(),
    billingFrequency: v.union(
      v.literal("semanal"),
      v.literal("quincenal"),
      v.literal("mensual")
    ),
    contactEmail: v.optional(v.string()),
    contactName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireAuth(ctx);
    const orgId = await getOrgId(ctx);

    let normalizedContactEmail: string | undefined = undefined;
    if (args.contactEmail) {
      const e = args.contactEmail.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
        throw new Error("Email de contacto inválido.");
      }
      normalizedContactEmail = e;
    }

    return await ctx.db.insert("clients", {
      orgId,
      name: args.name,
      rfc: args.rfc.toUpperCase(),
      industry: args.industry,
      annualRevenue: args.annualRevenue,
      billingFrequency: args.billingFrequency,
      contactEmail: normalizedContactEmail,
      contactName: args.contactName,
      isArchived: false,
      assignedTo: identity.subject,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("clients"),
    name: v.optional(v.string()),
    rfc: v.optional(v.string()),
    industry: v.optional(v.string()),
    annualRevenue: v.optional(v.number()),
    billingFrequency: v.optional(
      v.union(
        v.literal("semanal"),
        v.literal("quincenal"),
        v.literal("mensual")
      )
    ),
    assignedTo: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    contactName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgId(ctx);
    const client = await ctx.db.get(args.id);
    if (!client || client.orgId !== orgId) {
      throw new Error("Cliente no encontrado.");
    }

    let normalizedContactEmail: string | undefined = undefined;
    if (args.contactEmail) {
      const e = args.contactEmail.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
        throw new Error("Email de contacto inválido.");
      }
      normalizedContactEmail = e;
    }

    const { id, contactEmail, contactName, ...updates } = args;
    const filtered: Record<string, unknown> = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined)
    );
    if (filtered.rfc) {
      filtered.rfc = (filtered.rfc as string).toUpperCase();
    }
    if (contactEmail !== undefined) {
      filtered.contactEmail = normalizedContactEmail;
    }
    if (contactName !== undefined) {
      filtered.contactName = contactName;
    }

    await ctx.db.patch(id, filtered);
  },
});

export const archive = mutation({
  args: { id: v.id("clients") },
  handler: async (ctx, args) => {
    const orgId = await getOrgId(ctx);
    const client = await ctx.db.get(args.id);
    if (!client || client.orgId !== orgId) {
      throw new Error("Cliente no encontrado.");
    }
    await ctx.db.patch(args.id, { isArchived: true });
  },
});

export const restore = mutation({
  args: { id: v.id("clients") },
  handler: async (ctx, args) => {
    const orgId = await getOrgId(ctx);
    const client = await ctx.db.get(args.id);
    if (!client || client.orgId !== orgId) {
      throw new Error("Cliente no encontrado.");
    }
    await ctx.db.patch(args.id, { isArchived: false });
  },
});
