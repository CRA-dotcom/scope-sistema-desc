"use client";

import { formatCurrency } from "@/lib/utils";

const MONTH_NAMES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

type Props = {
  mode: "rolling" | "fiscal";
  onModeChange: (m: "rolling" | "fiscal") => void;
  startMonth: number; // 1-12
  onStartMonthChange: (m: number) => void;
  year: number;
  totalBudget: number;
};

export function ProjectionPeriodSelector({
  mode,
  onModeChange,
  startMonth,
  onStartMonthChange,
  year,
  totalBudget,
}: Props) {
  const monthCount = mode === "fiscal" ? Math.max(1, 13 - startMonth) : 12;
  const effectiveBudget = totalBudget;
  const monthlyDistribution = monthCount > 0 ? totalBudget / monthCount : 0;

  // Compute end month/year for display
  const endIndex = startMonth - 1 + monthCount - 1;
  const endMonth = (endIndex % 12) + 1;
  const endYear = year + Math.floor(endIndex / 12);

  const formatMonthYear = (m: number, y: number) =>
    `${MONTH_NAMES[m - 1]} ${y}`;

  return (
    <div className="space-y-3">
      <label className="text-sm font-medium">Periodo de la proyección</label>
      <div className="space-y-3">
        {/* Rolling option */}
        <label className="flex items-start gap-3 rounded-md border border-border p-3 cursor-pointer hover:bg-secondary/40 transition-colors">
          <input
            type="radio"
            name="projectionMode"
            checked={mode === "rolling"}
            onChange={() => onModeChange("rolling")}
            className="mt-1 accent-accent cursor-pointer"
          />
          <div className="flex-1 space-y-2">
            <div className="text-sm font-medium">
              Contrato 12 meses corridos (default)
            </div>
            <div className="flex items-center gap-2 text-sm flex-wrap">
              <span className="text-muted-foreground">Inicio:</span>
              <select
                value={startMonth}
                onChange={(e) => onStartMonthChange(Number(e.target.value))}
                disabled={mode !== "rolling"}
                className="rounded-md border border-border bg-secondary px-2 py-1 text-sm focus:border-accent focus:outline-none disabled:opacity-50"
              >
                {MONTH_NAMES.map((name, i) => (
                  <option key={i + 1} value={i + 1}>
                    {name}
                  </option>
                ))}
              </select>
              <span className="text-muted-foreground">{year}</span>
              <span className="text-muted-foreground">→</span>
              <span>{formatMonthYear(endMonth, endYear)}</span>
            </div>
            {mode === "rolling" && (
              <p className="text-xs">
                Presupuesto contratado:{" "}
                <span className="font-medium">
                  {formatCurrency(totalBudget)}
                </span>
                {" distribuido en 12 meses (~"}
                <span className="font-medium">
                  {formatCurrency(monthlyDistribution)}
                </span>
                {"/mes)"}
              </p>
            )}
          </div>
        </label>

        {/* Fiscal option */}
        <label className="flex items-start gap-3 rounded-md border border-border p-3 cursor-pointer hover:bg-secondary/40 transition-colors">
          <input
            type="radio"
            name="projectionMode"
            checked={mode === "fiscal"}
            onChange={() => onModeChange("fiscal")}
            className="mt-1 accent-accent cursor-pointer"
          />
          <div className="flex-1 space-y-2">
            <div className="text-sm font-medium">Contrato año fiscal (hasta diciembre)</div>
            <div className="flex items-center gap-2 text-sm flex-wrap">
              <span className="text-muted-foreground">Inicio:</span>
              <select
                value={startMonth}
                onChange={(e) => onStartMonthChange(Number(e.target.value))}
                disabled={mode !== "fiscal"}
                className="rounded-md border border-border bg-secondary px-2 py-1 text-sm focus:border-accent focus:outline-none disabled:opacity-50"
              >
                {MONTH_NAMES.map((name, i) => (
                  <option key={i + 1} value={i + 1}>
                    {name}
                  </option>
                ))}
              </select>
              <span className="text-muted-foreground">{year}</span>
              <span className="text-muted-foreground">→</span>
              <span>
                {formatMonthYear(endMonth, endYear)} ({monthCount} meses)
              </span>
            </div>
            {mode === "fiscal" && (
              <>
                <p className="text-xs">
                  Presupuesto contratado:{" "}
                  <span className="font-medium">
                    {formatCurrency(totalBudget)}
                  </span>
                  {" distribuido en "}
                  <span className="font-medium">{monthCount} meses</span>
                  {" (~"}
                  <span className="font-medium">
                    {formatCurrency(monthlyDistribution)}
                  </span>
                  {"/mes)"}
                </p>
                {endMonth === 12 && (
                  <p className="text-xs text-muted-foreground italic">
                    ⓘ En enero {endYear + 1} deberás crear una nueva proyección
                    12 meses
                  </p>
                )}
              </>
            )}
          </div>
        </label>
      </div>
    </div>
  );
}
