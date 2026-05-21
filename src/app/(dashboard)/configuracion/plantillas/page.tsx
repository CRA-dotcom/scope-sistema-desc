"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { useOrganization } from "@clerk/nextjs";
import {
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  FileText,
  Plus,
  Copy,
  Pencil,
  RotateCcw,
  Loader2,
  X,
  AlertTriangle,
} from "lucide-react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

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

type Template = {
  _id: Id<"deliverableTemplates">;
  orgId?: string;
  serviceId?: Id<"services">;
  serviceName: string;
  subserviceId?: Id<"subservices">;
  type: TemplateType;
  name: string;
  htmlTemplate: string;
  variables: Variable[];
  version: number;
  isActive: boolean;
  parentTemplateId?: Id<"deliverableTemplates">;
  originalVersionAtClone?: number;
  createdAt: number;
  updatedAt: number;
};

type Subservice = {
  _id: Id<"subservices">;
  orgId?: string;
  parentServiceId: Id<"services">;
  name: string;
  slug: string;
  isActive: boolean;
  sortOrder: number;
};

type Service = {
  _id: Id<"services">;
  name: string;
};

// Type "invoice" is intentionally omitted — hidden from operator UI in beta
// (spec §3.4 #3, §4.1, §9 Q5). Super-admin still sees it in /platform/templates.
const OPERATOR_TYPE_OPTIONS: { value: Exclude<TemplateType, "invoice">; label: string }[] = [
  { value: "quotation", label: "Cotización" },
  { value: "contract", label: "Contrato" },
  { value: "deliverable_short", label: "Entregable Corto" },
  { value: "deliverable_long", label: "Entregable Largo" },
  { value: "questionnaire", label: "Cuestionario" },
];

const TYPE_LABELS: Record<TemplateType, string> = {
  quotation: "Cotización",
  contract: "Contrato",
  deliverable_short: "Entregable Corto",
  deliverable_long: "Entregable Largo",
  questionnaire: "Cuestionario",
  invoice: "Factura",
};

const TYPE_COLORS: Record<TemplateType, string> = {
  quotation: "bg-blue-500/10 text-blue-400",
  contract: "bg-purple-500/10 text-purple-400",
  deliverable_short: "bg-green-500/10 text-green-400",
  deliverable_long: "bg-teal-500/10 text-teal-400",
  questionnaire: "bg-amber-500/10 text-amber-400",
  invoice: "bg-rose-500/10 text-rose-400",
};

export default function PlantillasPage() {
  const router = useRouter();
  const { membership } = useOrganization();
  const isAdmin = membership?.role === "org:admin";
  const callerOrgId = membership?.organization?.id ?? null;

  const services = useQuery(api.functions.services.queries.listByOrg);
  const subservices = useQuery(
    api.functions.subservices.queries.listAllForOrg
  );
  const templates = useQuery(
    api.functions.deliverableTemplates.queries.listForOrg,
    {}
  );

  const personalizeGlobal = useMutation(
    api.functions.deliverableTemplates.mutations.personalizeGlobal
  );
  const restoreToGlobal = useMutation(
    api.functions.deliverableTemplates.mutations.restoreToGlobal
  );

  const [expandedServices, setExpandedServices] = useState<Set<string>>(
    new Set()
  );
  const [expandedSubservices, setExpandedSubservices] = useState<Set<string>>(
    new Set()
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<Template | null>(null);
  const [creator, setCreator] = useState<
    | {
        subservice: Subservice;
        service: Service;
      }
    | null
  >(null);

  // Build the Service → Subservice → Templates tree.
  // - Hides type "invoice" everywhere (beta operator UI flag).
  // - Hides inactive globals via listForOrg (it already filters them server-side).
  const tree = useMemo(() => {
    if (!services || !subservices || !templates) return null;
    const subsByService = new Map<string, Subservice[]>();
    for (const sub of subservices as Subservice[]) {
      const arr = subsByService.get(sub.parentServiceId as string) ?? [];
      arr.push(sub);
      subsByService.set(sub.parentServiceId as string, arr);
    }
    return (services as Service[]).map((svc) => ({
      service: svc,
      subservices: (subsByService.get(svc._id as string) ?? [])
        .filter((s) => s.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((sub) => ({
          subservice: sub,
          templates: (templates as Template[])
            .filter(
              (t) =>
                t.subserviceId === sub._id &&
                t.type !== "invoice" // operator-side filter
            )
            .sort((a, b) => a.name.localeCompare(b.name)),
        })),
    }));
  }, [services, subservices, templates]);

  function toggleService(id: string) {
    setExpandedServices((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSubservice(id: string) {
    setExpandedSubservices((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handlePersonalize(template: Template) {
    setErrorMessage(null);
    setInfoMessage(null);
    setBusyId(template._id);
    try {
      const newId = await personalizeGlobal({ globalTemplateId: template._id });
      setInfoMessage(
        "Plantilla personalizada para tu organización. Tus cambios ya no afectarán a otras orgs."
      );
      router.push(`/configuracion/plantillas/${newId}`);
    } catch (err) {
      setErrorMessage((err as Error).message ?? "Error al personalizar.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRestore(template: Template) {
    setErrorMessage(null);
    setInfoMessage(null);
    setBusyId(template._id);
    try {
      const result = await restoreToGlobal({ orgTemplateId: template._id });
      if (result.mode === "soft") {
        setInfoMessage(
          "La plantilla tenía entregables asociados; se desactivó (soft-delete) para preservar el historial."
        );
      } else {
        setInfoMessage(
          "Plantilla restaurada al default global de tu organización."
        );
      }
      setPendingRestore(null);
    } catch (err) {
      setErrorMessage((err as Error).message ?? "Error al restaurar.");
    } finally {
      setBusyId(null);
    }
  }

  if (
    services === undefined ||
    subservices === undefined ||
    templates === undefined
  ) {
    return (
      <div className="space-y-6">
        <Link
          href="/configuracion"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <ChevronLeft size={16} /> Configuración
        </Link>
        <div className="flex items-center gap-3">
          <FileText className="text-accent" size={28} />
          <h1 className="text-2xl font-bold">Plantillas</h1>
        </div>
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-lg border border-border bg-card"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        href="/configuracion"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <ChevronLeft size={16} /> Configuración
      </Link>

      <div className="flex items-center gap-3">
        <FileText className="text-accent" size={28} />
        <div>
          <h1 className="text-2xl font-bold">Plantillas</h1>
          <p className="text-sm text-muted-foreground">
            Edita las plantillas que tu org usa para generar entregables,
            cotizaciones y contratos.
          </p>
        </div>
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="rounded-md border border-red-400/40 bg-red-400/10 p-3 text-sm text-red-400"
        >
          {errorMessage}
        </div>
      )}

      {infoMessage && (
        <div
          role="status"
          className="rounded-md border border-accent/30 bg-accent/5 p-3 text-sm text-accent"
        >
          {infoMessage}
        </div>
      )}

      <div className="space-y-3">
        {tree && tree.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Aún no hay servicios disponibles para tu organización.
          </p>
        )}
        {tree?.map(({ service, subservices: subs }) => {
          const svcId = service._id as string;
          const svcOpen = expandedServices.has(svcId);
          return (
            <section
              key={svcId}
              data-testid={`service-${svcId}`}
              className="rounded-lg border border-border bg-card"
            >
              <button
                type="button"
                id={`templates-service-trigger-${svcId}`}
                onClick={() => toggleService(svcId)}
                aria-expanded={svcOpen}
                aria-controls={`templates-service-panel-${svcId}`}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-secondary/40 transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-3">
                  {svcOpen ? (
                    <ChevronDown size={16} className="text-muted-foreground" />
                  ) : (
                    <ChevronRight size={16} className="text-muted-foreground" />
                  )}
                  <span className="font-medium">{service.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {subs.length} subservicio{subs.length === 1 ? "" : "s"}
                  </span>
                </span>
              </button>

              {svcOpen && (
                <div
                  id={`templates-service-panel-${svcId}`}
                  role="region"
                  aria-labelledby={`templates-service-trigger-${svcId}`}
                  className="border-t border-border"
                >
                  {subs.length === 0 ? (
                    <p className="px-6 py-4 text-sm text-muted-foreground">
                      No hay subservicios bajo este servicio.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {subs.map(({ subservice, templates: tpls }) => {
                        const subId = subservice._id as string;
                        const subOpen = expandedSubservices.has(subId);
                        return (
                          <li
                            key={subId}
                            data-testid={`subservice-${subId}`}
                            className="px-4 py-2"
                          >
                            <button
                              type="button"
                              id={`templates-subservice-trigger-${subId}`}
                              onClick={() => toggleSubservice(subId)}
                              aria-expanded={subOpen}
                              aria-controls={`templates-subservice-panel-${subId}`}
                              className="flex w-full items-center justify-between gap-3 px-2 py-2 text-left hover:bg-secondary/30 rounded-md transition-colors cursor-pointer"
                            >
                              <span className="flex items-center gap-2">
                                {subOpen ? (
                                  <ChevronDown
                                    size={14}
                                    className="text-muted-foreground"
                                  />
                                ) : (
                                  <ChevronRight
                                    size={14}
                                    className="text-muted-foreground"
                                  />
                                )}
                                <span className="text-sm font-medium">
                                  {subservice.name}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {tpls.length} plantilla
                                  {tpls.length === 1 ? "" : "s"}
                                </span>
                              </span>
                            </button>

                            {subOpen && (
                              <div
                                id={`templates-subservice-panel-${subId}`}
                                role="region"
                                aria-labelledby={`templates-subservice-trigger-${subId}`}
                                className="ml-6 mt-2 space-y-2"
                              >
                                {tpls.length === 0 ? (
                                  <p className="px-2 py-2 text-xs text-muted-foreground">
                                    No hay plantillas todavía.
                                  </p>
                                ) : (
                                  <ul className="space-y-1">
                                    {tpls.map((tpl) => (
                                      <TemplateRow
                                        key={tpl._id}
                                        template={tpl}
                                        callerOrgId={callerOrgId}
                                        isAdmin={isAdmin}
                                        busy={busyId === tpl._id}
                                        onPersonalize={() =>
                                          handlePersonalize(tpl)
                                        }
                                        onEdit={() =>
                                          router.push(
                                            `/configuracion/plantillas/${tpl._id}`
                                          )
                                        }
                                        onRequestRestore={() =>
                                          setPendingRestore(tpl)
                                        }
                                      />
                                    ))}
                                  </ul>
                                )}
                                {isAdmin && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setCreator({ subservice, service })
                                    }
                                    data-testid={`new-template-btn-${subId}`}
                                    className="inline-flex items-center gap-1 rounded-md border border-dashed border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors cursor-pointer"
                                  >
                                    <Plus size={12} /> Nueva plantilla
                                  </button>
                                )}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {creator && (
        <NewTemplateDialog
          service={creator.service}
          subservice={creator.subservice}
          onClose={() => setCreator(null)}
          onError={(msg) => setErrorMessage(msg)}
          onCreated={(id) => {
            setCreator(null);
            setInfoMessage("Plantilla creada.");
            router.push(`/configuracion/plantillas/${id}`);
          }}
        />
      )}

      {pendingRestore && (
        <RestoreConfirmDialog
          template={pendingRestore}
          busy={busyId === pendingRestore._id}
          onCancel={() => setPendingRestore(null)}
          onConfirm={() => handleRestore(pendingRestore)}
        />
      )}
    </div>
  );
}

function TemplateRow({
  template,
  callerOrgId,
  isAdmin,
  busy,
  onPersonalize,
  onEdit,
  onRequestRestore,
}: {
  template: Template;
  callerOrgId: string | null;
  isAdmin: boolean;
  busy: boolean;
  onPersonalize: () => void;
  onEdit: () => void;
  onRequestRestore: () => void;
}) {
  // Spec §4.1: a template is "global" when orgId is undefined, "personalizada"
  // when the row belongs to the caller's org.
  const isGlobal = template.orgId === undefined;
  const isOrgScoped = !isGlobal && template.orgId === callerOrgId;
  const hasParent = template.parentTemplateId !== undefined;

  // For now we render "hay versión nueva del global" only when listForOrg
  // already includes the metadata. listForOrg doesn't compute hasNewerGlobal
  // (that's editor-side via getByIdWithBanner). Here we infer it visually
  // only via the editor banner — the tree just shows the chips.
  return (
    <li
      data-testid={`template-row-${template._id}`}
      className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background/40 px-3 py-2"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="text-sm font-medium truncate">{template.name}</span>
        <span className="text-xs text-muted-foreground">
          v{template.version}
        </span>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
            TYPE_COLORS[template.type]
          }`}
        >
          {TYPE_LABELS[template.type]}
        </span>
        {isGlobal ? (
          <span
            data-testid="badge-global"
            className="inline-flex items-center rounded-full border border-border bg-background px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
          >
            Global
          </span>
        ) : (
          <span
            data-testid="badge-personalizada"
            className="inline-flex items-center rounded-full bg-accent/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-accent"
          >
            Personalizada
          </span>
        )}
        {!template.isActive && (
          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            Inactivo
          </span>
        )}
      </div>

      {isAdmin && (
        <div className="flex items-center gap-1">
          {isGlobal && (
            <button
              type="button"
              onClick={onPersonalize}
              disabled={busy}
              data-testid="personalize-btn"
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-secondary transition-colors disabled:opacity-50 cursor-pointer"
              title="Personalizar para mi org"
            >
              {busy ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Copy size={12} />
              )}
              Personalizar para mi org
            </button>
          )}
          {isOrgScoped && (
            <>
              <button
                type="button"
                onClick={onEdit}
                disabled={busy}
                data-testid="edit-btn"
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-secondary transition-colors disabled:opacity-50 cursor-pointer"
                title="Editar plantilla"
              >
                <Pencil size={12} /> Editar
              </button>
              {hasParent && (
                <button
                  type="button"
                  onClick={onRequestRestore}
                  disabled={busy}
                  data-testid="restore-to-global-btn"
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-secondary transition-colors disabled:opacity-50 cursor-pointer"
                  title="Restaurar default global"
                >
                  <RotateCcw size={12} /> Restaurar default
                </button>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}

function NewTemplateDialog({
  service,
  subservice,
  onClose,
  onError,
  onCreated,
}: {
  service: Service;
  subservice: Subservice;
  onClose: () => void;
  onError: (msg: string) => void;
  onCreated: (id: Id<"deliverableTemplates">) => void;
}) {
  const createMut = useMutation(
    api.functions.deliverableTemplates.mutations.create
  );

  const [name, setName] = useState("");
  const [type, setType] = useState<Exclude<TemplateType, "invoice">>(
    "deliverable_short"
  );
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const id = await createMut({
        name: name.trim(),
        type,
        serviceId: service._id,
        serviceName: service.name,
        subserviceId: subservice._id,
        htmlTemplate: "<p>Placeholder — edita el HTML.</p>",
        variables: [],
        isActive: true,
        // orgId is intentionally NOT passed; the operator path forces own org
        // server-side (spec §3.3 create).
      });
      onCreated(id as Id<"deliverableTemplates">);
    } catch (err) {
      onError((err as Error).message ?? "Error al crear plantilla.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Crear nueva plantilla"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Nueva plantilla</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded p-1 text-muted-foreground hover:bg-secondary transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {service.name} → {subservice.name}
        </p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="space-y-1">
            <label htmlFor="new-template-name" className="text-sm font-medium">
              Nombre
            </label>
            <input
              id="new-template-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Cotización Marketing Digital"
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="new-template-type" className="text-sm font-medium">
              Tipo
            </label>
            <select
              id="new-template-type"
              value={type}
              onChange={(e) =>
                setType(e.target.value as Exclude<TemplateType, "invoice">)
              }
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:border-accent focus:outline-none cursor-pointer"
            >
              {OPERATOR_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="inline-flex items-center gap-1 rounded-md bg-accent px-4 py-2 text-sm font-medium text-primary hover:bg-accent/90 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {submitting && <Loader2 size={12} className="animate-spin" />}
              Crear
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RestoreConfirmDialog({
  template,
  busy,
  onCancel,
  onConfirm,
}: {
  template: Template;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirmar restaurar default"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="text-amber-400" size={22} />
          <div>
            <h2 className="text-lg font-semibold">Restaurar default global</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Vas a eliminar la versión personalizada de{" "}
              <span className="font-medium text-foreground">{template.name}</span>{" "}
              y tu org volverá a usar la plantilla global por defecto. Si la
              plantilla ya tiene entregables generados, se desactivará (soft-
              delete) para preservar el histórico.
            </p>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            data-testid="restore-confirm-btn"
            className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {busy && <Loader2 size={12} className="animate-spin" />}
            Restaurar default
          </button>
        </div>
      </div>
    </div>
  );
}
