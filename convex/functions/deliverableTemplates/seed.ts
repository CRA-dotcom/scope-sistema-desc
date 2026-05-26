import { internalMutation, internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { detectContentStatus } from "../../lib/templateContent";

export const listAll = internalQuery({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("deliverableTemplates").collect();
    return all.map((t) => ({
      id: t._id,
      name: t.name,
      serviceName: t.serviceName,
      type: t.type,
      variablesCount: t.variables.length,
      htmlLength: t.htmlTemplate.length,
    }));
  },
});

export const deleteByName = internalMutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("deliverableTemplates")
      .filter((q) => q.eq(q.field("name"), args.name))
      .first();
    if (!doc) return { action: "not_found" };
    await ctx.db.delete(doc._id);
    return { action: "deleted", id: doc._id };
  },
});

export const seedTemplate = internalMutation({
  args: {
    serviceName: v.string(),
    type: v.union(
      v.literal("quotation"),
      v.literal("contract"),
      v.literal("deliverable_short"),
      v.literal("deliverable_long"),
      v.literal("questionnaire")
    ),
    name: v.string(),
    htmlTemplate: v.string(),
    variables: v.array(
      v.object({
        key: v.string(),
        label: v.string(),
        source: v.union(
          v.literal("client"),
          v.literal("projection"),
          v.literal("service"),
          v.literal("ai"),
          v.literal("manual")
        ),
        required: v.boolean(),
      })
    ),
  },
  handler: async (ctx, args) => {
    // Check if template already exists by name
    const existing = await ctx.db
      .query("deliverableTemplates")
      .filter((q) => q.eq(q.field("name"), args.name))
      .first();
    if (existing) {
      return { id: existing._id, action: "already_exists" };
    }

    const id = await ctx.db.insert("deliverableTemplates", {
      orgId: undefined,
      serviceId: undefined,
      serviceName: args.serviceName,
      type: args.type,
      name: args.name,
      htmlTemplate: args.htmlTemplate,
      variables: args.variables,
      version: 1,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { id, action: "created" };
  },
});

/**
 * Upsert a template: update htmlTemplate if it exists, or insert if new.
 * Used to reload updated HTML templates (e.g., after branding variable migration).
 */
export const upsertTemplate = internalMutation({
  args: {
    serviceName: v.string(),
    type: v.union(
      v.literal("quotation"),
      v.literal("contract"),
      v.literal("deliverable_short"),
      v.literal("deliverable_long"),
      v.literal("questionnaire")
    ),
    name: v.string(),
    htmlTemplate: v.string(),
    variables: v.optional(
      v.array(
        v.object({
          key: v.string(),
          label: v.string(),
          source: v.union(
            v.literal("client"),
            v.literal("projection"),
            v.literal("service"),
            v.literal("ai"),
            v.literal("manual")
          ),
          required: v.boolean(),
        })
      )
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("deliverableTemplates")
      .filter((q) => q.eq(q.field("name"), args.name))
      .first();

    if (existing) {
      const patch: Record<string, unknown> = {
        htmlTemplate: args.htmlTemplate,
        contentStatus: detectContentStatus(args.htmlTemplate),
        updatedAt: Date.now(),
        version: (existing.version ?? 1) + 1,
      };
      if (args.variables) {
        patch.variables = args.variables;
      }
      await ctx.db.patch(existing._id, patch);
      return { id: existing._id, action: "updated", version: patch.version };
    }

    const id = await ctx.db.insert("deliverableTemplates", {
      orgId: undefined,
      serviceId: undefined,
      serviceName: args.serviceName,
      type: args.type,
      name: args.name,
      htmlTemplate: args.htmlTemplate,
      contentStatus: detectContentStatus(args.htmlTemplate),
      variables: args.variables ?? [],
      version: 1,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { id, action: "created" };
  },
});
