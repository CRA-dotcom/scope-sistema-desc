"use client";

import { useQuery } from "convex/react";
import { useOrganization } from "@clerk/nextjs";
import { useState, useMemo, useEffect } from "react";
import {
  FileSearch,
  Filter,
  ChevronDown,
  ChevronRight,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { formatLocalDateTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";

// Schema-mirroring local types — keep in sync with documentEvents schema.
type EntityType =
  | "deliverable"
  | "invoice"
  | "quotation"
  | "contract"
  | "template"
  | "subservice"
  | "questionnaire";

type Severity = "info" | "warning" | "error";

type EventRow = {
  _id: string;
  orgId: string;
  clientId?: Id<"clients">;
  entityType: EntityType;
  entityId: string;
  eventType: string;
  severity: Severity;
  actorUserId?: string;
  actorType: "user" | "cron" | "system" | "client_link";
  message: string;
  metadata?: unknown;
  createdAt: number;
};

type EventListResult = {
  rows: EventRow[];
  cursor: string | null;
  isDone: boolean;
};

type OrgRow = {
  _id: Id<"organizations">;
  clerkOrgId: string;
  name: string;
};

type ClientRow = {
  _id: Id<"clients">;
  name: string;
};

const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  deliverable: "Entregable",
  invoice: "Factura",
  quotation: "Cotización",
  contract: "Contrato",
  template: "Plantilla",
  subservice: "Subservicio",
  questionnaire: "Cuestionario",
};

const ENTITY_TYPES: EntityType[] = [
  "deliverable",
  "invoice",
  "quotation",
  "contract",
  "template",
  "subservice",
  "questionnaire",
];

const SEVERITY_OPTIONS: Severity[] = ["info", "warning", "error"];

const PAGE_SIZE = 50;

export default function AuditPage() {
  // Org dropdown is the gate (Q7): no org selected = empty result.
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [selectedEntityType, setSelectedEntityType] = useState<EntityType | "">("");
  const [selectedSeverity, setSelectedSeverity] = useState<Severity | "">("");
  const [sinceDate, setSinceDate] = useState<string>(""); // YYYY-MM-DD
  const [cursor, setCursor] = useState<string | null>(null);
  const [accumulated, setAccumulated] = useState<EventRow[]>([]);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  // Pagination guard: between the "Cargar más" click and the next Convex tick,
  // `result.rows` still points at the previous page (the cursor we already
  // appended). If we re-render eagerly we'd flash the same rows twice. When
  // `pendingMore` is true we suppress the result.rows append until the new
  // page lands and a useEffect clears the flag.
  const [pendingMore, setPendingMore] = useState(false);

  const orgs = useQuery(api.functions.organizations.queries.list) as
    | OrgRow[]
    | undefined;

  // Super-admin's *current* Clerk org. The Cliente dropdown is scoped to the
  // caller's own org (multi-tenant guard on clients.queries.list), so when the
  // audit target differs we surface a tiny note explaining the empty list.
  const { organization } = useOrganization();
  const callerOrgId = organization?.id ?? null;
  const isViewingOtherOrg =
    selectedOrgId !== "" && callerOrgId !== null && selectedOrgId !== callerOrgId;

  // Client filter is best-effort: it lists clients of the caller's own org
  // (multi-tenant guard on the query). When auditing a different org, the
  // dropdown will be empty — the operator can still filter by entity/severity.
  const clients = useQuery(api.functions.clients.queries.list, {}) as
    | ClientRow[]
    | undefined;

  // Stringify date filter to ms once for query.
  const sinceMs = useMemo(() => {
    if (!sinceDate) return undefined;
    const t = Date.parse(`${sinceDate}T00:00:00`);
    return Number.isFinite(t) ? t : undefined;
  }, [sinceDate]);

  // Empty until super-admin selects an org (Q7).
  const queryArgs = selectedOrgId
    ? {
        orgId: selectedOrgId,
        clientId: selectedClientId
          ? (selectedClientId as Id<"clients">)
          : undefined,
        entityType: selectedEntityType ? selectedEntityType : undefined,
        severity: selectedSeverity ? selectedSeverity : undefined,
        sinceMs,
        cursor: cursor ?? undefined,
        pageSize: PAGE_SIZE,
      }
    : "skip";

  const result = useQuery(
    api.functions.documentEvents.queries.list,
    queryArgs as
      | {
          orgId: string;
          clientId?: Id<"clients">;
          entityType?: EntityType;
          severity?: Severity;
          sinceMs?: number;
          cursor?: string;
          pageSize?: number;
        }
      | "skip"
  ) as EventListResult | undefined;

  // Reset cursor + accumulated when filters change.
  function resetWith<T extends () => void>(action: T) {
    action();
    setCursor(null);
    setAccumulated([]);
    setExpandedRow(null);
    setPendingMore(false);
  }

  // Append the current page to the accumulated list when the cursor advances.
  // We flip `pendingMore` so the in-flight render skips the stale result.rows
  // until Convex hydrates the new cursor.
  function loadMore() {
    if (!result || result.isDone) return;
    setAccumulated((prev) => [...prev, ...result.rows]);
    setCursor(result.cursor);
    setPendingMore(true);
  }

  // When a new page lands (result is no longer undefined and `result.rows`
  // belongs to the new cursor), drop the pending flag.
  useEffect(() => {
    if (pendingMore && result !== undefined) {
      setPendingMore(false);
    }
    // We only care about the moment result becomes defined for the new cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  // Rows shown in the table = accumulated + current page (avoiding double-render
  // when cursor === null initial page).
  const rowsToShow: EventRow[] = useMemo(() => {
    if (!selectedOrgId) return [];
    if (!result) return accumulated;
    if (cursor === null) {
      // First page — just show result.rows directly.
      return result.rows;
    }
    if (pendingMore) {
      // Suppress the stale current page until the new cursor's result lands.
      return accumulated;
    }
    return [...accumulated, ...result.rows];
  }, [accumulated, cursor, result, selectedOrgId, pendingMore]);

  const loading = selectedOrgId && result === undefined;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <FileSearch className="text-accent" size={28} />
        <div>
          <h1 className="text-2xl font-bold">Audit log</h1>
          <p className="text-sm text-muted-foreground">
            Eventos cross-org de Projex. Solo super-admin.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4">
        <Filter size={16} className="text-muted-foreground" />
        <span className="text-sm font-medium text-muted-foreground">
          Filtros:
        </span>

        {/* Org (required) */}
        <div className="relative">
          <select
            value={selectedOrgId}
            onChange={(e) =>
              resetWith(() => setSelectedOrgId(e.target.value))
            }
            aria-label="Organización"
            data-testid="filter-org"
            className="appearance-none rounded-md border border-border bg-secondary px-3 py-1.5 pr-8 text-sm text-foreground min-w-[180px]"
          >
            <option value="">Selecciona una organización…</option>
            {orgs?.map((o) => (
              <option key={o._id} value={o.clerkOrgId}>
                {o.name}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
        </div>

        {/* Cliente */}
        <div className="relative flex flex-col">
          <div className="relative">
            <select
              value={selectedClientId}
              onChange={(e) =>
                resetWith(() => setSelectedClientId(e.target.value))
              }
              disabled={!selectedOrgId}
              aria-label="Cliente"
              data-testid="filter-client"
              className="appearance-none rounded-md border border-border bg-secondary px-3 py-1.5 pr-8 text-sm text-foreground disabled:opacity-50 min-w-[160px]"
            >
              <option value="">Todos los clientes</option>
              {clients?.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
            <ChevronDown
              size={14}
              className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
          </div>
          {isViewingOtherOrg && (
            <p
              data-testid="filter-client-other-org-note"
              className="mt-1 text-[10px] text-muted-foreground"
            >
              Solo lista clientes de tu organización actual.
            </p>
          )}
        </div>

        {/* Entidad */}
        <div className="relative">
          <select
            value={selectedEntityType}
            onChange={(e) =>
              resetWith(() =>
                setSelectedEntityType(e.target.value as EntityType | "")
              )
            }
            disabled={!selectedOrgId}
            aria-label="Entidad"
            data-testid="filter-entity"
            className="appearance-none rounded-md border border-border bg-secondary px-3 py-1.5 pr-8 text-sm text-foreground disabled:opacity-50"
          >
            <option value="">Todas las entidades</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {ENTITY_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
        </div>

        {/* Severidad — chips */}
        <div
          className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary p-0.5"
          data-testid="filter-severity"
          role="group"
          aria-label="Severidad"
        >
          {SEVERITY_OPTIONS.map((sev) => {
            const active = selectedSeverity === sev;
            return (
              <button
                key={sev}
                type="button"
                onClick={() =>
                  resetWith(() =>
                    setSelectedSeverity(active ? "" : sev)
                  )
                }
                disabled={!selectedOrgId}
                aria-pressed={active}
                className={cn(
                  "rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer",
                  active
                    ? severityActiveClass(sev)
                    : "text-muted-foreground hover:bg-background"
                )}
              >
                {sev}
              </button>
            );
          })}
        </div>

        {/* Desde */}
        <div className="flex items-center gap-2">
          <label
            htmlFor="filter-since"
            className="text-xs text-muted-foreground"
          >
            Desde:
          </label>
          <input
            id="filter-since"
            type="date"
            value={sinceDate}
            onChange={(e) => resetWith(() => setSinceDate(e.target.value))}
            disabled={!selectedOrgId}
            data-testid="filter-since"
            className="rounded-md border border-border bg-secondary px-2 py-1 text-sm text-foreground disabled:opacity-50"
          />
        </div>
      </div>

      {/* Table / Empty state */}
      {!selectedOrgId ? (
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <FileSearch
            className="mx-auto mb-3 text-muted-foreground"
            size={40}
          />
          <p className="text-muted-foreground">
            Selecciona una organización para ver eventos.
          </p>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center rounded-lg border border-border bg-card py-12">
          <Loader2 size={20} className="animate-spin text-muted-foreground" />
        </div>
      ) : rowsToShow.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <p className="text-muted-foreground">
            Sin eventos para los filtros seleccionados.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="px-4 py-2.5 text-left font-medium w-[180px]">
                  Fecha
                </th>
                <th className="px-4 py-2.5 text-left font-medium w-[100px]">
                  Severidad
                </th>
                <th className="px-4 py-2.5 text-left font-medium w-[120px]">
                  Entidad
                </th>
                <th className="px-4 py-2.5 text-left font-medium w-[120px]">
                  Evento
                </th>
                <th className="px-4 py-2.5 text-left font-medium">Mensaje</th>
              </tr>
            </thead>
            <tbody>
              {rowsToShow.map((ev) => {
                const expanded = expandedRow === ev._id;
                return (
                  <FragmentRow
                    key={ev._id}
                    event={ev}
                    expanded={expanded}
                    onToggle={() =>
                      setExpandedRow(expanded ? null : ev._id)
                    }
                  />
                );
              })}
            </tbody>
          </table>

          {/* Pagination */}
          <div className="flex items-center justify-between border-t border-border bg-secondary/20 px-4 py-3">
            <span className="text-xs text-muted-foreground">
              {rowsToShow.length} evento{rowsToShow.length === 1 ? "" : "s"}
            </span>
            {result && !result.isDone && (
              <button
                type="button"
                onClick={loadMore}
                data-testid="load-more-btn"
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-secondary transition-colors cursor-pointer"
              >
                Cargar más <ChevronDown size={12} />
              </button>
            )}
            {result && result.isDone && (
              <span className="text-xs text-muted-foreground">
                Fin de la lista.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FragmentRow({
  event,
  expanded,
  onToggle,
}: {
  event: EventRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const detailsId = `audit-details-${event._id}`;
  return (
    <>
      <tr
        className="border-b border-border/50 hover:bg-secondary/30 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/40"
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        tabIndex={0}
        role="button"
        aria-expanded={expanded}
        aria-controls={detailsId}
        data-testid={`audit-row-${event._id}`}
      >
        <td className="px-4 py-2.5 text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            {expanded ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )}
            {formatLocalDateTime(event.createdAt)}
          </span>
        </td>
        <td className="px-4 py-2.5">
          <SeverityBadge severity={event.severity} />
        </td>
        <td className="px-4 py-2.5 text-xs">
          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
            {ENTITY_TYPE_LABELS[event.entityType] ?? event.entityType}
          </span>
        </td>
        <td className="px-4 py-2.5 text-xs text-muted-foreground">
          {event.eventType}
        </td>
        <td className="px-4 py-2.5">{event.message}</td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/50 bg-secondary/10" id={detailsId}>
          <td colSpan={5} className="px-4 py-3">
            <div className="space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Detail label="Actor" value={event.actorType} />
                <Detail
                  label="User ID"
                  value={event.actorUserId ?? "—"}
                />
                <Detail label="Entity ID" value={event.entityId} />
                <Detail
                  label="Cliente"
                  value={(event.clientId as unknown as string) ?? "—"}
                />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Metadata
                </p>
                <pre
                  data-testid={`audit-metadata-${event._id}`}
                  className="mt-1 max-h-64 overflow-auto rounded-md border border-border bg-background p-2 text-[11px] text-foreground"
                >
                  {event.metadata !== undefined && event.metadata !== null
                    ? JSON.stringify(event.metadata, null, 2)
                    : "(sin metadata)"}
                </pre>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="font-mono text-[11px] text-foreground break-all">
        {value}
      </p>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: Severity }) {
  const className =
    severity === "info"
      ? "bg-muted text-muted-foreground"
      : severity === "warning"
        ? "bg-amber-500/10 text-amber-400"
        : "bg-red-500/10 text-red-400";
  return (
    <span
      data-testid={`severity-${severity}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        className
      )}
    >
      {severity === "error" && <AlertTriangle size={10} />}
      {severity}
    </span>
  );
}

function severityActiveClass(sev: Severity): string {
  if (sev === "info") return "bg-muted text-foreground";
  if (sev === "warning") return "bg-amber-500/20 text-amber-300";
  return "bg-red-500/20 text-red-300";
}
