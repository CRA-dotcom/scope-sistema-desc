"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useState } from "react";
import Link from "next/link";
import { DollarSign } from "lucide-react";

type PlanFilter = "" | "basic" | "pro" | "enterprise";

const STATUS_LABELS: Record<string, string> = {
  al_dia: "Al día",
  por_cobrar: "Por cobrar",
  sobre_limite: "Sobre límite",
};

const STATUS_STYLES: Record<string, string> = {
  al_dia: "bg-green-500/10 text-green-500",
  por_cobrar: "bg-amber-500/10 text-amber-500",
  sobre_limite: "bg-red-500/10 text-red-500",
};

export default function BillingPage() {
  const data = useQuery(api.functions.superAdmin.billing.getUsage, {});
  const [planFilter, setPlanFilter] = useState<PlanFilter>("");

  if (!data) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  const filtered = planFilter
    ? data.rows.filter((r) => r.plan === planFilter)
    : data.rows;
  const totalBillable = filtered.reduce((acc, r) => acc + r.billableMxn, 0);
  const totalAiCostMxn = filtered.reduce((acc, r) => acc + r.aiCostMxn, 0);
  const totalMargin = filtered.reduce((acc, r) => acc + r.marginMxn, 0);

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <DollarSign className="text-accent" size={28} />
        <div>
          <h1 className="text-2xl font-bold text-foreground">Billing</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Uso por organización del mes corriente. Info-only — no procesa
            pagos en beta.
          </p>
        </div>
      </header>

      <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
        <label htmlFor="plan-filter" className="text-sm text-muted-foreground">
          Plan:
        </label>
        <select
          id="plan-filter"
          value={planFilter}
          onChange={(e) => setPlanFilter(e.target.value as PlanFilter)}
          className="rounded-md border border-border bg-secondary px-3 py-1.5 text-sm text-foreground"
        >
          <option value="">Todos</option>
          <option value="basic">Basic</option>
          <option value="pro">Pro</option>
          <option value="enterprise">Enterprise</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <th className="px-6 py-3">Organización</th>
              <th className="px-6 py-3">Plan</th>
              <th className="px-6 py-3">Deliverables / Mes</th>
              <th className="px-6 py-3">Uso %</th>
              <th className="px-6 py-3">A cobrar (MXN)</th>
              <th className="px-6 py-3">Costo IA</th>
              <th className="px-6 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-6 py-10 text-center text-sm text-muted-foreground"
                >
                  Sin organizaciones para este filtro.
                </td>
              </tr>
            ) : (
              filtered.map((row) => (
                <tr
                  key={row.orgId}
                  className="transition-colors hover:bg-secondary/50"
                >
                  <td className="px-6 py-4 text-sm font-medium text-foreground">
                    <Link
                      href={`/platform/orgs/${row.orgId}?tab=billing`}
                      className="hover:text-accent"
                    >
                      {row.orgName}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-sm capitalize text-muted-foreground">
                    {row.plan}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    {row.deliverablesMonth} / {row.deliverablesCap}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary">
                        <div
                          className={`h-full ${
                            row.deliverablesPct > 90
                              ? "bg-red-500"
                              : row.deliverablesPct > 70
                                ? "bg-amber-500"
                                : "bg-accent"
                          }`}
                          style={{ width: `${row.deliverablesPct}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {row.deliverablesPct}%
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    ${row.billableMxn.toLocaleString("es-MX")}
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">
                    ${row.aiCostMxn.toFixed(0)} MXN · $
                    {row.aiCostUsd.toFixed(2)} USD
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        STATUS_STYLES[row.status] ?? STATUS_STYLES.al_dia
                      }`}
                    >
                      {STATUS_LABELS[row.status] ?? row.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr className="border-t border-border bg-secondary/30 font-semibold">
                <td className="px-6 py-3 text-sm" colSpan={4}>
                  Total
                </td>
                <td className="px-6 py-3 text-sm">
                  ${totalBillable.toLocaleString("es-MX")}
                </td>
                <td className="px-6 py-3 text-sm">
                  ${totalAiCostMxn.toFixed(0)} MXN
                </td>
                <td className="px-6 py-3 text-xs text-muted-foreground">
                  Margen: ${totalMargin.toLocaleString("es-MX")}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
