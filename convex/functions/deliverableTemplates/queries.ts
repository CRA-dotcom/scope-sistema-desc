import { query } from "../../_generated/server";
import { v } from "convex/values";
import { Id } from "../../_generated/dataModel";
import { getOrgIdSafe, requireAuth } from "../../lib/authHelpers";

const typeValidator = v.union(
  v.literal("quotation"),
  v.literal("contract"),
  v.literal("deliverable_short"),
  v.literal("deliverable_long"),
  v.literal("questionnaire"),
  v.literal("invoice"),
);

const resolvedTypeValidator = v.union(
  v.literal("deliverable_short"),
  v.literal("deliverable_long"),
  v.literal("quotation"),
  v.literal("contract"),
);

function isSuperAdmin(identity: unknown): boolean {
  if (!identity || typeof identity !== "object") return false;
  const id = identity as Record<string, unknown>;
  const pub = id.publicMetadata as Record<string, unknown> | undefined;
  const custom = id.metadata as Record<string, unknown> | undefined;
  const role = pub?.role ?? custom?.role;
  return role === "super_admin";
}

/**
 * Open list: returns globals (orgId === undefined) + org-scoped of the caller's
 * org. Super-admin sees everything. Per A2 §3.2.
 */
export const list = query({
  args: {
    type: v.optional(typeValidator),
    orgId: v.optional(v.string()),
    serviceId: v.optional(v.id("services")),
    subserviceId: v.optional(v.id("subservices")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const callerOrgId = await getOrgIdSafe(ctx);
    const superAdmin = isSuperAdmin(identity);

    // Pick the narrowest index available without joining.
    let base;
    if (args.type) {
      base = ctx.db
        .query("deliverableTemplates")
        .withIndex("by_type", (q) => q.eq("type", args.type!));
    } else if (args.serviceId) {
      base = ctx.db
        .query("deliverableTemplates")
        .withIndex("by_serviceId", (q) => q.eq("serviceId", args.serviceId!));
    } else if (args.orgId !== undefined) {
      // Super-admin may filter by an explicit orgId. For operator callers we
      // restrict it to their own org below.
      base = ctx.db
        .query("deliverableTemplates")
        .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId));
    } else {
      base = ctx.db.query("deliverableTemplates");
    }

    const all = await base.collect();

    return all.filter((t) => {
      if (args.subserviceId && t.subserviceId !== args.subserviceId) return false;
      if (args.serviceId && t.serviceId !== args.serviceId) return false;
      if (superAdmin) {
        if (args.orgId !== undefined && t.orgId !== args.orgId) return false;
        return true;
      }
      // Operator can never read another org's rows even if orgId was passed.
      if (t.orgId === undefined) return true; // globals readable by everyone authed
      return t.orgId === callerOrgId;
    });
  },
});

/**
 * Returns the template set the operator should see in
 * `/configuracion/plantillas`. Globals + org-scoped, deduplicated by
 * `parentTemplateId` (if a clone exists, the source global is hidden).
 *
 * Per A2 §3.2.
 */
export const listForOrg = query({
  args: { subserviceId: v.optional(v.id("subservices")) },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    const orgScoped = await ctx.db
      .query("deliverableTemplates")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    const globals = await ctx.db
      .query("deliverableTemplates")
      .withIndex("by_orgId", (q) => q.eq("orgId", undefined))
      .collect();

    const personalizedGlobalIds = new Set<Id<"deliverableTemplates">>(
      orgScoped
        .filter((t) => t.parentTemplateId)
        .map((t) => t.parentTemplateId as Id<"deliverableTemplates">),
    );

    const survivingGlobals = globals.filter(
      (g) => g.isActive && !personalizedGlobalIds.has(g._id),
    );

    let merged = [
      ...orgScoped.filter((t) => t.isActive),
      ...survivingGlobals,
    ];

    if (args.subserviceId) {
      merged = merged.filter((t) => t.subserviceId === args.subserviceId);
    }

    return merged;
  },
});

/**
 * Resolves the template to use for a given (type, subserviceId | serviceId)
 * combo from the caller's org. Org-scoped wins over global. Dual-matching:
 *
 *   1. subserviceId + orgId  (operator personalized)
 *   2. subserviceId + global
 *   3. serviceId + orgId     (legacy, sin subservicio)
 *   4. serviceId + global    (legacy global)
 *   5. serviceName + orgId   (very legacy)
 *   6. serviceName + global
 *
 * Per A2 §3.2. A3 (`selectDeliverableForMonth`) consumes this query.
 */
export const getResolved = query({
  args: {
    type: resolvedTypeValidator,
    subserviceId: v.optional(v.id("subservices")),
    serviceId: v.optional(v.id("services")),
    serviceName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const orgId = await getOrgIdSafe(ctx);

    const candidates = await ctx.db
      .query("deliverableTemplates")
      .withIndex("by_type", (q) => q.eq("type", args.type))
      .collect();
    const active = candidates.filter((t) => t.isActive);

    if (args.subserviceId) {
      const orgSub = active.find(
        (t) => t.subserviceId === args.subserviceId && t.orgId === orgId,
      );
      if (orgSub) return orgSub;

      const globalSub = active.find(
        (t) =>
          t.subserviceId === args.subserviceId && t.orgId === undefined,
      );
      if (globalSub) return globalSub;
    }

    if (args.serviceId) {
      const orgSvc = active.find(
        (t) =>
          t.serviceId === args.serviceId &&
          t.orgId === orgId &&
          !t.subserviceId,
      );
      if (orgSvc) return orgSvc;

      const globalSvc = active.find(
        (t) =>
          t.serviceId === args.serviceId &&
          t.orgId === undefined &&
          !t.subserviceId,
      );
      if (globalSvc) return globalSvc;
    }

    if (args.serviceName) {
      const orgName = active.find(
        (t) =>
          t.serviceName === args.serviceName &&
          t.orgId === orgId &&
          !t.subserviceId,
      );
      if (orgName) return orgName;

      const globalName = active.find(
        (t) =>
          t.serviceName === args.serviceName &&
          t.orgId === undefined &&
          !t.subserviceId,
      );
      if (globalName) return globalName;
    }

    return null;
  },
});

/**
 * Editor entry point. Returns the template plus `hasNewerGlobal` metadata so
 * the UI can render the "vN personalizada · vM global disponible" banner.
 *
 * Per A2 §3.2.
 */
export const getByIdWithBanner = query({
  args: { id: v.id("deliverableTemplates") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const tpl = await ctx.db.get(args.id);
    if (!tpl) return null;

    const orgId = await getOrgIdSafe(ctx);
    const identity = await ctx.auth.getUserIdentity();
    const superAdmin = isSuperAdmin(identity);
    if (!superAdmin && tpl.orgId !== undefined && tpl.orgId !== orgId) {
      return null;
    }

    let hasNewerGlobal = false;
    let globalVersion: number | null = null;
    let globalName: string | null = null;

    if (tpl.parentTemplateId && tpl.originalVersionAtClone !== undefined) {
      const parent = await ctx.db.get(tpl.parentTemplateId);
      if (parent && parent.version > tpl.originalVersionAtClone) {
        hasNewerGlobal = true;
        globalVersion = parent.version;
        globalName = parent.name;
      }
    }

    return { template: tpl, hasNewerGlobal, globalVersion, globalName };
  },
});

/**
 * Reads a single template. Returns null if not found OR the caller is not
 * allowed to read it (cross-org guard). Per A2 §3.2.
 */
export const getById = query({
  args: { id: v.id("deliverableTemplates") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const tpl = await ctx.db.get(args.id);
    if (!tpl) return null;
    const orgId = await getOrgIdSafe(ctx);
    if (isSuperAdmin(identity)) return tpl;
    if (tpl.orgId === undefined) return tpl; // global readable
    return tpl.orgId === orgId ? tpl : null;
  },
});
