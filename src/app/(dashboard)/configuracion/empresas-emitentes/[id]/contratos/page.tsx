"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../../../../convex/_generated/api";
import { useParams } from "next/navigation";
import type { Id } from "../../../../../../../convex/_generated/dataModel";
import Link from "next/link";
import { ChevronLeft, FileText } from "lucide-react";

export default function EmpresaContratosPage() {
  const params = useParams();
  const issuingCompanyId = params.id as Id<"issuingCompanies">;

  const company = useQuery(api.functions.issuingCompanies.queries.getById, {
    id: issuingCompanyId,
  });
  const templates = useQuery(
    api.functions.deliverableTemplates.queries.listByIssuingCompany,
    { issuingCompanyId },
  );

  if (company === undefined || templates === undefined) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-card" />
        <div className="h-64 animate-pulse rounded-lg border border-border bg-card" />
      </div>
    );
  }

  if (company === null) {
    return (
      <div className="rounded-lg border border-border bg-card p-12 text-center">
        <p className="text-lg font-medium">Empresa no encontrada</p>
        <Link
          href="/configuracion/empresas-emitentes"
          className="mt-3 inline-block text-sm text-accent hover:underline cursor-pointer"
        >
          Volver al listado
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        href={`/configuracion/empresas-emitentes/${issuingCompanyId}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <ChevronLeft size={16} /> {company.name}
      </Link>

      <div className="flex items-center gap-3">
        <FileText className="text-accent" size={28} />
        <div>
          <h1 className="text-2xl font-bold">Contratos — {company.name}</h1>
          <p className="text-sm text-muted-foreground">
            Templates de contrato para esta empresa emisora. Uno por subservicio.
          </p>
        </div>
      </div>

      {templates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground">
          Sin contratos cargados. Usá el bulk-import CLI o creá uno manual desde{" "}
          <Link
            href="/configuracion/plantillas"
            className="text-accent hover:underline cursor-pointer"
          >
            Plantillas
          </Link>
          .
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground border-b border-border bg-secondary/40">
              <tr>
                <th className="px-4 py-3 font-medium">Subservicio</th>
                <th className="px-4 py-3 font-medium">Nombre</th>
                <th className="px-4 py-3 font-medium">Contenido</th>
                <th className="px-4 py-3 font-medium">signerMode</th>
                <th className="px-4 py-3 font-medium">v</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr
                  key={t._id}
                  className="border-b border-border last:border-b-0 hover:bg-secondary/20 transition-colors"
                >
                  <td className="px-4 py-3 text-muted-foreground">
                    {t.subserviceName ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-medium">{t.name}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        t.contentStatus === "ready"
                          ? "inline-block rounded px-2 py-0.5 text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                          : "inline-block rounded px-2 py-0.5 text-xs bg-amber-500/10 text-amber-400 border border-amber-500/30"
                      }
                    >
                      {t.contentStatus ?? "placeholder"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {t.signerMode ?? "client_only"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {t.version}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/configuracion/plantillas/${t._id}`}
                      className="text-accent hover:underline text-xs cursor-pointer"
                    >
                      Editar
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
