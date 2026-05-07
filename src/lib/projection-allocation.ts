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
  }>;
};

export function computeServiceAllocation(
  budget: number,
  annualSales: number,
  commissionRate: number,
  services: AllocationServiceInput[]
): AllocationResult {
  // Step 1: Annual commissions (mirrors engine L130)
  const annualCommissions = annualSales * commissionRate;

  // Step 2: Remaining budget for base services (mirrors engine L133)
  const remainingBudget = budget - annualCommissions;

  // Step 3: Active non-commission services (mirrors engine L136-138)
  const activeServices = services.filter((s) => s.isActive && !s.isCommission);

  // Step 4: Total weight of active base services (mirrors engine L144)
  const totalWeight = activeServices.reduce((sum, s) => sum + s.chosenPct, 0);

  // Step 5: Per-service annualAmount (mirrors engine L147-258)
  const perService: AllocationResult["perService"] = services.map((service) => {
    // Commission services don't consume remaining budget (handled separately)
    if (service.isCommission) {
      return {
        serviceId: service.serviceId,
        serviceName: service.serviceName,
        chosenPct: service.chosenPct,
        annualAmount: 0, // not included in perService sum; added separately via annualCommissions
      };
    }

    if (!service.isActive) {
      return {
        serviceId: service.serviceId,
        serviceName: service.serviceName,
        chosenPct: service.chosenPct,
        annualAmount: 0,
      };
    }

    // Normal service: weight-based distribution (mirrors engine L237-238)
    const normalizedWeight = totalWeight > 0 ? service.chosenPct / totalWeight : 0;
    const annualAmount = remainingBudget * normalizedWeight;

    return {
      serviceId: service.serviceId,
      serviceName: service.serviceName,
      chosenPct: service.chosenPct,
      annualAmount,
    };
  });

  // Step 6: Residual reconciliation — close IEEE 754 drift on heaviest service
  // (mirrors engine L260-294)
  const baseEntries = perService.filter((s) => {
    const input = services.find((i) => i.serviceId === s.serviceId);
    return input?.isActive && !input?.isCommission;
  });

  if (baseEntries.length > 0) {
    const sumBase = baseEntries.reduce((acc, s) => acc + s.annualAmount, 0);
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
