"use client";

import { useState, useMemo, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import { Id } from "../../../../../../convex/_generated/dataModel";
import { useAuth } from "@clerk/nextjs";
import { ArrowLeft, Save, Settings2 } from "lucide-react";
import Link from "next/link";

/**
 * #1 — Post-creation subservices picker.
 *
 * After a projection is created the user can navigate here (from the detail
 * page "Configurar subservicios" button) to assign which subservices apply to
 * each active service — decoupled from the wizard so the wizard can remain
 * lightweight (no mandatory selection at creation time if the user prefers to
 * configure later).
 *
 * Route: /proyecciones/[id]/subservicios
 */

export default function ConfigurarSubserviciosPage() {
  const params = useParams();
  const router = useRouter();
  const projectionId = params.id as Id<"projections">;

  const { isLoaded, orgId } = useAuth();
  const authReady = isLoaded && !!orgId;

  const matrix = useQuery(
    api.functions.projections.queries.getMatrix,
    authReady ? { projectionId } : "skip"
  );

  const allSubservices = useQuery(
    api.functions.subservices.queries.listAllForOrg,
    authReady ? {} : "skip"
  );

  const setSubserviceIds = useMutation(
    api.functions.projectionServices.mutations.setSubserviceIds
  );

  // Local state: map projServiceId → selected subservice IDs (string[])
  // Initialized from whatever is currently saved on each projectionService row.
  const initialSelections = useMemo(() => {
    if (!matrix) return new Map<string, string[]>();
    const map = new Map<string, string[]>();
    for (const svc of matrix.services) {
      if (!svc.isActive) continue;
      const saved: string[] = svc.subserviceIds
        ? (svc.subserviceIds as string[])
        : [];
      map.set(svc._id as string, saved);
    }
    return map;
  }, [matrix]);

  const [selections, setSelections] = useState<Map<string, string[]>>(
    () => new Map()
  );
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);

  // Hydrate local state once matrix + subservices are loaded (only once).
  // Using useEffect avoids triggering a re-render mid-render-cycle, which
  // can cause React warnings and subtle state-ordering bugs when Convex
  // subscriptions resolve asynchronously.
  useEffect(() => {
    if (!hydrated && matrix && allSubservices) {
      setSelections(initialSelections);
      setHydrated(true);
    }
  }, [hydrated, matrix, allSubservices, initialSelections]);

  // Group active subservices by parentServiceId.
  const subservicesByParent = useMemo(() => {
    const map = new Map<
      string,
      Array<{ _id: string; name: string; defaultFrequency: string }>
    >();
    if (!allSubservices) return map;
    for (const sub of allSubservices) {
      if (!sub.isActive) continue;
      const arr = map.get(sub.parentServiceId as string) ?? [];
      arr.push({
        _id: sub._id as string,
        name: sub.name,
        defaultFrequency: sub.defaultFrequency,
      });
      map.set(sub.parentServiceId as string, arr);
    }
    return map;
  }, [allSubservices]);

  const activeServices = matrix?.services.filter((s) => s.isActive) ?? [];

  function toggleSubservice(projServiceId: string, subId: string) {
    setSelections((prev) => {
      const current = prev.get(projServiceId) ?? [];
      const next = current.includes(subId)
        ? current.filter((id) => id !== subId)
        : [...current, subId];
      const updated = new Map(prev);
      updated.set(projServiceId, next);
      return updated;
    });
    setSavedOk(false);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setSavedOk(false);
    try {
      // Parallelize: all projectionService patches are independent — no shared
      // state — so firing them concurrently halves round-trips on large service
      // lists. Convex serializes writes server-side, so no transaction conflicts.
      await Promise.all(
        activeServices.map((svc) => {
          const chosen = selections.get(svc._id as string) ?? [];
          return setSubserviceIds({
            projServiceId: svc._id as Id<"projectionServices">,
            subserviceIds: chosen.map((id) => id as Id<"subservices">),
          });
        })
      );
      setSavedOk(true);
    } catch (err) {
      setSaveError((err as Error).message || "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  if (matrix === undefined || allSubservices === undefined) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-secondary" />
        <div className="h-64 animate-pulse rounded-lg border border-border bg-card" />
      </div>
    );
  }

  if (matrix === null) {
    return (
      <div className="space-y-4">
        <Link
          href="/proyecciones"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <ArrowLeft size={14} /> Volver a Proyecciones
        </Link>
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <p className="text-lg font-medium">Proyección no encontrada</p>
        </div>
      </div>
    );
  }

  const projection = matrix.projection;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href={`/proyecciones/${projectionId}`}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <ArrowLeft size={14} />
          Volver a la proyección
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <Settings2 className="text-accent" size={24} />
        <h1 className="text-xl font-bold">
          Configurar subservicios — {projection.year}
        </h1>
      </div>

      <p className="text-sm text-muted-foreground">
        Asigna los subservicios que aplican a cada servicio activo de esta
        proyección. Puedes modificarlos en cualquier momento sin re-crear la
        proyección.
      </p>

      <div className="space-y-4">
        {activeServices.length === 0 && (
          <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
            Esta proyección no tiene servicios activos.
          </div>
        )}

        {activeServices.map((svc) => {
          const subOptions = subservicesByParent.get(svc.serviceId as string) ?? [];
          const chosen = selections.get(svc._id as string) ?? [];

          return (
            <div
              key={svc._id}
              className="rounded-lg border border-border bg-card p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <p className="font-medium text-sm">{svc.serviceName}</p>
                {chosen.length > 0 && (
                  <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent">
                    {chosen.length} seleccionado{chosen.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>

              {subOptions.length === 0 ? (
                <p className="text-xs text-amber-400">
                  Este servicio no tiene subservicios configurados aún.
                  Configúralos en{" "}
                  <Link
                    href="/configuracion/subservicios"
                    className="underline hover:no-underline"
                  >
                    /configuracion/subservicios
                  </Link>
                  .
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {subOptions.map((sub) => {
                    const isChecked = chosen.includes(sub._id);
                    return (
                      <label
                        key={sub._id}
                        className="flex items-center gap-2 text-sm cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() =>
                            toggleSubservice(svc._id as string, sub._id)
                          }
                          aria-label={`Subservicio ${sub.name} para ${svc.serviceName}`}
                          className="accent-accent"
                        />
                        <span>
                          {sub.name}{" "}
                          <span className="text-xs text-muted-foreground">
                            · {sub.defaultFrequency}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => router.push(`/proyecciones/${projectionId}`)}
          className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-secondary transition-colors cursor-pointer"
        >
          Cancelar
        </button>

        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || activeServices.length === 0}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2 text-sm font-medium text-primary hover:bg-accent/90 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Save size={14} />
            {saving ? "Guardando..." : "Guardar"}
          </button>
          {saveError && (
            <p className="text-xs text-red-400 max-w-xs text-right">
              {saveError}
            </p>
          )}
          {savedOk && (
            <p className="text-xs text-accent">Guardado correctamente.</p>
          )}
        </div>
      </div>
    </div>
  );
}
