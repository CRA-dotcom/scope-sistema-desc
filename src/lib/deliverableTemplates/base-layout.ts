/**
 * base-layout.ts
 * Shared HTML template layout and types for all 5 default deliverable templates.
 *
 * Templates are stored as HTML strings in the `deliverableTemplates` Convex table.
 * The AI generation pipeline (convex/functions/deliverables/actions.ts) resolves
 * {{variable_key}} placeholders — non-AI vars from client/projection/service context,
 * AI vars by calling Claude with the variable's `aiPrompt` field.
 *
 * Layout sections:
 *   1. Portada — logo, client name, date, service area
 *   2. Contexto del cliente — industry, revenue, billing frequency
 *   3. Servicios contratados — list of active services
 *   4. Detalle por servicio — AI-generated analysis
 *   5. Próximos pasos — AI-generated priorities
 */

export type AiVariableDefinition = {
  /** Variable key used as {{key}} placeholder in htmlTemplate */
  name: string;
  /** Human-readable label shown in UI */
  label: string;
  /**
   * Prompt sent to Claude to fill this variable.
   * Must contain at least one {placeholder} from requiredContext.
   */
  prompt: string;
  /** Context keys that MUST be available before calling Claude */
  requiredContext: string[];
};

export type TemplateSectionDef = {
  id: string;
  title: string;
  /** "static" = rendered from data, "ai" = filled by Claude */
  kind: "static" | "ai";
  /** AI variable key that populates this section (only for kind==="ai") */
  aiVariable?: string;
};

export type DeliverableTemplateDef = {
  /** Unique slug — matches services.name exactly */
  service: string;
  /** Human-readable display name */
  name: string;
  /** Template type stored in DB */
  type: "deliverable_long";
  aiVariables: AiVariableDefinition[];
  sections: TemplateSectionDef[];
  /** The full HTML template string with {{variable}} placeholders */
  htmlTemplate: string;
  /** Variable descriptors for DB insertion */
  variables: Array<{
    key: string;
    label: string;
    source: "client" | "projection" | "service" | "ai" | "manual";
    required: boolean;
  }>;
};

// ─── Shared HTML helpers ──────────────────────────────────────────────────────

const CSS = `
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Helvetica, Arial, sans-serif; color: #1a1a1a; background: #fff; }
    .page { max-width: 760px; margin: 0 auto; padding: 40px 48px; }

    /* Portada */
    .cover { min-height: 220px; border-bottom: 3px solid #1e293b; padding-bottom: 32px; margin-bottom: 40px; }
    .cover-service { font-size: 11px; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; color: #64748b; margin-bottom: 12px; }
    .cover-title { font-size: 28px; font-weight: 700; color: #0f172a; line-height: 1.25; margin-bottom: 8px; }
    .cover-subtitle { font-size: 15px; color: #475569; margin-bottom: 20px; }
    .cover-meta { display: flex; gap: 32px; font-size: 12px; color: #64748b; }
    .cover-meta span strong { color: #0f172a; }

    /* Section headers */
    .section { margin-bottom: 36px; }
    .section-header { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
      color: #94a3b8; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 16px; }
    .section-title { font-size: 17px; font-weight: 700; color: #0f172a; margin-bottom: 12px; }

    /* Context table */
    .context-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 32px; }
    .context-item label { font-size: 11px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.08em; color: #94a3b8; display: block; margin-bottom: 2px; }
    .context-item span { font-size: 13px; color: #1e293b; }

    /* Service tags */
    .service-list { display: flex; flex-wrap: wrap; gap: 8px; }
    .service-tag { font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 999px;
      background: #f1f5f9; color: #334155; border: 1px solid #e2e8f0; }
    .service-tag.active { background: #0f172a; color: #f8fafc; border-color: #0f172a; }

    /* AI content */
    .ai-content { font-size: 13.5px; line-height: 1.7; color: #374151; }
    .ai-content p { margin-bottom: 12px; }
    .ai-content ul { padding-left: 20px; margin-bottom: 12px; }
    .ai-content li { margin-bottom: 6px; }

    /* Next steps */
    .next-steps ol { padding-left: 20px; }
    .next-steps li { font-size: 13.5px; line-height: 1.6; color: #374151; margin-bottom: 10px; }
    .next-steps li strong { color: #0f172a; }

    /* Footer */
    .doc-footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #e2e8f0;
      font-size: 11px; color: #94a3b8; display: flex; justify-content: space-between; }
  </style>
`;

export function buildHtmlTemplate(opts: {
  serviceLabel: string;
  detailSectionTitle: string;
  nextStepsSectionTitle: string;
  aiDetailKey: string;
  aiNextStepsKey: string;
}): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8">${CSS}</head>
<body>
<div class="page">

  <!-- PORTADA -->
  <div class="cover">
    <div class="cover-service">${opts.serviceLabel}</div>
    <div class="cover-title">{{company_name}}</div>
    <div class="cover-subtitle">Informe de Entregable — {{service_name}}</div>
    <div class="cover-meta">
      <span><strong>Fecha:</strong> {{current_date}}</span>
      <span><strong>RFC:</strong> {{company_rfc}}</span>
      <span><strong>Año fiscal:</strong> {{projection_year}}</span>
      <span><strong>Elaborado por:</strong> {{branding_company_name}}</span>
    </div>
  </div>

  <!-- SECCIÓN 1: CONTEXTO DEL CLIENTE -->
  <div class="section">
    <div class="section-header">01 — Contexto del cliente</div>
    <div class="context-grid">
      <div class="context-item">
        <label>Industria</label>
        <span>{{company_industry}}</span>
      </div>
      <div class="context-item">
        <label>Facturación anual</label>
        <span>{{company_annual_revenue}}</span>
      </div>
      <div class="context-item">
        <label>Frecuencia de facturación</label>
        <span>{{company_billing_frequency}}</span>
      </div>
      <div class="context-item">
        <label>Presupuesto total (proyección)</label>
        <span>{{projection_total_budget}}</span>
      </div>
      <div class="context-item">
        <label>Ventas anuales proyectadas</label>
        <span>{{projection_annual_sales}}</span>
      </div>
      <div class="context-item">
        <label>Servicio contratado</label>
        <span>{{service_name}} — {{service_chosen_pct}}</span>
      </div>
    </div>
  </div>

  <!-- SECCIÓN 2: SERVICIOS CONTRATADOS -->
  <div class="section">
    <div class="section-header">02 — Servicios contratados</div>
    <div class="section-title">Alcance del presente entregable</div>
    <div class="service-list">
      <span class="service-tag active">{{service_name}}</span>
    </div>
    <p style="margin-top:12px;font-size:12px;color:#64748b;">
      Monto anual asignado: <strong>{{service_annual_amount}}</strong> &nbsp;·&nbsp;
      Participación en presupuesto: <strong>{{service_chosen_pct}}</strong>
    </p>
  </div>

  <!-- SECCIÓN 3: ANÁLISIS DEL ÁREA -->
  <div class="section">
    <div class="section-header">03 — ${opts.detailSectionTitle}</div>
    <div class="ai-content">{{${opts.aiDetailKey}}}</div>
  </div>

  <!-- SECCIÓN 4: PRÓXIMOS PASOS -->
  <div class="section next-steps">
    <div class="section-header">04 — ${opts.nextStepsSectionTitle}</div>
    <div class="ai-content">{{${opts.aiNextStepsKey}}}</div>
  </div>

  <!-- PIE DE PÁGINA -->
  <div class="doc-footer">
    <span>{{branding_company_name}} · {{branding_footer_text}}</span>
    <span>Generado el {{current_date}}</span>
  </div>

</div>
</body>
</html>`;
}
