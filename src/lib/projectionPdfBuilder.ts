/**
 * projectionPdfBuilder.ts
 *
 * Builds the inner HTML for a projection matrix PDF.
 * Uses resolveProjectionContext + resolveProjectionMonths so the output
 * is always driven by startMonth/monthCount — not hardcoded Jan-Dec.
 *
 * Backwards-compatible: projections without startMonth/projectionMode
 * default to 12 months Jan-Dec (legacy behaviour, identical to previous output).
 */

import {
  resolveProjectionContext,
  resolveProjectionMonths,
} from "../../convex/lib/projectionContext";

// ── Types ─────────────────────────────────────────────────────────────

export type ProjectionForPdf = {
  year: number;
  annualSales: number;
  totalBudget: number;
  commissionRate: number;
  // Optional C1/C3 fields — omitted by legacy rows:
  startMonth?: number;
  projectionMode?: "rolling" | "fiscal";
  monthCount?: number;
  effectiveBudget?: number;
};

export type ProjectionServiceForPdf = {
  _id: string;
  serviceName: string;
  isActive: boolean;
  annualAmount: number;
};

export type MonthlyAssignmentForPdf = {
  projServiceId: string;
  month: number;
  amount: number;
  status: string;
};

// ── Constants ─────────────────────────────────────────────────────────

const MONTH_NAMES_FULL = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const MONTH_NAMES_SHORT = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

// ── Helpers ───────────────────────────────────────────────────────────

function formatMXN(n: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(n);
}

/**
 * Builds the period label for the document header, e.g.:
 *   "Mayo 2026 – Diciembre 2026 (8 meses · año fiscal)"
 *   "Mayo 2026 – Abril 2027 (12 meses)"
 */
export function buildPeriodLabel(
  startMonth: number,
  endMonth: number,
  startYear: number,
  endYear: number,
  monthCount: number,
  projectionMode: "rolling" | "fiscal"
): string {
  const start = `${MONTH_NAMES_FULL[startMonth - 1]} ${startYear}`;
  const end = `${MONTH_NAMES_FULL[endMonth - 1]} ${endYear}`;
  const monthLabel = monthCount === 1 ? "mes" : "meses";
  const suffix = projectionMode === "fiscal" ? " · año fiscal" : "";
  return `${start} – ${end} (${monthCount} ${monthLabel}${suffix})`;
}

// ── Main builder ──────────────────────────────────────────────────────

/**
 * Produces the inner `<body>` HTML for the projection PDF.
 * Pass this to `usePdfGenerator` (which wraps it in the branded layout).
 */
export function buildProjectionPdfHtml(
  projection: ProjectionForPdf,
  services: ProjectionServiceForPdf[],
  assignments: MonthlyAssignmentForPdf[]
): string {
  // Resolve context — handles legacy rows with no startMonth/projectionMode
  const ctx = resolveProjectionContext(projection);
  const months = resolveProjectionMonths(ctx.startMonth, ctx.monthCount);

  // Build column labels: "May 26", "Jun 26", …, wrapping to next year if rolling
  const columnLabels = months.map((m, i) => {
    const yearOffset = Math.floor((ctx.startMonth - 1 + i) / 12);
    const yr = projection.year + yearOffset;
    return `${MONTH_NAMES_SHORT[m - 1]} ${String(yr).slice(-2)}`;
  });

  const periodLabel = buildPeriodLabel(
    ctx.startMonth,
    ctx.endMonth,
    projection.year,
    ctx.endYear,
    ctx.monthCount,
    ctx.projectionMode
  );

  const activeServices = services.filter((s) => s.isActive);

  // ── Summary KPI cards ──────────────────────────────────────────────
  const summaryHtml = `
<div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap;">
  <div style="flex:1;min-width:120px;border:1px solid #e5e7eb;border-radius:6px;padding:12px;">
    <div style="font-size:8pt;color:#6b7280;margin-bottom:4px;">Venta Anual</div>
    <div style="font-size:13pt;font-weight:700;">${formatMXN(projection.annualSales)}</div>
  </div>
  <div style="flex:1;min-width:120px;border:1px solid #e5e7eb;border-radius:6px;padding:12px;">
    <div style="font-size:8pt;color:#6b7280;margin-bottom:4px;">Presupuesto Total</div>
    <div style="font-size:13pt;font-weight:700;">${formatMXN(projection.totalBudget)}</div>
  </div>
  ${ctx.projectionMode === "fiscal" ? `
  <div style="flex:1;min-width:120px;border:1px solid #e5e7eb;border-radius:6px;padding:12px;">
    <div style="font-size:8pt;color:#6b7280;margin-bottom:4px;">Presupuesto Efectivo</div>
    <div style="font-size:13pt;font-weight:700;">${formatMXN(ctx.effectiveBudget)}</div>
  </div>` : ""}
  <div style="flex:1;min-width:120px;border:1px solid #e5e7eb;border-radius:6px;padding:12px;">
    <div style="font-size:8pt;color:#6b7280;margin-bottom:4px;">Comisión</div>
    <div style="font-size:13pt;font-weight:700;">${(projection.commissionRate * 100).toFixed(1)}%</div>
  </div>
  <div style="flex:1;min-width:120px;border:1px solid #e5e7eb;border-radius:6px;padding:12px;">
    <div style="font-size:8pt;color:#6b7280;margin-bottom:4px;">Servicios Activos</div>
    <div style="font-size:13pt;font-weight:700;color:#22c55e;">${activeServices.length}</div>
  </div>
</div>`;

  // ── Matrix table ───────────────────────────────────────────────────
  const theadCells = columnLabels
    .map((lbl) => `<th style="text-align:center;white-space:nowrap;">${lbl}</th>`)
    .join("");

  const serviceRows = activeServices.map((svc) => {
    const svcAssignments = assignments.filter((a) => a.projServiceId === svc._id);
    const cells = months.map((monthNum) => {
      const ma = svcAssignments.find((a) => a.month === monthNum);
      return ma
        ? `<td style="text-align:center;">${formatMXN(ma.amount)}</td>`
        : `<td style="text-align:center;color:#9ca3af;">—</td>`;
    });
    return `
<tr>
  <td style="font-weight:600;white-space:nowrap;padding-right:8px;">${svc.serviceName}</td>
  ${cells.join("")}
  <td style="text-align:right;font-weight:600;color:var(--brand-accent,#22c55e);">${formatMXN(svc.annualAmount)}</td>
</tr>`;
  });

  // Totals row
  const totalCells = months.map((monthNum) => {
    const total = assignments
      .filter((a) => a.month === monthNum)
      .reduce((s, a) => s + a.amount, 0);
    return `<td style="text-align:center;font-weight:600;">${formatMXN(total)}</td>`;
  });
  const grandTotal = activeServices.reduce((s, sv) => s + sv.annualAmount, 0);

  const matrixHtml = `
<div style="overflow-x:auto;margin-bottom:16px;">
<table style="width:100%;border-collapse:collapse;font-size:9pt;">
  <thead>
    <tr style="background:var(--brand-primary,#1a1a2e);color:#fff;">
      <th style="text-align:left;padding:7px 10px;">Servicio</th>
      ${theadCells}
      <th style="text-align:right;padding:7px 10px;">Total Anual</th>
    </tr>
  </thead>
  <tbody>
    ${serviceRows.join("")}
    <tr style="background:#f3f4f6;font-weight:700;">
      <td style="padding:7px 10px;">Total</td>
      ${totalCells.join("")}
      <td style="text-align:right;color:var(--brand-accent,#22c55e);padding:7px 10px;">${formatMXN(grandTotal)}</td>
    </tr>
  </tbody>
</table>
</div>`;

  // ── Full HTML body ─────────────────────────────────────────────────
  return `
<h1 style="margin-bottom:4px;">Proyección ${projection.year}</h1>
<p style="font-size:10pt;color:#6b7280;margin-bottom:${ctx.projectionMode === "fiscal" ? "6px" : "20px"};">
  Periodo: ${periodLabel}
</p>
${ctx.projectionMode === "fiscal" ? `
<p style="font-size:9pt;color:#92400e;background:#fef3c7;border:1px solid #fde68a;border-radius:4px;padding:6px 10px;margin-bottom:16px;display:inline-block;">
  (prorrateo año fiscal)
</p>` : ""}
${summaryHtml}
<h2 style="margin-bottom:10px;">Matriz de Asignación Mensual</h2>
${matrixHtml}`;
}
