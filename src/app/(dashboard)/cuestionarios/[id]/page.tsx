"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  ClipboardList,
  Send,
  CheckCircle2,
  Edit3,
  Save,
  Copy,
  Check,
  Phone,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  sent: "Enviado",
  in_progress: "En Progreso",
  completed: "Completado",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted-foreground/20 text-muted-foreground",
  sent: "bg-info/20 text-info",
  in_progress: "bg-warning/20 text-warning",
  completed: "bg-accent/20 text-accent",
};

export default function QuestionnaireDetailPage() {
  const params = useParams();
  const id = params.id as Id<"questionnaireResponses">;

  const questionnaire = useQuery(
    api.functions.questionnaires.queries.getById,
    { id }
  );
  const client = useQuery(
    api.functions.clients.queries.getById,
    questionnaire ? { id: questionnaire.clientId } : "skip"
  );

  const updateResponses = useMutation(
    api.functions.questionnaires.mutations.updateResponses
  );
  const updateStatus = useMutation(
    api.functions.questionnaires.mutations.updateStatus
  );
  const submitQuestionnaire = useMutation(
    api.functions.questionnaires.mutations.submit
  );

  const [editing, setEditing] = useState(false);
  const [localResponses, setLocalResponses] = useState<
    Array<{
      questionId: string;
      questionText: string;
      answer: string;
      serviceNames: string[];
    }>
  >([]);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const startEditing = () => {
    if (questionnaire) {
      setLocalResponses(
        questionnaire.responses.map((r) => ({ ...r }))
      );
      setEditing(true);
    }
  };

  const handleAnswerChange = (questionId: string, answer: string) => {
    setLocalResponses((prev) =>
      prev.map((r) => (r.questionId === questionId ? { ...r, answer } : r))
    );
  };

  const handleSave = async () => {
    if (!questionnaire) return;
    setSaving(true);
    try {
      await updateResponses({ id: questionnaire._id, responses: localResponses });
      setEditing(false);
    } catch (err) {
      console.error("Error saving responses:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleSendToClient = async () => {
    if (!questionnaire) return;
    setSaving(true);
    try {
      await updateStatus({ id: questionnaire._id, status: "sent" });
    } catch (err) {
      console.error("Error updating status:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleMarkComplete = async () => {
    if (!questionnaire) return;
    setSaving(true);
    try {
      await submitQuestionnaire({ id: questionnaire._id });
    } catch (err) {
      console.error("Error submitting:", err);
    } finally {
      setSaving(false);
    }
  };

  if (questionnaire === undefined) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-secondary" />
        <div className="h-96 animate-pulse rounded-lg border border-border bg-card" />
      </div>
    );
  }

  if (questionnaire === null) {
    return (
      <div className="space-y-4">
        <Link
          href="/cuestionarios"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <ArrowLeft size={14} /> Volver a Cuestionarios
        </Link>
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <p className="text-lg font-medium">Cuestionario no encontrado</p>
        </div>
      </div>
    );
  }

  const isCompleted = questionnaire.status === "completed";
  const responses = editing ? localResponses : questionnaire.responses;

  // Group responses by service
  const serviceGroups = new Map<string, typeof responses>();
  for (const r of responses) {
    const key =
      r.serviceNames.length > 1 ? "General" : r.serviceNames[0] ?? "General";
    const group = serviceGroups.get(key) ?? [];
    group.push(r);
    serviceGroups.set(key, group);
  }

  return (
    <div className="space-y-6">
      <Link
        href="/cuestionarios"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <ArrowLeft size={14} />
        Volver a Cuestionarios
      </Link>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ClipboardList className="text-accent" size={28} />
          <div>
            <h1 className="text-2xl font-bold">
              Cuestionario - {client?.name ?? "Cliente"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {questionnaire.responses.length} preguntas &middot; Creado{" "}
              {new Date(questionnaire.createdAt).toLocaleDateString("es-MX")}
              {questionnaire.completedAt &&
                ` &middot; Completado ${new Date(questionnaire.completedAt).toLocaleDateString("es-MX")}`}
            </p>
          </div>
        </div>
        <span
          className={cn(
            "rounded-full px-3 py-1 text-sm font-medium",
            STATUS_COLORS[questionnaire.status]
          )}
        >
          {STATUS_LABELS[questionnaire.status]}
        </span>
      </div>

      {/* Fill mode helper — only while draft/sent/in_progress */}
      {!isCompleted && (
        <div className="rounded-lg border border-border bg-secondary/20 p-4">
          <p className="text-sm font-medium mb-1">¿Cómo vas a llenar este cuestionario?</p>
          <p className="text-xs text-muted-foreground">
            <b>Opción A:</b> envías el link al cliente y él lo llena (ver abajo).
            {" · "}
            <b>Opción B:</b> lo llenas tú mientras hablas con el cliente por teléfono — click en
            {" "}<b>Llenar por teléfono</b>.
          </p>
        </div>
      )}

      {/* Action Buttons */}
      {!isCompleted && (
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/cuestionarios/${id}/responder`}
            className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-primary hover:bg-accent/90 transition-colors cursor-pointer"
          >
            <Phone size={16} />
            Llenar por teléfono
          </Link>

          {!editing ? (
            <button
              onClick={startEditing}
              className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors cursor-pointer"
            >
              <Edit3 size={16} />
              Editar inline
            </button>
          ) : (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-primary hover:bg-accent/90 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Save size={16} />
              {saving ? "Guardando..." : "Guardar Cambios"}
            </button>
          )}

          {questionnaire.status === "draft" && !editing && (
            <button
              onClick={handleSendToClient}
              disabled={saving}
              className="flex items-center gap-2 rounded-md bg-info/20 px-4 py-2 text-sm font-medium text-info hover:bg-info/30 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Send size={16} />
              Enviar a Cliente
            </button>
          )}

          {(questionnaire.status === "in_progress" ||
            questionnaire.status === "sent") &&
            !editing && (
              <button
                onClick={handleMarkComplete}
                disabled={saving}
                className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-primary hover:bg-accent/90 transition-colors cursor-pointer disabled:opacity-50"
              >
                <CheckCircle2 size={16} />
                Marcar como Completado
              </button>
            )}

          {editing && (
            <button
              onClick={() => setEditing(false)}
              className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-secondary transition-colors cursor-pointer"
            >
              Cancelar
            </button>
          )}
        </div>
      )}

      {/* Public link for client */}
      {questionnaire.accessToken && (
        <div className="rounded-lg border border-border bg-secondary/30 p-4">
          <p className="text-sm text-muted-foreground mb-2">
            Link para el cliente:
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-secondary px-3 py-1.5 text-xs text-foreground truncate">
              {typeof window !== "undefined"
                ? `${window.location.origin}/q/${questionnaire.accessToken}`
                : `/q/${questionnaire.accessToken}`}
            </code>
            <button
              onClick={() => {
                const url = `${window.location.origin}/q/${questionnaire.accessToken}`;
                navigator.clipboard.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary transition-colors cursor-pointer"
            >
              {copied ? (
                <>
                  <Check size={14} className="text-accent" /> Copiado
                </>
              ) : (
                <>
                  <Copy size={14} /> Copiar
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Questions grouped by service */}
      {Array.from(serviceGroups.entries()).map(([serviceName, questions]) => (
        <div
          key={serviceName}
          className="rounded-lg border border-border bg-card"
        >
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-accent">
              {serviceName}
            </h2>
          </div>
          <div className="divide-y divide-border/50">
            {questions.map((r) => (
              <div key={r.questionId} className="px-4 py-4">
                <label className="mb-2 block text-sm font-medium">
                  {r.questionText}
                </label>
                {r.serviceNames.length > 1 && (
                  <p className="mb-2 text-xs text-muted-foreground">
                    Aplica a: {r.serviceNames.join(", ")}
                  </p>
                )}
                {editing ? (
                  <textarea
                    value={r.answer}
                    onChange={(e) =>
                      handleAnswerChange(r.questionId, e.target.value)
                    }
                    rows={3}
                    className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent resize-y"
                    placeholder="Escribe tu respuesta..."
                  />
                ) : (
                  <div className="rounded-md bg-secondary/50 px-3 py-2 text-sm">
                    {r.answer || (
                      <span className="text-muted-foreground italic">
                        Sin respuesta
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
