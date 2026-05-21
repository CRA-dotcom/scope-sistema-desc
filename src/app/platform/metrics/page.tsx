"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import {
  Activity,
  Users,
  FileText,
  DollarSign,
  Building2,
} from "lucide-react";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import Link from "next/link";
import { useState } from "react";

type SortKey =
  | "deliverablesMonth"
  | "aiCostUsdMonth"
  | "clientsCount"
  | "lastActivityMs";

export default function MetricsPage() {
  const data = useQuery(api.functions.superAdmin.metrics.getOverviewAll);
  const [sortBy, setSortBy] = useState<SortKey>("deliverablesMonth");

  if (!data) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  const sorted = [...data.perOrg].sort((a, b) => {
    const av = (a[sortBy] ?? 0) as number;
    const bv = (b[sortBy] ?? 0) as number;
    return bv - av;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          Métricas de la plataforma
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Vista cross-org. Datos en tiempo real.
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <KpiCard
          icon={<Building2 size={18} />}
          label="Orgs activas"
          value={data.totals.orgsActive}
        />
        <KpiCard
          icon={<FileText size={18} />}
          label="Deliverables (mes)"
          value={data.totals.deliverablesMonth}
        />
        <KpiCard
          icon={<Activity size={18} />}
          label="Cotizaciones (mes)"
          value={data.totals.quotationsMonth}
        />
        <KpiCard
          icon={<Users size={18} />}
          label="Clientes totales"
          value={data.totals.clientsTotal}
        />
        <KpiCard
          icon={<DollarSign size={18} />}
          label="Costo IA (mes)"
          value={`$${data.totals.aiCostUsdMonth.toFixed(2)} USD`}
        />
      </div>

      {/* 30-day chart */}
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-sm font-semibold text-foreground">
          Deliverables — últimos 30 días
        </h2>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.last30Days}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
                opacity={0.3}
              />
              <XAxis
                dataKey="dateMs"
                tickFormatter={(ms) =>
                  new Date(ms).toLocaleDateString("es-MX", {
                    day: "2-digit",
                    month: "short",
                  })
                }
                fontSize={11}
                stroke="hsl(var(--muted-foreground))"
              />
              <YAxis
                fontSize={11}
                stroke="hsl(var(--muted-foreground))"
                allowDecimals={false}
              />
              <Tooltip
                labelFormatter={(ms) =>
                  new Date(ms as number).toLocaleDateString("es-MX")
                }
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 6,
                  fontSize: 12,
                }}
              />
              <Line
                type="monotone"
                dataKey="deliverables"
                stroke="hsl(var(--accent))"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Per-org table */}
      <div className="rounded-lg border border-border bg-card">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <th className="px-6 py-3">Organización</th>
              <th className="px-6 py-3">Plan</th>
              <SortableTh
                label="Clientes"
                active={sortBy === "clientsCount"}
                onClick={() => setSortBy("clientsCount")}
              />
              <SortableTh
                label="Deliverables (mes)"
                active={sortBy === "deliverablesMonth"}
                onClick={() => setSortBy("deliverablesMonth")}
              />
              <SortableTh
                label="Costo IA (USD)"
                active={sortBy === "aiCostUsdMonth"}
                onClick={() => setSortBy("aiCostUsdMonth")}
              />
              <SortableTh
                label="Última actividad"
                active={sortBy === "lastActivityMs"}
                onClick={() => setSortBy("lastActivityMs")}
              />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-6 py-10 text-center text-sm text-muted-foreground"
                >
                  Sin organizaciones activas.
                </td>
              </tr>
            ) : (
              sorted.map((org) => (
                <tr
                  key={org.orgId}
                  className="transition-colors hover:bg-secondary/50"
                >
                  <td className="px-6 py-4 text-sm font-medium text-foreground">
                    <Link
                      href={`/platform/orgs/${org.orgId}?tab=metrics`}
                      className="hover:text-accent"
                    >
                      {org.name}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-sm capitalize text-muted-foreground">
                    {org.plan}
                  </td>
                  <td className="px-6 py-4 text-sm">{org.clientsCount}</td>
                  <td className="px-6 py-4 text-sm">
                    {org.deliverablesMonth}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    ${org.aiCostUsdMonth.toFixed(2)}
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">
                    {org.lastActivityMs
                      ? new Date(org.lastActivityMs).toLocaleDateString(
                          "es-MX"
                        )
                      : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-bold text-foreground">{value}</div>
    </div>
  );
}

function SortableTh({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <th
      onClick={onClick}
      className={`cursor-pointer select-none px-6 py-3 transition-colors hover:text-foreground ${
        active ? "text-accent" : ""
      }`}
    >
      {label}
      {active && <span className="ml-1">↓</span>}
    </th>
  );
}
