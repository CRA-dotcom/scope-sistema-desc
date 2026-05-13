import { describe, it, expect } from "vitest";
import {
  seasonalityDataFromDeltas,
  defaultDeltas,
  seasonalitySumImplicit,
  seasonalityDeviation,
  seasonalityFromOutliers,
  outliersOvershoot,
  type SeasonalityOutlier,
} from "../seasonality";

describe("seasonality delta% helper", () => {
  it("all deltas = 0 produces uniform monthly sales = annualSales/12 with feFactor=1", () => {
    const data = seasonalityDataFromDeltas(31_200_000, defaultDeltas());
    expect(data).toHaveLength(12);
    expect(data[0].month).toBe(1);
    expect(data[11].month).toBe(12);
    for (const m of data) {
      expect(m.monthlySales).toBeCloseTo(2_600_000, 2);
      expect(m.feFactor).toBe(1);
    }
  });

  it("delta +30% produces month at media × 1.30 with feFactor=1.30", () => {
    const deltas = defaultDeltas();
    deltas[4].deltaPercent = 30; // mayo (month 5, idx 4)
    const data = seasonalityDataFromDeltas(31_200_000, deltas);
    const may = data.find((m) => m.month === 5)!;
    expect(may.monthlySales).toBeCloseTo(2_600_000 * 1.3, 2);
    expect(may.feFactor).toBeCloseTo(1.3, 4);
  });

  it("delta -100% produces 0 for that month (feFactor=0)", () => {
    const deltas = defaultDeltas();
    deltas[7].deltaPercent = -100; // agosto
    const data = seasonalityDataFromDeltas(31_200_000, deltas);
    const aug = data.find((m) => m.month === 8)!;
    expect(aug.monthlySales).toBe(0);
    expect(aug.feFactor).toBe(0);
  });

  it("sumImplicit equals annualSales when all deltas=0", () => {
    expect(seasonalitySumImplicit(31_200_000, defaultDeltas())).toBeCloseTo(31_200_000, 0);
  });

  it("deviation reports positive when total deltas net positive", () => {
    const deltas = defaultDeltas();
    deltas[4].deltaPercent = 30; // +30% mayo
    deltas[5].deltaPercent = 30; // +30% junio
    deltas[6].deltaPercent = 40; // +40% julio
    deltas[7].deltaPercent = 0; // 0% agosto (still 0, net +100/12 implies extra months at +)
    // Sum of deltas / 12 = (30+30+40)/12 ≈ +8.33% so deviation should be ~+8.33%
    const r = seasonalityDeviation(31_200_000, deltas);
    expect(r.deviationPct).toBeGreaterThan(0);
    expect(r.deviationPct).toBeCloseTo(8.33, 1);
  });

  it("deviation is 0 when deltas net to zero (e.g. +25/-25 split)", () => {
    const deltas = defaultDeltas();
    deltas[4].deltaPercent = 25;
    deltas[5].deltaPercent = -25;
    const r = seasonalityDeviation(31_200_000, deltas);
    expect(r.deviationPct).toBeCloseTo(0, 2);
  });

  it("annualSales=0 → deviationPct=0 (avoid div-by-zero)", () => {
    const r = seasonalityDeviation(0, defaultDeltas());
    expect(r.deviationPct).toBe(0);
  });
});

describe("seasonalityFromOutliers (sub-proyecto C)", () => {
  it("empty outliers produces uniform distribution (feFactor=1)", () => {
    const data = seasonalityFromOutliers(60_000_000, []);
    expect(data).toHaveLength(12);
    for (const m of data) {
      expect(m.monthlySales).toBeCloseTo(5_000_000, 2);
      expect(m.feFactor).toBeCloseTo(1, 4);
    }
  });

  it("Catimi-style 4 outliers at +30% balances remaining months", () => {
    const outliers: SeasonalityOutlier[] = [
      { month: 2, value: 30, unit: "percent" },
      { month: 3, value: 30, unit: "percent" },
      { month: 8, value: 30, unit: "percent" },
      { month: 9, value: 30, unit: "percent" },
    ];
    const data = seasonalityFromOutliers(60_000_000, outliers);
    // mean = 5M; outlier months = 5M × 1.3 = 6.5M each; 4 × 6.5M = 26M;
    // remaining = 60M − 26M = 34M, split across 8 months = 4.25M each.
    for (const m of data) {
      const isOutlier = outliers.some((o) => o.month === m.month);
      if (isOutlier) {
        expect(m.monthlySales).toBeCloseTo(6_500_000, 2);
        expect(m.feFactor).toBeCloseTo(1.3, 4);
      } else {
        expect(m.monthlySales).toBeCloseTo(4_250_000, 2);
        expect(m.feFactor).toBeCloseTo(0.85, 4);
      }
    }
    // Sum invariant
    const sum = data.reduce((acc, m) => acc + m.monthlySales, 0);
    expect(sum).toBeCloseTo(60_000_000, 2);
  });

  it("single negative outlier (-50%) balances the other 11 months", () => {
    const outliers: SeasonalityOutlier[] = [
      { month: 7, value: -50, unit: "percent" },
    ];
    const data = seasonalityFromOutliers(60_000_000, outliers);
    const july = data.find((m) => m.month === 7)!;
    expect(july.monthlySales).toBeCloseTo(2_500_000, 2);
    expect(july.feFactor).toBeCloseTo(0.5, 4);
    // Remaining = 60M − 2.5M = 57.5M / 11 ≈ 5_227_272.73
    const other = data.find((m) => m.month === 1)!;
    expect(other.monthlySales).toBeCloseTo(5_227_272.73, 2);
  });

  it("all 12 months as balanced outliers", () => {
    const outliers: SeasonalityOutlier[] = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      value: 0,
      unit: "percent" as const,
    }));
    const data = seasonalityFromOutliers(60_000_000, outliers);
    for (const m of data) {
      expect(m.monthlySales).toBeCloseTo(5_000_000, 2);
    }
  });

  it("overshoot case: outliers consume entire annualSales → remaining months at zero", () => {
    // 4 outliers × +200% = 4 × 15M = 60M total. Remaining 8 months get 0.
    const outliers: SeasonalityOutlier[] = [
      { month: 1, value: 200, unit: "percent" },
      { month: 2, value: 200, unit: "percent" },
      { month: 3, value: 200, unit: "percent" },
      { month: 4, value: 200, unit: "percent" },
    ];
    const data = seasonalityFromOutliers(60_000_000, outliers);
    const jan = data.find((m) => m.month === 1)!;
    expect(jan.monthlySales).toBeCloseTo(15_000_000, 2);
    const may = data.find((m) => m.month === 5)!;
    expect(may.monthlySales).toBeCloseTo(0, 2);
  });

  it("zero annualSales does not divide by zero", () => {
    const data = seasonalityFromOutliers(0, [
      { month: 1, value: 50, unit: "percent" },
    ]);
    for (const m of data) {
      expect(Number.isFinite(m.monthlySales)).toBe(true);
      expect(m.feFactor).toBe(1);
    }
  });
});

describe("outliersOvershoot (sub-proyecto C)", () => {
  it("empty outliers → not overshoot", () => {
    const r = outliersOvershoot(60_000_000, []);
    expect(r.overshoots).toBe(false);
    expect(r.outlierSum).toBe(0);
    expect(r.remainingSum).toBeCloseTo(60_000_000, 2);
    expect(r.nonOutlierCount).toBe(12);
  });

  it("one outlier at +50% → not overshoot", () => {
    const r = outliersOvershoot(60_000_000, [
      { month: 5, value: 50, unit: "percent" },
    ]);
    expect(r.overshoots).toBe(false);
    // outlier = 5M × 1.5 = 7.5M; remaining = 52.5M / 11
    expect(r.outlierSum).toBeCloseTo(7_500_000, 2);
    expect(r.remainingSum).toBeCloseTo(52_500_000, 2);
  });

  it("4 outliers × +200% (sum exactly = annualSales) → not overshoot (zero is allowed)", () => {
    const r = outliersOvershoot(60_000_000, [
      { month: 1, value: 200, unit: "percent" },
      { month: 2, value: 200, unit: "percent" },
      { month: 3, value: 200, unit: "percent" },
      { month: 4, value: 200, unit: "percent" },
    ]);
    expect(r.overshoots).toBe(false);
    expect(r.outlierSum).toBeCloseTo(60_000_000, 2);
  });

  it("4 outliers × +300% (sum > annualSales) → overshoots true", () => {
    const r = outliersOvershoot(60_000_000, [
      { month: 1, value: 300, unit: "percent" },
      { month: 2, value: 300, unit: "percent" },
      { month: 3, value: 300, unit: "percent" },
      { month: 4, value: 300, unit: "percent" },
    ]);
    expect(r.overshoots).toBe(true);
    // outlierSum = 4 × 5M × 4 = 80M; remaining = -20M; perNonOutlier = -2.5M < 0
    expect(r.outlierSum).toBeCloseTo(80_000_000, 2);
  });

  it("all 12 outliers summing > annualSales → overshoots true", () => {
    const outliers: SeasonalityOutlier[] = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      value: 50,
      unit: "percent" as const,
    }));
    const r = outliersOvershoot(60_000_000, outliers);
    // sum = 12 × 7.5M = 90M; nonOutlierCount = 0; remainingSum = -30M → overshoots = true
    expect(r.overshoots).toBe(true);
  });
});
