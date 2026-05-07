import { buildHtmlTemplate, type DeliverableTemplateDef } from "./base-layout";

const htmlTemplate = buildHtmlTemplate({
  serviceLabel: "Administración",
  detailSectionTitle: "Análisis administrativo y operativo",
  nextStepsSectionTitle: "Prioridades recomendadas — Administración",
  aiDetailKey: "admin_analisis_contexto",
  aiNextStepsKey: "admin_prioridades_recomendadas",
});

export const ADMIN_TEMPLATE: DeliverableTemplateDef = {
  service: "Admin",
  name: "Resumen — Administración",
  type: "deliverable_long",

  aiVariables: [
    {
      name: "admin_analisis_contexto",
      label: "Análisis de retos administrativos específicos al cliente",
      prompt: `Genera un análisis ejecutivo de 3 párrafos sobre los retos administrativos críticos de una empresa en la industria {industria} con facturación anual de {anualSales} y frecuencia de facturación {billingFrequency}.

Párrafo 1 — Estructura organizativa: describe cómo debería estar estructurada la función administrativa para una empresa de este tamaño y sector. Señala dónde se acumulan cuellos de botella comunes en esta industria (aprobaciones, reportes, flujo de caja).

Párrafo 2 — Controles internos: identifica los 2–3 controles internos más críticos para este tipo de empresa. Sé específico al sector: las vulnerabilidades de un despacho de servicios profesionales son distintas a las de una empresa manufacturera.

Párrafo 3 — Procesos de escalabilidad: explica qué procesos administrativos tienden a romperse primero cuando una empresa en {industria} crece más allá de su tamaño actual, y qué medidas concretas evitan ese quiebre.

Usa lenguaje profesional en español. No uses frases genéricas. Cada afirmación debe ser verificable en el contexto del sector.`,
      requiredContext: ["industria", "anualSales", "billingFrequency"],
    },
    {
      name: "admin_prioridades_recomendadas",
      label: "Prioridades de acción en administración para el próximo trimestre",
      prompt: `Con base en el perfil de una empresa en {industria} con facturación anual de {anualSales} y frecuencia de facturación {billingFrequency}, lista exactamente 4 prioridades ejecutivas de administración para los próximos 90 días.

Formato para cada prioridad:
<p><strong>[N]. [Nombre de la prioridad]</strong><br>
[1 oración explicando qué se debe hacer y por qué es urgente para este perfil de empresa]<br>
<em>Indicador de éxito: [métrica concreta con número o porcentaje objetivo]</em></p>

Las prioridades deben cubrir al menos: flujo de caja, reporting interno, proceso de aprobaciones, y un proceso específico de la industria {industria}. Ninguna prioridad debe ser intercambiable con una empresa de otro sector.`,
      requiredContext: ["industria", "anualSales", "billingFrequency"],
    },
  ],

  sections: [
    { id: "portada", title: "Portada", kind: "static" },
    { id: "contexto_cliente", title: "Contexto del cliente", kind: "static" },
    { id: "servicios_contratados", title: "Servicios contratados", kind: "static" },
    {
      id: "analisis_admin",
      title: "Análisis administrativo y operativo",
      kind: "ai",
      aiVariable: "admin_analisis_contexto",
    },
    {
      id: "proximos_pasos",
      title: "Prioridades recomendadas — Administración",
      kind: "ai",
      aiVariable: "admin_prioridades_recomendadas",
    },
  ],

  htmlTemplate,

  variables: [
    // Static client vars
    { key: "company_name", label: "Nombre del cliente", source: "client", required: true },
    { key: "company_rfc", label: "RFC del cliente", source: "client", required: true },
    { key: "company_industry", label: "Industria", source: "client", required: true },
    { key: "company_annual_revenue", label: "Facturación anual", source: "client", required: true },
    { key: "company_billing_frequency", label: "Frecuencia de facturación", source: "client", required: true },
    // Static projection vars
    { key: "projection_year", label: "Año fiscal", source: "projection", required: true },
    { key: "projection_annual_sales", label: "Ventas anuales proyectadas", source: "projection", required: false },
    { key: "projection_total_budget", label: "Presupuesto total", source: "projection", required: false },
    // Static service vars
    { key: "service_name", label: "Nombre del servicio", source: "service", required: true },
    { key: "service_chosen_pct", label: "Porcentaje asignado", source: "service", required: false },
    { key: "service_annual_amount", label: "Monto anual del servicio", source: "service", required: false },
    // Branding vars
    { key: "branding_company_name", label: "Nombre de la consultora", source: "manual", required: false },
    { key: "branding_footer_text", label: "Texto de pie de página", source: "manual", required: false },
    { key: "current_date", label: "Fecha de generación", source: "manual", required: false },
    // AI vars
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
};
