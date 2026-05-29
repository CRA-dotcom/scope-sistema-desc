import { internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { Doc } from "../../_generated/dataModel";
import { getOverride } from "./overrides";

export const getAssignmentData = internalQuery({
  args: { assignmentId: v.id("monthlyAssignments") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.assignmentId);
  },
});

export const getClientData = internalQuery({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.clientId);
  },
});

export const getProjServiceData = internalQuery({
  args: { projServiceId: v.id("projectionServices") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.projServiceId);
  },
});

/**
 * SS4: read the subservice row to check `isFinancialRelated`. Used by
 * generateDeliverable to decide whether to inject financial context.
 */
export const getSubserviceData = internalQuery({
  args: { subserviceId: v.id("subservices") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.subserviceId);
  },
});

export const getProjectionByProjService = internalQuery({
  args: { projectionId: v.id("projections") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.projectionId);
  },
});

export const getQuestionnaireForClient = internalQuery({
  args: { clientId: v.id("clients"), projectionId: v.id("projections") },
  handler: async (ctx, args) => {
    const responses = await ctx.db
      .query("questionnaireResponses")
      .withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
      .collect();

    return (
      responses.find(
        (r) => r.projectionId === args.projectionId && r.status === "completed"
      ) ?? responses.find((r) => r.projectionId === args.projectionId) ?? null
    );
  },
});

/**
 * A2 envoltorio sin guard: el action que llama esta query ya está
 * autenticado, así que no aplicamos `requireAuth`. Replica la lógica
 * dual-matching de `deliverableTemplates.queries.getResolved` pero recibe
 * el `orgId` explícito (no del JWT, porque las generaciones automatizadas
 * pueden correr en background donde el JWT del operador no aplica).
 *
 * Per docs/superpowers/specs/2026-05-22-templates-operator-access-design.md §5.
 * Replaces the legacy `findTemplate` (R3.3 del doc-lifecycle design).
 */
export const getResolvedForGeneration = internalQuery({
  args: {
    orgId: v.string(),
    type: v.union(
      v.literal("deliverable_short"),
      v.literal("deliverable_long"),
      v.literal("quotation"),
      v.literal("contract"),
    ),
    subserviceId: v.optional(v.id("subservices")),
    serviceId: v.optional(v.id("services")),
    serviceName: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Doc<"deliverableTemplates"> | null> => {
    // Dual-matching subserviceId path — uses the by_orgId_subserviceId
    // composite index to avoid table scans. Org-scoped wins over global.
    if (args.subserviceId) {
      const orgSub = await ctx.db
        .query("deliverableTemplates")
        .withIndex("by_orgId_subserviceId", (q) =>
          q.eq("orgId", args.orgId).eq("subserviceId", args.subserviceId!),
        )
        .filter((q) =>
          q.and(
            q.eq(q.field("type"), args.type),
            q.eq(q.field("isActive"), true),
          ),
        )
        .first();
      if (orgSub) return orgSub;

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
          t.orgId === args.orgId &&
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
          t.orgId === args.orgId &&
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

export const getDeliverableData = internalQuery({
  args: { deliverableId: v.id("deliverables") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.deliverableId);
  },
});

export const getOrgBranding = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const branding = await ctx.db
      .query("orgBranding")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .first();
    return branding;
  },
});

export const getTemplateById = internalQuery({
  args: { templateId: v.id("deliverableTemplates") },
  handler: async (ctx, { templateId }) => {
    return await ctx.db.get(templateId);
  },
});

export const getQuestionnaireById = internalQuery({
  args: { questionnaireId: v.id("questionnaireResponses") },
  handler: async (ctx, { questionnaireId }) => {
    return await ctx.db.get(questionnaireId);
  },
});

export const findProjServiceByServiceAndProjection = internalQuery({
  args: {
    projectionId: v.id("projections"),
    serviceId: v.id("services"),
  },
  handler: async (ctx, { projectionId, serviceId }) => {
    return await ctx.db
      .query("projectionServices")
      .withIndex("by_projectionId", (q) => q.eq("projectionId", projectionId))
      .filter((q) => q.eq(q.field("serviceId"), serviceId))
      .first();
  },
});

/**
 * A3 — Frequency-aware deliverable template selector.
 *
 * Replaces the legacy `findTemplate` (which was already removed by A2 in
 * favour of `getResolvedForGeneration`). This selector additionally
 * understands subservice frequency rules (mensual/trimestral/semestral/
 * anual/una_vez), applicableMonths, cooldownMonths, and exposes a hook
 * for per-client overrides (`getOverride`, beta returns null).
 *
 * Used by:
 * - `deliverables.invoiceFlow.generateFromInvoice` to decide which template
 *   applies for the invoice's (subservice, month, year).
 * - `cron.deliverableEligibility.run` to decide which (client, projService,
 *   month) tuples need a reminder.
 *
 * Returns `{ template, reason }` or `null` when no template applies for
 * the supplied tuple.
 *
 * Per docs/superpowers/specs/2026-05-23-document-lifecycle-design.md §3.3
 */
export const selectDeliverableForMonth = internalQuery({
  args: {
    orgId: v.string(),
    clientId: v.id("clients"),
    subserviceId: v.optional(v.id("subservices")),
    serviceId: v.optional(v.id("services")),
    serviceName: v.optional(v.string()),
    // B1 — optional projectionServices reference. When present and the row
    // has startMonth/endMonth set, the selector enforces that window before
    // applying frequency rules. Backward-compatible: legacy callers omit
    // this and the gate is a no-op.
    projServiceId: v.optional(v.id("projectionServices")),
    month: v.number(),
    year: v.number(),
    projectionMode: v.union(
      v.literal("rolling"),
      v.literal("fiscal")
    ),
    templateType: v.union(
      v.literal("deliverable_short"),
      v.literal("deliverable_long")
    ),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ template: Doc<"deliverableTemplates">; reason: string } | null> => {
    // 1. Resolver subservicio (dual-matching).
    let subservice: Doc<"subservices"> | null = null;
    if (args.subserviceId) {
      subservice = await ctx.db.get(args.subserviceId);
    } else if (args.serviceId && args.serviceName) {
      // Path legacy: proyecciones pre-A1 sin subserviceId.
      const subs = await ctx.db
        .query("subservices")
        .withIndex("by_orgId_parentService", (q) =>
          q.eq("orgId", args.orgId).eq("parentServiceId", args.serviceId!)
        )
        .filter((q) => q.eq(q.field("isActive"), true))
        .collect();
      const globals = await ctx.db
        .query("subservices")
        .withIndex("by_orgId_parentService", (q) =>
          q.eq("orgId", undefined).eq("parentServiceId", args.serviceId!)
        )
        .filter((q) => q.eq(q.field("isActive"), true))
        .collect();
      const candidates = subs.length > 0 ? subs : globals;
      if (candidates.length === 1) subservice = candidates[0];
      // If >1, fall through to pure-serviceName match.
    }

    // 2. Hook getOverride (beta returns null).
    const override = getOverride(args.clientId, args.subserviceId);

    // 3. Frecuencia efectiva.
    const frequency =
      override?.frequencyOverride ??
      subservice?.defaultFrequency ??
      "mensual";

    const applicableMonths =
      override?.applicableMonthsOverride ??
      subservice?.applicableMonths ??
      null;
    const cooldownMonths =
      override?.cooldownMonthsOverride ??
      subservice?.cooldownMonths ??
      0;

    // 4. Beta: siempre calendario, sin importar projectionMode (R3 mitig).
    const contractMonth = args.month;

    // 5. Gate applicableMonths.
    if (
      applicableMonths &&
      applicableMonths.length > 0 &&
      !applicableMonths.includes(contractMonth)
    ) {
      return null;
    }

    // 5b. B1 — projectionServices window gate (mid-year add-on). Legacy rows
    //     with undefined start/end behave as 1..12 (no-op). Per
    //     docs/superpowers/specs/2026-05-26-client-services-overview-design.md §4.2
    if (args.projServiceId) {
      const ps = await ctx.db.get(args.projServiceId);
      if (ps) {
        const startMonth = ps.startMonth ?? 1;
        const endMonth = ps.endMonth ?? 12;
        if (contractMonth < startMonth || contractMonth > endMonth) {
          return null;
        }
      }
    }

    // 6. Gate frecuencia.
    let frequencyOk = false;
    let reason = "";
    switch (frequency) {
      case "mensual":
        frequencyOk = true;
        reason = "monthly";
        break;
      case "trimestral": {
        const defaults = [3, 6, 9, 12];
        frequencyOk = applicableMonths
          ? applicableMonths.includes(contractMonth)
          : defaults.includes(contractMonth);
        reason = "quarterly_match";
        break;
      }
      case "semestral": {
        const defaults = [6, 12];
        frequencyOk = applicableMonths
          ? applicableMonths.includes(contractMonth)
          : defaults.includes(contractMonth);
        reason = "semiannual_match";
        break;
      }
      case "anual": {
        const targets =
          applicableMonths && applicableMonths.length > 0
            ? applicableMonths
            : [12];
        frequencyOk = targets.includes(contractMonth);
        reason = "annual_match";
        break;
      }
      case "una_vez": {
        const prevs = await ctx.db
          .query("deliverables")
          .withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
          .collect();
        const subRef = subservice;
        const alreadyGenerated = subRef
          ? prevs.some((d) => d.subserviceId === subRef._id)
          : prevs.some((d) => d.serviceName === args.serviceName);
        frequencyOk = !alreadyGenerated;
        reason = "one_time_first";
        break;
      }
    }
    if (!frequencyOk) return null;

    // 7. Cooldown.
    if (cooldownMonths > 0) {
      const prevs = await ctx.db
        .query("deliverables")
        .withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
        .collect();
      const sameSub = subservice
        ? prevs.filter((d) => d.subserviceId === subservice!._id)
        : prevs.filter((d) => d.serviceName === args.serviceName);
      const mostRecent = sameSub.sort(
        (a, b) => b.createdAt - a.createdAt
      )[0];
      if (mostRecent) {
        const monthsDelta =
          (args.year - mostRecent.year) * 12 +
          (contractMonth - mostRecent.month);
        if (monthsDelta >= 0 && monthsDelta < cooldownMonths) return null;
      }
    }

    // 8. Lookup plantilla.
    // Priority: org+subservice → global+subservice → org+serviceName → global+serviceName.
    const allTemplates = await ctx.db
      .query("deliverableTemplates")
      .withIndex("by_type", (q) => q.eq("type", args.templateType))
      .collect();
    const activeTemplates = allTemplates.filter((t) => t.isActive);

    if (subservice) {
      const orgSub = activeTemplates.find(
        (t) => t.orgId === args.orgId && t.subserviceId === subservice!._id
      );
      if (orgSub) return { template: orgSub, reason };
      const globalSub = activeTemplates.find(
        (t) => !t.orgId && t.subserviceId === subservice!._id
      );
      if (globalSub) return { template: globalSub, reason };
    }

    if (args.serviceName) {
      const orgName = activeTemplates.find(
        (t) =>
          t.orgId === args.orgId &&
          t.serviceName === args.serviceName &&
          !t.subserviceId
      );
      if (orgName) return { template: orgName, reason };
      const globalName = activeTemplates.find(
        (t) =>
          !t.orgId &&
          t.serviceName === args.serviceName &&
          !t.subserviceId
      );
      if (globalName) return { template: globalName, reason };
    }

    return null;
  },
});

/**
 * A3 — Find the monthlyAssignment matching an invoice when the invoice
 * row does not carry `monthlyAssignmentId` directly. Disambiguates via
 * `projServiceId` when present.
 */
export const findAssignmentForInvoice = internalQuery({
  args: {
    orgId: v.string(),
    clientId: v.id("clients"),
    projServiceId: v.optional(v.id("projectionServices")),
    month: v.number(),
    year: v.number(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("monthlyAssignments")
      .withIndex("by_clientId_month", (qb) =>
        qb.eq("clientId", args.clientId).eq("month", args.month)
      )
      .collect();
    return (
      rows.find(
        (r) =>
          r.orgId === args.orgId &&
          r.year === args.year &&
          (args.projServiceId ? r.projServiceId === args.projServiceId : true)
      ) ?? null
    );
  },
});

/**
 * A3 — Idempotency helper used by `generateFromInvoice` and by the
 * eligibility cron to confirm whether a deliverable already exists for a
 * (client, subservice/serviceName, month, year) tuple.
 */
export const findDeliverableForMonth = internalQuery({
  args: {
    clientId: v.id("clients"),
    subserviceId: v.optional(v.id("subservices")),
    serviceName: v.optional(v.string()),
    year: v.number(),
    month: v.number(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("deliverables")
      .withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
      .collect();
    return (
      rows.find((d) => {
        if (d.year !== args.year || d.month !== args.month) return false;
        if (args.subserviceId) return d.subserviceId === args.subserviceId;
        if (args.serviceName) return d.serviceName === args.serviceName;
        return false;
      }) ?? null
    );
  },
});
