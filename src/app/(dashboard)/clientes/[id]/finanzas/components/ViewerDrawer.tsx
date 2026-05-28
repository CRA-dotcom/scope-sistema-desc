"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { X, CheckCircle2, XCircle, Trash2, Download } from "lucide-react";
import { api } from "../../../../../../../convex/_generated/api";
import { Id } from "../../../../../../../convex/_generated/dataModel";

type Category = "ingresos" | "gastos_operativos" | "impuestos" | "otros";

const CATEGORY_LABELS: Record<Category, string> = {
  ingresos: "Ingresos",
  gastos_operativos: "Gastos operativos",
  impuestos: "Impuestos",
  otros: "Otros",
};

function formatMxn(n: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
  }).format(n);
}

export function ViewerDrawer({
  id,
  clientId,
  onClose,
}: {
  id: Id<"clientFinancialData">;
  clientId: Id<"clients">;
  onClose: () => void;
}) {
  const markValidated = useMutation(
    api.functions.clientFinancialData.mutations.markValidated
  );
  const markRejected = useMutation(
    api.functions.clientFinancialData.mutations.markRejected
  );
  const deleteRecord = useAction(
    api.functions.clientFinancialData.actions.deleteRecord
  );
  const getDownloadUrl = useAction(
    api.functions.clientFinancialData.actions.getDownloadUrl
  );

  const rows = useQuery(
    api.functions.clientFinancialData.queries.listByClient,
    { clientId }
  );
  const row = rows?.find((r) => r._id === id) ?? null;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  if (!row) {
    return (
      <div className="fixed inset-0 z-50 bg-black/40">
        <div className="absolute right-0 top-0 h-full w-full max-w-xl border-l border-border bg-card p-6">
          <div className="h-6 w-32 animate-pulse rounded bg-secondary" />
        </div>
      </div>
    );
  }

  const totalsByCategory = row.lineItems.reduce<Record<string, number>>(
    (acc, li) => {
      acc[li.category] = (acc[li.category] ?? 0) + li.amount;
      return acc;
    },
    {}
  );

  async function handleValidate() {
    setBusy(true);
    setError(null);
    try {
      await markValidated({ id });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    if (!rejectReason.trim()) {
      setError("Captura la razón del rechazo.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await markRejected({ id, reason: rejectReason });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm("¿Borrar el estado financiero? Esta acción no se puede revertir.")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteRecord({ id });
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function handleDownload() {
    try {
      const url = await getDownloadUrl({ id });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Detalle estado financiero"
      className="fixed inset-0 z-50 bg-black/40"
      onClick={onClose}
    >
      <div
        className="absolute right-0 top-0 h-full w-full max-w-xl overflow-y-auto border-l border-border bg-card p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">
              {row.period} · {row.filename}
            </h2>
            <p className="text-xs text-muted-foreground">
              Subido {new Date(row.uploadedAt).toLocaleString("es-MX")} ·{" "}
              {(row.sizeBytes / 1024).toFixed(1)} KB
            </p>
            {row.aiExtraction && (
              <p className="mt-1 text-xs text-muted-foreground">
                Extraído por {row.aiExtraction.model} (prompt{" "}
                {row.aiExtraction.promptVersion}) · costo ~
                ${(row.aiExtraction.costUsd ?? 0).toFixed(4)} USD
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 hover:bg-secondary cursor-pointer"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </div>

        {row.status === "error" && row.errorMessage && (
          <div className="mb-4 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
            {row.errorMessage}
          </div>
        )}

        <section className="space-y-4">
          {(["ingresos", "gastos_operativos", "impuestos", "otros"] as Category[]).map(
            (cat) => {
              const items = row.lineItems.filter((li) => li.category === cat);
              if (items.length === 0) return null;
              return (
                <div key={cat} className="rounded-md border border-border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-medium">
                      {CATEGORY_LABELS[cat]}
                    </h3>
                    <span className="text-sm font-medium">
                      {formatMxn(totalsByCategory[cat] ?? 0)}
                    </span>
                  </div>
                  <ul className="space-y-1 text-sm">
                    {items.map((li, i) => (
                      <li
                        key={i}
                        className="flex justify-between text-muted-foreground"
                      >
                        <span className="truncate pr-2">{li.label}</span>
                        <span>{formatMxn(li.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            }
          )}
          {row.lineItems.length === 0 && row.status !== "uploaded" && (
            <p className="text-sm text-muted-foreground">
              Sin line items extraídos.
            </p>
          )}
        </section>

        {error && (
          <div className="mt-4 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {rejectMode && (
          <div className="mt-4 rounded-md border border-border p-3">
            <label className="mb-1 block text-sm font-medium">
              Razón del rechazo
            </label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <div className="mt-2 flex justify-end gap-2">
              <button
                onClick={() => {
                  setRejectMode(false);
                  setRejectReason("");
                }}
                disabled={busy}
                className="rounded-md px-3 py-1.5 text-sm hover:bg-secondary cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleReject}
                disabled={busy}
                className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
              >
                Confirmar rechazo
              </button>
            </div>
          </div>
        )}

        <footer className="mt-6 flex flex-wrap gap-2 border-t border-border pt-4">
          {row.status === "extracted" && !rejectMode && (
            <>
              <button
                onClick={handleValidate}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
              >
                <CheckCircle2 size={14} /> Validar
              </button>
              <button
                onClick={() => setRejectMode(true)}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary cursor-pointer"
              >
                <XCircle size={14} /> Rechazar
              </button>
            </>
          )}
          {row.status === "rejected" && (
            <button
              onClick={handleValidate}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
            >
              <CheckCircle2 size={14} /> Re-validar
            </button>
          )}
          <button
            onClick={handleDownload}
            className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary cursor-pointer"
          >
            <Download size={14} /> Descargar Excel
          </button>
          <button
            onClick={handleDelete}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 cursor-pointer ml-auto"
          >
            <Trash2 size={14} /> Borrar
          </button>
        </footer>
      </div>
    </div>
  );
}

