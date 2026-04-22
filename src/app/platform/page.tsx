"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import Link from "next/link";
import { Plus, Building2 } from "lucide-react";

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: "bg-green-500/10 text-green-500",
    inactive: "bg-gray-500/10 text-gray-400",
    suspended: "bg-red-500/10 text-red-500",
  };
  const labels: Record<string, string> = {
    active: "Activa",
    inactive: "Inactiva",
    suspended: "Suspendida",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status] ?? styles.inactive}`}
    >
      {labels[status] ?? status}
    </span>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  const styles: Record<string, string> = {
    basic: "bg-blue-500/10 text-blue-400",
    pro: "bg-purple-500/10 text-purple-400",
    enterprise: "bg-amber-500/10 text-amber-400",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${styles[plan] ?? styles.basic}`}
    >
      {plan}
    </span>
  );
}

export default function PlatformPage() {
  const orgs = useQuery(api.functions.organizations.queries.list);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Organizaciones</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Gestiona todas las organizaciones de la plataforma
          </p>
        </div>
        <Link
          href="/platform/orgs/new"
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground hover:bg-accent/90 transition-colors"
        >
          <Plus size={16} />
          Nueva Organización
        </Link>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border bg-card">
        {orgs === undefined ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : orgs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Building2 size={40} className="mb-3 opacity-40" />
            <p className="text-sm">No hay organizaciones registradas</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <th className="px-6 py-3">Nombre</th>
                <th className="px-6 py-3">Estado</th>
                <th className="px-6 py-3">Plan</th>
                <th className="px-6 py-3">Clerk Org ID</th>
                <th className="px-6 py-3">Creada</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {orgs.map((org) => (
                <tr
                  key={org._id}
                  className="group transition-colors hover:bg-secondary/50"
                >
                  <td className="px-6 py-4">
                    <Link
                      href={`/platform/orgs/${org._id}`}
                      className="font-medium text-foreground group-hover:text-accent transition-colors"
                    >
                      {org.name}
                    </Link>
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={org.status} />
                  </td>
                  <td className="px-6 py-4">
                    <PlanBadge plan={org.plan} />
                  </td>
                  <td className="px-6 py-4">
                    <span className="font-mono text-xs text-muted-foreground">
                      {org.clerkOrgId}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">
                    {new Date(org.createdAt).toLocaleDateString("es-MX", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
