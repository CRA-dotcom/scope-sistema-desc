"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { FileSignature } from "lucide-react";
import { cn } from "@/lib/utils";
import { ContractsTable } from "./components/ContractsTable";
import { StuckBanner } from "./components/StuckBanner";

type StatusFilter = "all" | "draft" | "sent" | "signed" | "cancelled";

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: "Todos",
  draft: "Borrador",
  sent: "Enviados",
  signed: "Firmados",
  cancelled: "Cancelados",
};

const DAYS_OPTIONS: { label: string; value: number | undefined }[] = [
  { label: "Todas las edades", value: undefined },
  { label: "> 3 días", value: 3 },
  { label: "> 7 días", value: 7 },
  { label: "> 14 días", value: 14 },
];

export default function ContratosPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("sent");
  const [minDays, setMinDays] = useState<number | undefined>(undefined);

  const contracts = useQuery(api.functions.contracts.queries.getContractsForPipeline, {
    statusFilter,
    minDaysWithoutSigning: minDays,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <FileSignature className="text-accent" size={28} />
        <h1 className="text-2xl font-bold">Contratos</h1>
        {contracts && (
          <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs text-muted-foreground">
            {contracts.length}
          </span>
        )}
      </div>

      {/* Stuck Banner */}
      {contracts && <StuckBanner contracts={contracts} />}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Status filter buttons */}
        <div className="flex gap-1">
          {(["all", "draft", "sent", "signed", "cancelled"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "rounded-md px-3 py-2 text-xs font-medium transition-colors cursor-pointer",
                statusFilter === s
                  ? "bg-accent text-primary"
                  : "border border-border text-muted-foreground hover:bg-secondary"
              )}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>

        {/* Days threshold select */}
        <select
          value={minDays?.toString() ?? ""}
          onChange={(e) =>
            setMinDays(e.target.value ? Number(e.target.value) : undefined)
          }
          className="rounded-md border border-border bg-secondary px-3 py-2 text-xs text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer"
        >
          {DAYS_OPTIONS.map((opt) => (
            <option key={opt.label} value={opt.value?.toString() ?? ""}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Content */}
      {contracts === undefined ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-lg border border-border bg-card"
            />
          ))}
        </div>
      ) : contracts.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <FileSignature className="mx-auto mb-4 text-muted-foreground" size={48} />
          <p className="text-lg font-medium">No hay contratos</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Los contratos se generan a partir de cotizaciones aprobadas.
          </p>
        </div>
      ) : (
        <ContractsTable contracts={contracts} />
      )}
    </div>
  );
}
