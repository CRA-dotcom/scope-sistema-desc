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
  Shield,
  FileSearch,
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

        {/* Super Admin Button */}
        {isSuperAdmin && (
          <>
            <div className="my-3 border-t border-border" />
            <Link
              href="/platform"
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors cursor-pointer",
                "bg-purple-500/10 text-purple-400 hover:bg-purple-500/20"
              )}
              title={collapsed ? "Panel de Plataforma" : undefined}
            >
              <Shield size={20} />
              {!collapsed && <span>Panel de Plataforma</span>}
            </Link>
            <Link
              href="/platform/audit"
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors cursor-pointer",
                pathname.startsWith("/platform/audit")
                  ? "bg-purple-500/20 text-purple-300"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
              title={collapsed ? "Audit log" : undefined}
            >
              <FileSearch size={20} />
              {!collapsed && <span>Audit log</span>}
            </Link>
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
