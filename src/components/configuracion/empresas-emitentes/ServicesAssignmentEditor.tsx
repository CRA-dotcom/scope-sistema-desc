"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useState, useEffect } from "react";
import { useOrganization } from "@clerk/nextjs";

export function ServicesAssignmentEditor({
  companyId,
}: {
  companyId: Id<"issuingCompanies">;
}) {
  const { membership } = useOrganization();
  const isAdmin = membership?.role === "org:admin";

  const available = useQuery(
    api.functions.issuingCompanies.queries.listAvailableServices,
    isAdmin ? {} : "skip"
  );
  const assign = useMutation(
    api.functions.issuingCompanies.mutations.assignServicesToCompany
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (available) {
      const initial = new Set(
        available
          .filter((s) => s.assignedTo?.issuingCompanyId === companyId)
          .map((s) => s.serviceId)
      );
      setSelected(initial);
      setDirty(false);
    }
  }, [available, companyId]);

  function toggle(serviceId: string) {
    if (!isAdmin) return;
    setDirty(true);
    setSaved(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(serviceId)) next.delete(serviceId);
      else next.add(serviceId);
      return next;
    });
  }

  async function save() {
    setLoading(true);
    setError(null);
    try {
      await assign({
        issuingCompanyId: companyId,
        serviceIds: Array.from(selected) as Id<"services">[],
      });
      setDirty(false);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (!isAdmin) {
    return (
      <p className="text-sm text-muted-foreground">
        Solo un administrador puede modificar las asignaciones de servicios.
      </p>
    );
  }

  if (available === undefined) {
    return <div className="h-40 animate-pulse rounded-md bg-card" />;
  }

  if (available.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay servicios en esta organización.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Marca los servicios que esta empresa emite. Los servicios ya asignados a
        otra empresa se moverán aquí si los marcas.
      </p>

      <div className="space-y-2">
        {available.map((s) => {
          const isChecked = selected.has(s.serviceId);
          const assignedElsewhere =
            s.assignedTo && s.assignedTo.issuingCompanyId !== companyId;
          return (
            <label
              key={s.serviceId}
              className="flex items-start gap-3 rounded-md border border-border bg-card p-3 transition-colors cursor-pointer hover:border-accent/30"
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => toggle(s.serviceId)}
                className="mt-0.5 accent-accent"
              />
              <div className="flex-1">
                <p className="text-sm font-medium">{s.serviceName}</p>
                {assignedElsewhere && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Actualmente asignado a{" "}
                    <strong className="text-foreground">
                      {s.assignedTo?.name}
                    </strong>
                    {isChecked ? " — se moverá a esta empresa al guardar" : ""}
                  </p>
                )}
              </div>
            </label>
          );
        })}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && <p className="text-sm text-accent">Asignaciones guardadas.</p>}

      <button
        onClick={save}
        disabled={!dirty || loading}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-primary hover:bg-accent/90 transition-colors disabled:opacity-50 cursor-pointer"
      >
        {loading ? "Guardando..." : "Guardar asignaciones"}
      </button>
    </div>
  );
}
