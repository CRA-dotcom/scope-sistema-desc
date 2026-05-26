"use client";

import { useQuery } from "convex/react";
import { AlertTriangle } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";

type Props = {
  projectionId: Id<"projections">;
};

/**
 * Banner amarillo al top de /proyecciones/[id] que advierte cuando hay
 * subservicios activos sin plantilla con contentStatus="ready".
 * Non-blocking: solo informacional. Spec §5.1
 */
export function MissingContentBanner({ projectionId }: Props) {
  const missing = useQuery(
    api.functions.projections.queries.subservicesMissingContent,
    { projectionId }
  );

  if (!missing || missing.length === 0) return null;

  const isSingular = missing.length === 1;

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 mb-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" />
        <div className="flex-1 text-sm">
          <p className="font-medium text-amber-200 mb-1">
            {isSingular
              ? "1 subservicio activo sin contenido real"
              : `${missing.length} subservicios activos sin contenido real`}
          </p>
          <p className="text-amber-200/70 mb-2">
            Estos entregables se generarán con HTML placeholder hasta que se
            cargue el contenido real:
          </p>
          <ul className="list-disc list-inside space-y-0.5 text-amber-200/90">
            {missing.map((m) => (
              <li key={m.subserviceId}>
                <span className="font-medium">{m.serviceName}</span> ·{" "}
                {m.subserviceName}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
