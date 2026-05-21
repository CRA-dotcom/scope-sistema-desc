"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  Edit,
  Archive,
  RotateCcw,
  TrendingUp,
  GitBranchPlus,
  Layers,
  Plus,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils";
import { useState } from "react";
import { AddSubserviceModal } from "@/components/clients/AddSubserviceModal";

const MONTH_SHORT = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
];

const FREQ_LABELS: Record<string, string> = {
  semanal: "Semanal",
  quincenal: "Quincenal",
  mensual: "Mensual",
};

export default function ClientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const clientId = params.id as Id<"clients">;

  const client = useQuery(api.functions.clients.queries.getById, {
    id: clientId,
  });
  const projections = useQuery(api.functions.projections.queries.getByClient, {
    clientId,
  });
  const overview = useQuery(
    api.functions.clients.queries.getServicesOverview,
    { clientId }
  );
  const archiveClient = useMutation(api.functions.clients.mutations.archive);
  const restoreClient = useMutation(api.functions.clients.mutations.restore);
  const [archiving, setArchiving] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);

  if (client === undefined) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-secondary" />
        <div className="h-64 animate-pulse rounded-lg border border-border bg-card" />
      </div>
    );
  }

  if (client === null) {
    return (
      <div className="space-y-4">
        <Link href="/clientes" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground cursor-pointer">
          <ArrowLeft size={14} /> Volver a Clientes
        </Link>
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <p className="text-lg font-medium">Cliente no encontrado</p>
          <p className="mt-1 text-sm text-muted-foreground">Este cliente no existe o fue eliminado.</p>
        </div>
      </div>
    );
  }

  async function handleArchive() {
    setArchiving(true);
    try {
      if (client!.isArchived) {
        await restoreClient({ id: clientId });
      } else {
        await archiveClient({ id: clientId });
      }
    } finally {
      setArchiving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Link
        href="/clientes"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <ArrowLeft size={14} />
        Volver a Clientes
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/10">
            <Building2 className="text-accent" size={28} />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{client.name}</h1>
            <p className="text-sm text-muted-foreground">
              RFC: {client.rfc} &middot; {client.industry}
            </p>
          </div>
          {client.isArchived && (
            <span className="rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning">
              Archivado
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Link
            href={`/clientes/${clientId}/ciclo`}
            className="flex items-center gap-2 rounded-md bg-accent/10 border border-accent/30 px-3 py-2 text-sm text-accent hover:bg-accent/20 transition-colors cursor-pointer"
          >
            <GitBranchPlus size={14} />
            Ver Ciclo Documental
          </Link>
          <Link
            href={`/clientes/${clientId}/editar`}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-secondary transition-colors cursor-pointer"
          >
            <Edit size={14} />
            Editar
          </Link>
          <button
            onClick={handleArchive}
            disabled={archiving}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-secondary transition-colors disabled:opacity-50 cursor-pointer"
          >
            {client.isArchived ? (
              <>
                <RotateCcw size={14} />
                Restaurar
              </>
            ) : (
              <>
                <Archive size={14} />
                Archivar
              </>
            )}
          </button>
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">Facturación Anual</p>
          <p className="mt-1 text-2xl font-bold text-accent">
            {formatCurrency(client.annualRevenue)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">Frecuencia de Facturación</p>
          <p className="mt-1 text-2xl font-bold">
            {FREQ_LABELS[client.billingFrequency]}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">Industria</p>
          <p className="mt-1 text-2xl font-bold">{client.industry}</p>
        </div>
      </div>

      {/* Projections Section */}
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Proyecciones</h2>
          <Link
            href={`/proyecciones/nueva?clientId=${clientId}`}
            className="flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-primary hover:bg-accent/90 transition-colors cursor-pointer"
          >
            <TrendingUp size={14} />
            Nueva Proyección
          </Link>
        </div>
        {!projections || projections.length === 0 ? (
          <div className="mt-4 text-center py-8">
            <TrendingUp className="mx-auto mb-3 text-muted-foreground" size={36} />
            <p className="text-sm text-muted-foreground">
              No hay proyecciones para este cliente.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {projections.map((proj) => (
              <Link
                key={proj._id}
                href={`/proyecciones/${proj._id}`}
                className="flex items-center justify-between rounded-md border border-border p-3 hover:border-accent/30 transition-colors cursor-pointer"
              >
                <div>
                  <p className="font-medium">Año {proj.year}</p>
                  <p className="text-xs text-muted-foreground">
                    Comisión {(proj.commissionRate * 100).toFixed(1)}% &middot; {proj.status === "draft" ? "Borrador" : proj.status === "active" ? "Activa" : "Archivada"}
                  </p>
                </div>
                <p className="font-medium text-accent">{formatCurrency(proj.totalBudget)}</p>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* B1 — Servicios contratados (subservicios activos + add-ons) */}
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Servicios contratados</h2>
          {overview?.activeProjection && (
            <button
              onClick={() => setAddModalOpen(true)}
              className="flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-primary hover:bg-accent/90 transition-colors cursor-pointer"
            >
              <Plus size={14} />
              Agregar subservicio
            </button>
          )}
        </div>

        {overview === undefined && (
          <div className="mt-4 h-24 animate-pulse rounded bg-secondary" />
        )}

        {overview && !overview.activeProjection && (
          <div className="mt-4 text-center py-8">
            <Layers className="mx-auto mb-3 text-muted-foreground" size={36} />
            <p className="text-sm text-muted-foreground">
              Crea una proyección para empezar a contratar subservicios.
            </p>
          </div>
        )}

        {overview && overview.activeProjection && overview.groups.length === 0 && (
          <div className="mt-4 text-center py-8">
            <p className="text-sm text-muted-foreground">
              La proyección {overview.activeProjection.year} no tiene servicios activos.
            </p>
          </div>
        )}

        {overview && overview.activeProjection && overview.groups.length > 0 && (
          <div className="mt-4 space-y-5">
            <p className="text-xs text-muted-foreground">
              Año {overview.activeProjection.year} ·{" "}
              {overview.activeProjection.status === "active"
                ? "Activa"
                : overview.activeProjection.status === "draft"
                  ? "Borrador"
                  : "Archivada"}
            </p>
            {overview.groups.map((group) => (
              <div key={group.parentService._id} className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">
                  {group.parentService.name}
                </h3>
                <div className="space-y-1.5">
                  {group.rows.map((row) => (
                    <div
                      key={row.projectionServiceId}
                      className="flex items-center justify-between rounded-md border border-border p-3 hover:border-accent/30 transition-colors"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">
                            {row.subservice?.name ?? row.serviceName}
                          </p>
                          {row.isAddOn && (
                            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent">
                              add-on
                            </span>
                          )}
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs ${
                              row.status === "active"
                                ? "bg-emerald-500/10 text-emerald-400"
                                : row.status === "upcoming"
                                  ? "bg-amber-500/10 text-amber-400"
                                  : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {row.status === "active"
                              ? "Activo"
                              : row.status === "upcoming"
                                ? "Por iniciar"
                                : "Finalizado"}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>
                            {row.subservice?.defaultFrequency ?? "mensual"}
                          </span>
                          <span>·</span>
                          <span>
                            {MONTH_SHORT[row.startMonth - 1]}-
                            {MONTH_SHORT[row.endMonth - 1]}
                          </span>
                          <span>·</span>
                          <span>{formatCurrency(row.monthlyAmount)}/mes</span>
                          {row.nextDueMonth && (
                            <>
                              <span>·</span>
                              <span>
                                Próximo: {MONTH_SHORT[row.nextDueMonth - 1]}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      {row.supplementaryQuotationId && (
                        <Link
                          href={`/cotizaciones/${row.supplementaryQuotationId}`}
                          className="flex items-center gap-1 text-xs text-accent hover:underline whitespace-nowrap"
                        >
                          <ExternalLink size={12} />
                          Ver cotización
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {overview?.activeProjection && (
        <AddSubserviceModal
          open={addModalOpen}
          onClose={() => setAddModalOpen(false)}
          clientId={clientId}
          projectionId={overview.activeProjection._id}
          projectionYear={overview.activeProjection.year}
        />
      )}
    </div>
  );
}
