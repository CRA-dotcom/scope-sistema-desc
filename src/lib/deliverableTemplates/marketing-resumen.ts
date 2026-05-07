import { buildHtmlTemplate, type DeliverableTemplateDef } from "./base-layout";

const htmlTemplate = buildHtmlTemplate({
  serviceLabel: "Marketing",
  detailSectionTitle: "Análisis de posicionamiento y estrategia de mercado",
  nextStepsSectionTitle: "Prioridades recomendadas — Marketing",
  aiDetailKey: "mkt_analisis_posicionamiento",
  aiNextStepsKey: "mkt_prioridades_recomendadas",
});

export const MARKETING_TEMPLATE: DeliverableTemplateDef = {
  service: "Marketing",
  name: "Resumen — Marketing",
  type: "deliverable_long",

  aiVariables: [
    {
      name: "mkt_analisis_posicionamiento",
      label: "Análisis de posicionamiento y canales de adquisición por industria",
      prompt: `Genera un análisis de 3 párrafos sobre posicionamiento competitivo y estrategia de mercado para una empresa en la industria {industria} con facturación anual de {anualSales} y frecuencia de facturación {billingFrequency}.

Párrafo 1 — Posicionamiento y diferenciación: describe cómo se segmenta el mercado en {industria} para empresas con este nivel de facturación. Identifica los 2 principales ejes de diferenciación que generan ventaja competitiva sostenible en este sector (precio, servicio, especialización, velocidad, etc.) y por qué los demás son insuficientes.

Párrafo 2 — Canales de adquisición relevantes: señala los 3 canales de adquisición con mejor ROI demostrado en {industria} para empresas de este tamaño. Explica por qué cada canal es efectivo en este contexto específico (ciclo de ventas, ticket promedio, proceso de decisión del comprador en {industria}).

Párrafo 3 — Retención y lifetime value: analiza los patrones de retención de clientes típicos en {industria} con frecuencia de facturación {billingFrequency}. Describe qué palancas de retención generan mayor impacto a este nivel (upselling, referidos, contratos de largo plazo) y qué indicadores predicen churn temprano en este sector.

No incluyas tácticas genéricas (redes sociales, SEO, email marketing) sin justificarlas en el contexto específico de {industria}.`,
      requiredContext: ["industria", "anualSales", "billingFrequency"],
    },
    {
      name: "mkt_prioridades_recomendadas",
      label: "Prioridades de marketing para el próximo trimestre",
      prompt: `Con base en una empresa de {industria} con facturación anual de {anualSales} y frecuencia de facturación {billingFrequency}, define exactamente 4 prioridades ejecutivas de Marketing para los próximos 90 días.

Formato para cada prioridad:
<p><strong>[N]. [Nombre de la prioridad]</strong><br>
[1–2 oraciones describiendo la acción concreta, el objetivo de negocio que resuelve (adquisición, retención, posicionamiento), y por qué es la palanca correcta para este perfil específico de empresa en {industria}]<br>
<em>Indicador de éxito: [KPI de marketing concreto con objetivo numérico medible en 90 días]</em></p>

Las prioridades deben cubrir: un canal de adquisición de alto impacto para {industria}, una iniciativa de retención o expansión de clientes actuales, una mejora de posicionamiento o propuesta de valor, y una táctica de conversión o ciclo de ventas. Ninguna prioridad debe ser aplicable a cualquier empresa sin importar su sector.`,
      requiredContext: ["industria", "anualSales", "billingFrequency"],
    },
  ],

  sections: [
    { id: "portada", title: "Portada", kind: "static" },
    { id: "contexto_cliente", title: "Contexto del cliente", kind: "static" },
    { id: "servicios_contratados", title: "Servicios contratados", kind: "static" },
    {
      id: "analisis_marketing",
      title: "Análisis de posicionamiento y estrategia de mercado",
      kind: "ai",
      aiVariable: "mkt_analisis_posicionamiento",
    },
    {
      id: "proximos_pasos",
      title: "Prioridades recomendadas — Marketing",
      kind: "ai",
      aiVariable: "mkt_prioridades_recomendadas",
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
};
