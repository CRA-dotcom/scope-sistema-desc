"use client";

import Link from "next/link";
import { Plug, ChevronLeft } from "lucide-react";
import { useOrganization } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ResendSetupGuide } from "@/components/integraciones/resend/ResendSetupGuide";
import { ResendConfigForm } from "@/components/integraciones/resend/ResendConfigForm";

export default function ResendIntegrationPage() {
  const { membership, isLoaded } = useOrganization();
  const router = useRouter();
  const isAdmin = membership?.role === "org:admin";

  useEffect(() => {
    if (isLoaded && !isAdmin) {
      router.replace("/configuracion/email-log");
    }
  }, [isLoaded, isAdmin, router]);

  if (!isLoaded || !isAdmin) return null;

  return (
    <div className="space-y-6">
      <Link
        href="/configuracion"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <ChevronLeft size={16} /> Configuración
      </Link>

      <div className="flex items-center gap-3">
        <Plug className="text-accent" size={28} />
        <h1 className="text-2xl font-bold">Integración Resend</h1>
      </div>

      <p className="text-sm text-muted-foreground max-w-2xl">
        Conecta tu cuenta de Resend para enviar emails desde tu propio dominio.
        Si no configuras esto, se usa un dominio de plataforma compartido por
        defecto.
      </p>

      <ResendSetupGuide />
      <ResendConfigForm />
    </div>
  );
}
