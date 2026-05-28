"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { Upload, AlertCircle, CheckCircle2 } from "lucide-react";
import { api } from "../../../../../../../convex/_generated/api";
import { Id } from "../../../../../../../convex/_generated/dataModel";

type PeriodType = "monthly" | "quarterly" | "annual";

const PERIOD_HINTS: Record<PeriodType, string> = {
  monthly: "Formato: YYYY-MM (ej. 2026-01)",
  quarterly: "Formato: YYYY-Qn (ej. 2026-Q1)",
  annual: "Formato: YYYY (ej. 2026)",
};

const PERIOD_PLACEHOLDERS: Record<PeriodType, string> = {
  monthly: "2026-01",
  quarterly: "2026-Q1",
  annual: "2026",
};

const ACCEPT_EXCEL = ".xlsx,.xls";

export function UploadForm({ clientId }: { clientId: Id<"clients"> }) {
  const upload = useAction(api.functions.clientFinancialData.actions.upload);
  const [file, setFile] = useState<File | null>(null);
  const [period, setPeriod] = useState("");
  const [periodType, setPeriodType] = useState<PeriodType>("monthly");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!file) {
      setError("Selecciona un archivo Excel (.xlsx o .xls).");
      return;
    }
    if (!period.trim()) {
      setError("Captura el periodo del estado financiero.");
      return;
    }

    setSubmitting(true);
    try {
      const buffer = await file.arrayBuffer();
      await upload({
        clientId,
        period: period.trim(),
        periodType,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        fileBuffer: buffer,
      });
      setSuccess(
        `Archivo subido. La extracción AI se ejecuta en segundo plano; refresca en unos segundos.`
      );
      setFile(null);
      setPeriod("");
      // Reset native file input via key bump on the form
      (document.getElementById("finanzas-file-input") as HTMLInputElement | null)?.value &&
        ((document.getElementById("finanzas-file-input") as HTMLInputElement).value = "");
    } catch (err) {
      setError((err as Error).message ?? "Error al subir el archivo.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-border bg-card p-6 space-y-4"
    >
      <div className="flex items-center gap-2">
        <Upload size={18} className="text-muted-foreground" />
        <h2 className="text-lg font-medium">Subir nuevo estado financiero</h2>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="md:col-span-1">
          <label className="mb-1 block text-sm font-medium">Tipo de periodo</label>
          <select
            value={periodType}
            onChange={(e) => setPeriodType(e.target.value as PeriodType)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="monthly">Mensual</option>
            <option value="quarterly">Trimestral</option>
            <option value="annual">Anual</option>
          </select>
        </div>

        <div className="md:col-span-1">
          <label className="mb-1 block text-sm font-medium">Periodo</label>
          <input
            type="text"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            placeholder={PERIOD_PLACEHOLDERS[periodType]}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {PERIOD_HINTS[periodType]}
          </p>
        </div>

        <div className="md:col-span-1">
          <label className="mb-1 block text-sm font-medium">Archivo Excel</label>
          <input
            id="finanzas-file-input"
            type="file"
            accept={ACCEPT_EXCEL}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-sm"
          />
          {file && (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {file.name} · {(file.size / 1024).toFixed(1)} KB
            </p>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 cursor-pointer"
      >
        {submitting ? "Subiendo..." : "Subir y extraer"}
      </button>
    </form>
  );
}
