"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";

export function DeleteConfirmDialog({
  companyId,
  companyName,
  onClose,
}: {
  companyId: Id<"issuingCompanies">;
  companyName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const refs = useQuery(
    api.functions.issuingCompanies.queries.countReferences,
    { id: companyId }
  );
  const remove = useMutation(
    api.functions.issuingCompanies.mutations.remove
  );
  const [typed, setTyped] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (typed !== companyName) return;
    setLoading(true);
    setError(null);
    try {
      await remove({ id: companyId });
      onClose();
      router.push("/configuracion/empresas-emitentes");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const hasRefs = refs !== undefined && refs.total > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-lg"
      >
        <div className="flex items-center gap-3">
          <AlertTriangle className="text-destructive" size={24} />
          <h3 className="text-lg font-semibold">Borrar permanentemente</h3>
        </div>

        {refs === undefined ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Verificando referencias...
          </p>
        ) : hasRefs ? (
          <div className="mt-4 space-y-3 text-sm">
            <p className="text-destructive">
              Esta empresa no puede borrarse porque tiene referencias:
            </p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {refs.emailLog > 0 && <li>{refs.emailLog} email(s) enviado(s)</li>}
              {refs.serviceMap > 0 && (
                <li>{refs.serviceMap} asignación(es) de servicio</li>
              )}
              {refs.clientOverride > 0 && (
                <li>{refs.clientOverride} override(s) por cliente</li>
              )}
            </ul>
            <p className="text-muted-foreground">
              Desactívala en lugar de borrarla.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-3 text-sm">
            <p className="text-muted-foreground">
              Esta acción es irreversible. Para confirmar, escribe el nombre de
              la empresa:
            </p>
            <p className="font-mono text-foreground">{companyName}</p>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:border-destructive focus:outline-none focus:ring-1 focus:ring-destructive"
              placeholder="Escribe el nombre exacto"
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-secondary transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          {!hasRefs && (
            <button
              onClick={confirm}
              disabled={loading || typed !== companyName || refs === undefined}
              className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {loading ? "Borrando..." : "Borrar"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
