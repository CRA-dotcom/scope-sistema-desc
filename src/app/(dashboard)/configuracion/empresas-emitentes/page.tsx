"use client";

import Link from "next/link";
import { Building2, ChevronLeft } from "lucide-react";
import { IssuingCompanyList } from "@/components/configuracion/empresas-emitentes/IssuingCompanyList";

export default function EmpresasEmitentesPage() {
  return (
    <div className="space-y-6">
      <Link
        href="/configuracion"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <ChevronLeft size={16} /> Configuración
      </Link>

      <div className="flex items-center gap-3">
        <Building2 className="text-accent" size={28} />
        <h1 className="text-2xl font-bold">Empresas Emitentes</h1>
      </div>

      <IssuingCompanyList />
    </div>
  );
}
