"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useState } from "react";
import { Receipt, Filter, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const STATUS_CONFIG = {
  not_invoiced: { label: "Sin Facturar", className: "bg-warning/10 text-warning" },
  invoiced: { label: "Facturado", className: "bg-info/10 text-info" },
  paid: { label: "Pagado", className: "bg-accent/10 text-accent" },
} as const;

type InvoiceStatus = keyof typeof STATUS_CONFIG;

export default function FacturacionPage() {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState<number | undefined>(undefined);
  const [selectedService, setSelectedService] = useState<string | undefined>(undefined);
  const [selectedStatus, setSelectedStatus] = useState<InvoiceStatus | undefined>(undefined);

  const assignments = useQuery(
    api.functions.monthlyAssignments.billingQueries.listForInvoiceTracking,
    {
      year: selectedYear,
      month: selectedMonth,
      serviceName: selectedService,
      invoiceStatus: selectedStatus,
    }
  );

  const updateInvoiceStatus = useMutation(
    api.functions.monthlyAssignments.mutations.updateInvoiceStatus
  );

  // Extract unique service names for filter
  const serviceNames = assignments
    ? [...new Set(assignments.map((a) => a.serviceName))].sort()
    : [];

  // Group assignments by month
  const grouped = assignments
    ? assignments.reduce(
        (acc, a) => {
          const key = `${a.year}-${String(a.month).padStart(2, "0")}`;
          if (!acc[key]) acc[key] = [];
          acc[key].push(a);
          return acc;
        },
        {} as Record<string, typeof assignments>
      )
    : {};

  const sortedMonthKeys = Object.keys(grouped).sort().reverse();

  // Summary counts
  const totalAmount = assignments?.reduce((sum, a) => sum + a.amount, 0) ?? 0;
  const statusCounts = assignments?.reduce(
    (acc, a) => {
      acc[a.invoiceStatus] = (acc[a.invoiceStatus] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  ) ?? {};

  const handleStatusChange = async (id: string, newStatus: InvoiceStatus) => {
    try {
      await updateInvoiceStatus({ id: id as never, invoiceStatus: newStatus });
    } catch (error) {
      console.error("Error updating invoice status:", error);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Receipt className="text-accent" size={28} />
        <h1 className="text-2xl font-bold">Facturación</h1>
      </div>

      <p className="text-sm text-muted-foreground">
        Seguimiento de facturacion por mes, servicio y estado de pago.
      </p>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="text-2xl font-bold text-accent">
            ${totalAmount.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Sin Facturar</p>
          <p className="text-2xl font-bold text-warning">
            {statusCounts.not_invoiced ?? 0}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Facturados</p>
          <p className="text-2xl font-bold text-info">
            {statusCounts.invoiced ?? 0}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Pagados</p>
          <p className="text-2xl font-bold text-accent">
            {statusCounts.paid ?? 0}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4">
        <Filter size={16} className="text-muted-foreground" />
        <span className="text-sm font-medium text-muted-foreground">Filtros:</span>

        {/* Year */}
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
          <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
        </div>

        {/* Month */}
        <div className="relative">
          <select
            value={selectedMonth ?? ""}
            onChange={(e) =>
              setSelectedMonth(e.target.value ? Number(e.target.value) : undefined)
            }
            className="appearance-none rounded-md border border-border bg-secondary px-3 py-1.5 pr-8 text-sm text-foreground"
          >
            <option value="">Todos los meses</option>
            {MONTHS.map((name, i) => (
              <option key={i} value={i + 1}>
                {name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
        </div>

        {/* Service */}
        <div className="relative">
          <select
            value={selectedService ?? ""}
            onChange={(e) =>
              setSelectedService(e.target.value || undefined)
            }
            className="appearance-none rounded-md border border-border bg-secondary px-3 py-1.5 pr-8 text-sm text-foreground"
          >
            <option value="">Todos los servicios</option>
            {serviceNames.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
        </div>

        {/* Status */}
        <div className="relative">
          <select
            value={selectedStatus ?? ""}
            onChange={(e) =>
              setSelectedStatus((e.target.value || undefined) as InvoiceStatus | undefined)
            }
            className="appearance-none rounded-md border border-border bg-secondary px-3 py-1.5 pr-8 text-sm text-foreground"
          >
            <option value="">Todos los estados</option>
            <option value="not_invoiced">Sin Facturar</option>
            <option value="invoiced">Facturado</option>
            <option value="paid">Pagado</option>
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
        </div>
      </div>

      {/* Loading */}
      {assignments === undefined ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg border border-border bg-card" />
          ))}
        </div>
      ) : assignments.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <Receipt className="mx-auto mb-3 text-muted-foreground" size={40} />
          <p className="text-muted-foreground">No se encontraron asignaciones con los filtros seleccionados.</p>
        </div>
      ) : (
        /* Grouped by Month */
        <div className="space-y-6">
          {sortedMonthKeys.map((monthKey) => {
            const items = grouped[monthKey];
            const [yearStr, monthStr] = monthKey.split("-");
            const monthIndex = parseInt(monthStr, 10) - 1;
            const monthTotal = items.reduce((sum, a) => sum + a.amount, 0);

            return (
              <div key={monthKey} className="rounded-lg border border-border bg-card overflow-hidden">
                {/* Month Header */}
                <div className="flex items-center justify-between border-b border-border bg-secondary/30 px-4 py-3">
                  <h2 className="text-sm font-semibold">
                    {MONTHS[monthIndex]} {yearStr}
                  </h2>
                  <span className="text-sm font-medium text-accent">
                    ${monthTotal.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                  </span>
                </div>

                {/* Table */}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-4 py-2.5 text-left font-medium">Cliente</th>
                      <th className="px-4 py-2.5 text-left font-medium">Servicio</th>
                      <th className="px-4 py-2.5 text-right font-medium">Monto</th>
                      <th className="px-4 py-2.5 text-center font-medium">Estado Entrega</th>
                      <th className="px-4 py-2.5 text-center font-medium">Estado Factura</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items
                      .sort((a, b) => a.clientName.localeCompare(b.clientName))
                      .map((item) => {
                        const statusInfo = STATUS_CONFIG[item.invoiceStatus as InvoiceStatus];
                        return (
                          <tr
                            key={item._id}
                            className="border-b border-border/50 hover:bg-secondary/30 transition-colors"
                          >
                            <td className="px-4 py-2.5 font-medium">{item.clientName}</td>
                            <td className="px-4 py-2.5 text-muted-foreground">{item.serviceName}</td>
                            <td className="px-4 py-2.5 text-right font-medium">
                              ${item.amount.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <span className={cn(
                                "rounded-full px-2 py-0.5 text-xs font-medium",
                                item.status === "delivered"
                                  ? "bg-accent/10 text-accent"
                                  : item.status === "in_progress"
                                    ? "bg-info/10 text-info"
                                    : "bg-muted/50 text-muted-foreground"
                              )}>
                                {item.status === "pending" && "Pendiente"}
                                {item.status === "info_received" && "Info Recibida"}
                                {item.status === "in_progress" && "En Progreso"}
                                {item.status === "delivered" && "Entregado"}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <select
                                value={item.invoiceStatus}
                                onChange={(e) =>
                                  handleStatusChange(item._id, e.target.value as InvoiceStatus)
                                }
                                className={cn(
                                  "cursor-pointer appearance-none rounded-full border-0 px-3 py-0.5 text-xs font-medium text-center",
                                  statusInfo.className
                                )}
                              >
                                <option value="not_invoiced">Sin Facturar</option>
                                <option value="invoiced">Facturado</option>
                                <option value="paid">Pagado</option>
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
