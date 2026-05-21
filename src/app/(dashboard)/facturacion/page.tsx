"use client";

import { useQuery, useMutation, useAction } from "convex/react";
import { useOrganization } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useState, useMemo, useEffect, useRef } from "react";
import {
  Receipt,
  Filter,
  ChevronDown,
  UploadCloud,
  Eye,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

// A3: legacy invoice statuses on monthlyAssignments are NOT shown in the UI
// (decision 2026-05-20, spec §4.1). Backend sync stays via markPaid.
const MA_STATUS_FILTER_LABELS = {
  not_invoiced: "Sin Facturar",
  invoiced: "Facturado",
  paid: "Pagado",
} as const;

type MaInvoiceStatus = keyof typeof MA_STATUS_FILTER_LABELS;

// Mirrors the lifecycle states from `invoices.status` in the schema.
type InvoiceRow = {
  _id: Id<"invoices">;
  orgId: string;
  clientId: Id<"clients">;
  projectionId: Id<"projections">;
  projServiceId?: Id<"projectionServices">;
  subserviceId?: Id<"subservices">;
  serviceName: string;
  monthlyAssignmentId?: Id<"monthlyAssignments">;
  month: number;
  year: number;
  amount: number;
  filename: string;
  status: "uploaded" | "paid" | "void";
  createdAt: number;
};

// Local snapshot of the MA row fields we touch from billingQueries.
type AssignmentRow = {
  _id: Id<"monthlyAssignments">;
  orgId: string;
  projServiceId: Id<"projectionServices">;
  projectionId: Id<"projections">;
  clientId: Id<"clients">;
  clientName: string;
  serviceName: string;
  subserviceId?: Id<"subservices">;
  month: number;
  year: number;
  amount: number;
  status: "pending" | "info_received" | "in_progress" | "delivered";
  invoiceStatus: MaInvoiceStatus;
};

export default function FacturacionPage() {
  const searchParams = useSearchParams();
  const currentYear = new Date().getFullYear();
  const initialYear = Number(searchParams.get("year")) || currentYear;
  const initialMonth = (() => {
    const raw = searchParams.get("month");
    if (!raw) return undefined;
    const n = Number(raw);
    return n >= 1 && n <= 12 ? n : undefined;
  })();
  const [selectedYear, setSelectedYear] = useState(initialYear);
  const [selectedMonth, setSelectedMonth] = useState<number | undefined>(initialMonth);
  const [selectedService, setSelectedService] = useState<string | undefined>(undefined);
  const [selectedStatus, setSelectedStatus] = useState<MaInvoiceStatus | undefined>(undefined);

  const { membership } = useOrganization();
  const isAdmin = membership?.role === "org:admin";

  // Drives the assignments table (one row per scheduled service-month).
  const assignments = useQuery(
    api.functions.monthlyAssignments.billingQueries.listForInvoiceTracking,
    {
      year: selectedYear,
      month: selectedMonth,
      serviceName: selectedService,
      invoiceStatus: selectedStatus,
    }
  ) as AssignmentRow[] | undefined;

  // Cross-reference: pull all invoices for the selected period, join by MA id.
  const invoiceRows = useQuery(
    api.functions.invoices.queries.listForBilling,
    { year: selectedYear, month: selectedMonth }
  ) as InvoiceRow[] | undefined;

  // Group invoices by `monthlyAssignmentId` and pick the most recent non-void
  // row when duplicates exist (spec §4.1 / context note in task prompt).
  const invoiceByMaId = useMemo(() => {
    const map = new Map<string, InvoiceRow>();
    if (!invoiceRows) return map;
    for (const inv of invoiceRows) {
      if (!inv.monthlyAssignmentId) continue;
      const key = inv.monthlyAssignmentId as unknown as string;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, inv);
        continue;
      }
      // Prefer non-void over void; among same-bucket, most recent wins.
      const existingIsVoid = existing.status === "void";
      const candIsVoid = inv.status === "void";
      if (existingIsVoid && !candIsVoid) {
        map.set(key, inv);
      } else if (!existingIsVoid && candIsVoid) {
        // keep existing
      } else if (inv.createdAt > existing.createdAt) {
        map.set(key, inv);
      }
    }
    return map;
  }, [invoiceRows]);

  // UI state for modals + optimistic "generando…" badge.
  const [pendingUpload, setPendingUpload] = useState<AssignmentRow | null>(null);
  const [pendingMarkPaid, setPendingMarkPaid] = useState<InvoiceRow | null>(null);
  const [pendingVoid, setPendingVoid] = useState<InvoiceRow | null>(null);
  const [paidPendingGen, setPaidPendingGen] = useState<Set<string>>(new Set());

  // Track active 30s fallback timers (one per pending invoice) so they can be
  // cancelled on unmount or when the deliverables subscription confirms early.
  const paidGenTimersRef = useRef<Map<string, number>>(new Map());

  // Subscribe to deliverables for the selected period. When one appears whose
  // `triggerInvoiceId` matches a pending invoice id, clear the optimistic badge
  // immediately (no need to wait for the 30s fallback).
  const deliverablesForPeriod = useQuery(
    api.functions.deliverables.queries.listByOrg,
    { year: selectedYear, month: selectedMonth }
  ) as { triggerInvoiceId?: Id<"invoices"> }[] | undefined;

  // Reconcile: any pending invoice whose deliverable is now visible → clear.
  useEffect(() => {
    if (!deliverablesForPeriod || paidPendingGen.size === 0) return;
    const seen = new Set<string>();
    for (const d of deliverablesForPeriod) {
      if (d.triggerInvoiceId) {
        seen.add(d.triggerInvoiceId as unknown as string);
      }
    }
    const toClear: string[] = [];
    for (const invId of paidPendingGen) {
      if (seen.has(invId)) toClear.push(invId);
    }
    if (toClear.length === 0) return;
    // Cancel the matching fallback timers + remove ids from the set.
    for (const invId of toClear) {
      const tid = paidGenTimersRef.current.get(invId);
      if (tid !== undefined) {
        window.clearTimeout(tid);
        paidGenTimersRef.current.delete(invId);
      }
    }
    setPaidPendingGen((prev) => {
      const next = new Set(prev);
      for (const invId of toClear) next.delete(invId);
      return next;
    });
  }, [deliverablesForPeriod, paidPendingGen]);

  // Cleanup all outstanding timers on unmount.
  useEffect(() => {
    const timers = paidGenTimersRef.current;
    return () => {
      for (const tid of timers.values()) {
        window.clearTimeout(tid);
      }
      timers.clear();
    };
  }, []);

  const serviceNames = assignments
    ? [...new Set(assignments.map((a) => a.serviceName))].sort()
    : [];

  const grouped = assignments
    ? assignments.reduce(
        (acc, a) => {
          const key = `${a.year}-${String(a.month).padStart(2, "0")}`;
          if (!acc[key]) acc[key] = [];
          acc[key].push(a);
          return acc;
        },
        {} as Record<string, AssignmentRow[]>
      )
    : {};

  const sortedMonthKeys = Object.keys(grouped).sort().reverse();

  const totalAmount = assignments?.reduce((sum, a) => sum + a.amount, 0) ?? 0;
  const statusCounts = assignments?.reduce(
    (acc, a) => {
      acc[a.invoiceStatus] = (acc[a.invoiceStatus] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  ) ?? {};

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Receipt className="text-accent" size={28} />
        <h1 className="text-2xl font-bold">Facturación</h1>
      </div>

      <p className="text-sm text-muted-foreground">
        Seguimiento de facturación por mes, servicio y estado de pago.
      </p>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="text-2xl font-bold text-accent">
            ${totalAmount.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Sin Facturar</p>
          <p className="text-2xl font-bold text-warning">
            {statusCounts.not_invoiced ?? 0}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Facturados</p>
          <p className="text-2xl font-bold text-info">
            {statusCounts.invoiced ?? 0}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Pagados</p>
          <p className="text-2xl font-bold text-accent">
            {statusCounts.paid ?? 0}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4">
        <Filter size={16} className="text-muted-foreground" />
        <span className="text-sm font-medium text-muted-foreground">Filtros:</span>

        {/* Year */}
        <div className="relative">
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            aria-label="Año"
            className="appearance-none rounded-md border border-border bg-secondary px-3 py-1.5 pr-8 text-sm text-foreground"
          >
            {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
        </div>

        {/* Month */}
        <div className="relative">
          <select
            value={selectedMonth ?? ""}
            onChange={(e) =>
              setSelectedMonth(e.target.value ? Number(e.target.value) : undefined)
            }
            aria-label="Mes"
            className="appearance-none rounded-md border border-border bg-secondary px-3 py-1.5 pr-8 text-sm text-foreground"
          >
            <option value="">Todos los meses</option>
            {MONTHS.map((name, i) => (
              <option key={i} value={i + 1}>
                {name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
        </div>

        {/* Service */}
        <div className="relative">
          <select
            value={selectedService ?? ""}
            onChange={(e) =>
              setSelectedService(e.target.value || undefined)
            }
            aria-label="Servicio"
            className="appearance-none rounded-md border border-border bg-secondary px-3 py-1.5 pr-8 text-sm text-foreground"
          >
            <option value="">Todos los servicios</option>
            {serviceNames.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
        </div>

        {/* Status (filter only — legacy MA status, no longer editable inline) */}
        <div className="relative">
          <select
            value={selectedStatus ?? ""}
            onChange={(e) =>
              setSelectedStatus((e.target.value || undefined) as MaInvoiceStatus | undefined)
            }
            aria-label="Estado factura (legacy)"
            className="appearance-none rounded-md border border-border bg-secondary px-3 py-1.5 pr-8 text-sm text-foreground"
          >
            <option value="">Todos los estados</option>
            <option value="not_invoiced">Sin Facturar</option>
            <option value="invoiced">Facturado</option>
            <option value="paid">Pagado</option>
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
        </div>
      </div>

      {/* Loading / Empty / Table */}
      {assignments === undefined ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg border border-border bg-card" />
          ))}
        </div>
      ) : assignments.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <Receipt className="mx-auto mb-3 text-muted-foreground" size={40} />
          <p className="text-muted-foreground">No se encontraron asignaciones con los filtros seleccionados.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {sortedMonthKeys.map((monthKey) => {
            const items = grouped[monthKey];
            const [yearStr, monthStr] = monthKey.split("-");
            const monthIndex = parseInt(monthStr, 10) - 1;
            const monthTotal = items.reduce((sum, a) => sum + a.amount, 0);

            return (
              <div key={monthKey} className="rounded-lg border border-border bg-card overflow-hidden">
                {/* Month Header */}
                <div className="flex items-center justify-between border-b border-border bg-secondary/30 px-4 py-3">
                  <h2 className="text-sm font-semibold">
                    {MONTHS[monthIndex]} {yearStr}
                  </h2>
                  <span className="text-sm font-medium text-accent">
                    ${monthTotal.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                  </span>
                </div>

                {/* Table */}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-4 py-2.5 text-left font-medium">Cliente</th>
                      <th className="px-4 py-2.5 text-left font-medium">Servicio</th>
                      <th className="px-4 py-2.5 text-right font-medium">Monto</th>
                      <th className="px-4 py-2.5 text-center font-medium">Factura PDF</th>
                      <th className="px-4 py-2.5 text-center font-medium">Estado Entrega</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...items]
                      .sort((a, b) => a.clientName.localeCompare(b.clientName))
                      .map((item) => {
                        const invoice = invoiceByMaId.get(
                          item._id as unknown as string
                        );
                        const isPendingGen = invoice
                          ? paidPendingGen.has(invoice._id as unknown as string)
                          : false;
                        return (
                          <tr
                            key={item._id}
                            className="border-b border-border/50 hover:bg-secondary/30 transition-colors"
                          >
                            <td className="px-4 py-2.5 font-medium">{item.clientName}</td>
                            <td className="px-4 py-2.5 text-muted-foreground">{item.serviceName}</td>
                            <td className="px-4 py-2.5 text-right font-medium">
                              ${item.amount.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <InvoicePdfCell
                                invoice={invoice}
                                assignment={item}
                                isAdmin={isAdmin}
                                isPendingGen={isPendingGen}
                                onUpload={() => setPendingUpload(item)}
                                onMarkPaid={(inv) => setPendingMarkPaid(inv)}
                                onVoid={(inv) => setPendingVoid(inv)}
                              />
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <span className={cn(
                                "rounded-full px-2 py-0.5 text-xs font-medium",
                                item.status === "delivered"
                                  ? "bg-accent/10 text-accent"
                                  : item.status === "in_progress"
                                    ? "bg-info/10 text-info"
                                    : "bg-muted/50 text-muted-foreground"
                              )}>
                                {item.status === "pending" && "Pendiente"}
                                {item.status === "info_received" && "Info Recibida"}
                                {item.status === "in_progress" && "En Progreso"}
                                {item.status === "delivered" && "Entregado"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}

      {pendingUpload && (
        <UploadInvoiceDialog
          assignment={pendingUpload}
          onClose={() => setPendingUpload(null)}
        />
      )}
      {pendingMarkPaid && (
        <MarkPaidConfirm
          invoice={pendingMarkPaid}
          onClose={() => setPendingMarkPaid(null)}
          onOptimisticTrack={(invoiceId) => {
            const key = invoiceId as unknown as string;
            setPaidPendingGen((prev) => {
              const next = new Set(prev);
              next.add(key);
              return next;
            });
            // Schedule a 30s fallback in case the deliverables subscription
            // never confirms (spec §4.1). Timer id stored in the ref so it
            // can be cancelled early (deliverable arrived) or on unmount.
            const existing = paidGenTimersRef.current.get(key);
            if (existing !== undefined) window.clearTimeout(existing);
            const tid = window.setTimeout(() => {
              paidGenTimersRef.current.delete(key);
              setPaidPendingGen((prev) => {
                const next = new Set(prev);
                next.delete(key);
                return next;
              });
            }, 30_000);
            paidGenTimersRef.current.set(key, tid);
          }}
        />
      )}
      {pendingVoid && isAdmin && (
        <VoidInvoiceDialog
          invoice={pendingVoid}
          onClose={() => setPendingVoid(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invoice PDF cell — encodes the 4 lifecycle states (spec §4.1 column states).
// ---------------------------------------------------------------------------

function InvoicePdfCell({
  invoice,
  assignment,
  isAdmin,
  isPendingGen,
  onUpload,
  onMarkPaid,
  onVoid,
}: {
  invoice: InvoiceRow | undefined;
  assignment: AssignmentRow;
  isAdmin: boolean;
  isPendingGen: boolean;
  onUpload: () => void;
  onMarkPaid: (inv: InvoiceRow) => void;
  onVoid: (inv: InvoiceRow) => void;
}) {
  const getDownloadUrl = useAction(
    api.functions.invoices.actions.getDownloadUrl
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openInvoice(inv: InvoiceRow) {
    setBusy(true);
    setError(null);
    try {
      const url = await getDownloadUrl({ invoiceId: inv._id });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError((err as Error).message ?? "Error al obtener URL.");
    } finally {
      setBusy(false);
    }
  }

  if (!invoice) {
    return (
      <button
        type="button"
        onClick={onUpload}
        data-testid={`upload-invoice-btn-${assignment._id}`}
        className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors cursor-pointer"
        title="Subir factura PDF"
      >
        <UploadCloud size={14} /> Subir factura
      </button>
    );
  }

  if (invoice.status === "uploaded") {
    return (
      <div className="inline-flex items-center justify-center gap-2">
        <span
          data-testid="badge-uploaded"
          className="inline-flex items-center rounded-full bg-info/10 px-2 py-0.5 text-xs font-medium text-info"
        >
          Subida
        </span>
        <button
          type="button"
          onClick={() => openInvoice(invoice)}
          disabled={busy}
          className="inline-flex items-center gap-1 text-xs text-accent hover:underline cursor-pointer disabled:opacity-50"
          aria-label="Ver factura"
        >
          <Eye size={12} /> Ver
        </button>
        <button
          type="button"
          onClick={() => onMarkPaid(invoice)}
          data-testid={`mark-paid-btn-${invoice._id}`}
          className="inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-xs font-medium text-accent hover:bg-accent/20 transition-colors cursor-pointer"
        >
          <CheckCircle2 size={12} /> Marcar pagada
        </button>
        {error && (
          <span role="alert" className="text-[10px] text-red-400">
            {error}
          </span>
        )}
      </div>
    );
  }

  if (invoice.status === "paid") {
    return (
      <div className="inline-flex items-center justify-center gap-2">
        <span
          data-testid="badge-paid"
          className="inline-flex items-center rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent"
        >
          {isPendingGen ? (
            <>
              <Loader2 size={10} className="mr-1 animate-spin" />
              Pagada · generando…
            </>
          ) : (
            "Pagada"
          )}
        </span>
        <button
          type="button"
          onClick={() => openInvoice(invoice)}
          disabled={busy}
          className="inline-flex items-center gap-1 text-xs text-accent hover:underline cursor-pointer disabled:opacity-50"
          aria-label="Ver factura pagada"
        >
          <Eye size={12} /> Ver
        </button>
        {isAdmin && (
          <button
            type="button"
            onClick={() => onVoid(invoice)}
            data-testid={`void-btn-${invoice._id}`}
            className="inline-flex items-center gap-1 rounded-md border border-red-400/40 bg-red-500/10 px-2 py-1 text-xs font-medium text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer"
          >
            <XCircle size={12} /> Anular
          </button>
        )}
        {error && (
          <span role="alert" className="text-[10px] text-red-400">
            {error}
          </span>
        )}
      </div>
    );
  }

  // status === "void"
  return (
    <div className="inline-flex items-center justify-center gap-2">
      <span
        data-testid="badge-void"
        className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground line-through"
      >
        Anulada
      </span>
      <span
        className="inline-flex items-center gap-1 text-xs text-muted-foreground opacity-60 cursor-not-allowed select-none"
        aria-disabled="true"
        title="Factura anulada"
      >
        <Eye size={12} /> Ver
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upload dialog.
// ---------------------------------------------------------------------------

function UploadInvoiceDialog({
  assignment,
  onClose,
}: {
  assignment: AssignmentRow;
  onClose: () => void;
}) {
  const upload = useAction(api.functions.invoices.actions.upload);
  const [file, setFile] = useState<File | null>(null);
  const [amount, setAmount] = useState<number>(assignment.amount);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [duplicateOf, setDuplicateOf] = useState(false);

  // Auto-close after duplicate warning; tracked so unmount or `duplicateOf`
  // change cancels the timer (prevents double-onClose + unmount warnings).
  useEffect(() => {
    if (!duplicateOf) return;
    const id = window.setTimeout(() => onClose(), 2500);
    return () => window.clearTimeout(id);
  }, [duplicateOf, onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setWarning(null);

    if (!file) {
      setError("Selecciona un archivo PDF.");
      return;
    }
    // Client-side mime validation (server re-validates).
    if (file.type !== "application/pdf") {
      setError("Solo se aceptan archivos PDF.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("El monto debe ser mayor a $0");
      return;
    }

    setSubmitting(true);
    try {
      const buffer = await file.arrayBuffer();
      const result = await upload({
        clientId: assignment.clientId,
        projectionId: assignment.projectionId,
        projServiceId: assignment.projServiceId,
        subserviceId: assignment.subserviceId,
        serviceName: assignment.serviceName,
        monthlyAssignmentId: assignment._id,
        month: assignment.month,
        year: assignment.year,
        amount,
        filename: file.name,
        contentType: file.type,
        fileBuffer: buffer,
        notes: notes.trim() ? notes.trim() : undefined,
      });
      if (result.duplicateOf) {
        setWarning(
          "Ya existe factura previa para este mes-servicio. Verifica antes de marcar pagada."
        );
        // Hold the dialog open briefly so the operator sees the warning.
        // Auto-close timer is tracked via useEffect below so unmount is safe.
        setDuplicateOf(true);
      } else {
        onClose();
      }
    } catch (err) {
      setError((err as Error).message ?? "Error al subir factura.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Subir factura"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Subir factura</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded p-1 text-muted-foreground hover:bg-secondary transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {assignment.clientName} · {assignment.serviceName} ·{" "}
          {MONTHS[assignment.month - 1]} {assignment.year}
        </p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="space-y-1">
            <label htmlFor="invoice-file" className="text-sm font-medium">
              Archivo PDF
            </label>
            <input
              id="invoice-file"
              type="file"
              accept="application/pdf"
              required
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-muted cursor-pointer"
            />
            {file && (
              <p className="text-[11px] text-muted-foreground">
                {file.name} · {(file.size / 1024).toFixed(1)} KB
              </p>
            )}
          </div>
          <div className="space-y-1">
            <label htmlFor="invoice-amount" className="text-sm font-medium">
              Monto (MXN)
            </label>
            <input
              id="invoice-amount"
              type="number"
              required
              min={0.01}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="invoice-notes" className="text-sm font-medium">
              Notas (opcional)
            </label>
            <textarea
              id="invoice-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            El cliente recibirá un correo con la factura automáticamente.
          </p>

          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
          {warning && (
            <p role="status" className="inline-flex items-center gap-1 text-sm text-amber-400">
              <AlertTriangle size={14} /> {warning}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || !file}
              data-testid="upload-submit-btn"
              className="inline-flex items-center gap-1 rounded-md bg-accent px-4 py-2 text-sm font-medium text-primary hover:bg-accent/90 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {submitting && <Loader2 size={12} className="animate-spin" />}
              Subir
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mark Paid confirmation dialog.
// ---------------------------------------------------------------------------

function MarkPaidConfirm({
  invoice,
  onClose,
  onOptimisticTrack,
}: {
  invoice: InvoiceRow;
  onClose: () => void;
  onOptimisticTrack: (invoiceId: Id<"invoices">) => void;
}) {
  const markPaid = useMutation(api.functions.invoices.mutations.markPaid);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      await markPaid({ invoiceId: invoice._id });
      onOptimisticTrack(invoice._id);
      onClose();
    } catch (err) {
      setError((err as Error).message ?? "Error al marcar pagada.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirmar marcar pagada"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <CheckCircle2 className="text-accent" size={22} />
          <div>
            <h2 className="text-lg font-semibold">
              ¿Marcar la factura como pagada?
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Esto generará automáticamente el entregable. La acción es
              idempotente: si vuelves a hacer click, no se duplica.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Factura: {invoice.filename}
            </p>
          </div>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-400">
            {error}
          </p>
        )}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            data-testid="mark-paid-confirm-btn"
            className="inline-flex items-center gap-1 rounded-md bg-accent px-4 py-2 text-sm font-medium text-primary hover:bg-accent/90 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {busy && <Loader2 size={12} className="animate-spin" />}
            Sí, marcar pagada
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Void invoice dialog (admin only).
// ---------------------------------------------------------------------------

function VoidInvoiceDialog({
  invoice,
  onClose,
}: {
  invoice: InvoiceRow;
  onClose: () => void;
}) {
  const markVoid = useMutation(api.functions.invoices.mutations.markVoid);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setError("La razón es obligatoria.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await markVoid({ invoiceId: invoice._id, reason: reason.trim() });
      onClose();
    } catch (err) {
      setError((err as Error).message ?? "Error al anular.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Anular factura"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="text-red-400" size={22} />
          <div className="flex-1">
            <h2 className="text-lg font-semibold">Anular factura</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Si esta factura ya generó entregable, el entregable NO se borra.
              Solo queda anotado en el audit log.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Factura: {invoice.filename}
            </p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div className="space-y-1">
            <label htmlFor="void-reason" className="text-sm font-medium">
              Razón
            </label>
            <textarea
              id="void-reason"
              required
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej. Factura emitida con monto erróneo; reemplazada por nueva."
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy || !reason.trim()}
              data-testid="void-submit-btn"
              className="inline-flex items-center gap-1 rounded-md bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {busy && <Loader2 size={12} className="animate-spin" />}
              Anular
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

