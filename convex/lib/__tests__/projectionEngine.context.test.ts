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
    // grandTotal should equal effectiveBudget (16M), not totalBudget (24M)
    expect(Math.abs(r.grandTotal - 16_000_000)).toBeLessThan(0.01);
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
    // annualCommissions (prorated) = 31.2M × 0.02 × 8/12 = 416,000
    // remainingBudget = 16M - 416K = 15,584,000 → all to S0
    // grandTotal = 16M
    expect(Math.abs(r.grandTotal - 16_000_000)).toBeLessThan(0.01);
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
});
