"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useState } from "react";
import {
  FileText,
  Plus,
  X,
  Loader2,
  Eye,
  Copy,
  ChevronDown,
  Trash2,
} from "lucide-react";
import {
  resolveTemplate,
  generateSampleContext,
  type TemplateVariable,
} from "@/lib/templateResolver";
import { TestDeliverableModal } from "@/components/templates/test-deliverable-modal";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type TemplateType =
  | "quotation"
  | "contract"
  | "deliverable_short"
  | "deliverable_long"
  | "questionnaire";

type VariableSource = "client" | "projection" | "service" | "ai" | "manual";

type Variable = {
  key: string;
  label: string;
  source: VariableSource;
  required: boolean;
};

type FormData = {
  name: string;
  type: TemplateType;
  serviceId: string;
  serviceName: string;
  orgId: string;
  htmlTemplate: string;
  variables: Variable[];
  isActive: boolean;
};

const emptyForm: FormData = {
  name: "",
  type: "quotation",
  serviceId: "",
  serviceName: "",
  orgId: "",
  htmlTemplate: "",
  variables: [],
  isActive: true,
};

const emptyVariable: Variable = {
  key: "",
  label: "",
  source: "client",
  required: true,
};

const TYPE_LABELS: Record<TemplateType, string> = {
  quotation: "Cotización",
  contract: "Contrato",
  deliverable_short: "Entregable Corto",
  deliverable_long: "Entregable Largo",
  questionnaire: "Cuestionario",
};

const TYPE_COLORS: Record<TemplateType, string> = {
  quotation: "bg-blue-500/10 text-blue-400",
  contract: "bg-purple-500/10 text-purple-400",
  deliverable_short: "bg-green-500/10 text-green-400",
  deliverable_long: "bg-teal-500/10 text-teal-400",
  questionnaire: "bg-amber-500/10 text-amber-400",
};

const SOURCE_LABELS: Record<VariableSource, string> = {
  client: "Cliente",
  projection: "Proyección",
  service: "Servicio",
  ai: "IA",
  manual: "Manual",
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function TemplatesPage() {
  const templates = useQuery(api.functions.deliverableTemplates.queries.list, {});
  const services = useQuery(api.functions.services.queries.listAllForAdmin);
  const createTemplate = useMutation(
    api.functions.deliverableTemplates.mutations.create
  );
  const updateTemplate = useMutation(
    api.functions.deliverableTemplates.mutations.update
  );
  const toggleActive = useMutation(
    api.functions.deliverableTemplates.mutations.toggleActive
  );
  const duplicateTemplate = useMutation(
    api.functions.deliverableTemplates.mutations.duplicate
  );

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<TemplateType | "">("");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewMissing, setPreviewMissing] = useState<string[]>([]);
  const [testTemplateId, setTestTemplateId] = useState<Id<"deliverableTemplates"> | null>(null);

  /* ---------- Handlers ---------- */

  const openCreate = () => {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(true);
    setError(null);
  };

  const openEdit = (template: {
    _id: string;
    name: string;
    type: TemplateType;
    serviceId?: string;
    serviceName: string;
    orgId?: string;
    htmlTemplate: string;
    variables: Variable[];
    isActive: boolean;
  }) => {
    setForm({
      name: template.name,
      type: template.type,
      serviceId: template.serviceId ?? "",
      serviceName: template.serviceName,
      orgId: template.orgId ?? "",
      htmlTemplate: template.htmlTemplate,
      variables: template.variables,
      isActive: template.isActive,
    });
    setEditingId(template._id);
    setShowForm(true);
    setError(null);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError("El nombre es requerido.");
      return;
    }
    if (!form.htmlTemplate.trim()) {
      setError("El contenido HTML es requerido.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (editingId) {
        await updateTemplate({
          id: editingId as Id<"deliverableTemplates">,
          name: form.name,
          type: form.type,
          htmlTemplate: form.htmlTemplate,
          variables: form.variables,
          serviceName: form.serviceName,
          serviceId: form.serviceId
            ? (form.serviceId as Id<"services">)
            : undefined,
          orgId: form.orgId || undefined,
        });
      } else {
        await createTemplate({
          name: form.name,
          type: form.type,
          htmlTemplate: form.htmlTemplate,
          variables: form.variables,
          serviceName: form.serviceName,
          serviceId: form.serviceId
            ? (form.serviceId as Id<"services">)
            : undefined,
          orgId: form.orgId || undefined,
          isActive: form.isActive,
        });
      }
      closeForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (id: string) => {
    try {
      await toggleActive({ id: id as Id<"deliverableTemplates"> });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cambiar estado");
    }
  };

  const handleDuplicate = async (id: string) => {
    try {
      await duplicateTemplate({ id: id as Id<"deliverableTemplates"> });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al duplicar");
    }
  };

  const handlePreview = () => {
    const sampleCtx = generateSampleContext(form.variables as TemplateVariable[]);
    const result = resolveTemplate(
      form.htmlTemplate,
      form.variables as TemplateVariable[],
      sampleCtx
    );
    setPreviewHtml(result.html);
    setPreviewMissing(result.missing);
  };

  const addVariable = () => {
    setForm({
      ...form,
      variables: [...form.variables, { ...emptyVariable }],
    });
  };

  const removeVariable = (index: number) => {
    setForm({
      ...form,
      variables: form.variables.filter((_, i) => i !== index),
    });
  };

  const updateVariable = (
    index: number,
    field: keyof Variable,
    value: string | boolean
  ) => {
    const updated = [...form.variables];
    updated[index] = { ...updated[index], [field]: value };
    setForm({ ...form, variables: updated });
  };

  /* ---------- Filter ---------- */

  const filtered = templates
    ? filterType
      ? templates.filter((t) => t.type === filterType)
      : templates
    : undefined;

  /* ---------- Render ---------- */

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Templates de Entregables
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Plantillas HTML con variables para generar documentos
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90 transition-colors"
        >
          <Plus size={16} />
          Crear Template
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Filter */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-muted-foreground">Filtrar por tipo:</label>
        <div className="relative">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as TemplateType | "")}
            className="appearance-none rounded-md border border-border bg-secondary pl-3 pr-8 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">Todos</option>
            {Object.entries(TYPE_LABELS).map(([val, label]) => (
              <option key={val} value={val}>
                {label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
        </div>
      </div>

      {/* ========================================================== */}
      {/*  FORM (Create / Edit)                                       */}
      {/* ========================================================== */}
      {showForm && (
        <div className="rounded-lg border border-accent/30 bg-card p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">
              {editingId ? "Editar Template" : "Nuevo Template"}
            </h2>
            <button
              onClick={closeForm}
              className="rounded p-1 text-muted-foreground hover:bg-secondary transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Row 1: Name, Type, Service, Org */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                Nombre
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                placeholder="Cotización Marketing Digital"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                Tipo
              </label>
              <select
                value={form.type}
                onChange={(e) =>
                  setForm({ ...form, type: e.target.value as TemplateType })
                }
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {Object.entries(TYPE_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                Servicio (opcional)
              </label>
              <select
                value={form.serviceId}
                onChange={(e) => {
                  const svc = services?.find(
                    (s) => (s._id as string) === e.target.value
                  );
                  setForm({
                    ...form,
                    serviceId: e.target.value,
                    serviceName: svc?.name ?? form.serviceName,
                  });
                }}
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">-- Ninguno --</option>
                {services?.map((s) => (
                  <option key={s._id as string} value={s._id as string}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                Org ID (opcional)
              </label>
              <input
                type="text"
                value={form.orgId}
                onChange={(e) => setForm({ ...form, orgId: e.target.value })}
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                placeholder="org_xxx (vacio = global)"
              />
            </div>
          </div>

          {/* Service Name (if no service selected) */}
          {!form.serviceId && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                Nombre del Servicio (texto libre)
              </label>
              <input
                type="text"
                value={form.serviceName}
                onChange={(e) =>
                  setForm({ ...form, serviceName: e.target.value })
                }
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                placeholder="General / Marketing Digital / etc."
              />
            </div>
          )}

          {/* HTML Template */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
              Contenido HTML
            </label>
            <textarea
              value={form.htmlTemplate}
              onChange={(e) =>
                setForm({ ...form, htmlTemplate: e.target.value })
              }
              rows={14}
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder={'<h1>Cotización para {{name}}</h1>\n<p>RFC: {{rfc}}</p>\n<p>Monto anual: ${{annualAmount}}</p>'}
            />
          </div>

          {/* Variables */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-muted-foreground">
                Variables ({form.variables.length})
              </label>
              <button
                onClick={addVariable}
                className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
              >
                <Plus size={12} />
                Agregar Variable
              </button>
            </div>

            {form.variables.length > 0 && (
              <div className="space-y-2">
                {/* Header row */}
                <div className="grid grid-cols-[1fr_1fr_120px_60px_40px] gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground px-1">
                  <span>Key</span>
                  <span>Label</span>
                  <span>Fuente</span>
                  <span>Req.</span>
                  <span></span>
                </div>
                {form.variables.map((v, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[1fr_1fr_120px_60px_40px] gap-2 items-center"
                  >
                    <input
                      type="text"
                      value={v.key}
                      onChange={(e) => updateVariable(i, "key", e.target.value)}
                      className="rounded-md border border-border bg-secondary px-2 py-1.5 text-sm text-foreground font-mono focus:border-accent focus:outline-none"
                      placeholder="name"
                    />
                    <input
                      type="text"
                      value={v.label}
                      onChange={(e) =>
                        updateVariable(i, "label", e.target.value)
                      }
                      className="rounded-md border border-border bg-secondary px-2 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none"
                      placeholder="Nombre del Cliente"
                    />
                    <select
                      value={v.source}
                      onChange={(e) =>
                        updateVariable(i, "source", e.target.value)
                      }
                      className="rounded-md border border-border bg-secondary px-2 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none"
                    >
                      {Object.entries(SOURCE_LABELS).map(([val, label]) => (
                        <option key={val} value={val}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <div className="flex justify-center">
                      <div
                        role="switch"
                        aria-checked={v.required}
                        onClick={() =>
                          updateVariable(i, "required", !v.required)
                        }
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                          v.required ? "bg-accent" : "bg-secondary border-border"
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                            v.required ? "translate-x-4" : "translate-x-0"
                          }`}
                        />
                      </div>
                    </div>
                    <button
                      onClick={() => removeVariable(i)}
                      className="rounded p-1 text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Active toggle */}
          <div className="flex items-center gap-3">
            <div
              role="switch"
              aria-checked={form.isActive}
              onClick={() => setForm({ ...form, isActive: !form.isActive })}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                form.isActive ? "bg-accent" : "bg-secondary"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  form.isActive ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </div>
            <span className="text-sm text-foreground">
              {form.isActive ? "Activo" : "Inactivo"}
            </span>
          </div>

          {/* Actions */}
          <div className="flex justify-between pt-2">
            <div className="flex items-center gap-2">
              <button
                onClick={handlePreview}
                disabled={!form.htmlTemplate.trim()}
                className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-40"
              >
                <Eye size={14} />
                Vista Previa
              </button>
              {editingId && (
                <button
                  onClick={() => setTestTemplateId(editingId as Id<"deliverableTemplates">)}
                  className="inline-flex items-center gap-2 rounded-md border border-accent/40 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/5 cursor-pointer"
                >
                  🧪 Probar con datos reales
                </button>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={closeForm}
                className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90 transition-colors disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Plus size={14} />
                )}
                {editingId ? "Guardar Cambios" : "Crear"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================== */}
      {/*  PREVIEW MODAL                                               */}
      {/* ========================================================== */}
      {previewHtml !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="relative max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-lg border border-border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold text-foreground">
                  Vista Previa
                </h3>
                {previewMissing.length > 0 && (
                  <p className="mt-1 text-xs text-red-400">
                    Variables faltantes: {previewMissing.join(", ")}
                  </p>
                )}
              </div>
              <button
                onClick={() => {
                  setPreviewHtml(null);
                  setPreviewMissing([]);
                }}
                className="rounded p-1.5 text-muted-foreground hover:bg-secondary transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="overflow-y-auto p-6" style={{ maxHeight: "calc(85vh - 72px)" }}>
              <div
                className="prose prose-invert max-w-none rounded-md border border-border bg-white p-6 text-black"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ========================================================== */}
      {/*  TABLE                                                       */}
      {/* ========================================================== */}
      <div className="rounded-lg border border-border bg-card">
        {filtered === undefined ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <FileText size={40} className="mb-3 opacity-40" />
            <p className="text-sm">No hay templates registrados</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <th className="px-6 py-3">Nombre</th>
                <th className="px-6 py-3">Tipo</th>
                <th className="px-6 py-3">Servicio</th>
                <th className="px-6 py-3">Org</th>
                <th className="px-6 py-3">Variables</th>
                <th className="px-6 py-3">Version</th>
                <th className="px-6 py-3">Activo</th>
                <th className="px-6 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((template) => (
                <tr
                  key={template._id as string}
                  className="hover:bg-secondary/50 transition-colors cursor-pointer"
                  onClick={() =>
                    openEdit({
                      _id: template._id as string,
                      name: template.name,
                      type: template.type as TemplateType,
                      serviceId: template.serviceId as string | undefined,
                      serviceName: template.serviceName,
                      orgId: template.orgId ?? undefined,
                      htmlTemplate: template.htmlTemplate,
                      variables: template.variables as Variable[],
                      isActive: template.isActive,
                    })
                  }
                >
                  <td className="px-6 py-4 text-sm font-medium text-foreground">
                    {template.name}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        TYPE_COLORS[template.type as TemplateType]
                      }`}
                    >
                      {TYPE_LABELS[template.type as TemplateType]}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">
                    {template.serviceName || "-"}
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">
                    {template.orgId ? (
                      <span className="inline-flex items-center rounded-full bg-purple-500/10 px-2 py-0.5 text-xs font-medium text-purple-400">
                        {template.orgId.substring(0, 12)}...
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Global
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">
                    {template.variables.length}
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">
                    v{template.version}
                  </td>
                  <td className="px-6 py-4">
                    <div
                      role="switch"
                      aria-checked={template.isActive}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggle(template._id as string);
                      }}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                        template.isActive ? "bg-accent" : "bg-secondary"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                          template.isActive ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDuplicate(template._id as string);
                      }}
                      className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                      title="Duplicar template"
                    >
                      <Copy size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {testTemplateId && (
        <TestDeliverableModal
          templateId={testTemplateId}
          onClose={() => setTestTemplateId(null)}
        />
      )}
    </div>
  );
}
