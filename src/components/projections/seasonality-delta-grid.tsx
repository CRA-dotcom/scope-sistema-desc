"use client";

import { type SeasonalityDelta, seasonalityDeviation } from "@/lib/seasonality";
import { formatCurrency } from "@/lib/utils";

const MONTH_NAMES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

export function SeasonalityDeltaGrid({
  value,
  onChange,
  annualSales,
}: {
  value: SeasonalityDelta[];
  onChange: (next: SeasonalityDelta[]) => void;
  annualSales: number;
}) {
  const meanMonthly = annualSales / 12;
  const { sumImplicit, deviationPct } = seasonalityDeviation(annualSales, value);
  const isDeviating = Math.abs(deviationPct) > 0.5; // threshold: 0.5%

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Ajusta cada mes como % sobre la media mensual ({formatCurrency(meanMonthly)}/mes).
        Ej. mayo +30% significa que mayo recibe 30% más que el promedio.
      </p>

      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        {value.map((d, i) => (
          <div key={d.month} className="space-y-1">
            <label className="text-xs text-muted-foreground">
              {MONTH_NAMES[d.month - 1]}
            </label>
            <div className="relative">
              <input
                type="number"
                min={-100}
                max={200}
                step={1}
                value={d.deltaPercent}
                onChange={(e) => {
                  const next = [...value];
                  next[i] = { ...next[i], deltaPercent: Number(e.target.value) || 0 };
                  onChange(next);
                }}
                className="w-full rounded-md border border-border bg-secondary px-2 py-1.5 pr-6 text-sm focus:border-accent focus:outline-none"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                %
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              ≈ {formatCurrency(meanMonthly * (1 + d.deltaPercent / 100))}
            </p>
          </div>
        ))}
      </div>

      <div
        className={`rounded-md p-3 ${
          isDeviating
            ? "bg-amber-500/10 border border-amber-500/30"
            : "bg-secondary/50"
        }`}
      >
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Suma implícita</p>
            <p className="font-medium">{formatCurrency(sumImplicit)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Venta anual</p>
            <p className="font-medium">{formatCurrency(annualSales)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Desviación</p>
            <p className={`font-medium ${isDeviating ? "text-amber-600" : ""}`}>
              {deviationPct >= 0 ? "+" : ""}
              {deviationPct.toFixed(2)}%{isDeviating && " ⚠️"}
            </p>
          </div>
        </div>
        {isDeviating && (
          <p className="text-xs text-amber-600 mt-2">
            La suma de tus deltas implica {deviationPct >= 0 ? "más" : "menos"} ventas que la
            venta anual. Ajusta los deltas o la venta anual para que coincidan, o continúa si la
            diferencia es intencional.
          </p>
        )}
      </div>
    </div>
  );
}
