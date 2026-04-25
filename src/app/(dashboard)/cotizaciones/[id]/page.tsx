"use client";

import { useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import DOMPurify from "isomorphic-dompurify";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  FileText,
  Send,
  CheckCircle2,
  XCircle,
  Edit3,
  Save,
  Download,
  Loader2,
  FileSignature,
  Plus,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { usePdfGenerator } from "@/lib/usePdfGenerator";
import { SendQuotationDialog } from "@/components/cotizaciones/SendQuotationDialog";
import { SendStatusPanel } from "@/components/cotizaciones/SendStatusPanel";

const STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  sent: "Enviado",
  approved: "Aprobado",
  rejected: "Rechazado",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted-foreground/20 text-muted-foreground",
  sent: "bg-blue-500/20 text-blue-400",
  approved: "bg-emerald-500/20 text-emerald-400",
  rejected: "bg-red-500/20 text-red-400",
};

export default function QuotationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as Id<"quotations">;

  const quotation = useQuery(
    api.functions.quotations.queries.getById,
    { id }
  );
  const client = useQuery(
    api.functions.clients.queries.getById,
    quotation ? { id: quotation.clientId } : "skip"
  );
  const existingContract = useQuery(
    api.functions.contracts.queries.getByQuotation,
    { quotationId: id }
  );

  const updateContent = useMutation(
    api.functions.quotations.mutations.updateContent
  );
  const updateStatus = useMutation(
    api.functions.quotations.mutations.updateStatus
  );
  const setPdfStorageId = useMutation(
    api.functions.quotations.mutations.setPdfStorageId
  );
  const generateContract = useAction(
    api.functions.contracts.actions.generateContract
  );
  const orgBranding = useQuery(api.functions.orgBranding.queries.getByOrgId);
  const [isGeneratingContract, setIsGeneratingContract] = useState(false);

  const handleGenerateContract = async () => {
    try {
      setIsGeneratingContract(true);
      const contractId = await generateContract({ quotationId: id });
      router.push(`/contratos/${contractId}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error al generar contrato");
      setIsGeneratingContract(false);
    }
  };

  const { generate: generatePdf, download: downloadPdf, state: pdfState } =
    usePdfGenerator();

  const [editing, setEditing] = useState(false);
  const [localContent, setLocalContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [sendDialogOpen, setSendDialogOpen] = useState(false);

  const startEditing = () => {
    if (quotation) {
      setLocalContent(quotation.content);
      setEditing(true);
    }
  };

  const handleSave = async () => {
    if (!quotation) return;
    setSaving(true);
    try {
      await updateContent({ id: quotation._id, content: localContent });
      setEditing(false);
    } catch (err) {
      console.error("Error saving content:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (
    newStatus: "sent" | "approved" | "rejected"
  ) => {
    if (!quotation) return;
    setSaving(true);
    try {
      await updateStatus({ id: quotation._id, status: newStatus });
    } catch (err) {
      console.error("Error updating status:", err);
    } finally {
      setSaving(false);
    }
  };

  const branding = {
    companyName: orgBranding?.companyName ?? client?.name ?? "Empresa",
    primaryColor: orgBranding?.primaryColor ?? "#1a1a2e",
    secondaryColor: orgBranding?.secondaryColor ?? "#6c63ff",
    fontFamily: orgBranding?.fontFamily ?? "Arial, sans-serif",
  };

  const handleGeneratePdf = async () => {
    if (!quotation) return;
    try {
      const filename = `cotizacion-${quotation.serviceName.toLowerCase().replace(/\s+/g, "-")}-${client?.name?.toLowerCase().replace(/\s+/g, "-") ?? "cliente"}.pdf`;
      const result = await generatePdf(quotation.content, branding, filename);
      await setPdfStorageId({
        id: quotation._id,
        pdfStorageId: result.storageId,
      });
    } catch (err) {
      console.error("Error generating PDF:", err);
    }
  };

  const handleDownloadPdf = async () => {
    if (!quotation) return;
    try {
      const filename = `cotizacion-${quotation.serviceName.toLowerCase().replace(/\s+/g, "-")}-${client?.name?.toLowerCase().replace(/\s+/g, "-") ?? "cliente"}.pdf`;
      await downloadPdf(quotation.content, branding, filename);
    } catch (err) {
      console.error("Error downloading PDF:", err);
    }
  };

  if (quotation === undefined) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-secondary" />
        <div className="h-96 animate-pulse rounded-lg border border-border bg-card" />
      </div>
    );
  }

  if (quotation === null) {
    return (
      <div className="space-y-4">
        <Link
          href="/cotizaciones"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <ArrowLeft size={14} /> Volver a Cotizaciones
        </Link>
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <p className="text-lg font-medium">Cotizaci&oacute;n no encontrada</p>
        </div>
      </div>
    );
  }

  const isDraft = quotation.status === "draft";
  const isSent = quotation.status === "sent";
  const isApproved = quotation.status === "approved";

  return (
    <div className="space-y-6">
      <Link
        href="/cotizaciones"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <ArrowLeft size={14} />
        Volver a Cotizaciones
      </Link>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText className="text-accent" size={28} />
          <div>
            <h1 className="text-2xl font-bold">
              {quotation.serviceName}{" "}
              <span className="text-muted-foreground font-normal">
                &mdash; {client?.name ?? "Cliente"}
              </span>
            </h1>
            <p className="text-sm text-muted-foreground">
              Creado{" "}
              {new Date(quotation.createdAt).toLocaleDateString("es-MX")}
              {quotation.pdfStorageId && " \u00B7 PDF generado"}
            </p>
          </div>
        </div>
        <span
          className={cn(
            "rounded-full px-3 py-1 text-sm font-medium",
            STATUS_COLORS[quotation.status]
          )}
        >
          {STATUS_LABELS[quotation.status]}
        </span>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center gap-3">
        {isDraft && !editing && (
          <button
            onClick={startEditing}
            className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors cursor-pointer"
          >
            <Edit3 size={16} />
            Editar Contenido
          </button>
        )}

        {editing && (
          <>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-primary hover:bg-accent/90 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Save size={16} />
              {saving ? "Guardando..." : "Guardar Cambios"}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-secondary transition-colors cursor-pointer"
            >
              Cancelar
            </button>
          </>
        )}

        {!editing && (
          <>
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

            {quotation.pdfStorageId && (
              <button
                onClick={handleDownloadPdf}
                disabled={pdfState.isGenerating}
                className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors cursor-pointer disabled:opacity-50"
              >
                <Download size={16} />
                Descargar PDF
              </button>
            )}
          </>
        )}

        {(isDraft || isSent) && !editing && (
          <button
            onClick={() => setSendDialogOpen(true)}
            disabled={!quotation.pdfStorageId || !client?.contactEmail}
            title={
              !quotation.pdfStorageId
                ? "Genera el PDF antes de enviar"
                : !client?.contactEmail
                  ? "Agrega email de contacto en el cliente"
                  : undefined
            }
            className="flex items-center gap-2 rounded-md bg-blue-500/20 px-4 py-2 text-sm font-medium text-blue-400 hover:bg-blue-500/30 transition-colors cursor-pointer disabled:opacity-50"
          >
            <Send size={16} />
            {isSent ? "Reenviar" : "Enviar por email"}
          </button>
        )}

        {isSent && !editing && (
          <details className="relative">
            <summary className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-secondary transition-colors list-none">
              <span className="text-lg leading-none">⋯</span>
              Acciones admin
            </summary>
            <div className="absolute right-0 top-full z-10 mt-1 w-64 rounded-md border border-border bg-card p-2 shadow-lg">
              <button
                onClick={() => handleStatusChange("approved")}
                disabled={saving}
                className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-secondary transition-colors cursor-pointer disabled:opacity-50"
              >
                Marcar como aprobada (sin email)
              </button>
              <button
                onClick={() => handleStatusChange("rejected")}
                disabled={saving}
                className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-secondary transition-colors cursor-pointer disabled:opacity-50"
              >
                Marcar como rechazada (sin email)
              </button>
            </div>
          </details>
        )}

        {isApproved && !editing && existingContract === null && (
          <button
            onClick={handleGenerateContract}
            disabled={isGeneratingContract}
            className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90 transition-colors cursor-pointer disabled:opacity-50"
          >
            {isGeneratingContract ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Plus size={16} />
            )}
            {isGeneratingContract ? "Generando con AI (20-60s)..." : "Generar Contrato"}
          </button>
        )}

        {isApproved && !editing && existingContract && (
          <Link
            href={`/contratos/${existingContract._id}`}
            className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors cursor-pointer"
          >
            <FileSignature size={16} />
            Ver Contrato
            <ArrowRight size={14} />
          </Link>
        )}
      </div>

      {/* PDF error */}
      {pdfState.error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          {pdfState.error}
        </div>
      )}

      <SendStatusPanel quotation={{
        _id: quotation._id,
        status: quotation.status,
        sendCount: quotation.sendCount,
        lastSentAt: quotation.lastSentAt,
        tokenExpiresAt: quotation.tokenExpiresAt,
        respondedAt: quotation.respondedAt,
        declineReason: quotation.declineReason,
      }} />

      {/* Content */}
      <div className="rounded-lg border border-border bg-card">
        {editing ? (
          <div className="p-4">
            <label className="mb-2 block text-sm font-medium text-muted-foreground">
              Contenido HTML de la cotizaci&oacute;n
            </label>
            <textarea
              value={localContent}
              onChange={(e) => setLocalContent(e.target.value)}
              rows={20}
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent resize-y"
            />
          </div>
        ) : (
          <div
            className="p-6"
            dangerouslySetInnerHTML={{
              __html: DOMPurify.sanitize(quotation.content, {
                USE_PROFILES: { html: true },
              }),
            }}
          />
        )}
      </div>

      {sendDialogOpen && (
        <SendQuotationDialog
          quotationId={quotation._id}
          onClose={() => setSendDialogOpen(false)}
        />
      )}
    </div>
  );
}
