"use client";

import type { Doc } from "../../../../../convex/_generated/dataModel";
import { ContractRowActions } from "./ContractRowActions";

type ContractRow = Doc<"contracts"> & { clientName: string };

const DAY_MS = 24 * 3600 * 1000;

const STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  sent: "Enviado",
  signed: "Firmado",
  cancelled: "Cancelado",
};

const STATUS_CHIP: Record<string, string> = {
  draft:
    "inline-block rounded px-2 py-0.5 text-xs bg-muted-foreground/20 text-muted-foreground border border-muted-foreground/20",
  sent: "inline-block rounded px-2 py-0.5 text-xs bg-amber-500/10 text-amber-400 border border-amber-500/30",
  signed:
    "inline-block rounded px-2 py-0.5 text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/30",
  cancelled:
    "inline-block rounded px-2 py-0.5 text-xs bg-rose-500/10 text-rose-400 border border-rose-500/30",
};

export function ContractsTable({ contracts }: { contracts: ContractRow[] }) {
  const now = Date.now();

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground border-b border-border bg-secondary/40">
          <tr>
            <th className="px-4 py-3 font-medium">Cliente</th>
            <th className="px-4 py-3 font-medium">Servicio</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Enviado</th>
            <th className="px-4 py-3 font-medium">Días sin firmar</th>
            <th className="px-4 py-3 font-medium">Últ. reminder</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {contracts.map((c) => {
            const daysUnsigned =
              c.status === "sent" && c.sentAt
                ? Math.floor((now - c.sentAt) / DAY_MS)
                : null;
            const isStuck = daysUnsigned !== null && daysUnsigned > 7;

            return (
              <tr
                key={c._id}
                className="border-b border-border last:border-b-0 hover:bg-secondary/20 transition-colors"
              >
                <td className="px-4 py-3 font-medium">{c.clientName}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {c.serviceName}
                </td>
                <td className="px-4 py-3">
                  <span className={STATUS_CHIP[c.status] ?? STATUS_CHIP.draft}>
                    {STATUS_LABELS[c.status] ?? c.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {c.sentAt
                    ? new Date(c.sentAt).toLocaleDateString("es-MX")
                    : "—"}
                </td>
                <td
                  className={`px-4 py-3 font-medium ${
                    isStuck ? "text-rose-400" : "text-muted-foreground"
                  }`}
                >
                  {daysUnsigned !== null ? daysUnsigned : "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {c.lastReminderAt
                    ? `${new Date(c.lastReminderAt).toLocaleDateString("es-MX")}${c.reminderCount ? ` (${c.reminderCount})` : ""}`
                    : "—"}
                </td>
                <td className="px-4 py-3">
                  <ContractRowActions contract={c} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
