import type { MutationCtx } from "../_generated/server";
import type { Id, Doc } from "../_generated/dataModel";
import {
  calculateProjection,
  generateEvenSeasonality,
  type ServiceConfig,
  type EngineConfig,
  type MonthlyData,
} from "./projectionEngine";
import { seasonalityDataFromDeltas } from "./seasonality";
import type { PricingModel } from "./pricingModel";

/**
 * Given an existing projection row, replaces its derived rows
 * (projectionServices + monthlyAssignments) based on the draft state.
 *
 * Does NOT delete downstream entities (quotations / contracts / etc.) —
 * callers must handle that separately (see replaceProjection).
 *
 * Does NOT insert into the `projections` table — the projection row must
 * already exist. Callers that want to update top-level fields (annualSales,
 * totalBudget, etc.) should patch the projection row themselves after calling
 * this helper.
 *
 * Does NOT delete the draft — the caller (commitDraft) is responsible for
 * that.
 *
 * Behavior mirrors the projectionServices + monthlyAssignments insertion
 * block in `projections.create` (convex/functions/projections/mutations.ts).
 * CRITICAL: Do not diverge from that logic — FE factors, commission
 * distribution, budget weights, and seasonality semantics must stay
 * identical.
 */
export async function applyDraftStateToProjection(
  ctx: MutationCtx,
  projectionId: Id<"projections">,
  state: Doc<"projectionDrafts">["state"]
): Promise<void> {
  // Load the existing projection to get context values (orgId, clientId, year)
  // that are not stored in the draft state.
  const projection = await ctx.db.get(projectionId);
  if (!projection) {
    throw new Error(`Proyección no encontrada: ${projectionId}`);
  }
  const orgId = projection.orgId;
  const clientId = projection.clientId;
  const year = state.year ?? projection.year;

  // Resolve numeric engine inputs from state, falling back to the stored
  // projection values. This matches commitDraft's semantics where the wizard
  // always supplies these fields before submitting.
  const annualSales = state.annualSales ?? projection.annualSales;
  const totalBudget = state.totalBudget ?? projection.totalBudget;
  const commissionRate = state.commissionRate ?? projection.commissionRate;

  // Build ServiceConfig[] from the draft's serviceStates.
  // Note: the draft schema does not store subserviceId per-service (the
  // wizard keeps it in component-local state, not persisted to the draft).
  // This is by design — re-edit projections start without subservice
  // selection. Operators can re-assign from the matrix view.
  const serviceStates = state.serviceStates ?? [];
  const serviceDetails: ServiceConfig[] = await Promise.all(
    serviceStates.map(async (ss) => {
      const service = await ctx.db.get(ss.serviceId as Id<"services">);
      if (!service) {
        throw new Error(`Servicio no encontrado: ${ss.serviceId}`);
      }
      return {
        serviceId: ss.serviceId,
        serviceName: service.name,
        type: service.type,
        minPct: service.minPct,
        maxPct: service.maxPct,
        chosenPct: ss.chosenPct,
        isActive: ss.isActive,
        isCommission: service.isCommission ?? false,
      } satisfies ServiceConfig;
    })
  );

  // Resolve seasonality: prefer deltas from state, then projection, then
  // even spread. Mirrors the same priority order in projections.create.
  const seasonality: MonthlyData[] =
    state.seasonalityDeltas && state.seasonalityDeltas.length === 12
      ? seasonalityDataFromDeltas(annualSales, state.seasonalityDeltas)
      : projection.seasonalityData.length === 12
        ? projection.seasonalityData
        : generateEvenSeasonality(annualSales);

  // Fetch org config for engine settings.
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

  // Calculate projection — same call as in projections.create.
  const result = calculateProjection(
    {
      annualSales,
      totalBudget,
      commissionRate,
      services: serviceDetails,
      seasonalityData: seasonality,
      // C2: projection period fields (taken from state when present, then
      // from the existing projection row).
      startMonth: state.startMonth ?? projection.startMonth,
      projectionMode: state.projectionMode ?? projection.projectionMode,
      monthCount: projection.monthCount,
      effectiveBudget: projection.effectiveBudget,
    },
    engineConfig
  );

  // Insert projectionServices + monthlyAssignments — verbatim from the
  // corresponding block in projections.create (lines 238-291).
  for (const svc of result.services) {
    const serviceState = serviceStates.find(
      (ss) => ss.serviceId === svc.serviceId
    );
    if (!serviceState) continue;

    // Resolve pricingModel: no subserviceId in draft state, so we fall
    // straight to the service-level isCommission check. This mirrors the
    // last branch of the three-step resolution in projections.create.
    let resolvedPricingModel: PricingModel | undefined;
    // No serviceState.subserviceId in draft schema → skip sub lookup.
    if (!resolvedPricingModel) {
      const svcRow = await ctx.db.get(serviceState.serviceId as Id<"services">);
      resolvedPricingModel = svcRow?.isCommission
        ? "commission"
        : "fixed_retainer";
    }

    const projServiceId = await ctx.db.insert("projectionServices", {
      orgId,
      projectionId,
      serviceId: serviceState.serviceId as Id<"services">,
      serviceName: svc.serviceName,
      // subserviceId intentionally omitted — not stored in draft state.
      // Operator assigns per-cell from the projection matrix view.
      chosenPct: svc.chosenPct,
      isActive: svc.isActive,
      annualAmount: svc.annualAmount,
      normalizedWeight: svc.normalizedWeight,
      pricingModel: resolvedPricingModel,
    });

    // Create monthly assignments for active services.
    if (svc.isActive) {
      for (const ma of svc.monthlyAmounts) {
        await ctx.db.insert("monthlyAssignments", {
          orgId,
          projServiceId,
          projectionId,
          clientId,
          serviceName: svc.serviceName,
          // subserviceId: undefined — operator picks per-cell from matrix.
          // Spec: docs/superpowers/specs/2026-05-22-monthly-subservice-selection-design.md
          month: ma.month,
          year,
          amount: ma.adjustedAmount,
          feFactor: ma.feFactor,
          status: "pending",
          invoiceStatus: "not_invoiced",
          isManuallyOverridden: resolvedPricingModel === "dynamic_retainer",
        });
      }
    }
  }
}
