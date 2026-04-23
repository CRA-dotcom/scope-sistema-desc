"use client";

import Link from "next/link";
import { Settings, Building2, ChevronRight } from "lucide-react";

const sections = [
  {
    href: "/configuracion/empresas-emitentes",
    icon: Building2,
    title: "Empresas Emitentes",
    description:
      "Personas morales que emiten cotizaciones, contratos y facturas.",
  },
];

export default function ConfiguracionPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="text-accent" size={28} />
        <h1 className="text-2xl font-bold">Configuración</h1>
      </div>

      <div className="space-y-2">
        {sections.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="flex items-center justify-between rounded-lg border border-border bg-card p-4 transition-colors hover:border-accent/30 cursor-pointer"
          >
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10">
                <s.icon className="text-accent" size={20} />
              </div>
              <div>
                <p className="font-medium">{s.title}</p>
                <p className="text-xs text-muted-foreground">{s.description}</p>
              </div>
            </div>
            <ChevronRight className="text-muted-foreground" size={18} />
          </Link>
        ))}
      </div>
    </div>
  );
}
