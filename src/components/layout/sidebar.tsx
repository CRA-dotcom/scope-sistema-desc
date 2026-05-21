"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  TrendingUp,
  Settings,
  Briefcase,
  ClipboardList,
  FileText,
  FileSignature,
  FileOutput,
  Receipt,
  Building2,
  Activity,
  DollarSign,
  FileSearch,
  Layers,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { OrganizationSwitcher, UserButton, useUser } from "@clerk/nextjs";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Clientes", href: "/clientes", icon: Users },
  { name: "Proyecciones", href: "/proyecciones", icon: TrendingUp },
  { name: "Servicios", href: "/servicios", icon: Briefcase },
  { name: "Cuestionarios", href: "/cuestionarios", icon: ClipboardList },
  { name: "Cotizaciones", href: "/cotizaciones", icon: FileText },
  { name: "Contratos", href: "/contratos", icon: FileSignature },
  { name: "Entregables", href: "/entregables", icon: FileOutput },
  { name: "Facturación", href: "/facturacion", icon: Receipt },
  { name: "Configuración", href: "/configuracion", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const { user } = useUser();
  const isSuperAdmin = (user?.publicMetadata as Record<string, unknown>)?.role === "super_admin";

  return (
    <aside
      className={cn(
        "flex flex-col border-r border-border bg-card transition-all duration-200",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center justify-between border-b border-border px-4">
        {!collapsed && (
          <span className="text-xl font-bold text-accent">Projex</span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors cursor-pointer"
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {/* Org Switcher */}
      {!collapsed && (
        <div className="border-b border-border px-3 py-3">
          <OrganizationSwitcher
            appearance={{
              elements: {
                rootBox: "w-full",
                organizationSwitcherTrigger:
                  "w-full justify-start rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors",
              },
            }}
          />
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-2 py-4">
        {navigation.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors cursor-pointer",
                isActive
                  ? "bg-accent/10 text-accent"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
              title={collapsed ? item.name : undefined}
            >
              <item.icon size={20} />
              {!collapsed && <span>{item.name}</span>}
            </Link>
          );
        })}

        {/* Super Admin block — D1 7-entry menu (replaces the single-link panel). */}
        {isSuperAdmin && (
          <>
            <div className="my-3 border-t border-border" />
            {!collapsed && (
              <p className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-purple-400/60">
                Plataforma
              </p>
            )}
            {(
              [
                { href: "/platform", label: "Organizaciones", icon: Building2, exact: true },
                { href: "/platform/metrics", label: "Métricas", icon: Activity, exact: false },
                { href: "/platform/billing", label: "Billing", icon: DollarSign, exact: false },
                { href: "/platform/audit", label: "Audit log", icon: FileSearch, exact: false },
                { href: "/platform/subservices", label: "Subservicios", icon: Layers, exact: false },
                { href: "/platform/servicios", label: "Servicios (padre)", icon: Briefcase, exact: false },
                { href: "/platform/templates", label: "Plantillas", icon: FileText, exact: false },
              ] as const
            ).map((item) => {
              const isActive = item.exact
                ? pathname === item.href
                : pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
                    isActive
                      ? "bg-purple-500/15 text-purple-300"
                      : "text-purple-400/80 hover:bg-purple-500/10 hover:text-purple-300"
                  )}
                  title={collapsed ? item.label : undefined}
                >
                  <item.icon size={18} />
                  {!collapsed && <span>{item.label}</span>}
                </Link>
              );
            })}
          </>
        )}
      </nav>

      {/* User */}
      <div className="border-t border-border p-3">
        <UserButton
          appearance={{
            elements: {
              rootBox: "w-full",
              userButtonTrigger: "w-full justify-start",
            },
          }}
        />
      </div>
    </aside>
  );
}
