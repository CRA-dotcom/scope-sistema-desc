/**
 * projection-allocation.ts
 *
 * Pure helper for computing real-time budget allocation per service.
 * Mirrors the arithmetic in convex/lib/projectionEngine.ts (Steps 1-5b)
 * but without seasonality/monthly data — for live UI preview only.
 *
 * Frontend ↔ backend single source of truth:
 * The engine IS the reference; if the engine changes, update here too.
 * Accepts `effectiveBudget ?? totalBudget` so Fase C requires no widget changes.
 */

export type AllocationServiceInput = {
  serviceId: string;
  serviceName: string;
  isActive: boolean;
  isCommission: boolean;
  chosenPct: number; // 0..1
  // 2026-05-12 (sub-proyecto B): market range for the indicator.
  // Both optional for back-compat; when both defined AND annualSales > 0,
  // computed marketStatus is "below" | "within" | "above". Otherwise "n/a".
  minPct?: number;
  maxPct?: number;
};

export type AllocationResult = {
  budget: number;
  assigned: number;    // sum of base service annualAmounts + commission annual amount
  remaining: number;   // budget - assigned
  marginPct: number | null; // budget / annualSales × 100; null when annualSales === 0
  perService: Array<{
    serviceId: string;
    serviceName: string;
    chosenPct: number;
    annualAmount: number;
    // NEW (sub-proyecto B):
    marketAmount: number;          // chosenPct × annualSales (0 if sales=0)
    effectivePctOfSales: number;   // annualAmount / annualSales (0 if sales=0)
    marketStatus: "below" | "within" | "above" | "n/a";
    marketDelta: number;           // magnitude in pp, always >= 0
  }>;
};

export function computeServiceAllocation(
  budget: number,
  annualSales: number,
  commissionRate: number,
  services: AllocationServiceInput[],
  commissionMode: "proportional" | "fixed_monthly" = "proportional"
): AllocationResult {
  // Step 1: Annual commissions — engine-aligned post 2026-05-12 sub-proyecto A.
  // Commissions only deduct when at least one isCommission && isActive service
  // is contracted; otherwise the rate has no effect on the budget.
  const hasActiveCommissionService = services.some(
    (s) => s.isCommission === true && s.isActive
  );
  const annualCommissions = !hasActiveCommissionService
    ? 0
    : commissionMode === "fixed_monthly"
      ? commissionRate * budget
      : annualSales * commissionRate;

  // Step 2: Remaining budget for base services (mirrors engine L133)
  const remainingBudget = budget - annualCommissions;

  // Step 3: Active non-commission services (mirrors engine L136-138)
  const activeServices = services.filter((s) => s.isActive && !s.isCommission);

  // Step 4: Total weight of active base services (mirrors engine L144)
  const totalWeight = activeServices.reduce((sum, s) => sum + s.chosenPct, 0);

  // Step 5: Per-service annualAmount (mirrors engine L147-258)
  // Commission services are excluded from perService entirely; they are accounted for
  // via annualCommissions in the assigned total. Including them with annualAmount=0
  // was a latent correctness trap for downstream consumers.
  const perService: AllocationResult["perService"] = services
    .filter((service) => !service.isCommission)
    .map((service) => {
    if (!service.isActive) {
      return {
        serviceId: service.serviceId,
        serviceName: service.serviceName,
        chosenPct: service.chosenPct,
        annualAmount: 0,
        marketAmount: 0,
        effectivePctOfSales: 0,
        marketStatus: "n/a" as const,
        marketDelta: 0,
      };
    }

    // Normal service: weight-based distribution (mirrors engine L237-238)
    const normalizedWeight = totalWeight > 0 ? service.chosenPct / totalWeight : 0;
    const annualAmount = remainingBudget * normalizedWeight;

    const marketAmount = annualSales > 0 ? service.chosenPct * annualSales : 0;
    const effectivePctOfSales = annualSales > 0 ? annualAmount / annualSales : 0;

    let marketStatus: "below" | "within" | "above" | "n/a" = "n/a";
    let marketDelta = 0;
    if (
      annualSales > 0 &&
      service.minPct !== undefined &&
      service.maxPct !== undefined
    ) {
      if (effectivePctOfSales > service.maxPct) {
        marketStatus = "above";
        marketDelta = (effectivePctOfSales - service.maxPct) * 100;
      } else if (effectivePctOfSales < service.minPct) {
        marketStatus = "below";
        marketDelta = (service.minPct - effectivePctOfSales) * 100;
      } else {
        marketStatus = "within";
      }
    }

    return {
      serviceId: service.serviceId,
      serviceName: service.serviceName,
      chosenPct: service.chosenPct,
      annualAmount,
      marketAmount,
      effectivePctOfSales,
      marketStatus,
      marketDelta,
    };
  });

  // Step 6: Residual reconciliation — close IEEE 754 drift on heaviest service
  // (mirrors engine L260-294)
  // perService only contains non-commission entries (commission was filtered in Step 5)
  const activeEntries = perService.filter((s) => {
    const input = services.find((i) => i.serviceId === s.serviceId);
    return input?.isActive;
  });

  if (activeEntries.length > 0) {
    const sumBase = activeEntries.reduce((acc, s) => acc + s.annualAmount, 0);
    const drift = remainingBudget - sumBase;
    if (Math.abs(drift) > 0) {
      // Find the heaviest (highest chosenPct) to absorb drift
      const heaviestInput = activeServices.reduce((max, s) =>
        s.chosenPct > max.chosenPct ? s : max
      );
      const heaviestEntry = perService.find(
        (p) => p.serviceId === heaviestInput.serviceId
      );
      if (heaviestEntry) {
        heaviestEntry.annualAmount += drift;
      }
    }
  }

  // Step 7: Totals
  const baseAssigned = perService.reduce((sum, s) => sum + s.annualAmount, 0);
  // Commission amount is added back into the total assigned
  const assigned = baseAssigned + annualCommissions;
  const remaining = budget - assigned;

  const marginPct = annualSales > 0 ? (budget / annualSales) * 100 : null;

  return {
    budget,
    assigned,
    remaining,
    marginPct,
    perService,
  };
}
