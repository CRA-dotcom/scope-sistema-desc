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

export type SeasonalityOutlier = {
  month: number;          // 1-12
  value: number;          // signed percent: -100..+200 (stored as percent regardless of UI unit)
  unit: "percent" | "amount";  // operator's last entry mode; informational for UI rehydrate
};

/**
 * Computes monthly sales for all 12 months: outlier months use the explicit
 * `value` (interpreted as signed percent over the mean); remaining months
 * receive the residual budget split evenly.
 *
 * If the outliers' implied sales > annualSales, the non-outlier months may
 * end up at zero or negative monthlySales — the UI surfaces this as a
 * warning; the helper does not clamp. Callers must validate upstream.
 */
export function seasonalityFromOutliers(
  annualSales: number,
  outliers: SeasonalityOutlier[]
): SeasonalityData[] {
  const meanMonthly = annualSales / 12;

  const outlierByMonth = new Map<number, SeasonalityOutlier>();
  for (const o of outliers) outlierByMonth.set(o.month, o);

  // Step 1: compute monthlySales for outlier months.
  const outlierMonthlySales = new Map<number, number>();
  let outlierSum = 0;
  for (const o of outliers) {
    const monthlySales = meanMonthly * (1 + o.value / 100);
    outlierMonthlySales.set(o.month, monthlySales);
    outlierSum += monthlySales;
  }

  // Step 2: residual budget for non-outlier months.
  const remainingSum = annualSales - outlierSum;
  const nonOutlierCount = 12 - outliers.length;
  const perNonOutlier = nonOutlierCount > 0 ? remainingSum / nonOutlierCount : 0;

  // Step 3: build the 12-entry array.
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const monthlySales = outlierMonthlySales.has(month)
      ? outlierMonthlySales.get(month)!
      : perNonOutlier;
    return {
      month,
      monthlySales,
      feFactor: meanMonthly > 0 ? monthlySales / meanMonthly : 1,
    };
  });
}

/**
 * Detects whether the outliers consume more than annualSales,
 * which would force non-outlier months into negative monthlySales.
 */
export function outliersOvershoot(
  annualSales: number,
  outliers: SeasonalityOutlier[]
): { outlierSum: number; remainingSum: number; nonOutlierCount: number; overshoots: boolean } {
  const meanMonthly = annualSales / 12;
  const outlierSum = outliers.reduce(
    (acc, o) => acc + meanMonthly * (1 + o.value / 100),
    0
  );
  const remainingSum = annualSales - outlierSum;
  const nonOutlierCount = 12 - outliers.length;
  const perNonOutlier = nonOutlierCount > 0 ? remainingSum / nonOutlierCount : 0;
  // Overshoot when the per-non-outlier value would be negative (or
  // remainingSum < 0 when no non-outliers).
  const overshoots = nonOutlierCount > 0 ? perNonOutlier < 0 : remainingSum < 0;
  return { outlierSum, remainingSum, nonOutlierCount, overshoots };
}
