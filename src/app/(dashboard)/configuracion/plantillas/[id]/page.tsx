"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import {
  ChevronLeft,
  FileText,
  Eye,
  Loader2,
  X,
  Plus,
  Trash2,
  AlertTriangle,
  RefreshCcw,
  GitCompare,
} from "lucide-react";
import { api } from "../../../../../../convex/_generated/api";
import { Id } from "../../../../../../convex/_generated/dataModel";
import {
  resolveTemplate,
  generateSampleContext,
  extractPlaceholders,
  type TemplateVariable,
} from "@/lib/templateResolver";

type TemplateType =
  | "quotation"
  | "contract"
  | "deliverable_short"
  | "deliverable_long"
  | "questionnaire"
  | "invoice";

type VariableSource = "client" | "projection" | "service" | "ai" | "manual";

type Variable = {
  key: string;
  label: string;
  source: VariableSource;
  required: boolean;
};

type FormState = {
  name: string;
  serviceName: string;
  type: Exclude<TemplateType, "invoice">;
  htmlTemplate: string;
  variables: Variable[];
};

const TYPE_LABELS: Record<Exclude<TemplateType, "invoice">, string> = {
  quotation: "Cotización",
  contract: "Contrato",
  deliverable_short: "Entregable Corto",
  deliverable_long: "Entregable Largo",
  questionnaire: "Cuestionario",
};

const SOURCE_LABELS: Record<VariableSource, string> = {
  client: "Cliente",
  projection: "Proyección",
  service: "Servicio",
  ai: "IA",
  manual: "Manual",
};

const EMPTY_VAR: Variable = {
  key: "",
  label: "",
  source: "client",
  required: true,
};

export default function EditarPlantillaPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as Id<"deliverableTemplates">;

  const data = useQuery(
    api.functions.deliverableTemplates.queries.getByIdWithBanner,
    { id }
  );
  const updateTemplate = useMutation(
    api.functions.deliverableTemplates.mutations.update
  );

  const [form, setForm] = useState<FormState | null>(null);
  // Optimistic concurrency token. We hold the version we saw at editor-open
  // time and pass it to `update` as `expectedVersion`. Server bumps it on
  // every successful patch; if mismatched, mutation throws (R15).
  const [savedVersion, setSavedVersion] = useState<number | null>(null);
  const [initialSnapshot, setInitialSnapshot] = useState<FormState | null>(
    null
  );
  const [staleError, setStaleError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewMissing, setPreviewMissing] = useState<string[]>([]);
  const [diffOpen, setDiffOpen] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  // The global parent's HTML is not exposed via getByIdWithBanner in beta —
  // the diff modal renders only the org-side HTML and a placeholder. A future
  // iteration adds a dedicated `getParentTemplate` query.
  const parentHtml: string | null = null;

  // Hydrate form when data arrives (only once — re-fetches due to live query
  // must NOT clobber operator's local edits).
  useEffect(() => {
    if (data?.template && form === null) {
      const tpl = data.template;
      const next: FormState = {
        name: tpl.name,
        serviceName: tpl.serviceName,
        type:
          tpl.type === "invoice"
            ? "deliverable_short"
            : (tpl.type as Exclude<TemplateType, "invoice">),
        htmlTemplate: tpl.htmlTemplate,
        variables: tpl.variables as Variable[],
      };
      setForm(next);
      setInitialSnapshot(next);
      setSavedVersion(tpl.version);
    }
  }, [data?.template, form]);

  // Detect placeholders in the HTML not declared in variables[].
  // Auto-strips `branding_*` since those are resolved by the renderer.
  const undeclaredPlaceholders = useMemo(() => {
    if (!form) return [];
    const declared = new Set(form.variables.map((v) => v.key));
    return extractPlaceholders(form.htmlTemplate).filter(
      (k) => !declared.has(k) && !k.startsWith("branding_")
    );
  }, [form]);

  const isDirty = useMemo(() => {
    if (!form || !initialSnapshot) return false;
    return JSON.stringify(form) !== JSON.stringify(initialSnapshot);
  }, [form, initialSnapshot]);

  async function handleSave() {
    if (!form || savedVersion === null) return;
    setErrorMessage(null);
    if (!form.name.trim()) {
      setErrorMessage("El nombre es requerido.");
      return;
    }
    if (!form.htmlTemplate.trim()) {
      setErrorMessage("El contenido HTML es requerido.");
      return;
    }
    setSaving(true);
    try {
      await updateTemplate({
        id,
        expectedVersion: savedVersion,
        patch: {
          name: form.name,
          serviceName: form.serviceName,
          type: form.type,
          htmlTemplate: form.htmlTemplate,
          variables: form.variables,
        },
      });
      router.push("/configuracion/plantillas");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al guardar";
      if (msg.includes("Versión obsoleta")) {
        setStaleError(true);
      } else {
        setErrorMessage(msg);
      }
    } finally {
      setSaving(false);
    }
  }

  function handleReload() {
    // Discard local changes and force a re-fetch from server. We zero the form
    // so the useEffect re-hydrates from data.template (which is live via Convex).
    setForm(null);
    setInitialSnapshot(null);
    setSavedVersion(null);
    setStaleError(false);
    setErrorMessage(null);
  }

  function handleCancel() {
    if (isDirty) {
      setCancelConfirm(true);
      return;
    }
    router.push("/configuracion/plantillas");
  }

  function handlePreview() {
    if (!form) return;
    const sampleCtx = generateSampleContext(
      form.variables as TemplateVariable[]
    );
    const result = resolveTemplate(
      form.htmlTemplate,
      form.variables as TemplateVariable[],
      sampleCtx
    );
    setPreviewHtml(result.html);
    setPreviewMissing(result.missing);
  }

  function openDiff() {
    if (!data?.template?.parentTemplateId) return;
    setDiffOpen(true);
  }

  if (data === undefined) {
    return (
      <div className="space-y-6">
        <Link
          href="/configuracion/plantillas"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <ChevronLeft size={16} /> Plantillas
        </Link>
        <div className="flex items-center gap-3">
          <FileText className="text-accent" size={28} />
          <h1 className="text-2xl font-bold">Editar plantilla</h1>
        </div>
        <div className="h-72 animate-pulse rounded-lg border border-border bg-card" />
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="space-y-6">
        <Link
          href="/configuracion/plantillas"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <ChevronLeft size={16} /> Plantillas
        </Link>
        <div className="rounded-md border border-red-400/40 bg-red-400/10 p-4 text-sm text-red-400">
          Plantilla no encontrada o no tenés permiso para editarla.
        </div>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="space-y-6">
        <Link
          href="/configuracion/plantillas"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <ChevronLeft size={16} /> Plantillas
        </Link>
        <div className="h-72 animate-pulse rounded-lg border border-border bg-card" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        href="/configuracion/plantillas"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <ChevronLeft size={16} /> Plantillas
      </Link>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <FileText className="text-accent" size={28} />
          <div>
            <h1 className="text-2xl font-bold">Editar plantilla</h1>
            <p className="text-sm text-muted-foreground">
              {form.serviceName} · {TYPE_LABELS[form.type]} · v{savedVersion}
            </p>
          </div>
        </div>
      </div>

      {data.hasNewerGlobal && (
        <div
          role="status"
          data-testid="banner-newer-global"
          className="flex items-center justify-between gap-3 rounded-md border border-yellow-500/30 bg-yellow-500/5 px-4 py-3 text-sm text-yellow-300"
        >
          <span>
            <AlertTriangle className="mr-2 inline" size={14} />v{savedVersion}{" "}
            personalizada · v{data.globalVersion} global disponible.
          </span>
          <button
            type="button"
            onClick={openDiff}
            className="inline-flex items-center gap-1 underline hover:no-underline cursor-pointer"
          >
            <GitCompare size={12} /> Ver cambios
          </button>
        </div>
      )}

      {staleError && (
        <div
          role="alert"
          data-testid="banner-stale"
          className="flex items-center justify-between gap-3 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400"
        >
          <span>
            Otro usuario editó esta plantilla mientras trabajabas. Tus cambios
            locales no se aplicaron. Recargá para continuar con la última
            versión.
          </span>
          <button
            type="button"
            onClick={handleReload}
            className="inline-flex items-center gap-1 rounded-md border border-red-400/40 px-2 py-1 hover:bg-red-500/10 cursor-pointer"
          >
            <RefreshCcw size={12} /> Recargar
          </button>
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="rounded-md border border-red-400/40 bg-red-400/10 p-3 text-sm text-red-400"
        >
          {errorMessage}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        {/* HTML Editor */}
        <div className="space-y-4 rounded-lg border border-border bg-card p-4">
          <div className="space-y-1">
            <label htmlFor="tpl-name" className="text-sm font-medium">
              Nombre
            </label>
            <input
              id="tpl-name"
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="tpl-type" className="text-sm font-medium">
              Tipo
            </label>
            <select
              id="tpl-type"
              value={form.type}
              onChange={(e) =>
                setForm({
                  ...form,
                  type: e.target.value as Exclude<TemplateType, "invoice">,
                })
              }
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:border-accent focus:outline-none cursor-pointer"
            >
              {Object.entries(TYPE_LABELS).map(([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="tpl-html" className="text-sm font-medium">
              HTML
            </label>
            <textarea
              id="tpl-html"
              value={form.htmlTemplate}
              onChange={(e) =>
                setForm({ ...form, htmlTemplate: e.target.value })
              }
              rows={20}
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 font-mono text-xs focus:border-accent focus:outline-none"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handlePreview}
              disabled={!form.htmlTemplate.trim()}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-secondary transition-colors disabled:opacity-50 cursor-pointer"
            >
              <Eye size={14} /> Vista previa
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCancel}
                disabled={saving}
                className="rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || staleError}
                data-testid="save-btn"
                className="inline-flex items-center gap-1 rounded-md bg-accent px-4 py-2 text-sm font-medium text-primary hover:bg-accent/90 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {saving && <Loader2 size={12} className="animate-spin" />}
                Guardar
              </button>
            </div>
          </div>
        </div>

        {/* Variables panel */}
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              Variables ({form.variables.length})
            </h2>
            <button
              type="button"
              onClick={() =>
                setForm({
                  ...form,
                  variables: [...form.variables, { ...EMPTY_VAR }],
                })
              }
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-secondary transition-colors cursor-pointer"
            >
              <Plus size={12} /> Variable
            </button>
          </div>

          {undeclaredPlaceholders.length > 0 && (
            <div
              role="status"
              data-testid="undeclared-warning"
              className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-300"
            >
              <AlertTriangle className="mr-1 inline" size={12} />
              Placeholders no declarados:{" "}
              <code className="font-mono">
                {undeclaredPlaceholders.join(", ")}
              </code>
              . Agregalos abajo o quítalos del HTML antes de guardar.
            </div>
          )}

          {form.variables.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Esta plantilla no declara variables todavía.
            </p>
          ) : (
            <ul className="space-y-2">
              {form.variables.map((v, i) => (
                <li
                  key={i}
                  className="space-y-2 rounded-md border border-border/60 bg-background/40 p-2"
                >
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label
                        htmlFor={`var-key-${i}`}
                        className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                      >
                        Key
                      </label>
                      <input
                        id={`var-key-${i}`}
                        type="text"
                        value={v.key}
                        onChange={(e) => {
                          const next = [...form.variables];
                          next[i] = { ...next[i], key: e.target.value };
                          setForm({ ...form, variables: next });
                        }}
                        className="w-full rounded-md border border-border bg-secondary px-2 py-1 font-mono text-xs focus:border-accent focus:outline-none"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`var-label-${i}`}
                        className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                      >
                        Label
                      </label>
                      <input
                        id={`var-label-${i}`}
                        type="text"
                        value={v.label}
                        onChange={(e) => {
                          const next = [...form.variables];
                          next[i] = { ...next[i], label: e.target.value };
                          setForm({ ...form, variables: next });
                        }}
                        className="w-full rounded-md border border-border bg-secondary px-2 py-1 text-xs focus:border-accent focus:outline-none"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <select
                      aria-label={`Fuente de la variable ${v.key || i + 1}`}
                      value={v.source}
                      onChange={(e) => {
                        const next = [...form.variables];
                        next[i] = {
                          ...next[i],
                          source: e.target.value as VariableSource,
                        };
                        setForm({ ...form, variables: next });
                      }}
                      className="flex-1 rounded-md border border-border bg-secondary px-2 py-1 text-xs focus:border-accent focus:outline-none cursor-pointer"
                    >
                      {Object.entries(SOURCE_LABELS).map(([val, label]) => (
                        <option key={val} value={val}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={v.required}
                        onChange={(e) => {
                          const next = [...form.variables];
                          next[i] = {
                            ...next[i],
                            required: e.target.checked,
                          };
                          setForm({ ...form, variables: next });
                        }}
                        className="accent-accent"
                      />
                      req.
                    </label>
                    <button
                      type="button"
                      aria-label={`Eliminar variable ${v.key || i + 1}`}
                      onClick={() => {
                        const next = form.variables.filter(
                          (_, idx) => idx !== i
                        );
                        setForm({ ...form, variables: next });
                      }}
                      className="rounded p-1 text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {previewHtml !== null && (
        <PreviewModal
          html={previewHtml}
          missing={previewMissing}
          onClose={() => {
            setPreviewHtml(null);
            setPreviewMissing([]);
          }}
        />
      )}

      {diffOpen && data.template?.parentTemplateId && (
        <DiffModal
          orgHtml={form.htmlTemplate}
          parentName={data.globalName ?? "Plantilla global"}
          parentVersion={data.globalVersion}
          parentHtml={parentHtml}
          onClose={() => setDiffOpen(false)}
        />
      )}

      {cancelConfirm && (
        <ConfirmDirtyDialog
          onKeep={() => setCancelConfirm(false)}
          onDiscard={() => {
            setCancelConfirm(false);
            router.push("/configuracion/plantillas");
          }}
        />
      )}
    </div>
  );
}

function PreviewModal({
  html,
  missing,
  onClose,
}: {
  html: string;
  missing: string[];
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Vista previa"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="relative max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-lg border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold">Vista previa</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Render aproximado. El PDF final puede diferir en márgenes y
              fuentes.
            </p>
            {missing.length > 0 && (
              <p className="mt-1 text-xs text-red-400">
                Variables faltantes: {missing.join(", ")}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded p-1.5 text-muted-foreground hover:bg-secondary transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>
        <div
          className="overflow-y-auto p-2"
          style={{ maxHeight: "calc(85vh - 92px)" }}
        >
          <iframe
            title="Vista previa de la plantilla"
            sandbox="allow-same-origin"
            srcDoc={html}
            className="h-[70vh] w-full rounded-md border border-border bg-white"
          />
        </div>
      </div>
    </div>
  );
}

function DiffModal({
  orgHtml,
  parentName,
  parentVersion,
  parentHtml,
  onClose,
}: {
  orgHtml: string;
  parentName: string;
  parentVersion: number | null;
  parentHtml: string | null;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Comparar con la versión global"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="relative max-h-[85vh] w-full max-w-5xl overflow-hidden rounded-lg border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold">
              Comparar con la versión global
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {parentName} · v{parentVersion ?? "?"} — comparación HTML
              side-by-side (sin diff visual; beta).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded p-1.5 text-muted-foreground hover:bg-secondary transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>
        <div
          className="grid grid-cols-1 gap-3 overflow-y-auto p-4 md:grid-cols-2"
          style={{ maxHeight: "calc(85vh - 80px)" }}
        >
          <section>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Tu versión personalizada
            </h4>
            <pre className="max-h-[60vh] overflow-auto rounded-md border border-border bg-background p-3 font-mono text-[11px]">
              {orgHtml}
            </pre>
          </section>
          <section>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Versión global (v{parentVersion ?? "?"})
            </h4>
            <pre className="max-h-[60vh] overflow-auto rounded-md border border-border bg-background p-3 font-mono text-[11px]">
              {parentHtml ??
                "(El HTML del global se cargará en una versión futura. Por ahora abrí /platform/templates como super-admin para inspeccionar la fuente.)"}
            </pre>
          </section>
        </div>
      </div>
    </div>
  );
}

function ConfirmDirtyDialog({
  onKeep,
  onDiscard,
}: {
  onKeep: () => void;
  onDiscard: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Descartar cambios"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onKeep}
      onKeyDown={(e) => {
        if (e.key === "Escape") onKeep();
      }}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">¿Descartar cambios?</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Tenés cambios sin guardar. Si salís ahora se perderán.
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onKeep}
            className="rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary transition-colors cursor-pointer"
          >
            Seguir editando
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="rounded-md bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 transition-colors cursor-pointer"
          >
            Descartar
          </button>
        </div>
      </div>
    </div>
  );
}
