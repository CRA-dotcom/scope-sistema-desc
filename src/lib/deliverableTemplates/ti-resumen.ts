import { buildHtmlTemplate, type DeliverableTemplateDef } from "./base-layout";

const htmlTemplate = buildHtmlTemplate({
  serviceLabel: "Tecnologías de la Información",
  detailSectionTitle: "Diagnóstico de madurez digital e infraestructura TI",
  nextStepsSectionTitle: "Prioridades recomendadas — TI",
  aiDetailKey: "ti_diagnostico_madurez",
  aiNextStepsKey: "ti_prioridades_recomendadas",
});

export const TI_TEMPLATE: DeliverableTemplateDef = {
  service: "TI",
  name: "Resumen — Tecnologías de la Información",
  type: "deliverable_long",

  aiVariables: [
    {
      name: "ti_diagnostico_madurez",
      label: "Diagnóstico de madurez digital y riesgos de infraestructura TI",
      prompt: `Genera un diagnóstico de 3 párrafos sobre la madurez digital e infraestructura tecnológica de una empresa en la industria {industria} con facturación anual de {anualSales} y frecuencia de facturación {billingFrequency}.

Párrafo 1 — Stack tecnológico típico y brechas: describe el stack tecnológico promedio de una empresa mediana en {industria} con esta facturación. Identifica las brechas más comunes entre el estado actual del sector y lo que requiere una operación eficiente a este nivel (ERP, CRM, integraciones, automatizaciones).

Párrafo 2 — Riesgos de seguridad e infraestructura: enumera los 3 vectores de riesgo de ciberseguridad más relevantes para {industria} y explica por qué son particularmente críticos para empresas con frecuencia de facturación {billingFrequency} (flujo de datos sensibles, transacciones, acceso de terceros).

Párrafo 3 — Deuda técnica y modernización: analiza qué tipos de deuda técnica se acumulan con más frecuencia en {industria} a este nivel de crecimiento, y qué proyectos de modernización tienen mayor ROI a corto plazo para una empresa de este perfil.

Usa terminología técnica apropiada pero accesible para decisores de negocio. Evita recomendaciones genéricas aplicables a cualquier empresa.`,
      requiredContext: ["industria", "anualSales", "billingFrequency"],
    },
    {
      name: "ti_prioridades_recomendadas",
      label: "Prioridades de TI para el próximo trimestre",
      prompt: `Con base en una empresa de {industria} con facturación anual de {anualSales} y frecuencia de facturación {billingFrequency}, define exactamente 4 prioridades ejecutivas de Tecnologías de la Información para los próximos 90 días.

Formato para cada prioridad:
<p><strong>[N]. [Nombre de la prioridad]</strong><br>
[1–2 oraciones describiendo la acción técnica concreta, el riesgo que mitiga o la eficiencia que captura, y por qué es prioritaria para una empresa de {industria} en este momento]<br>
<em>Indicador de éxito: [métrica técnica o de negocio concreta medible en 90 días]</em></p>

Las prioridades deben cubrir: al menos un tema de seguridad específico a {industria}, una integración o automatización de alto impacto, un proyecto de infraestructura, y un indicador de madurez digital. Ninguna prioridad debe ser genérica ni aplicable a cualquier tipo de empresa.`,
      requiredContext: ["industria", "anualSales", "billingFrequency"],
    },
  ],

  sections: [
    { id: "portada", title: "Portada", kind: "static" },
    { id: "contexto_cliente", title: "Contexto del cliente", kind: "static" },
    { id: "servicios_contratados", title: "Servicios contratados", kind: "static" },
    {
      id: "diagnostico_ti",
      title: "Diagnóstico de madurez digital e infraestructura TI",
      kind: "ai",
      aiVariable: "ti_diagnostico_madurez",
    },
    {
      id: "proximos_pasos",
      title: "Prioridades recomendadas — TI",
      kind: "ai",
      aiVariable: "ti_prioridades_recomendadas",
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
};
