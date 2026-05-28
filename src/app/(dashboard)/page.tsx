"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  TrendingUp,
  ClipboardList,
  DollarSign,
  AlertTriangle,
  Download,
  ChevronDown,
} from "lucide-react";
import { DraftPendingBanner } from "@/components/drafts/DraftPendingBanner";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const MONTH_NAMES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

const MONTH_FULL = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const STATUS_COLORS: Record<string, string> = {
  pending: "#6B7280",
  info_received: "#3B82F6",
  in_progress: "#F59E0B",
  delivered: "#22C55E",
  overdue: "#EF4444",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  info_received: "Info Recibida",
  in_progress: "En Progreso",
  delivered: "Entregado",
  overdue: "Vencido",
};

export default function DashboardPage() {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const router = useRouter();

  const financialData = useQuery(
    api.functions.dashboard.queries.financialSummary,
    { year: selectedYear }
  );
  const deliverableStats = useQuery(
    api.functions.dashboard.queries.deliverableStats,
    { year: selectedYear }
  );
  const clientSummary = useQuery(
    api.functions.dashboard.queries.clientSummary,
    { year: selectedYear }
  );
  const alertsData = useQuery(
    api.functions.dashboard.queries.alerts,
    { year: selectedYear }
  );

  const isLoading =
    financialData === undefined ||
    deliverableStats === undefined ||
    clientSummary === undefined ||
    alertsData === undefined;

  // Summary card values
  const activeClients = clientSummary?.length ?? 0;
  const activeProjections =
    clientSummary?.reduce((sum, c) => sum + c.activeProjections, 0) ?? 0;
  const pendingDeliverables =
    (deliverableStats?.pending ?? 0) + (deliverableStats?.in_progress ?? 0);
  const currentMonth = new Date().getMonth() + 1;
  const currentMonthBilling =
    financialData?.find((m) => m.month === currentMonth)?.servicePayments ?? 0;

  // Chart data
  const chartData =
    financialData?.map((m) => ({
      name: MONTH_NAMES[m.month - 1],
      "Ventas Proyectadas": m.projectedSales,
      "Pagos Servicios": m.servicePayments,
    })) ?? [];

  // Pie chart data
  const pieData = deliverableStats
    ? [
        { name: "Pendiente", value: deliverableStats.pending, key: "pending" },
        {
          name: "Info Recibida",
          value: deliverableStats.info_received,
          key: "info_received",
        },
        {
          name: "En Progreso",
          value: deliverableStats.in_progress,
          key: "in_progress",
        },
        {
          name: "Entregado",
          value: deliverableStats.delivered,
          key: "delivered",
        },
      ].filter((d) => d.value > 0)
    : [];

  const totalAssignments = pieData.reduce((sum, d) => sum + d.value, 0);

  // CSV export
  const handleExportCSV = useCallback(() => {
    if (!financialData || !clientSummary || !deliverableStats) return;

    const lines: string[] = [];
    lines.push(`Projex Resumen ${selectedYear}`);
    lines.push("");

    // Financial summary section
    lines.push("Resumen Financiero");
    lines.push("Mes,Ventas Proyectadas,Pagos Servicios,Varianza");
    financialData.forEach((m) => {
      lines.push(
        `${MONTH_FULL[m.month - 1]},${m.projectedSales},${m.servicePayments},${m.variance}`
      );
    });
    lines.push("");

    // Deliverable stats
    lines.push("Estado de Entregables");
    lines.push("Estado,Cantidad");
    lines.push(`Pendiente,${deliverableStats.pending}`);
    lines.push(`Info Recibida,${deliverableStats.info_received}`);
    lines.push(`En Progreso,${deliverableStats.in_progress}`);
    lines.push(`Entregado,${deliverableStats.delivered}`);
    lines.push(`Vencido,${deliverableStats.overdue}`);
    lines.push("");

    // Client summary
    lines.push("Resumen por Cliente");
    lines.push(
      "Cliente,Industria,Servicios Activos,Entregados Este Mes,Pagos Pendientes"
    );
    clientSummary.forEach((c) => {
      lines.push(
        `"${c.clientName}","${c.industry}",${c.activeServices},${c.deliveredThisMonth},${c.pendingPayments}`
      );
    });

    const csv = lines.join("\n");
    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Projex_Resumen_${selectedYear}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [financialData, clientSummary, deliverableStats, selectedYear]);

  return (
    <div className="space-y-6">
      {/* Draft Pending Banner */}
      <DraftPendingBanner />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <LayoutDashboard className="text-accent" size={28} />
          <h1 className="text-2xl font-bold">Dashboard</h1>
        </div>
        <div className="flex items-center gap-3">
          {/* Year filter */}
          <div className="relative">
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="appearance-none rounded-md border border-border bg-secondary px-3 py-1.5 pr-8 text-sm text-foreground"
            >
              {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <ChevronDown
              size={14}
              className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
          </div>
          {/* Export */}
          <button
            onClick={handleExportCSV}
            disabled={isLoading}
            className="flex items-center gap-2 rounded-md border border-border bg-secondary px-3 py-1.5 text-sm text-foreground transition-colors hover:border-accent/50 hover:text-accent disabled:opacity-50"
          >
            <Download size={14} />
            Exportar CSV
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-lg border border-border bg-card"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            icon={<Users size={20} />}
            label="Clientes Activos"
            value={activeClients.toString()}
            color="text-accent"
          />
          <SummaryCard
            icon={<TrendingUp size={20} />}
            label="Proyecciones Activas"
            value={activeProjections.toString()}
            color="text-info"
          />
          <SummaryCard
            icon={<ClipboardList size={20} />}
            label="Entregables Pendientes"
            value={pendingDeliverables.toString()}
            color="text-warning"
            subtitle={
              deliverableStats.overdue > 0
                ? `${deliverableStats.overdue} vencidos`
                : undefined
            }
            subtitleColor="text-destructive"
          />
          <SummaryCard
            icon={<DollarSign size={20} />}
            label="Facturación del Mes"
            value={`$${currentMonthBilling.toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
            color="text-accent"
          />
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Financial Bar Chart */}
        <div className="rounded-lg border border-border bg-card p-5 lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold">
            Ventas vs Pagos de Servicios
          </h2>
          {isLoading ? (
            <div className="h-72 animate-pulse rounded bg-secondary/30" />
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: "#94A3B8", fontSize: 12 }}
                  />
                  <YAxis
                    tick={{ fill: "#94A3B8", fontSize: 12 }}
                    tickFormatter={(v) =>
                      v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v
                    }
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0F172A",
                      border: "1px solid #1E293B",
                      borderRadius: "8px",
                      color: "#F8FAFC",
                      fontSize: 12,
                    }}
                    formatter={(value) => [
                      `$${Number(value).toLocaleString("es-MX", { minimumFractionDigits: 2 })}`,
                    ]}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 12, color: "#94A3B8" }}
                  />
                  <Bar
                    dataKey="Ventas Proyectadas"
                    fill="#3B82F6"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="Pagos Servicios"
                    fill="#22C55E"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Deliverable Status Pie */}
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-4 text-sm font-semibold">
            Estado de Entregables
          </h2>
          {isLoading ? (
            <div className="h-72 animate-pulse rounded bg-secondary/30" />
          ) : totalAssignments === 0 ? (
            <div className="flex h-72 items-center justify-center">
              <p className="text-sm text-muted-foreground">
                Sin entregables para este periodo
              </p>
            </div>
          ) : (
            <>
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {pieData.map((entry) => (
                        <Cell
                          key={entry.key}
                          fill={STATUS_COLORS[entry.key]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#0F172A",
                        border: "1px solid #1E293B",
                        borderRadius: "8px",
                        color: "#F8FAFC",
                        fontSize: 12,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 space-y-1.5">
                {pieData.map((d) => (
                  <div
                    key={d.key}
                    className="flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: STATUS_COLORS[d.key] }}
                      />
                      <span className="text-muted-foreground">{d.name}</span>
                    </div>
                    <span className="font-medium">{d.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Alerts */}
      {!isLoading &&
        ((alertsData.overdueAssignments.length > 0) ||
          (alertsData.unpaidInvoices.length > 0)) && (
          <div className="rounded-lg border border-destructive/30 bg-card p-5">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle size={18} className="text-destructive" />
              <h2 className="text-sm font-semibold text-destructive">
                Alertas
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {alertsData.overdueAssignments.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    Entregables Vencidos ({alertsData.overdueAssignments.length})
                  </p>
                  <div className="space-y-1.5">
                    {alertsData.overdueAssignments.map((a) => (
                      <div
                        key={a._id}
                        className="flex items-center justify-between rounded-md bg-destructive/5 px-3 py-2 text-xs"
                      >
                        <span>
                          <span className="font-medium">{a.clientName}</span>
                          {" - "}
                          {a.serviceName}
                        </span>
                        <span className="text-muted-foreground">
                          {MONTH_FULL[a.month - 1]} {a.year}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {alertsData.unpaidInvoices.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    Facturas Sin Pagar ({alertsData.unpaidInvoices.length})
                  </p>
                  <div className="space-y-1.5">
                    {alertsData.unpaidInvoices.map((a) => (
                      <div
                        key={a._id}
                        className="flex items-center justify-between rounded-md bg-warning/5 px-3 py-2 text-xs"
                      >
                        <span>
                          <span className="font-medium">{a.clientName}</span>
                          {" - "}
                          {a.serviceName}
                        </span>
                        <span className="font-medium text-warning">
                          ${a.amount.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

      {/* Client Cards */}
      <div>
        <h2 className="mb-3 text-sm font-semibold">Resumen por Cliente</h2>
        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <div
                key={i}
                className="h-32 animate-pulse rounded-lg border border-border bg-card"
              />
            ))}
          </div>
        ) : clientSummary.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-12 text-center">
            <Users className="mx-auto mb-3 text-muted-foreground" size={40} />
            <p className="text-muted-foreground">
              No hay clientes activos para mostrar.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {clientSummary.map((client) => (
              <button
                key={client.clientId}
                onClick={() =>
                  router.push(`/clientes/${client.clientId}`)
                }
                className="rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-accent/30"
              >
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-semibold truncate">
                    {client.clientName}
                  </h3>
                  <span className="ml-2 shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
                    {client.industry}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-lg font-bold text-info">
                      {client.activeServices}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Servicios
                    </p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-accent">
                      {client.deliveredThisMonth}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Entregados
                    </p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-warning">
                      {client.pendingPayments}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Pagos Pend.
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---- Helper Components ---- */

function SummaryCard({
  icon,
  label,
  value,
  color,
  subtitle,
  subtitleColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  subtitle?: string;
  subtitleColor?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 transition-colors hover:border-accent/30">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <p className="text-sm">{label}</p>
      </div>
      <p className={`mt-2 text-3xl font-bold ${color}`}>{value}</p>
      {subtitle && (
        <p className={`mt-1 text-xs ${subtitleColor ?? "text-muted-foreground"}`}>
          {subtitle}
        </p>
      )}
    </div>
  );
}
