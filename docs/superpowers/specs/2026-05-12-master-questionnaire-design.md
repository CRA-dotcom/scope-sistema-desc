# Master Questionnaire v1 — Design

**Date:** 2026-05-12
**Sprint:** v2 (toward 2026-05-15 demo)
**Owner:** Christian
**Status:** Approved (pending user spec review)

---

## Context

The unified questionnaire is one of the core deliverables of Sprint v2 ("cuestionario unificado integrado al flujo"). Today, `convex/functions/questionnaires/mutations.ts:7-20` defines `DEFAULT_QUESTIONS` as 3 generic questions, plus the `generate` mutation adds one detail question per active service. This is a placeholder.

The real content — a 150-question "Cuestionario Maestro de Diagnóstico Empresarial" covering 11 sections (General Info, Business Model, Marketing/Commercial, Finance, Accounting/Tax, Legal/Governance, HR, Technology, Priorities, Document Availability, Final Observations) — is now available and must replace the placeholder. The questionnaire content is in the Appendix.

The unified questionnaire feeds two downstream flows:
- **Template variable filling** via `convex/functions/questionnaires/populateVariables.ts` — answers tagged with `templateVariableMappings` get injected as variables into `deliverableTemplates`.
- **AI variable filling and document generation** in `convex/functions/deliverables/actions.ts` — Claude reads questionnaire responses as context.

## Goals

1. Replace `DEFAULT_QUESTIONS` with the full master questionnaire (~150 questions, 11 sections).
2. Support section grouping in the response storage and UI.
3. Use the schema's existing `type` / `fileConfig` capabilities for richer question types.
4. Wire selected questions to template variables via `variableKey` resolved at `generate` time.
5. Keep backwards compatibility with already-generated questionnaires (legacy 3-question docs).

## Non-Goals

- Migrating existing in-flight questionnaires to the new structure.
- Changing how `populateVariables.ts` resolves storage IDs or builds variable maps.
- Building a separate per-service questionnaire flow.
- Changing email send flow or access-token logic.
- Real file uploads for Section 10 (treated as inventory checklist — Sí/No per document, can become `file_upload` later).
- Adding a "regenerate/migrate existing questionnaire" admin tool.

---

## Design

### 1. Schema changes

File: `convex/schema.ts:150-207` (`questionnaireResponses` table).

Add four optional fields to each entry in the `responses` array:

| Field | Type | Purpose |
|---|---|---|
| `section` | `v.optional(v.string())` | Section header, e.g. `"1. Información General de la Empresa"`. UI groups by this. |
| `subsection` | `v.optional(v.string())` | Subsection header, e.g. `"1.1 Datos Generales"`. UI sub-groups within a section. |
| `variableKey` | `v.optional(v.string())` | Semantic key, e.g. `"company_rfc"`. Used at `generate` time to resolve `templateVariableMappings`. |
| `options` | `v.optional(v.array(v.string()))` | Choice list, only meaningful when `type === "select"`. |

All optional. No migration required — pre-existing rows (legacy 3-question questionnaires) continue working; the responder UI renders them under section `"General"` by default and falls back to `<textarea>` when `type` is absent.

### 2. Master questionnaire seed

File: `convex/functions/questionnaires/masterQuestionnaire.ts` (new).

Exports a typed array:

```ts
export type MasterQuestion = {
  key: string;              // stable ID — e.g. "company_legal_name"
  section: string;          // "1. Información General de la Empresa"
  subsection: string;       // "1.1 Datos Generales"
  text: string;             // question prompt
  type: "text" | "textarea" | "select" | "number" | "date" | "file_upload";
  options?: string[];       // required when type === "select"
  fileConfig?: {            // required when type === "file_upload"
    acceptedMimeTypes: string[];
    maxSizeMB: number;
    multiple: boolean;
  };
  variableKey?: string;     // semantic mapping target — see seedDefaults.ts variables
  serviceScope?: string[];  // omitted = applies to all services (default)
};

export const MASTER_QUESTIONS: MasterQuestion[] = [
  /* ~150 entries, see Appendix for full content */
];
```

**Type mapping conventions for the source content:**

| Section | Predominant types | Notes |
|---|---|---|
| 1.1 Datos Generales | `text` for names/RFC/addresses; `date` for fecha de constitución; `number` for "Número total de empleados" | RFC/email format enforced in UI only |
| 1.2, 2.1–2.3, 3.1, 3.3, 6.x, 7.x, 9.x, 11 | `textarea` (open-ended prompts) | |
| 3.2 Canales utilizados | One `select` per channel (`["Sí","No"]`) — Facebook, Instagram, TikTok, LinkedIn, Google Ads, Email marketing, WhatsApp, Referidos | Avoids needing a multi-select schema |
| 4.1 cifras financieras | `number` for "ventas mensuales", "gastos fijos", "flujo mensual"; `textarea` for "gastos variables principales" (descriptive) | |
| 4.2, 5.x boolean-ish | `select` (`["Sí","No","No sé"]`) | |
| 10 Documentación | `select` (`["Sí","No"]`) per document line | Inventory checklist — not upload |
| 11 Observaciones | `textarea` | |

**`variableKey` assignments — minimum set for v1:**

Cross-referenced with variables already in use by `convex/functions/deliverableTemplates/seedDefaults.ts`:

| Question (Section.Subsection) | `variableKey` |
|---|---|
| 1.1 Nombre legal | `company_legal_name` |
| 1.1 Nombre comercial | `company_name` |
| 1.1 RFC | `company_rfc` |
| 1.1 Fecha de constitución | `company_incorporation_date` |
| 1.1 Giro o actividad principal | `company_industry` |
| 1.1 Dirección fiscal | `company_fiscal_address` |
| 1.1 Ciudad y estado de operación | `company_location` |
| 1.1 Número total de empleados | `company_employee_count` |
| 1.1 Nombre del representante legal | `company_legal_rep` |
| 1.1 Teléfono principal | `company_phone` |
| 1.1 Correo principal | `company_email` |
| 4.1 Ventas mensuales promedio | `company_monthly_sales` |
| 4.1 Margen aproximado de utilidad | `company_profit_margin` |
| 4.1 Gastos fijos mensuales | `company_monthly_fixed_expenses` |
| 4.1 Flujo mensual aproximado | `company_monthly_cashflow` |
| 5.2 Régimen fiscal actual | `company_tax_regime` |
| 6.1 Tipo de sociedad | `company_legal_form` |
| 7.1 Número total de colaboradores | `company_total_collaborators` |

All other questions have no `variableKey` — they remain available to the AI as raw context but do not inject literally into templates.

**Note on coverage:** Only a subset of the keys in the table above currently exist in `seedDefaults.ts` template variables (notably `company_name`, `company_rfc`, `company_industry`). Keys without a matching template variable produce `templateVariableMappings: undefined` at generate-time — harmless and forward-compatible. As templates evolve to consume more keys (e.g. `company_monthly_sales`, `company_tax_regime`), no questionnaire-side change is required; future generates will resolve them automatically.

**`serviceScope` policy:** Default is omitted (= applies to all). The author may set `serviceScope: ["Marketing"]` (or another service name) for any question that is genuinely scoped to a single service. For v1, default to none — i.e., all questions apply.

### 3. `generate` mutation changes

File: `convex/functions/questionnaires/mutations.ts:22-99`.

Replace `DEFAULT_QUESTIONS` and the per-service question generation with:

```ts
import { MASTER_QUESTIONS } from "./masterQuestionnaire";

// after reading projServices:
const activeServiceNames = projServices.map((ps) => ps.serviceName);

// 1. Filter by serviceScope
const applicableQs = MASTER_QUESTIONS.filter((q) =>
  !q.serviceScope || q.serviceScope.some((s) => activeServiceNames.includes(s))
);

// 2. Load active templates for org+services
const templates = await ctx.db
  .query("deliverableTemplates")
  .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
  .filter((q) => q.eq(q.field("isActive"), true))
  .collect();

const templatesForActiveServices = templates.filter((t) =>
  activeServiceNames.includes(t.serviceName)
);

// 3. Build responses with resolved templateVariableMappings
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
    serviceNames: activeServiceNames, // legacy field, kept for compat
    section: q.section,
    subsection: q.subsection,
    type: q.type,
    options: q.options,
    fileConfig: q.fileConfig,
    variableKey: q.variableKey,
    templateVariableMappings: mappings,
  };
});
```

The rest of the mutation (org check, duplicate check, access token generation, insert) is unchanged.

**Trade-off note:** If a template is added or its `variables` list changes *after* a questionnaire is generated, that questionnaire's `templateVariableMappings` will be stale for that template. Accepted for v1. A "re-sync variables" admin action can be added later if it becomes a real problem.

### 4. UI responder changes

Files:
- `src/app/q/[token]/page.tsx` (313 lines, public responder).
- `src/app/(dashboard)/cuestionarios/[id]/responder/page.tsx` (232 lines, internal responder — mirror).

#### 4a. Section grouping replaces service grouping

Today the public responder builds `serviceGroups` (line ~192). Replace with `sectionGroups`:

```ts
const sectionGroups = new Map<string, typeof localResponses>();
for (const r of localResponses) {
  const key = r.section ?? "General";
  if (!sectionGroups.has(key)) sectionGroups.set(key, []);
  sectionGroups.get(key)!.push(r);
}
```

Within each section, sub-group by `subsection` and render a smaller header per subsection.

#### 4b. Render by `type`

Replace the unconditional `<textarea>` with a switch:

```tsx
switch (r.type) {
  case "textarea":     return <textarea ... />;
  case "number":       return <input type="number" ... />;
  case "date":         return <input type="date" ... />;
  case "select":       return <select>{r.options?.map(o => <option key={o}>{o}</option>)}</select>;
  case "file_upload":  return <FileUploadField config={r.fileConfig} ... />;
  case "text":
  default:             return <input type="text" ... />;
}
```

`FileUploadField` already exists (see `src/components/questionnaires/__tests__/file-upload-field.test.tsx`) and is reused as-is.

#### 4c. Navigation

A 150-question form requires navigation:

- **Desktop:** sticky sidebar with a link per section (`<a href="#seccion-1">`). Each link shows a counter "X/Y respondidas".
- **Mobile:** a `<select>` jump-menu at the top.
- Section containers have `id="seccion-1"`, `id="seccion-2"`, … to support anchor jumping.

#### 4d. Autosave

A 150-question form must not lose data on page close. Add debounced autosave:

- Every change triggers `updateResponses` 2 seconds after the user's last keystroke (debounce).
- A small indicator near the top displays `"Guardado hace Xs"` or `"Guardando…"`.
- On unmount or `beforeunload`, flush the pending debounced save.

Implementation introduces `src/hooks/useDebouncedAutosave.ts` (a small generic debounce-and-flush hook reusable by both responder pages).

### 5. Tests

Target: 14 new tests, raising the suite from 61 → ~75 (closes most of the gap to the 81+ goal in `_bmad-output`/MOC).

**Unit (Convex functions):**

1. `generate` produces `responses.length === MASTER_QUESTIONS.length` when every question's `serviceScope` matches the projection's active services (or is omitted).
2. Each response in the output has `section` and `subsection` populated.
3. Questions whose `variableKey` matches a key in an active template's `variables` array receive `templateVariableMappings` containing that `templateId`.
4. Questions without `variableKey` have `templateVariableMappings === undefined`.
5. `serviceScope` filtering: a question scoped to `["Marketing"]` is omitted when Marketing is not active and included when it is.
6. Multi-tenant isolation: `generate` for orgA does not include templates from orgB.

**Unit (master content integrity):**

7. All `key` values in `MASTER_QUESTIONS` are unique.
8. All `type === "select"` entries have `options.length >= 2`.
9. All `type === "file_upload"` entries have `fileConfig` defined.
10. Each `section` value matches the regex `/^\d+\.\s.+/`.

**Integration (UI responder):**

11. Responder groups responses by section: each section header is rendered as a heading; questions of section `"1. Información General"` appear under that heading and not under another.
12. Render-per-type: a question with `type: "select"` and `options: ["Sí","No"]` renders a `<select>` with those options; a question with `type: "number"` renders `<input type="number">`; default falls back to `<input type="text">`.
13. Autosave triggers `updateResponses` exactly once after the debounce window when an input changes (use a fake timer to advance past the debounce).
14. Sidebar/jump nav contains one link per distinct `section` in the response set; clicking a link sets `location.hash` to the matching `id`.

### 6. Rollout

1. Existing rows in `questionnaireResponses` are untouched. Legacy 3-question rows render under section `"General"` with `textarea` fallback.
2. New questionnaires generated after deploy automatically use `MASTER_QUESTIONS`.
3. No retroactive migration. To re-generate an existing questionnaire, the executive deletes the old row and calls `generate` again.

### 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| 150 questions overwhelms client | Sidebar nav + autosave + sub-section chunking; section headers are short and clear |
| `variableKey` typos vs `seedDefaults.ts` variable keys | Test #3 asserts that the known set in §2 of this spec actually resolves against `seedDefaults.ts` template variables |
| Templates added post-generate yield stale mappings | Accepted by design; documented; remediation = regenerate questionnaire |
| Schema field bloat (4 new fields on every response object) | All optional; the rows are small; field count is acceptable for a single denormalized list |

---

## Out of scope (revisit later)

- Real file uploads for Section 10 (currently inventory `select`s).
- Per-service questionnaire variant.
- Admin tool: "re-sync variableKey ↔ template mappings for existing questionnaires".
- Multi-select schema type (worked around with one `select` per channel in Section 3.2).
- Re-mapping legacy 3-question questionnaires to the master structure.

---

## Appendix — Master questionnaire content

The full content provided by the user, to be encoded into `MASTER_QUESTIONS`. The implementation plan should walk this top to bottom.

### Instructions to client (UI text, not a question)

> Estimado cliente:
>
> El siguiente cuestionario tiene como objetivo recopilar la información necesaria para elaborar diagnósticos, estrategias, reportes y entregables personalizados para su empresa. La información proporcionada permitirá desarrollar documentos y soluciones en las áreas de: Estrategia y Marketing, Finanzas y Cashflow, Contabilidad y Cumplimiento Fiscal, Legal y Gobierno Corporativo, Recursos Humanos y Organización.
>
> Instrucciones:
> - Complete la información con el mayor detalle posible.
> - Si alguna pregunta no aplica, escriba "N/A".
> - Puede responder por escrito o adjuntar documentos complementarios.
> - Toda la información será tratada de manera confidencial.

### SECCIÓN 1 — Información General de la Empresa

**1.1 Datos Generales**
- Nombre legal de la empresa — `text` — `variableKey: company_legal_name`
- Nombre comercial (si es diferente) — `text` — `variableKey: company_name`
- RFC — `text` — `variableKey: company_rfc`
- Fecha de constitución — `date` — `variableKey: company_incorporation_date`
- Giro o actividad principal — `text` — `variableKey: company_industry`
- Dirección fiscal — `textarea` — `variableKey: company_fiscal_address`
- Ciudad y estado de operación — `text` — `variableKey: company_location`
- Página web — `text`
- Redes sociales — `textarea`
- Número total de empleados — `number` — `variableKey: company_employee_count`
- Nombre del representante legal — `text` — `variableKey: company_legal_rep`
- Teléfono principal — `text` — `variableKey: company_phone`
- Correo principal — `text` — `variableKey: company_email`

**1.2 Historia y Contexto**
- ¿Cómo nació la empresa? — `textarea`
- ¿Cuántos años lleva operando? — `number`
- ¿Cuál considera que es el principal diferenciador de la empresa? — `textarea`
- ¿Cuál es la visión de la empresa a 3-5 años? — `textarea`
- ¿Cuáles son actualmente los principales retos del negocio? — `textarea`

### SECCIÓN 2 — Modelo de Negocio y Operación

**2.1 Productos y Servicios**
- ¿Qué productos o servicios venden? — `textarea`
- ¿Cuál es su producto o servicio principal? — `textarea`
- ¿Qué porcentaje representa cada línea de negocio? — `textarea`
- ¿Cuál es el ticket promedio por cliente? — `text`
- ¿Cómo generan ingresos actualmente? — `textarea`
- ¿Tienen ingresos recurrentes o ventas únicas? — `select` `["Recurrentes","Ventas únicas","Ambos"]`

**2.2 Clientes**
- ¿Quién es su cliente ideal? — `textarea`
- ¿Tienen clientes Personas físicas? — `select` `["Sí","No"]`
- ¿Tienen clientes Empresas? — `select` `["Sí","No"]`
- ¿Tienen clientes Gobierno? — `select` `["Sí","No"]`
- ¿Tienen clientes Internacionales? — `select` `["Sí","No"]`
- ¿Cuántos clientes activos tienen aproximadamente? — `number`
- ¿Quiénes son sus principales clientes? — `textarea`
- ¿Existe concentración de ingresos en pocos clientes? — `select` `["Sí","No","No sé"]`
- ¿Cómo consiguen actualmente nuevos clientes? — `textarea`
- ¿Cuál es el principal problema que resuelven a sus clientes? — `textarea`

**2.3 Operación**
- Explique brevemente cómo funciona la operación diaria de la empresa. — `textarea`
- ¿Cuáles son las áreas principales del negocio? — `textarea`
- ¿Qué procesos consideran críticos? — `textarea`
- ¿Qué procesos están documentados? — `textarea`
- ¿Qué procesos siguen dependiendo totalmente de personas clave? — `textarea`
- ¿Qué actividades ya están automatizadas? — `textarea`
- ¿Qué actividades siguen siendo manuales? — `textarea`

### SECCIÓN 3 — Marketing y Comercial

**3.1 Estrategia Comercial**
- ¿Cómo venden actualmente? — `textarea`
- ¿Tienen equipo comercial? — `select` `["Sí","No"]`
- ¿Cuántos vendedores tienen? — `number`
- ¿Utilizan CRM? ¿Cuál? — `text`
- ¿Cómo dan seguimiento a prospectos? — `textarea`
- ¿Cuál es su tasa aproximada de cierre? — `text`

**3.2 Marketing**
- ¿Actualmente realizan campañas de marketing? — `select` `["Sí","No"]`
- Canal: Facebook — `select` `["Sí","No"]`
- Canal: Instagram — `select` `["Sí","No"]`
- Canal: TikTok — `select` `["Sí","No"]`
- Canal: LinkedIn — `select` `["Sí","No"]`
- Canal: Google Ads — `select` `["Sí","No"]`
- Canal: Email marketing — `select` `["Sí","No"]`
- Canal: WhatsApp — `select` `["Sí","No"]`
- Canal: Referidos — `select` `["Sí","No"]`
- ¿Cuál es su presupuesto mensual aproximado de marketing? — `number`
- ¿Qué campañas han funcionado mejor? — `textarea`
- ¿Qué campañas no funcionaron? — `textarea`
- ¿Tienen identidad corporativa/manual de marca? — `select` `["Sí","No"]`
- ¿Tienen página web activa? — `select` `["Sí","No"]`
- ¿Quién administra redes sociales? — `text`
- ¿Qué objetivos comerciales desean alcanzar este año? — `textarea`

**3.3 Competencia y Mercado**
- ¿Quiénes son sus principales competidores? — `textarea`
- ¿Qué hacen mejor que ustedes? — `textarea`
- ¿Qué hacen ustedes mejor que ellos? — `textarea`
- ¿Qué oportunidades ven actualmente en el mercado? — `textarea`
- ¿Qué amenazas consideran importantes? — `textarea`

### SECCIÓN 4 — Finanzas

**4.1 Información Financiera General**
- Ventas mensuales promedio — `number` — `variableKey: company_monthly_sales`
- Margen aproximado de utilidad — `text` — `variableKey: company_profit_margin`
- Gastos fijos mensuales — `number` — `variableKey: company_monthly_fixed_expenses`
- Gastos variables principales — `textarea`
- Flujo mensual aproximado — `number` — `variableKey: company_monthly_cashflow`
- ¿La empresa actualmente es rentable? — `select` `["Sí","No","No sé"]`

**4.2 Control Financiero**
- ¿Tienen presupuestos mensuales o anuales? — `select` `["Sí","No"]`
- ¿Quién controla las finanzas? — `text`
- ¿Utilizan algún ERP o sistema financiero? ¿Cuál? — `text`
- ¿Se generan estados financieros mensuales? — `select` `["Sí","No"]`
- ¿Con qué frecuencia revisan flujo de efectivo? — `text`
- ¿Tienen cuentas por cobrar vencidas? — `select` `["Sí","No","No sé"]`
- ¿Tienen deudas activas? — `select` `["Sí","No"]`
- ¿Qué créditos o financiamientos tienen actualmente? — `textarea`

**4.3 Riesgos Financieros**
- ¿Cuál considera que es el mayor riesgo financiero actualmente? — `textarea`
- ¿Qué área genera más fugas de dinero? — `textarea`
- ¿Existen gastos no controlados? — `textarea`
- ¿Tienen indicadores financieros clave (KPIs)? — `textarea`
- ¿Cuál es el principal objetivo financiero este año? — `textarea`

### SECCIÓN 5 — Contabilidad y Cumplimiento Fiscal

**5.1 Situación Contable**
- ¿Quién lleva la contabilidad actualmente? — `text`
- ¿Es interno o externo? — `select` `["Interno","Externo","Mixto"]`
- ¿Qué sistema contable utilizan? — `text`
- ¿La contabilidad está al corriente? — `select` `["Sí","No","No sé"]`
- ¿Se concilian cuentas bancarias mensualmente? — `select` `["Sí","No"]`
- ¿Se cuenta con XML organizados? — `select` `["Sí","No"]`
- ¿Se realizan cierres mensuales? — `select` `["Sí","No"]`

**5.2 Cumplimiento Fiscal**
- Régimen fiscal actual — `text` — `variableKey: company_tax_regime`
- ¿Tienen opinión de cumplimiento positiva? — `select` `["Sí","No","No sé"]`
- ¿Existen requerimientos activos del SAT? — `select` `["Sí","No","No sé"]`
- ¿Existen créditos fiscales? — `select` `["Sí","No","No sé"]`
- ¿Han tenido auditorías fiscales? — `select` `["Sí","No"]`
- ¿Tienen activos los certificados digitales (.cer/.key)? — `select` `["Sí","No","No sé"]`
- ¿Quién administra accesos SAT y certificados? — `text`
- ¿Tienen controles de facturación y cancelación CFDI? — `select` `["Sí","No"]`

**5.3 Riesgos y Control**
- ¿Cuál considera que es el principal riesgo fiscal o contable? — `textarea`
- ¿Qué procesos contables son más problemáticos? — `textarea`
- ¿Existen diferencias entre operación y contabilidad? — `select` `["Sí","No","No sé"]`
- ¿Tienen políticas internas de control financiero? — `select` `["Sí","No"]`

### SECCIÓN 6 — Legal y Gobierno Corporativo

**6.1 Estructura Legal**
- Tipo de sociedad — `text` — `variableKey: company_legal_form`
- ¿Quiénes son los socios actuales? — `textarea`
- Participación accionaria de cada socio — `textarea`
- ¿Existe consejo de administración? — `select` `["Sí","No"]`
- ¿Existen acuerdos entre socios? — `select` `["Sí","No"]`
- ¿La empresa tiene libros corporativos actualizados? — `select` `["Sí","No","No sé"]`
- ¿Las actas están protocolizadas? — `select` `["Sí","No","No sé"]`

**6.2 Contratos y Riesgos Legales**
- ¿Qué contratos utilizan regularmente? — `textarea`
- ¿Tienen contratos laborales formalizados? — `select` `["Sí","No"]`
- ¿Tienen contratos con proveedores? — `select` `["Sí","No"]`
- ¿Tienen contratos con clientes? — `select` `["Sí","No"]`
- ¿Existen demandas activas o riesgos legales? — `textarea`
- ¿La empresa tiene marcas registradas? — `select` `["Sí","No"]`
- ¿Tienen avisos de privacidad y términos legales? — `select` `["Sí","No"]`

**6.3 Gobierno Corporativo**
- ¿Se realizan juntas periódicas? — `select` `["Sí","No"]`
- ¿Cómo se toman decisiones importantes? — `textarea`
- ¿Existen políticas internas formales? — `select` `["Sí","No"]`
- ¿Tienen organigrama definido? — `select` `["Sí","No"]`
- ¿Qué áreas carecen de control o supervisión? — `textarea`

### SECCIÓN 7 — Recursos Humanos

**7.1 Estructura Organizacional**
- Adjunte organigrama actual (si existe) — `textarea` *(placeholder; could become `file_upload` later)*
- Número total de colaboradores — `number` — `variableKey: company_total_collaborators`
- Áreas existentes — `textarea`
- Puestos clave — `textarea`
- ¿Existen descripciones de puesto? — `select` `["Sí","No"]`
- ¿Existen KPIs por puesto? — `select` `["Sí","No"]`

**7.2 Reclutamiento y Retención**
- ¿Cómo reclutan personal actualmente? — `textarea`
- ¿Cuál es la principal dificultad para contratar? — `textarea`
- ¿Existe rotación alta? — `select` `["Sí","No","No sé"]`
- ¿Qué puestos son más difíciles de cubrir? — `textarea`
- ¿Tienen procesos de onboarding? — `select` `["Sí","No"]`
- ¿Tienen evaluaciones de desempeño? — `select` `["Sí","No"]`

**7.3 Cultura y Riesgos Laborales**
- ¿Cómo describiría la cultura de la empresa? — `textarea`
- ¿Existen conflictos internos frecuentes? — `select` `["Sí","No","No sé"]`
- ¿Tienen reglamento interno? — `select` `["Sí","No"]`
- ¿Cumplen con NOM-035? — `select` `["Sí","No","No sé"]`
- ¿Existen capacitaciones periódicas? — `select` `["Sí","No"]`
- ¿Cuál considera que es el mayor problema de RH actualmente? — `textarea`

### SECCIÓN 8 — Tecnología y Sistemas

- ¿Qué sistemas utilizan actualmente? — `textarea`
- ¿Utilizan ERP? ¿Cuál? — `text`
- ¿Utilizan CRM? ¿Cuál? — `text`
- ¿Qué herramientas usan para administración interna? — `textarea`
- ¿Dónde almacenan información importante? — `textarea`
- ¿Tienen respaldos automáticos? — `select` `["Sí","No","No sé"]`
- ¿Tienen políticas de ciberseguridad? — `select` `["Sí","No"]`
- ¿Qué procesos les gustaría automatizar? — `textarea`

### SECCIÓN 9 — Objetivos y Prioridades

**9.1 Prioridades Estratégicas**
- ¿Qué desean resolver primero? — `textarea`
- ¿Cuál es actualmente el "dolor" principal del negocio? — `textarea`
- ¿Qué área consideran más urgente? — `textarea`
- ¿Qué meta desean alcanzar en los próximos 12 meses? — `textarea`
- ¿Qué resultado haría que este proyecto fuera un éxito para ustedes? — `textarea`

### SECCIÓN 10 — Documentación Disponible

All `select` `["Sí","No"]`. Inventory checklist — not uploads.

**Legales:** Acta constitutiva · Actas de asamblea · Poderes · Contratos laborales · Contratos comerciales · Títulos de marca
**Financieros:** Estados financieros · Balanza contable · Flujo de efectivo · Presupuestos · Relación de deudas
**Contables/Fiscales:** Opinión SAT · CSF · Declaraciones · XML · Conciliaciones bancarias
**Recursos Humanos:** Organigrama · Descripciones de puesto · Expedientes laborales · Reglamento interno · Políticas internas
**Marketing:** Manual de marca · Logotipos editables · Acceso redes sociales · Acceso página web · Base de clientes

### SECCIÓN 11 — Observaciones Finales

- ¿Hay algo importante que considere que debamos conocer sobre la empresa? — `textarea`
- ¿Existe alguna problemática delicada o prioritaria que no se haya mencionado? — `textarea`
- Comentarios adicionales — `textarea`

---

## Expected outcome

With this information populated per client, the system will generate the deliverables already designed in the templates seed: diagnóstico empresarial integral, plan estratégico, auditoría operativa, diagnóstico financiero, proyección de flujo, diagnóstico fiscal, estructura legal corporativa, gobierno corporativo, organigramas y perfiles de puesto, estrategia comercial y marketing, automatización y optimización de procesos, KPIs y tableros de control, roadmap de crecimiento empresarial.
