import { describe, it, expect } from "vitest";
import { computeServiceAllocation } from "../projection-allocation";
import { calculateProjection, generateEvenSeasonality } from "../../../convex/lib/projectionEngine";

describe("computeServiceAllocation", () => {
  it("distributes remainingBudget proportionally to active service weights", () => {
    const r = computeServiceAllocation(
      24_000_000, // budget
      31_200_000, // annualSales
      0.02,       // commissionRate
      [
        { serviceId: "a", serviceName: "Legal", isActive: true, isCommission: false, chosenPct: 0.10 },
        { serviceId: "b", serviceName: "Contable", isActive: true, isCommission: false, chosenPct: 0.30 },
      ]
    );
    // annualCommissions = 31.2M × 0.02 = 624,000
    // remainingBudget = 24M - 624K = 23,376,000
    // a gets 23.376M × (0.10/0.40) = 5,844,000
    // b gets 23.376M × (0.30/0.40) = 17,532,000
    // assigned = 624K + 5.844M + 17.532M = 24M
    expect(Math.abs(r.assigned - 24_000_000)).toBeLessThan(0.01);
    expect(Math.abs(r.remaining)).toBeLessThan(0.01);
    expect(Math.abs(r.budget - 24_000_000)).toBeLessThan(0.01);
  });

  it("inactive services have annualAmount = 0", () => {
    const r = computeServiceAllocation(1_000_000, 1_000_000, 0, [
      { serviceId: "a", serviceName: "A", isActive: true, isCommission: false, chosenPct: 0.20 },
      { serviceId: "b", serviceName: "B (inactivo)", isActive: false, isCommission: false, chosenPct: 0.30 },
    ]);
    const b = r.perService.find((s) => s.serviceId === "b");
    expect(b?.annualAmount).toBe(0);
    const a = r.perService.find((s) => s.serviceId === "a");
    // Only A is active; gets all of remaining budget (= 1M since commissionRate=0)
    expect(Math.abs((a?.annualAmount ?? 0) - 1_000_000)).toBeLessThan(0.01);
  });

  it("commission service is excluded from perService; contributes to assigned via annualCommissions", () => {
    const r = computeServiceAllocation(1_000_000, 1_000_000, 0.05, [
      { serviceId: "com", serviceName: "Comisiones", isActive: true, isCommission: true, chosenPct: 0.05 },
      { serviceId: "a", serviceName: "A", isActive: true, isCommission: false, chosenPct: 1.0 },
    ]);
    // annualCommissions = 50,000; remaining = 950,000 → all goes to A
    // commission service must NOT appear in perService
    expect(r.perService.find((s) => s.serviceId === "com")).toBeUndefined();
    const a = r.perService.find((s) => s.serviceId === "a");
    expect(Math.abs((a?.annualAmount ?? 0) - 950_000)).toBeLessThan(0.01);
    expect(Math.abs(r.assigned - 1_000_000)).toBeLessThan(0.01);
  });

  it("marginPct = budget / annualSales × 100", () => {
    const r = computeServiceAllocation(800_000, 1_000_000, 0, [
      { serviceId: "a", serviceName: "A", isActive: true, isCommission: false, chosenPct: 0.20 },
    ]);
    expect(r.marginPct).toBeCloseTo(80, 1);
  });

  it("marginPct is null when annualSales is 0 (avoid div-by-zero)", () => {
    const r = computeServiceAllocation(0, 0, 0, []);
    expect(r.marginPct).toBeNull();
  });

  it("residual reconciliation closes drift on heaviest service", () => {
    const r = computeServiceAllocation(24_000_000, 31_200_000, 0, [
      { serviceId: "a", serviceName: "A", isActive: true, isCommission: false, chosenPct: 0.0337 },
      { serviceId: "b", serviceName: "B", isActive: true, isCommission: false, chosenPct: 0.0721 },
      { serviceId: "c", serviceName: "C", isActive: true, isCommission: false, chosenPct: 0.1283 },
      { serviceId: "d", serviceName: "D", isActive: true, isCommission: false, chosenPct: 0.2055 },
      { serviceId: "e", serviceName: "E", isActive: true, isCommission: false, chosenPct: 0.2604 },
    ]);
    expect(Math.abs(r.assigned - 24_000_000)).toBeLessThan(0.01);
  });

  it("commissionMode='fixed_monthly' uses commissionRate × budget for commissions", () => {
    const r = computeServiceAllocation(
      24_000_000, 31_200_000, 0.02,
      [
        { serviceId: "com", serviceName: "Comisiones", isActive: true, isCommission: true, chosenPct: 0.02 },
        { serviceId: "a", serviceName: "A", isActive: true, isCommission: false, chosenPct: 0.20 },
      ],
      "fixed_monthly"
    );
    // annualCommissions = 0.02 × 24M = 480,000 (NOT 0.02 × 31.2M = 624,000)
    // remainingBudget = 24M - 480K = 23,520,000 → all to A (only base service)
    const a = r.perService.find((s) => s.serviceId === "a");
    expect(Math.abs((a?.annualAmount ?? 0) - 23_520_000)).toBeLessThan(0.01);
    expect(Math.abs(r.assigned - 24_000_000)).toBeLessThan(0.01);
  });

  it("equivalence: helper.assigned matches engine.grandTotal for same input (proportional mode)", () => {
    const annualSales = 31_200_000;
    const totalBudget = 24_000_000;
    const commissionRate = 0.02;
    const services = [
      { serviceId: "a", serviceName: "Legal", type: "base" as const, isActive: true, isCommission: false, minPct: 0.01, maxPct: 0.5, chosenPct: 0.10 },
      { serviceId: "b", serviceName: "Contable", type: "base" as const, isActive: true, isCommission: false, minPct: 0.01, maxPct: 0.5, chosenPct: 0.30 },
      { serviceId: "com", serviceName: "Comisiones", type: "comodin" as const, isActive: true, isCommission: true, minPct: 0, maxPct: 0.05, chosenPct: 0.02 },
    ];

    const helperResult = computeServiceAllocation(
      totalBudget, annualSales, commissionRate,
      services.map(s => ({ serviceId: s.serviceId, serviceName: s.serviceName, isActive: s.isActive, isCommission: s.isCommission, chosenPct: s.chosenPct }))
    );

    const engineResult = calculateProjection({
      annualSales, totalBudget, commissionRate,
      services,
      seasonalityData: generateEvenSeasonality(annualSales),
    });

    expect(Math.abs(helperResult.assigned - engineResult.grandTotal)).toBeLessThan(0.01);
  });
});
