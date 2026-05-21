"use client";

import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Doc } from "../../../convex/_generated/dataModel";
import {
  X,
  Upload,
  FileText,
  CheckCircle2,
  Clock,
  ExternalLink,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useState } from "react";
import { useOrgConfig } from "@/lib/useOrgConfig";

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const STATUS_OPTIONS = [
  { value: "pending" as const, label: "Pendiente", color: "bg-muted-foreground/20 text-muted-foreground" },
  { value: "info_received" as const, label: "Info Recibida", color: "bg-info/20 text-info" },
  { value: "in_progress" as const, label: "En Progreso", color: "bg-warning/20 text-warning" },
  { value: "delivered" as const, label: "Entregado", color: "bg-accent/20 text-accent" },
];

const INVOICE_OPTIONS = [
  { value: "not_invoiced" as const, label: "Sin Facturar" },
  { value: "invoiced" as const, label: "Facturado" },
  { value: "paid" as const, label: "Pagado" },
];

type StepStatus = "done" | "current" | "pending";

interface Step {
  key: string;
  label: string;
  description: string;
  status: StepStatus;
}

export function MatrixCellDetail({
  assignment,
  onClose,
}: {
  assignment: Doc<"monthlyAssignments">;
  onClose: () => void;
}) {
  const { flags } = useOrgConfig();
  const updateStatus = useMutation(api.functions.monthlyAssignments.mutations.updateStatus);
  const updateInvoice = useMutation(api.functions.monthlyAssignments.mutations.updateInvoiceStatus);
  const updateAmount = useMutation(api.functions.monthlyAssignments.mutations.updateAmount);

  const deliverable = useQuery(
    api.functions.deliverables.queries.getByAssignment,
    { assignmentId: assignment._id }
  );
  const invoicesForClient = useQuery(
    api.functions.invoices.queries.listByClient,
    { clientId: assignment.clientId }
  );

  const [editAmount, setEditAmount] = useState(false);
  const [newAmount, setNewAmount] = useState(assignment.amount);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const matchingInvoice = invoicesForClient?.find(
    (inv) =>
      inv.month === assignment.month &&
      inv.year === assignment.year &&
      inv.status !== "void" &&
      (inv.projServiceId === assignment.projServiceId || !inv.projServiceId)
  );

  const lifecycle = deriveLifecycle({
    assignment,
    invoice: matchingInvoice,
    deliverable,
  });

  return (
    <div className="fixed inset-y-0 right-0 w-[420px] border-l border-border bg-card shadow-xl z-50 overflow-y-auto">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-6 py-4">
        <div>
          <p className="text-xs text-muted-foreground">
            {MONTH_NAMES[assignment.month - 1]} {assignment.year}
          </p>
          <h3 className="text-lg font-semibold">{assignment.serviceName}</h3>
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1.5 hover:bg-secondary transition-colors cursor-pointer"
          aria-label="Cerrar"
        >
          <X size={18} />
        </button>
      </div>

      <div className="space-y-6 p-6">
        <div className="rounded-lg border border-border bg-secondary/30 p-4">
          <div className="flex items-baseline justify-between mb-1">
            <p className="text-xs text-muted-foreground">Monto contractual</p>
            <p className="text-xs text-muted-foreground">
              FE {assignment.feFactor.toFixed(2)}
            </p>
          </div>
          {editAmount && flags.manualOverrideAllowed ? (
            <div className="flex gap-2 mt-1">
              <input
                type="number"
                value={newAmount}
                onChange={(e) => setNewAmount(Number(e.target.value))}
                className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm focus:border-accent focus:outline-none"
              />
              <button
                onClick={async () => {
                  await updateAmount({ id: assignment._id, amount: newAmount });
                  setEditAmount(false);
                }}
                className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-primary cursor-pointer"
              >
                Guardar
              </button>
              <button
                onClick={() => {
                  setEditAmount(false);
                  setNewAmount(assignment.amount);
                }}
                className="rounded-md border border-border px-3 py-1 text-xs cursor-pointer"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <p className="text-2xl font-bold text-accent">
                {formatCurrency(assignment.amount)}
              </p>
              {flags.manualOverrideAllowed && (
                <button
                  onClick={() => setEditAmount(true)}
                  className="text-xs text-muted-foreground hover:text-foreground cursor-pointer underline"
                >
                  Editar
                </button>
              )}
            </div>
          )}
        </div>

        <PrimaryAction
          lifecycle={lifecycle}
          assignment={assignment}
          invoice={matchingInvoice}
          deliverable={deliverable}
        />

        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Ciclo del entregable
          </p>
          <ol className="space-y-3">
            {lifecycle.steps.map((step) => (
              <StepRow key={step.key} step={step} />
            ))}
          </ol>
          <p className="mt-4 text-xs text-muted-foreground leading-relaxed">
            El entregable se genera <span className="text-foreground">automáticamente</span> cuando marcas la factura como pagada en <Link href="/facturacion" className="text-accent hover:underline">Facturación</Link>.
          </p>
        </div>

        <div className="border-t border-border pt-4">
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            Avanzado · override manual
          </button>
          {showAdvanced && (
            <div className="mt-4 space-y-5">
              <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
                <p className="flex items-start gap-2 text-xs text-warning leading-relaxed">
                  <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                  <span>
                    Estos botones <strong>no</strong> generan entregable. Solo cambian el estado mostrado al equipo. Para activar la generación real, sube la factura en{" "}
                    <Link href="/facturacion" className="underline">/facturacion</Link>.
                  </span>
                </p>
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-2">Status de Entrega</p>
                <div className="flex flex-wrap gap-2">
                  {STATUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => updateStatus({ id: assignment._id, status: opt.value })}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
                        assignment.status === opt.value
                          ? opt.color
                          : "bg-secondary text-muted-foreground hover:bg-secondary/80"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-2">Status de Facturación (legacy)</p>
                <div className="flex flex-wrap gap-2">
                  {INVOICE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => updateInvoice({ id: assignment._id, invoiceStatus: opt.value })}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
                        assignment.invoiceStatus === opt.value
                          ? "bg-accent/20 text-accent"
                          : "bg-secondary text-muted-foreground hover:bg-secondary/80"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PrimaryAction({
  lifecycle,
  assignment,
  invoice,
  deliverable,
}: {
  lifecycle: Lifecycle;
  assignment: Doc<"monthlyAssignments">;
  invoice?: Doc<"invoices">;
  deliverable: Doc<"deliverables"> | null | undefined;
}) {
  const facturacionHref = `/facturacion?year=${assignment.year}&month=${assignment.month}`;

  if (lifecycle.stage === "delivered" && deliverable) {
    return (
      <Link
        href={`/entregables/${deliverable._id}`}
        className="flex w-full items-center justify-between rounded-md bg-accent px-4 py-3 text-sm font-medium text-primary hover:bg-accent/90 transition-colors"
      >
        <span className="flex items-center gap-2">
          <CheckCircle2 size={16} />
          Ver entregable
        </span>
        <ExternalLink size={14} />
      </Link>
    );
  }

  if (lifecycle.stage === "generating") {
    return (
      <div className="flex w-full items-center justify-center gap-2 rounded-md border border-warning/30 bg-warning/5 px-4 py-3 text-sm font-medium text-warning">
        <Clock size={16} className="animate-pulse" />
        Generando entregable…
      </div>
    );
  }

  if (lifecycle.stage === "invoice_uploaded") {
    return (
      <Link
        href={facturacionHref}
        className="flex w-full items-center justify-between rounded-md bg-accent px-4 py-3 text-sm font-medium text-primary hover:bg-accent/90 transition-colors"
      >
        <span className="flex items-center gap-2">
          <CheckCircle2 size={16} />
          Marcar factura como pagada
        </span>
        <ExternalLink size={14} />
      </Link>
    );
  }

  if (lifecycle.stage === "invoice_void") {
    return (
      <Link
        href={facturacionHref}
        className="flex w-full items-center justify-between rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
      >
        <span className="flex items-center gap-2">
          <AlertCircle size={16} />
          Factura anulada · subir reemplazo
        </span>
        <ExternalLink size={14} />
      </Link>
    );
  }

  return (
    <Link
      href={facturacionHref}
      className="flex w-full items-center justify-between rounded-md bg-accent px-4 py-3 text-sm font-medium text-primary hover:bg-accent/90 transition-colors"
    >
      <span className="flex items-center gap-2">
        <Upload size={16} />
        Subir factura para {MONTH_NAMES[assignment.month - 1]}
      </span>
      <ExternalLink size={14} />
    </Link>
  );
}

function StepRow({ step }: { step: Step }) {
  const isDone = step.status === "done";
  const isCurrent = step.status === "current";

  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <div
          className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${
            isDone
              ? "border-accent bg-accent text-primary"
              : isCurrent
                ? "border-accent bg-accent/10 text-accent"
                : "border-border bg-background text-muted-foreground"
          }`}
        >
          {isDone ? (
            <CheckCircle2 size={14} strokeWidth={2.5} />
          ) : isCurrent ? (
            <Clock size={12} />
          ) : (
            <span className="text-[10px] font-bold">•</span>
          )}
        </div>
        <div
          className={`mt-1 w-0.5 flex-1 min-h-[16px] ${
            isDone ? "bg-accent/40" : "bg-border"
          }`}
        />
      </div>
      <div className="pb-3 flex-1">
        <p
          className={`text-sm font-medium ${
            isDone || isCurrent ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          {step.label}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
          {step.description}
        </p>
      </div>
    </li>
  );
}

type LifecycleStage =
  | "awaiting_invoice"
  | "invoice_uploaded"
  | "invoice_void"
  | "generating"
  | "delivered";

interface Lifecycle {
  stage: LifecycleStage;
  steps: Step[];
}

function deriveLifecycle({
  assignment,
  invoice,
  deliverable,
}: {
  assignment: Doc<"monthlyAssignments">;
  invoice?: Doc<"invoices">;
  deliverable: Doc<"deliverables"> | null | undefined;
}): Lifecycle {
  let stage: LifecycleStage = "awaiting_invoice";
  if (deliverable) {
    stage = "delivered";
  } else if (invoice?.status === "paid") {
    stage = "generating";
  } else if (invoice?.status === "uploaded") {
    stage = "invoice_uploaded";
  } else if (invoice?.status === "void") {
    stage = "invoice_void";
  }

  const invoiceUploaded =
    !!invoice && (invoice.status === "uploaded" || invoice.status === "paid");
  const invoicePaid = invoice?.status === "paid";
  const delivered = !!deliverable;

  const steps: Step[] = [
    {
      key: "info",
      label: "Información del cliente",
      description: "El cliente respondió el cuestionario del subservicio.",
      status:
        assignment.status === "pending"
          ? "current"
          : "done",
    },
    {
      key: "invoice_uploaded",
      label: "Factura subida",
      description: "Sube el PDF de la factura en Facturación.",
      status: invoiceUploaded ? "done" : stage === "invoice_void" ? "current" : assignment.status === "pending" ? "pending" : "current",
    },
    {
      key: "invoice_paid",
      label: "Factura marcada como pagada",
      description: "Esto dispara la generación automática del entregable.",
      status: invoicePaid ? "done" : invoiceUploaded ? "current" : "pending",
    },
    {
      key: "deliverable_generated",
      label: "Entregable generado y entregado",
      description: "El sistema genera el PDF y envía link firmado al cliente.",
      status: delivered ? "done" : invoicePaid ? "current" : "pending",
    },
  ];

  return { stage, steps };
}
