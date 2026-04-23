"use client";

import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";

export function DangerZone({
  companyId,
  companyName,
  isActive,
  isDefault,
}: {
  companyId: Id<"issuingCompanies">;
  companyName: string;
  isActive: boolean;
  isDefault: boolean;
}) {
  const updateCompany = useMutation(
    api.functions.issuingCompanies.mutations.update
  );
  const [loading, setLoading] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleActive() {
    setLoading(true);
    setError(null);
    try {
      await updateCompany({ id: companyId, isActive: !isActive });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-warning/40 bg-warning/5 p-4">
        <h4 className="text-sm font-semibold text-warning">
          {isActive ? "Desactivar empresa" : "Reactivar empresa"}
        </h4>
        <p className="mt-2 text-sm text-muted-foreground">
          {isActive
            ? "La empresa dejará de aparecer en resoluciones nuevas de cotizaciones/contratos, pero sus registros históricos se preservan."
            : "La empresa volverá a estar disponible para emitir documentos."}
        </p>
        {isDefault && isActive && (
          <p className="mt-2 text-xs text-destructive">
            No puedes desactivar la empresa default. Marca otra como default
            primero.
          </p>
        )}
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        <button
          onClick={toggleActive}
          disabled={loading || (isDefault && isActive)}
          className="mt-3 rounded-md border border-warning px-3 py-1.5 text-sm text-warning hover:bg-warning/10 transition-colors disabled:opacity-50 cursor-pointer"
        >
          {loading ? "Aplicando..." : isActive ? "Desactivar" : "Reactivar"}
        </button>
      </div>

      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <h4 className="text-sm font-semibold text-destructive">
          Borrar permanentemente
        </h4>
        <p className="mt-2 text-sm text-muted-foreground">
          Borra la empresa de la base de datos. Solo permitido si no tiene
          referencias (emails, asignaciones, overrides).
        </p>
        {isDefault && (
          <p className="mt-2 text-xs text-destructive">
            No puedes borrar la empresa default.
          </p>
        )}
        <button
          onClick={() => setShowDelete(true)}
          disabled={isDefault}
          className="mt-3 flex items-center gap-2 rounded-md border border-destructive px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50 cursor-pointer"
        >
          <Trash2 size={14} /> Borrar permanentemente
        </button>
      </div>

      {showDelete && (
        <DeleteConfirmDialog
          companyId={companyId}
          companyName={companyName}
          onClose={() => setShowDelete(false)}
        />
      )}
    </div>
  );
}
