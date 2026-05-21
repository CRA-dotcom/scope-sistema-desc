"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Briefcase, ArrowLeft, Shield, FileText, FileSearch } from "lucide-react";
import { cn } from "@/lib/utils";
import { UserButton } from "@clerk/nextjs";

const navigation = [
  { name: "Organizaciones", href: "/platform", icon: Building2 },
  { name: "Servicios", href: "/platform/servicios", icon: Briefcase },
  { name: "Templates", href: "/platform/templates", icon: FileText },
  { name: "Audit log", href: "/platform/audit", icon: FileSearch },
];

export default function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-64 flex-col border-r border-border bg-card">
        {/* Header */}
        <div className="flex h-16 items-center gap-2 border-b border-border px-4">
          <span className="text-xl font-bold text-accent">Projex</span>
          <span className="rounded-md bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">
            <Shield size={12} className="mr-1 inline-block" />
            Super Admin
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 px-2 py-4">
          {navigation.map((item) => {
            const isActive =
              item.href === "/platform"
                ? pathname === "/platform"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-accent/10 text-accent"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                <item.icon size={20} />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-border p-3 space-y-3">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          >
            <ArrowLeft size={16} />
            <span>Volver al Dashboard</span>
          </Link>
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

      <main className="flex-1 overflow-y-auto bg-background p-6">
        {children}
      </main>
    </div>
  );
}
