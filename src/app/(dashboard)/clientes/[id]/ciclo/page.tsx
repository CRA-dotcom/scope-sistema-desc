"use client";

import { useState } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import { Id } from "../../../../../../convex/_generated/dataModel";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  TrendingUp,
  FileText,
  FileSignature,
  Package,
  ChevronRight,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils";

const MONTH_NAMES = [
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

type StepStatus = "done" | "in_progress" | "pending" | "blocked";

function resolveStepStatus(
  stepType: "projection" | "quotation" | "contract",
  data: { status: string } | null
): StepStatus {
  if (!data) return "pending";
  const s = data.status;
  if (stepType === "projection") {
    if (s === "active") return "done";
    if (s === "draft") return "in_progress";
    return "pending";
  }
  if (stepType === "quotation") {
    if (s === "approved") return "done";
    if (s === "rejected") return "blocked";
    if (s === "sent" || s === "draft") return "in_progress";
    return "pending";
  }
  if (stepType === "contract") {
    if (s === "signed") return "done";
    if (s === "cancelled") return "blocked";
    if (s === "sent" || s === "draft") return "in_progress";
    return "pending";
  }
  return "pending";
}

function resolveDeliverableStatus(status: string): StepStatus {
  if (status === "approved") return "done";
  if (status === "rejected") return "blocked";
  if (status === "corrected" || status === "pending") return "in_progress";
  return "pending";
}

const STATUS_COLORS: Record<StepStatus, string> = {
  done: "border-emerald-500 bg-emerald-500/10 text-emerald-400",
  in_progress: "border-blue-500 bg-blue-500/10 text-blue-400",
  pending: "border-zinc-600 bg-zinc-800/50 text-zinc-400",
  blocked: "border-red-500 bg-red-500/10 text-red-400",
};

const STATUS_DOT: Record<StepStatus, string> = {
  done: "bg-emerald-500",
  in_progress: "bg-blue-500",
  pending: "bg-zinc-500",
  blocked: "bg-red-500",
};

const STATUS_ARROW: Record<StepStatus, string> = {
  done: "text-emerald-500",
  in_progress: "text-blue-500",
  pending: "text-zinc-600",
  blocked: "text-red-500",
};

const STATUS_LABELS: Record<string, string> = {
  // projection
  draft: "Borrador",
  active: "Activa",
  archived: "Archivada",
  // quotation
  sent: "Enviada",
  approved: "Aprobada",
  rejected: "Rechazada",
  // contract
  signed: "Firmado",
  cancelled: "Cancelado",
  // deliverables
  pending: "Pendiente",
  corrected: "Corregido",
};

function StepCard({
  icon: Icon,
  label,
  status,
  subtitle,
  href,
}: {
  icon: React.ElementType;
  label: string;
  status: StepStatus;
  subtitle: string;
  href?: string;
}) {
  const card = (
    <div
      className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 min-w-[140px] transition-all ${STATUS_COLORS[status]} ${href ? "hover:scale-105 cursor-pointer" : ""}`}
    >
      <Icon size={24} />
      <span className="text-sm font-semibold">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
        <span className="text-xs">{subtitle}</span>
      </div>
    </div>
  );

  if (href) {
    return <Link href={href}>{card}</Link>;
  }
  return card;
}

function Arrow({ status }: { status: StepStatus }) {
  return (
    <div className={`flex items-center ${STATUS_ARROW[status]}`}>
      <ChevronRight size={24} />
    </div>
  );
}

export default function DocumentCyclePage() {
  const params = useParams();
  const router = useRouter();
  const clientId = params.id as Id<"clients">;

  const cycle = useQuery(
    api.functions.dashboard.documentCycle.getDocumentCycle,
    { clientId }
  );
  const generateQuotation = useAction(
    api.functions.quotations.actions.generateQuotation
  );
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);

  const handleGenerateQuotation = async (
    projServiceId: Id<"projectionServices">
  ) => {
    try {
      setGeneratingFor(projServiceId);
      const quotationId = await generateQuotation({ projServiceId });
      router.push(`/cotizaciones/${quotationId}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error al generar cotización");
      setGeneratingFor(null);
    }
  };

  if (cycle === undefined) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 animate-pulse rounded bg-secondary" />
        <div className="h-48 animate-pulse rounded-lg border border-border bg-card" />
      </div>
    );
  }

  if (cycle === null) {
    return (
      <div className="space-y-4">
        <Link
          href={`/clientes/${clientId}`}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <ArrowLeft size={14} /> Volver al Cliente
        </Link>
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <p className="text-lg font-medium">Cliente no encontrado</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Link
        href={`/clientes/${clientId}`}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <ArrowLeft size={14} />
        Volver a {cycle.clientName}
      </Link>

      {/* Title */}
      <div>
        <h1 className="text-2xl font-bold">Ciclo Documental</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Pipeline de documentos por servicio para {cycle.clientName}
        </p>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs">
        {(
          [
            ["done", "Completado"],
            ["in_progress", "En progreso"],
            ["pending", "Pendiente"],
            ["blocked", "Bloqueado"],
          ] as const
        ).map(([status, label]) => (
          <div key={status} className="flex items-center gap-1.5">
            <span
              className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[status]}`}
            />
            <span className="text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>

      {/* Services */}
      {cycle.services.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <TrendingUp
            className="mx-auto mb-3 text-muted-foreground"
            size={36}
          />
          <p className="text-sm text-muted-foreground">
            No hay proyecciones activas para este cliente.
          </p>
          <Link
            href={`/proyecciones/nueva?clientId=${clientId}`}
            className="mt-3 inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-primary hover:bg-accent/90 transition-colors"
          >
            Crear Proyeccion
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {cycle.services.map((svc) => {
            const projStatus = resolveStepStatus("projection", svc.projection);
            const quotStatus = resolveStepStatus("quotation", svc.quotation);
            const contStatus = resolveStepStatus("contract", svc.contract);
            const hasDeliverables = svc.deliverables.length > 0;
            const allDelivered =
              hasDeliverables &&
              svc.deliverables.every((d) => d.status === "approved");
            const delStatus: StepStatus = allDelivered
              ? "done"
              : hasDeliverables
                ? "in_progress"
                : "pending";

            return (
              <div
                key={svc.projServiceId}
                className="rounded-lg border border-border bg-card p-6"
              >
                {/* Service header */}
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-lg font-semibold">{svc.serviceName}</h2>
                  <span className="text-sm text-muted-foreground">
                    {formatCurrency(svc.projection.amount)} / ano{" "}
                    {svc.projection.year}
                  </span>
                </div>

                {/* Pipeline */}
                <div className="flex items-center gap-2 overflow-x-auto pb-2">
                  <StepCard
                    icon={TrendingUp}
                    label="Proyeccion"
                    status={projStatus}
                    subtitle={
                      STATUS_LABELS[svc.projection.status] ??
                      svc.projection.status
                    }
                    href={`/proyecciones/${svc.projection.id}`}
                  />
                  <Arrow
                    status={
                      projStatus === "done" ? quotStatus : "pending"
                    }
                  />
                  <StepCard
                    icon={FileText}
                    label="Cotizacion"
                    status={quotStatus}
                    subtitle={
                      svc.quotation
                        ? STATUS_LABELS[svc.quotation.status] ??
                          svc.quotation.status
                        : "Sin crear"
                    }
                    href={
                      svc.quotation
                        ? `/cotizaciones/${svc.quotation.id}`
                        : undefined
                    }
                  />
                  <Arrow
                    status={
                      quotStatus === "done" ? contStatus : "pending"
                    }
                  />
                  <StepCard
                    icon={FileSignature}
                    label="Contrato"
                    status={contStatus}
                    subtitle={
                      svc.contract
                        ? STATUS_LABELS[svc.contract.status] ??
                          svc.contract.status
                        : "Sin crear"
                    }
                    href={
                      svc.contract
                        ? `/contratos/${svc.contract.id}`
                        : undefined
                    }
                  />
                  <Arrow
                    status={
                      contStatus === "done" ? delStatus : "pending"
                    }
                  />
                  <StepCard
                    icon={Package}
                    label="Entregables"
                    status={delStatus}
                    subtitle={
                      hasDeliverables
                        ? `${svc.deliverables.filter((d) => d.status === "approved").length}/${svc.deliverables.length}`
                        : "Sin crear"
                    }
                  />
                </div>

                {/* Actions */}
                {!svc.quotation && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        handleGenerateQuotation(
                          svc.projServiceId as Id<"projectionServices">
                        )
                      }
                      disabled={generatingFor === svc.projServiceId}
                      className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                    >
                      <Plus size={14} />
                      {generatingFor === svc.projServiceId
                        ? "Generando con AI (20-60s)..."
                        : `Generar Cotización para ${svc.serviceName}`}
                    </button>
                  </div>
                )}

                {/* Month-by-month deliverables */}
                {hasDeliverables && (
                  <div className="mt-5 border-t border-border pt-4">
                    <p className="text-sm font-medium text-muted-foreground mb-3">
                      Entregables por mes
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {svc.deliverables.map((del) => {
                        const dStatus = resolveDeliverableStatus(del.status);
                        return (
                          <Link
                            key={del.id}
                            href={`/entregables/${del.id}`}
                            className={`flex flex-col items-center rounded-md border px-3 py-2 text-xs transition-all hover:scale-105 ${STATUS_COLORS[dStatus]}`}
                          >
                            <span className="font-semibold">
                              {MONTH_NAMES[del.month - 1]} {del.year}
                            </span>
                            <span className="flex items-center gap-1 mt-0.5">
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[dStatus]}`}
                              />
                              {STATUS_LABELS[del.status] ?? del.status}
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
