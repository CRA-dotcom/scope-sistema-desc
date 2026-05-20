"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useQuery, useMutation } from "convex/react";
import { useOrganization } from "@clerk/nextjs";
import {
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Layers,
  Plus,
  Copy,
  Pencil,
  RotateCcw,
  Eye,
  EyeOff,
  Trash2,
  Loader2,
} from "lucide-react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

type Frequency = "mensual" | "trimestral" | "semestral" | "anual" | "una_vez";

type Subservice = {
  _id: Id<"subservices">;
  orgId?: string;
  parentServiceId: Id<"services">;
  name: string;
  slug: string;
  description?: string;
  defaultFrequency: Frequency;
  applicableMonths?: number[];
  cooldownMonths?: number;
  defaultPricingHint?: number;
  isCommission?: boolean;
  isActive: boolean;
  isDefault: boolean;
  sortOrder: number;
  parentSubserviceId?: Id<"subservices">;
  originalVersionAtClone?: number;
  createdAt: number;
  updatedAt: number;
};

const FREQUENCY_OPTIONS: { value: Frequency; label: string }[] = [
  { value: "mensual", label: "Mensual" },
  { value: "trimestral", label: "Trimestral" },
  { value: "semestral", label: "Semestral" },
  { value: "anual", label: "Anual" },
  { value: "una_vez", label: "Una vez" },
];

export default function SubserviciosPage() {
  const { membership } = useOrganization();
  const isAdmin = membership?.role === "org:admin";

  const subservices = useQuery(
    api.functions.subservices.queries.listAllForOrg
  );
  const services = useQuery(api.functions.services.queries.listGlobal);

  const personalizeGlobal = useMutation(
    api.functions.subservices.mutations.personalizeGlobal
  );
  const toggleActive = useMutation(
    api.functions.subservices.mutations.toggleActive
  );
  const removeSubservice = useMutation(
    api.functions.subservices.mutations.remove
  );
  const restoreToGlobal = useMutation(
    api.functions.subservices.mutations.restoreToGlobal
  );

  const [expandedParents, setExpandedParents] = useState<Set<string>>(
    new Set()
  );
  const [pendingDelete, setPendingDelete] = useState<Subservice | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Edit/Create drawer state
  const [editor, setEditor] = useState<
    | {
        mode: "create";
        parentServiceId: Id<"services">;
        parentName: string;
      }
    | { mode: "edit"; subservice: Subservice; parentName: string }
    | null
  >(null);

  // Group subservices by parent
  const grouped = useMemo(() => {
    if (!subservices || !services) return new Map<string, Subservice[]>();
    const map = new Map<string, Subservice[]>();
    for (const svc of services) {
      map.set(svc._id, []);
    }
    for (const sub of subservices as Subservice[]) {
      const arr = map.get(sub.parentServiceId) ?? [];
      arr.push(sub);
      map.set(sub.parentServiceId, arr);
    }
    // sort each bucket
    for (const [k, v] of map.entries()) {
      map.set(
        k,
        [...v].sort((a, b) => a.sortOrder - b.sortOrder)
      );
    }
    return map;
  }, [subservices, services]);

  function toggleExpanded(parentId: string) {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(parentId)) next.delete(parentId);
      else next.add(parentId);
      return next;
    });
  }

  async function handlePersonalize(sub: Subservice) {
    setErrorMessage(null);
    setBusyId(sub._id);
    try {
      await personalizeGlobal({ sourceId: sub._id });
    } catch (err) {
      setErrorMessage((err as Error).message ?? "Error al personalizar.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggle(sub: Subservice) {
    setErrorMessage(null);
    setBusyId(sub._id);
    try {
      await toggleActive({ id: sub._id });
    } catch (err) {
      setErrorMessage((err as Error).message ?? "Error al cambiar estado.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(sub: Subservice) {
    setErrorMessage(null);
    setBusyId(sub._id);
    try {
      await removeSubservice({ id: sub._id });
      setPendingDelete(null);
    } catch (err) {
      setErrorMessage((err as Error).message ?? "Error al eliminar.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRestore(sub: Subservice) {
    setErrorMessage(null);
    setBusyId(sub._id);
    try {
      await restoreToGlobal({ id: sub._id });
    } catch (err) {
      setErrorMessage((err as Error).message ?? "Error al restaurar.");
    } finally {
      setBusyId(null);
    }
  }

  if (subservices === undefined || services === undefined) {
    return (
      <div className="space-y-6">
        <Link
          href="/configuracion"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <ChevronLeft size={16} /> Configuración
        </Link>
        <div className="flex items-center gap-3">
          <Layers className="text-accent" size={28} />
          <h1 className="text-2xl font-bold">Subservicios</h1>
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

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Layers className="text-accent" size={28} />
          <div>
            <h1 className="text-2xl font-bold">Subservicios</h1>
            <p className="text-sm text-muted-foreground">
              Configura el catálogo de subservicios contractuales de tu org.
            </p>
          </div>
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

      <div className="space-y-3">
        {services.map((svc) => {
          const parentId = svc._id as string;
          const isExpanded = expandedParents.has(parentId);
          const children = grouped.get(parentId) ?? [];
          return (
            <section
              key={parentId}
              className="rounded-lg border border-border bg-card"
              data-testid={`parent-${parentId}`}
            >
              <button
                type="button"
                onClick={() => toggleExpanded(parentId)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 hover:bg-secondary/40 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  {isExpanded ? (
                    <ChevronDown size={16} className="text-muted-foreground" />
                  ) : (
                    <ChevronRight size={16} className="text-muted-foreground" />
                  )}
                  <span className="font-medium">{svc.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {children.length} subservicio
                    {children.length === 1 ? "" : "s"}
                  </span>
                </div>
                {isAdmin && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditor({
                        mode: "create",
                        parentServiceId: svc._id as Id<"services">,
                        parentName: svc.name,
                      });
                      setExpandedParents((prev) => {
                        const next = new Set(prev);
                        next.add(parentId);
                        return next;
                      });
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-secondary transition-colors cursor-pointer"
                  >
                    <Plus size={12} /> Agregar
                  </span>
                )}
              </button>

              {isExpanded && (
                <div className="border-t border-border">
                  {children.length === 0 ? (
                    <p className="px-6 py-4 text-sm text-muted-foreground">
                      Aún no hay subservicios bajo este servicio padre.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {children.map((sub) => (
                        <SubserviceRow
                          key={sub._id}
                          subservice={sub}
                          isAdmin={isAdmin}
                          busy={busyId === sub._id}
                          onPersonalize={() => handlePersonalize(sub)}
                          onEdit={() =>
                            setEditor({
                              mode: "edit",
                              subservice: sub,
                              parentName: svc.name,
                            })
                          }
                          onToggle={() => handleToggle(sub)}
                          onRestore={() => handleRestore(sub)}
                          onRequestDelete={() => setPendingDelete(sub)}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {editor && (
        <SubserviceEditorDrawer
          editor={editor}
          onClose={() => setEditor(null)}
          onError={(msg) => setErrorMessage(msg)}
        />
      )}

      {pendingDelete && (
        <DeleteConfirmDialog
          subservice={pendingDelete}
          busy={busyId === pendingDelete._id}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => handleDelete(pendingDelete)}
        />
      )}
    </div>
  );
}

function SubserviceRow({
  subservice,
  isAdmin,
  busy,
  onPersonalize,
  onEdit,
  onToggle,
  onRestore,
  onRequestDelete,
}: {
  subservice: Subservice;
  isAdmin: boolean;
  busy: boolean;
  onPersonalize: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onRestore: () => void;
  onRequestDelete: () => void;
}) {
  const isGlobal = subservice.orgId === undefined;
  return (
    <li className="flex items-center justify-between gap-3 px-6 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{subservice.name}</span>
            <span className="text-xs text-muted-foreground">
              · {subservice.defaultFrequency}
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
            {!subservice.isActive && (
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                Inactivo
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground truncate">
            slug: <code className="font-mono">{subservice.slug}</code>
            {subservice.description ? ` · ${subservice.description}` : ""}
          </p>
        </div>
      </div>

      {isAdmin && (
        <div className="flex items-center gap-1">
          {isGlobal ? (
            <button
              type="button"
              onClick={onPersonalize}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-secondary transition-colors disabled:opacity-50 cursor-pointer"
              title="Personalizar para mi org"
            >
              {busy ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Copy size={12} />
              )}
              Personalizar
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onEdit}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-secondary transition-colors disabled:opacity-50 cursor-pointer"
                title="Editar"
              >
                <Pencil size={12} /> Editar
              </button>
              <button
                type="button"
                onClick={onToggle}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-secondary transition-colors disabled:opacity-50 cursor-pointer"
                title={subservice.isActive ? "Desactivar" : "Reactivar"}
              >
                {subservice.isActive ? (
                  <>
                    <EyeOff size={12} /> Desactivar
                  </>
                ) : (
                  <>
                    <Eye size={12} /> Reactivar
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={onRestore}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-secondary transition-colors disabled:opacity-50 cursor-pointer"
                title="Volver al default global"
              >
                <RotateCcw size={12} /> Volver al default
              </button>
              <button
                type="button"
                onClick={onRequestDelete}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-md border border-red-400/40 bg-red-400/10 px-2 py-1 text-xs text-red-400 hover:bg-red-400/20 transition-colors disabled:opacity-50 cursor-pointer"
                title="Eliminar"
              >
                <Trash2 size={12} /> Eliminar
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function SubserviceEditorDrawer({
  editor,
  onClose,
  onError,
}: {
  editor:
    | {
        mode: "create";
        parentServiceId: Id<"services">;
        parentName: string;
      }
    | { mode: "edit"; subservice: Subservice; parentName: string };
  onClose: () => void;
  onError: (msg: string) => void;
}) {
  const createMut = useMutation(api.functions.subservices.mutations.create);
  const updateMut = useMutation(api.functions.subservices.mutations.update);

  const initial =
    editor.mode === "edit"
      ? editor.subservice
      : ({
          name: "",
          slug: "",
          description: "",
          defaultFrequency: "mensual" as Frequency,
          sortOrder: 100,
          cooldownMonths: 0,
          defaultPricingHint: undefined,
          isCommission: false,
        } as Partial<Subservice>);

  const [name, setName] = useState(initial.name ?? "");
  const [slug, setSlug] = useState(initial.slug ?? "");
  const [description, setDescription] = useState(initial.description ?? "");
  const [defaultFrequency, setDefaultFrequency] = useState<Frequency>(
    (initial.defaultFrequency as Frequency) ?? "mensual"
  );
  const [sortOrder, setSortOrder] = useState(initial.sortOrder ?? 100);
  const [cooldownMonths, setCooldownMonths] = useState(
    initial.cooldownMonths ?? 0
  );
  const [defaultPricingHint, setDefaultPricingHint] = useState<number | "">(
    initial.defaultPricingHint ?? ""
  );
  const [isCommission, setIsCommission] = useState(
    initial.isCommission ?? false
  );
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (editor.mode === "create") {
        await createMut({
          parentServiceId: editor.parentServiceId,
          name,
          slug: slug.trim() || undefined,
          description: description.trim() || undefined,
          defaultFrequency,
          sortOrder,
          cooldownMonths,
          defaultPricingHint:
            defaultPricingHint === "" ? undefined : defaultPricingHint,
          isCommission,
        });
      } else {
        await updateMut({
          id: editor.subservice._id,
          patch: {
            name,
            description: description.trim() || undefined,
            defaultFrequency,
            sortOrder,
            cooldownMonths,
            defaultPricingHint:
              defaultPricingHint === "" ? undefined : defaultPricingHint,
            isCommission,
          },
        });
      }
      onClose();
    } catch (err) {
      onError((err as Error).message ?? "Error al guardar.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={
        editor.mode === "create" ? "Crear subservicio" : "Editar subservicio"
      }
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-md overflow-y-auto border-l border-border bg-card p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">
          {editor.mode === "create"
            ? `Nuevo subservicio bajo ${editor.parentName}`
            : `Editar subservicio (${editor.parentName})`}
        </h2>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Nombre</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          {editor.mode === "create" && (
            <div className="space-y-1">
              <label className="text-sm font-medium">
                Slug{" "}
                <span className="text-xs text-muted-foreground">
                  (opcional, se deriva del nombre)
                </span>
              </label>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="kebab-case"
                pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm font-mono focus:border-accent focus:outline-none"
              />
            </div>
          )}
          <div className="space-y-1">
            <label className="text-sm font-medium">Descripción</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Frecuencia por defecto</label>
            <select
              value={defaultFrequency}
              onChange={(e) =>
                setDefaultFrequency(e.target.value as Frequency)
              }
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:border-accent focus:outline-none cursor-pointer"
            >
              {FREQUENCY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Cooldown (meses)</label>
              <input
                type="number"
                min={0}
                value={cooldownMonths}
                onChange={(e) => setCooldownMonths(Number(e.target.value))}
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Orden</label>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value))}
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">
              Precio sugerido (MXN, opcional)
            </label>
            <input
              type="number"
              min={0}
              value={defaultPricingHint}
              onChange={(e) =>
                setDefaultPricingHint(
                  e.target.value === "" ? "" : Number(e.target.value)
                )
              }
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={isCommission}
              onChange={(e) => setIsCommission(e.target.checked)}
              className="accent-accent"
            />
            ¿Es comisión? (override del padre)
          </label>
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
              {editor.mode === "create" ? "Crear" : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteConfirmDialog({
  subservice,
  busy,
  onCancel,
  onConfirm,
}: {
  subservice: Subservice;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirmar eliminación"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">Eliminar subservicio</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Vas a eliminar permanentemente{" "}
          <span className="font-medium text-foreground">{subservice.name}</span>
          . Esta acción es irreversible y será bloqueada si el subservicio está
          referenciado por proyecciones, cotizaciones, contratos, entregables o
          plantillas.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Si solo quieres ocultarlo, prefiere &quot;Desactivar&quot;.
        </p>
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
            className="inline-flex items-center gap-1 rounded-md bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {busy && <Loader2 size={12} className="animate-spin" />}
            Eliminar
          </button>
        </div>
      </div>
    </div>
  );
}
