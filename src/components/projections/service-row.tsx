"use client";

import { cn, formatCurrency } from "@/lib/utils";
import type { AllocationResult } from "@/lib/projection-allocation";

type ServiceFormState = {
  serviceId: string;
  serviceName: string;
  type: "base" | "comodin";
  minPct: number;
  maxPct: number;
  chosenPct: number;
  isActive: boolean;
  isCommission: boolean;
};

type ServiceRowProps = {
  service: ServiceFormState;
  allocation: AllocationResult["perService"][number] | null;
  annualSales: number;
  commissionRate: number;
  onToggleActive: (next: boolean) => void;
  onChangePct: (next: number) => void;
};

export function ServiceRow({
  service,
  allocation,
  annualSales: _annualSales,
  commissionRate,
  onToggleActive,
  onChangePct,
}: ServiceRowProps) {
  const isFullyActive = service.isActive && !service.isCommission;

  return (
    <div
      className={cn(
        "rounded-md border p-3 transition-colors",
        service.isActive ? "border-accent/30 bg-accent/5" : "border-border opacity-50"
      )}
    >
      {/* Line 1: checkbox + name + range/commission */}
      <div className="flex items-center gap-4">
        <input
          type="checkbox"
          checked={service.isActive}
          onChange={(e) => onToggleActive(e.target.checked)}
          className="accent-accent cursor-pointer"
          disabled={service.isCommission}
        />
        <div className="flex-1">
          <p className="text-sm font-medium">{service.serviceName}</p>
          <p className="text-xs text-muted-foreground">
            {service.type === "base" ? "Base" : "Comodín"} &middot;{" "}
            {service.isCommission
              ? `= Tasa de comisión (${(commissionRate * 100).toFixed(1)}%)`
              : `Rango: ${(service.minPct * 100).toFixed(1)}% - ${(service.maxPct * 100).toFixed(1)}%`}
          </p>
        </div>
      </div>

      {/* Line 2: slider + percentage (only when active + not commission) */}
      {isFullyActive && (
        <div className="mt-2 flex items-center gap-3">
          <input
            type="range"
            min={service.minPct * 100}
            max={service.maxPct * 100}
            step={0.5}
            value={service.chosenPct * 100}
            onChange={(e) => onChangePct(Number(e.target.value) / 100)}
            className="flex-1 accent-accent cursor-pointer"
          />
          <span className="w-14 text-right text-sm font-medium">
            {(service.chosenPct * 100).toFixed(1)}%
          </span>
        </div>
      )}

      {/* Line 3: market$ + budget$ + indicator (only when active + not commission + allocation present) */}
      {isFullyActive && allocation && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {allocation.marketStatus !== "n/a" && (
            <span className="text-muted-foreground">
              Mercado:{" "}
              <span className="font-medium text-foreground">
                {formatCurrency(allocation.marketAmount)}
              </span>
            </span>
          )}
          <span className="text-muted-foreground">
            Presupuesto:{" "}
            <span className="font-medium text-accent">
              {formatCurrency(allocation.annualAmount)}
            </span>
          </span>
          {allocation.marketStatus !== "n/a" && (
            <MarketIndicator
              status={allocation.marketStatus}
              delta={allocation.marketDelta}
              minPct={service.minPct}
              maxPct={service.maxPct}
            />
          )}
        </div>
      )}
    </div>
  );
}

type MarketIndicatorProps = {
  status: "below" | "within" | "above";
  delta: number;
  minPct: number;
  maxPct: number;
};

function MarketIndicator({ status, delta, minPct, maxPct }: MarketIndicatorProps) {
  const minText = `${(minPct * 100).toFixed(1)}%`;
  const maxText = `${(maxPct * 100).toFixed(1)}%`;

  if (status === "within") {
    return (
      <span
        className="text-emerald-500 font-medium"
        title={`Dentro del rango de mercado (${minText} - ${maxText}).`}
      >
        ✓ dentro
      </span>
    );
  }
  if (status === "below") {
    return (
      <span
        className="text-amber-500 font-medium"
        title={`Bajo el mínimo de mercado (${minText}). El servicio puede recibir poca cobertura.`}
      >
        ⚡ -{delta.toFixed(1)}pp
      </span>
    );
  }
  // status === "above"
  return (
    <span
      className="text-red-400 font-medium"
      title={`Sobre el máximo de mercado (${maxText}). Considera agregar más áreas.`}
    >
      ⚠ +{delta.toFixed(1)}pp
    </span>
  );
}
