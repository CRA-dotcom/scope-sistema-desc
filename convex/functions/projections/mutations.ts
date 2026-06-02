import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgId, getOrgIdMutation, requireAuth } from "../../lib/authHelpers";
import { internal } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { assertTransition, type Transition } from "../../lib/stateMachines";
import {
  calculateProjection,
  type ServiceConfig,
  type EngineConfig,
} from "../../lib/projectionEngine";
import type { PricingModel } from "../../lib/pricingModel";
import { getProjectionDownstreamCounts } from "../../lib/projectionDownstream";
import { buildProjectionDownstream } from "../../lib/buildProjectionDownstream";
// Note: convex/lib/seasonality.ts is a pure TS file with no browser-only APIs,
// safe to import in Convex server functions.

/**
 * Internal helper — called by `create` when args.previousProjectionId is set.
 *
 * Cascade-deletes downstream rows in dependency order:
 *   invoices → deliverables → contracts → quotations → monthlyAssignments → projectionServices
 * Then patches the projection row with new top-level fields and rebuilds
 * projectionServices + monthlyAssignments via buildProjectionDownstream.
 * Logs a "projection re-edited" documentEvent.
 *
 * Returns the (unchanged) projectionId — same ID is reused, no new row created.
 */
async function replaceProjection(
  ctx: MutationCtx,
  callerOrgId: string,
  callerUserId: string,
  projectionId: Id<"projections">,
  newArgs: {
    clientId: Id<"clients">;
    year: number;
    annualSales: number;
    totalBudget: number;
    commissionRate: number;
    serviceConfigs: Array<{
      serviceId: Id<"services">;
      chosenPct: number;
      isActive: boolean;
      subserviceIds?: Array<Id<"subservices">>;
      pricingModel?: PricingModel;
    }>;
    seasonalityData: Array<{ month: number; monthlySales: number; feFactor: number }>;
    seasonalityOutliers?: Array<{ month: number; value: number; unit: "percent" | "amount" }>;
    startMonth?: number;
    projectionMode?: "rolling" | "fiscal";
    monthCount?: number;
    effectiveBudget?: number;
  }
): Promise<Id<"projections">> {
  const proj = await ctx.db.get(projectionId);
  if (!proj || proj.orgId !== callerOrgId) {
    throw new Error("Proyección no encontrada.");
  }
  // Fix 1: block re-edit on archived projections.
  if (proj.status === "archived") {
    throw new Error("No se puede re-editar una proyección archivada.");
  }
  const orgId = proj.orgId;

  // Fix 5: block re-edit when add-on projectionServices exist.
  // Add-ons are mid-year services the wizard can't re-create — deleting them silently loses data.
  const allProjServicesCheck = await ctx.db
    .query("projectionServices")
    .withIndex("by_projectionId", (q) => q.eq("projectionId", projectionId))
    .collect();
  const addOns = allProjServicesCheck.filter(
    (ps) => ps.addOnOfProjectionServiceId !== undefined
  );
  if (addOns.length > 0) {
    throw new Error(
      `No se puede re-editar: esta proyección tiene ${addOns.length} servicios add-on agregados durante el año. Eliminarlos requiere acción manual.`
    );
  }

  // Capture downstream counts before deletion (for audit log metadata).
  const counts = await getProjectionDownstreamCounts(ctx, projectionId);

  // Collect projectionService IDs first — needed to cascade into quotations,
  // contracts, and deliverables which index by_projServiceId.
  const projServices = allProjServicesCheck;
  const psIds = projServices.map((ps) => ps._id);

  // Fix 2 (step 0): Delete questionnaireResponses tied to this projection.
  const questionnaires = await ctx.db
    .query("questionnaireResponses")
    .withIndex("by_projectionId", (q) => q.eq("projectionId", projectionId))
    .collect();
  for (const qr of questionnaires) await ctx.db.delete(qr._id);

  // 1. Delete invoices (index by_projectionId).
  const invoices = await ctx.db
    .query("invoices")
    .withIndex("by_projectionId", (q) => q.eq("projectionId", projectionId))
    .collect();
  for (const inv of invoices) await ctx.db.delete(inv._id);

  // 2. Delete deliverables, contracts, quotations (iterate by_projServiceId).
  for (const psid of psIds) {
    const ds = await ctx.db
      .query("deliverables")
      .withIndex("by_projServiceId", (q) => q.eq("projServiceId", psid))
      .collect();
    for (const d of ds) await ctx.db.delete(d._id);

    const cs = await ctx.db
      .query("contracts")
      .withIndex("by_projServiceId", (q) => q.eq("projServiceId", psid))
      .collect();
    for (const c of cs) await ctx.db.delete(c._id);

    const qs = await ctx.db
      .query("quotations")
      .withIndex("by_projServiceId", (q) => q.eq("projServiceId", psid))
      .collect();
    for (const q of qs) await ctx.db.delete(q._id);
  }

  // 3. Delete monthlyAssignments (index by_projectionId).
  const assignments = await ctx.db
    .query("monthlyAssignments")
    .withIndex("by_projectionId", (q) => q.eq("projectionId", projectionId))
    .collect();
  for (const a of assignments) await ctx.db.delete(a._id);

  // 4. Delete projectionServices.
  for (const ps of projServices) await ctx.db.delete(ps._id);

  // 5. Patch the projection row with new top-level fields.
  // The row is set directly to "active" so it shows up in dashboards and the
  // fiscal-close cron (by_orgId_status filter) without needing a separate
  // "promote to active" UI step. Wizard state lives in `projectionDrafts` —
  // the `projections` row is always either active or archived end-state.
  await ctx.db.patch(projectionId, {
    year: newArgs.year,
    annualSales: newArgs.annualSales,
    totalBudget: newArgs.totalBudget,
    commissionRate: newArgs.commissionRate,
    seasonalityData: newArgs.seasonalityData,
    seasonalityOutliers: newArgs.seasonalityOutliers,
    startMonth: newArgs.startMonth,
    projectionMode: newArgs.projectionMode,
    monthCount: newArgs.monthCount,
    effectiveBudget: newArgs.effectiveBudget,
    status: "active" as const,
    updatedAt: Date.now(),
  });

  // 6. Rebuild projectionServices + monthlyAssignments via the shared helper.
  await buildProjectionDownstream(ctx, projectionId, orgId, {
    clientId: newArgs.clientId,
    year: newArgs.year,
    annualSales: newArgs.annualSales,
    totalBudget: newArgs.totalBudget,
    commissionRate: newArgs.commissionRate,
    seasonalityData: newArgs.seasonalityData,
    startMonth: newArgs.startMonth,
    projectionMode: newArgs.projectionMode,
    monthCount: newArgs.monthCount,
    effectiveBudget: newArgs.effectiveBudget,
    serviceConfigs: newArgs.serviceConfigs,
  });

  // 7. Log audit event.
  // Fix 3: include actorUserId so the event is attributed to the user.
  await ctx.db.insert("documentEvents", {
    orgId,
    clientId: proj.clientId,
    entityType: "projection" as const,
    entityId: projectionId,
    eventType: "updated" as const,
    severity: "warning" as const,
    actorType: "user" as const,
    actorUserId: callerUserId,
    message: `Proyección re-editada. Downstream borrado: ${JSON.stringify(counts)}`,
    metadata: counts,
    createdAt: Date.now(),
  });

  return projectionId;
}

export const create = mutation({
  args: {
    clientId: v.id("clients"),
    year: v.number(),
    annualSales: v.number(),
    totalBudget: v.number(),
    commissionRate: v.number(),
    seasonalityData: v.array(
      v.object({
        month: v.number(),
        monthlySales: v.number(),
        feFactor: v.number(),
      })
    ),
    serviceConfigs: v.array(
      v.object({
        serviceId: v.id("services"),
        chosenPct: v.number(),
        isActive: v.boolean(),
        // A1: multi-subservice selection. Required at the UI layer when the
        // parent service has subservices available. Optional so legacy callers
        // and services without subservices keep working.
        subserviceIds: v.optional(v.array(v.id("subservices"))),
        pricingModel: v.optional(
          v.union(
            v.literal("fixed_retainer"),
            v.literal("dynamic_retainer"),
            v.literal("commission"),
            v.literal("one_time")
          )
        ),
      })
    ),
    seasonalityOutliers: v.optional(
      v.array(
        v.object({
          month: v.number(),
          value: v.number(),
          unit: v.union(v.literal("percent"), v.literal("amount")),
        })
      )
    ),
    // C2: projection period fields
    startMonth: v.optional(v.number()),
    projectionMode: v.optional(
      v.union(v.literal("rolling"), v.literal("fiscal"))
    ),
    monthCount: v.optional(v.number()),
    effectiveBudget: v.optional(v.number()),
    previousProjectionId: v.optional(v.id("projections")),
  },
  handler: async (ctx, args) => {
    const identity = await requireAuth(ctx);
    const orgId = await getOrgIdMutation(ctx);

    // Re-edit path: delegate to replaceProjection which cascade-deletes
    // downstream entities and re-runs the engine on the existing projection row.
    if (args.previousProjectionId) {
      return await replaceProjection(ctx, orgId, identity.subject, args.previousProjectionId, args);
    }

    // Verify client belongs to this org
    const client = await ctx.db.get(args.clientId);
    if (!client || client.orgId !== orgId) {
      throw new Error("Cliente no encontrado.");
    }

    // Get service details
    const serviceDetails = await Promise.all(
      args.serviceConfigs.map(async (sc) => {
        const service = await ctx.db.get(sc.serviceId);
        if (!service) throw new Error(`Servicio no encontrado: ${sc.serviceId}`);
        return {
          serviceId: sc.serviceId as string,
          serviceName: service.name,
          type: service.type,
          minPct: service.minPct,
          maxPct: service.maxPct,
          chosenPct: sc.chosenPct,
          isActive: sc.isActive,
          isCommission: service.isCommission ?? false,
        } satisfies ServiceConfig;
      })
    );

    // A1: server-side validation that mirrors the wizard UI contract — if the
    // parent service has any active subservices available (org-scoped or global),
    // the caller MUST pick at least one via subserviceIds.
    for (const sc of args.serviceConfigs) {
      if (!sc.isActive) continue;
      // Pass if subserviceIds array is non-empty
      if (sc.subserviceIds && sc.subserviceIds.length > 0) continue;

      // Inline the listByParent logic instead of ctx.runQuery to keep the
      // mutation transactional (runQuery would open a separate read view).
      const orgScoped = await ctx.db
        .query("subservices")
        .withIndex("by_orgId_parentService", (q) =>
          q.eq("orgId", orgId).eq("parentServiceId", sc.serviceId)
        )
        .filter((q) => q.eq(q.field("isActive"), true))
        .collect();

      const globals = await ctx.db
        .query("subservices")
        .withIndex("by_orgId_parentService", (q) =>
          q.eq("orgId", undefined).eq("parentServiceId", sc.serviceId)
        )
        .filter((q) => q.eq(q.field("isActive"), true))
        .collect();

      const orgSlugs = new Set(orgScoped.map((s) => s.slug));
      const merged = [
        ...orgScoped,
        ...globals.filter((g) => !orgSlugs.has(g.slug)),
      ];

      if (merged.length > 0) {
        const detail = serviceDetails.find(
          (d) => d.serviceId === (sc.serviceId as string)
        );
        const label = detail?.serviceName ?? (sc.serviceId as string);
        throw new Error(
          `El servicio ${label} requiere subservicio. Selecciónalo antes de crear la proyección.`
        );
      }
    }

    const now = Date.now();

    // Create projection record
    const projectionId = await ctx.db.insert("projections", {
      orgId,
      clientId: args.clientId,
      year: args.year,
      annualSales: args.annualSales,
      totalBudget: args.totalBudget,
      commissionRate: args.commissionRate,
      seasonalityData: args.seasonalityData,
      seasonalityOutliers: args.seasonalityOutliers,
      // C2: projection period fields
      startMonth: args.startMonth,
      projectionMode: args.projectionMode,
      monthCount: args.monthCount,
      effectiveBudget: args.effectiveBudget,
      previousProjectionId: args.previousProjectionId,
      // Commit del wizard inserta directo a "active": wizard state vive en
      // projectionDrafts, no necesitamos un "draft" intermedio en projections.
      // Esto desbloquea el cron notifyFiscalCloseEvents que iteraba by_orgId_status.
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    console.log("[projections.create] inserted", {
      projectionId,
      orgId,
      clientId: args.clientId,
      status: "active",
      hasMonthCount: args.monthCount !== undefined,
      hasProjectionMode: args.projectionMode !== undefined,
    });

    // Build downstream rows (projectionServices + monthlyAssignments) via
    // the shared helper — same logic used by replaceProjection.
    await buildProjectionDownstream(ctx, projectionId, orgId, {
      clientId: args.clientId,
      year: args.year,
      annualSales: args.annualSales,
      totalBudget: args.totalBudget,
      commissionRate: args.commissionRate,
      seasonalityData: args.seasonalityData,
      startMonth: args.startMonth,
      projectionMode: args.projectionMode,
      monthCount: args.monthCount,
      effectiveBudget: args.effectiveBudget,
      serviceConfigs: args.serviceConfigs,
    });

    return projectionId;
  },
});

export const recalculate = mutation({
  args: {
    projectionId: v.id("projections"),
    annualSales: v.optional(v.number()),
    totalBudget: v.optional(v.number()),
    commissionRate: v.optional(v.number()),
    seasonalityData: v.optional(
      v.array(
        v.object({
          month: v.number(),
          monthlySales: v.number(),
          feFactor: v.number(),
        })
      )
    ),
    serviceUpdates: v.optional(
      v.array(
        v.object({
          serviceId: v.id("services"),
          chosenPct: v.number(),
          isActive: v.boolean(),
        })
      )
    ),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const orgId = await getOrgIdMutation(ctx);

    const projection = await ctx.db.get(args.projectionId);
    if (!projection || projection.orgId !== orgId) {
      throw new Error("Proyección no encontrada.");
    }

    const annualSales = args.annualSales ?? projection.annualSales;
    const totalBudget = args.totalBudget ?? projection.totalBudget;
    const commissionRate = args.commissionRate ?? projection.commissionRate;
    const seasonality = args.seasonalityData ?? projection.seasonalityData;

    // Recompute effectiveBudget so fiscal projections stay consistent when
    // totalBudget changes. For rolling projections effectiveBudget === totalBudget.
    const monthCount = projection.monthCount ?? 12;
    const projectionMode = projection.projectionMode ?? "rolling";
    // 2026-05-12: dropped proration. See projectionContext.ts for rationale.
    const effectiveBudget = totalBudget;

    // Get existing projection services
    const allExistingProjServices = await ctx.db
      .query("projectionServices")
      .withIndex("by_projectionId", (q) =>
        q.eq("projectionId", args.projectionId)
      )
      .collect();

    // B1 — Exclude mid-year add-ons from recalculate. Add-ons live outside
    // the engine's balancing pool (chosenPct=0, normalizedWeight=0,
    // supplementaryQuotationId set) and must NOT be touched. Without this
    // filter the legacy `find by serviceId` lookup below would collide on
    // duplicate serviceId rows and clobber the base row with the add-on's
    // zero values. Per spec §4.3.
    const existingProjServices = allExistingProjServices.filter(
      (ps) =>
        ps.supplementaryQuotationId === undefined &&
        ps.addOnOfProjectionServiceId === undefined
    );

    // Build service configs (only base rows; add-ons preserved as-is).
    const serviceConfigs: ServiceConfig[] = await Promise.all(
      existingProjServices.map(async (ps) => {
        const service = await ctx.db.get(ps.serviceId);
        const update = args.serviceUpdates?.find(
          (u) => (u.serviceId as string) === (ps.serviceId as string)
        );
        return {
          serviceId: ps.serviceId as string,
          serviceName: ps.serviceName,
          type: service?.type ?? ("base" as const),
          minPct: service?.minPct ?? 0,
          maxPct: service?.maxPct ?? 0,
          chosenPct: update?.chosenPct ?? ps.chosenPct,
          isActive: update?.isActive ?? ps.isActive,
          isCommission: service?.isCommission ?? false,
        };
      })
    );

    // Fetch org config for engine settings
    const orgConfig = await ctx.db
      .query("orgConfigs")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .unique();

    const engineConfig: EngineConfig | undefined = orgConfig
      ? {
          calculationMode: orgConfig.calculationMode,
          commissionMode: orgConfig.commissionMode,
          seasonalityEnabled: orgConfig.seasonalityEnabled,
        }
      : undefined;

    const result = calculateProjection(
      {
        annualSales,
        totalBudget,
        commissionRate,
        services: serviceConfigs,
        seasonalityData: seasonality,
        // C2: pass through projection period fields from the stored record;
        // use the recomputed effectiveBudget so fiscal projections are correct.
        startMonth: projection.startMonth,
        projectionMode: projection.projectionMode,
        monthCount: projection.monthCount,
        effectiveBudget,
      },
      engineConfig
    );

    // Update projection — also persist the recomputed effectiveBudget.
    await ctx.db.patch(args.projectionId, {
      annualSales,
      totalBudget,
      effectiveBudget,
      commissionRate,
      seasonalityData: seasonality,
      updatedAt: Date.now(),
    });

    // Update projection services and delete/recreate monthly assignments
    for (const svc of result.services) {
      const existingPS = existingProjServices.find(
        (ps) => (ps.serviceId as string) === svc.serviceId
      );
      if (!existingPS) continue;

      await ctx.db.patch(existingPS._id, {
        chosenPct: svc.chosenPct,
        isActive: svc.isActive,
        annualAmount: svc.annualAmount,
        normalizedWeight: svc.normalizedWeight,
      });

      // Read existing monthlyAssignments. Capture overridden cells by month
      // so we can preserve their amount + flag through the recompute.
      const existingMAs = await ctx.db
        .query("monthlyAssignments")
        .withIndex("by_projServiceId", (q) =>
          q.eq("projServiceId", existingPS._id)
        )
        .collect();

      const overrideMap = new Map<
        number,
        {
          amount: number;
          status: typeof existingMAs[number]["status"];
          invoiceStatus: typeof existingMAs[number]["invoiceStatus"];
          subserviceId: typeof existingMAs[number]["subserviceId"];
        }
      >();
      for (const ma of existingMAs) {
        if (ma.isManuallyOverridden) {
          overrideMap.set(ma.month, {
            amount: ma.amount,
            status: ma.status,
            invoiceStatus: ma.invoiceStatus,
            subserviceId: ma.subserviceId,
          });
        }
      }

      // KNOWN LIMITATION: when a service is toggled inactive via recalculate,
      // the recreate loop below is skipped (svc.isActive check), so any
      // overridden cells with invoiceStatus="paid" or status="delivered" are
      // permanently destroyed. This is pre-existing behavior amplified by
      // Sub-spec 0 (overrides are now first-class). Follow-up: refuse the
      // toggle when overrideMap contains any invoiceStatus !== "not_invoiced".

      // Delete all existing — we'll recreate using engine output, overlaying
      // overrides where they existed.
      for (const ma of existingMAs) {
        await ctx.db.delete(ma._id);
      }

      // Recreate monthly assignments
      if (svc.isActive) {
        for (const ma of svc.monthlyAmounts) {
          const overridden = overrideMap.get(ma.month);
          await ctx.db.insert("monthlyAssignments", {
            orgId,
            projServiceId: existingPS._id,
            projectionId: args.projectionId,
            clientId: projection.clientId,
            serviceName: svc.serviceName,
            month: ma.month,
            year: projection.year,
            amount: overridden ? overridden.amount : ma.adjustedAmount,
            feFactor: ma.feFactor,
            status: overridden?.status ?? "pending",
            invoiceStatus: overridden?.invoiceStatus ?? "not_invoiced",
            subserviceId: overridden?.subserviceId,
            isManuallyOverridden: !!overridden,
          });
        }

        // If any cell was overridden, re-patch annualAmount to match the
        // actual sum of cells (override amount or engine value). This keeps
        // the matrix row header consistent with the row totals — critical for
        // dynamic_retainer rows where ALL 12 cells are seeded with
        // isManuallyOverridden=true (seed-then-freeze, Task 5), causing the
        // engine's new annualAmount to diverge from the frozen cells.
        // The reduce mirrors the amount-selection logic in the recreate loop
        // above — keep them in sync.
        if (overrideMap.size > 0) {
          const actualAnnualAmount = svc.monthlyAmounts.reduce((sum, ma) => {
            const overridden = overrideMap.get(ma.month);
            return sum + (overridden ? overridden.amount : ma.adjustedAmount);
          }, 0);
          await ctx.db.patch(existingPS._id, { annualAmount: actualAnnualAmount });
        }
      }
    }

    return args.projectionId;
  },
});

export const cloneProjectionToDraft = mutation({
  args: { projectionId: v.id("projections") },
  handler: async (ctx, { projectionId }) => {
    const identity = await requireAuth(ctx);
    const orgId = await getOrgIdMutation(ctx);
    const userId = identity.subject;

    const proj = await ctx.db.get(projectionId);
    if (!proj || proj.orgId !== orgId) {
      throw new Error("Proyección no encontrada.");
    }

    // Hydrate wizard state from existing projection.
    const projServices = await ctx.db
      .query("projectionServices")
      .withIndex("by_projectionId", (q) => q.eq("projectionId", projectionId))
      .collect();

    const serviceStates = projServices.map((ps) => ({
      serviceId: ps.serviceId as string,
      chosenPct: ps.chosenPct,
      isActive: ps.isActive,
    }));

    // Delete any pre-existing draft for the same (orgId, userId, clientId) slot
    // to preserve the unique-per-slot invariant that getMyDraft(.unique()) depends on.
    const existingDraft = await ctx.db
      .query("projectionDrafts")
      .withIndex("by_orgId_userId_clientId", (q) =>
        q.eq("orgId", orgId).eq("userId", userId).eq("clientId", proj.clientId)
      )
      .unique();
    if (existingDraft) {
      await ctx.db.delete(existingDraft._id);
    }

    const draftId = await ctx.db.insert("projectionDrafts", {
      orgId,
      userId,
      clientId: proj.clientId,
      state: {
        step: 0,
        year: proj.year,
        annualSales: proj.annualSales,
        totalBudget: proj.totalBudget,
        commissionRate: proj.commissionRate,
        // Optional fields — only set if the projection has them:
        ...(proj.startMonth !== undefined ? { startMonth: proj.startMonth } : {}),
        ...(proj.projectionMode !== undefined ? { projectionMode: proj.projectionMode } : {}),
        ...(proj.seasonalityOutliers !== undefined
          ? { seasonalityOutliers: proj.seasonalityOutliers }
          : {}),
        serviceStates,
        previousProjectionId: projectionId,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return draftId;
  },
});

type ProjectionStatus = "draft" | "active" | "archived";

const ALLOWED_PROJECTION_STATUS_TRANSITIONS: readonly Transition<ProjectionStatus>[] = [
  ["draft", "active"],
  ["active", "archived"],
  ["archived", "active"],
] as const;

export const updateStatus = mutation({
  args: {
    id: v.id("projections"),
    status: v.union(
      v.literal("draft"),
      v.literal("active"),
      v.literal("archived")
    ),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdMutation(ctx);
    const projection = await ctx.db.get(args.id);
    if (!projection || projection.orgId !== orgId) {
      throw new Error("Proyección no encontrada.");
    }
    assertTransition(
      "projections",
      "status",
      projection.status as ProjectionStatus,
      args.status,
      ALLOWED_PROJECTION_STATUS_TRANSITIONS
    );
    await ctx.db.patch(args.id, {
      status: args.status,
      updatedAt: Date.now(),
    });
  },
});

/**
 * B1 — Agrega un subservicio mid-year a una proyección activa. Crea:
 *  1. fila `projectionServices` con `startMonth`/`endMonth`, chosenPct=0,
 *     normalizedWeight=0 (aislado del engine recalculate).
 *  2. filas `monthlyAssignments` SOLO para los meses de la ventana
 *     (no las 12 del año, intencionalmente).
 *  3. cotización suplementaria vía `quotations.createSupplementary`
 *     (que se enlaza inversamente vía `supplementaryQuotationId`).
 *
 * Reglas de negocio (R1 + spec §2.3):
 *  - Multi-tenant guards explícitos: projection, subservice, parentService.
 *  - Sin add-ons retroactivos en año corriente (mes pasado bloqueado).
 *  - Sin add-ons en proyecciones de años pasados.
 *  - Idempotencia por (projectionId, parentServiceId, subserviceId,
 *    startMonth): segunda llamada devuelve `alreadyExisted: true` con los
 *    mismos ids.
 *  - `parentQuotationId` heurístico = primera cotización APROBADA del
 *    servicio padre en la misma proyección. Sin coincidencia → undefined
 *    (cotización standalone, sin banner UI).
 *
 * Per docs/superpowers/specs/2026-05-26-client-services-overview-design.md §2.3
 */
export const addSubserviceMidYear = mutation({
  args: {
    projectionId: v.id("projections"),
    subserviceId: v.id("subservices"),
    startMonth: v.number(),
    endMonth: v.optional(v.number()),
    monthlyAmount: v.number(),
    notes: v.optional(v.string()),
  },
  returns: v.object({
    projectionServiceId: v.id("projectionServices"),
    quotationId: v.id("quotations"),
    alreadyExisted: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const orgId = await getOrgIdMutation(ctx);

    // 1. Multi-tenant guards.
    const projection = await ctx.db.get(args.projectionId);
    if (!projection || projection.orgId !== orgId) {
      throw new Error("Proyección no encontrada.");
    }
    const subservice = await ctx.db.get(args.subserviceId);
    if (!subservice) {
      throw new Error("Subservicio no encontrado.");
    }
    // Globals tienen orgId undefined; org-scoped DEBE coincidir con el caller.
    if (subservice.orgId && subservice.orgId !== orgId) {
      throw new Error("Subservicio no pertenece a tu org.");
    }
    const parentService = await ctx.db.get(subservice.parentServiceId);
    if (!parentService) {
      throw new Error("Servicio padre no encontrado.");
    }

    // 2. Validar ventana.
    const endMonth = args.endMonth ?? 12;
    if (args.startMonth < 1 || args.startMonth > 12) {
      throw new Error("startMonth debe estar entre 1 y 12.");
    }
    if (endMonth < args.startMonth || endMonth > 12) {
      throw new Error("endMonth debe ser >= startMonth y <= 12.");
    }
    if (!Number.isFinite(args.monthlyAmount) || args.monthlyAmount <= 0) {
      throw new Error("monthlyAmount debe ser un número positivo.");
    }

    // 3. Bloqueo retroactivo (año corriente: mes pasado prohibido; año
    //    pasado: prohibido del todo).
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth() + 1;
    if (projection.year < currentYear) {
      throw new Error(
        "No se permite agregar subservicios a proyecciones de años pasados."
      );
    }
    if (projection.year === currentYear && args.startMonth < currentMonth) {
      throw new Error(
        `No se permiten add-ons retroactivos en beta. startMonth=${args.startMonth} < mes actual=${currentMonth}.`
      );
    }

    // 4. Idempotencia.
    const existing = await ctx.db
      .query("projectionServices")
      .withIndex("by_projectionId_active", (q) =>
        q.eq("projectionId", args.projectionId).eq("isActive", true)
      )
      .collect();
    const dupe = existing.find(
      (ps) =>
        (ps.serviceId as string) === (subservice.parentServiceId as string) &&
        (ps.subserviceIds ?? []).includes(args.subserviceId) &&
        (ps.startMonth ?? 1) === args.startMonth
    );
    if (dupe && dupe.supplementaryQuotationId) {
      return {
        projectionServiceId: dupe._id,
        quotationId: dupe.supplementaryQuotationId,
        alreadyExisted: true,
      };
    }

    // 5. Calcular annualAmount basado en ventana.
    const monthsInWindow = endMonth - args.startMonth + 1;
    const annualAmount = args.monthlyAmount * monthsInWindow;

    // 6. Insertar projectionServices.
    //    chosenPct=0 + normalizedWeight=0 aísla el row del engine de balanceo
    //    (recalculate sólo itera result.services del engine, que filtra
    //    weight=0).
    const projServiceId = await ctx.db.insert("projectionServices", {
      orgId,
      projectionId: args.projectionId,
      serviceId: subservice.parentServiceId,
      serviceName: parentService.name,
      subserviceIds: [args.subserviceId],
      chosenPct: 0,
      isActive: true,
      annualAmount,
      normalizedWeight: 0,
      startMonth: args.startMonth,
      endMonth,
      addOnOfProjectionServiceId: undefined,
      supplementaryQuotationId: undefined, // patcheado en step 10
    });

    // 7. Insertar monthlyAssignments SÓLO para meses de la ventana.
    //    (R1 §12.10 "12 filas siempre" aplica a servicios base, no add-ons.)
    for (let m = args.startMonth; m <= endMonth; m++) {
      await ctx.db.insert("monthlyAssignments", {
        orgId,
        projServiceId,
        projectionId: args.projectionId,
        clientId: projection.clientId,
        serviceName: parentService.name,
        subserviceId: args.subserviceId,
        month: m,
        year: projection.year,
        amount: args.monthlyAmount,
        feFactor: 1, // add-on: monto fijo prorrateado calendario (no seasonality)
        status: "pending" as const,
        invoiceStatus: "not_invoiced" as const,
      });
    }

    // 8. Resolver parentQuotationId — primera APROBADA del servicio padre.
    const parentRowExisting = existing.find(
      (ps) =>
        (ps.serviceId as string) === (subservice.parentServiceId as string)
    );
    let parentQuotationId: Id<"quotations"> | undefined;
    if (parentRowExisting) {
      const q = await ctx.db
        .query("quotations")
        .withIndex("by_projServiceId", (qb) =>
          qb.eq("projServiceId", parentRowExisting._id)
        )
        .filter((qb) => qb.eq(qb.field("status"), "approved"))
        .first();
      parentQuotationId = q?._id;
    }

    // 9. Crear cotización suplementaria (internal mutation).
    const quotationId: Id<"quotations"> = await ctx.runMutation(
      internal.functions.quotations.mutations.createSupplementary,
      {
        projServiceId,
        parentQuotationId,
        startMonth: args.startMonth,
        endMonth,
        monthlyAmount: args.monthlyAmount,
        notes: args.notes,
      }
    );

    // 10. Patch referencia inversa.
    await ctx.db.patch(projServiceId, {
      supplementaryQuotationId: quotationId,
    });

    return {
      projectionServiceId: projServiceId,
      quotationId,
      alreadyExisted: false,
    };
  },
});
