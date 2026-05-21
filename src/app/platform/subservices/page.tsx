"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useState, useEffect } from "react";
import {
  Plus,
  ChevronRight,
  ChevronDown,
  Edit,
  Trash2,
  Users,
  X,
  Loader2,
  Layers,
} from "lucide-react";

type Frequency = "mensual" | "trimestral" | "semestral" | "anual" | "una_vez";

type GlobalSub = {
  _id: Id<"subservices">;
  parentServiceId: Id<"services">;
  name: string;
  slug: string;
  description?: string;
  defaultFrequency: Frequency;
  applicableMonths?: number[];
  cooldownMonths?: number;
  defaultPricingHint?: number;
  isCommission?: boolean;
  sortOrder: number;
  isActive: boolean;
};

type ParentService = {
  _id: Id<"services">;
  name: string;
};

const FREQUENCY_LABELS: Record<Frequency, string> = {
  mensual: "Mensual",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
  una_vez: "Una vez",
};

export default function GlobalSubservicesPage() {
  const subs = useQuery(
    api.functions.subservices.queries.listGlobalsForAdmin
  ) as GlobalSub[] | undefined;
  const services = useQuery(
    api.functions.services.queries.listAllForAdmin
  ) as ParentService[] | undefined;

  const createGlobal = useMutation(
    api.functions.subservices.globalMutations.createGlobal
  );
  const updateGlobal = useMutation(
    api.functions.subservices.globalMutations.updateGlobal
  );
  const deleteGlobal = useMutation(
    api.functions.subservices.globalMutations.deleteGlobal
  );

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{
    id?: Id<"subservices">;
    parentServiceId?: Id<"services">;
  } | null>(null);
  const [clonesModalFor, setClonesModalFor] = useState<Id<"subservices"> | null>(
    null
  );

  if (!subs || !services) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  const byParent = new Map<string, GlobalSub[]>();
  for (const s of subs) {
    const key = s.parentServiceId as string;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(s);
  }

  const toggleExpand = (parentId: string) => {
    const next = new Set(expanded);
    if (next.has(parentId)) next.delete(parentId);
    else next.add(parentId);
    setExpanded(next);
  };

  const handleDelete = async (id: Id<"subservices">) => {
    try {
      await deleteGlobal({ id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("orgs tienen copias")) {
        if (
          confirm(
            `${msg}\n\n¿Eliminar solo el global, dejando los clones huérfanos?`
          )
        ) {
          await deleteGlobal({ id, force: true });
        }
      } else {
        alert(msg);
      }
    }
  };

  const sortedServices = [...services].sort((a, b) =>
    a.name.localeCompare(b.name, "es")
  );

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Layers className="text-accent" size={28} />
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Subservicios globales
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Catálogo base disponible a todas las orgs. Editable solo aquí.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setEditing({})}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90"
        >
          <Plus size={16} /> Crear subservicio global
        </button>
      </header>

      <div className="space-y-3">
        {sortedServices.map((svc) => {
          const children = byParent.get(svc._id as string) ?? [];
          const isOpen = expanded.has(svc._id as string);
          return (
            <div
              key={svc._id as string}
              className="overflow-hidden rounded-lg border border-border bg-card"
            >
              <button
                type="button"
                onClick={() => toggleExpand(svc._id as string)}
                className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-foreground hover:bg-secondary/50"
              >
                {isOpen ? (
                  <ChevronDown size={16} />
                ) : (
                  <ChevronRight size={16} />
                )}
                {svc.name}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  ({children.length})
                </span>
              </button>
              {isOpen && (
                <div className="border-t border-border">
                  {children.length === 0 ? (
                    <div className="px-6 py-4 text-sm text-muted-foreground">
                      Sin subservicios globales.
                      <button
                        type="button"
                        onClick={() =>
                          setEditing({
                            parentServiceId: svc._id as Id<"services">,
                          })
                        }
                        className="ml-2 text-accent hover:underline"
                      >
                        + Crear uno
                      </button>
                    </div>
                  ) : (
                    <table className="w-full">
                      <tbody className="divide-y divide-border">
                        {children.map((sub) => (
                          <tr key={sub._id as string} className="text-sm">
                            <td className="px-6 py-3 text-foreground">
                              {sub.name}
                              {!sub.isActive && (
                                <span className="ml-2 text-xs text-muted-foreground">
                                  (inactivo)
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-3 text-xs text-muted-foreground capitalize">
                              {FREQUENCY_LABELS[sub.defaultFrequency]}
                            </td>
                            <td className="px-6 py-3 text-xs">
                              <CloneCountChip
                                subId={sub._id}
                                onClick={() => setClonesModalFor(sub._id)}
                              />
                            </td>
                            <td className="px-6 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => setEditing({ id: sub._id })}
                                aria-label="Editar"
                                className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                              >
                                <Edit size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(sub._id)}
                                aria-label="Eliminar"
                                className="ml-1 rounded p-1.5 text-red-400 hover:bg-red-500/10"
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editing && (
        <GlobalSubserviceFormModal
          data={editing}
          subs={subs}
          services={sortedServices}
          create={createGlobal}
          update={updateGlobal}
          onClose={() => setEditing(null)}
        />
      )}
      {clonesModalFor && (
        <ClonesModal
          globalSubserviceId={clonesModalFor}
          onClose={() => setClonesModalFor(null)}
        />
      )}
    </div>
  );
}

function CloneCountChip({
  subId,
  onClick,
}: {
  subId: Id<"subservices">;
  onClick: () => void;
}) {
  const clones = useQuery(
    api.functions.subservices.globalMutations.listOrgsWithClones,
    { globalSubserviceId: subId }
  );
  if (!clones) return <span className="text-muted-foreground">…</span>;
  if (clones.length === 0)
    return <span className="text-muted-foreground">0 clones</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-accent hover:underline"
    >
      <Users size={12} />
      {clones.length} {clones.length === 1 ? "clon" : "clones"}
    </button>
  );
}

type FormState = {
  parentServiceId: string;
  name: string;
  defaultFrequency: Frequency;
  description: string;
  applicableMonths: string; // CSV (e.g. "1,4,7,10")
  cooldownMonths: string;
  defaultPricingHint: string;
  sortOrder: string;
  isCommission: boolean;
  isActive: boolean;
};

function GlobalSubserviceFormModal({
  data,
  subs,
  services,
  create,
  update,
  onClose,
}: {
  data: { id?: Id<"subservices">; parentServiceId?: Id<"services"> };
  subs: GlobalSub[];
  services: ParentService[];
  create: ReturnType<
    typeof useMutation<typeof api.functions.subservices.globalMutations.createGlobal>
  >;
  update: ReturnType<
    typeof useMutation<typeof api.functions.subservices.globalMutations.updateGlobal>
  >;
  onClose: () => void;
}) {
  const isEdit = !!data.id;
  const existing = isEdit ? subs.find((s) => s._id === data.id) : undefined;

  const [form, setForm] = useState<FormState>({
    parentServiceId:
      (existing?.parentServiceId as string) ??
      (data.parentServiceId as string) ??
      "",
    name: existing?.name ?? "",
    defaultFrequency: existing?.defaultFrequency ?? "mensual",
    description: existing?.description ?? "",
    applicableMonths: existing?.applicableMonths?.join(",") ?? "",
    cooldownMonths: existing?.cooldownMonths?.toString() ?? "",
    defaultPricingHint: existing?.defaultPricingHint?.toString() ?? "",
    sortOrder: existing?.sortOrder?.toString() ?? "100",
    isCommission: existing?.isCommission ?? false,
    isActive: existing?.isActive ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ESC key closes modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const parseMonths = (csv: string): number[] | undefined => {
    const trimmed = csv.trim();
    if (!trimmed) return undefined;
    return trimmed
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= 12);
  };

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      if (!form.name.trim()) {
        setError("El nombre es requerido.");
        setSaving(false);
        return;
      }
      const applicableMonths = parseMonths(form.applicableMonths);
      const cooldownMonths = form.cooldownMonths
        ? parseInt(form.cooldownMonths, 10)
        : undefined;
      const defaultPricingHint = form.defaultPricingHint
        ? parseFloat(form.defaultPricingHint)
        : undefined;
      const sortOrder = form.sortOrder
        ? parseInt(form.sortOrder, 10)
        : undefined;

      if (isEdit && data.id) {
        const result = await update({
          id: data.id,
          patch: {
            name: form.name.trim(),
            description: form.description.trim() || undefined,
            defaultFrequency: form.defaultFrequency,
            applicableMonths,
            cooldownMonths,
            defaultPricingHint,
            isCommission: form.isCommission,
            sortOrder,
            isActive: form.isActive,
          },
        });
        if (result.clonesAffected > 0) {
          alert(
            `Cambio aplicado. ${result.clonesAffected} orgs con clones NO recibirán esta actualización.`
          );
        }
      } else {
        if (!form.parentServiceId) {
          setError("Selecciona un servicio padre.");
          setSaving(false);
          return;
        }
        await create({
          parentServiceId: form.parentServiceId as Id<"services">,
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          defaultFrequency: form.defaultFrequency,
          applicableMonths,
          cooldownMonths,
          defaultPricingHint,
          isCommission: form.isCommission,
          sortOrder,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="form-title"
    >
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 id="form-title" className="text-lg font-semibold text-foreground">
            {isEdit ? "Editar subservicio global" : "Crear subservicio global"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400">
              {error}
            </div>
          )}

          <Field label="Servicio padre">
            <select
              value={form.parentServiceId}
              onChange={(e) =>
                setForm({ ...form, parentServiceId: e.target.value })
              }
              disabled={isEdit}
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm disabled:opacity-60"
            >
              <option value="">Selecciona…</option>
              {services.map((s) => (
                <option key={s._id as string} value={s._id as string}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Nombre">
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Descripción">
            <textarea
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              rows={2}
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Frecuencia">
              <select
                value={form.defaultFrequency}
                onChange={(e) =>
                  setForm({
                    ...form,
                    defaultFrequency: e.target.value as Frequency,
                  })
                }
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm"
              >
                {(Object.keys(FREQUENCY_LABELS) as Frequency[]).map((f) => (
                  <option key={f} value={f}>
                    {FREQUENCY_LABELS[f]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Sort order">
              <input
                type="number"
                value={form.sortOrder}
                onChange={(e) =>
                  setForm({ ...form, sortOrder: e.target.value })
                }
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm"
              />
            </Field>
          </div>

          <Field label="Meses aplicables (1-12, separados por coma)">
            <input
              type="text"
              value={form.applicableMonths}
              onChange={(e) =>
                setForm({ ...form, applicableMonths: e.target.value })
              }
              placeholder="ej. 1,4,7,10"
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Cooldown (meses)">
              <input
                type="number"
                value={form.cooldownMonths}
                onChange={(e) =>
                  setForm({ ...form, cooldownMonths: e.target.value })
                }
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm"
              />
            </Field>

            <Field label="Precio sugerido (MXN)">
              <input
                type="number"
                value={form.defaultPricingHint}
                onChange={(e) =>
                  setForm({ ...form, defaultPricingHint: e.target.value })
                }
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm"
              />
            </Field>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isCommission}
              onChange={(e) =>
                setForm({ ...form, isCommission: e.target.checked })
              }
              className="h-4 w-4 accent-accent"
            />
            Es comisión
          </label>

          {isEdit && (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) =>
                  setForm({ ...form, isActive: e.target.checked })
                }
                className="h-4 w-4 accent-accent"
              />
              Activo
            </label>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border bg-secondary/30 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {isEdit ? "Guardar" : "Crear"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function ClonesModal({
  globalSubserviceId,
  onClose,
}: {
  globalSubserviceId: Id<"subservices">;
  onClose: () => void;
}) {
  const clones = useQuery(
    api.functions.subservices.globalMutations.listOrgsWithClones,
    { globalSubserviceId }
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clones-title"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2
            id="clones-title"
            className="text-lg font-semibold text-foreground"
          >
            Orgs con clon
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-4">
          {!clones ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : clones.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ninguna org ha personalizado este subservicio.
            </p>
          ) : (
            <ul className="space-y-2">
              {clones.map((c) => (
                <li
                  key={c.cloneId as string}
                  className="flex items-center justify-between rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm"
                >
                  <div>
                    <div className="font-medium text-foreground">
                      {c.orgName}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Actualizado:{" "}
                      {new Date(c.lastUpdated).toLocaleDateString("es-MX")}
                    </div>
                  </div>
                  {!c.isActive && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      inactivo
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
