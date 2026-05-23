import { describe, it, expect } from "vitest";
import {
  calculateProjection,
  generateEvenSeasonality,
  type ProjectionInput,
  type ServiceConfig,
} from "../projectionEngine";

function makeServices(count: number, weights: number[]): ServiceConfig[] {
  return weights.slice(0, count).map((w, i) => ({
    serviceId: `s${i}`,
    serviceName: `Service ${i}`,
    type: "base" as const,
    minPct: 0.01,
    maxPct: 0.50,
    chosenPct: w,
    isActive: true,
    isCommission: false,
  }));
}

describe("projectionEngine — residual reconciliation", () => {
  it("sum(servicios.annualAmount) == remainingBudget exact (tolerancia $0.01)", () => {
    const totalBudget = 24_000_000;
    const annualSales = 31_200_000;
    const commissionRate = 0.02;

    const result = calculateProjection({
      annualSales,
      totalBudget,
      commissionRate,
      services: [
        ...makeServices(5, [0.07, 0.13, 0.21, 0.29, 0.31]),
        // Comisiones (comodin, no participa en remainingBudget distribution)
        {
          serviceId: "scom",
          serviceName: "Comisiones",
          type: "comodin" as const,
          minPct: 0,
          maxPct: 0.05,
          chosenPct: 0.02,
          isActive: true,
          isCommission: true,
        },
      ],
      seasonalityData: generateEvenSeasonality(annualSales),
    });

    const baseServicesSum = result.services
      // TODO: switch to !s.isCommission once engine propagates the field (separate hardening ticket)
      .filter((s) => !s.serviceName.startsWith("Comisiones"))
      .reduce((acc, s) => acc + s.annualAmount, 0);

    expect(Math.abs(baseServicesSum - result.remainingBudget)).toBeLessThan(0.01);
  });

  it("grandTotal == totalBudget cuando hay comisiones (tolerancia $0.01)", () => {
    const totalBudget = 24_000_000;
    const annualSales = 31_200_000;
    const commissionRate = 0.02;
    const result = calculateProjection({
      annualSales,
      totalBudget,
      commissionRate,
      services: [
        ...makeServices(7, [0.05, 0.08, 0.12, 0.15, 0.18, 0.21, 0.21]),
        // Commission service must be included for grandTotal == totalBudget
        {
          serviceId: "scom",
          serviceName: "Comisiones",
          type: "comodin" as const,
          minPct: 0,
          maxPct: 0.05,
          chosenPct: commissionRate,
          isActive: true,
          isCommission: true,
        },
      ],
      seasonalityData: generateEvenSeasonality(annualSales),
    });
    expect(Math.abs(result.grandTotal - totalBudget)).toBeLessThan(0.01);
  });

  it("hand-crafted adversarial inputs: sum == remainingBudget (tolerancia $0.01)", () => {
    const cases: Array<{
      name: string;
      totalBudget: number;
      annualSales: number;
      weights: number[];
    }> = [
      { name: "2 services equal weight", totalBudget: 1_000_000, annualSales: 1_500_000, weights: [0.10, 0.10] },
      { name: "10 services tiny weights", totalBudget: 24_000_000, annualSales: 31_200_000, weights: [0.013, 0.027, 0.041, 0.053, 0.067, 0.071, 0.083, 0.097, 0.103, 0.109] },
      { name: "prime-ish weights", totalBudget: 24_000_000, annualSales: 31_200_000, weights: [0.0337, 0.0721, 0.1283, 0.2055, 0.2604] },
      { name: "irrational-ish weights", totalBudget: 7_777_777, annualSales: 9_999_999, weights: [1/7, 1/11, 1/13, 1/17] },
      { name: "tiny budget many services", totalBudget: 1234.56, annualSales: 5000, weights: [0.05, 0.07, 0.11, 0.13, 0.17] },
    ];

    for (const c of cases) {
      const result = calculateProjection({
        annualSales: c.annualSales,
        totalBudget: c.totalBudget,
        commissionRate: 0,
        services: makeServices(c.weights.length, c.weights),
        seasonalityData: generateEvenSeasonality(c.annualSales),
      });
      const sum = result.services.reduce((acc, s) => acc + s.annualAmount, 0);
      expect(Math.abs(sum - result.remainingBudget), c.name).toBeLessThan(0.01);
    }
  });

  it("property: cada servicio sum(monthlyAmounts.adjustedAmount) === annualAmount", () => {
    const annualSales = 1_200_000;
    const result = calculateProjection({
      annualSales,
      totalBudget: 600_000,
      commissionRate: 0,
      services: makeServices(3, [0.10, 0.20, 0.30]),
      seasonalityData: generateEvenSeasonality(annualSales),
    });

    for (const svc of result.services) {
      const monthlySum = svc.monthlyAmounts.reduce((a, m) => a + m.adjustedAmount, 0);
      expect(Math.abs(monthlySum - svc.annualAmount)).toBeLessThan(0.01);
    }
  });

  it("sub-proyecto C: fiscal slice + seasonality outliers — sum(monthlyTotals) == remainingBudget", () => {
    // Catimi-style: 60M sales, 10M budget, fiscal May-Dec, 4 outliers at +30%.
    // sum(feFactor in fiscal slice) = 6×0.85 + 2×1.3 = 7.7, not 8.
    // Per-service monthly drift = annualAmount × (1 - 7.7/8) = 0.0375×annualAmount.
    // Reconciliation must apply PER SERVICE so sum(monthlyTotals) == remainingBudget exactly.
    const annualSales = 60_000_000;
    const totalBudget = 10_000_000;
    const meanMonthly = annualSales / 12;
    const outlierFE = 1.3;
    const nonOutlierFE = 0.85;
    const isOutlier = (m: number) => [2, 3, 8, 9].includes(m);
    const seasonality = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      const fe = isOutlier(month) ? outlierFE : nonOutlierFE;
      return { month, monthlySales: meanMonthly * fe, feFactor: fe };
    });

    const result = calculateProjection({
      annualSales,
      totalBudget,
      commissionRate: 0,
      services: makeServices(3, [0.10, 0.20, 0.30]),
      seasonalityData: seasonality,
      startMonth: 5,
      monthCount: 8,
      projectionMode: "fiscal",
    });

    // Each service: sum of its monthly adjusted amounts equals its annualAmount.
    for (const svc of result.services) {
      if (svc.normalizedWeight === 0) continue;
      const monthlySum = svc.monthlyAmounts.reduce((a, m) => a + m.adjustedAmount, 0);
      expect(Math.abs(monthlySum - svc.annualAmount)).toBeLessThan(0.01);
    }

    // Aggregate: sum of monthlyTotals across the 8-month slice == remainingBudget.
    const sumMonthlyTotals = result.monthlyTotals.reduce((a, m) => a + m.total, 0);
    expect(Math.abs(sumMonthlyTotals - result.remainingBudget)).toBeLessThan(0.01);
  });

  it("Katimi 2026-05-22: sum(feFactor in slice) << monthCount no concentra todo en un mes", () => {
    // Reproducción del bug observado en jx71c2jwm9h62vcax242sctf4186pdg9.
    // feFactors calibrados al annualSales/12 cuando las monthlySales reales
    // suman al totalBudget (no al annualSales) — sum(feFactor in 8-month slice)
    // ≈ 1.04, no 8. Pre-fix: Mayo absorbe ~90% del budget vía drift dumped en
    // heaviestMonth. Post-fix: distribución refleja el feFactor de cada mes.
    const annualSales = 66_000_000;
    const totalBudget = 5_700_000;
    const meanMonthly = annualSales / 12;
    const sliceSales: Record<number, number> = {
      5: 1_500_000,
      6: 850_000,
      7: 1_000_000,
      8: 0,
      9: 950_000,
      10: 600_000,
      11: 0,
      12: 800_000,
    };
    const seasonality = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      const sales = sliceSales[month] ?? 0;
      return { month, monthlySales: sales, feFactor: sales / meanMonthly };
    });

    const result = calculateProjection({
      annualSales,
      totalBudget,
      commissionRate: 0,
      services: makeServices(2, [0.3125, 0.6875]), // Legal + TI weights de Katimi
      seasonalityData: seasonality,
      startMonth: 5,
      monthCount: 8,
      projectionMode: "fiscal",
    });

    // Sum monthly == annualAmount per servicio.
    for (const svc of result.services) {
      if (svc.normalizedWeight === 0) continue;
      const monthlySum = svc.monthlyAmounts.reduce((a, m) => a + m.adjustedAmount, 0);
      expect(Math.abs(monthlySum - svc.annualAmount)).toBeLessThan(0.01);
    }

    // Ningún mes absorbe más del 50% del annualAmount de su servicio.
    // Pre-fix: Mayo era >90%. Post-fix: máximo ~26% (matching feFactor share).
    for (const svc of result.services) {
      if (svc.normalizedWeight === 0) continue;
      for (const m of svc.monthlyAmounts) {
        const share = svc.annualAmount > 0 ? m.adjustedAmount / svc.annualAmount : 0;
        expect(
          share,
          `mes ${m.month} de ${svc.serviceName} debe ser < 50% del annualAmount`
        ).toBeLessThan(0.5);
      }
    }
  });
});
