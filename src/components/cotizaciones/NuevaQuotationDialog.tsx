"use client";

/**
 * #22b — Manual quotation creation dialog.
 * #22c — Issuing company selector.
 * #22d — Optional subservice selector.
 *
 * Flow: pick projection → pick projService → optional issuingCompany/subservice
 * → submit createManualQuotation mutation → navigate to new quotation detail.
 */

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NuevaQuotationDialog({ open, onOpenChange }: Props) {
  const router = useRouter();

  const [selectedProjectionId, setSelectedProjectionId] =
    useState<Id<"projections"> | "">("");
  const [selectedProjServiceId, setSelectedProjServiceId] =
    useState<Id<"projectionServices"> | "">("");
  const [selectedIssuingCompanyId, setSelectedIssuingCompanyId] =
    useState<Id<"issuingCompanies"> | "">("");
  const [selectedSubserviceId, setSelectedSubserviceId] =
    useState<Id<"subservices"> | "">("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const projections = useQuery(api.functions.projections.queries.list, {});
  const projServices = useQuery(
    api.functions.projectionServices.queries.listByProjection,
    selectedProjectionId ? { projectionId: selectedProjectionId } : "skip"
  );
  const issuingCompanies = useQuery(
    api.functions.issuingCompanies.queries.list,
    {}
  );

  const createManualQuotation = useMutation(
    api.functions.quotations.mutations.createManualQuotation
  );

  const activeProjections = projections?.filter(
    (p) => p.status === "active"
  ) ?? [];

  const activeServices = projServices?.filter((ps) => ps.isActive) ?? [];

  const handleClose = () => {
    setSelectedProjectionId("");
    setSelectedProjServiceId("");
    setSelectedIssuingCompanyId("");
    setSelectedSubserviceId("");
    setError(null);
    onOpenChange(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjServiceId) {
      setError("Selecciona un servicio de proyección.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const id = await createManualQuotation({
        projServiceId: selectedProjServiceId,
        ...(selectedIssuingCompanyId && {
          issuingCompanyId: selectedIssuingCompanyId,
        }),
        ...(selectedSubserviceId && {
          subserviceId: selectedSubserviceId,
        }),
      });
      handleClose();
      router.push(`/cotizaciones/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear cotización.");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="relative w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-xl">
        {/* Close */}
        <button
          onClick={handleClose}
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <X size={18} />
        </button>

        <h2 className="mb-5 text-lg font-semibold">Nueva cotización</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Projection */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              Proyección <span className="text-red-400">*</span>
            </label>
            <select
              value={selectedProjectionId}
              onChange={(e) => {
                setSelectedProjectionId(
                  e.target.value as Id<"projections"> | ""
                );
                setSelectedProjServiceId("");
              }}
              required
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="">Seleccionar proyección...</option>
              {activeProjections.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.clientName} — {p.year}
                </option>
              ))}
            </select>
          </div>

          {/* Projection Service */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              Servicio de proyección <span className="text-red-400">*</span>
            </label>
            <select
              value={selectedProjServiceId}
              onChange={(e) =>
                setSelectedProjServiceId(
                  e.target.value as Id<"projectionServices"> | ""
                )
              }
              required
              disabled={!selectedProjectionId || activeServices.length === 0}
              className={cn(
                "w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent",
                (!selectedProjectionId || activeServices.length === 0) &&
                  "opacity-50 cursor-not-allowed"
              )}
            >
              <option value="">
                {!selectedProjectionId
                  ? "Primero selecciona una proyección..."
                  : activeServices.length === 0
                  ? "Sin servicios activos"
                  : "Seleccionar servicio..."}
              </option>
              {activeServices.map((ps) => (
                <option key={ps._id} value={ps._id}>
                  {ps.serviceName}
                </option>
              ))}
            </select>
          </div>

          {/* Issuing Company (#22c) */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              Empresa emitente{" "}
              <span className="text-muted-foreground text-xs">(opcional)</span>
            </label>
            <select
              value={selectedIssuingCompanyId}
              onChange={(e) =>
                setSelectedIssuingCompanyId(
                  e.target.value as Id<"issuingCompanies"> | ""
                )
              }
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="">Auto-resolver por servicio...</option>
              {(issuingCompanies ?? []).map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                  {c.isDefault ? " (predeterminada)" : ""}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-secondary transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || !selectedProjServiceId}
              className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-primary hover:bg-accent/90 transition-colors cursor-pointer disabled:opacity-50"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              Crear cotización
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
