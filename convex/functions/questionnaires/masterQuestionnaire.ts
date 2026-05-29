// convex/functions/questionnaires/masterQuestionnaire.ts

export type MasterQuestionType =
  | "text"
  | "textarea"
  | "select"
  | "number"
  | "date"
  | "file_upload";

export type MasterQuestion = {
  key: string;
  section: string;
  subsection: string;
  text: string;
  type: MasterQuestionType;
  options?: string[];
  fileConfig?: {
    acceptedMimeTypes: string[];
    maxSizeMB: number;
    multiple: boolean;
  };
  variableKey?: string;
  serviceScope?: string[];
};

const SI_NO: string[] = ["Sí", "No"];
const SI_NO_NS: string[] = ["Sí", "No", "No sé"];

const SEC_1 = "1. Información General de la Empresa";
const SEC_2 = "2. Modelo de Negocio y Operación";
const SEC_3 = "3. Marketing y Comercial";
const SEC_4 = "4. Finanzas";
const SEC_5 = "5. Contabilidad y Cumplimiento Fiscal";
const SEC_6 = "6. Legal y Gobierno Corporativo";
const SEC_7 = "7. Recursos Humanos";
const SEC_8 = "8. Tecnología y Sistemas";
const SEC_9 = "9. Objetivos y Prioridades";
const SEC_10 = "10. Documentación Disponible";
const SEC_11 = "11. Observaciones Finales";

export const MASTER_QUESTIONS: MasterQuestion[] = [
  // ─── SECCIÓN 1 ─────────────────────────────────────────
  // 1.1 Datos Generales
  { key: "company_legal_name", section: SEC_1, subsection: "1.1 Datos Generales", text: "Nombre legal de la empresa", type: "text", variableKey: "company_legal_name" },
  { key: "company_name", section: SEC_1, subsection: "1.1 Datos Generales", text: "Nombre comercial (si es diferente)", type: "text", variableKey: "company_name" },
  { key: "company_rfc", section: SEC_1, subsection: "1.1 Datos Generales", text: "RFC", type: "text", variableKey: "company_rfc" },
  { key: "company_incorporation_date", section: SEC_1, subsection: "1.1 Datos Generales", text: "Fecha de constitución", type: "date", variableKey: "company_incorporation_date" },
  { key: "company_industry", section: SEC_1, subsection: "1.1 Datos Generales", text: "Giro o actividad principal", type: "text", variableKey: "company_industry" },
  { key: "company_fiscal_address", section: SEC_1, subsection: "1.1 Datos Generales", text: "Dirección fiscal", type: "textarea", variableKey: "company_fiscal_address" },
  { key: "company_location", section: SEC_1, subsection: "1.1 Datos Generales", text: "Ciudad y estado de operación", type: "text", variableKey: "company_location" },
  { key: "company_website", section: SEC_1, subsection: "1.1 Datos Generales", text: "Página web", type: "text" },
  { key: "company_social_media", section: SEC_1, subsection: "1.1 Datos Generales", text: "Redes sociales", type: "textarea" },
  { key: "company_employee_count", section: SEC_1, subsection: "1.1 Datos Generales", text: "Número total de empleados", type: "number", variableKey: "company_employee_count" },
  { key: "company_legal_rep", section: SEC_1, subsection: "1.1 Datos Generales", text: "Nombre del representante legal", type: "text", variableKey: "company_legal_rep" },
  { key: "company_phone", section: SEC_1, subsection: "1.1 Datos Generales", text: "Teléfono principal", type: "text", variableKey: "company_phone" },
  { key: "company_email", section: SEC_1, subsection: "1.1 Datos Generales", text: "Correo principal", type: "text", variableKey: "company_email" },

  // 1.2 Historia y Contexto
  { key: "history_origin", section: SEC_1, subsection: "1.2 Historia y Contexto", text: "¿Cómo nació la empresa?", type: "textarea" },
  { key: "history_years_operating", section: SEC_1, subsection: "1.2 Historia y Contexto", text: "¿Cuántos años lleva operando?", type: "number" },
  { key: "history_differentiator", section: SEC_1, subsection: "1.2 Historia y Contexto", text: "¿Cuál considera que es el principal diferenciador de la empresa?", type: "textarea" },
  { key: "history_vision", section: SEC_1, subsection: "1.2 Historia y Contexto", text: "¿Cuál es la visión de la empresa a 3-5 años?", type: "textarea" },
  { key: "history_main_challenges", section: SEC_1, subsection: "1.2 Historia y Contexto", text: "¿Cuáles son actualmente los principales retos del negocio?", type: "textarea" },

  // ─── SECCIÓN 2 ─────────────────────────────────────────
  // 2.1 Productos y Servicios
  { key: "ps_what", section: SEC_2, subsection: "2.1 Productos y Servicios", text: "¿Qué productos o servicios venden?", type: "textarea" },
  { key: "ps_main", section: SEC_2, subsection: "2.1 Productos y Servicios", text: "¿Cuál es su producto o servicio principal?", type: "textarea" },
  { key: "ps_line_percentages", section: SEC_2, subsection: "2.1 Productos y Servicios", text: "¿Qué porcentaje representa cada línea de negocio?", type: "textarea" },
  { key: "ps_avg_ticket", section: SEC_2, subsection: "2.1 Productos y Servicios", text: "¿Cuál es el ticket promedio por cliente?", type: "text" },
  { key: "ps_revenue_model", section: SEC_2, subsection: "2.1 Productos y Servicios", text: "¿Cómo generan ingresos actualmente?", type: "textarea" },
  { key: "ps_recurring_vs_oneoff", section: SEC_2, subsection: "2.1 Productos y Servicios", text: "¿Tienen ingresos recurrentes o ventas únicas?", type: "select", options: ["Recurrentes", "Ventas únicas", "Ambos"] },

  // 2.2 Clientes
  { key: "clients_ideal", section: SEC_2, subsection: "2.2 Clientes", text: "¿Quién es su cliente ideal?", type: "textarea" },
  { key: "clients_type_personas_fisicas", section: SEC_2, subsection: "2.2 Clientes", text: "¿Tienen clientes Personas físicas?", type: "select", options: SI_NO },
  { key: "clients_type_empresas", section: SEC_2, subsection: "2.2 Clientes", text: "¿Tienen clientes Empresas?", type: "select", options: SI_NO },
  { key: "clients_type_gobierno", section: SEC_2, subsection: "2.2 Clientes", text: "¿Tienen clientes Gobierno?", type: "select", options: SI_NO },
  { key: "clients_type_internacionales", section: SEC_2, subsection: "2.2 Clientes", text: "¿Tienen clientes Internacionales?", type: "select", options: SI_NO },
  { key: "clients_active_count", section: SEC_2, subsection: "2.2 Clientes", text: "¿Cuántos clientes activos tienen aproximadamente?", type: "number" },
  { key: "clients_main", section: SEC_2, subsection: "2.2 Clientes", text: "¿Quiénes son sus principales clientes?", type: "textarea" },
  { key: "clients_concentration", section: SEC_2, subsection: "2.2 Clientes", text: "¿Existe concentración de ingresos en pocos clientes?", type: "select", options: SI_NO_NS },
  { key: "clients_acquisition", section: SEC_2, subsection: "2.2 Clientes", text: "¿Cómo consiguen actualmente nuevos clientes?", type: "textarea" },
  { key: "clients_problem_solved", section: SEC_2, subsection: "2.2 Clientes", text: "¿Cuál es el principal problema que resuelven a sus clientes?", type: "textarea" },

  // 2.3 Operación
  { key: "ops_daily", section: SEC_2, subsection: "2.3 Operación", text: "Explique brevemente cómo funciona la operación diaria de la empresa.", type: "textarea" },
  { key: "ops_main_areas", section: SEC_2, subsection: "2.3 Operación", text: "¿Cuáles son las áreas principales del negocio?", type: "textarea" },
  { key: "ops_critical_processes", section: SEC_2, subsection: "2.3 Operación", text: "¿Qué procesos consideran críticos?", type: "textarea" },
  { key: "ops_documented_processes", section: SEC_2, subsection: "2.3 Operación", text: "¿Qué procesos están documentados?", type: "textarea" },
  { key: "ops_key_person_dependent", section: SEC_2, subsection: "2.3 Operación", text: "¿Qué procesos siguen dependiendo totalmente de personas clave?", type: "textarea" },
  { key: "ops_automated", section: SEC_2, subsection: "2.3 Operación", text: "¿Qué actividades ya están automatizadas?", type: "textarea" },
  { key: "ops_manual", section: SEC_2, subsection: "2.3 Operación", text: "¿Qué actividades siguen siendo manuales?", type: "textarea" },

  // ─── SECCIÓN 3 ─────────────────────────────────────────
  // 3.1 Estrategia Comercial
  { key: "sales_how", section: SEC_3, subsection: "3.1 Estrategia Comercial", text: "¿Cómo venden actualmente?", type: "textarea" },
  { key: "sales_has_team", section: SEC_3, subsection: "3.1 Estrategia Comercial", text: "¿Tienen equipo comercial?", type: "select", options: SI_NO },
  { key: "sales_team_size", section: SEC_3, subsection: "3.1 Estrategia Comercial", text: "¿Cuántos vendedores tienen?", type: "number" },
  { key: "sales_crm", section: SEC_3, subsection: "3.1 Estrategia Comercial", text: "¿Utilizan CRM? ¿Cuál?", type: "text" },
  { key: "sales_followup", section: SEC_3, subsection: "3.1 Estrategia Comercial", text: "¿Cómo dan seguimiento a prospectos?", type: "textarea" },
  { key: "sales_close_rate", section: SEC_3, subsection: "3.1 Estrategia Comercial", text: "¿Cuál es su tasa aproximada de cierre?", type: "text" },

  // 3.2 Marketing
  { key: "mkt_campaigns_active", section: SEC_3, subsection: "3.2 Marketing", text: "¿Actualmente realizan campañas de marketing?", type: "select", options: SI_NO },
  { key: "mkt_channel_facebook", section: SEC_3, subsection: "3.2 Marketing", text: "Canal: Facebook", type: "select", options: SI_NO },
  { key: "mkt_channel_instagram", section: SEC_3, subsection: "3.2 Marketing", text: "Canal: Instagram", type: "select", options: SI_NO },
  { key: "mkt_channel_tiktok", section: SEC_3, subsection: "3.2 Marketing", text: "Canal: TikTok", type: "select", options: SI_NO },
  { key: "mkt_channel_linkedin", section: SEC_3, subsection: "3.2 Marketing", text: "Canal: LinkedIn", type: "select", options: SI_NO },
  { key: "mkt_channel_google_ads", section: SEC_3, subsection: "3.2 Marketing", text: "Canal: Google Ads", type: "select", options: SI_NO },
  { key: "mkt_channel_email", section: SEC_3, subsection: "3.2 Marketing", text: "Canal: Email marketing", type: "select", options: SI_NO },
  { key: "mkt_channel_whatsapp", section: SEC_3, subsection: "3.2 Marketing", text: "Canal: WhatsApp", type: "select", options: SI_NO },
  { key: "mkt_channel_referrals", section: SEC_3, subsection: "3.2 Marketing", text: "Canal: Referidos", type: "select", options: SI_NO },
  { key: "mkt_monthly_budget", section: SEC_3, subsection: "3.2 Marketing", text: "¿Cuál es su presupuesto mensual aproximado de marketing?", type: "number" },
  { key: "mkt_campaigns_worked", section: SEC_3, subsection: "3.2 Marketing", text: "¿Qué campañas han funcionado mejor?", type: "textarea" },
  { key: "mkt_campaigns_failed", section: SEC_3, subsection: "3.2 Marketing", text: "¿Qué campañas no funcionaron?", type: "textarea" },
  { key: "mkt_brand_manual", section: SEC_3, subsection: "3.2 Marketing", text: "¿Tienen identidad corporativa/manual de marca?", type: "select", options: SI_NO },
  { key: "mkt_website_active", section: SEC_3, subsection: "3.2 Marketing", text: "¿Tienen página web activa?", type: "select", options: SI_NO },
  { key: "mkt_social_admin", section: SEC_3, subsection: "3.2 Marketing", text: "¿Quién administra redes sociales?", type: "text" },
  { key: "mkt_yearly_objectives", section: SEC_3, subsection: "3.2 Marketing", text: "¿Qué objetivos comerciales desean alcanzar este año?", type: "textarea" },

  // 3.3 Competencia y Mercado
  { key: "comp_main", section: SEC_3, subsection: "3.3 Competencia y Mercado", text: "¿Quiénes son sus principales competidores?", type: "textarea" },
  { key: "comp_their_strengths", section: SEC_3, subsection: "3.3 Competencia y Mercado", text: "¿Qué hacen mejor que ustedes?", type: "textarea" },
  { key: "comp_our_strengths", section: SEC_3, subsection: "3.3 Competencia y Mercado", text: "¿Qué hacen ustedes mejor que ellos?", type: "textarea" },
  { key: "comp_opportunities", section: SEC_3, subsection: "3.3 Competencia y Mercado", text: "¿Qué oportunidades ven actualmente en el mercado?", type: "textarea" },
  { key: "comp_threats", section: SEC_3, subsection: "3.3 Competencia y Mercado", text: "¿Qué amenazas consideran importantes?", type: "textarea" },

  // ─── SECCIÓN 4 ─────────────────────────────────────────
  // 4.1 Información Financiera General
  { key: "fin_monthly_sales", section: SEC_4, subsection: "4.1 Información Financiera General", text: "Ventas mensuales promedio", type: "number", variableKey: "company_monthly_sales" },
  { key: "fin_profit_margin", section: SEC_4, subsection: "4.1 Información Financiera General", text: "Margen aproximado de utilidad", type: "text", variableKey: "company_profit_margin" },
  { key: "fin_monthly_fixed_expenses", section: SEC_4, subsection: "4.1 Información Financiera General", text: "Gastos fijos mensuales", type: "number", variableKey: "company_monthly_fixed_expenses" },
  { key: "fin_variable_expenses_nomina", section: SEC_4, subsection: "4.1 Información Financiera General", text: "Gastos variables — Nómina mensual", type: "number", variableKey: "company_variable_expenses_nomina" },
  { key: "fin_variable_expenses_renta", section: SEC_4, subsection: "4.1 Información Financiera General", text: "Gastos variables — Renta", type: "number", variableKey: "company_variable_expenses_renta" },
  { key: "fin_variable_expenses_servicios", section: SEC_4, subsection: "4.1 Información Financiera General", text: "Gastos variables — Servicios (luz, agua, internet)", type: "number", variableKey: "company_variable_expenses_servicios" },
  { key: "fin_variable_expenses_insumos", section: SEC_4, subsection: "4.1 Información Financiera General", text: "Gastos variables — Insumos", type: "number", variableKey: "company_variable_expenses_insumos" },
  { key: "fin_variable_expenses_mantenimiento", section: SEC_4, subsection: "4.1 Información Financiera General", text: "Gastos variables — Mantenimiento", type: "number", variableKey: "company_variable_expenses_mantenimiento" },
  { key: "fin_variable_expenses_otros", section: SEC_4, subsection: "4.1 Información Financiera General", text: "Gastos variables — Otros", type: "number", variableKey: "company_variable_expenses_otros" },
  { key: "fin_monthly_cashflow", section: SEC_4, subsection: "4.1 Información Financiera General", text: "Flujo mensual aproximado", type: "number", variableKey: "company_monthly_cashflow" },
  { key: "fin_is_profitable", section: SEC_4, subsection: "4.1 Información Financiera General", text: "¿La empresa actualmente es rentable?", type: "select", options: SI_NO_NS },

  // 4.2 Control Financiero
  { key: "fin_has_budgets", section: SEC_4, subsection: "4.2 Control Financiero", text: "¿Tienen presupuestos mensuales o anuales?", type: "select", options: SI_NO },
  { key: "fin_finance_owner", section: SEC_4, subsection: "4.2 Control Financiero", text: "¿Quién controla las finanzas?", type: "text" },
  { key: "fin_erp_system", section: SEC_4, subsection: "4.2 Control Financiero", text: "¿Utilizan algún ERP o sistema financiero? ¿Cuál?", type: "text" },
  { key: "fin_monthly_statements", section: SEC_4, subsection: "4.2 Control Financiero", text: "¿Se generan estados financieros mensuales?", type: "select", options: SI_NO },
  { key: "fin_cashflow_review_freq", section: SEC_4, subsection: "4.2 Control Financiero", text: "¿Con qué frecuencia revisan flujo de efectivo?", type: "text" },
  { key: "fin_overdue_receivables", section: SEC_4, subsection: "4.2 Control Financiero", text: "¿Tienen cuentas por cobrar vencidas?", type: "select", options: SI_NO_NS },
  { key: "fin_active_debts", section: SEC_4, subsection: "4.2 Control Financiero", text: "¿Tienen deudas activas?", type: "select", options: SI_NO },
  { key: "fin_credit_lines", section: SEC_4, subsection: "4.2 Control Financiero", text: "¿Qué créditos o financiamientos tienen actualmente?", type: "textarea" },

  // 4.3 Riesgos Financieros
  { key: "fin_biggest_risk", section: SEC_4, subsection: "4.3 Riesgos Financieros", text: "¿Cuál considera que es el mayor riesgo financiero actualmente?", type: "textarea" },
  { key: "fin_money_drains", section: SEC_4, subsection: "4.3 Riesgos Financieros", text: "¿Qué área genera más fugas de dinero?", type: "textarea" },
  { key: "fin_uncontrolled_expenses", section: SEC_4, subsection: "4.3 Riesgos Financieros", text: "¿Existen gastos no controlados?", type: "textarea" },
  { key: "fin_kpis", section: SEC_4, subsection: "4.3 Riesgos Financieros", text: "¿Tienen indicadores financieros clave (KPIs)?", type: "textarea" },
  { key: "fin_yearly_goal", section: SEC_4, subsection: "4.3 Riesgos Financieros", text: "¿Cuál es el principal objetivo financiero este año?", type: "textarea" },

  // ─── SECCIÓN 5 ─────────────────────────────────────────
  // 5.1 Situación Contable
  { key: "acct_who", section: SEC_5, subsection: "5.1 Situación Contable", text: "¿Quién lleva la contabilidad actualmente?", type: "text" },
  { key: "acct_internal_external", section: SEC_5, subsection: "5.1 Situación Contable", text: "¿Es interno o externo?", type: "select", options: ["Interno", "Externo", "Mixto"] },
  { key: "acct_system", section: SEC_5, subsection: "5.1 Situación Contable", text: "¿Qué sistema contable utilizan?", type: "text" },
  { key: "acct_up_to_date", section: SEC_5, subsection: "5.1 Situación Contable", text: "¿La contabilidad está al corriente?", type: "select", options: SI_NO_NS },
  { key: "acct_monthly_bank_recon", section: SEC_5, subsection: "5.1 Situación Contable", text: "¿Se concilian cuentas bancarias mensualmente?", type: "select", options: SI_NO },
  { key: "acct_xml_organized", section: SEC_5, subsection: "5.1 Situación Contable", text: "¿Se cuenta con XML organizados?", type: "select", options: SI_NO },
  { key: "acct_monthly_close", section: SEC_5, subsection: "5.1 Situación Contable", text: "¿Se realizan cierres mensuales?", type: "select", options: SI_NO },

  // 5.2 Cumplimiento Fiscal
  { key: "tax_regime", section: SEC_5, subsection: "5.2 Cumplimiento Fiscal", text: "Régimen fiscal actual", type: "text", variableKey: "company_tax_regime" },
  { key: "tax_compliance_opinion", section: SEC_5, subsection: "5.2 Cumplimiento Fiscal", text: "¿Tienen opinión de cumplimiento positiva?", type: "select", options: SI_NO_NS },
  { key: "tax_sat_requirements", section: SEC_5, subsection: "5.2 Cumplimiento Fiscal", text: "¿Existen requerimientos activos del SAT?", type: "select", options: SI_NO_NS },
  { key: "tax_credits", section: SEC_5, subsection: "5.2 Cumplimiento Fiscal", text: "¿Existen créditos fiscales?", type: "select", options: SI_NO_NS },
  { key: "tax_audits_history", section: SEC_5, subsection: "5.2 Cumplimiento Fiscal", text: "¿Han tenido auditorías fiscales?", type: "select", options: SI_NO },
  { key: "tax_digital_certs", section: SEC_5, subsection: "5.2 Cumplimiento Fiscal", text: "¿Tienen activos los certificados digitales (.cer/.key)?", type: "select", options: SI_NO_NS },
  { key: "tax_sat_admin", section: SEC_5, subsection: "5.2 Cumplimiento Fiscal", text: "¿Quién administra accesos SAT y certificados?", type: "text" },
  { key: "tax_cfdi_controls", section: SEC_5, subsection: "5.2 Cumplimiento Fiscal", text: "¿Tienen controles de facturación y cancelación CFDI?", type: "select", options: SI_NO },

  // 5.3 Riesgos y Control
  { key: "acct_main_risk", section: SEC_5, subsection: "5.3 Riesgos y Control", text: "¿Cuál considera que es el principal riesgo fiscal o contable?", type: "textarea" },
  { key: "acct_problem_processes", section: SEC_5, subsection: "5.3 Riesgos y Control", text: "¿Qué procesos contables son más problemáticos?", type: "textarea" },
  { key: "acct_ops_divergence", section: SEC_5, subsection: "5.3 Riesgos y Control", text: "¿Existen diferencias entre operación y contabilidad?", type: "select", options: SI_NO_NS },
  { key: "acct_control_policies", section: SEC_5, subsection: "5.3 Riesgos y Control", text: "¿Tienen políticas internas de control financiero?", type: "select", options: SI_NO },

  // ─── SECCIÓN 6 ─────────────────────────────────────────
  // 6.1 Estructura Legal
  { key: "legal_form", section: SEC_6, subsection: "6.1 Estructura Legal", text: "Tipo de sociedad", type: "text", variableKey: "company_legal_form" },
  { key: "legal_shareholders", section: SEC_6, subsection: "6.1 Estructura Legal", text: "¿Quiénes son los socios actuales?", type: "textarea" },
  { key: "legal_ownership_distribution", section: SEC_6, subsection: "6.1 Estructura Legal", text: "Participación accionaria de cada socio", type: "textarea" },
  { key: "legal_has_board", section: SEC_6, subsection: "6.1 Estructura Legal", text: "¿Existe consejo de administración?", type: "select", options: SI_NO },
  { key: "legal_shareholder_agreements", section: SEC_6, subsection: "6.1 Estructura Legal", text: "¿Existen acuerdos entre socios?", type: "select", options: SI_NO },
  { key: "legal_corporate_books", section: SEC_6, subsection: "6.1 Estructura Legal", text: "¿La empresa tiene libros corporativos actualizados?", type: "select", options: SI_NO_NS },
  { key: "legal_minutes_notarized", section: SEC_6, subsection: "6.1 Estructura Legal", text: "¿Las actas están protocolizadas?", type: "select", options: SI_NO_NS },

  // 6.2 Contratos y Riesgos Legales
  { key: "legal_contract_types", section: SEC_6, subsection: "6.2 Contratos y Riesgos Legales", text: "¿Qué contratos utilizan regularmente?", type: "textarea" },
  { key: "legal_labor_contracts", section: SEC_6, subsection: "6.2 Contratos y Riesgos Legales", text: "¿Tienen contratos laborales formalizados?", type: "select", options: SI_NO },
  { key: "legal_supplier_contracts", section: SEC_6, subsection: "6.2 Contratos y Riesgos Legales", text: "¿Tienen contratos con proveedores?", type: "select", options: SI_NO },
  { key: "legal_client_contracts", section: SEC_6, subsection: "6.2 Contratos y Riesgos Legales", text: "¿Tienen contratos con clientes?", type: "select", options: SI_NO },
  { key: "legal_active_disputes", section: SEC_6, subsection: "6.2 Contratos y Riesgos Legales", text: "¿Existen demandas activas o riesgos legales?", type: "textarea" },
  { key: "legal_trademarks", section: SEC_6, subsection: "6.2 Contratos y Riesgos Legales", text: "¿La empresa tiene marcas registradas?", type: "select", options: SI_NO },
  { key: "legal_privacy_terms", section: SEC_6, subsection: "6.2 Contratos y Riesgos Legales", text: "¿Tienen avisos de privacidad y términos legales?", type: "select", options: SI_NO },

  // 6.3 Gobierno Corporativo
  { key: "gov_periodic_meetings", section: SEC_6, subsection: "6.3 Gobierno Corporativo", text: "¿Se realizan juntas periódicas?", type: "select", options: SI_NO },
  { key: "gov_decision_making", section: SEC_6, subsection: "6.3 Gobierno Corporativo", text: "¿Cómo se toman decisiones importantes?", type: "textarea" },
  { key: "gov_internal_policies", section: SEC_6, subsection: "6.3 Gobierno Corporativo", text: "¿Existen políticas internas formales?", type: "select", options: SI_NO },
  { key: "gov_org_chart", section: SEC_6, subsection: "6.3 Gobierno Corporativo", text: "¿Tienen organigrama definido?", type: "select", options: SI_NO },
  { key: "gov_uncontrolled_areas", section: SEC_6, subsection: "6.3 Gobierno Corporativo", text: "¿Qué áreas carecen de control o supervisión?", type: "textarea" },

  // ─── SECCIÓN 7 ─────────────────────────────────────────
  // 7.1 Estructura Organizacional
  { key: "hr_org_chart_attach", section: SEC_7, subsection: "7.1 Estructura Organizacional", text: "Adjunte organigrama actual (si existe). Descríbalo en texto.", type: "textarea" },
  { key: "hr_total_collaborators", section: SEC_7, subsection: "7.1 Estructura Organizacional", text: "Número total de colaboradores", type: "number", variableKey: "company_total_collaborators" },
  { key: "hr_existing_areas", section: SEC_7, subsection: "7.1 Estructura Organizacional", text: "Áreas existentes", type: "textarea" },
  { key: "hr_key_positions", section: SEC_7, subsection: "7.1 Estructura Organizacional", text: "Puestos clave", type: "textarea" },
  { key: "hr_job_descriptions", section: SEC_7, subsection: "7.1 Estructura Organizacional", text: "¿Existen descripciones de puesto?", type: "select", options: SI_NO },
  { key: "hr_position_kpis", section: SEC_7, subsection: "7.1 Estructura Organizacional", text: "¿Existen KPIs por puesto?", type: "select", options: SI_NO },

  // 7.2 Reclutamiento y Retención
  { key: "hr_recruitment_process", section: SEC_7, subsection: "7.2 Reclutamiento y Retención", text: "¿Cómo reclutan personal actualmente?", type: "textarea" },
  { key: "hr_hiring_difficulty", section: SEC_7, subsection: "7.2 Reclutamiento y Retención", text: "¿Cuál es la principal dificultad para contratar?", type: "textarea" },
  { key: "hr_turnover_high", section: SEC_7, subsection: "7.2 Reclutamiento y Retención", text: "¿Existe rotación alta?", type: "select", options: SI_NO_NS },
  { key: "hr_hard_positions", section: SEC_7, subsection: "7.2 Reclutamiento y Retención", text: "¿Qué puestos son más difíciles de cubrir?", type: "textarea" },
  { key: "hr_onboarding", section: SEC_7, subsection: "7.2 Reclutamiento y Retención", text: "¿Tienen procesos de onboarding?", type: "select", options: SI_NO },
  { key: "hr_performance_reviews", section: SEC_7, subsection: "7.2 Reclutamiento y Retención", text: "¿Tienen evaluaciones de desempeño?", type: "select", options: SI_NO },

  // 7.3 Cultura y Riesgos Laborales
  { key: "hr_culture", section: SEC_7, subsection: "7.3 Cultura y Riesgos Laborales", text: "¿Cómo describiría la cultura de la empresa?", type: "textarea" },
  { key: "hr_internal_conflicts", section: SEC_7, subsection: "7.3 Cultura y Riesgos Laborales", text: "¿Existen conflictos internos frecuentes?", type: "select", options: SI_NO_NS },
  { key: "hr_internal_regulation", section: SEC_7, subsection: "7.3 Cultura y Riesgos Laborales", text: "¿Tienen reglamento interno?", type: "select", options: SI_NO },
  { key: "hr_nom035", section: SEC_7, subsection: "7.3 Cultura y Riesgos Laborales", text: "¿Cumplen con NOM-035?", type: "select", options: SI_NO_NS },
  { key: "hr_training", section: SEC_7, subsection: "7.3 Cultura y Riesgos Laborales", text: "¿Existen capacitaciones periódicas?", type: "select", options: SI_NO },
  { key: "hr_biggest_problem", section: SEC_7, subsection: "7.3 Cultura y Riesgos Laborales", text: "¿Cuál considera que es el mayor problema de RH actualmente?", type: "textarea" },

  // ─── SECCIÓN 8 ─────────────────────────────────────────
  { key: "tech_current_systems", section: SEC_8, subsection: "8.1 Sistemas y Tecnología", text: "¿Qué sistemas utilizan actualmente?", type: "textarea" },
  { key: "tech_erp", section: SEC_8, subsection: "8.1 Sistemas y Tecnología", text: "¿Utilizan ERP? ¿Cuál?", type: "text" },
  { key: "tech_crm", section: SEC_8, subsection: "8.1 Sistemas y Tecnología", text: "¿Utilizan CRM? ¿Cuál?", type: "text" },
  { key: "tech_admin_tools", section: SEC_8, subsection: "8.1 Sistemas y Tecnología", text: "¿Qué herramientas usan para administración interna?", type: "textarea" },
  { key: "tech_storage_location", section: SEC_8, subsection: "8.1 Sistemas y Tecnología", text: "¿Dónde almacenan información importante?", type: "textarea" },
  { key: "tech_auto_backups", section: SEC_8, subsection: "8.1 Sistemas y Tecnología", text: "¿Tienen respaldos automáticos?", type: "select", options: SI_NO_NS },
  { key: "tech_cybersec_policies", section: SEC_8, subsection: "8.1 Sistemas y Tecnología", text: "¿Tienen políticas de ciberseguridad?", type: "select", options: SI_NO },
  { key: "tech_automation_wishlist", section: SEC_8, subsection: "8.1 Sistemas y Tecnología", text: "¿Qué procesos les gustaría automatizar?", type: "textarea" },

  // ─── SECCIÓN 9 ─────────────────────────────────────────
  { key: "prio_first_to_solve", section: SEC_9, subsection: "9.1 Prioridades Estratégicas", text: "¿Qué desean resolver primero?", type: "textarea" },
  { key: "prio_main_pain", section: SEC_9, subsection: "9.1 Prioridades Estratégicas", text: "¿Cuál es actualmente el \"dolor\" principal del negocio?", type: "textarea" },
  { key: "prio_urgent_area", section: SEC_9, subsection: "9.1 Prioridades Estratégicas", text: "¿Qué área consideran más urgente?", type: "textarea" },
  { key: "prio_12_month_goal", section: SEC_9, subsection: "9.1 Prioridades Estratégicas", text: "¿Qué meta desean alcanzar en los próximos 12 meses?", type: "textarea" },
  { key: "prio_success_definition", section: SEC_9, subsection: "9.1 Prioridades Estratégicas", text: "¿Qué resultado haría que este proyecto fuera un éxito para ustedes?", type: "textarea" },

  // ─── SECCIÓN 10 — Documentación Disponible ─────────────
  // Legales
  { key: "doc_acta_constitutiva", section: SEC_10, subsection: "10.1 Legales", text: "Acta constitutiva", type: "select", options: SI_NO },
  { key: "doc_actas_asamblea", section: SEC_10, subsection: "10.1 Legales", text: "Actas de asamblea", type: "select", options: SI_NO },
  { key: "doc_poderes", section: SEC_10, subsection: "10.1 Legales", text: "Poderes", type: "select", options: SI_NO },
  { key: "doc_contratos_laborales", section: SEC_10, subsection: "10.1 Legales", text: "Contratos laborales", type: "select", options: SI_NO },
  { key: "doc_contratos_comerciales", section: SEC_10, subsection: "10.1 Legales", text: "Contratos comerciales", type: "select", options: SI_NO },
  { key: "doc_titulos_marca", section: SEC_10, subsection: "10.1 Legales", text: "Títulos de marca", type: "select", options: SI_NO },
  // Financieros
  { key: "doc_estados_financieros", section: SEC_10, subsection: "10.2 Financieros", text: "Estados financieros", type: "select", options: SI_NO },
  { key: "doc_balanza_contable", section: SEC_10, subsection: "10.2 Financieros", text: "Balanza contable", type: "select", options: SI_NO },
  { key: "doc_flujo_efectivo", section: SEC_10, subsection: "10.2 Financieros", text: "Flujo de efectivo", type: "select", options: SI_NO },
  { key: "doc_presupuestos", section: SEC_10, subsection: "10.2 Financieros", text: "Presupuestos", type: "select", options: SI_NO },
  { key: "doc_relacion_deudas", section: SEC_10, subsection: "10.2 Financieros", text: "Relación de deudas", type: "select", options: SI_NO },
  // Contables/Fiscales
  { key: "doc_opinion_sat", section: SEC_10, subsection: "10.3 Contables/Fiscales", text: "Opinión SAT", type: "select", options: SI_NO },
  { key: "doc_csf", section: SEC_10, subsection: "10.3 Contables/Fiscales", text: "CSF", type: "select", options: SI_NO },
  { key: "doc_declaraciones", section: SEC_10, subsection: "10.3 Contables/Fiscales", text: "Declaraciones", type: "select", options: SI_NO },
  { key: "doc_xml", section: SEC_10, subsection: "10.3 Contables/Fiscales", text: "XML", type: "select", options: SI_NO },
  { key: "doc_conciliaciones_bancarias", section: SEC_10, subsection: "10.3 Contables/Fiscales", text: "Conciliaciones bancarias", type: "select", options: SI_NO },
  // Recursos Humanos
  { key: "doc_organigrama", section: SEC_10, subsection: "10.4 Recursos Humanos", text: "Organigrama", type: "select", options: SI_NO },
  { key: "doc_descripciones_puesto", section: SEC_10, subsection: "10.4 Recursos Humanos", text: "Descripciones de puesto", type: "select", options: SI_NO },
  { key: "doc_expedientes_laborales", section: SEC_10, subsection: "10.4 Recursos Humanos", text: "Expedientes laborales", type: "select", options: SI_NO },
  { key: "doc_reglamento_interno", section: SEC_10, subsection: "10.4 Recursos Humanos", text: "Reglamento interno", type: "select", options: SI_NO },
  { key: "doc_politicas_internas", section: SEC_10, subsection: "10.4 Recursos Humanos", text: "Políticas internas", type: "select", options: SI_NO },
  // Marketing
  { key: "doc_manual_marca", section: SEC_10, subsection: "10.5 Marketing", text: "Manual de marca", type: "select", options: SI_NO },
  { key: "doc_logotipos", section: SEC_10, subsection: "10.5 Marketing", text: "Logotipos editables", type: "select", options: SI_NO },
  { key: "doc_acceso_redes", section: SEC_10, subsection: "10.5 Marketing", text: "Acceso redes sociales", type: "select", options: SI_NO },
  { key: "doc_acceso_web", section: SEC_10, subsection: "10.5 Marketing", text: "Acceso página web", type: "select", options: SI_NO },
  { key: "doc_base_clientes", section: SEC_10, subsection: "10.5 Marketing", text: "Base de clientes", type: "select", options: SI_NO },

  // ─── SECCIÓN 11 ─────────────────────────────────────────
  { key: "obs_important_info", section: SEC_11, subsection: "11.1 Observaciones", text: "¿Hay algo importante que considere que debamos conocer sobre la empresa?", type: "textarea" },
  { key: "obs_sensitive_issue", section: SEC_11, subsection: "11.1 Observaciones", text: "¿Existe alguna problemática delicada o prioritaria que no se haya mencionado?", type: "textarea" },
  { key: "obs_additional", section: SEC_11, subsection: "11.1 Observaciones", text: "Comentarios adicionales", type: "textarea" },
];
