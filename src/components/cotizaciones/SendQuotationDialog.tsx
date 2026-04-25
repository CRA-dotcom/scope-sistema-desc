"use client";
import { useState, useEffect } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Send, Loader2, CheckCircle2, Copy, AlertTriangle, X } from "lucide-react";
import Link from "next/link";

export function SendQuotationDialog({
  quotationId,
  onClose,
}: {
  quotationId: Id<"quotations">;
  onClose: () => void;
}) {
  const preview = useQuery(
    api.functions.quotations.queries.getSendPreviewContext,
    { quotationId }
  );
  const sendAction = useAction(api.functions.quotations.actions.sendQuotation);

  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    plaintextToken: string;
    appUrl: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (preview) {
      setTo(preview.client.contactEmail ?? "");
      setSubject(preview.defaultSubject);
    }
  }, [preview]);

  const toValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to);
  const canSend =
    preview &&
    preview.hasPdf &&
    !preview.issuingCompanyError &&
    toValid &&
    subject.trim().length > 0 &&
    !sending;

  async function onSend() {
    setSending(true);
    setError(null);
    try {
      const r = await sendAction({
        quotationId,
        toOverride: to,
        subjectOverride: subject,
      });
      setSuccess({ plaintextToken: r.plaintextToken, appUrl: r.appUrl });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-lg border border-border bg-card p-6 shadow-lg"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            {preview?.sendCount && preview.sendCount > 0
              ? `Reenviar cotización (envío #${preview.sendCount + 1})`
              : "Enviar cotización por email"}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>

        {preview === undefined && <p className="text-sm text-muted-foreground">Cargando...</p>}

        {preview && success === null && (
          <div className="space-y-4">
            {preview.sendCount && preview.sendCount > 0 && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-400">
                <AlertTriangle size={14} className="mr-1 inline" />
                Los links de accept/decline anteriores serán invalidados.
              </div>
            )}

            {preview.issuingCompanyError && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                {preview.issuingCompanyError}{" "}
                <Link
                  href="/configuracion/empresas-emitentes"
                  className="underline"
                >
                  Configurar emitente
                </Link>
              </div>
            )}

            {!preview.hasPdf && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                Genera el PDF de la cotización antes de enviar.
              </div>
            )}

            <div>
              <label className="mb-1 block text-sm font-medium">Destinatario</label>
              <input
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              {!toValid && to.length > 0 && (
                <p className="mt-1 text-xs text-destructive">Email inválido</p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Asunto</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <div className="rounded-md border border-border bg-secondary/30 p-3 text-sm">
              <p className="text-muted-foreground">
                <strong>Adjunto:</strong> {preview.pdfFilename}
              </p>
              <p className="mt-1 text-muted-foreground">
                <strong>Emitente:</strong>{" "}
                {preview.issuingCompany?.name ?? "— (sin configurar)"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Los links expirarán en {preview.tokenTtlDays} días.
              </p>
            </div>

            {error && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={onClose}
                className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-secondary"
              >
                Cancelar
              </button>
              <button
                onClick={onSend}
                disabled={!canSend}
                className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
              >
                {sending ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Enviando...
                  </>
                ) : (
                  <>
                    <Send size={14} /> Enviar
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {success && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 size={20} />
              <p className="font-medium">Cotización enviada</p>
            </div>
            <p className="text-sm text-muted-foreground">Destinatario: {to}</p>
            <div className="rounded-md border border-border bg-secondary/50 p-3">
              <p className="mb-2 text-xs text-muted-foreground">Link público (para copiar si el cliente no recibe el email):</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate text-xs">
                  {success.appUrl}/q/cotizacion/{success.plaintextToken}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(
                      `${success.appUrl}/q/cotizacion/${success.plaintextToken}`
                    );
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-secondary"
                >
                  <Copy size={12} /> {copied ? "Copiado" : "Copiar"}
                </button>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button
                onClick={onClose}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
