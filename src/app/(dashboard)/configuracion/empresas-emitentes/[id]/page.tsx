"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import { Id } from "../../../../../../convex/_generated/dataModel";
import { Building2, ChevronLeft, Star } from "lucide-react";
import { IssuingCompanyDetailTabs } from "@/components/configuracion/empresas-emitentes/IssuingCompanyDetailTabs";

export default function DetalleEmpresaPage() {
  const { id } = useParams<{ id: string }>();
  const company = useQuery(
    api.functions.issuingCompanies.queries.getById,
    {
      id: id as Id<"issuingCompanies">,
    }
  );

  if (company === undefined) {
    return <div className="h-40 animate-pulse rounded-lg bg-card" />;
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
        href="/configuracion/empresas-emitentes"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <ChevronLeft size={16} /> Empresas Emitentes
      </Link>

      <div className="flex items-center gap-3 flex-wrap">
        <Building2 className="text-accent" size={28} />
        <h1 className="text-2xl font-bold">{company.name}</h1>
        {company.isDefault && (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-1 text-xs text-accent">
            <Star size={12} /> Default
          </span>
        )}
        {!company.isActive && (
          <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
            Inactiva
          </span>
        )}
      </div>

      <IssuingCompanyDetailTabs company={company} />
    </div>
  );
}
