"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id, Doc } from "../../../../../convex/_generated/dataModel";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { ArrowLeft, TrendingUp, ClipboardList, Plus, ArrowRight, ChevronLeft, Download, Loader2, AlertTriangle, FileText, Settings2 } from "lucide-react";
// SS3-T4: month labels for the window picker selectors
import Link from "next/link";
import { formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { MatrixCellDetail } from "@/components/projections/matrix-cell-detail";
import { SubserviceCellPicker } from "@/components/projections/subservice-cell-picker";
import { resolveProjectionContext, resolveProjectionMonths } from "../../../../../convex/lib/projectionContext";
import { usePdfGenerator } from "@/lib/usePdfGenerator";
import { buildProjectionPdfHtml } from "@/lib/projectionPdfBuilder";
import { MissingContentBanner } from "@/components/projections/missing-content-banner";

const MONTH_NAMES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];
// SS3-T4: short month labels for window picker (same order, 0-indexed)
const MONTH_LABELS_ES = MONTH_NAMES;

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


  const allTemplates = useQuery(
    api.functions.deliverableTemplates.queries.list,
    authReady ? {} : "skip"
  );
  // Map serviceId → template names for the deliverables popover
  const templatesByServiceId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const t of allTemplates ?? []) {
      if (!t.isActive || !t.serviceId) continue;
      const key = t.serviceId as string;
      const names = map.get(key) ?? [];
      names.push(t.name);
      map.set(key, names);
    }
    return map;
  }, [allTemplates]);

  const [deliverablesOpenFor, setDeliverablesOpenFor] = useState<string | null>(null);

  const setMonthSubservice = useMutation(
    api.functions.monthlyAssignments.mutations.setSubservice
  );

  // SS3-T4: mutation for per-service contractual window
  const updateContractualWindow = useMutation(
    api.functions.projectionServices.mutations.updateContractualWindow
  );
  // SS6: mutation to apply year-over-year discounted amount
  const setAnnualAmount = useMutation(
    api.functions.projectionServices.mutations.setAnnualAmount
  );

  const orgBranding = useQuery(api.functions.orgBranding.queries.getByOrgId);
  const { download: downloadPdf, state: pdfState } = usePdfGenerator();

  const projection = matrix?.projection ?? null;

  const client = useQuery(
    api.functions.clients.queries.getById,
    authReady && projection ? { id: projection.clientId } : "skip"
  );

  const successor = useQuery(
    api.functions.projections.queries.hasSuccessor,
    authReady && projection ? { projectionId: projection._id } : "skip"
  );

  // SS7-F3: "Editar desde el inicio" state + hooks
  const [reEditOpen, setReEditOpen] = useState(false);
  const downstream = useQuery(
    api.functions.projections.queries.getDownstreamSummary,
    reEditOpen && projection ? { projectionId: projection._id } : "skip"
  );
  const cloneToDraft = useMutation(api.functions.projections.mutations.cloneProjectionToDraft);
  const [reEditSaving, setReEditSaving] = useState(false);

  // #22d — "Cotizar este servicio" per matrix row
  const createManualQuotation = useMutation(
    api.functions.quotations.mutations.createManualQuotation
  );
  const [quotingProjServiceId, setQuotingProjServiceId] =
    useState<Id<"projectionServices"> | null>(null);

  const handleQuotarServicio = async (
    projServiceId: Id<"projectionServices">,
    subserviceId?: Id<"subservices">
  ) => {
    setQuotingProjServiceId(projServiceId);
    try {
      const quotationId = await createManualQuotation({
        projServiceId,
        ...(subserviceId && { subserviceId }),
      });
      router.push(`/cotizaciones/${quotationId}`);
    } catch (err) {
      alert(
        err instanceof Error ? err.message : "Error al crear cotización"
      );
      setQuotingProjServiceId(null);
    }
  };

  // #5 — batch-generate all quotations
  const generateAllQuotations = useMutation(
    api.functions.quotations.mutations.generateAllForProjection
  );
  const [isGeneratingQuotations, setIsGeneratingQuotations] = useState(false);
  const [batchQuotationResult, setBatchQuotationResult] = useState<{
    created: number;
    skipped: number;
  } | null>(null);

  const handleGenerateAllQuotations = async () => {
    if (!projection) return;
    setIsGeneratingQuotations(true);
    setBatchQuotationResult(null);
    try {
      const result = await generateAllQuotations({ projectionId: projection._id });
      setBatchQuotationResult(result);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error al generar cotizaciones");
    } finally {
      setIsGeneratingQuotations(false);
    }
  };

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
            {client?.name ? `${client.name} — Proyección ${projection!.year}` : `Proyección ${projection!.year}`}
          </h1>
          {ctx.projectionMode === "fiscal" && (
            <div className="inline-flex items-center gap-2 rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-1 text-xs text-amber-700 dark:text-amber-400">
              Proyección parcial · {ctx.monthCount} meses · año fiscal
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* #1 — Post-creation subservices picker */}
          <Link
            href={`/proyecciones/${projectionId}/subservicios`}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-secondary transition-colors cursor-pointer"
          >
            <Settings2 size={14} />
            Configurar subservicios
          </Link>

          {projection!.status !== "archived" && (
            <button
              type="button"
              onClick={() => setReEditOpen(true)}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-secondary transition-colors cursor-pointer"
            >
              Editar desde el inicio
            </button>
          )}

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

      {/* #5 — Batch-generate quotations (visible when questionnaire is completed) */}
      {questionnaire?.status === "completed" && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10">
                <FileText className="text-accent" size={20} />
              </div>
              <div>
                <p className="font-medium">Cotizaciones</p>
                <p className="text-xs text-muted-foreground">
                  Genera una cotización en borrador por cada servicio activo de
                  esta proyección.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {batchQuotationResult && (
                <p className="text-sm text-muted-foreground">
                  {batchQuotationResult.created} creadas
                  {batchQuotationResult.skipped > 0
                    ? `, ${batchQuotationResult.skipped} ya existían`
                    : ""}
                </p>
              )}
              <button
                type="button"
                onClick={handleGenerateAllQuotations}
                disabled={isGeneratingQuotations || activeServices.length === 0}
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
              >
                {isGeneratingQuotations ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Plus size={16} />
                )}
                {isGeneratingQuotations
                  ? "Generando..."
                  : "Generar todas las cotizaciones"}
              </button>
              <Link
                href="/cotizaciones"
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary cursor-pointer"
              >
                Ver cotizaciones
                <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      )}

      <MissingContentBanner projectionId={projectionId} />

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
              <th className="px-3 py-3 text-center font-medium text-muted-foreground whitespace-nowrap">
                Entregables
              </th>
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

              // SS3-T4: effective contractual window for this service
              const effectiveStart = svc.startMonth ?? projection!.startMonth ?? 1;
              const effectiveEnd = svc.endMonth ?? 12;
              // "Full year defaults" = no per-service override needed
              const isDefaultWindow =
                svc.startMonth === undefined && svc.endMonth === undefined;

              return (
                <tr key={svc._id} className="border-b border-border/50">
                  <td className="sticky left-0 bg-card px-4 py-2.5 font-medium">
                    <div className="space-y-1.5">
                      <div>{svc.serviceName}</div>
                      {svc.subserviceId && subservicesById.get(svc.subserviceId) && (
                        <div className="text-[10px] text-muted-foreground font-normal">
                          {subservicesById.get(svc.subserviceId)!.name}
                        </div>
                      )}
                      {/* SS6: year-over-year discount chip */}
                      {svc.subserviceId && projection && (
                        <YearOverYearChip
                          clientId={projection.clientId}
                          subserviceId={svc.subserviceId}
                          annualAmount={svc.annualAmount}
                          onApply={(newAmount) =>
                            setAnnualAmount({
                              projServiceId: svc._id,
                              annualAmount: newAmount,
                            }).catch(() => {})
                          }
                        />
                      )}
                      {/* SS3-T4: per-service window picker (F9: always persist literal choice) */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] text-muted-foreground">Inicia en</span>
                        <select
                          value={effectiveStart}
                          onChange={(e) => {
                            // F9: always store the literal value the user picked —
                            // no auto-undefined-on-equals-default logic. This makes
                            // explicit choice indistinguishable from default only when
                            // the user explicitly clears via the ↺ button below.
                            updateContractualWindow({
                              projServiceId: svc._id,
                              startMonth: Number(e.target.value),
                              endMonth: svc.endMonth,
                            }).catch(() => {});
                          }}
                          className="text-[10px] rounded border border-border bg-secondary px-1 py-0.5 focus:border-accent focus:outline-none cursor-pointer"
                          title="Mes de inicio del servicio (ventana contractual)"
                        >
                          {MONTH_LABELS_ES.map((label, idx) => (
                            <option key={idx + 1} value={idx + 1}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <span className="text-[10px] text-muted-foreground">Termina en</span>
                        <select
                          value={effectiveEnd}
                          onChange={(e) => {
                            updateContractualWindow({
                              projServiceId: svc._id,
                              startMonth: svc.startMonth,
                              endMonth: Number(e.target.value),
                            }).catch(() => {});
                          }}
                          className="text-[10px] rounded border border-border bg-secondary px-1 py-0.5 focus:border-accent focus:outline-none cursor-pointer"
                          title="Mes de fin del servicio (ventana contractual)"
                        >
                          {MONTH_LABELS_ES.map((label, idx) => (
                            <option key={idx + 1} value={idx + 1}>
                              {label}
                            </option>
                          ))}
                        </select>
                        {!isDefaultWindow && (
                          <button
                            type="button"
                            onClick={() =>
                              updateContractualWindow({
                                projServiceId: svc._id,
                                startMonth: undefined,
                                endMonth: undefined,
                              }).catch(() => {})
                            }
                            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                            title="Restablecer ventana (hereda mes de inicio de la proyección, todo el año)"
                          >
                            ↺ Limpiar ventana
                          </button>
                        )}
                      </div>
                    </div>
                  </td>
                  {months.map((monthNum, i) => {
                    // SS3-T5: render dash for months outside the service window
                    const isOutOfWindow = monthNum < effectiveStart || monthNum > effectiveEnd;
                    if (isOutOfWindow) {
                      return (
                        <td
                          key={`${monthNum}-${i}`}
                          title={`Activo ${MONTH_LABELS_ES[effectiveStart - 1]} – ${MONTH_LABELS_ES[effectiveEnd - 1]}`}
                          className="text-center text-gray-400 italic select-none px-2 py-2"
                        >
                          —
                        </td>
                      );
                    }

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
                  {/* Deliverables popover cell */}
                  {(() => {
                    const names = templatesByServiceId.get(svc.serviceId as string) ?? [];
                    const isOpen = deliverablesOpenFor === (svc._id as string);
                    return (
                      <td className="px-3 py-2.5 text-center relative">
                        <button
                          type="button"
                          onClick={() =>
                            setDeliverablesOpenFor(isOpen ? null : (svc._id as string))
                          }
                          title="Ver entregables del servicio"
                          className={cn(
                            "inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors cursor-pointer",
                            names.length > 0
                              ? "text-accent hover:bg-accent/10"
                              : "text-muted-foreground hover:bg-secondary"
                          )}
                        >
                          <FileText size={12} />
                          {names.length > 0 ? names.length : "—"}
                        </button>
                        {isOpen && (
                          <div
                            className="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg border border-border bg-card shadow-lg p-3 text-left"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                              Entregables
                            </p>
                            {names.length === 0 ? (
                              <p className="text-xs text-muted-foreground italic">
                                Sin plantillas activas para este servicio.
                              </p>
                            ) : (
                              <ul className="space-y-1">
                                {names.map((name, i) => (
                                  <li key={i} className="text-xs flex items-center gap-1.5">
                                    <FileText size={10} className="text-accent shrink-0" />
                                    {name}
                                  </li>
                                ))}
                              </ul>
                            )}
                            <button
                              type="button"
                              onClick={() => setDeliverablesOpenFor(null)}
                              className="mt-3 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                            >
                              Cerrar
                            </button>
                          </div>
                        )}
                      </td>
                    );
                  })()}
                  <td className="px-4 py-2.5 text-right font-medium text-accent">
                    <div className="flex flex-col items-end gap-1.5">
                      <span>{formatCurrency(svc.annualAmount)}</span>
                      {/* #22d — "Cotizar" per service row, passes subserviceId when present */}
                      <button
                        type="button"
                        disabled={quotingProjServiceId === svc._id}
                        onClick={() =>
                          handleQuotarServicio(
                            svc._id,
                            svc.subserviceId ?? undefined
                          )
                        }
                        className="text-[10px] text-muted-foreground hover:text-accent transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
                        title="Crear cotización para este servicio"
                      >
                        {quotingProjServiceId === svc._id ? (
                          <Loader2 size={10} className="animate-spin" />
                        ) : (
                          <FileText size={10} />
                        )}
                        Cotizar
                      </button>
                    </div>
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
              {/* empty cell under Entregables column */}
              <td />
              <td className="px-4 py-3 text-right text-accent">
                {formatCurrency(
                  activeServices.reduce((sum, s) => sum + s.annualAmount, 0)
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* SS7-F3: Re-edit warning modal */}
      {reEditOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Re-editar proyección desde el inicio"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setReEditOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setReEditOpen(false);
          }}
        >
          <div
            className="w-full max-w-md rounded-lg border border-border bg-card p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="text-amber-400 shrink-0 mt-0.5" size={22} />
              <div className="flex-1">
                <h2 className="text-lg font-semibold">Re-editar proyección</h2>
                <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                  <p>Re-editar esta proyección desde el inicio borrará todos los documentos generados a partir de ella:</p>
                  {downstream ? (
                    <ul className="ml-4 list-disc space-y-1">
                      <li>{downstream.quotations} cotizaciones</li>
                      <li>{downstream.contracts} contratos</li>
                      <li>{downstream.invoices} facturas</li>
                      <li>{downstream.deliverables} entregables</li>
                      <li>{downstream.assignments} asignaciones mensuales</li>
                      <li>{downstream.questionnaires} cuestionarios</li>
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">Cargando…</p>
                  )}
                  <p className="font-medium text-foreground">Esta acción no se puede deshacer.</p>
                </div>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setReEditOpen(false)}
                disabled={reEditSaving}
                className="rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!downstream || reEditSaving}
                onClick={async () => {
                  if (!projection) return;
                  try {
                    setReEditSaving(true);
                    const draftId = await cloneToDraft({ projectionId: projection._id });
                    setReEditOpen(false);
                    router.push(`/proyecciones/nueva?draftId=${draftId}`);
                  } catch (err) {
                    console.error("Error al clonar proyección:", err);
                    setReEditSaving(false);
                  }
                }}
                className="rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-white hover:bg-amber-600 transition-colors cursor-pointer disabled:opacity-50"
              >
                {reEditSaving ? "Procesando..." : "Sí, re-editar"}
              </button>
            </div>
          </div>
        </div>
      )}

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

/**
 * SS6 — YearOverYearChip
 *
 * Isolated component so it can call useQuery at the top level (hooks can't be
 * called inside a .map()). Renders a blue "Año 2+" badge + "Aplicar" button
 * when the client qualifies for a renewal discount on this subservice.
 */
function YearOverYearChip({
  clientId,
  subserviceId,
  annualAmount,
  onApply,
}: {
  clientId: Id<"clients">;
  subserviceId: Id<"subservices">;
  annualAmount: number;
  onApply: (newAmount: number) => void;
}) {
  const hint = useQuery(api.functions.subservices.queries.getYearOverYearHint, {
    clientId,
    subserviceId,
  });

  if (!hint?.available || !hint.discount) return null;

  const newAmount = Math.round(annualAmount * (1 - hint.discount / 100));

  return (
    <span className="inline-flex items-center gap-1">
      <span className="rounded bg-blue-500/10 px-2 py-0.5 text-xs text-blue-400">
        Año 2+: -{hint.discount}% disponible
      </span>
      <button
        type="button"
        onClick={() => onApply(newAmount)}
        className="text-xs text-blue-500 underline hover:text-blue-600"
      >
        Aplicar
      </button>
    </span>
  );
}
