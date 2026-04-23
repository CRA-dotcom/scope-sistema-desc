"use client";

import Link from "next/link";
import { Building2, ChevronLeft } from "lucide-react";
import { IssuingCompanyForm } from "@/components/configuracion/empresas-emitentes/IssuingCompanyForm";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function NuevaEmpresaPage() {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const isAdmin =
    user?.organizationMemberships?.[0]?.role === "org:admin";

  useEffect(() => {
    if (isLoaded && !isAdmin) {
      router.replace("/configuracion/empresas-emitentes");
    }
  }, [isLoaded, isAdmin, router]);

  if (!isLoaded || !isAdmin) return null;

  return (
    <div className="space-y-6">
      <Link
        href="/configuracion/empresas-emitentes"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <ChevronLeft size={16} /> Empresas Emitentes
      </Link>

      <div className="flex items-center gap-3">
        <Building2 className="text-accent" size={28} />
        <h1 className="text-2xl font-bold">Nueva empresa emitente</h1>
      </div>

      <IssuingCompanyForm mode="create" />
    </div>
  );
}
