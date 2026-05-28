"use client";

import { useQuery, useAction } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import { Id } from "../../../../../../convex/_generated/dataModel";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FileOutput, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

const MONTH_SHORT = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

const AUDIT_COLORS: Record<string, string> = {
  pending: "bg-muted-foreground/20 text-muted-foreground",
  approved: "bg-emerald-500/20 text-emerald-400",
  rejected: "bg-red-500/20 text-red-400",
  corrected: "bg-blue-500/20 text-blue-400",
};

const AUDIT_LABELS: Record<string, string> = {
  pending: "Pend.",
  approved: "Aprob.",
  rejected: "Rech.",
  corrected: "Corr.",
};

export default function ClientEntregablesPage() {
  const params = useParams();
  const clientId = params.id as Id<"clients">;

  const client = useQuery(api.functions.clients.queries.getById, { id: clientId });
  const matrix = useQuery(
    api.functions.deliverables.queries.listByClientMatrix,
    { clientId }
  );
  const projections = useQuery(
    api.functions.projections.queries.getByClient,
    { clientId }
  );

  // Find the active projection (or most recent draft)
  const activeProjection = projections?.find((p) => p.status === "active")
    ?? projections?.[0]
    ?? null;

  const assignments = useQuery(
    api.functions.monthlyAssignments.queries.listByProjection,
    activeProjection ? { projectionId: activeProjection._id } : "skip"
  );

  const generateDeliverable = useAction(
    api.functions.deliverables.actions.generateDeliverable
  );

  // Track which (projServiceId, month) cells are generating
  const [generating, setGenerating] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function handleGenerate(
    projServiceId: Id<"projectionServices">,
    month: number
  ) {
    const cellKey = `${projServiceId}-${month}`;
    if (!assignments) return;

    // Find the assignment for this service+month
    const assignment = assignments.find(
      (a) => (a.projServiceId as unknown as string) === (projServiceId as unknown as string)
        && a.month === month
    );
    if (!assignment) return;

    setGenerating((prev) => new Set([...prev, cellKey]));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[cellKey];
      return next;
    });

    try {
      await generateDeliverable({
        assignmentId: assignment._id,
        projServiceId: assignment.projServiceId,
        clientId: assignment.clientId,
        templateType: "deliverable_short",
        triggerSource: "manual",
      });
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [cellKey]: (err as Error).message ?? "Error al generar",
      }));
    } finally {
      setGenerating((prev) => {
        const next = new Set(prev);
        next.delete(cellKey);
        return next;
      });
    }
  }

  if (client === undefined || matrix === undefined) {
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
        <Link
          href="/clientes"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <ArrowLeft size={14} /> Volver a Clientes
        </Link>
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <p className="text-muted-foreground">Cliente no encontrado.</p>
        </div>
      </div>
    );
  }

  const { services, months } = matrix;

  // Build a lookup: `${projServiceId}-${month}` → assignment._id
  // so we can show "Generar" only when an assignment exists but no deliverable.
  const assignmentCellMap = new Map<string, Id<"monthlyAssignments">>();
  if (assignments) {
    for (const a of assignments) {
      assignmentCellMap.set(
        `${a.projServiceId as unknown as string}-${a.month}`,
        a._id
      );
    }
  }

  // Months to show = union of months with deliverables + months in assignments
  const assignmentMonths = assignments
    ? [...new Set(assignments.map((a) => a.month))]
    : [];
  const allMonths = [...new Set([...months, ...assignmentMonths])].sort((a, b) => a - b);

  // Merge matrix services with assignment-only services (services that have
  // assignments but zero deliverables yet).
  const assignmentServiceNames = new Map<string, string>();
  for (const a of assignments ?? []) {
    assignmentServiceNames.set(a.projServiceId as unknown as string, a.serviceName);
  }
  const matrixServiceIds = new Set(services.map((s) => s.projServiceId));
  const assignmentOnlyServices: typeof services = [];
  for (const [psId, svcName] of assignmentServiceNames) {
    if (!matrixServiceIds.has(psId)) {
      assignmentOnlyServices.push({
        projServiceId: psId,
        serviceName: svcName,
        deliverables: [],
      });
    }
  }
  const allServices = [...services, ...assignmentOnlyServices];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/clientes/${clientId}`}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <ArrowLeft size={14} /> Volver a {client.name}
        </Link>
        <div className="mt-2 flex items-center gap-2">
          <FileOutput size={20} className="text-accent" />
          <h1 className="text-2xl font-semibold">
            Entregables — {client.name}
          </h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Matriz de entregables por servicio y mes. Haz clic en una celda para
          ver el entregable o generarlo.
        </p>
      </div>

      {allServices.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <FileOutput className="mx-auto mb-4 text-muted-foreground" size={48} />
          <p className="text-lg font-medium">Sin entregables ni asignaciones</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Este cliente no tiene proyecciones activas con asignaciones mensuales.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground min-w-[160px]">
                  Servicio
                </th>
                {allMonths.map((m) => (
                  <th
                    key={m}
                    className="px-3 py-2.5 text-center font-medium text-muted-foreground min-w-[80px]"
                  >
                    {MONTH_SHORT[m - 1]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allServices.map((svc) => (
                <tr
                  key={svc.projServiceId}
                  className="border-b border-border/50 hover:bg-secondary/20"
                >
                  <td className="px-4 py-3 font-medium">{svc.serviceName}</td>
                  {allMonths.map((m) => {
                    const d = svc.deliverables.find((x) => x.month === m);
                    const cellKey = `${svc.projServiceId}-${m}`;
                    const isGenerating = generating.has(cellKey);
                    const cellError = errors[cellKey];
                    const hasAssignment = assignmentCellMap.has(cellKey);

                    return (
                      <td key={m} className="px-3 py-3 text-center">
                        {d ? (
                          <Link
                            href={`/entregables/${d._id}`}
                            className={cn(
                              "inline-block rounded-full px-2 py-0.5 text-xs font-medium hover:opacity-80 transition-opacity",
                              AUDIT_COLORS[d.auditStatus]
                            )}
                            title={d.auditStatus}
                          >
                            {AUDIT_LABELS[d.auditStatus]}
                          </Link>
                        ) : isGenerating ? (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Loader2 size={10} className="animate-spin" />
                            Gen…
                          </span>
                        ) : hasAssignment ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() =>
                                handleGenerate(
                                  svc.projServiceId as Id<"projectionServices">,
                                  m
                                )
                              }
                              title="Generar entregable"
                              className="inline-flex items-center gap-0.5 rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground hover:border-accent/40 hover:text-accent transition-colors cursor-pointer"
                            >
                              <Plus size={10} /> Gen.
                            </button>
                            {cellError && (
                              <span className="text-[9px] text-red-400 max-w-[72px] truncate" title={cellError}>
                                Error
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
