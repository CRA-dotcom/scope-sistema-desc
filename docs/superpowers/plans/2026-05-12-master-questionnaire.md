# Master Questionnaire Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder 3-question questionnaire with the full Master Questionnaire (~150 questions, 11 sections) using the existing schema's type system, wire selected questions to template variables at generate-time, and update the responder UI with section grouping, type-aware controls, navigation, and autosave.

**Architecture:** A typed seed array (`MASTER_QUESTIONS`) drives questionnaire generation. The `generate` mutation filters by `serviceScope`, loads active templates for the projection's services, and resolves `variableKey` → `templateVariableMappings` per question. The schema gets four optional fields (`section`, `subsection`, `variableKey`, `options`); existing rows continue to work. The responder UI groups by section, renders per `type`, provides sidebar/jump nav, and autosaves via a new debounced hook.

**Tech Stack:** Convex (schema + functions), Next.js 15 App Router, React 19, Tailwind, Vitest + `convex-test`.

**Spec:** `docs/superpowers/specs/2026-05-12-master-questionnaire-design.md`

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `convex/schema.ts` | Modify | Add 4 optional fields to `questionnaireResponses.responses` |
| `convex/functions/questionnaires/masterQuestionnaire.ts` | Create | Typed seed array with all questions |
| `convex/functions/questionnaires/mutations.ts` | Modify | Replace `DEFAULT_QUESTIONS` + new `generate` logic; widen `updateResponses` validator |
| `convex/functions/questionnaires/publicMutations.ts` | Modify | Widen `updateResponsesByToken` validator |
| `convex/functions/questionnaires/__tests__/masterQuestionnaire.test.ts` | Create | Content integrity unit tests |
| `convex/functions/questionnaires/__tests__/generate.test.ts` | Create | `generate` mutation tests |
| `src/hooks/useDebouncedAutosave.ts` | Create | Generic debounced autosave hook |
| `src/hooks/__tests__/useDebouncedAutosave.test.ts` | Create | Hook unit test |
| `src/components/questionnaires/QuestionField.tsx` | Create | Render-by-type input control |
| `src/components/questionnaires/SectionNav.tsx` | Create | Sidebar nav + mobile dropdown |
| `src/components/questionnaires/__tests__/QuestionField.test.tsx` | Create | Field-type render tests |
| `src/components/questionnaires/__tests__/SectionNav.test.tsx` | Create | Nav rendering test |
| `src/app/q/[token]/page.tsx` | Modify | Public responder: section grouping + new components + autosave |
| `src/app/(dashboard)/cuestionarios/[id]/responder/page.tsx` | Modify | Internal responder: mirror changes |

---

## Task 1: Schema — add 4 optional fields to questionnaire responses

**Files:**
- Modify: `convex/schema.ts:150-207`

- [ ] **Step 1: Add the four new optional fields**

In `convex/schema.ts`, inside the `questionnaireResponses` table's `responses: v.array(v.object({ ... }))` definition, add four new optional fields. The full block becomes:

```ts
responses: v.array(
  v.object({
    questionId: v.string(),
    questionText: v.string(),
    answer: v.string(),
    serviceNames: v.array(v.string()),
    type: v.optional(
      v.union(
        v.literal("text"),
        v.literal("textarea"),
        v.literal("select"),
        v.literal("number"),
        v.literal("date"),
        v.literal("file_upload")
      )
    ),
    fileConfig: v.optional(
      v.object({
        acceptedMimeTypes: v.array(v.string()),
        maxSizeMB: v.number(),
        multiple: v.boolean(),
      })
    ),
    templateVariableMappings: v.optional(
      v.array(
        v.object({
          templateId: v.id("deliverableTemplates"),
          variableName: v.string(),
        })
      )
    ),
    filename: v.optional(v.string()),
    // NEW (master questionnaire v1):
    section: v.optional(v.string()),
    subsection: v.optional(v.string()),
    variableKey: v.optional(v.string()),
    options: v.optional(v.array(v.string())),
  })
),
```

- [ ] **Step 2: Push schema to dev Convex and verify no errors**

Run: `npx convex dev --once`
Expected: schema is accepted; no validation errors logged.

- [ ] **Step 3: Commit**

```bash
git add convex/schema.ts
git commit -m "feat(schema): add section/subsection/variableKey/options to questionnaire responses"
```

---

## Task 2: Create `masterQuestionnaire.ts` seed

**Files:**
- Create: `convex/functions/questionnaires/masterQuestionnaire.ts`

- [ ] **Step 1: Create the seed file with type + constant**

Write the full file. The `MASTER_QUESTIONS` array contains every question from the spec Appendix. Section 3.2 channels and Section 10 documents are expanded into individual `select` entries.

```ts
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
  { key: "fin_variable_expenses", section: SEC_4, subsection: "4.1 Información Financiera General", text: "Gastos variables principales", type: "textarea" },
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
```

- [ ] **Step 2: Commit**

```bash
git add convex/functions/questionnaires/masterQuestionnaire.ts
git commit -m "feat(questionnaire): add MASTER_QUESTIONS seed (150 questions across 11 sections)"
```

---

## Task 3: Content integrity tests for `MASTER_QUESTIONS`

**Files:**
- Create: `convex/functions/questionnaires/__tests__/masterQuestionnaire.test.ts`

- [ ] **Step 1: Write the integrity tests**

```ts
// convex/functions/questionnaires/__tests__/masterQuestionnaire.test.ts
import { describe, it, expect } from "vitest";
import { MASTER_QUESTIONS } from "../masterQuestionnaire";

describe("MASTER_QUESTIONS integrity", () => {
  it("has unique question keys", () => {
    const keys = MASTER_QUESTIONS.map((q) => q.key);
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(keys.length);
  });

  it("every select question has at least 2 options", () => {
    const selects = MASTER_QUESTIONS.filter((q) => q.type === "select");
    expect(selects.length).toBeGreaterThan(0);
    for (const q of selects) {
      expect(q.options, `question ${q.key} missing options`).toBeDefined();
      expect(q.options!.length, `question ${q.key} has <2 options`).toBeGreaterThanOrEqual(2);
    }
  });

  it("every file_upload question has fileConfig", () => {
    const uploads = MASTER_QUESTIONS.filter((q) => q.type === "file_upload");
    for (const q of uploads) {
      expect(q.fileConfig, `question ${q.key} missing fileConfig`).toBeDefined();
    }
  });

  it("each section follows the 'N. Title' format", () => {
    const sectionRegex = /^\d+\.\s.+/;
    for (const q of MASTER_QUESTIONS) {
      expect(sectionRegex.test(q.section), `bad section format on ${q.key}: ${q.section}`).toBe(true);
    }
  });

  it("each subsection follows the 'N.M Title' format", () => {
    const subsectionRegex = /^\d+\.\d+\s.+/;
    for (const q of MASTER_QUESTIONS) {
      expect(subsectionRegex.test(q.subsection), `bad subsection format on ${q.key}: ${q.subsection}`).toBe(true);
    }
  });

  it("non-select / non-file_upload questions do not have options/fileConfig", () => {
    for (const q of MASTER_QUESTIONS) {
      if (q.type !== "select") {
        expect(q.options, `question ${q.key} unexpectedly has options`).toBeUndefined();
      }
      if (q.type !== "file_upload") {
        expect(q.fileConfig, `question ${q.key} unexpectedly has fileConfig`).toBeUndefined();
      }
    }
  });

  it("at least one variableKey matches a key in deliverableTemplates COMMON_VARS", () => {
    // These are the keys present in convex/functions/deliverableTemplates/seedDefaults.ts COMMON_VARS.
    const knownTemplateKeys = new Set([
      "company_name",
      "company_rfc",
      "company_industry",
      "company_annual_revenue",
      "company_billing_frequency",
      "projection_year",
      "projection_annual_sales",
      "projection_total_budget",
      "service_name",
      "service_chosen_pct",
      "service_annual_amount",
      "branding_company_name",
      "branding_footer_text",
      "current_date",
    ]);
    const matching = MASTER_QUESTIONS.filter(
      (q) => q.variableKey && knownTemplateKeys.has(q.variableKey)
    );
    expect(matching.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run convex/functions/questionnaires/__tests__/masterQuestionnaire.test.ts`
Expected: 7 passing tests.

- [ ] **Step 3: Commit**

```bash
git add convex/functions/questionnaires/__tests__/masterQuestionnaire.test.ts
git commit -m "test(questionnaire): content integrity for MASTER_QUESTIONS"
```

---

## Task 4: Update `generate` mutation and widen `updateResponses` validators

**Files:**
- Modify: `convex/functions/questionnaires/mutations.ts`
- Modify: `convex/functions/questionnaires/publicMutations.ts`

- [ ] **Step 1: Replace `generate` handler in `mutations.ts`**

Replace lines 1–99 of `convex/functions/questionnaires/mutations.ts` so the imports and `generate` mutation use the new seed and template-resolution logic. The legacy `DEFAULT_QUESTIONS` constant is deleted.

```ts
// convex/functions/questionnaires/mutations.ts (top portion)
import { mutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";
import { getOrgId } from "../../lib/authHelpers";
import { MASTER_QUESTIONS } from "./masterQuestionnaire";

export const generate = mutation({
  args: {
    projectionId: v.id("projections"),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgId(ctx);

    const projection = await ctx.db.get(args.projectionId);
    if (!projection || projection.orgId !== orgId) {
      throw new Error("Proyección no encontrada.");
    }

    const existing = await ctx.db
      .query("questionnaireResponses")
      .withIndex("by_projectionId", (q) =>
        q.eq("projectionId", args.projectionId)
      )
      .first();
    if (existing) {
      throw new Error("Ya existe un cuestionario para esta proyección.");
    }

    const projServices = await ctx.db
      .query("projectionServices")
      .withIndex("by_projectionId_active", (q) =>
        q.eq("projectionId", args.projectionId).eq("isActive", true)
      )
      .collect();

    if (projServices.length === 0) {
      throw new Error("No hay servicios activos en esta proyección.");
    }

    const activeServiceNames = projServices.map((ps) => ps.serviceName);

    // 1) Filter by serviceScope
    const applicableQs = MASTER_QUESTIONS.filter((q) =>
      !q.serviceScope ||
      q.serviceScope.some((s) => activeServiceNames.includes(s))
    );

    // 2) Load active templates for this org+services to resolve variable keys
    const orgTemplates = await ctx.db
      .query("deliverableTemplates")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const templatesForActiveServices = orgTemplates.filter(
      (t) => t.isActive && activeServiceNames.includes(t.serviceName)
    );

    // 3) Build responses with resolved templateVariableMappings
    const responses = applicableQs.map((q) => {
      const mappings = q.variableKey
        ? templatesForActiveServices
            .filter((t) => t.variables.some((v) => v.key === q.variableKey))
            .map((t) => ({ templateId: t._id, variableName: q.variableKey! }))
        : undefined;

      return {
        questionId: q.key,
        questionText: q.text,
        answer: "",
        serviceNames: activeServiceNames,
        section: q.section,
        subsection: q.subsection,
        type: q.type,
        options: q.options,
        fileConfig: q.fileConfig,
        variableKey: q.variableKey,
        templateVariableMappings: mappings,
      };
    });

    const accessToken =
      Math.random().toString(36).slice(2) +
      Date.now().toString(36) +
      Math.random().toString(36).slice(2);

    const id = await ctx.db.insert("questionnaireResponses", {
      orgId,
      clientId: projection.clientId,
      projectionId: args.projectionId,
      responses,
      status: "draft",
      accessToken,
      createdAt: Date.now(),
    });

    return id;
  },
});
```

- [ ] **Step 2: Widen the `updateResponses` validator in the same file**

Replace the `updateResponses` validator block (around lines 101–132) so it accepts the four new optional fields. The handler body stays the same.

```ts
export const updateResponses = mutation({
  args: {
    id: v.id("questionnaireResponses"),
    responses: v.array(
      v.object({
        questionId: v.string(),
        questionText: v.string(),
        answer: v.string(),
        serviceNames: v.array(v.string()),
        // pass-through fields populated at generate-time:
        type: v.optional(
          v.union(
            v.literal("text"),
            v.literal("textarea"),
            v.literal("select"),
            v.literal("number"),
            v.literal("date"),
            v.literal("file_upload")
          )
        ),
        fileConfig: v.optional(
          v.object({
            acceptedMimeTypes: v.array(v.string()),
            maxSizeMB: v.number(),
            multiple: v.boolean(),
          })
        ),
        templateVariableMappings: v.optional(
          v.array(
            v.object({
              templateId: v.id("deliverableTemplates"),
              variableName: v.string(),
            })
          )
        ),
        filename: v.optional(v.string()),
        section: v.optional(v.string()),
        subsection: v.optional(v.string()),
        variableKey: v.optional(v.string()),
        options: v.optional(v.array(v.string())),
      })
    ),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgId(ctx);
    const questionnaire = await ctx.db.get(args.id);
    if (!questionnaire || questionnaire.orgId !== orgId) {
      throw new Error("Cuestionario no encontrado.");
    }
    if (questionnaire.status === "completed") {
      throw new Error("No se puede editar un cuestionario completado.");
    }

    const newStatus =
      questionnaire.status === "sent" ? "in_progress" : questionnaire.status;

    await ctx.db.patch(args.id, {
      responses: args.responses,
      status: newStatus as "draft" | "sent" | "in_progress" | "completed",
    });
  },
});
```

- [ ] **Step 3: Widen the `updateResponsesByToken` validator in `publicMutations.ts`**

Replace `convex/functions/questionnaires/publicMutations.ts` lines 5–35 (the `updateResponsesByToken` mutation) so the validator matches. The handler stays the same.

```ts
export const updateResponsesByToken = mutation({
  args: {
    token: v.string(),
    responses: v.array(
      v.object({
        questionId: v.string(),
        questionText: v.string(),
        answer: v.string(),
        serviceNames: v.array(v.string()),
        type: v.optional(
          v.union(
            v.literal("text"),
            v.literal("textarea"),
            v.literal("select"),
            v.literal("number"),
            v.literal("date"),
            v.literal("file_upload")
          )
        ),
        fileConfig: v.optional(
          v.object({
            acceptedMimeTypes: v.array(v.string()),
            maxSizeMB: v.number(),
            multiple: v.boolean(),
          })
        ),
        templateVariableMappings: v.optional(
          v.array(
            v.object({
              templateId: v.id("deliverableTemplates"),
              variableName: v.string(),
            })
          )
        ),
        filename: v.optional(v.string()),
        section: v.optional(v.string()),
        subsection: v.optional(v.string()),
        variableKey: v.optional(v.string()),
        options: v.optional(v.array(v.string())),
      })
    ),
  },
  handler: async (ctx, args) => {
    const questionnaire = await ctx.db
      .query("questionnaireResponses")
      .withIndex("by_accessToken", (q) => q.eq("accessToken", args.token))
      .first();
    if (!questionnaire) throw new Error("Cuestionario no encontrado.");
    if (questionnaire.status === "completed")
      throw new Error("Este cuestionario ya fue completado.");

    await ctx.db.patch(questionnaire._id, {
      responses: args.responses,
      status:
        questionnaire.status === "draft" || questionnaire.status === "sent"
          ? "in_progress"
          : questionnaire.status,
    });
    return { success: true };
  },
});
```

- [ ] **Step 4: Verify Convex still compiles**

Run: `npx convex dev --once`
Expected: no validation errors; the codegen for `_generated/api` and `_generated/server` succeeds.

- [ ] **Step 5: Commit**

```bash
git add convex/functions/questionnaires/mutations.ts convex/functions/questionnaires/publicMutations.ts
git commit -m "feat(questionnaire): generate uses MASTER_QUESTIONS + widen response validators"
```

---

## Task 5: Tests for `generate` mutation

**Files:**
- Create: `convex/functions/questionnaires/__tests__/generate.test.ts`

- [ ] **Step 1: Write the `convex-test` based tests**

```ts
// convex/functions/questionnaires/__tests__/generate.test.ts
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api } from "../../../_generated/api";
import { MASTER_QUESTIONS } from "../masterQuestionnaire";

// Helper: create a fake authenticated identity for an org.
function asUserOfOrg(orgId: string) {
  return {
    subject: `user|${orgId}`,
    issuer: "test",
    tokenIdentifier: `test|user|${orgId}`,
    orgId,
  };
}

async function seedProjection(t: ReturnType<typeof convexTest>, orgId: string) {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId,
      name: "Test Client",
      assignedTo: undefined,
    } as any);
    const projectionId = await ctx.db.insert("projections", {
      orgId,
      clientId,
      year: 2026,
    } as any);
    await ctx.db.insert("projectionServices", {
      orgId,
      projectionId,
      serviceName: "Contable",
      isActive: true,
    } as any);
    await ctx.db.insert("projectionServices", {
      orgId,
      projectionId,
      serviceName: "Marketing",
      isActive: true,
    } as any);
    return { projectionId, clientId };
  });
}

async function seedTemplate(
  t: ReturnType<typeof convexTest>,
  orgId: string,
  serviceName: string,
  variableKeys: string[]
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("deliverableTemplates", {
      orgId,
      serviceName,
      type: "deliverable_long",
      name: `${serviceName} Template`,
      htmlTemplate: "<html></html>",
      variables: variableKeys.map((key) => ({
        key,
        label: key,
        source: "client" as const,
        required: false,
      })),
      version: 1,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any)
  );
}

describe("questionnaires.generate (master questionnaire)", () => {
  it("creates one questionnaire with all applicable master questions", async () => {
    const t = convexTest(schema);
    const orgA = "org_A";
    const { projectionId } = await seedProjection(t, orgA);

    const id = await t
      .withIdentity(asUserOfOrg(orgA))
      .mutation(api.functions.questionnaires.mutations.generate, {
        projectionId,
      });

    const doc = await t.run((ctx) => ctx.db.get(id));
    expect(doc).not.toBeNull();
    // No question in the master is service-scoped today → all apply.
    expect(doc!.responses.length).toBe(MASTER_QUESTIONS.length);
  });

  it("populates section and subsection on each response", async () => {
    const t = convexTest(schema);
    const orgA = "org_A";
    const { projectionId } = await seedProjection(t, orgA);

    const id = await t
      .withIdentity(asUserOfOrg(orgA))
      .mutation(api.functions.questionnaires.mutations.generate, {
        projectionId,
      });
    const doc = await t.run((ctx) => ctx.db.get(id));
    for (const r of doc!.responses) {
      expect(r.section, `missing section on ${r.questionId}`).toBeDefined();
      expect(r.subsection, `missing subsection on ${r.questionId}`).toBeDefined();
    }
  });

  it("resolves templateVariableMappings for variableKey hits", async () => {
    const t = convexTest(schema);
    const orgA = "org_A";
    const { projectionId } = await seedProjection(t, orgA);

    // Marketing template knows company_rfc; Contable template knows company_industry.
    const mktTemplate = await seedTemplate(t, orgA, "Marketing", ["company_rfc"]);
    const ctTemplate = await seedTemplate(t, orgA, "Contable", ["company_industry"]);

    const id = await t
      .withIdentity(asUserOfOrg(orgA))
      .mutation(api.functions.questionnaires.mutations.generate, {
        projectionId,
      });
    const doc = await t.run((ctx) => ctx.db.get(id));

    const rfcQuestion = doc!.responses.find((r) => r.questionId === "company_rfc");
    const industryQuestion = doc!.responses.find((r) => r.questionId === "company_industry");

    expect(rfcQuestion!.templateVariableMappings).toEqual([
      { templateId: mktTemplate, variableName: "company_rfc" },
    ]);
    expect(industryQuestion!.templateVariableMappings).toEqual([
      { templateId: ctTemplate, variableName: "company_industry" },
    ]);
  });

  it("leaves templateVariableMappings undefined for questions without variableKey", async () => {
    const t = convexTest(schema);
    const orgA = "org_A";
    const { projectionId } = await seedProjection(t, orgA);

    const id = await t
      .withIdentity(asUserOfOrg(orgA))
      .mutation(api.functions.questionnaires.mutations.generate, {
        projectionId,
      });
    const doc = await t.run((ctx) => ctx.db.get(id));

    // history_origin has no variableKey
    const r = doc!.responses.find((r) => r.questionId === "history_origin");
    expect(r!.templateVariableMappings).toBeUndefined();
  });

  it("does not include templates from other orgs", async () => {
    const t = convexTest(schema);
    const orgA = "org_A";
    const orgB = "org_B";
    const { projectionId } = await seedProjection(t, orgA);
    // orgB has a template that would match company_rfc — must NOT leak into orgA's questionnaire.
    await seedTemplate(t, orgB, "Marketing", ["company_rfc"]);

    const id = await t
      .withIdentity(asUserOfOrg(orgA))
      .mutation(api.functions.questionnaires.mutations.generate, {
        projectionId,
      });
    const doc = await t.run((ctx) => ctx.db.get(id));
    const rfcQuestion = doc!.responses.find((r) => r.questionId === "company_rfc");
    expect(rfcQuestion!.templateVariableMappings).toBeUndefined();
  });

  it("rejects when no active services exist", async () => {
    const t = convexTest(schema);
    const orgA = "org_A";
    const { projectionId } = await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: orgA,
        name: "Test",
      } as any);
      const projectionId = await ctx.db.insert("projections", {
        orgId: orgA,
        clientId,
        year: 2026,
      } as any);
      return { projectionId };
    });

    await expect(
      t
        .withIdentity(asUserOfOrg(orgA))
        .mutation(api.functions.questionnaires.mutations.generate, {
          projectionId,
        })
    ).rejects.toThrow(/servicios activos/);
  });

  it("rejects when projection belongs to a different org", async () => {
    const t = convexTest(schema);
    const orgA = "org_A";
    const orgB = "org_B";
    const { projectionId } = await seedProjection(t, orgA);

    await expect(
      t
        .withIdentity(asUserOfOrg(orgB))
        .mutation(api.functions.questionnaires.mutations.generate, {
          projectionId,
        })
    ).rejects.toThrow(/Proyección no encontrada/);
  });
});
```

> Note: this test file uses `as any` for inserts of incidental fields (status, invoiceStatus, etc., that the real `projections` / `clients` tables require). Adjust to match the actual required fields if the test runner rejects them. The shape needed is: `clients(orgId, name)`, `projections(orgId, clientId, year)`, `projectionServices(orgId, projectionId, serviceName, isActive)`. Inspect `convex/schema.ts` for each table and supply remaining required defaults.

- [ ] **Step 2: Run the tests and resolve any required-field mismatches**

Run: `npx vitest run convex/functions/questionnaires/__tests__/generate.test.ts`

If a test fails with a Convex validator error like `"X is missing required field Y"`, read `convex/schema.ts` for that table, add the field to the seed helper, and re-run.

Expected (after iteration): 7 passing tests.

- [ ] **Step 3: Commit**

```bash
git add convex/functions/questionnaires/__tests__/generate.test.ts
git commit -m "test(questionnaire): generate mutation with master seed + multi-tenant isolation"
```

---

## Task 6: Create `useDebouncedAutosave` hook

**Files:**
- Create: `src/hooks/useDebouncedAutosave.ts`
- Create: `src/hooks/__tests__/useDebouncedAutosave.test.ts`

- [ ] **Step 1: Write the failing test first**

```tsx
// src/hooks/__tests__/useDebouncedAutosave.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebouncedAutosave } from "../useDebouncedAutosave";

describe("useDebouncedAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls save once after the debounce window elapses", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedAutosave(value, save, 2000),
      { initialProps: { value: "a" } }
    );

    rerender({ value: "ab" });
    rerender({ value: "abc" });

    expect(save).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("abc");
    expect(result.current.status).toBe("saved");
  });

  it("does not call save when value is unchanged from the initial value", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useDebouncedAutosave("a", save, 2000));
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("debounces multiple rapid changes into a single save", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ value }) => useDebouncedAutosave(value, save, 2000),
      { initialProps: { value: 0 } }
    );

    for (let i = 1; i <= 5; i++) {
      rerender({ value: i });
      await act(async () => {
        vi.advanceTimersByTime(500); // shorter than debounce
      });
    }
    expect(save).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/hooks/__tests__/useDebouncedAutosave.test.ts`
Expected: FAIL (`Cannot find module '../useDebouncedAutosave'`).

- [ ] **Step 3: Implement the hook**

```ts
// src/hooks/useDebouncedAutosave.ts
import { useEffect, useRef, useState } from "react";

export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

export function useDebouncedAutosave<T>(
  value: T,
  save: (v: T) => Promise<void>,
  debounceMs = 2000
) {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const initialRef = useRef(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestValueRef = useRef(value);

  useEffect(() => {
    latestValueRef.current = value;
    if (Object.is(value, initialRef.current) && status === "idle") {
      return; // no-op on first render
    }
    setStatus("pending");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setStatus("saving");
      try {
        await save(latestValueRef.current);
        setStatus("saved");
      } catch (e) {
        setStatus("error");
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // We intentionally exclude `save` from deps to avoid re-arming the timer when the parent
    // passes a fresh closure on every render. Callers should memoize `save` if needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, debounceMs]);

  return { status };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/hooks/__tests__/useDebouncedAutosave.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useDebouncedAutosave.ts src/hooks/__tests__/useDebouncedAutosave.test.ts
git commit -m "feat(hooks): add useDebouncedAutosave with tests"
```

---

## Task 7: Create `QuestionField` component (render by type)

**Files:**
- Create: `src/components/questionnaires/QuestionField.tsx`
- Create: `src/components/questionnaires/__tests__/QuestionField.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/questionnaires/__tests__/QuestionField.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QuestionField } from "../QuestionField";

const baseProps = {
  questionId: "q1",
  value: "",
  onChange: () => {},
  disabled: false,
};

describe("QuestionField", () => {
  it("renders <textarea> for type=textarea", () => {
    render(<QuestionField {...baseProps} type="textarea" />);
    expect(screen.getByRole("textbox").tagName).toBe("TEXTAREA");
  });

  it("renders <input type=number> for type=number", () => {
    render(<QuestionField {...baseProps} type="number" />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.type).toBe("number");
  });

  it("renders <input type=date> for type=date", () => {
    const { container } = render(<QuestionField {...baseProps} type="date" />);
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.type).toBe("date");
  });

  it("renders <select> with the supplied options for type=select", () => {
    render(
      <QuestionField {...baseProps} type="select" options={["Sí", "No"]} />
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select).toBeTruthy();
    const optionTexts = Array.from(select.options).map((o) => o.textContent);
    expect(optionTexts).toEqual(expect.arrayContaining(["Sí", "No"]));
  });

  it("renders <input type=text> by default", () => {
    render(<QuestionField {...baseProps} type="text" />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.type).toBe("text");
  });

  it("falls back to <input type=text> when type is undefined", () => {
    render(<QuestionField {...baseProps} type={undefined} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.type).toBe("text");
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/components/questionnaires/__tests__/QuestionField.test.tsx`
Expected: FAIL (`Cannot find module '../QuestionField'`).

- [ ] **Step 3: Implement the component**

```tsx
// src/components/questionnaires/QuestionField.tsx
"use client";

type QuestionType =
  | "text"
  | "textarea"
  | "select"
  | "number"
  | "date"
  | "file_upload";

export interface QuestionFieldProps {
  questionId: string;
  type: QuestionType | undefined;
  value: string;
  onChange: (v: string) => void;
  options?: string[];
  disabled?: boolean;
  placeholder?: string;
}

const baseInputClass =
  "w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 disabled:bg-slate-100 disabled:text-slate-500";

export function QuestionField({
  questionId,
  type,
  value,
  onChange,
  options,
  disabled,
  placeholder,
}: QuestionFieldProps) {
  switch (type) {
    case "textarea":
      return (
        <textarea
          id={questionId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          rows={4}
          className={baseInputClass}
        />
      );
    case "number":
      return (
        <input
          id={questionId}
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          className={baseInputClass}
        />
      );
    case "date":
      return (
        <input
          id={questionId}
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={baseInputClass}
        />
      );
    case "select":
      return (
        <select
          id={questionId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={baseInputClass}
        >
          <option value="">— Seleccione —</option>
          {(options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    case "file_upload":
      // Defer to existing FileUploadField if available; for now fallback to text.
      return (
        <input
          id={questionId}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="(carga de archivos no habilitada)"
          className={baseInputClass}
        />
      );
    case "text":
    default:
      return (
        <input
          id={questionId}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          className={baseInputClass}
        />
      );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/questionnaires/__tests__/QuestionField.test.tsx`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add src/components/questionnaires/QuestionField.tsx src/components/questionnaires/__tests__/QuestionField.test.tsx
git commit -m "feat(questionnaire): QuestionField renders inputs per type"
```

---

## Task 8: Create `SectionNav` component

**Files:**
- Create: `src/components/questionnaires/SectionNav.tsx`
- Create: `src/components/questionnaires/__tests__/SectionNav.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/questionnaires/__tests__/SectionNav.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SectionNav } from "../SectionNav";

describe("SectionNav", () => {
  it("renders one link per distinct section in input order", () => {
    render(
      <SectionNav
        sections={[
          { id: "sec-1", label: "1. General", answered: 3, total: 13 },
          { id: "sec-2", label: "2. Modelo", answered: 0, total: 20 },
        ]}
      />
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toBe("#sec-1");
    expect(links[1].getAttribute("href")).toBe("#sec-2");
  });

  it("shows answered/total counter per section", () => {
    render(
      <SectionNav
        sections={[
          { id: "sec-1", label: "1. General", answered: 3, total: 13 },
        ]}
      />
    );
    expect(screen.getByText("3/13")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/components/questionnaires/__tests__/SectionNav.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/components/questionnaires/SectionNav.tsx
"use client";

export type SectionNavItem = {
  id: string;
  label: string;
  answered: number;
  total: number;
};

export function SectionNav({ sections }: { sections: SectionNavItem[] }) {
  return (
    <>
      {/* Desktop: sticky sidebar */}
      <nav
        aria-label="Secciones del cuestionario"
        className="hidden lg:block sticky top-24 self-start w-64 shrink-0"
      >
        <ul className="space-y-1 text-sm">
          {sections.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="flex justify-between rounded px-3 py-2 hover:bg-slate-100"
              >
                <span className="truncate">{s.label}</span>
                <span className="text-slate-500 ml-2 shrink-0">
                  {s.answered}/{s.total}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/* Mobile: jump <select> */}
      <div className="lg:hidden mb-4">
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Saltar a sección
        </label>
        <select
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          onChange={(e) => {
            const id = e.target.value;
            if (id) location.hash = id;
          }}
          defaultValue=""
        >
          <option value="">— Selecciona —</option>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} ({s.answered}/{s.total})
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/questionnaires/__tests__/SectionNav.test.tsx`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add src/components/questionnaires/SectionNav.tsx src/components/questionnaires/__tests__/SectionNav.test.tsx
git commit -m "feat(questionnaire): SectionNav sidebar + mobile jump menu"
```

---

## Task 9: Update public responder (`/q/[token]`) to use sections + types + nav + autosave

**Files:**
- Modify: `src/app/q/[token]/page.tsx`

This task replaces the response-rendering portion of the page. The auth/load logic stays.

- [ ] **Step 1: Read the current file end-to-end**

Run: `cat -n "src/app/q/[token]/page.tsx"`
Note the imports, state names (`localResponses`), where data is loaded, and where the submit button is.

- [ ] **Step 2: Replace the grouping + rendering block**

Find the current `serviceGroups` build (around line 192) and the `<textarea>` map. Replace from the start of that block down to the end of the rendered question list with the implementation below. Adjust import paths if your file already imports React utilities differently.

Add these imports at the top of the file (alongside the existing imports):

```tsx
import { QuestionField } from "@/components/questionnaires/QuestionField";
import { SectionNav, type SectionNavItem } from "@/components/questionnaires/SectionNav";
import { useDebouncedAutosave } from "@/hooks/useDebouncedAutosave";
```

Replace the grouping + render block with:

```tsx
// Group responses by section (preserving first-seen order)
const sectionGroups = new Map<string, typeof localResponses>();
for (const r of localResponses) {
  const key = r.section ?? "General";
  if (!sectionGroups.has(key)) sectionGroups.set(key, []);
  sectionGroups.get(key)!.push(r);
}

const sectionItems: SectionNavItem[] = Array.from(
  sectionGroups.entries()
).map(([label, rs], idx) => ({
  id: `sec-${idx + 1}`,
  label,
  answered: rs.filter((r) => r.answer && r.answer.trim().length > 0).length,
  total: rs.length,
}));

// Autosave: debounced patch back to the server when responses change.
const autosave = useDebouncedAutosave(
  localResponses,
  async (latest) => {
    await updateResponsesByToken({ token, responses: latest });
  },
  2000
);

return (
  <div className="mx-auto max-w-6xl px-4 py-8">
    <header className="mb-6">
      <h1 className="text-2xl font-semibold">Cuestionario</h1>
      <p className="text-sm text-slate-600">
        {autosave.status === "saving" && "Guardando…"}
        {autosave.status === "saved" && "Guardado"}
        {autosave.status === "pending" && "Cambios pendientes…"}
        {autosave.status === "error" && "Error al guardar — reintentar"}
        {autosave.status === "idle" && "Listo para responder"}
      </p>
    </header>
    <div className="flex gap-8">
      <SectionNav sections={sectionItems} />
      <main className="flex-1 space-y-10">
        {Array.from(sectionGroups.entries()).map(([sectionLabel, rs], idx) => {
          const sectionId = `sec-${idx + 1}`;
          // Sub-group by subsection
          const subGroups = new Map<string, typeof rs>();
          for (const r of rs) {
            const k = r.subsection ?? "";
            if (!subGroups.has(k)) subGroups.set(k, []);
            subGroups.get(k)!.push(r);
          }
          return (
            <section key={sectionLabel} id={sectionId} className="scroll-mt-24">
              <h2 className="text-xl font-semibold mb-4">{sectionLabel}</h2>
              {Array.from(subGroups.entries()).map(([subLabel, srs]) => (
                <div key={subLabel} className="mb-6">
                  {subLabel && (
                    <h3 className="text-sm font-medium text-slate-700 mb-3">
                      {subLabel}
                    </h3>
                  )}
                  <div className="space-y-4">
                    {srs.map((r) => (
                      <div key={r.questionId}>
                        <label
                          htmlFor={r.questionId}
                          className="block text-sm text-slate-800 mb-1"
                        >
                          {r.questionText}
                        </label>
                        <QuestionField
                          questionId={r.questionId}
                          type={r.type}
                          options={r.options}
                          value={r.answer}
                          onChange={(v) =>
                            setLocalResponses((prev) =>
                              prev.map((p) =>
                                p.questionId === r.questionId
                                  ? { ...p, answer: v }
                                  : p
                              )
                            )
                          }
                          disabled={questionnaire.status === "completed"}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          );
        })}

        {/* Submit button (preserve existing handler / disabled logic) */}
        <div className="pt-6 border-t">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={questionnaire.status === "completed"}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:bg-slate-400"
          >
            Enviar cuestionario
          </button>
        </div>
      </main>
    </div>
  </div>
);
```

> Notes:
> - `updateResponsesByToken`, `localResponses`, `setLocalResponses`, `questionnaire`, `token`, and `handleSubmit` should already exist in the file from prior code. Keep their definitions; only the rendering and grouping logic changes.
> - Remove any prior `<textarea>` map and the previous `serviceGroups` logic.
> - If there is an existing "Guardar" button that called `updateResponsesByToken` manually, you can keep it as a "Guardar ahora" fallback or remove it — autosave covers it.

- [ ] **Step 3: Run dev server and click through manually**

Run: `npm run dev` (in one terminal) and `npx convex dev` (in another).

In a browser, open a generated questionnaire token URL and verify:
- The page shows 11 section headers (or fewer if some are filtered).
- Each section has subsection sub-headers.
- The sidebar lists every section with counters that update as you type.
- Typing in a field shows "Cambios pendientes…" then "Guardando…" then "Guardado" within ~2s.
- Reload the page — your answers persist.

- [ ] **Step 4: Commit**

```bash
git add "src/app/q/[token]/page.tsx"
git commit -m "feat(questionnaire): public responder uses sections, types, nav and autosave"
```

---

## Task 10: Update internal responder (`/cuestionarios/[id]/responder`) — mirror

**Files:**
- Modify: `src/app/(dashboard)/cuestionarios/[id]/responder/page.tsx`

- [ ] **Step 1: Read the current file end-to-end**

Run: `cat -n "src/app/(dashboard)/cuestionarios/[id]/responder/page.tsx"`

- [ ] **Step 2: Apply the same rendering + autosave changes as Task 9**

Difference: this page uses `updateResponses` (authenticated mutation) instead of `updateResponsesByToken`. Use the dashboard's existing convex client and pass `{ id: questionnaireId, responses: latest }` in the autosave callback.

Add imports:

```tsx
import { QuestionField } from "@/components/questionnaires/QuestionField";
import { SectionNav, type SectionNavItem } from "@/components/questionnaires/SectionNav";
import { useDebouncedAutosave } from "@/hooks/useDebouncedAutosave";
```

Replace the grouping + render block with the equivalent code from Task 9, but in the autosave callback:

```tsx
const autosave = useDebouncedAutosave(
  localResponses,
  async (latest) => {
    await updateResponses({ id: questionnaireId, responses: latest });
  },
  2000
);
```

- [ ] **Step 3: Manual smoke test**

Reload the dashboard responder for a questionnaire in `draft`/`in_progress` status. Verify same behaviors as Task 9 (sections, types, nav, autosave indicator).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/cuestionarios/[id]/responder/page.tsx"
git commit -m "feat(questionnaire): internal responder mirrors sections/types/nav/autosave"
```

---

## Task 11: Run the full test suite and verify counts

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: previous 61 + 14 new = ~75 passing tests. No failures.

If a snapshot test from another component flickers due to a shared layout file, update the snapshot if (and only if) the diff is unrelated to questionnaire rendering changes.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: production build succeeds; no type errors.

- [ ] **Step 3: Commit any incidental fixes**

If tests required small fixes, commit them as a follow-up:

```bash
git commit -m "test: stabilize unrelated tests post master questionnaire"
```

---

## Self-review notes (kept for reference)

- **Spec coverage check:** Schema (Task 1), seed (Task 2), `generate` + validators (Task 4), tests Convex (Tasks 3, 5), tests UI (Tasks 6–8), responder UI (Tasks 9–10), full-suite verification (Task 11). All spec sections mapped.
- **Type consistency:** `useDebouncedAutosave` returns `{ status }` of type `AutosaveStatus`. The responder code consumes `autosave.status` accordingly. `QuestionField` accepts `type: QuestionType | undefined`. `SectionNavItem` is exported and imported with the type-only path.
- **Placeholder scan:** No "TBD"/"TODO". Test #1 in Task 5 includes a self-aware note about adjusting required fields per real schema — that's prescriptive, not a placeholder.
