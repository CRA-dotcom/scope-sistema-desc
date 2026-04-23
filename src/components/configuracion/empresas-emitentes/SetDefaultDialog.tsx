"use client";

import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useState } from "react";

export function SetDefaultDialog({
  companyId,
  newName,
  currentName,
  onClose,
}: {
  companyId: Id<"issuingCompanies">;
  newName: string;
  currentName: string;
  onClose: () => void;
}) {
  const setDefault = useMutation(
    api.functions.issuingCompanies.mutations.setDefault
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setLoading(true);
    setError(null);
    try {
      await setDefault({ id: companyId });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg"
      >
        <h3 className="text-lg font-semibold">Cambiar empresa default</h3>
        <p className="mt-3 text-sm text-muted-foreground">
          Esto reemplaza{" "}
          <strong className="text-foreground">{currentName}</strong> como
          empresa default por{" "}
          <strong className="text-foreground">{newName}</strong>. Las nuevas
          cotizaciones sin asignación explícita se emitirán desde{" "}
          <strong className="text-foreground">{newName}</strong> en adelante.
        </p>
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-secondary transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            onClick={confirm}
            disabled={loading}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-primary hover:bg-accent/90 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {loading ? "Aplicando..." : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}
