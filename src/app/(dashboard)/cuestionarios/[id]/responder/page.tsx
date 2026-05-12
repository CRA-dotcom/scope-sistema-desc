"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import { Id } from "../../../../../../convex/_generated/dataModel";
import { useParams } from "next/navigation";
import { ClipboardList, Save, Send, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { QuestionField } from "@/components/questionnaires/QuestionField";
import { SectionNav, type SectionNavItem } from "@/components/questionnaires/SectionNav";
import { useDebouncedAutosave } from "@/hooks/useDebouncedAutosave";

export default function ResponderCuestionarioPage() {
  const params = useParams();
  const id = params.id as Id<"questionnaireResponses">;

  const questionnaire = useQuery(
    api.functions.questionnaires.queries.getById,
    { id }
  );

  const updateResponses = useMutation(
    api.functions.questionnaires.mutations.updateResponses
  );
  const submitQuestionnaire = useMutation(
    api.functions.questionnaires.mutations.submit
  );

  type ResponseItem = {
    questionId: string;
    questionText: string;
    answer: string;
    serviceNames: string[];
    type?:
      | "text"
      | "textarea"
      | "select"
      | "number"
      | "date"
      | "file_upload";
    options?: string[];
    section?: string;
    subsection?: string;
    variableKey?: string;
    fileConfig?: { acceptedMimeTypes: string[]; maxSizeMB: number; multiple: boolean };
    templateVariableMappings?: { templateId: any; variableName: string }[];
    filename?: string;
  };

  const [localResponses, setLocalResponses] = useState<ResponseItem[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const hasUserEditedRef = useRef(false);

  // Initialize local state from questionnaire data
  useEffect(() => {
    if (questionnaire && !initialized) {
      setLocalResponses(questionnaire.responses.map((r) => ({ ...r })));
      setInitialized(true);
      if (questionnaire.status === "completed") {
        setSubmitted(true);
      }
    }
  }, [questionnaire, initialized]);

  const handleAnswerChange = (questionId: string, answer: string) => {
    hasUserEditedRef.current = true;
    setLocalResponses((prev) =>
      prev.map((r) => (r.questionId === questionId ? { ...r, answer } : r))
    );
  };

  const handleSaveProgress = async () => {
    if (!questionnaire) return;
    setSaving(true);
    setSaveMessage("");
    try {
      await updateResponses({
        id: questionnaire._id,
        responses: localResponses,
      });
      setSaveMessage("Progreso guardado exitosamente.");
      setTimeout(() => setSaveMessage(""), 3000);
    } catch (err) {
      console.error("Error saving:", err);
      setSaveMessage("Error al guardar. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!questionnaire) return;
    setSaving(true);
    try {
      // Save responses first
      await updateResponses({
        id: questionnaire._id,
        responses: localResponses,
      });
      // Then submit
      await submitQuestionnaire({ id: questionnaire._id });
      setSubmitted(true);
    } catch (err) {
      console.error("Error submitting:", err);
      setSaveMessage("Error al enviar. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  const saveCallback = useCallback(
    async (latest: ResponseItem[]) => {
      if (!hasUserEditedRef.current) return;
      if (!questionnaire) return;
      await updateResponses({ id: questionnaire._id, responses: latest });
    },
    [questionnaire, updateResponses]
  );
  const autosave = useDebouncedAutosave(localResponses, saveCallback, 2000);

  if (questionnaire === undefined) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 py-8">
        <div className="h-8 w-48 animate-pulse rounded bg-secondary" />
        <div className="h-96 animate-pulse rounded-lg border border-border bg-card" />
      </div>
    );
  }

  if (questionnaire === null) {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <p className="text-lg font-medium">Cuestionario no encontrado</p>
        </div>
      </div>
    );
  }

  if (submitted || questionnaire.status === "completed") {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <CheckCircle2
            className="mx-auto mb-4 text-accent"
            size={48}
          />
          <p className="text-lg font-bold">Cuestionario Enviado</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Gracias por completar el cuestionario. Tu ejecutivo revisara las
            respuestas.
          </p>
        </div>
      </div>
    );
  }

  // Group responses by section
  const sectionGroups = new Map<string, ResponseItem[]>();
  for (const r of localResponses) {
    const key = r.section ?? "General";
    if (!sectionGroups.has(key)) sectionGroups.set(key, []);
    sectionGroups.get(key)!.push(r);
  }

  const sectionEntries = Array.from(sectionGroups.entries());
  const sectionItems: SectionNavItem[] = sectionEntries.map(([label, rs], idx) => ({
    id: `sec-${idx + 1}`,
    label,
    answered: rs.filter((r) => r.answer && r.answer.trim().length > 0).length,
    total: rs.length,
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-8">
      {/* Header */}
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-accent/10">
          <ClipboardList className="text-accent" size={28} />
        </div>
        <h1 className="text-2xl font-bold">Cuestionario</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Completa las siguientes preguntas sobre los servicios contratados.
          Puedes guardar tu progreso y continuar despues.
        </p>
      </div>

      {/* Save message */}
      {saveMessage && (
        <div
          className={cn(
            "rounded-md px-4 py-2 text-sm text-center",
            saveMessage.includes("Error")
              ? "bg-destructive/20 text-destructive"
              : "bg-accent/20 text-accent"
          )}
        >
          {saveMessage}
        </div>
      )}

      {/* Autosave status */}
      <div className="text-xs text-muted-foreground text-center">
        {autosave.status === "saving" && "Guardando..."}
        {autosave.status === "saved" && "Guardado"}
        {autosave.status === "pending" && "Cambios pendientes..."}
        {autosave.status === "error" && "Error al guardar — usa el botón para reintentar"}
        {autosave.status === "idle" && ""}
      </div>

      {/* Questions grouped by section */}
      <div className="lg:flex lg:gap-8">
        <SectionNav sections={sectionItems} />
        <div className="flex-1 space-y-6">
          {sectionEntries.map(([sectionLabel, rs], idx) => {
            const sectionId = `sec-${idx + 1}`;

            // Sub-group by subsection (preserving insertion order)
            const subGroups = new Map<string, ResponseItem[]>();
            for (const r of rs) {
              const k = r.subsection ?? "";
              if (!subGroups.has(k)) subGroups.set(k, []);
              subGroups.get(k)!.push(r);
            }

            return (
              <section
                key={sectionLabel}
                id={sectionId}
                className="rounded-lg border border-border bg-card scroll-mt-24"
              >
                <div className="border-b border-border px-4 py-3">
                  <h2 className="text-sm font-semibold text-accent">
                    {sectionLabel}
                  </h2>
                </div>
                <div className="divide-y divide-border/50">
                  {Array.from(subGroups.entries()).map(([subLabel, srs]) => (
                    <div key={subLabel} className="px-4 py-4">
                      {subLabel && (
                        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                          {subLabel}
                        </h3>
                      )}
                      <div className="space-y-4">
                        {srs.map((r) => (
                          <div key={r.questionId}>
                            <label
                              htmlFor={r.questionId}
                              className="mb-2 block text-sm font-medium"
                            >
                              {r.questionText}
                            </label>
                            <QuestionField
                              questionId={r.questionId}
                              type={r.type}
                              options={r.options}
                              value={r.answer}
                              onChange={(v) => handleAnswerChange(r.questionId, v)}
                              disabled={saving}
                              placeholder="Escribe tu respuesta..."
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
        <button
          onClick={handleSaveProgress}
          disabled={saving}
          className="flex items-center gap-2 rounded-md border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-secondary transition-colors cursor-pointer disabled:opacity-50"
        >
          <Save size={16} />
          {saving ? "Guardando..." : "Guardar Progreso"}
        </button>
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="flex items-center gap-2 rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-primary hover:bg-accent/90 transition-colors cursor-pointer disabled:opacity-50"
        >
          <Send size={16} />
          {saving ? "Enviando..." : "Enviar Cuestionario"}
        </button>
      </div>
    </div>
  );
}
