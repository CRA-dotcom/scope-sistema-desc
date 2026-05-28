"use client";

import { Id } from "../../../../../../../convex/_generated/dataModel";
import { FileSpreadsheet } from "lucide-react";

type Row = {
  _id: Id<"clientFinancialData">;
  period: string;
  periodType: "monthly" | "quarterly" | "annual";
  status: "uploaded" | "extracted" | "validated" | "rejected" | "error";
  lineItems: { label: string; amount: number; category: string }[];
  uploadedAt: number;
  filename: string;
  errorMessage?: string;
};

const PERIOD_LABEL: Record<Row["periodType"], string> = {
  monthly: "Mensual",
  quarterly: "Trimestral",
  annual: "Anual",
};

const STATUS_STYLES: Record<Row["status"], { label: string; classes: string }> =
  {
    uploaded: {
      label: "Procesando…",
      classes: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
    },
    extracted: {
      label: "Pendiente revisión",
      classes: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    },
    validated: {
      label: "Validado",
      classes: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    },
    rejected: {
      label: "Rechazado",
      classes: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
    },
    error: {
      label: "Error",
      classes: "bg-destructive/10 text-destructive",
    },
  };

function formatDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function PeriodsTable({
  rows,
  onSelect,
}: {
  rows: Row[];
  onSelect: (id: Id<"clientFinancialData">) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
        <FileSpreadsheet
          size={32}
          className="mx-auto mb-3 text-muted-foreground"
        />
        <p className="text-sm text-muted-foreground">
          Sin estados financieros aún. Sube el primer Excel arriba.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-secondary/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-3">Periodo</th>
            <th className="px-4 py-3">Tipo</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Line items</th>
            <th className="px-4 py-3">Subido</th>
            <th className="px-4 py-3">Archivo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => {
            const s = STATUS_STYLES[r.status];
            return (
              <tr
                key={r._id}
                onClick={() => onSelect(r._id)}
                className="cursor-pointer hover:bg-secondary/30"
              >
                <td className="px-4 py-3 font-medium">{r.period}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {PERIOD_LABEL[r.periodType]}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${s.classes}`}
                  >
                    {s.label}
                  </span>
                  {r.status === "error" && r.errorMessage && (
                    <span
                      className="ml-2 text-xs text-muted-foreground"
                      title={r.errorMessage}
                    >
                      (ver detalle)
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {r.lineItems.length}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {formatDate(r.uploadedAt)}
                </td>
                <td className="px-4 py-3 max-w-[200px] truncate text-muted-foreground">
                  {r.filename}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
