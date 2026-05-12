"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useParams } from "next/navigation";
import { QuestionField } from "@/components/questionnaires/QuestionField";
import { SectionNav, type SectionNavItem } from "@/components/questionnaires/SectionNav";
import { useDebouncedAutosave } from "@/hooks/useDebouncedAutosave";

export default function PublicQuestionnairePage() {
  const params = useParams();
  const token = params.token as string;

  const questionnaire = useQuery(
    api.functions.questionnaires.publicQueries.getByToken,
    { token }
  );

  const updateResponses = useMutation(
    api.functions.questionnaires.publicMutations.updateResponsesByToken
  );
  const submitByToken = useMutation(
    api.functions.questionnaires.publicMutations.submitByToken
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    templateVariableMappings?: { templateId: any; variableName: string }[];
    filename?: string;
  };

  const [localResponses, setLocalResponses] = useState<ResponseItem[]>([]);
  const [initialized, setInitialized] = useState(false);
  const hasUserEditedRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    if (questionnaire && !initialized) {
      setLocalResponses(questionnaire.responses.map((r) => ({ ...r })));
      setInitialized(true);
    }
  }, [questionnaire, initialized]);

  const saveCallback = useCallback(
    async (latest: ResponseItem[]) => {
      if (!hasUserEditedRef.current) return;
      await updateResponses({ token, responses: latest });
    },
    [token, updateResponses]
  );
  const autosave = useDebouncedAutosave(localResponses, saveCallback, 2000);

  const handleAnswerChange = (questionId: string, answer: string) => {
    hasUserEditedRef.current = true;
    setLocalResponses((prev) =>
      prev.map((r) => (r.questionId === questionId ? { ...r, answer } : r))
    );
  };

  const handleSaveProgress = async () => {
    setSaving(true);
    setSaveMessage("");
    try {
      await updateResponses({ token, responses: localResponses });
      setSaveMessage("Progreso guardado correctamente.");
      setTimeout(() => setSaveMessage(""), 3000);
    } catch (err) {
      setSaveMessage(
        err instanceof Error ? err.message : "Error al guardar."
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      // Save responses first
      await updateResponses({ token, responses: localResponses });
      // Then submit
      await submitByToken({ token });
      setSubmitted(true);
    } catch (err) {
      setSaveMessage(
        err instanceof Error ? err.message : "Error al enviar."
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Loading
  if (questionnaire === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-accent mx-auto" />
          <p className="text-sm text-muted-foreground">
            Cargando cuestionario...
          </p>
        </div>
      </div>
    );
  }

  // Not found
  if (questionnaire === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="max-w-md text-center space-y-4 p-8">
          <div className="text-5xl">&#128269;</div>
          <h1 className="text-xl font-semibold">Cuestionario no encontrado</h1>
          <p className="text-sm text-muted-foreground">
            El enlace que utilizaste no es valido o ha expirado. Contacta a tu
            ejecutivo para obtener un nuevo enlace.
          </p>
        </div>
      </div>
    );
  }

  // Already completed
  if (questionnaire.status === "completed") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="max-w-md text-center space-y-4 p-8">
          <div className="w-16 h-16 mx-auto rounded-full bg-accent/20 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-accent"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h1 className="text-xl font-semibold">
            Este cuestionario ya fue completado
          </h1>
          <p className="text-sm text-muted-foreground">
            Gracias, {questionnaire.clientName}. Tus respuestas fueron enviadas
            exitosamente el{" "}
            {questionnaire.completedAt
              ? new Date(questionnaire.completedAt).toLocaleDateString("es-MX", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })
              : ""}
            .
          </p>
        </div>
      </div>
    );
  }

  // Submitted just now
  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="max-w-md text-center space-y-4 p-8">
          <div className="w-16 h-16 mx-auto rounded-full bg-accent/20 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-accent"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h1 className="text-xl font-semibold">
            Respuestas enviadas exitosamente
          </h1>
          <p className="text-sm text-muted-foreground">
            Gracias, {questionnaire.clientName}. Tu ejecutivo recibira tus
            respuestas y se pondra en contacto contigo.
          </p>
        </div>
      </div>
    );
  }

  // Branding
  const branding = questionnaire.branding;
  const companyName = branding?.companyName ?? "Tu Consultor";
  const primaryColor = branding?.primaryColor ?? "#22C55E";

  // Group by section (preserving insertion order)
  const sectionGroups = new Map<string, ResponseItem[]>();
  for (const r of localResponses) {
    const key = r.section ?? "General";
    if (!sectionGroups.has(key)) sectionGroups.set(key, []);
    sectionGroups.get(key)!.push(r);
  }

  const sectionItems: SectionNavItem[] = Array.from(sectionGroups.entries()).map(
    ([label, rs], idx) => ({
      id: `sec-${idx + 1}`,
      label,
      answered: rs.filter((r) => r.answer && r.answer.trim().length > 0).length,
      total: rs.length,
    })
  );

  return (
    <div className="min-h-screen pb-16">
      {/* Header */}
      <div
        className="border-b border-border px-6 py-5"
        style={{ borderBottomColor: primaryColor + "40" }}
      >
        <div className="max-w-5xl mx-auto">
          <p
            className="text-xs font-medium uppercase tracking-wider mb-1"
            style={{ color: primaryColor }}
          >
            {companyName}
          </p>
          <h1 className="text-2xl font-bold">
            Cuestionario - {questionnaire.clientName}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Por favor completa las siguientes preguntas para que podamos brindarte
            un mejor servicio.
          </p>
        </div>
      </div>

      {/* Questions */}
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <div className="lg:flex lg:gap-8">
          <SectionNav sections={sectionItems} />
          <div className="flex-1 space-y-10">
            {Array.from(sectionGroups.entries()).map(([sectionLabel, rs], idx) => {
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
                  <div
                    className="border-b border-border px-5 py-3"
                    style={{ borderBottomColor: primaryColor + "30" }}
                  >
                    <h2
                      className="text-sm font-semibold"
                      style={{ color: primaryColor }}
                    >
                      {sectionLabel}
                    </h2>
                  </div>
                  <div className="divide-y divide-border/50">
                    {Array.from(subGroups.entries()).map(([subLabel, srs]) => (
                      <div key={subLabel} className="px-5 py-4">
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
                                onChange={(v) =>
                                  handleAnswerChange(r.questionId, v)
                                }
                                disabled={submitting}
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

        {/* Autosave indicator */}
        <div className="text-xs text-muted-foreground">
          {autosave.status === "saving" && "Guardando..."}
          {autosave.status === "saved" && "Guardado"}
          {autosave.status === "pending" && "Cambios pendientes..."}
          {autosave.status === "error" && "Error al guardar — usa el botón para reintentar"}
          {autosave.status === "idle" && ""}
        </div>

        {/* Manual save / error message */}
        {saveMessage && (
          <div
            className={`rounded-md px-4 py-3 text-sm ${
              saveMessage.includes("Error") || saveMessage.includes("error")
                ? "bg-destructive/20 text-destructive"
                : "bg-accent/20 text-accent"
            }`}
          >
            {saveMessage}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-3 pt-4">
          <button
            onClick={handleSaveProgress}
            disabled={saving || submitting}
            className="rounded-md border border-border px-5 py-2.5 text-sm font-medium text-foreground hover:bg-secondary transition-colors cursor-pointer disabled:opacity-50"
          >
            {saving ? "Guardando..." : "Guardar Progreso"}
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || submitting}
            className="rounded-md px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors cursor-pointer disabled:opacity-50"
            style={{
              backgroundColor: primaryColor,
              color: "#0F172A",
            }}
          >
            {submitting ? "Enviando..." : "Enviar Respuestas"}
          </button>
        </div>
      </div>
    </div>
  );
}
