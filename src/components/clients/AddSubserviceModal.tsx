"use client";

/**
 * B1 — Modal "Agregar subservicio mid-year".
 *
 * Selecciona padre + subservicio + ventana de meses + monto mensual, muestra
 * preview total (meses × monto = total), llama
 * `projections.addSubserviceMidYear` y al terminar redirige a la cotización
 * suplementaria recién creada.
 *
 * Per docs/superpowers/specs/2026-05-26-client-services-overview-design.md §3.2
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { X, Loader2 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { formatCurrency } from "@/lib/utils";

const MONTHS = [
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

interface Props {
  open: boolean;
  onClose: () => void;
  clientId: Id<"clients">;
  projectionId: Id<"projections">;
  projectionYear: number;
}

export function AddSubserviceModal({
  open,
  onClose,
  projectionId,
  projectionYear,
}: Props) {
  const router = useRouter();
  const services = useQuery(api.functions.services.queries.listByOrg);
  const [parentServiceId, setParentServiceId] = useState<Id<"services"> | "">(
    ""
  );
  const subservices = useQuery(
    api.functions.subservices.queries.listByParent,
    parentServiceId ? { parentServiceId } : "skip"
  );
  const [subserviceId, setSubserviceId] = useState<Id<"subservices"> | "">("");

  const currentYear = new Date().getUTCFullYear();
  const currentMonth = new Date().getUTCMonth() + 1;
  const defaultStartMonth =
    projectionYear === currentYear ? Math.min(currentMonth + 1, 12) : 1;

  const [startMonth, setStartMonth] = useState<number>(defaultStartMonth);
  const [endMonth, setEndMonth] = useState<number>(12);
  const [monthlyAmount, setMonthlyAmount] = useState<string>("");
  const [pricingHintApplied, setPricingHintApplied] =
    useState<Id<"subservices"> | null>(null);
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addMidYear = useMutation(
    api.functions.projections.mutations.addSubserviceMidYear
  );

  // Reset state when the modal closes (so reopening starts clean).
  useEffect(() => {
    if (!open) {
      setParentServiceId("");
      setSubserviceId("");
      setStartMonth(defaultStartMonth);
      setEndMonth(12);
      setMonthlyAmount("");
      setPricingHintApplied(null);
      setNotes("");
      setError(null);
      setSubmitting(false);
    }
    // defaultStartMonth depends on projectionYear which is stable for the
    // modal's lifetime; safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep endMonth >= startMonth.
  useEffect(() => {
    if (endMonth < startMonth) setEndMonth(startMonth);
  }, [startMonth, endMonth]);

  // Pre-fill monthlyAmount from subservice.defaultPricingHint (once per
  // subservice selection, only if the user hasn't typed anything).
  const selectedSub = subservices?.find((s) => s._id === subserviceId) ?? null;
  useEffect(() => {
    if (!selectedSub) return;
    if (pricingHintApplied === selectedSub._id) return;
    if (selectedSub.defaultPricingHint && monthlyAmount === "") {
      setMonthlyAmount(String(selectedSub.defaultPricingHint));
      setPricingHintApplied(selectedSub._id);
    }
  }, [selectedSub, pricingHintApplied, monthlyAmount]);

  const amt = parseFloat(monthlyAmount);
  const monthsCount = endMonth - startMonth + 1;
  const totalAmount = useMemo(() => {
    if (!Number.isFinite(amt) || amt <= 0) return 0;
    if (monthsCount <= 0) return 0;
    return amt * monthsCount;
  }, [amt, monthsCount]);

  async function handleSubmit() {
    setError(null);
    if (!subserviceId) {
      setError("Selecciona un subservicio.");
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("Monto mensual inválido.");
      return;
    }
    if (endMonth < startMonth) {
      setError("Mes de fin debe ser mayor o igual al mes de inicio.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await addMidYear({
        projectionId,
        subserviceId,
        startMonth,
        endMonth,
        monthlyAmount: amt,
        notes: notes.trim() || undefined,
      });
      onClose();
      router.push(`/cotizaciones/${result.quotationId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido.");
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-subservice-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-lg"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 id="add-subservice-title" className="text-lg font-semibold">
            Agregar subservicio
          </h3>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground cursor-pointer"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label
              htmlFor="add-sub-parent"
              className="mb-1 block text-sm font-medium text-foreground"
            >
              Servicio padre
            </label>
            <select
              id="add-sub-parent"
              value={parentServiceId}
              onChange={(e) => {
                setParentServiceId(e.target.value as Id<"services">);
                setSubserviceId("");
                setPricingHintApplied(null);
              }}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="">— Selecciona —</option>
              {services?.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {parentServiceId && (
            <div>
              <label
                htmlFor="add-sub-child"
                className="mb-1 block text-sm font-medium text-foreground"
              >
                Subservicio
              </label>
              <select
                id="add-sub-child"
                value={subserviceId}
                onChange={(e) =>
                  setSubserviceId(e.target.value as Id<"subservices">)
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="">— Selecciona —</option>
                {subservices?.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.name} · {s.defaultFrequency}
                  </option>
                ))}
              </select>
              {subservices && subservices.length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  No hay subservicios bajo este padre. Crea uno en{" "}
                  <a
                    href="/configuracion/subservicios"
                    className="text-accent hover:underline"
                  >
                    /configuracion/subservicios
                  </a>
                  .
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="add-sub-start"
                className="mb-1 block text-sm font-medium text-foreground"
              >
                Mes de inicio
              </label>
              <select
                id="add-sub-start"
                value={startMonth}
                onChange={(e) =>
                  setStartMonth(parseInt(e.target.value, 10))
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                {MONTHS.map((m, i) => {
                  const monthNum = i + 1;
                  const disabled =
                    projectionYear === currentYear && monthNum < currentMonth;
                  return (
                    <option key={i} value={monthNum} disabled={disabled}>
                      {m} {projectionYear}
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <label
                htmlFor="add-sub-end"
                className="mb-1 block text-sm font-medium text-foreground"
              >
                Mes de fin
              </label>
              <select
                id="add-sub-end"
                value={endMonth}
                onChange={(e) => setEndMonth(parseInt(e.target.value, 10))}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                {MONTHS.map((m, i) => {
                  const monthNum = i + 1;
                  return (
                    <option
                      key={i}
                      value={monthNum}
                      disabled={monthNum < startMonth}
                    >
                      {m} {projectionYear}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          <div>
            <label
              htmlFor="add-sub-amount"
              className="mb-1 block text-sm font-medium text-foreground"
            >
              Monto mensual (MXN)
            </label>
            <input
              id="add-sub-amount"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={monthlyAmount}
              onChange={(e) => setMonthlyAmount(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder="4500"
            />
          </div>

          <div>
            <label
              htmlFor="add-sub-notes"
              className="mb-1 block text-sm font-medium text-foreground"
            >
              Notas (opcional)
            </label>
            <textarea
              id="add-sub-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder="Visibles en el PDF de la cotización."
            />
          </div>

          {totalAmount > 0 && (
            <div className="rounded-md border border-accent/30 bg-accent/5 p-3 text-sm">
              <p className="font-medium">
                Cotización suplementaria: {monthsCount} meses ×{" "}
                {formatCurrency(amt)} ={" "}
                <span className="text-accent">
                  {formatCurrency(totalAmount)}
                </span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Se enviará al cliente para firma. El servicio queda vigente
                hasta el 31 de diciembre y se renueva con el contrato anual el
                1 de enero.
              </p>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400"
            >
              {error}
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-secondary transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !subserviceId || totalAmount <= 0}
            className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-primary hover:bg-accent/90 transition-colors cursor-pointer disabled:opacity-50"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {submitting ? "Creando..." : "Crear cotización"}
          </button>
        </div>
      </div>
    </div>
  );
}
