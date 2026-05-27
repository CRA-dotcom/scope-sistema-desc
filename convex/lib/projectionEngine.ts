/**
 * Projex Projection Engine
 * Pure functions replicating the Excel calculator logic.
 * No side effects - all functions take data in and return results.
 */

import { resolveProjectionContext, resolveProjectionMonths } from "./projectionContext";
import type { PricingModel } from "./pricingModel";

export type ServiceConfig = {
  serviceId: string;
  serviceName: string;
  type: "base" | "comodin";
  minPct: number;
  maxPct: number;
  chosenPct: number;
  isActive: boolean;
  isCommission?: boolean;
  fixedMonthlyAmount?: number;
  pricingModel?: PricingModel;
  /** B1 — contractual window. undefined = active all year (legacy default). */
  startMonth?: number;
  /** B1 — contractual window end (inclusive). undefined = through month 12. */
  endMonth?: number;
};

export type EngineConfig = {
  calculationMode: "weighted" | "fixed";
  commissionMode: "proportional" | "fixed_monthly";
  seasonalityEnabled: boolean;
};

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  calculationMode: "weighted",
  commissionMode: "proportional",
  seasonalityEnabled: true,
};

export type MonthlyData = {
  month: number; // 1-12
  monthlySales: number;
  feFactor: number;
};

export type ProjectionInput = {
  annualSales: number;
  totalBudget: number;
  commissionRate: number;
  services: ServiceConfig[];
  seasonalityData: MonthlyData[]; // can be 12 entries OR exactly monthCount entries
  // NEW optional: fiscal/rolling mode support
  monthCount?: number;       // default 12
  startMonth?: number;       // default 1
  effectiveBudget?: number;  // default totalBudget
  projectionMode?: "rolling" | "fiscal"; // informational; default "rolling"
};

export type ServiceAllocation = {
  serviceId: string;
  serviceName: string;
  type: "base" | "comodin";
  chosenPct: number;
  isActive: boolean;
  isCommission?: boolean;
  normalizedWeight: number;
  annualAmount: number;
  monthlyAmounts: MonthlyAmount[];
};

export type MonthlyAmount = {
  month: number;
  baseAmount: number;
  feFactor: number;
  adjustedAmount: number;
};

export type ProjectionResult = {
  annualCommissions: number;
  remainingBudget: number;
  services: ServiceAllocation[];
  monthlyTotals: { month: number; total: number }[];
  grandTotal: number;
};

/**
 * Calculate seasonality factor for a month.
 * FE = Monthly Sales / (Annual Sales / 12)
 * FE > 1 = high season, FE < 1 = low season
 */
export function calculateFeFactor(
  monthlySales: number,
  annualSales: number
): number {
  const monthlyAvg = annualSales / 12;
  if (monthlyAvg === 0) return 1;
  return monthlySales / monthlyAvg;
}

/**
 * Generate FE factors from 12 monthly sales values.
 */
export function generateSeasonalityData(
  monthlySalesArray: number[],
  annualSales: number
): MonthlyData[] {
  return monthlySalesArray.map((sales, i) => ({
    month: i + 1,
    monthlySales: sales,
    feFactor: calculateFeFactor(sales, annualSales),
  }));
}

/**
 * Generate even distribution (no seasonality) - default.
 */
export function generateEvenSeasonality(annualSales: number): MonthlyData[] {
  const monthly = annualSales / 12;
  return Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    monthlySales: monthly,
    feFactor: 1,
  }));
}

/**
 * Returns true when the given calendar month falls within the service's
 * contractual window [startMonth..endMonth].
 * Defaults: startMonth=1, endMonth=12 (full year — legacy behaviour).
 */
function isMonthInWindow(
  month: number,
  startMonth: number | undefined,
  endMonth: number | undefined
): boolean {
  const lo = startMonth ?? 1;
  const hi = endMonth ?? 12;
  return month >= lo && month <= hi;
}

/**
 * Main projection calculation.
 * Replicates Excel Hoja 3 (Matriz de Proyección) logic.
 *
 * Supports fiscal/rolling mode via optional monthCount, startMonth,
 * effectiveBudget, and projectionMode. Legacy callers that omit these
 * fields receive identical 12-month, full-budget behavior as before.
 */
export function calculateProjection(
  input: ProjectionInput,
  config?: EngineConfig
): ProjectionResult {
  const resolvedConfig = config ?? DEFAULT_ENGINE_CONFIG;
  const { annualSales, commissionRate, services } = input;

  // Derive context — handles defaults for legacy callers
  const ctx = resolveProjectionContext({
    totalBudget: input.totalBudget,
    year: 0, // year not needed for arithmetic
    startMonth: input.startMonth,
    projectionMode: input.projectionMode,
    monthCount: input.monthCount,
    effectiveBudget: input.effectiveBudget,
  });

  const projectionMonths = resolveProjectionMonths(ctx.startMonth, ctx.monthCount);

  // Filter seasonality to only the months covered by this projection.
  // If user already provided exactly monthCount entries matching the projection
  // months, use them as-is. Otherwise extract the relevant entries from the
  // full 12-month array.
  const fullSeasonality = input.seasonalityData;
  const filteredSeasonality: MonthlyData[] =
    fullSeasonality.length === ctx.monthCount &&
    fullSeasonality.every((m, i) => m.month === projectionMonths[i])
      ? fullSeasonality
      : projectionMonths.map((m) => {
          const found = fullSeasonality.find((s) => s.month === m);
          if (!found) {
            throw new Error(
              `seasonalityData missing entry for month ${m} (projection covers ${projectionMonths.join(",")})`
            );
          }
          return found;
        });

  // Apply seasonality override: when disabled, force all FE factors to 1
  const effectiveSeasonality: MonthlyData[] = resolvedConfig.seasonalityEnabled
    ? filteredSeasonality
    : filteredSeasonality.map((m) => ({ ...m, feFactor: 1 }));

  // Step 1: Annual commissions — only deducted when a commission service is
  // actively contracted. Per 2026-05-12 partner clarification: "tasa de comisión
  // solo aplica para conceptos de comisión, intermediación mercantil"; if no
  // commission service is active, the rate has no effect on the budget.
  // Prorated to monthCount (rolling: monthCount/12=1; fiscal: <1).
  const hasActiveCommissionService = services.some(
    (s) => s.isCommission === true && s.isActive
  );
  const annualCommissions = hasActiveCommissionService
    ? annualSales * commissionRate * (ctx.monthCount / 12)
    : 0;

  // Step 2: Remaining budget (excluding commissions).
  // ctx.effectiveBudget always equals totalBudget post-2026-05-12 (proration removed).
  const remainingBudget = ctx.effectiveBudget - annualCommissions;

  // Step 3: Get active non-commission services
  const activeServices = services.filter(
    (s) => s.isActive && !s.isCommission
  );

  // Step 4: Sum weights of active services (excl. commission service)
  const totalWeight = activeServices.reduce((sum, s) => sum + s.chosenPct, 0);

  // Step 5: Calculate allocations
  const serviceAllocations: ServiceAllocation[] = services.map((service) => {
    if (!service.isActive) {
      return {
        serviceId: service.serviceId,
        serviceName: service.serviceName,
        type: service.type,
        chosenPct: service.chosenPct,
        isActive: false,
        normalizedWeight: 0,
        annualAmount: 0,
        monthlyAmounts: effectiveSeasonality.map((m) => ({
          month: m.month,
          baseAmount: 0,
          feFactor: m.feFactor,
          adjustedAmount: 0,
        })),
      };
    }

    if (service.isCommission === true) {
      if (resolvedConfig.commissionMode === "fixed_monthly") {
        // Fixed monthly commission: commissionRate * effectiveBudget / monthCount per month.
        // For legacy callers: effectiveBudget = totalBudget, monthCount = 12 → same as before.
        const fixedMonthly = (commissionRate * ctx.effectiveBudget) / ctx.monthCount;
        const monthlyAmounts: MonthlyAmount[] = effectiveSeasonality.map((m) => ({
          month: m.month,
          baseAmount: fixedMonthly,
          feFactor: m.feFactor,
          adjustedAmount: fixedMonthly,
        }));

        return {
          serviceId: service.serviceId,
          serviceName: service.serviceName,
          type: service.type,
          chosenPct: commissionRate,
          isActive: true,
          normalizedWeight: 0,
          annualAmount: annualCommissions,
          monthlyAmounts,
        };
      }

      // Proportional commission: per-month commission = m.monthlySales * commissionRate.
      // Loop only covers effectiveSeasonality (N entries), so only months in scope are summed.
      const monthlyAmounts: MonthlyAmount[] = effectiveSeasonality.map((m) => {
        const monthlyCommission = m.monthlySales * commissionRate;
        return {
          month: m.month,
          baseAmount: monthlyCommission,
          feFactor: m.feFactor,
          adjustedAmount: monthlyCommission,
        };
      });

      return {
        serviceId: service.serviceId,
        serviceName: service.serviceName,
        type: service.type,
        chosenPct: commissionRate,
        isActive: true,
        normalizedWeight: 0,
        annualAmount: annualCommissions,
        monthlyAmounts,
      };
    }

    if (service.pricingModel === "one_time") {
      // one_time: annualAmount entero se cobra en startMonth del servicio
      // (o en el primer mes del scope si startMonth es undefined — legacy).
      // Resto de meses = 0. Sin FE adjustment (es un único cobro fijo).
      const normalizedWeight = totalWeight > 0 ? service.chosenPct / totalWeight : 0;
      const annualAmount = remainingBudget * normalizedWeight;
      // Per-service startMonth overrides projection-level first month.
      const chargeMonth = service.startMonth ?? effectiveSeasonality[0].month;

      const monthlyAmounts: MonthlyAmount[] = effectiveSeasonality.map((m) => {
        const isCharge =
          m.month === chargeMonth &&
          isMonthInWindow(m.month, service.startMonth, service.endMonth);
        return {
          month: m.month,
          baseAmount: isCharge ? annualAmount : 0,
          feFactor: m.feFactor,
          adjustedAmount: isCharge ? annualAmount : 0,
        };
      });

      return {
        serviceId: service.serviceId,
        serviceName: service.serviceName,
        type: service.type,
        chosenPct: service.chosenPct,
        isActive: true,
        normalizedWeight,
        annualAmount,
        monthlyAmounts,
      };
    }

    if (resolvedConfig.calculationMode === "fixed") {
      // Fixed mode: use fixedMonthlyAmount, no weight normalization, no FE adjustment.
      // annualAmount spans only the monthCount months covered (and within the window).
      const fixedMonthly = service.fixedMonthlyAmount ?? 0;
      const eligibleMonths = effectiveSeasonality.filter((m) =>
        isMonthInWindow(m.month, service.startMonth, service.endMonth)
      );
      const annualAmount = fixedMonthly * eligibleMonths.length;

      const monthlyAmounts: MonthlyAmount[] = effectiveSeasonality.map((m) => {
        const inWindow = isMonthInWindow(m.month, service.startMonth, service.endMonth);
        return {
          month: m.month,
          baseAmount: inWindow ? fixedMonthly : 0,
          feFactor: m.feFactor,
          adjustedAmount: inWindow ? fixedMonthly : 0,
        };
      });

      return {
        serviceId: service.serviceId,
        serviceName: service.serviceName,
        type: service.type,
        chosenPct: service.chosenPct,
        isActive: true,
        normalizedWeight: 0,
        annualAmount,
        monthlyAmounts,
      };
    }

    // Normal service: weight-based distribution over effectiveBudget.
    const normalizedWeight = totalWeight > 0 ? service.chosenPct / totalWeight : 0;
    const annualAmount = remainingBudget * normalizedWeight;
    // 2026-05-22: dynamic monthlyBase. Garantiza sum(adjustedAmount) ===
    // annualAmount independiente de la calibracion de feFactor. Si
    // sum(feFactor)===monthCount (caso comun), el resultado es identico al
    // viejo. Si sum(feFactor) esta calibrado relativo al annualSales/12 con
    // datos inconsistentes (bug Katimi 2026-05-22 — sum(feFactor in slice)=1.04
    // cuando monthCount=8), el factor adaptativo evita concentracion patologica
    // del drift en un solo mes via Step 5b.
    // Spec: docs/superpowers/specs/2026-05-22-engine-fefactor-rescale-design.md
    //
    // SS3: when a per-service contractual window is set, re-normalise FE over
    // eligible months only so sum(adjustedAmount over window) === annualAmount.
    const eligibleMonthsWeighted = effectiveSeasonality.filter((m) =>
      isMonthInWindow(m.month, service.startMonth, service.endMonth)
    );
    const sumFE = eligibleMonthsWeighted.reduce((s, m) => s + m.feFactor, 0);
    // F7: if sumFE is pathologically tiny (e.g. single month with FE=0.001),
    // division would amplify annualAmount by 1000×. Fall back to uniform
    // distribution over eligible months so no cell blows up in magnitude.
    const MIN_SUMFE = 0.1;
    const monthlyBase =
      sumFE >= MIN_SUMFE
        ? annualAmount / sumFE
        : eligibleMonthsWeighted.length > 0
          ? (console.warn(
              `[projectionEngine] sumFE=${sumFE} < ${MIN_SUMFE} for service ${service.serviceId} — falling back to uniform distribution over ${eligibleMonthsWeighted.length} eligible months`
            ),
            annualAmount / eligibleMonthsWeighted.length)
          : 0;

    const monthlyAmounts: MonthlyAmount[] = effectiveSeasonality.map((m) => {
      const inWindow = isMonthInWindow(m.month, service.startMonth, service.endMonth);
      return {
        month: m.month,
        baseAmount: inWindow ? monthlyBase : 0,
        feFactor: m.feFactor,
        adjustedAmount: inWindow ? monthlyBase * m.feFactor : 0,
      };
    });

    return {
      serviceId: service.serviceId,
      serviceName: service.serviceName,
      type: service.type,
      chosenPct: service.chosenPct,
      isActive: true,
      normalizedWeight,
      annualAmount,
      monthlyAmounts,
    };
  });

  // Step 5b: Defensive residual reconciliation.
  //
  // Two distinct drift sources to close:
  //   (1) Annual drift: IEEE 754 drift in `remainingBudget * normalizedWeight`
  //       is sub-nanocent (~4.7e-10 max measured at $24M scale). Guard so
  //       sum(base annualAmount) === remainingBudget at exactly $0.01 tolerance.
  //   (2) Monthly drift (2026-05-12, sub-proyecto C): when a fiscal slice's
  //       feFactor sum != monthCount, each service has its own
  //       monthly drift = annualAmount - sum(monthlyBase * feFactor in slice).
  //       Reconcile this PER SERVICE on the highest-feFactor month so
  //       sum(monthlyTotals) === remainingBudget regardless of seasonality
  //       interacting with fiscal slicing.
  //
  // Filter `normalizedWeight > 0` excludes inactives (weight=0), commissions
  // (weight=0), and fixed-mode services.
  // one_time services are excluded from baseAllocations because their share of
  // remainingBudget is already concentrated in month 1 — the drift target for
  // base allocations must subtract their sum to avoid inflating the heaviest
  // retainer with the one_time portion.
  const oneTimeServiceIds = new Set<string>(
    input.services
      .filter((cfg) => cfg.pricingModel === "one_time")
      .map((cfg) => cfg.serviceId)
  );
  const baseAllocations = serviceAllocations.filter(
    (s) => s.normalizedWeight > 0 && !oneTimeServiceIds.has(s.serviceId)
  );
  if (baseAllocations.length > 0) {
    // (1) Annual drift: adjust the heaviest service only.
    // Subtract one_time allocations from the target so the drift is measured
    // only against the portion of remainingBudget owned by base allocations.
    const oneTimeSum = serviceAllocations
      .filter((s) => oneTimeServiceIds.has(s.serviceId))
      .reduce((acc, s) => acc + s.annualAmount, 0);
    const sumBase = baseAllocations.reduce((acc, s) => acc + s.annualAmount, 0);
    const expectedBase = remainingBudget - oneTimeSum;
    const drift = expectedBase - sumBase;
    if (Math.abs(drift) > 0) {
      const heaviest = baseAllocations.reduce((max, s) =>
        s.normalizedWeight > max.normalizedWeight ? s : max
      );
      heaviest.annualAmount += drift;
    }

    // (2) Drift residual: con el monthlyBase dinamico de Step 5, drift teorico = 0.
    // Solo queda drift IEEE 754 (sub-cent). Distribuir proporcional por feFactor
    // (no all-to-heaviest) para que ningun mes absorba magnitudes inesperadas
    // — esto era el bug Katimi pre-2026-05-22 cuando feFactors estaban mal calibrados.
    // Spec: docs/superpowers/specs/2026-05-22-engine-fefactor-rescale-design.md
    //
    // SS3: only distribute residual among in-window months (those with baseAmount > 0
    // or whose feFactor was included in the sumFE denominator). Out-of-window months
    // must remain at 0 — distributing drift there would break the window guarantee.
    for (const svc of baseAllocations) {
      if (svc.monthlyAmounts.length === 0) continue;
      const monthlySum = svc.monthlyAmounts.reduce((a, m) => a + m.adjustedAmount, 0);
      const monthlyDrift = svc.annualAmount - monthlySum;
      if (Math.abs(monthlyDrift) === 0) continue;
      // Only in-window months (baseAmount > 0) participate in drift distribution.
      const inWindowMonths = svc.monthlyAmounts.filter((m) => m.baseAmount > 0);
      const svcSumFE = inWindowMonths.reduce((s, m) => s + m.feFactor, 0);
      if (svcSumFE > 0) {
        for (const m of inWindowMonths) {
          m.adjustedAmount += monthlyDrift * (m.feFactor / svcSumFE);
        }
      } else if (inWindowMonths.length > 0) {
        const perMonth = monthlyDrift / inWindowMonths.length;
        for (const m of inWindowMonths) m.adjustedAmount += perMonth;
      }
    }
  }

  // Step 6: Monthly totals — iterates effectiveSeasonality (N entries, not always 12)
  const monthlyTotals = effectiveSeasonality.map((m) => ({
    month: m.month,
    total: serviceAllocations.reduce(
      (sum, s) =>
        sum +
        (s.monthlyAmounts.find((ma) => ma.month === m.month)?.adjustedAmount ??
          0),
      0
    ),
  }));

  const grandTotal = serviceAllocations.reduce(
    (sum, s) => sum + s.annualAmount,
    0
  );

  return {
    annualCommissions,
    remainingBudget,
    services: serviceAllocations,
    monthlyTotals,
    grandTotal,
  };
}

/**
 * Validate that no service exceeds its max percentage of annual revenue.
 */
export function validateServiceLimits(
  services: ServiceAllocation[],
  serviceConfigs: ServiceConfig[],
  annualSales: number
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];

  for (const service of services) {
    const config = serviceConfigs.find((c) => c.serviceId === service.serviceId);
    if (!service.isActive || !config || config.isCommission) continue;

    const pctOfRevenue = annualSales > 0 ? service.annualAmount / annualSales : 0;
    if (pctOfRevenue > config.maxPct) {
      violations.push(
        `${service.serviceName}: ${(pctOfRevenue * 100).toFixed(1)}% excede el máximo de ${(config.maxPct * 100).toFixed(1)}%`
      );
    }
  }

  return { valid: violations.length === 0, violations };
}
