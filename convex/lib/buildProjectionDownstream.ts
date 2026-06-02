import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import {
  calculateProjection,
  generateEvenSeasonality,
  type ServiceConfig,
  type EngineConfig,
  type MonthlyData,
} from "./projectionEngine";
import type { PricingModel } from "./pricingModel";

/**
 * Shared "build downstream" helper — inserts projectionServices +
 * monthlyAssignments for an already-existing projection row.
 *
 * Called by BOTH creation paths:
 *  1. `projections.create` — after inserting the new projection row.
 *  2. `replaceProjection`  — after cascade-deleting downstream and patching
 *     the projection row.
 *
 * Does NOT insert/patch the `projections` row — callers handle that.
 * Does NOT run the subservice-required validation — that is a create-path
 * guard that runs BEFORE this helper is called.
 * Returns void — caller already has projectionId.
 */
export async function buildProjectionDownstream(
  ctx: MutationCtx,
  projectionId: Id<"projections">,
  orgId: string,
  args: {
    clientId: Id<"clients">;
    year: number;
    annualSales: number;
    totalBudget: number;
    commissionRate: number;
    seasonalityData: Array<{
      month: number;
      monthlySales: number;
      feFactor: number;
    }>;
    startMonth?: number;
    projectionMode?: "rolling" | "fiscal";
    monthCount?: number;
    effectiveBudget?: number;
    serviceConfigs: Array<{
      serviceId: Id<"services">;
      chosenPct: number;
      isActive: boolean;
      subserviceId?: Id<"subservices">;
      subserviceIds?: Array<Id<"subservices">>;
      pricingModel?: PricingModel;
    }>;
  }
): Promise<void> {
  // Build ServiceConfig[] — fetch service details for each config.
  const serviceDetails: ServiceConfig[] = await Promise.all(
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

  // Resolve seasonality: prefer raw data array, then even spread.
  const seasonality: MonthlyData[] =
    args.seasonalityData.length === 12
      ? args.seasonalityData
      : generateEvenSeasonality(args.annualSales);

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

  // Run the projection engine.
  const result = calculateProjection(
    {
      annualSales: args.annualSales,
      totalBudget: args.totalBudget,
      commissionRate: args.commissionRate,
      services: serviceDetails,
      seasonalityData: seasonality,
      startMonth: args.startMonth,
      projectionMode: args.projectionMode,
      monthCount: args.monthCount,
      effectiveBudget: args.effectiveBudget,
    },
    engineConfig
  );

  // Insert projectionServices + monthlyAssignments.
  for (const svc of result.services) {
    const serviceConfig = args.serviceConfigs.find(
      (sc) => (sc.serviceId as string) === svc.serviceId
    );
    if (!serviceConfig) continue;

    // Resolve effectiveSubserviceIds: prefer subserviceIds array, fall back
    // to scalar subserviceId, fall back to empty.
    const effectiveSubserviceIds: Array<Id<"subservices">> =
      serviceConfig.subserviceIds && serviceConfig.subserviceIds.length > 0
        ? serviceConfig.subserviceIds
        : serviceConfig.subserviceId
          ? [serviceConfig.subserviceId]
          : [];
    // Legacy scalar: first element of the resolved list (or undefined).
    const legacySubserviceId: Id<"subservices"> | undefined =
      effectiveSubserviceIds[0];

    // Resolve pricingModel: explicit override > subservice.defaultPricingModel
    //                      > derive from service.isCommission.
    let resolvedPricingModel: PricingModel | undefined = serviceConfig.pricingModel;
    if (!resolvedPricingModel && legacySubserviceId) {
      const sub = await ctx.db.get(legacySubserviceId);
      resolvedPricingModel = sub?.defaultPricingModel;
    }
    if (!resolvedPricingModel) {
      const svcRow = await ctx.db.get(serviceConfig.serviceId);
      resolvedPricingModel = svcRow?.isCommission ? "commission" : "fixed_retainer";
    }

    const projServiceId = await ctx.db.insert("projectionServices", {
      orgId,
      projectionId,
      serviceId: serviceConfig.serviceId,
      serviceName: svc.serviceName,
      subserviceId: legacySubserviceId,
      subserviceIds:
        effectiveSubserviceIds.length > 0 ? effectiveSubserviceIds : undefined,
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
          clientId: args.clientId,
          serviceName: svc.serviceName,
          // subserviceId: undefined — operator picks per-cell from matrix.
          // Spec: docs/superpowers/specs/2026-05-22-monthly-subservice-selection-design.md
          month: ma.month,
          year: args.year,
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
