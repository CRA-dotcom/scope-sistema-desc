import { buildHtmlTemplate, type DeliverableTemplateDef } from "./base-layout";

const htmlTemplate = buildHtmlTemplate({
  serviceLabel: "Recursos Humanos",
  detailSectionTitle: "Diagnóstico de capital humano y gestión del talento",
  nextStepsSectionTitle: "Prioridades recomendadas — RH",
  aiDetailKey: "rh_diagnostico_talento",
  aiNextStepsKey: "rh_prioridades_recomendadas",
});

export const RH_TEMPLATE: DeliverableTemplateDef = {
  service: "RH",
  name: "Resumen — Recursos Humanos",
  type: "deliverable_long",

  aiVariables: [
    {
      name: "rh_diagnostico_talento",
      label: "Diagnóstico de gestión de talento por industria y tamaño",
      prompt: `Genera un diagnóstico de 3 párrafos sobre la gestión de capital humano para una empresa en la industria {industria} con facturación anual de {anualSales} y frecuencia de facturación {billingFrequency}.

Párrafo 1 — Perfiles críticos y rotación: describe los perfiles de talento más difíciles de retener en {industria} a este nivel de facturación. Señala las causas de rotación más comunes en este sector (compensación, desarrollo, cultura) y qué porcentaje de rotación es típico versus problemático.

Párrafo 2 — Cultura y compensación: analiza cómo empresas de {industria} con facturación similar suelen estructurar su esquema de compensación variable y beneficios. Identifica la brecha más frecuente entre lo que los colaboradores valoran y lo que la empresa ofrece en este sector.

Párrafo 3 — Desarrollo y sucesión: explica qué capacidades internas se vuelven cuellos de botella cuando una empresa en {industria} crecer más allá de {anualSales} anuales, y cómo los planes de sucesión mal diseñados amplifican ese riesgo.

Usa lenguaje profesional en español. Evita generalidades aplicables a cualquier sector. Cada punto debe ser verificable en el contexto de {industria}.`,
      requiredContext: ["industria", "anualSales", "billingFrequency"],
    },
    {
      name: "rh_prioridades_recomendadas",
      label: "Prioridades de RH para el próximo trimestre",
      prompt: `Con base en una empresa de {industria} con facturación anual de {anualSales} y frecuencia de facturación {billingFrequency}, define exactamente 4 prioridades ejecutivas de Recursos Humanos para los próximos 90 días.

Formato para cada prioridad:
<p><strong>[N]. [Nombre de la prioridad]</strong><br>
[1–2 oraciones explicando la acción concreta, por qué es crítica en este momento para este perfil de empresa, y qué consecuencia tiene no atenderla]<br>
<em>Indicador de éxito: [métrica concreta medible en 90 días]</em></p>

Las prioridades deben cubrir: retención de perfiles clave en {industria}, esquema de compensación variable, clima organizacional, y un elemento específico de desarrollo o sucesión relevante para empresas de este tamaño en este sector. Ninguna prioridad debe ser genérica ni intercambiable con otra industria.`,
      requiredContext: ["industria", "anualSales", "billingFrequency"],
    },
  ],

  sections: [
    { id: "portada", title: "Portada", kind: "static" },
    { id: "contexto_cliente", title: "Contexto del cliente", kind: "static" },
    { id: "servicios_contratados", title: "Servicios contratados", kind: "static" },
    {
      id: "diagnostico_rh",
      title: "Diagnóstico de capital humano y gestión del talento",
      kind: "ai",
      aiVariable: "rh_diagnostico_talento",
    },
    {
      id: "proximos_pasos",
      title: "Prioridades recomendadas — RH",
      kind: "ai",
      aiVariable: "rh_prioridades_recomendadas",
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
};
