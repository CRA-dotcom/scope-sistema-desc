"use client";

/**
 * D2 §4.6 — `/configuracion/frecuencias` (read-only placeholder)
 *
 * Shows the default cadence per subservice grouped by parent service. Each
 * row links to `/configuracion/subservicios?focus={id}` so the operator can
 * edit. Per spec §8 Q7 the focus param is best-effort — if A1 hasn't wired
 * it the link still navigates, just without highlight.
 *
 * No auth gate — operators (admin + member) can both view their org's
 * cadence; editing requires admin and happens in the Subservicios page.
 */

import Link from "next/link";
import {
  CalendarClock,
  ChevronLeft,
  Info,
  ArrowRight,
} from "lucide-react";
import { useQuery } from "convex/react";
import { useMemo } from "react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

type Subservice = {
  _id: Id<"subservices">;
  name: string;
  parentServiceId: Id<"services">;
  defaultFrequency:
    | "mensual"
    | "trimestral"
    | "semestral"
    | "anual"
    | "una_vez";
  isActive: boolean;
  sortOrder: number;
  orgId?: string;
};

type Service = {
  _id: Id<"services">;
  name: string;
};

const FREQUENCY_LABELS: Record<Subservice["defaultFrequency"], string> = {
  mensual: "Mensual",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
  una_vez: "Una vez",
};

export default function FrecuenciasPage() {
  const services = useQuery(api.functions.services.queries.listByOrg) as
    | Service[]
    | undefined;
  const subservices = useQuery(
    api.functions.subservices.queries.listAllForOrg
  ) as Subservice[] | undefined;

  // Group active subservices by parentServiceId.
  const grouped = useMemo(() => {
    if (!services || !subservices) return null;
    const byService = new Map<Id<"services">, Subservice[]>();
    for (const sub of subservices) {
      if (!sub.isActive) continue;
      const arr = byService.get(sub.parentServiceId) ?? [];
      arr.push(sub);
      byService.set(sub.parentServiceId, arr);
    }
    return services
      .map((svc) => ({
        service: svc,
        subs: (byService.get(svc._id) ?? []).sort(
          (a, b) => a.sortOrder - b.sortOrder
        ),
      }))
      .filter((g) => g.subs.length > 0);
  }, [services, subservices]);

  return (
    <div className="space-y-6">
      <Link
        href="/configuracion"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <ChevronLeft size={16} aria-hidden="true" /> Configuración
      </Link>

      <div className="flex items-center gap-3">
        <CalendarClock
          className="text-accent"
          size={28}
          aria-hidden="true"
        />
        <div>
          <h1 className="text-2xl font-bold">Frecuencias</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Cadencia con la que se generan entregables por subservicio.
          </p>
        </div>
      </div>

      <div
        className="flex items-start gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-300"
        role="note"
        data-testid="frecuencias-banner"
      >
        <Info size={16} className="mt-0.5" aria-hidden="true" />
        <span>
          Override por cliente estará disponible en una versión futura.
          Mientras tanto, la frecuencia es por subservicio.
        </span>
      </div>

      {grouped === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-16 w-full animate-pulse rounded bg-secondary"
            />
          ))}
        </div>
      ) : grouped.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Aún no hay subservicios configurados. Ve a{" "}
          <Link
            href="/configuracion/subservicios"
            className="text-accent hover:underline"
          >
            Subservicios
          </Link>{" "}
          para crearlos.
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(({ service, subs }) => (
            <section
              key={service._id}
              className="rounded-lg border border-border bg-card overflow-hidden"
              aria-labelledby={`frec-svc-${service._id}`}
            >
              <h2
                id={`frec-svc-${service._id}`}
                className="border-b border-border bg-secondary/30 px-4 py-2 text-sm font-medium"
              >
                {service.name}
              </h2>
              <table className="w-full text-sm">
                <tbody>
                  {subs.map((sub) => (
                    <tr
                      key={sub._id}
                      className="border-b border-border last:border-0"
                      data-testid={`frec-row-${sub._id}`}
                    >
                      <td className="px-4 py-3 font-medium">{sub.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {FREQUENCY_LABELS[sub.defaultFrequency]}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/configuracion/subservicios?focus=${sub._id}`}
                          className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent/80"
                          data-testid={`frec-edit-${sub._id}`}
                        >
                          Editar en Subservicios{" "}
                          <ArrowRight size={12} aria-hidden="true" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
