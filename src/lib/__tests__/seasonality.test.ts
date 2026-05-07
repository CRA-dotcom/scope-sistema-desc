import { describe, it, expect } from "vitest";
import {
  seasonalityDataFromDeltas,
  defaultDeltas,
  seasonalitySumImplicit,
  seasonalityDeviation,
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
