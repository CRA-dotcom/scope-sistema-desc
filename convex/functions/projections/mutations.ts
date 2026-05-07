import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgId, requireAuth } from "../../lib/authHelpers";
import {
  calculateProjection,
  generateEvenSeasonality,
  type ServiceConfig,
  type MonthlyData,
  type EngineConfig,
} from "../../lib/projectionEngine";
import { seasonalityDataFromDeltas } from "../../lib/seasonality";
// Note: convex/lib/seasonality.ts is a pure TS file with no browser-only APIs,
// safe to import in Convex server functions.

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
      })
    ),
    seasonalityDeltas: v.optional(
      v.array(
        v.object({
          month: v.number(),
          deltaPercent: v.number(),
        })
      )
    ),
    seasonalityMode: v.optional(
      v.union(v.literal("legacy"), v.literal("delta_percent"))
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
    await requireAuth(ctx);
    const orgId = await getOrgId(ctx);

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

    // Resolve seasonality: if deltas provided, compute from them; else use raw data or even spread
    const seasonality: MonthlyData[] =
      args.seasonalityDeltas && args.seasonalityDeltas.length === 12
        ? seasonalityDataFromDeltas(args.annualSales, args.seasonalityDeltas)
        : args.seasonalityData.length === 12
          ? args.seasonalityData
          : generateEvenSeasonality(args.annualSales);

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

    // Calculate projection
    const result = calculateProjection(
      {
        annualSales: args.annualSales,
        totalBudget: args.totalBudget,
        commissionRate: args.commissionRate,
        services: serviceDetails,
        seasonalityData: seasonality,
        // C2: pass projection period fields so the engine generates the correct
        // month slice and uses effectiveBudget for fiscal projections
        startMonth: args.startMonth,
        projectionMode: args.projectionMode,
        monthCount: args.monthCount,
        effectiveBudget: args.effectiveBudget,
      },
      engineConfig
    );

    const now = Date.now();

    // Create projection record
    const projectionId = await ctx.db.insert("projections", {
      orgId,
      clientId: args.clientId,
      year: args.year,
      annualSales: args.annualSales,
      totalBudget: args.totalBudget,
      commissionRate: args.commissionRate,
      seasonalityData: seasonality,
      seasonalityDeltas: args.seasonalityDeltas,
      seasonalityMode: args.seasonalityMode ?? (args.seasonalityDeltas ? "delta_percent" : "legacy"),
      // C2: projection period fields
      startMonth: args.startMonth,
      projectionMode: args.projectionMode,
      monthCount: args.monthCount,
      effectiveBudget: args.effectiveBudget,
      previousProjectionId: args.previousProjectionId,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });

    // Create projection services and monthly assignments
    for (const svc of result.services) {
      const serviceConfig = args.serviceConfigs.find(
        (sc) => (sc.serviceId as string) === svc.serviceId
      );
      if (!serviceConfig) continue;

      const projServiceId = await ctx.db.insert("projectionServices", {
        orgId,
        projectionId,
        serviceId: serviceConfig.serviceId,
        serviceName: svc.serviceName,
        chosenPct: svc.chosenPct,
        isActive: svc.isActive,
        annualAmount: svc.annualAmount,
        normalizedWeight: svc.normalizedWeight,
      });

      // Create monthly assignments for active services
      if (svc.isActive) {
        for (const ma of svc.monthlyAmounts) {
          await ctx.db.insert("monthlyAssignments", {
            orgId,
            projServiceId,
            projectionId,
            clientId: args.clientId,
            serviceName: svc.serviceName,
            month: ma.month,
            year: args.year,
            amount: ma.adjustedAmount,
            feFactor: ma.feFactor,
            status: "pending",
            invoiceStatus: "not_invoiced",
          });
        }
      }
    }

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
    const orgId = await getOrgId(ctx);

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
    const effectiveBudget =
      projectionMode === "fiscal"
        ? totalBudget * (monthCount / 12)
        : totalBudget;

    // Get existing projection services
    const existingProjServices = await ctx.db
      .query("projectionServices")
      .withIndex("by_projectionId", (q) =>
        q.eq("projectionId", args.projectionId)
      )
      .collect();

    // Build service configs
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

      // Delete existing monthly assignments for this service
      const existingMAs = await ctx.db
        .query("monthlyAssignments")
        .withIndex("by_projServiceId", (q) =>
          q.eq("projServiceId", existingPS._id)
        )
        .collect();

      for (const ma of existingMAs) {
        await ctx.db.delete(ma._id);
      }

      // Recreate monthly assignments
      if (svc.isActive) {
        for (const ma of svc.monthlyAmounts) {
          await ctx.db.insert("monthlyAssignments", {
            orgId,
            projServiceId: existingPS._id,
            projectionId: args.projectionId,
            clientId: projection.clientId,
            serviceName: svc.serviceName,
            month: ma.month,
            year: projection.year,
            amount: ma.adjustedAmount,
            feFactor: ma.feFactor,
            status: "pending",
            invoiceStatus: "not_invoiced",
          });
        }
      }
    }

    return args.projectionId;
  },
});

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
    const orgId = await getOrgId(ctx);
    const projection = await ctx.db.get(args.id);
    if (!projection || projection.orgId !== orgId) {
      throw new Error("Proyección no encontrada.");
    }
    await ctx.db.patch(args.id, {
      status: args.status,
      updatedAt: Date.now(),
    });
  },
});
