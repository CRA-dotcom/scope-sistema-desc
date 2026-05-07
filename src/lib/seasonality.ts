export type SeasonalityDelta = {
  month: number; // 1-12
  deltaPercent: number; // -100..+200, can be 0
};

export type SeasonalityData = {
  month: number;
  monthlySales: number;
  feFactor: number;
};

export function seasonalityDataFromDeltas(
  annualSales: number,
  deltas: SeasonalityDelta[]
): SeasonalityData[] {
  const meanMonthly = annualSales / 12;
  return deltas
    .slice()
    .sort((a, b) => a.month - b.month)
    .map((d) => ({
      month: d.month,
      monthlySales: meanMonthly * (1 + d.deltaPercent / 100),
      feFactor: 1 + d.deltaPercent / 100,
    }));
}

export function defaultDeltas(): SeasonalityDelta[] {
  return Array.from({ length: 12 }, (_, i) => ({ month: i + 1, deltaPercent: 0 }));
}

export function seasonalitySumImplicit(annualSales: number, deltas: SeasonalityDelta[]): number {
  return seasonalityDataFromDeltas(annualSales, deltas).reduce(
    (acc, m) => acc + m.monthlySales,
    0
  );
}

export function seasonalityDeviation(
  annualSales: number,
  deltas: SeasonalityDelta[]
): { sumImplicit: number; deviation: number; deviationPct: number } {
  const sumImplicit = seasonalitySumImplicit(annualSales, deltas);
  const deviation = sumImplicit - annualSales;
  const deviationPct = annualSales > 0 ? (deviation / annualSales) * 100 : 0;
  return { sumImplicit, deviation, deviationPct };
}
