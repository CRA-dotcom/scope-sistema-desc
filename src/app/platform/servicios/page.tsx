"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useState } from "react";
import {
  Briefcase,
  Plus,
  Pencil,
  Check,
  X,
  Loader2,
} from "lucide-react";

type EditingRow = {
  id: string;
  minPct: number;
  maxPct: number;
  defaultPct: number;
  isCommission: boolean;
};

type NewService = {
  name: string;
  type: "base" | "comodin";
  orgId: string;
  minPct: number;
  maxPct: number;
  defaultPct: number;
  isCommission: boolean;
  sortOrder: number;
};

const emptyNewService: NewService = {
  name: "",
  type: "base",
  orgId: "",
  minPct: 0,
  maxPct: 100,
  defaultPct: 10,
  isCommission: false,
  sortOrder: 99,
};

export default function ServiciosPage() {
  const services = useQuery(api.functions.services.queries.listAllForAdmin);
  const updateService = useMutation(api.functions.services.mutations.updateForAdmin);
  const createService = useMutation(api.functions.services.mutations.createCustomForAdmin);

  const [editing, setEditing] = useState<EditingRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newService, setNewService] = useState<NewService>(emptyNewService);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEdit = (service: {
    _id: string;
    minPct: number;
    maxPct: number;
    defaultPct: number;
    isCommission?: boolean;
  }) => {
    setEditing({
      id: service._id,
      minPct: service.minPct,
      maxPct: service.maxPct,
      defaultPct: service.defaultPct,
      isCommission: service.isCommission ?? false,
    });
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      await updateService({
        serviceId: editing.id as Id<"services">,
        minPct: editing.minPct,
        maxPct: editing.maxPct,
        defaultPct: editing.defaultPct,
        isCommission: editing.isCommission,
      });
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleCommission = async (serviceId: string, current: boolean) => {
    setError(null);
    try {
      await updateService({
        serviceId: serviceId as Id<"services">,
        isCommission: !current,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al actualizar");
    }
  };

  const handleCreate = async () => {
    if (!newService.name.trim()) {
      setError("El nombre del servicio es requerido.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await createService({
        name: newService.name.trim(),
        type: newService.type,
        orgId: newService.orgId.trim() || undefined,
        minPct: newService.minPct,
        maxPct: newService.maxPct,
        defaultPct: newService.defaultPct,
        isCommission: newService.isCommission,
        sortOrder: newService.sortOrder,
      });
      setNewService(emptyNewService);
      setShowCreate(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear servicio");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Servicios Globales</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Catalogo de servicios disponibles en la plataforma
          </p>
        </div>
        <button
          onClick={() => {
            setShowCreate(!showCreate);
            setError(null);
          }}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90 transition-colors"
        >
          <Plus size={16} />
          Crear Servicio
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Create Service Form */}
      {showCreate && (
        <div className="rounded-lg border border-accent/30 bg-card p-6 space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Nuevo Servicio</h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                Nombre
              </label>
              <input
                type="text"
                value={newService.name}
                onChange={(e) => setNewService({ ...newService, name: e.target.value })}
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                placeholder="Nombre del servicio"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                Tipo
              </label>
              <select
                value={newService.type}
                onChange={(e) =>
                  setNewService({ ...newService, type: e.target.value as "base" | "comodin" })
                }
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="base">Base</option>
                <option value="comodin">Comodin</option>
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                Org ID (opcional, vacio = global)
              </label>
              <input
                type="text"
                value={newService.orgId}
                onChange={(e) => setNewService({ ...newService, orgId: e.target.value })}
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                placeholder="org_xxxxxxxxx"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                % Default
              </label>
              <input
                type="number"
                value={newService.defaultPct}
                onChange={(e) =>
                  setNewService({ ...newService, defaultPct: Number(e.target.value) })
                }
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                min={0}
                max={100}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                % Min
              </label>
              <input
                type="number"
                value={newService.minPct}
                onChange={(e) =>
                  setNewService({ ...newService, minPct: Number(e.target.value) })
                }
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                min={0}
                max={100}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                % Max
              </label>
              <input
                type="number"
                value={newService.maxPct}
                onChange={(e) =>
                  setNewService({ ...newService, maxPct: Number(e.target.value) })
                }
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                min={0}
                max={100}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                Orden
              </label>
              <input
                type="number"
                value={newService.sortOrder}
                onChange={(e) =>
                  setNewService({ ...newService, sortOrder: Number(e.target.value) })
                }
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                min={0}
              />
            </div>

            <div className="flex items-end">
              <label className="flex cursor-pointer items-center gap-3 pb-2">
                <div
                  role="switch"
                  aria-checked={newService.isCommission}
                  onClick={() =>
                    setNewService({ ...newService, isCommission: !newService.isCommission })
                  }
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    newService.isCommission ? "bg-accent" : "bg-secondary"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      newService.isCommission ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </div>
                <span className="text-sm text-foreground">Es Comisión</span>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={() => {
                setShowCreate(false);
                setNewService(emptyNewService);
                setError(null);
              }}
              className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90 transition-colors disabled:opacity-50"
            >
              {creating ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Plus size={14} />
              )}
              Crear
            </button>
          </div>
        </div>
      )}

      {/* Services Table */}
      <div className="rounded-lg border border-border bg-card">
        {services === undefined ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : services.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Briefcase size={40} className="mb-3 opacity-40" />
            <p className="text-sm">No hay servicios registrados</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <th className="px-6 py-3">Nombre</th>
                <th className="px-6 py-3">Tipo</th>
                <th className="px-6 py-3">% Default</th>
                <th className="px-6 py-3">Rango %</th>
                <th className="px-6 py-3">Orden</th>
                <th className="px-6 py-3">Default</th>
                <th className="px-6 py-3">Comisión</th>
                <th className="px-6 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {services.map((service) => {
                const isEditing = editing?.id === (service._id as string);
                return (
                  <tr
                    key={service._id}
                    className="hover:bg-secondary/50 transition-colors"
                  >
                    <td className="px-6 py-4 text-sm font-medium text-foreground">
                      {service.name}
                      {service.orgId && (
                        <span className="ml-2 inline-flex items-center rounded-full bg-purple-500/10 px-2 py-0.5 text-xs font-medium text-purple-400">
                          org
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          service.type === "base"
                            ? "bg-blue-500/10 text-blue-400"
                            : "bg-amber-500/10 text-amber-400"
                        }`}
                      >
                        {service.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">
                      {isEditing ? (
                        <input
                          type="number"
                          value={editing.defaultPct}
                          onChange={(e) =>
                            setEditing({ ...editing, defaultPct: Number(e.target.value) })
                          }
                          className="w-20 rounded border border-border bg-secondary px-2 py-1 text-sm text-foreground focus:border-accent focus:outline-none"
                          min={0}
                          max={100}
                        />
                      ) : (
                        <>{service.defaultPct}%</>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">
                      {isEditing ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={editing.minPct}
                            onChange={(e) =>
                              setEditing({ ...editing, minPct: Number(e.target.value) })
                            }
                            className="w-16 rounded border border-border bg-secondary px-2 py-1 text-sm text-foreground focus:border-accent focus:outline-none"
                            min={0}
                            max={100}
                          />
                          <span className="text-muted-foreground">-</span>
                          <input
                            type="number"
                            value={editing.maxPct}
                            onChange={(e) =>
                              setEditing({ ...editing, maxPct: Number(e.target.value) })
                            }
                            className="w-16 rounded border border-border bg-secondary px-2 py-1 text-sm text-foreground focus:border-accent focus:outline-none"
                            min={0}
                            max={100}
                          />
                        </div>
                      ) : (
                        <>
                          {service.minPct}% - {service.maxPct}%
                        </>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">
                      {service.sortOrder}
                    </td>
                    <td className="px-6 py-4">
                      {service.isDefault ? (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-green-500/10 text-green-500 text-xs">
                          &#10003;
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {isEditing ? (
                        <div
                          role="switch"
                          aria-checked={editing.isCommission}
                          onClick={() =>
                            setEditing({ ...editing, isCommission: !editing.isCommission })
                          }
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                            editing.isCommission ? "bg-accent" : "bg-secondary"
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                              editing.isCommission ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </div>
                      ) : (
                        <div
                          role="switch"
                          aria-checked={service.isCommission ?? false}
                          onClick={() =>
                            handleToggleCommission(
                              service._id as string,
                              service.isCommission ?? false
                            )
                          }
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                            service.isCommission ? "bg-accent" : "bg-secondary"
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                              service.isCommission ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {isEditing ? (
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={handleSaveEdit}
                            disabled={saving}
                            className="rounded p-1.5 text-green-400 hover:bg-green-500/10 transition-colors disabled:opacity-50"
                            title="Guardar"
                          >
                            {saving ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Check size={14} />
                            )}
                          </button>
                          <button
                            onClick={() => setEditing(null)}
                            className="rounded p-1.5 text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Cancelar"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleEdit(service)}
                          className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                          title="Editar benchmarks"
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
