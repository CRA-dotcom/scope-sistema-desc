import { describe, it, expect } from "vitest";
import { calculateProjection } from "../projectionEngine";

const FE_FLAT = Array.from({ length: 12 }, (_, i) => ({
  month: i + 1,
  monthlySales: 100_000,
  feFactor: 1,
}));

describe("calculateProjection — pricingModel branches", () => {
  it("one_time: puts annualAmount only in month=1 (startMonth fallback), 0 elsewhere", () => {
    const result = calculateProjection({
      annualSales: 1_200_000,
      totalBudget: 50_000,
      commissionRate: 0.02,
      services: [
        {
          serviceId: "svc1",
          serviceName: "Identidad Corporativa",
          type: "base",
          minPct: 0,
          maxPct: 100,
          chosenPct: 100,
          isActive: true,
          pricingModel: "one_time",
        },
      ],
      seasonalityData: FE_FLAT,
    });

    const svc = result.services[0];
    expect(svc.monthlyAmounts[0].adjustedAmount).toBeCloseTo(50_000, 2);
    for (let i = 1; i < 12; i++) {
      expect(svc.monthlyAmounts[i].adjustedAmount).toBe(0);
    }
  });

  it("fixed_retainer (or no pricingModel): distributes per FE/sumFE — unchanged from current behavior", () => {
    const result = calculateProjection({
      annualSales: 1_200_000,
      totalBudget: 120_000,
      commissionRate: 0,
      services: [
        {
          serviceId: "svc1",
          serviceName: "TI",
          type: "base",
          minPct: 0,
          maxPct: 100,
          chosenPct: 100,
          isActive: true,
          pricingModel: "fixed_retainer",
        },
      ],
      seasonalityData: FE_FLAT,
    });

    const svc = result.services[0];
    for (let i = 0; i < 12; i++) {
      expect(svc.monthlyAmounts[i].adjustedAmount).toBeCloseTo(10_000, 2);
    }
  });

  it("dynamic_retainer: same arithmetic as fixed_retainer at seed time (flag flip lives in mutation layer)", () => {
    const result = calculateProjection({
      annualSales: 1_200_000,
      totalBudget: 60_000,
      commissionRate: 0,
      services: [
        {
          serviceId: "svc1",
          serviceName: "Legal",
          type: "base",
          minPct: 0,
          maxPct: 100,
          chosenPct: 100,
          isActive: true,
          pricingModel: "dynamic_retainer",
        },
      ],
      seasonalityData: FE_FLAT,
    });

    const svc = result.services[0];
    for (let i = 0; i < 12; i++) {
      expect(svc.monthlyAmounts[i].adjustedAmount).toBeCloseTo(5_000, 2);
    }
  });

  it("commission: matches existing isCommission behavior when pricingModel is commission", () => {
    const result = calculateProjection({
      annualSales: 1_200_000,
      totalBudget: 100_000,
      commissionRate: 0.05,
      services: [
        {
          serviceId: "svc1",
          serviceName: "Comisiones",
          type: "base",
          minPct: 0,
          maxPct: 100,
          chosenPct: 0,
          isActive: true,
          isCommission: true,
          pricingModel: "commission",
        },
      ],
      seasonalityData: FE_FLAT,
    });

    const svc = result.services[0];
    for (let i = 0; i < 12; i++) {
      expect(svc.monthlyAmounts[i].adjustedAmount).toBeCloseTo(5_000, 2);
    }
  });
});
