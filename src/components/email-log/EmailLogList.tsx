"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Doc } from "../../../convex/_generated/dataModel";
import { useOrganization } from "@clerk/nextjs";
import { Search, Mail } from "lucide-react";
import { useState } from "react";
import { EmailStatusBadge } from "./EmailStatusBadge";
import { EmailTypeBadge } from "./EmailTypeBadge";
import { EmailLogDetail } from "./EmailLogDetail";

const STATUSES = [
  { value: "", label: "Todos los estados" },
  { value: "queued", label: "En cola" },
  { value: "sent", label: "Enviado" },
  { value: "delivered", label: "Entregado" },
  { value: "opened", label: "Abierto" },
  { value: "clicked", label: "Clickeado" },
  { value: "bounced", label: "Rebotado" },
  { value: "complained", label: "Reportado spam" },
  { value: "failed", label: "Falló" },
];
const TYPES = [
  { value: "", label: "Todos los tipos" },
  { value: "quotation", label: "Cotización" },
  { value: "quotation_reminder", label: "Recordatorio cotización" },
  { value: "contract", label: "Contrato" },
  { value: "contract_reminder", label: "Recordatorio contrato" },
  { value: "deliverable", label: "Entregable" },
  { value: "questionnaire", label: "Cuestionario" },
  { value: "reminder", label: "Recordatorio" },
  { value: "custom", label: "Otro" },
];

export function EmailLogList() {
  const { membership } = useOrganization();
  const isAdmin = membership?.role === "org:admin";
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(50);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const rows = useQuery(api.functions.email.queries.list, {
    status: status || undefined,
    type: type || undefined,
    search: search || undefined,
    limit,
  });

  if (rows === undefined) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-lg border border-border bg-card"
          />
        ))}
      </div>
    );
  }

  const hasAnyResults = rows.length > 0;
  const hasFilters = !!(status || type || search);

  if (!hasAnyResults && !hasFilters) {
    return (
      <div className="rounded-lg border border-border bg-card p-12 text-center">
        <Mail className="mx-auto mb-4 text-muted-foreground" size={48} />
        <p className="text-lg font-medium">No hay emails aún</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {isAdmin
            ? "Los emails enviados desde cotizaciones, contratos o entregables aparecerán aquí."
            : "Aún no hay emails vinculados a tus clientes."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            size={16}
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por asunto o destinatario..."
            className="w-full rounded-md border border-border bg-secondary py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-md border border-border bg-secondary py-2 px-3 text-sm text-foreground focus:border-accent focus:outline-none cursor-pointer"
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="rounded-md border border-border bg-secondary py-2 px-3 text-sm text-foreground focus:border-accent focus:outline-none cursor-pointer"
        >
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {!hasAnyResults && hasFilters && (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No se encontraron emails con estos filtros.
          </p>
          <button
            onClick={() => {
              setStatus("");
              setType("");
              setSearch("");
            }}
            className="mt-3 inline-flex items-center rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary transition-colors cursor-pointer"
          >
            Limpiar filtros
          </button>
        </div>
      )}

      {hasAnyResults && (
        <div className="space-y-2">
          {rows.map((log: Doc<"emailLog">) => {
            const isExpanded = expandedId === log._id;
            return (
              <div key={log._id} className="space-y-2">
                <button
                  onClick={() => setExpandedId(isExpanded ? null : log._id)}
                  className={`w-full rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-accent/30 cursor-pointer ${
                    isExpanded ? "border-accent/40" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <EmailStatusBadge status={log.status} />
                        <EmailTypeBadge type={log.type} />
                        <span className="text-xs text-muted-foreground">
                          {new Date(log.createdAt).toLocaleString("es-MX")}
                        </span>
                      </div>
                      <p className="mt-1 text-sm font-medium truncate">
                        {log.subject}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        Para: {log.toEmail}
                      </p>
                    </div>
                  </div>
                </button>
                {isExpanded && <EmailLogDetail log={log} />}
              </div>
            );
          })}
        </div>
      )}

      {hasAnyResults && rows.length === limit && (
        <div className="flex justify-center">
          <button
            onClick={() => setLimit(limit + 50)}
            className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-secondary transition-colors cursor-pointer"
          >
            Cargar más
          </button>
        </div>
      )}
    </div>
  );
}
