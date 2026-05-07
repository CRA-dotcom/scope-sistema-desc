import { describe, it, expect } from "vitest";
import { resolveProjectionContext, resolveProjectionMonths } from "../projectionContext";

describe("resolveProjectionContext", () => {
  it("legacy projection without new fields → rolling, startMonth=1, count=12, effective=totalBudget", () => {
    const r = resolveProjectionContext({ totalBudget: 24_000_000, year: 2026 });
    expect(r.projectionMode).toBe("rolling");
    expect(r.startMonth).toBe(1);
    expect(r.monthCount).toBe(12);
    expect(r.effectiveBudget).toBe(24_000_000);
    expect(r.endMonth).toBe(12);
    expect(r.endYear).toBe(2026);
  });

  it("rolling with startMonth=5 → 12 months May-Apr next year", () => {
    const r = resolveProjectionContext({
      totalBudget: 24_000_000,
      year: 2026,
      projectionMode: "rolling",
      startMonth: 5,
    });
    expect(r.monthCount).toBe(12);
    expect(r.effectiveBudget).toBe(24_000_000);
    expect(r.endMonth).toBe(4);   // April
    expect(r.endYear).toBe(2027);
  });

  it("fiscal with startMonth=5 → 8 months May-Dec same year, prorated 8/12", () => {
    const r = resolveProjectionContext({
      totalBudget: 24_000_000,
      year: 2026,
      projectionMode: "fiscal",
      startMonth: 5,
    });
    expect(r.monthCount).toBe(8);
    expect(r.effectiveBudget).toBeCloseTo(24_000_000 * 8 / 12, 2); // = 16M
    expect(r.endMonth).toBe(12);
    expect(r.endYear).toBe(2026);
  });

  it("fiscal with startMonth=1 → 12 months full year", () => {
    const r = resolveProjectionContext({
      totalBudget: 24_000_000,
      year: 2026,
      projectionMode: "fiscal",
      startMonth: 1,
    });
    expect(r.monthCount).toBe(12);
    expect(r.effectiveBudget).toBe(24_000_000);
    expect(r.endMonth).toBe(12);
    expect(r.endYear).toBe(2026);
  });

  it("explicit values override defaults", () => {
    const r = resolveProjectionContext({
      totalBudget: 24_000_000,
      year: 2026,
      projectionMode: "fiscal",
      startMonth: 5,
      monthCount: 6,           // explicit (not the default 8)
      effectiveBudget: 12_000_000, // explicit
    });
    expect(r.monthCount).toBe(6);
    expect(r.effectiveBudget).toBe(12_000_000);
  });
});

describe("resolveProjectionMonths", () => {
  it("rolling Jan: [1,2,3,...,12]", () => {
    expect(resolveProjectionMonths(1, 12)).toEqual([1,2,3,4,5,6,7,8,9,10,11,12]);
  });
  it("rolling May: [5,...,12,1,...,4]", () => {
    expect(resolveProjectionMonths(5, 12)).toEqual([5,6,7,8,9,10,11,12,1,2,3,4]);
  });
  it("fiscal May (8 months): [5,6,7,8,9,10,11,12]", () => {
    expect(resolveProjectionMonths(5, 8)).toEqual([5,6,7,8,9,10,11,12]);
  });
  it("fiscal Dec (1 month): [12]", () => {
    expect(resolveProjectionMonths(12, 1)).toEqual([12]);
  });
});
