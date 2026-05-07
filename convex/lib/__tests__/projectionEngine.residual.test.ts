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

  it("property: para 50 combinaciones aleatorias, sum == budget (tolerancia $0.01)", () => {
    const totalBudget = 1_000_000;
    const annualSales = 1_500_000;

    for (let i = 0; i < 50; i++) {
      const numServices = 2 + Math.floor(Math.random() * 8);
      const weights = Array.from({ length: numServices }, () => 0.05 + Math.random() * 0.20);
      const result = calculateProjection({
        annualSales,
        totalBudget,
        commissionRate: 0,
        services: makeServices(numServices, weights),
        seasonalityData: generateEvenSeasonality(annualSales),
      });
      const sum = result.services.reduce((acc, s) => acc + s.annualAmount, 0);
      expect(Math.abs(sum - result.remainingBudget)).toBeLessThan(0.01);
    }
  });

  it("property: monthlyTotals[i].total suma a annualAmount por servicio", () => {
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
});
