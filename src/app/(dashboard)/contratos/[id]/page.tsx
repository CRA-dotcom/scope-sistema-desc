"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  FileSignature,
  Send,
  CheckCircle2,
  XCircle,
  Edit3,
  Save,
  Download,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { usePdfGenerator } from "@/lib/usePdfGenerator";

const STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  sent: "Enviado",
  signed: "Firmado",
  cancelled: "Cancelado",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted-foreground/20 text-muted-foreground",
  sent: "bg-blue-500/20 text-blue-400",
  signed: "bg-emerald-500/20 text-emerald-400",
  cancelled: "bg-red-500/20 text-red-400",
};

export default function ContractDetailPage() {
  const params = useParams();
  const id = params.id as Id<"contracts">;

  const contract = useQuery(
    api.functions.contracts.queries.getById,
    { id }
  );
  const client = useQuery(
    api.functions.clients.queries.getById,
    contract ? { id: contract.clientId } : "skip"
  );

  const updateContent = useMutation(
    api.functions.contracts.mutations.updateContent
  );
  const updateStatus = useMutation(
    api.functions.contracts.mutations.updateStatus
  );
  const setPdfStorageId = useMutation(
    api.functions.contracts.mutations.setPdfStorageId
  );
  // #23 — issuing company override on contract
  const updateIssuingCompany = useMutation(
    api.functions.contracts.mutations.updateIssuingCompany
  );
  const issuingCompanies = useQuery(
    api.functions.issuingCompanies.queries.list,
    {}
  );
  const [savingIssuer, setSavingIssuer] = useState(false);
  const [issuingCompanyId, setIssuingCompanyId] = useState<string>("");
  useEffect(() => {
    if (contract) {
      setIssuingCompanyId(contract.issuingCompanyId ?? "");
    }
  }, [contract?.issuingCompanyId]);

  const orgBranding = useQuery(api.functions.orgBranding.queries.getByOrgId);

  const { generate: generatePdf, download: downloadPdf, state: pdfState } =
    usePdfGenerator();

  const [editing, setEditing] = useState(false);
  const [localContent, setLocalContent] = useState("");
  const [saving, setSaving] = useState(false);

  const startEditing = () => {
    if (contract) {
      setLocalContent(contract.content);
      setEditing(true);
    }
  };

  const handleSave = async () => {
    if (!contract) return;
    setSaving(true);
    try {
      await updateContent({ id: contract._id, content: localContent });
      setEditing(false);
    } catch (err) {
      console.error("Error saving content:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (
    newStatus: "sent" | "signed" | "cancelled"
  ) => {
    if (!contract) return;
    setSaving(true);
    try {
      await updateStatus({ id: contract._id, status: newStatus });
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
    if (!contract) return;
    try {
      const filename = `contrato-${contract.serviceName.toLowerCase().replace(/\s+/g, "-")}-${client?.name?.toLowerCase().replace(/\s+/g, "-") ?? "cliente"}.pdf`;
      const result = await generatePdf(contract.content, branding, filename);
      await setPdfStorageId({
        id: contract._id,
        pdfStorageId: result.storageId,
      });
    } catch (err) {
      console.error("Error generating PDF:", err);
    }
  };

  const handleDownloadPdf = async () => {
    if (!contract) return;
    try {
      const filename = `contrato-${contract.serviceName.toLowerCase().replace(/\s+/g, "-")}-${client?.name?.toLowerCase().replace(/\s+/g, "-") ?? "cliente"}.pdf`;
      await downloadPdf(contract.content, branding, filename);
    } catch (err) {
      console.error("Error downloading PDF:", err);
    }
  };

  if (contract === undefined) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-secondary" />
        <div className="h-96 animate-pulse rounded-lg border border-border bg-card" />
      </div>
    );
  }

  if (contract === null) {
    return (
      <div className="space-y-4">
        <Link
          href="/contratos"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <ArrowLeft size={14} /> Volver a Contratos
        </Link>
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <p className="text-lg font-medium">Contrato no encontrado</p>
        </div>
      </div>
    );
  }

  const isDraft = contract.status === "draft";
  const isSent = contract.status === "sent";

  return (
    <div className="space-y-6">
      <Link
        href="/contratos"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <ArrowLeft size={14} />
        Volver a Contratos
      </Link>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileSignature className="text-accent" size={28} />
          <div>
            <h1 className="text-2xl font-bold">
              {contract.serviceName}{" "}
              <span className="text-muted-foreground font-normal">
                &mdash; {client?.name ?? "Cliente"}
              </span>
            </h1>
            <p className="text-sm text-muted-foreground">
              Creado{" "}
              {new Date(contract.createdAt).toLocaleDateString("es-MX")}
              {contract.signedAt &&
                ` \u00B7 Firmado ${new Date(contract.signedAt).toLocaleDateString("es-MX")}`}
              {contract.pdfStorageId && " \u00B7 PDF generado"}
            </p>
          </div>
        </div>
        <span
          className={cn(
            "rounded-full px-3 py-1 text-sm font-medium",
            STATUS_COLORS[contract.status]
          )}
        >
          {STATUS_LABELS[contract.status]}
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

            {contract.pdfStorageId && (
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

        {isDraft && !editing && (
          <button
            onClick={() => handleStatusChange("sent")}
            disabled={saving}
            className="flex items-center gap-2 rounded-md bg-blue-500/20 px-4 py-2 text-sm font-medium text-blue-400 hover:bg-blue-500/30 transition-colors cursor-pointer disabled:opacity-50"
          >
            <Send size={16} />
            Enviar
          </button>
        )}

        {isSent && !editing && (
          <>
            <button
              onClick={() => handleStatusChange("signed")}
              disabled={saving}
              className="flex items-center gap-2 rounded-md bg-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-400 hover:bg-emerald-500/30 transition-colors cursor-pointer disabled:opacity-50"
            >
              <CheckCircle2 size={16} />
              Firmar
            </button>
            <button
              onClick={() => handleStatusChange("cancelled")}
              disabled={saving}
              className="flex items-center gap-2 rounded-md bg-red-500/20 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/30 transition-colors cursor-pointer disabled:opacity-50"
            >
              <XCircle size={16} />
              Cancelar
            </button>
          </>
        )}
      </div>

      {/* PDF error */}
      {pdfState.error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          {pdfState.error}
        </div>
      )}

      {/* #23 — Empresa emitente selector (draft only) */}
      {isDraft && issuingCompanies && issuingCompanies.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="mb-2 text-sm font-medium text-foreground">
            Empresa emitente
          </p>
          <div className="flex items-center gap-3">
            <select
              value={issuingCompanyId}
              onChange={async (e) => {
                const newVal = e.target.value;
                setIssuingCompanyId(newVal);
                setSavingIssuer(true);
                try {
                  await updateIssuingCompany({
                    id: contract._id,
                    issuingCompanyId: newVal
                      ? (newVal as Id<"issuingCompanies">)
                      : null,
                  });
                } catch (err) {
                  setIssuingCompanyId(contract.issuingCompanyId ?? "");
                  alert(`Error al actualizar empresa: ${err instanceof Error ? err.message : "desconocido"}`);
                } finally {
                  setSavingIssuer(false);
                }
              }}
              className="flex-1 rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="">Auto-resolver por servicio...</option>
              {issuingCompanies.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                  {c.isDefault ? " (predeterminada)" : ""}
                </option>
              ))}
            </select>
            {savingIssuer && (
              <Loader2 size={14} className="animate-spin text-muted-foreground" />
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Opcional. Si no seleccionas, se resuelve automáticamente por mapa
            de servicio.
          </p>
        </div>
      )}

      {/* Content */}
      <div className="rounded-lg border border-border bg-card">
        {editing ? (
          <div className="p-4">
            <label className="mb-2 block text-sm font-medium text-muted-foreground">
              Contenido HTML del contrato
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
            dangerouslySetInnerHTML={{ __html: contract.content }}
          />
        )}
      </div>
    </div>
  );
}
