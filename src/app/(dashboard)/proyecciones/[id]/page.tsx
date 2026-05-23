"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id, Doc } from "../../../../../convex/_generated/dataModel";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { ArrowLeft, TrendingUp, ClipboardList, Plus, ArrowRight, ChevronLeft, Download, Loader2 } from "lucide-react";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { MatrixCellDetail } from "@/components/projections/matrix-cell-detail";
import { SubserviceCellPicker } from "@/components/projections/subservice-cell-picker";
import { resolveProjectionContext, resolveProjectionMonths } from "../../../../../convex/lib/projectionContext";
import { usePdfGenerator } from "@/lib/usePdfGenerator";
import { buildProjectionPdfHtml } from "@/lib/projectionPdfBuilder";

const MONTH_NAMES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-muted-foreground/20 text-muted-foreground",
  info_received: "bg-info/20 text-info",
  in_progress: "bg-warning/20 text-warning",
  delivered: "bg-accent/20 text-accent",
};

export default function ProjectionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectionId = params.id as Id<"projections">;

  const { isLoaded, orgId } = useAuth();
  const authReady = isLoaded && !!orgId;

  const matrix = useQuery(
    api.functions.projections.queries.getMatrix,
    authReady ? { projectionId } : "skip"
  );
  const questionnaire = useQuery(
    api.functions.questionnaires.queries.getByProjection,
    authReady ? { projectionId } : "skip"
  );
  const generateQuestionnaire = useMutation(
    api.functions.questionnaires.mutations.generate
  );
  const [isGeneratingQ, setIsGeneratingQ] = useState(false);
  // Track only the id, then look up the live doc from matrix.assignments on each
  // render. Caching the full Doc here made the status pills appear "stuck" after
  // an updateStatus mutation: Convex persisted the change but this stale snapshot
  // kept rendering the old status until the panel was closed and reopened.
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<Id<"monthlyAssignments"> | null>(null);
  const selectedAssignment: Doc<"monthlyAssignments"> | null = selectedAssignmentId
    ? (matrix?.assignments.find((a) => a._id === selectedAssignmentId) ?? null)
    : null;

  const subservices = useQuery(
    api.functions.subservices.queries.listAllForOrg,
    {}
  );
  const subservicesById = useMemo(
    () => {
      const list = subservices ?? [];
      return new Map(list.map((s) => [s._id, s]));
    },
    [subservices]
  );


  const setMonthSubservice = useMutation(
    api.functions.monthlyAssignments.mutations.setSubservice
  );

  const orgBranding = useQuery(api.functions.orgBranding.queries.getByOrgId);
  const { download: downloadPdf, state: pdfState } = usePdfGenerator();

  const projection = matrix?.projection ?? null;

  const successor = useQuery(
    api.functions.projections.queries.hasSuccessor,
    authReady && projection ? { projectionId: projection._id } : "skip"
  );

  const handleGenerateQuestionnaire = async () => {
    try {
      setIsGeneratingQ(true);
      const id = await generateQuestionnaire({ projectionId });
      router.push(`/cuestionarios/${id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error al generar cuestionario");
      setIsGeneratingQ(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!matrix) return;
    try {
      const branding = {
        companyName: orgBranding?.companyName ?? "Projex",
        primaryColor: orgBranding?.primaryColor ?? "#1a1a2e",
        secondaryColor: orgBranding?.secondaryColor ?? "#6c63ff",
        accentColor: orgBranding?.accentColor ?? "#22c55e",
        fontFamily: orgBranding?.fontFamily ?? "Arial, sans-serif",
      };
      const htmlContent = buildProjectionPdfHtml(
        matrix.projection,
        matrix.services,
        matrix.assignments
      );
      const year = matrix.projection.year;
      await downloadPdf(htmlContent, branding, `proyeccion-${year}.pdf`);
    } catch (err) {
      console.error("Error al descargar PDF de proyección:", err);
    }
  };

  if (matrix === undefined) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-secondary" />
        <div className="h-96 animate-pulse rounded-lg border border-border bg-card" />
      </div>
    );
  }

  if (matrix === null) {
    return (
      <div className="space-y-4">
        <Link href="/proyecciones" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground cursor-pointer">
          <ArrowLeft size={14} /> Volver a Proyecciones
        </Link>
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <p className="text-lg font-medium">Proyección no encontrada</p>
        </div>
      </div>
    );
  }

  const { services, assignments } = matrix;
  const activeServices = services.filter((s) => s.isActive);

  // C4: dynamic columns via resolveProjectionContext / resolveProjectionMonths
  const ctx = resolveProjectionContext(projection!);
  const months = resolveProjectionMonths(ctx.startMonth, ctx.monthCount);
  const monthLabels = months.map((m, i) => {
    const yearOffset = Math.floor((ctx.startMonth - 1 + i) / 12);
    const year = projection!.year + yearOffset;
    return `${MONTH_NAMES[m - 1]} ${String(year).slice(-2)}`;
  });

  const showContinuationButton =
    ctx.projectionMode === "fiscal" &&
    ctx.endMonth === 12 &&
    successor === false;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/proyecciones"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <ArrowLeft size={14} />
          Volver a Proyecciones
        </Link>

        {projection!.previousProjectionId && (
          <Link
            href={`/proyecciones/${projection!.previousProjectionId}`}
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <ChevronLeft size={12} />
            Ver proyección anterior
          </Link>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <TrendingUp className="text-accent" size={28} />
          <h1 className="text-2xl font-bold">
            Proyección {projection!.year}
          </h1>
          {ctx.projectionMode === "fiscal" && (
            <div className="inline-flex items-center gap-2 rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-1 text-xs text-amber-700 dark:text-amber-400">
              Proyección parcial · {ctx.monthCount} meses · año fiscal
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={pdfState.isGenerating}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-secondary transition-colors cursor-pointer disabled:opacity-50"
          >
            {pdfState.isGenerating ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Download size={14} />
            )}
            {pdfState.isGenerating ? "Generando..." : "Descargar PDF"}
          </button>

          {showContinuationButton && (
            <Link
              href={`/proyecciones/nueva?previousProjectionId=${projection!._id}&clientId=${projection!.clientId}`}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-primary hover:bg-accent/90"
            >
              Crear continuación 12 meses →
            </Link>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Venta Anual</p>
          <p className="mt-1 text-lg font-bold">
            {formatCurrency(projection!.annualSales)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Presupuesto</p>
          <p className="mt-1 text-lg font-bold">
            {formatCurrency(projection!.totalBudget)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Comisión</p>
          <p className="mt-1 text-lg font-bold">
            {(projection!.commissionRate * 100).toFixed(1)}%
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Servicios Activos</p>
          <p className="mt-1 text-lg font-bold text-accent">
            {activeServices.length}
          </p>
        </div>
      </div>

      {/* Questionnaire card */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10">
              <ClipboardList className="text-accent" size={20} />
            </div>
            <div>
              <p className="font-medium">Cuestionario</p>
              <p className="text-xs text-muted-foreground">
                {questionnaire === undefined
                  ? "Cargando..."
                  : questionnaire === null
                    ? "Aún no se ha generado. Se construirá con 3 preguntas genéricas + 1 por cada servicio activo."
                    : `Creado el ${new Date(questionnaire.createdAt).toLocaleDateString("es-MX")} · ${questionnaire.responses.length} preguntas`}
              </p>
            </div>
          </div>
          {questionnaire === null && (
            <button
              type="button"
              onClick={handleGenerateQuestionnaire}
              disabled={isGeneratingQ || activeServices.length === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              <Plus size={16} />
              {isGeneratingQ ? "Generando..." : "Generar Cuestionario"}
            </button>
          )}
          {questionnaire && (
            <Link
              href={`/cuestionarios/${questionnaire._id}`}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary cursor-pointer"
            >
              Ver cuestionario
              <ArrowRight size={14} />
            </Link>
          )}
        </div>
      </div>

      {/* Projection Matrix — N columns driven by startMonth + monthCount */}
      <div className="rounded-lg border border-border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="sticky left-0 bg-card px-4 py-3 text-left font-medium">
                Servicio
              </th>
              {monthLabels.map((label, i) => (
                <th
                  key={`${months[i]}-${i}`}
                  className="px-3 py-3 text-center font-medium text-muted-foreground whitespace-nowrap"
                >
                  {label}
                </th>
              ))}
              <th className="px-4 py-3 text-right font-medium text-accent">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {activeServices.map((svc) => {
              const svcAssignments = assignments.filter(
                (a) => a.projServiceId === svc._id
              );
              return (
                <tr key={svc._id} className="border-b border-border/50">
                  <td className="sticky left-0 bg-card px-4 py-2.5 font-medium">
                    <div>
                      <div>{svc.serviceName}</div>
                      {svc.subserviceId && subservicesById.get(svc.subserviceId) && (
                        <div className="text-[10px] text-muted-foreground font-normal mt-0.5">
                          {subservicesById.get(svc.subserviceId)!.name}
                        </div>
                      )}
                    </div>
                  </td>
                  {months.map((monthNum, i) => {
                    const ma = svcAssignments.find((a) => a.month === monthNum);
                    if (!ma) {
                      return (
                        <td key={`${monthNum}-${i}`} className="px-2 py-2 text-center">
                          <span className="text-muted-foreground">—</span>
                        </td>
                      );
                    }

                    const cellSubservice = ma.subserviceId
                      ? subservicesById.get(ma.subserviceId)
                      : null;

                    const optionsForRow = (subservices ?? []).filter(
                      (s) => s.parentServiceId === svc.serviceId && s.isActive
                    );

                    return (
                      <td
                        key={`${monthNum}-${i}`}
                        className={cn(
                          "px-2 py-2 text-center cursor-pointer hover:bg-accent/5 transition-colors",
                          !cellSubservice && "border border-destructive/40 bg-destructive/5"
                        )}
                        onClick={() => setSelectedAssignmentId(ma._id)}
                      >
                        <div className="space-y-1">
                          <p className="text-xs">{formatCurrency(ma.amount)}</p>
                          <SubserviceCellPicker
                            current={cellSubservice ?? null}
                            options={optionsForRow}
                            onPick={(subId) =>
                              setMonthSubservice({ id: ma._id, subserviceId: subId })
                            }
                          />
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-4 py-2.5 text-right font-medium text-accent">
                    {formatCurrency(svc.annualAmount)}
                  </td>
                </tr>
              );
            })}
            {/* Totals row */}
            <tr className="bg-secondary/30 font-medium">
              <td className="sticky left-0 bg-secondary/30 px-4 py-3">
                Total
              </td>
              {months.map((monthNum, i) => {
                const monthTotal = assignments
                  .filter((a) => a.month === monthNum)
                  .reduce((sum, a) => sum + a.amount, 0);
                return (
                  <td key={`total-${monthNum}-${i}`} className="px-2 py-3 text-center text-xs">
                    {formatCurrency(monthTotal)}
                  </td>
                );
              })}
              <td className="px-4 py-3 text-right text-accent">
                {formatCurrency(
                  activeServices.reduce((sum, s) => sum + s.annualAmount, 0)
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Cell Detail Panel */}
      {selectedAssignment && (
        <MatrixCellDetail
          assignment={selectedAssignment}
          subserviceName={
            selectedAssignment.subserviceId
              ? subservicesById.get(selectedAssignment.subserviceId)?.name
              : undefined
          }
          onClose={() => setSelectedAssignmentId(null)}
        />
      )}
    </div>
  );
}
