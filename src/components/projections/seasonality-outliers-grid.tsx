"use client";

// TODO: component tests deferred — preview + chip behavior is verified manually
// in QA (see plan C Task 5). Re-enable once React Testing Library is configured.

import { useMemo } from "react";
import {
  type SeasonalityOutlier,
  outliersOvershoot,
  seasonalityFromOutliers,
} from "convex/lib/seasonality";
import { cn, formatCurrency } from "@/lib/utils";

const MONTH_NAMES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

type Props = {
  value: SeasonalityOutlier[];
  onChange: (next: SeasonalityOutlier[]) => void;
  annualSales: number;
};

export function SeasonalityOutliersGrid({ value, onChange, annualSales }: Props) {
  const meanMonthly = annualSales / 12;
  const overshoot = useMemo(
    () => outliersOvershoot(annualSales, value),
    [annualSales, value]
  );
  const monthlyData = useMemo(
    () => seasonalityFromOutliers(annualSales, value),
    [annualSales, value]
  );

  const selectedMonths = new Set(value.map((v) => v.month));
  const sortedOutliers = [...value].sort((a, b) => a.month - b.month);

  function toggleMonth(month: number) {
    if (selectedMonths.has(month)) {
      onChange(value.filter((v) => v.month !== month));
    } else {
      onChange([...value, { month, value: 0, unit: "percent" }]);
    }
  }

  function updateOutlier(month: number, patch: Partial<SeasonalityOutlier>) {
    onChange(value.map((v) => (v.month === month ? { ...v, ...patch } : v)));
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Marca los meses con estacionalidad atípica. El resto de los meses se
        prorratean automáticamente para cuadrar con la venta anual.
      </p>

      {/* Month chip row */}
      <div className="flex flex-wrap gap-2">
        {MONTH_NAMES.map((name, i) => {
          const month = i + 1;
          const selected = selectedMonths.has(month);
          return (
            <button
              key={month}
              type="button"
              onClick={() => toggleMonth(month)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium border transition-colors cursor-pointer",
                selected
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border bg-secondary/30 text-muted-foreground hover:bg-secondary"
              )}
            >
              {name}
            </button>
          );
        })}
      </div>

      {/* Outlier rows */}
      {sortedOutliers.length > 0 && (
        <div className="space-y-2 rounded-md border border-border bg-secondary/20 p-3">
          {sortedOutliers.map((o) => {
            const monthlySales =
              monthlyData.find((m) => m.month === o.month)?.monthlySales ?? 0;
            // Display value: in percent unit, show the stored signed percent;
            // in amount unit, show the corresponding monthlySales as an absolute amount.
            const displayValue =
              o.unit === "percent" ? o.value : Math.round(monthlySales);
            const isPositive = o.value > 0.5;
            const isNegative = o.value < -0.5;

            return (
              <div
                key={o.month}
                className="flex items-center gap-3 flex-wrap"
              >
                <span className="w-10 text-sm font-medium">
                  {MONTH_NAMES[o.month - 1]}
                </span>
                {isPositive && (
                  <span className="text-xs text-emerald-500">🔼</span>
                )}
                {isNegative && (
                  <span className="text-xs text-amber-500">🔽</span>
                )}
                {!isPositive && !isNegative && (
                  <span className="text-xs text-muted-foreground">•</span>
                )}
                <input
                  type="number"
                  step={o.unit === "percent" ? 1 : 10000}
                  value={displayValue}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    if (o.unit === "percent") {
                      updateOutlier(o.month, { value: raw });
                    } else {
                      // amount → signed percent
                      const nextPct =
                        meanMonthly > 0 ? ((raw / meanMonthly) - 1) * 100 : 0;
                      updateOutlier(o.month, { value: nextPct });
                    }
                  }}
                  className="w-32 rounded-md border border-border bg-secondary px-2 py-1 text-sm focus:border-accent focus:outline-none"
                />
                <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
                  <button
                    type="button"
                    onClick={() => updateOutlier(o.month, { unit: "percent" })}
                    className={cn(
                      "px-2 py-1 cursor-pointer transition-colors",
                      o.unit === "percent"
                        ? "bg-accent/20 text-accent"
                        : "text-muted-foreground hover:bg-secondary"
                    )}
                  >
                    %
                  </button>
                  <button
                    type="button"
                    onClick={() => updateOutlier(o.month, { unit: "amount" })}
                    className={cn(
                      "px-2 py-1 cursor-pointer transition-colors",
                      o.unit === "amount"
                        ? "bg-accent/20 text-accent"
                        : "text-muted-foreground hover:bg-secondary"
                    )}
                  >
                    $
                  </button>
                </div>
                <span className="text-xs text-muted-foreground">
                  ≈ {formatCurrency(monthlySales)}/mes
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer summary */}
      <div
        className={cn(
          "rounded-md border p-3 text-sm",
          overshoot.overshoots
            ? "border-amber-500/40 bg-amber-500/5"
            : "border-border bg-secondary/30"
        )}
      >
        <div className="grid grid-cols-3 gap-2">
          <div>
            <p className="text-xs text-muted-foreground">Suma outliers</p>
            <p className="font-medium">{formatCurrency(overshoot.outlierSum)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Cada mes restante</p>
            <p className="font-medium">
              {overshoot.nonOutlierCount > 0
                ? formatCurrency(overshoot.remainingSum / overshoot.nonOutlierCount)
                : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total año</p>
            <p className="font-medium">{formatCurrency(annualSales)}</p>
          </div>
        </div>
        {overshoot.overshoots && (
          <p className="mt-2 text-xs text-amber-600">
            ⚠ La suma de tus meses outliers supera la venta anual. Los meses no
            marcados quedarían en negativo. Ajusta los valores o continúa si la
            diferencia es intencional.
          </p>
        )}
      </div>
    </div>
  );
}
