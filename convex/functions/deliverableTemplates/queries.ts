import { query } from "../../_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "../../_generated/dataModel";
import {
  getOrgIdSafe,
  isSuperAdminFromIdentity,
  requireAuth,
} from "../../lib/authHelpers";

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
    const superAdmin = isSuperAdminFromIdentity(identity);

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
 * Each row is wrapped with `hasNewerGlobal` + `globalVersion` so the tree can
 * render the inline chip "⚠ vN personalizada · vM global disponible"
 * (spec §4.1) without a per-row follow-up query. For org-scoped rows with a
 * `parentTemplateId` we fetch the parent (1 read per parent — N is small in
 * practice) and compare `parent.version` against `originalVersionAtClone`.
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

    // Enrich each row with hasNewerGlobal metadata. Globals and clones without
    // a parent always return false/null. For clones we fetch each unique parent
    // exactly once — N clones of the same global cause 1 fetch, not N. Same
    // condition as getByIdWithBanner.
    const parentIds = [
      ...new Set(
        merged.flatMap((m) =>
          m.parentTemplateId
            ? [m.parentTemplateId as Id<"deliverableTemplates">]
            : [],
        ),
      ),
    ];
    const parentEntries = await Promise.all(
      parentIds.map(
        async (pid) => [pid, await ctx.db.get(pid)] as const,
      ),
    );
    const parents = new Map<
      Id<"deliverableTemplates">,
      Doc<"deliverableTemplates">
    >();
    for (const [pid, parent] of parentEntries) {
      if (parent) parents.set(pid, parent);
    }

    const enriched = merged.map((template) => {
      if (
        !template.parentTemplateId ||
        template.originalVersionAtClone === undefined
      ) {
        return {
          template,
          hasNewerGlobal: false,
          globalVersion: null as number | null,
        };
      }
      const parent = parents.get(template.parentTemplateId);
      if (!parent) {
        return {
          template,
          hasNewerGlobal: false,
          globalVersion: null as number | null,
        };
      }
      // `globalVersion` is always exposed when a parent exists (the chip is
      // driven by `hasNewerGlobal`; the version is auxiliary info). Matches
      // pre-dedup behavior — see queries.test.ts:336.
      return {
        template,
        hasNewerGlobal: parent.version > template.originalVersionAtClone,
        globalVersion: parent.version as number | null,
      };
    });

    return enriched;
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

    // Dual-matching subserviceId path — uses the by_orgId_subserviceId
    // composite index to avoid table scans. Org-scoped wins over global.
    if (args.subserviceId) {
      if (orgId) {
        const orgSub = await ctx.db
          .query("deliverableTemplates")
          .withIndex("by_orgId_subserviceId", (q) =>
            q.eq("orgId", orgId).eq("subserviceId", args.subserviceId!),
          )
          .filter((q) =>
            q.and(
              q.eq(q.field("type"), args.type),
              q.eq(q.field("isActive"), true),
            ),
          )
          .first();
        if (orgSub) return orgSub;
      }

      const globalSub = await ctx.db
        .query("deliverableTemplates")
        .withIndex("by_orgId_subserviceId", (q) =>
          q.eq("orgId", undefined).eq("subserviceId", args.subserviceId!),
        )
        .filter((q) =>
          q.and(
            q.eq(q.field("type"), args.type),
            q.eq(q.field("isActive"), true),
          ),
        )
        .first();
      if (globalSub) return globalSub;
    }

    // Legacy fallbacks — serviceId/serviceName don't benefit from the
    // subserviceId index, so we still pull by_type and filter in memory.
    const candidates = await ctx.db
      .query("deliverableTemplates")
      .withIndex("by_type", (q) => q.eq("type", args.type))
      .collect();
    const active = candidates.filter((t) => t.isActive);

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
 * Also surfaces the parent global's `htmlTemplate` as `globalHtml` so the
 * editor's diff modal can render two `<pre>` blocks side-by-side
 * (spec §4.2 + §8 R2 mitigation).
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
    const superAdmin = isSuperAdminFromIdentity(identity);
    if (!superAdmin && tpl.orgId !== undefined && tpl.orgId !== orgId) {
      return null;
    }

    let hasNewerGlobal = false;
    let globalVersion: number | null = null;
    let globalName: string | null = null;
    let globalHtml: string | null = null;

    if (tpl.parentTemplateId && tpl.originalVersionAtClone !== undefined) {
      const parent = await ctx.db.get(tpl.parentTemplateId);
      if (parent && parent.version > tpl.originalVersionAtClone) {
        hasNewerGlobal = true;
        globalVersion = parent.version;
        globalName = parent.name;
        // Only expose globalHtml when the diff modal will actually be shown
        // (banner triggered). Avoids leaking parent HTML for up-to-date clones.
        globalHtml = parent.htmlTemplate;
      }
    }

    return {
      template: tpl,
      hasNewerGlobal,
      globalVersion,
      globalName,
      globalHtml,
    };
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
    if (isSuperAdminFromIdentity(identity)) return tpl;
    if (tpl.orgId === undefined) return tpl; // global readable
    return tpl.orgId === orgId ? tpl : null;
  },
});
