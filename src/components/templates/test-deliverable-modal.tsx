"use client";

// TODO: component tests deferred — UI behavior verified manually in QA
// (plan F Task 8). Re-enable once React Testing Library is configured.

import { useState } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { X, Loader2, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

type PreviewOutput = {
  html: string;
  aiLog: { inputTokens: number; outputTokens: number; costUsd: number }[];
  tokensUsed: number;
  costUsd: number;
  elapsedMs: number;
  unfilledKeys: string[];
};

type Props = {
  templateId: Id<"deliverableTemplates">;
  onClose: () => void;
};

export function TestDeliverableModal({ templateId, onClose }: Props) {
  const template = useQuery(api.functions.deliverableTemplates.queries.getById, {
    id: templateId,
  });
  const testables = useQuery(api.functions.questionnaires.queries.listTestable, {});
  const previewAction = useAction(api.functions.deliverables.actions.previewDeliverable);

  const [questionnaireId, setQuestionnaireId] =
    useState<Id<"questionnaireResponses"> | null>(null);
  const [output, setOutput] = useState<PreviewOutput | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleGenerate() {
    if (!questionnaireId) return;
    setGenerating(true);
    setError(null);
    try {
      const result = await previewAction({ templateId, questionnaireId });
      setOutput(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al generar");
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopy() {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output.html);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("No se pudo copiar al portapapeles.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-full max-h-[90vh] w-full max-w-4xl flex-col rounded-lg border border-border bg-card shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-4">
          <div>
            <h3 className="text-lg font-semibold">Probar con datos reales</h3>
            {template && (
              <p className="text-xs text-muted-foreground">{template.name}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 hover:bg-secondary cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {/* Questionnaire picker */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Cuestionario de origen</label>
            <select
              value={questionnaireId ?? ""}
              onChange={(e) =>
                setQuestionnaireId(
                  e.target.value
                    ? (e.target.value as Id<"questionnaireResponses">)
                    : null
                )
              }
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:border-accent focus:outline-none cursor-pointer"
            >
              <option value="">— Selecciona un cuestionario —</option>
              {testables?.map((q) => (
                <option key={q._id} value={q._id}>
                  {q.clientName} — {q.projectionYear ?? "—"} ({q.status},{" "}
                  {q.responseCount} respuestas)
                </option>
              ))}
            </select>
            {testables && testables.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No hay cuestionarios completos o en progreso para probar.
              </p>
            )}
          </div>

          <button
            onClick={handleGenerate}
            disabled={!questionnaireId || generating}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-primary hover:bg-accent/90 disabled:opacity-50 cursor-pointer"
          >
            {generating ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Generando…
              </>
            ) : output ? (
              "Regenerar"
            ) : (
              "Generar prueba"
            )}
          </button>

          {error && (
            <div className="rounded-md border border-red-400/40 bg-red-400/5 p-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Output preview */}
          {output && (
            <div className="space-y-2">
              <iframe
                title="Preview del entregable"
                srcDoc={output.html}
                sandbox="allow-same-origin"
                className="h-[55vh] w-full rounded-md border border-border bg-white"
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  Tokens: {output.tokensUsed.toLocaleString("es-MX")} · ~$
                  {output.costUsd.toFixed(4)} USD · {output.elapsedMs}ms
                </span>
                <button
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:bg-secondary cursor-pointer"
                >
                  <Copy size={12} />
                  {copied ? "Copiado" : "Copiar HTML"}
                </button>
              </div>
              {output.unfilledKeys.length > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-600">
                  ⚠ {output.unfilledKeys.length} variable(s) sin llenar:{" "}
                  <code>{output.unfilledKeys.join(", ")}</code>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border p-4">
          <button
            onClick={onClose}
            className={cn(
              "rounded-md border border-border px-3 py-1.5 text-xs",
              "hover:bg-secondary cursor-pointer"
            )}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
