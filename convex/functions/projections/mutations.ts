import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgId, requireAuth } from "../../lib/authHelpers";
import { internal } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";
import {
  calculateProjection,
  generateEvenSeasonality,
  type ServiceConfig,
  type MonthlyData,
  type EngineConfig,
} from "../../lib/projectionEngine";
import { seasonalityDataFromDeltas } from "../../lib/seasonality";
import type { PricingModel } from "../../lib/pricingModel";
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
        // A1: optional subservice selection — required at the UI layer when
        // the parent service has subservices available, but kept optional in
        // the validator so legacy callers + transitional cases (no
        // subservices configured yet) keep working.
        subserviceId: v.optional(v.id("subservices")),
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
    seasonalityDeltas: v.optional(
      v.array(
        v.object({
          month: v.number(),
          deltaPercent: v.number(),
        })
      )
    ),
    seasonalityMode: v.optional(
      v.union(
        v.literal("legacy"),
        v.literal("delta_percent"),
        v.literal("outliers")
      )
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

    // A1 Phase 2 review: server-side validation that mirrors the wizard UI
    // contract — if the parent service has any active subservices available
    // (org-scoped or global), the caller MUST pick one. Prevents bypassing
    // the UI and ending up with projectionServices.subserviceId === undefined
    // when the parent actually has options.
    for (const sc of args.serviceConfigs) {
      if (!sc.isActive) continue;
      if (sc.subserviceId !== undefined) continue;

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
      seasonalityMode:
        args.seasonalityMode ??
        (args.seasonalityOutliers
          ? "outliers"
          : args.seasonalityDeltas
            ? "delta_percent"
            : "legacy"),
      seasonalityOutliers: args.seasonalityOutliers,
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

    console.log("[projections.create] inserted", {
      projectionId,
      orgId,
      clientId: args.clientId,
      status: "draft",
      hasMonthCount: args.monthCount !== undefined,
      hasProjectionMode: args.projectionMode !== undefined,
    });

    // Create projection services and monthly assignments
    for (const svc of result.services) {
      const serviceConfig = args.serviceConfigs.find(
        (sc) => (sc.serviceId as string) === svc.serviceId
      );
      if (!serviceConfig) continue;

      // Resolve pricingModel: explicit override on serviceConfig > subservice.defaultPricingModel
      //                    > derive from service.isCommission
      let resolvedPricingModel: PricingModel | undefined =
        serviceConfig.pricingModel;
      if (!resolvedPricingModel && serviceConfig.subserviceId) {
        const sub = await ctx.db.get(serviceConfig.subserviceId);
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
        subserviceId: serviceConfig.subserviceId,
        chosenPct: svc.chosenPct,
        isActive: svc.isActive,
        annualAmount: svc.annualAmount,
        normalizedWeight: svc.normalizedWeight,
        pricingModel: resolvedPricingModel,
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
    const orgId = await getOrgId(ctx);

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
        ps.subserviceId === args.subserviceId &&
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
      subserviceId: args.subserviceId,
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
