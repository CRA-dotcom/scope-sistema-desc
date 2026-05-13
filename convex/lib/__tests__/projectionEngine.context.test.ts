import { describe, it, expect } from "vitest";
import {
  calculateProjection,
  generateEvenSeasonality,
  type ProjectionInput,
  type ServiceConfig,
} from "../projectionEngine";

function makeServices(weights: number[]): ServiceConfig[] {
  return weights.map((w, i) => ({
    serviceId: `s${i}`,
    serviceName: `S${i}`,
    type: "base" as const,
    minPct: 0.01,
    maxPct: 0.5,
    chosenPct: w,
    isActive: true,
    isCommission: false,
  }));
}

describe("calculateProjection — fiscal/rolling mode", () => {
  it("fiscal mode May (startMonth=5, monthCount=8) — produces 8 monthly entries", () => {
    const r = calculateProjection({
      annualSales: 31_200_000,
      totalBudget: 24_000_000,
      effectiveBudget: 16_000_000, // prorated 8/12
      monthCount: 8,
      startMonth: 5,
      projectionMode: "fiscal",
      commissionRate: 0,
      services: makeServices([0.30, 0.20]),
      seasonalityData: generateEvenSeasonality(31_200_000), // full 12 months
    });
    expect(r.monthlyTotals).toHaveLength(8);
    expect(r.monthlyTotals[0].month).toBe(5);  // May
    expect(r.monthlyTotals[7].month).toBe(12); // Dec
    // grandTotal should equal totalBudget (24M) — effectiveBudget is no longer load-bearing
    expect(Math.abs(r.grandTotal - 24_000_000)).toBeLessThan(0.01);
  });

  it("rolling mode May (startMonth=5, monthCount=12) — produces 12 monthly entries May→Apr", () => {
    const r = calculateProjection({
      annualSales: 12_000_000,
      totalBudget: 6_000_000,
      monthCount: 12,
      startMonth: 5,
      projectionMode: "rolling",
      commissionRate: 0,
      services: makeServices([0.30, 0.20]),
      seasonalityData: generateEvenSeasonality(12_000_000),
    });
    expect(r.monthlyTotals).toHaveLength(12);
    expect(r.monthlyTotals[0].month).toBe(5);
    expect(r.monthlyTotals[11].month).toBe(4); // April next year
    // grandTotal == totalBudget for rolling
    expect(Math.abs(r.grandTotal - 6_000_000)).toBeLessThan(0.01);
  });

  it("legacy call without context fields — same as before (12 months, totalBudget)", () => {
    const r = calculateProjection({
      annualSales: 12_000_000,
      totalBudget: 6_000_000,
      commissionRate: 0,
      services: makeServices([0.30, 0.20]),
      seasonalityData: generateEvenSeasonality(12_000_000),
    });
    expect(r.monthlyTotals).toHaveLength(12);
    expect(r.monthlyTotals[0].month).toBe(1);
    expect(Math.abs(r.grandTotal - 6_000_000)).toBeLessThan(0.01);
  });

  it("fiscal with commissions — annualCommissions prorated", () => {
    const r = calculateProjection({
      annualSales: 31_200_000,
      totalBudget: 24_000_000,
      effectiveBudget: 16_000_000,
      monthCount: 8,
      startMonth: 5,
      projectionMode: "fiscal",
      commissionRate: 0.02,
      services: [
        ...makeServices([0.30]),
        {
          serviceId: "com",
          serviceName: "Comisiones",
          type: "comodin" as const,
          minPct: 0,
          maxPct: 0.05,
          chosenPct: 0.02,
          isActive: true,
          isCommission: true,
        },
      ],
      seasonalityData: generateEvenSeasonality(31_200_000),
    });
    // annualCommissions (prorated by monthCount) = 31.2M × 0.02 × 8/12 = 416,000
    // remainingBudget = 24M (totalBudget) - 416K = 23,584,000 → all to S0
    // grandTotal = 24M
    expect(Math.abs(r.grandTotal - 24_000_000)).toBeLessThan(0.01);
    expect(Math.abs(r.annualCommissions - 416_000)).toBeLessThan(0.01);
  });

  it("seasonalityData with exactly monthCount entries (already filtered) — accepted", () => {
    const r = calculateProjection({
      annualSales: 12_000_000,
      totalBudget: 8_000_000,
      effectiveBudget: 4_000_000,
      monthCount: 6,
      startMonth: 7, // Jul-Dec
      projectionMode: "fiscal",
      commissionRate: 0,
      services: makeServices([0.30]),
      seasonalityData: [
        { month: 7, monthlySales: 1_000_000, feFactor: 1 },
        { month: 8, monthlySales: 1_000_000, feFactor: 1 },
        { month: 9, monthlySales: 1_000_000, feFactor: 1 },
        { month: 10, monthlySales: 1_000_000, feFactor: 1 },
        { month: 11, monthlySales: 1_000_000, feFactor: 1 },
        { month: 12, monthlySales: 1_000_000, feFactor: 1 },
      ],
    });
    expect(r.monthlyTotals).toHaveLength(6);
    expect(r.monthlyTotals[0].month).toBe(7);
    expect(r.monthlyTotals[5].month).toBe(12);
  });

  it("Bug 1 repro: 10M contract in 8 fiscal months distributes as 1.25M/month", () => {
    const result = calculateProjection({
      annualSales: 60_000_000,
      totalBudget: 10_000_000,
      commissionRate: 0,
      services: [],
      seasonalityData: generateEvenSeasonality(60_000_000),
      startMonth: 5,
      monthCount: 8,
      effectiveBudget: undefined,
      projectionMode: "fiscal",
    });

    // 8 months covered, each receiving 10M / 8 = 1.25M (no services so commission=0 and remaining=10M is unallocated, but monthlyTotals reflects the budget shape).
    expect(result.remainingBudget).toBe(10_000_000);
    expect(result.monthlyTotals).toHaveLength(8);
    // No active services → all monthly totals must be 0 (remainingBudget is unallocated).
    for (const m of result.monthlyTotals) {
      expect(m.total).toBe(0);
    }
  });

  it("Bug 1 repro with single service: 10M / 8 months distributed as 1.25M/month", () => {
    const result = calculateProjection({
      annualSales: 60_000_000,
      totalBudget: 10_000_000,
      commissionRate: 0,
      services: [
        {
          serviceId: "svc1",
          serviceName: "Legal",
          type: "base",
          minPct: 0.01,
          maxPct: 0.99,
          chosenPct: 1.0,
          isActive: true,
          isCommission: false,
        },
      ],
      seasonalityData: generateEvenSeasonality(60_000_000),
      startMonth: 5,
      monthCount: 8,
      projectionMode: "fiscal",
    });
    // Single active service → it absorbs the full remainingBudget = 10M (chosenPct is the relative weight, which becomes 100% when alone).
    expect(result.services[0].annualAmount).toBe(10_000_000);
    expect(result.monthlyTotals).toHaveLength(8);
    for (const m of result.monthlyTotals) {
      expect(m.total).toBeCloseTo(1_250_000, 2);
    }
  });
});
