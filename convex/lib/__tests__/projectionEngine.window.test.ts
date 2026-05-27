/**
 * SS3 Task 2: Per-service contractual window [startMonth..endMonth]
 *
 * Engine must zero cells outside the window. FE-proportional models
 * re-normalise over eligible months only. one_time concentrates in
 * startMonth (or month 1 if undefined).
 *
 * Manual overrides (isManuallyOverridden) are NOT touched by the engine —
 * that guard lives in the mutation layer, not here.
 */
import { describe, it, expect } from "vitest";
import {
  calculateProjection,
  generateEvenSeasonality,
  type ServiceConfig,
} from "../projectionEngine";

const FE_FLAT = generateEvenSeasonality(1_200_000); // all feFactor = 1

function makeSvc(overrides: Partial<ServiceConfig> = {}): ServiceConfig {
  return {
    serviceId: "svc1",
    serviceName: "TestService",
    type: "base",
    minPct: 0,
    maxPct: 1,
    chosenPct: 100,
    isActive: true,
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// fixed_retainer window tests
// ──────────────────────────────────────────────────────────────────────────────

describe("calculateProjection — contractual window [startMonth..endMonth]", () => {
  it("fixed_retainer startMonth=5, endMonth=undefined → months 1-4 = 0, months 5-12 distribute annualAmount (flat FE: 120000/8 each)", () => {
    const result = calculateProjection({
      annualSales: 1_200_000,
      totalBudget: 120_000,
      commissionRate: 0,
      services: [
        makeSvc({
          pricingModel: "fixed_retainer",
          startMonth: 5,
          // endMonth undefined → defaults to 12
        }),
      ],
      seasonalityData: FE_FLAT,
    });

    const svc = result.services[0];

    // annualAmount should still be 120_000 (full budget allocation)
    expect(svc.annualAmount).toBeCloseTo(120_000, 2);

    // Months 1-4 must be zero
    for (let m = 1; m <= 4; m++) {
      const ma = svc.monthlyAmounts.find((x) => x.month === m)!;
      expect(ma.adjustedAmount).toBeCloseTo(0, 5);
    }

    // Months 5-12 (8 months, flat FE=1): each gets 120000/8 = 15000
    for (let m = 5; m <= 12; m++) {
      const ma = svc.monthlyAmounts.find((x) => x.month === m)!;
      expect(ma.adjustedAmount).toBeCloseTo(15_000, 2);
    }

    // Sum of all months should equal annualAmount
    const total = svc.monthlyAmounts.reduce((s, m) => s + m.adjustedAmount, 0);
    expect(total).toBeCloseTo(120_000, 2);
  });

  it("fixed_retainer startMonth=5, endMonth=10 → months 1-4 + 11-12 = 0, months 5-10 distribute (flat FE: 20000 each)", () => {
    const result = calculateProjection({
      annualSales: 1_200_000,
      totalBudget: 120_000,
      commissionRate: 0,
      services: [
        makeSvc({
          pricingModel: "fixed_retainer",
          startMonth: 5,
          endMonth: 10,
        }),
      ],
      seasonalityData: FE_FLAT,
    });

    const svc = result.services[0];
    expect(svc.annualAmount).toBeCloseTo(120_000, 2);

    // Out-of-window months: 1-4 and 11-12
    for (const m of [1, 2, 3, 4, 11, 12]) {
      const ma = svc.monthlyAmounts.find((x) => x.month === m)!;
      expect(ma.adjustedAmount).toBeCloseTo(0, 5);
    }

    // In-window months: 5-10 (6 months, flat FE=1): each gets 120000/6 = 20000
    for (let m = 5; m <= 10; m++) {
      const ma = svc.monthlyAmounts.find((x) => x.month === m)!;
      expect(ma.adjustedAmount).toBeCloseTo(20_000, 2);
    }

    const total = svc.monthlyAmounts.reduce((s, m) => s + m.adjustedAmount, 0);
    expect(total).toBeCloseTo(120_000, 2);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // one_time window tests
  // ──────────────────────────────────────────────────────────────────────────

  it("one_time startMonth=7 → only month 7 = annualAmount, all others 0", () => {
    const result = calculateProjection({
      annualSales: 1_200_000,
      totalBudget: 50_000,
      commissionRate: 0,
      services: [
        makeSvc({
          pricingModel: "one_time",
          startMonth: 7,
        }),
      ],
      seasonalityData: FE_FLAT,
    });

    const svc = result.services[0];
    expect(svc.annualAmount).toBeCloseTo(50_000, 2);

    for (let m = 1; m <= 12; m++) {
      const ma = svc.monthlyAmounts.find((x) => x.month === m)!;
      if (m === 7) {
        expect(ma.adjustedAmount).toBeCloseTo(50_000, 2);
      } else {
        expect(ma.adjustedAmount).toBeCloseTo(0, 5);
      }
    }
  });

  it("one_time startMonth=undefined, endMonth=undefined → month 1 gets annualAmount (legacy behavior, no break)", () => {
    const result = calculateProjection({
      annualSales: 1_200_000,
      totalBudget: 50_000,
      commissionRate: 0,
      services: [
        makeSvc({
          pricingModel: "one_time",
          // no startMonth / endMonth
        }),
      ],
      seasonalityData: FE_FLAT,
    });

    const svc = result.services[0];
    expect(svc.monthlyAmounts[0].adjustedAmount).toBeCloseTo(50_000, 2);
    for (let i = 1; i < 12; i++) {
      expect(svc.monthlyAmounts[i].adjustedAmount).toBeCloseTo(0, 5);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Legacy (no window) — must remain unchanged
  // ──────────────────────────────────────────────────────────────────────────

  it("undefined-window service (legacy) → unchanged full-year distribution", () => {
    const result = calculateProjection({
      annualSales: 1_200_000,
      totalBudget: 120_000,
      commissionRate: 0,
      services: [
        makeSvc({
          pricingModel: "fixed_retainer",
          // no startMonth / endMonth
        }),
      ],
      seasonalityData: FE_FLAT,
    });

    const svc = result.services[0];
    expect(svc.annualAmount).toBeCloseTo(120_000, 2);

    // All 12 months get equal share with flat FE
    for (let i = 0; i < 12; i++) {
      expect(svc.monthlyAmounts[i].adjustedAmount).toBeCloseTo(10_000, 2);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // F7: pathologically tiny FE — clamp to uniform fallback
  // ──────────────────────────────────────────────────────────────────────────

  it("F7: startMonth=5, endMonth=5 with seasonality[4]=0.001 → cell amount ≈ annualAmount (not 1000×)", () => {
    const seasonality = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      monthlySales: 100_000,
      feFactor: i === 4 ? 0.001 : 1.0, // month 5 is pathologically tiny
    }));

    const result = calculateProjection({
      annualSales: 1_200_000,
      totalBudget: 120_000,
      commissionRate: 0,
      services: [
        makeSvc({
          pricingModel: "fixed_retainer",
          startMonth: 5,
          endMonth: 5,
        }),
      ],
      seasonalityData: seasonality,
    });

    const svc = result.services[0];
    expect(svc.annualAmount).toBeCloseTo(120_000, 2);

    // Month 5: with uniform fallback, gets annualAmount (1 eligible month)
    const m5 = svc.monthlyAmounts.find((x) => x.month === 5)!;
    expect(m5.adjustedAmount).toBeCloseTo(120_000, 0);

    // All other months must be 0
    for (let m = 1; m <= 12; m++) {
      if (m === 5) continue;
      const ma = svc.monthlyAmounts.find((x) => x.month === m)!;
      expect(ma.adjustedAmount).toBeCloseTo(0, 5);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Window with non-flat FE — proportional normalization test
  // ──────────────────────────────────────────────────────────────────────────

  it("fixed_retainer with startMonth=1, endMonth=3 and non-flat FE → re-normalises over eligible months, total = annualAmount", () => {
    // FE for months 1-3: 0.5, 1.0, 1.5 → sum = 3.0
    // monthlyBase = 120000 / 3.0 = 40000
    // month1: 40000 * 0.5 = 20000, month2: 40000, month3: 60000
    const seasonality = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      monthlySales: 100_000,
      feFactor: i === 0 ? 0.5 : i === 1 ? 1.0 : i === 2 ? 1.5 : 1.0,
    }));

    const result = calculateProjection({
      annualSales: 1_200_000,
      totalBudget: 120_000,
      commissionRate: 0,
      services: [
        makeSvc({
          pricingModel: "fixed_retainer",
          startMonth: 1,
          endMonth: 3,
        }),
      ],
      seasonalityData: seasonality,
    });

    const svc = result.services[0];
    expect(svc.annualAmount).toBeCloseTo(120_000, 2);

    // Months 4-12 must be zero
    for (let m = 4; m <= 12; m++) {
      const ma = svc.monthlyAmounts.find((x) => x.month === m)!;
      expect(ma.adjustedAmount).toBeCloseTo(0, 5);
    }

    // Total of months 1-3 = annualAmount
    const windowTotal = [1, 2, 3].reduce((sum, m) => {
      return sum + (svc.monthlyAmounts.find((x) => x.month === m)?.adjustedAmount ?? 0);
    }, 0);
    expect(windowTotal).toBeCloseTo(120_000, 1);

    // Individual months proportional to their FE weight
    const m1 = svc.monthlyAmounts.find((x) => x.month === 1)!.adjustedAmount;
    const m2 = svc.monthlyAmounts.find((x) => x.month === 2)!.adjustedAmount;
    const m3 = svc.monthlyAmounts.find((x) => x.month === 3)!.adjustedAmount;
    expect(m1).toBeCloseTo(20_000, 1);
    expect(m2).toBeCloseTo(40_000, 1);
    expect(m3).toBeCloseTo(60_000, 1);
  });
});
