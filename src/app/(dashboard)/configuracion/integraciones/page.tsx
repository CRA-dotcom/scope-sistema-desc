"use client";

/**
 * D2 §4.4 — `/configuracion/integraciones`
 *
 * Provider hub: Resend (link to existing detail page) + Firmame (form for
 * credentials — backlog post-beta) + Railway (read-only env info).
 *
 * Defensive: only ever displays `apiKeyMasked`. The query `listForOrg`
 * strips secret-bearing fields server-side but we still rely on the masked
 * field exclusively in the UI.
 *
 * Auth gate: `org:admin` only.
 */

import Link from "next/link";
import {
  Plug,
  ChevronLeft,
  Mail,
  PenTool,
  HardDrive,
  ArrowRight,
  Loader2,
  X,
} from "lucide-react";
import { useOrganization } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../../../convex/_generated/api";

type ChipColor = "green" | "yellow" | "red" | "gray";

function StatusChip({
  label,
  color,
}: {
  label: string;
  color: ChipColor;
}) {
  const cls =
    color === "green"
      ? "bg-green-500/15 text-green-400 border-green-500/30"
      : color === "yellow"
        ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/30"
        : color === "red"
          ? "bg-red-500/15 text-red-400 border-red-500/30"
          : "bg-secondary text-muted-foreground border-border";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          color === "green"
            ? "bg-green-400"
            : color === "yellow"
              ? "bg-yellow-400"
              : color === "red"
                ? "bg-red-400"
                : "bg-muted-foreground"
        }`}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

export default function IntegracionesPage() {
  const { membership, isLoaded } = useOrganization();
  const router = useRouter();
  const isAdmin = membership?.role === "org:admin";

  useEffect(() => {
    if (isLoaded && !isAdmin) {
      router.replace("/configuracion");
    }
  }, [isLoaded, isAdmin, router]);

  const integrations = useQuery(
    api.functions.orgIntegrations.queries.listForOrg,
    isLoaded && isAdmin ? {} : "skip"
  );
  const railwayInfo = useQuery(
    api.functions.orgIntegrations.queries.getRailwayInfo,
    isLoaded && isAdmin ? {} : "skip"
  );

  const [firmameOpen, setFirmameOpen] = useState(false);

  if (!isLoaded || !isAdmin) return null;

  const resend = integrations?.find((i) => i.provider === "resend");
  const firmame = integrations?.find(
    (i) => i.provider === "other" && i.providerLabel === "firmame"
  );

  const resendChip = !resend
    ? { label: "No configurado", color: "gray" as ChipColor }
    : resend.status === "active"
      ? { label: "Conectado", color: "green" as ChipColor }
      : resend.status === "error"
        ? { label: "Error", color: "red" as ChipColor }
        : { label: "Pendiente", color: "yellow" as ChipColor };

  const firmameChip = !firmame
    ? { label: "No configurado", color: "gray" as ChipColor }
    : {
        label: "Pendiente verificación",
        color: "yellow" as ChipColor,
      };

  const railwayChip = !railwayInfo
    ? { label: "Cargando", color: "gray" as ChipColor }
    : railwayInfo.hasCredentials
      ? { label: "Conectado (global)", color: "green" as ChipColor }
      : { label: "Sin credenciales", color: "red" as ChipColor };

  return (
    <div className="space-y-6">
      <Link
        href="/configuracion"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <ChevronLeft size={16} aria-hidden="true" /> Configuración
      </Link>

      <div className="flex items-center gap-3">
        <Plug className="text-accent" size={28} aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-bold">Integraciones</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            API keys y credenciales de proveedores externos.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {/* Resend */}
        <article
          className="rounded-lg border border-border bg-card p-5"
          aria-labelledby="integration-resend-heading"
          data-testid="integration-card-resend"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10">
                <Mail className="text-accent" size={20} aria-hidden="true" />
              </div>
              <div>
                <h2
                  id="integration-resend-heading"
                  className="font-medium flex items-center gap-2"
                >
                  Resend <span className="text-xs text-muted-foreground">(email)</span>
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Conecta tu cuenta para enviar emails desde tu propio dominio.
                </p>
                {resend?.apiKeyMasked && (
                  <p className="mt-1 text-xs font-mono text-muted-foreground">
                    {resend.apiKeyMasked}
                    {resend.fromEmail ? ` · ${resend.fromEmail}` : ""}
                  </p>
                )}
              </div>
            </div>
            <StatusChip label={resendChip.label} color={resendChip.color} />
          </div>
          <div className="mt-3 flex justify-end">
            <Link
              href="/configuracion/integraciones/resend"
              className="inline-flex items-center gap-1 text-sm text-accent hover:text-accent/80"
            >
              Editar configuración{" "}
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
        </article>

        {/* Firmame */}
        <article
          className="rounded-lg border border-border bg-card p-5"
          aria-labelledby="integration-firmame-heading"
          data-testid="integration-card-firmame"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10">
                <PenTool
                  className="text-accent"
                  size={20}
                  aria-hidden="true"
                />
              </div>
              <div>
                <h2
                  id="integration-firmame-heading"
                  className="font-medium flex items-center gap-2"
                >
                  Firmame{" "}
                  <span className="text-xs text-muted-foreground">
                    (firma digital)
                  </span>
                </h2>
                <p className="mt-0.5 text-xs text-yellow-400">
                  Backlog post-beta — credenciales se guardan, la integración
                  real se conecta post-beta.
                </p>
                {firmame?.apiKeyMasked && (
                  <p className="mt-1 text-xs font-mono text-muted-foreground">
                    {firmame.apiKeyMasked}
                    {firmame.sandboxMode ? " · sandbox" : " · producción"}
                  </p>
                )}
              </div>
            </div>
            <StatusChip
              label={firmameChip.label}
              color={firmameChip.color}
            />
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => setFirmameOpen(true)}
              data-testid="firmame-configure-btn"
              className="inline-flex items-center gap-1 text-sm text-accent hover:text-accent/80"
            >
              {firmame ? "Editar credenciales" : "Configurar"}{" "}
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          </div>
        </article>

        {/* Railway */}
        <article
          className="rounded-lg border border-border bg-card p-5"
          aria-labelledby="integration-railway-heading"
          data-testid="integration-card-railway"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10">
                <HardDrive
                  className="text-accent"
                  size={20}
                  aria-hidden="true"
                />
              </div>
              <div>
                <h2
                  id="integration-railway-heading"
                  className="font-medium flex items-center gap-2"
                >
                  Railway{" "}
                  <span className="text-xs text-muted-foreground">
                    (blob storage)
                  </span>
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Bucket compartido para almacenar PDFs, facturas y entregables.
                </p>
                {railwayInfo?.bucketName && (
                  <p className="mt-1 text-xs font-mono text-muted-foreground">
                    {railwayInfo.bucketName}
                    {railwayInfo.endpoint ? ` @ ${railwayInfo.endpoint}` : ""}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground/70">
                  Read-only · override por org disponible en V2.
                </p>
              </div>
            </div>
            <StatusChip label={railwayChip.label} color={railwayChip.color} />
          </div>
        </article>
      </div>

      {firmameOpen && (
        <FirmameConfigDialog
          onClose={() => setFirmameOpen(false)}
          initialSandbox={firmame?.sandboxMode ?? true}
          hasExisting={Boolean(firmame)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Firmame config dialog                                              */
/* ------------------------------------------------------------------ */

function FirmameConfigDialog({
  onClose,
  initialSandbox,
  hasExisting,
}: {
  onClose: () => void;
  initialSandbox: boolean;
  hasExisting: boolean;
}) {
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [sandbox, setSandbox] = useState(initialSandbox);
  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const upsert = useMutation(
    api.functions.orgIntegrations.mutations.upsertFirmameConfig
  );
  const testConnection = useAction(
    api.functions.orgIntegrations.actions.testFirmameConnection
  );

  const handleClose = useCallback(() => {
    if (submitting) return;
    onClose();
  }, [onClose, submitting]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setSuccess(false);
    if (apiKey.trim().length < 8) {
      setError("API key inválido (muy corto).");
      return;
    }
    setSubmitting(true);
    try {
      await upsert({
        apiKey: apiKey.trim(),
        apiSecret: apiSecret.trim() || undefined,
        sandboxMode: sandbox,
      });
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        onClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleTest = async () => {
    setError(null);
    setInfo(null);
    setTesting(true);
    try {
      const res = await testConnection({});
      if (res.ok) {
        setInfo(res.reason);
      } else {
        setInfo(res.reason);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error en la prueba.");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="firmame-dialog-heading"
      onClick={handleClose}
    >
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" />
      <div
        className="relative w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2
            id="firmame-dialog-heading"
            className="text-lg font-semibold flex items-center gap-2"
          >
            <PenTool size={18} className="text-accent" aria-hidden="true" />
            Firmame
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Cerrar"
            className="rounded p-1 hover:bg-secondary"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <p className="mt-2 rounded border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-400">
          Backlog post-beta — credenciales se guardan, la integración real se
          conecta post-beta.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label
              htmlFor="firmame-apikey"
              className="mb-1.5 block text-sm font-medium text-muted-foreground"
            >
              API Key {hasExisting && <span className="text-xs">(reescribe el existente)</span>}
            </label>
            <input
              id="firmame-apikey"
              type="password"
              required
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="fm_secret_…"
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm font-mono focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div>
            <label
              htmlFor="firmame-apisecret"
              className="mb-1.5 block text-sm font-medium text-muted-foreground"
            >
              API Secret <span className="text-xs">(opcional)</span>
            </label>
            <input
              id="firmame-apisecret"
              type="password"
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm font-mono focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={sandbox}
              onChange={(e) => setSandbox(e.target.checked)}
              className="h-4 w-4 rounded border-border bg-secondary"
            />
            Sandbox mode
          </label>

          {error && (
            <div
              className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400"
              role="alert"
            >
              {error}
            </div>
          )}
          {info && (
            <div
              className="rounded border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-400"
              role="status"
            >
              {info}
            </div>
          )}
          {success && (
            <div
              className="rounded border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs text-green-400"
              role="status"
            >
              Credenciales guardadas.
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleTest}
              disabled={testing || submitting}
              data-testid="firmame-test-btn"
              className="inline-flex items-center gap-2 rounded-md border border-border bg-secondary px-4 py-2 text-sm hover:bg-secondary/80 disabled:opacity-50"
            >
              {testing && (
                <Loader2
                  size={14}
                  className="animate-spin"
                  aria-hidden="true"
                />
              )}
              Probar conexión
            </button>
            <button
              type="submit"
              disabled={submitting || testing}
              data-testid="firmame-save-btn"
              className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
            >
              {submitting && (
                <Loader2
                  size={14}
                  className="animate-spin"
                  aria-hidden="true"
                />
              )}
              Guardar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
