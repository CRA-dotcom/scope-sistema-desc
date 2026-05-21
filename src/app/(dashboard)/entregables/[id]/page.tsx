"use client";

import { useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  FileOutput,
  Download,
  Loader2,
  Send,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { usePdfGenerator } from "@/lib/usePdfGenerator";

const AUDIT_LABELS: Record<string, string> = {
  pending: "Pendiente",
  approved: "Aprobado",
  rejected: "Rechazado",
  corrected: "Corregido",
};

const AUDIT_COLORS: Record<string, string> = {
  pending: "bg-muted-foreground/20 text-muted-foreground",
  approved: "bg-emerald-500/20 text-emerald-400",
  rejected: "bg-red-500/20 text-red-400",
  corrected: "bg-blue-500/20 text-blue-400",
};

type ContentTab = "short" | "long";

export default function EntregableDetailPage() {
  const params = useParams();
  const id = params.id as Id<"deliverables">;

  const deliverable = useQuery(
    api.functions.deliverables.queries.getById,
    { id }
  );
  const client = useQuery(
    api.functions.clients.queries.getById,
    deliverable ? { id: deliverable.clientId } : "skip"
  );
  const orgBranding = useQuery(api.functions.orgBranding.queries.getByOrgId);

  const deliver = useMutation(
    api.functions.deliverables.mutations.deliver
  );
  const regenerateDeliverable = useAction(
    api.functions.deliverables.actions.generateDeliverable
  );

  const { generate: generatePdf, download: downloadPdf, state: pdfState } =
    usePdfGenerator();

  const [tab, setTab] = useState<ContentTab>("short");
  const [delivering, setDelivering] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const branding = {
    companyName: orgBranding?.companyName ?? client?.name ?? "Empresa",
    primaryColor: orgBranding?.primaryColor ?? "#1a1a2e",
    secondaryColor: orgBranding?.secondaryColor ?? "#6c63ff",
    fontFamily: orgBranding?.fontFamily ?? "Arial, sans-serif",
  };

  const handleGeneratePdf = async () => {
    if (!deliverable) return;
    try {
      const content = tab === "short" ? deliverable.shortContent : deliverable.longContent;
      const suffix = tab === "short" ? "resumen" : "completo";
      const filename = `entregable-${suffix}-${deliverable.serviceName.toLowerCase().replace(/\s+/g, "-")}-${client?.name?.toLowerCase().replace(/\s+/g, "-") ?? "cliente"}.pdf`;
      await generatePdf(content, branding, filename);
    } catch (err) {
      console.error("Error generating PDF:", err);
    }
  };

  const handleDownloadPdf = async () => {
    if (!deliverable) return;
    try {
      const content = tab === "short" ? deliverable.shortContent : deliverable.longContent;
      const suffix = tab === "short" ? "resumen" : "completo";
      const filename = `entregable-${suffix}-${deliverable.serviceName.toLowerCase().replace(/\s+/g, "-")}-${client?.name?.toLowerCase().replace(/\s+/g, "-") ?? "cliente"}.pdf`;
      await downloadPdf(content, branding, filename);
    } catch (err) {
      console.error("Error downloading PDF:", err);
    }
  };

  const handleDeliver = async () => {
    if (!deliverable) return;
    setDelivering(true);
    try {
      await deliver({ deliverableId: deliverable._id });
    } catch (err) {
      console.error("Error delivering:", err);
    } finally {
      setDelivering(false);
    }
  };

  const handleRegenerate = async () => {
    if (!deliverable) return;
    if (
      !confirm(
        "Esto regenera las dos versiones (corta + larga) del entregable con AI. Toma entre 20 y 60 segundos. ¿Continuar?"
      )
    ) {
      return;
    }
    setRegenerating(true);
    try {
      await Promise.all([
        regenerateDeliverable({
          assignmentId: deliverable.assignmentId,
          projServiceId: deliverable.projServiceId,
          clientId: deliverable.clientId,
          templateType: "deliverable_short",
        }),
        regenerateDeliverable({
          assignmentId: deliverable.assignmentId,
          projServiceId: deliverable.projServiceId,
          clientId: deliverable.clientId,
          templateType: "deliverable_long",
        }),
      ]);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error al regenerar con AI");
    } finally {
      setRegenerating(false);
    }
  };

  if (deliverable === undefined) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-secondary" />
        <div className="h-96 animate-pulse rounded-lg border border-border bg-card" />
      </div>
    );
  }

  if (deliverable === null) {
    return (
      <div className="space-y-4">
        <Link
          href="/entregables"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <ArrowLeft size={14} /> Volver a Entregables
        </Link>
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <p className="text-lg font-medium">Entregable no encontrado</p>
        </div>
      </div>
    );
  }

  const isApproved = deliverable.auditStatus === "approved";
  const isDelivered = !!deliverable.deliveredAt;
  const currentContent = tab === "short" ? deliverable.shortContent : deliverable.longContent;

  return (
    <div className="space-y-6">
      <Link
        href={client ? `/clientes/${client._id}` : "/entregables"}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <ArrowLeft size={14} />
        {client ? `Volver a ${client.name}` : "Volver a Entregables"}
      </Link>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileOutput className="text-accent" size={28} />
          <div>
            <h1 className="text-2xl font-bold">
              {deliverable.serviceName}{" "}
              <span className="text-muted-foreground font-normal">
                &mdash; {client?.name ?? "Cliente"}
              </span>
            </h1>
            <p className="text-sm text-muted-foreground">
              {deliverable.month}/{deliverable.year}
              {deliverable.deliveredAt &&
                ` \u00B7 Entregado ${new Date(deliverable.deliveredAt).toLocaleDateString("es-MX")}`}
            </p>
          </div>
        </div>
        <span
          className={cn(
            "rounded-full px-3 py-1 text-sm font-medium",
            AUDIT_COLORS[deliverable.auditStatus]
          )}
        >
          {AUDIT_LABELS[deliverable.auditStatus]}
        </span>
      </div>

      {/* Audit Feedback */}
      {deliverable.auditStatus === "rejected" && deliverable.auditFeedback && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-4">
          <p className="text-sm font-medium text-red-400 mb-1">Feedback de auditoria</p>
          <p className="text-sm text-red-300">{deliverable.auditFeedback}</p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={handleRegenerate}
          disabled={regenerating}
          className="flex items-center gap-2 rounded-md bg-purple-500/20 px-4 py-2 text-sm font-medium text-purple-300 hover:bg-purple-500/30 transition-colors cursor-pointer disabled:opacity-50"
        >
          {regenerating ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Sparkles size={16} />
          )}
          {regenerating ? "Regenerando con AI..." : "Regenerar con AI"}
        </button>

        <button
          onClick={handleGeneratePdf}
          disabled={pdfState.isGenerating || pdfState.isUploading}
          className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors cursor-pointer disabled:opacity-50"
        >
          {pdfState.isGenerating || pdfState.isUploading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Download size={16} />
          )}
          {pdfState.isGenerating
            ? "Generando..."
            : pdfState.isUploading
              ? "Subiendo..."
              : "Generar PDF"}
        </button>

        <button
          onClick={handleDownloadPdf}
          disabled={pdfState.isGenerating}
          className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors cursor-pointer disabled:opacity-50"
        >
          <Download size={16} />
          Descargar PDF
        </button>

        {isApproved && !isDelivered && (
          <button
            onClick={handleDeliver}
            disabled={delivering}
            className="flex items-center gap-2 rounded-md bg-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-400 hover:bg-emerald-500/30 transition-colors cursor-pointer disabled:opacity-50"
          >
            {delivering ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} />
            )}
            {delivering ? "Entregando..." : "Marcar como Entregado"}
          </button>
        )}

        {isDelivered && (
          <span className="flex items-center gap-2 rounded-md bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-400">
            Entregado
          </span>
        )}
      </div>

      {/* PDF error */}
      {pdfState.error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          {pdfState.error}
        </div>
      )}

      {/* Content Tabs */}
      <div className="rounded-lg border border-border bg-card">
        <div className="flex border-b border-border">
          <button
            onClick={() => setTab("short")}
            className={cn(
              "px-4 py-3 text-sm font-medium transition-colors cursor-pointer",
              tab === "short"
                ? "border-b-2 border-accent text-accent"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Resumen (Short)
          </button>
          <button
            onClick={() => setTab("long")}
            className={cn(
              "px-4 py-3 text-sm font-medium transition-colors cursor-pointer",
              tab === "long"
                ? "border-b-2 border-accent text-accent"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Completo (Long)
          </button>
        </div>
        <iframe
          title="Vista previa del entregable"
          srcDoc={currentContent}
          sandbox=""
          className="w-full min-h-[1200px] border-0 bg-white"
        />
      </div>
    </div>
  );
}
