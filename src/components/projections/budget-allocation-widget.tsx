"use client";

import { useMemo } from "react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  computeServiceAllocation,
  type AllocationServiceInput,
  type AllocationResult,
} from "@/lib/projection-allocation";

interface BudgetAllocationWidgetProps {
  budget: number;
  annualSales: number;
  commissionRate: number;
  services: AllocationServiceInput[];
  /** Pre-computed allocation from the page. When provided, skips internal computation. */
  allocation?: AllocationResult;
  className?: string;
}

const MARGIN_THRESHOLD = 80;
const MAX_VISIBLE_SERVICES = 3;

export function BudgetAllocationWidget({
  budget,
  annualSales,
  commissionRate,
  services,
  allocation: allocationProp,
  className,
}: BudgetAllocationWidgetProps) {
  // If the parent hoists allocation via useMemo, use that directly (no double computation).
  // Fallback to local useMemo for standalone usage (e.g., Storybook, isolated tests).
  const localAllocation = useMemo(
    () =>
      allocationProp === undefined
        ? computeServiceAllocation(budget, annualSales, commissionRate, services)
        : null,
    [allocationProp, budget, annualSales, commissionRate, services]
  );
  const allocation = allocationProp ?? localAllocation!;

  const { assigned, remaining, marginPct, perService } = allocation;

  // perService only contains non-commission entries (commission is excluded upstream).
  // Filter to active services and sort by weight descending.
  const visibleServices = perService
    .filter((s) => {
      const input = services.find((i) => i.serviceId === s.serviceId);
      return input?.isActive;
    })
    .sort((a, b) => b.chosenPct - a.chosenPct);

  const topServices = visibleServices.slice(0, MAX_VISIBLE_SERVICES);
  const restServices = visibleServices.slice(MAX_VISIBLE_SERVICES);
  const restAmount = restServices.reduce((sum, s) => sum + s.annualAmount, 0);

  // Determine remaining state
  const isBalanced = Math.abs(remaining) < 0.01;
  const isOverBudget = remaining < -0.01;

  // Determine margin state
  const isOverMargin = marginPct !== null && marginPct > MARGIN_THRESHOLD;

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card text-sm shadow-sm w-full",
        className
      )}
    >
      {/* Header: Budget */}
      <div className="px-4 py-3 border-b border-border">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
          Presupuesto
        </p>
        <p className="text-base font-bold mt-0.5">{formatCurrency(budget)}</p>
      </div>

      {/* Totals: Assigned & Remaining */}
      <div className="px-4 py-3 border-b border-border space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Asignado</span>
          <span className="font-medium">{formatCurrency(assigned)}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Restante</span>
          <span
            className={cn(
              "font-semibold",
              isBalanced
                ? "text-emerald-500"
                : isOverBudget
                  ? "text-destructive"
                  : "text-muted-foreground"
            )}
          >
            {isBalanced ? (
              "✓ Listo"
            ) : isOverBudget ? (
              <>Sobrepasaste por {formatCurrency(Math.abs(remaining))}</>
            ) : (
              formatCurrency(remaining)
            )}
          </span>
        </div>

        {/* Margin row */}
        {marginPct !== null && (
          <div className="flex items-center justify-between pt-0.5">
            <span className="text-muted-foreground">Margen</span>
            <span
              className={cn(
                "font-medium",
                isOverMargin ? "text-amber-500" : "text-emerald-500"
              )}
            >
              {marginPct.toFixed(1)}% / {MARGIN_THRESHOLD}%{" "}
              {isOverMargin ? "⚠" : "✓"}
              {isOverMargin && (
                <span className="block text-[10px] text-amber-500 text-right leading-tight mt-0.5">
                  Sobre el límite del 80%
                </span>
              )}
            </span>
          </div>
        )}
      </div>

      {/* Per-service breakdown */}
      {visibleServices.length > 0 && (
        <div className="px-4 py-3 space-y-1.5">
          {topServices.map((svc) => (
            <div
              key={svc.serviceId}
              className="flex items-center justify-between gap-2"
            >
              <span className="truncate text-muted-foreground max-w-[100px]" title={svc.serviceName}>
                {svc.serviceName}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-muted-foreground w-10 text-right">
                  {(svc.chosenPct * 100).toFixed(1)}%
                </span>
                <span className="font-medium w-28 text-right text-xs">
                  {formatCurrency(svc.annualAmount)}
                </span>
              </div>
            </div>
          ))}

          {restServices.length > 0 && (
            <div className="flex items-center justify-between gap-2 text-muted-foreground">
              <span>+ {restServices.length} más</span>
              <span className="font-medium text-xs w-28 text-right">
                {formatCurrency(restAmount)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
