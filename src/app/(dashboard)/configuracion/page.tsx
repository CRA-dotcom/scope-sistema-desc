"use client";

/**
 * D2 §4.1 — Hub `/configuracion` expandido a 9 cards en 5 secciones.
 *
 * Sections (in order, per spec §2.3 mockup):
 *   - Catálogo: Empresas Emitentes · Subservicios · Plantillas
 *   - Equipo: Usuarios · Frecuencias
 *   - Comunicación: Notificaciones · Email Log
 *   - Identidad: Branding
 *   - Proveedores: Integraciones (Resend + Firmame + Railway)
 *
 * No auth gating here — entries that require `org:admin` enforce it on
 * their own pages (Usuarios, Branding, Notificaciones, Integraciones).
 */

import Link from "next/link";
import {
  Settings,
  Building2,
  Mail,
  Plug,
  ChevronRight,
  Layers,
  FileText,
  Users,
  CalendarClock,
  Bell,
  Palette,
} from "lucide-react";

const groups = [
  {
    label: "Catálogo",
    items: [
      {
        href: "/configuracion/empresas-emitentes",
        icon: Building2,
        title: "Empresas Emitentes",
        description:
          "Personas morales que emiten cotizaciones, contratos y facturas.",
      },
      {
        href: "/configuracion/subservicios",
        icon: Layers,
        title: "Subservicios",
        description:
          "Catálogo de subservicios contractuales de tu org (Legal → Compliance, etc.).",
      },
      {
        href: "/configuracion/plantillas",
        icon: FileText,
        title: "Plantillas",
        description:
          "Plantillas de entregables, cotizaciones y contratos editables por servicio.",
      },
    ],
  },
  {
    label: "Equipo",
    items: [
      {
        href: "/configuracion/usuarios",
        icon: Users,
        title: "Usuarios",
        description:
          "Ejecutivos de la org y a qué clientes están asignados.",
      },
      {
        href: "/configuracion/frecuencias",
        icon: CalendarClock,
        title: "Frecuencias",
        description:
          "Cadencia por defecto de cada subservicio (mensual, trimestral, etc.).",
      },
    ],
  },
  {
    label: "Comunicación",
    items: [
      {
        href: "/configuracion/notificaciones",
        icon: Bell,
        title: "Notificaciones",
        description:
          "Email destino, recordatorios diarios y preferencias por evento.",
      },
      {
        href: "/configuracion/email-log",
        icon: Mail,
        title: "Email Log",
        description: "Historial de emails enviados por la plataforma.",
      },
    ],
  },
  {
    label: "Identidad",
    items: [
      {
        href: "/configuracion/branding",
        icon: Palette,
        title: "Branding",
        description:
          "Logo, colores y footer aplicado a documentos generados.",
      },
    ],
  },
  {
    label: "Proveedores",
    items: [
      {
        href: "/configuracion/integraciones",
        icon: Plug,
        title: "Integraciones",
        description:
          "Resend (email), Firmame (firma digital), Railway (blob storage).",
      },
    ],
  },
] as const;

export default function ConfiguracionPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="text-accent" size={28} aria-hidden="true" />
        <h1 className="text-2xl font-bold">Configuración</h1>
      </div>

      {groups.map((group) => (
        <section
          key={group.label}
          className="space-y-2"
          aria-labelledby={`config-group-${group.label}`}
        >
          <h2
            id={`config-group-${group.label}`}
            className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
          >
            {group.label}
          </h2>
          {group.items.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="flex items-center justify-between rounded-lg border border-border bg-card p-4 transition-colors hover:border-accent/30 cursor-pointer"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10">
                  <s.icon
                    className="text-accent"
                    size={20}
                    aria-hidden="true"
                  />
                </div>
                <div>
                  <p className="font-medium">{s.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.description}
                  </p>
                </div>
              </div>
              <ChevronRight
                className="text-muted-foreground"
                size={18}
                aria-hidden="true"
              />
            </Link>
          ))}
        </section>
      ))}
    </div>
  );
}
