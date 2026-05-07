import { buildHtmlTemplate, type DeliverableTemplateDef } from "./base-layout";

const htmlTemplate = buildHtmlTemplate({
  serviceLabel: "Legal",
  detailSectionTitle: "Diagnóstico de riesgos legales y marco de compliance",
  nextStepsSectionTitle: "Prioridades recomendadas — Legal",
  aiDetailKey: "legal_diagnostico_riesgos",
  aiNextStepsKey: "legal_prioridades_recomendadas",
});

export const LEGAL_TEMPLATE: DeliverableTemplateDef = {
  service: "Legal",
  name: "Resumen — Legal",
  type: "deliverable_long",

  aiVariables: [
    {
      name: "legal_diagnostico_riesgos",
      label: "Diagnóstico de riesgos legales y marcos de compliance aplicables",
      prompt: `Genera un diagnóstico de 3 párrafos sobre exposición legal y compliance para una empresa en la industria {industria} con facturación anual de {anualSales} y frecuencia de facturación {billingFrequency}.

Párrafo 1 — Riesgos legales recurrentes en el sector: identifica los 3 riesgos legales más frecuentes para empresas en {industria} con este nivel de facturación en México. Para cada riesgo señala: el origen típico (relación laboral, contrato comercial, regulatorio), la consecuencia patrimonial estimada, y qué señales tempranas los anuncian antes de convertirse en litigios.

Párrafo 2 — Marcos de compliance aplicables: describe los marcos regulatorios y de compliance que aplican específicamente a {industria} en México (IMSS, SAT, normativas sectoriales, protección de datos, NOM, etc.). Prioriza los que generan mayor riesgo de sanción para una empresa con facturación de {anualSales} y explica qué controles internos los mitigan.

Párrafo 3 — Gobernanza corporativa: analiza las deficiencias más comunes de gobernanza en empresas de {industria} a este nivel de facturación (contratos de socios, poderes notariales, estructura de propiedad, contratos con clientes y proveedores). Señala cuáles de estas deficiencias se vuelven bloqueos reales cuando la empresa busca financiamiento o una transacción corporativa.

Usa terminología legal precisa. No uses advertencias genéricas sobre la importancia de asesoría legal.`,
      requiredContext: ["industria", "anualSales", "billingFrequency"],
    },
    {
      name: "legal_prioridades_recomendadas",
      label: "Prioridades legales para el próximo trimestre",
      prompt: `Con base en una empresa de {industria} con facturación anual de {anualSales} y frecuencia de facturación {billingFrequency}, define exactamente 4 prioridades ejecutivas de área Legal para los próximos 90 días.

Formato para cada prioridad:
<p><strong>[N]. [Nombre de la prioridad]</strong><br>
[1–2 oraciones describiendo la acción legal concreta, el riesgo específico que mitiga o el derecho que protege, y por qué es urgente para este perfil de empresa en {industria} — no genérico]<br>
<em>Indicador de éxito: [entregable legal concreto o métrica de compliance verificable en 90 días]</em></p>

Las prioridades deben cubrir: al menos un riesgo contractual, un tema de compliance regulatorio específico de {industria}, un aspecto de gobernanza corporativa, y un elemento de protección de activos o propiedad intelectual. Ninguna prioridad debe ser intercambiable con una empresa de otro sector.`,
      requiredContext: ["industria", "anualSales", "billingFrequency"],
    },
  ],

  sections: [
    { id: "portada", title: "Portada", kind: "static" },
    { id: "contexto_cliente", title: "Contexto del cliente", kind: "static" },
    { id: "servicios_contratados", title: "Servicios contratados", kind: "static" },
    {
      id: "diagnostico_legal",
      title: "Diagnóstico de riesgos legales y marco de compliance",
      kind: "ai",
      aiVariable: "legal_diagnostico_riesgos",
    },
    {
      id: "proximos_pasos",
      title: "Prioridades recomendadas — Legal",
      kind: "ai",
      aiVariable: "legal_prioridades_recomendadas",
    },
  ],

  htmlTemplate,

  variables: [
    { key: "company_name", label: "Nombre del cliente", source: "client", required: true },
    { key: "company_rfc", label: "RFC del cliente", source: "client", required: true },
    { key: "company_industry", label: "Industria", source: "client", required: true },
    { key: "company_annual_revenue", label: "Facturación anual", source: "client", required: true },
    { key: "company_billing_frequency", label: "Frecuencia de facturación", source: "client", required: true },
    { key: "projection_year", label: "Año fiscal", source: "projection", required: true },
    { key: "projection_annual_sales", label: "Ventas anuales proyectadas", source: "projection", required: false },
    { key: "projection_total_budget", label: "Presupuesto total", source: "projection", required: false },
    { key: "service_name", label: "Nombre del servicio", source: "service", required: true },
    { key: "service_chosen_pct", label: "Porcentaje asignado", source: "service", required: false },
    { key: "service_annual_amount", label: "Monto anual del servicio", source: "service", required: false },
    { key: "branding_company_name", label: "Nombre de la consultora", source: "manual", required: false },
    { key: "branding_footer_text", label: "Texto de pie de página", source: "manual", required: false },
    { key: "current_date", label: "Fecha de generación", source: "manual", required: false },
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
};
