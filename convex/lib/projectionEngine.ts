/**
 * Projex Projection Engine
 * Pure functions replicating the Excel calculator logic.
 * No side effects - all functions take data in and return results.
 */

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
  seasonalityData: MonthlyData[];
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
 * Main projection calculation.
 * Replicates Excel Hoja 3 (Matriz de Proyección) logic.
 */
export function calculateProjection(
  input: ProjectionInput,
  config?: EngineConfig
): ProjectionResult {
  const resolvedConfig = config ?? DEFAULT_ENGINE_CONFIG;
  const { annualSales, totalBudget, commissionRate, services, seasonalityData } =
    input;

  // Apply seasonality override: when disabled, force all FE factors to 1
  const effectiveSeasonality: MonthlyData[] = resolvedConfig.seasonalityEnabled
    ? seasonalityData
    : seasonalityData.map((m) => ({ ...m, feFactor: 1 }));

  // Step 1: Annual commissions
  const annualCommissions = annualSales * commissionRate;

  // Step 2: Remaining budget (excluding commissions)
  const remainingBudget = totalBudget - annualCommissions;

  // Step 3: Get active non-commission services
  const activeServices = services.filter(
    (s) => s.isActive && !s.isCommission
  );
  const commissionService = services.find(
    (s) => s.isCommission === true
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
        // Fixed monthly commission: commissionRate * totalBudget / 12 per month
        const fixedMonthly = commissionRate * totalBudget / 12;
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

      // Commission service: proportional to monthly sales, not normalized
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

    if (resolvedConfig.calculationMode === "fixed") {
      // Fixed mode: use fixedMonthlyAmount, no weight normalization, no FE adjustment
      const fixedMonthly = service.fixedMonthlyAmount ?? 0;
      const annualAmount = fixedMonthly * 12;

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
        chosenPct: service.chosenPct,
        isActive: true,
        normalizedWeight: 0,
        annualAmount,
        monthlyAmounts,
      };
    }

    // Normal service: weight-based distribution
    const normalizedWeight = totalWeight > 0 ? service.chosenPct / totalWeight : 0;
    const annualAmount = remainingBudget * normalizedWeight;
    const monthlyBase = annualAmount / 12;

    const monthlyAmounts: MonthlyAmount[] = effectiveSeasonality.map((m) => ({
      month: m.month,
      baseAmount: monthlyBase,
      feFactor: m.feFactor,
      adjustedAmount: monthlyBase * m.feFactor,
    }));

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

  // Step 5b: Residual reconciliation — close floating-point drift on
  // the base service with the highest normalizedWeight so that
  // sum(base annualAmount) === remainingBudget exactamente (tolerancia centavo).
  // Sin esto, varias multiplicaciones acumulan a presupuestos del orden de
  // $24M y pueden llegar a discrepancias visibles ($1M en el reporte del usuario).
  //
  // Selecciona base services usando normalizedWeight > 0 — único filter que ya
  // excluye inactivos (weight=0 por L155) y comisiones (weight=0 por L183/206).
  const baseAllocations = serviceAllocations.filter((s) => s.normalizedWeight > 0);
  if (baseAllocations.length > 0) {
    const sumBase = baseAllocations.reduce((acc, s) => acc + s.annualAmount, 0);
    const drift = remainingBudget - sumBase;
    if (Math.abs(drift) > 0) {
      const heaviest = baseAllocations.reduce((max, s) =>
        s.normalizedWeight > max.normalizedWeight ? s : max
      );
      heaviest.annualAmount += drift;
      // Reconciliar drift dentro de cada base service en sus monthlyAmounts:
      // el mes con mayor feFactor absorbe el residuo del servicio.
      for (const svc of baseAllocations) {
        const monthlySum = svc.monthlyAmounts.reduce((a, m) => a + m.adjustedAmount, 0);
        const monthlyDrift = svc.annualAmount - monthlySum;
        if (Math.abs(monthlyDrift) > 0 && svc.monthlyAmounts.length > 0) {
          const heaviestMonth = svc.monthlyAmounts.reduce((max, m) =>
            m.feFactor > max.feFactor ? m : max
          );
          heaviestMonth.adjustedAmount += monthlyDrift;
        }
      }
    }
  }

  // Step 6: Monthly totals
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
