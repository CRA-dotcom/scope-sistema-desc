import { internalMutation } from "../../_generated/server";

/**
 * seedDefaultTemplates
 *
 * Idempotent internalMutation that inserts 5 default deliverable templates
 * (Admin, RH, TI, Marketing, Legal). Skips any service slug that already
 * has a "deliverable_long" template in the DB.
 *
 * Run once per deployment via npx convex run
 * functions/deliverableTemplates/seedDefaults:seedDefaultTemplates
 */

// ─── Shared layout helpers ───────────────────────────────────────────────────

const BASE_CSS = `
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Helvetica, Arial, sans-serif; color: #1a1a1a; background: #fff; }
    .page { max-width: 760px; margin: 0 auto; padding: 40px 48px; }
    .cover { min-height: 220px; border-bottom: 3px solid #1e293b; padding-bottom: 32px; margin-bottom: 40px; }
    .cover-service { font-size: 11px; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; color: #64748b; margin-bottom: 12px; }
    .cover-title { font-size: 28px; font-weight: 700; color: #0f172a; line-height: 1.25; margin-bottom: 8px; }
    .cover-subtitle { font-size: 15px; color: #475569; margin-bottom: 20px; }
    .cover-meta { display: flex; gap: 32px; font-size: 12px; color: #64748b; }
    .cover-meta span strong { color: #0f172a; }
    .section { margin-bottom: 36px; }
    .section-header { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
      color: #94a3b8; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 16px; }
    .context-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 32px; }
    .context-item label { font-size: 11px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.08em; color: #94a3b8; display: block; margin-bottom: 2px; }
    .context-item span { font-size: 13px; color: #1e293b; }
    .service-list { display: flex; flex-wrap: wrap; gap: 8px; }
    .service-tag { font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 999px;
      background: #0f172a; color: #f8fafc; border: 1px solid #0f172a; }
    .ai-content { font-size: 13.5px; line-height: 1.7; color: #374151; }
    .ai-content p { margin-bottom: 12px; }
    .ai-content ul, .ai-content ol { padding-left: 20px; margin-bottom: 12px; }
    .ai-content li { margin-bottom: 6px; }
    .doc-footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #e2e8f0;
      font-size: 11px; color: #94a3b8; display: flex; justify-content: space-between; }
  </style>
`;

function buildHtml(serviceLabel: string, section3Header: string, section4Header: string, aiKey1: string, aiKey2: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8">${BASE_CSS}</head>
<body>
<div class="page">
  <div class="cover">
    <div class="cover-service">${serviceLabel}</div>
    <div class="cover-title">{{company_name}}</div>
    <div class="cover-subtitle">Informe de Entregable — {{service_name}}</div>
    <div class="cover-meta">
      <span><strong>Fecha:</strong> {{current_date}}</span>
      <span><strong>RFC:</strong> {{company_rfc}}</span>
      <span><strong>Año fiscal:</strong> {{projection_year}}</span>
      <span><strong>Elaborado por:</strong> {{branding_company_name}}</span>
    </div>
  </div>
  <div class="section">
    <div class="section-header">01 — Contexto del cliente</div>
    <div class="context-grid">
      <div class="context-item"><label>Industria</label><span>{{company_industry}}</span></div>
      <div class="context-item"><label>Facturación anual</label><span>{{company_annual_revenue}}</span></div>
      <div class="context-item"><label>Frecuencia de facturación</label><span>{{company_billing_frequency}}</span></div>
      <div class="context-item"><label>Presupuesto total</label><span>{{projection_total_budget}}</span></div>
      <div class="context-item"><label>Ventas anuales proyectadas</label><span>{{projection_annual_sales}}</span></div>
      <div class="context-item"><label>Servicio contratado</label><span>{{service_name}} — {{service_chosen_pct}}</span></div>
    </div>
  </div>
  <div class="section">
    <div class="section-header">02 — Servicios contratados</div>
    <div class="service-list"><span class="service-tag">{{service_name}}</span></div>
    <p style="margin-top:12px;font-size:12px;color:#64748b;">
      Monto anual asignado: <strong>{{service_annual_amount}}</strong> &nbsp;·&nbsp;
      Participación en presupuesto: <strong>{{service_chosen_pct}}</strong>
    </p>
  </div>
  <div class="section">
    <div class="section-header">03 — ${section3Header}</div>
    <div class="ai-content">{{${aiKey1}}}</div>
  </div>
  <div class="section">
    <div class="section-header">04 — ${section4Header}</div>
    <div class="ai-content">{{${aiKey2}}}</div>
  </div>
  <div class="doc-footer">
    <span>{{branding_company_name}} · {{branding_footer_text}}</span>
    <span>Generado el {{current_date}}</span>
  </div>
</div>
</body>
</html>`;
}

const SHARED_STATIC_VARS = [
  { key: "company_name", label: "Nombre del cliente", source: "client" as const, required: true },
  { key: "company_rfc", label: "RFC del cliente", source: "client" as const, required: true },
  { key: "company_industry", label: "Industria", source: "client" as const, required: true },
  { key: "company_annual_revenue", label: "Facturación anual", source: "client" as const, required: true },
  { key: "company_billing_frequency", label: "Frecuencia de facturación", source: "client" as const, required: true },
  { key: "projection_year", label: "Año fiscal", source: "projection" as const, required: true },
  { key: "projection_annual_sales", label: "Ventas anuales proyectadas", source: "projection" as const, required: false },
  { key: "projection_total_budget", label: "Presupuesto total", source: "projection" as const, required: false },
  { key: "service_name", label: "Nombre del servicio", source: "service" as const, required: true },
  { key: "service_chosen_pct", label: "Porcentaje asignado", source: "service" as const, required: false },
  { key: "service_annual_amount", label: "Monto anual del servicio", source: "service" as const, required: false },
  { key: "branding_company_name", label: "Nombre de la consultora", source: "manual" as const, required: false },
  { key: "branding_footer_text", label: "Texto de pie de página", source: "manual" as const, required: false },
  { key: "current_date", label: "Fecha de generación", source: "manual" as const, required: false },
];

// ─── Template definitions ────────────────────────────────────────────────────

type TemplateRow = {
  serviceName: string;
  name: string;
  htmlTemplate: string;
  variables: Array<{
    key: string;
    label: string;
    source: "client" | "projection" | "service" | "ai" | "manual";
    required: boolean;
  }>;
};

const DEFAULTS: TemplateRow[] = [
  // ── ADMIN ──────────────────────────────────────────────────────────────────
  {
    serviceName: "Admin",
    name: "Resumen — Administración",
    htmlTemplate: buildHtml(
      "Administración",
      "Análisis administrativo y operativo",
      "Prioridades recomendadas — Administración",
      "admin_analisis_contexto",
      "admin_prioridades_recomendadas"
    ),
    variables: [
      ...SHARED_STATIC_VARS,
      {
        key: "admin_analisis_contexto",
        label: "Análisis de retos administrativos específicos al cliente",
        source: "ai",
        required: true,
      },
      {
        key: "admin_prioridades_recomendadas",
        label: "Prioridades de acción en administración para el próximo trimestre",
        source: "ai",
        required: true,
      },
    ],
  },

  // ── RH ─────────────────────────────────────────────────────────────────────
  {
    serviceName: "RH",
    name: "Resumen — Recursos Humanos",
    htmlTemplate: buildHtml(
      "Recursos Humanos",
      "Diagnóstico de capital humano y gestión del talento",
      "Prioridades recomendadas — RH",
      "rh_diagnostico_talento",
      "rh_prioridades_recomendadas"
    ),
    variables: [
      ...SHARED_STATIC_VARS,
      {
        key: "rh_diagnostico_talento",
        label: "Diagnóstico de gestión de talento por industria y tamaño",
        source: "ai",
        required: true,
      },
      {
        key: "rh_prioridades_recomendadas",
        label: "Prioridades de RH para el próximo trimestre",
        source: "ai",
        required: true,
      },
    ],
  },

  // ── TI ─────────────────────────────────────────────────────────────────────
  {
    serviceName: "TI",
    name: "Resumen — Tecnologías de la Información",
    htmlTemplate: buildHtml(
      "Tecnologías de la Información",
      "Diagnóstico de madurez digital e infraestructura TI",
      "Prioridades recomendadas — TI",
      "ti_diagnostico_madurez",
      "ti_prioridades_recomendadas"
    ),
    variables: [
      ...SHARED_STATIC_VARS,
      {
        key: "ti_diagnostico_madurez",
        label: "Diagnóstico de madurez digital y riesgos de infraestructura TI",
        source: "ai",
        required: true,
      },
      {
        key: "ti_prioridades_recomendadas",
        label: "Prioridades de TI para el próximo trimestre",
        source: "ai",
        required: true,
      },
    ],
  },

  // ── MARKETING ──────────────────────────────────────────────────────────────
  {
    serviceName: "Marketing",
    name: "Resumen — Marketing",
    htmlTemplate: buildHtml(
      "Marketing",
      "Análisis de posicionamiento y estrategia de mercado",
      "Prioridades recomendadas — Marketing",
      "mkt_analisis_posicionamiento",
      "mkt_prioridades_recomendadas"
    ),
    variables: [
      ...SHARED_STATIC_VARS,
      {
        key: "mkt_analisis_posicionamiento",
        label: "Análisis de posicionamiento y canales de adquisición por industria",
        source: "ai",
        required: true,
      },
      {
        key: "mkt_prioridades_recomendadas",
        label: "Prioridades de marketing para el próximo trimestre",
        source: "ai",
        required: true,
      },
    ],
  },

  // ── LEGAL ──────────────────────────────────────────────────────────────────
  {
    serviceName: "Legal",
    name: "Resumen — Legal",
    htmlTemplate: buildHtml(
      "Legal",
      "Diagnóstico de riesgos legales y marco de compliance",
      "Prioridades recomendadas — Legal",
      "legal_diagnostico_riesgos",
      "legal_prioridades_recomendadas"
    ),
    variables: [
      ...SHARED_STATIC_VARS,
      {
        key: "legal_diagnostico_riesgos",
        label: "Diagnóstico de riesgos legales y marcos de compliance aplicables",
        source: "ai",
        required: true,
      },
      {
        key: "legal_prioridades_recomendadas",
        label: "Prioridades legales para el próximo trimestre",
        source: "ai",
        required: true,
      },
    ],
  },
];

// ─── Internal mutation ───────────────────────────────────────────────────────

export const seedDefaultTemplates = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Collect existing deliverable_long templates keyed by serviceName
    const existing = await ctx.db
      .query("deliverableTemplates")
      .withIndex("by_type", (q) => q.eq("type", "deliverable_long"))
      .collect();

    const existingByServiceName = new Set(existing.map((t) => t.serviceName));

    let inserted = 0;
    let skipped = 0;

    for (const def of DEFAULTS) {
      if (existingByServiceName.has(def.serviceName)) {
        skipped++;
        continue;
      }

      const now = Date.now();
      await ctx.db.insert("deliverableTemplates", {
        orgId: undefined,
        serviceId: undefined,
        serviceName: def.serviceName,
        type: "deliverable_long",
        name: def.name,
        htmlTemplate: def.htmlTemplate,
        variables: def.variables,
        version: 1,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      inserted++;
    }

    return {
      inserted,
      skipped,
      total: DEFAULTS.length,
    };
  },
});
