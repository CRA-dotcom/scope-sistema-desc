# Deliverables — Sub-proyecto F (test generator with real data) — Design

**Date:** 2026-05-12
**Sprint:** v2 (toward 2026-05-15 demo, friday)
**Owner:** Christian
**Status:** Approved (pending user spec review)

---

## Context

The partner (call of 2026-05-12) needs a way to validate AI-generated deliverable output before producing the real version for a client. Concretely: pick the "Plan Anual de Marketing" template, pair it with a Catimi questionnaire that the operator has already responded to internally, run the full AI pipeline, and visually inspect the resulting HTML — iterating on the template or prompts as needed before flipping it on for production.

The deliverables module already supports end-to-end generation via `generateDeliverable` (`convex/functions/deliverables/actions.ts:156`). However, that action requires an existing `monthlyAssignments` row — generation is bound to the projection matrix. There is no way today to generate output from arbitrary `(template, questionnaire)` pairs without a real assignment.

The templates page (`/platform/templates`) already exposes a "Vista Previa" button (`page.tsx:566`) that renders templates with synthetic sample data via `generateSampleContext` and `resolveTemplate`. That preview does NOT call the AI — it's purely client-side templating. The new test generator solves a different problem: real questionnaire data + real Claude calls + real prompt rendering, surfaced ephemerally for QA.

## Goals

1. Add a "Probar con datos reales" button per template in `/platform/templates` that triggers a modal where the operator picks an already-answered questionnaire and runs full AI generation.
2. The action `previewDeliverable` reuses the post-refactor `convex/lib/deliverableEngine/` helpers (`extractPlaceholders` + `resolveStatic` + `batchFillWithClaude`) plus the file-local `buildContextBlock` / `formatToday` from `generateDeliverable`, but does NOT persist anything to the `deliverables` table.
3. Surface the AI cost/latency metrics (tokens, USD, ms) and **unfilled keys** per generation so the partner can spot expensive prompts and broken templates before they go to production.
4. Allow regenerating with the same inputs (different Claude sampling) without reopening the modal.

## Non-Goals

- Persisting test deliverables (a-la "draft deliverables" with `isTest: true`). The output is ephemeral — closing the modal discards it.
- Changing the production `generateDeliverable` flow. It still requires `assignmentId` + `projServiceId` + `clientId` + `templateType` and still persists.
- Authoring templates from inside the modal. Edits happen in the existing template editor; the modal only consumes the saved template.
- Showing the diff between two runs. Each generation is independent.
- Bulk-testing multiple templates or questionnaires at once.
- Sub-proyecto E (matrix cell pills) — already merged to main as `10ac1e7`.

## Scope decisions captured during brainstorming

- **Trigger location**: button per template in `/platform/templates`, distinct from the existing "Vista Previa" (which uses dummy data and no AI).
- **Output presentation**: ephemeral modal with an iframe rendering the resulting HTML; metrics row at the bottom; regenerate inside the modal.
- **Inputs to the action**: just `templateId` + `questionnaireId`. The action derives `clientId`, `projectionId`, and `projectionService` itself.
- **Persistence**: none. The action returns `{ html, aiLog, tokensUsed, costUsd, elapsedMs }` and the modal renders directly.
- **Questionnaire filter**: dropdown shows responses with `status ∈ {"completed", "in_progress"}`. Drafts are hidden because they typically have empty answers.
- **AI metrics**: shown inline at the bottom of the modal. Useful for catching prompt bloat or runaway token usage on a per-variable basis.

---

## Design

### § 1. Trigger UI — button + modal entry

**Files:**
- Modify: `src/app/platform/templates/page.tsx` (add a new button next to the existing "Vista Previa")
- Create: `src/components/templates/test-deliverable-modal.tsx`

In the template card (around `page.tsx:566` where "Vista Previa" is rendered), add a sibling button:

```tsx
<button
  onClick={() => setTestTemplateId(template._id)}
  className="inline-flex items-center gap-2 rounded-md border border-accent/40 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/5 cursor-pointer"
>
  🧪 Probar con datos reales
</button>
```

State at the page level:

```ts
const [testTemplateId, setTestTemplateId] = useState<Id<"deliverableTemplates"> | null>(null);
```

Render the modal conditionally at the bottom of the page:

```tsx
{testTemplateId && (
  <TestDeliverableModal
    templateId={testTemplateId}
    onClose={() => setTestTemplateId(null)}
  />
)}
```

### § 2. Modal component

**File:** `src/components/templates/test-deliverable-modal.tsx`

Props:

```ts
type Props = {
  templateId: Id<"deliverableTemplates">;
  onClose: () => void;
};
```

Internal state:

```ts
const [questionnaireId, setQuestionnaireId] = useState<Id<"questionnaireResponses"> | null>(null);
const [output, setOutput] = useState<PreviewOutput | null>(null);
const [generating, setGenerating] = useState(false);
const [error, setError] = useState<string | null>(null);

type PreviewOutput = {
  html: string;
  aiLog: AiLogEntry[];
  tokensUsed: number;
  costUsd: number;
  elapsedMs: number;
};
```

Queries:

```ts
const template = useQuery(api.functions.deliverableTemplates.queries.getById, { id: templateId });
const questionnaires = useQuery(api.functions.questionnaires.queries.listTestable, {});
//   ^^ new query (see § 4). Returns completed + in_progress responses with client name + projection year.
const previewAction = useAction(api.functions.deliverables.actions.previewDeliverable);
```

Layout (modal centered, 800x600 max):

```
┌─ Probar con datos reales ──────────────────── X ┐
│                                                  │
│ Template: {template.name}                        │
│                                                  │
│ Cuestionario de origen:                          │
│ [▼ {Cliente} — {projection.year} ({status})]    │
│                                                  │
│ [ Generar prueba ]                               │
│                                                  │
│ ─── Output ───────────────────────────────────  │
│                                                  │
│ {error ? error banner : null}                    │
│                                                  │
│ {output ? <iframe srcDoc={output.html} /> : null}│
│                                                  │
│ {output ? <MetricsRow /> : null}                 │
│                                                  │
│ [ Regenerar ]  [ Copiar HTML ]  [ Cerrar ]      │
└──────────────────────────────────────────────────┘
```

`MetricsRow`:
```
Variables AI: {aiLog.length} · Tokens: {tokensUsed} · ~${costUsd.toFixed(4)} USD · {elapsedMs}ms
```

`Generar prueba` handler:

```ts
async function handleGenerate() {
  if (!questionnaireId) return;
  setGenerating(true);
  setError(null);
  try {
    const result = await previewAction({ templateId, questionnaireId });
    setOutput(result);
  } catch (err) {
    setError(err instanceof Error ? err.message : "Error al generar");
  } finally {
    setGenerating(false);
  }
}
```

`Regenerar` calls the same handler. `Copiar HTML` uses `navigator.clipboard.writeText(output.html)`. `Cerrar` calls `onClose()`.

iframe `sandbox="allow-same-origin"` (no scripts allowed — the deliverable HTML is static).

### § 3. Server action `previewDeliverable`

**File:** modify `convex/functions/deliverables/actions.ts` (append after the existing `auditDeliverable` action)

```ts
export const previewDeliverable = action({
  args: {
    templateId: v.id("deliverableTemplates"),
    questionnaireId: v.id("questionnaireResponses"),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    html: string;
    aiLog: AiLogEntry[];
    tokensUsed: number;
    costUsd: number;
    elapsedMs: number;
  }> => {
    const t0 = Date.now();

    // 1. Fetch template, questionnaire, client, projection in parallel.
    //    Use existing internalQueries where they exist; add new ones for template + questionnaire.
    const template = await ctx.runQuery(
      internal.functions.deliverables.internalQueries.getTemplateById,
      { templateId: args.templateId }
    );
    if (!template) throw new Error("Template no encontrado.");

    const questionnaire = await ctx.runQuery(
      internal.functions.deliverables.internalQueries.getQuestionnaireById,
      { questionnaireId: args.questionnaireId }
    );
    if (!questionnaire) throw new Error("Cuestionario no encontrado.");

    // Cross-org safety: a super-admin querying across orgs could otherwise
    // pair a template from org A with a questionnaire from org B. Block it.
    // Global templates (orgId === undefined) are allowed against any questionnaire.
    if (template.orgId !== undefined && template.orgId !== questionnaire.orgId) {
      throw new Error(
        "Template y cuestionario pertenecen a organizaciones distintas."
      );
    }

    const [client, projection] = await Promise.all([
      ctx.runQuery(
        internal.functions.deliverables.internalQueries.getClientData,
        { clientId: questionnaire.clientId }
      ),
      ctx.runQuery(
        internal.functions.deliverables.internalQueries.getProjectionByProjService,
        { projectionId: questionnaire.projectionId }
      ),
    ]);
    if (!client) throw new Error("Cliente del cuestionario no encontrado.");
    if (!projection) throw new Error("Proyección del cuestionario no encontrada.");

    // 2. Optional projService lookup (when template.serviceId is set).
    let projService: { serviceName?: string; chosenPct?: number; annualAmount?: number } | null = null;
    if (template.serviceId) {
      projService = await ctx.runQuery(
        internal.functions.deliverables.internalQueries.findProjServiceByServiceAndProjection,
        { projectionId: questionnaire.projectionId, serviceId: template.serviceId }
      );
    }

    // 3. Resolve non-AI variables.
    const context = {
      client: client as unknown as Record<string, unknown>,
      projection: projection as unknown as Record<string, unknown>,
      service: (projService ?? {}) as unknown as Record<string, unknown>,
    };
    const { html: htmlAfterNonAi, aiVariables } = resolveNonAiVariables(
      template.htmlTemplate,
      template.variables,
      context
    );

    // 4. Resolve AI variables. Build the questionnaire context the same way
    //    generateDeliverable does (P:/R: pairs), then call Claude per variable.
    const anthropic = getAnthropicClient();
    if (aiVariables.length > 0 && !anthropic) {
      throw new Error(
        "ANTHROPIC_API_KEY no configurada. Agrega la key en .env.local para correr generaciones AI."
      );
    }

    const questionnaireContext = questionnaire.responses
      ? questionnaire.responses
          .map((r: { questionText: string; answer: string }) => `P: ${r.questionText}\nR: ${r.answer}`)
          .join("\n\n")
      : "Sin respuestas de cuestionario disponibles.";

    const projectionContext = `Ventas anuales: $${projection.annualSales.toLocaleString(
      "es-MX"
    )}, Presupuesto total: $${projection.totalBudget.toLocaleString("es-MX")}, Comision: ${projection.commissionRate * 100}%`;

    let resolvedHtml = htmlAfterNonAi;
    const aiLogs: AiLogEntry[] = [];

    for (const aiVar of aiVariables) {
      const result = await callClaudeWithRetry(
        anthropic!,
        `Eres un consultor profesional${
          projService?.serviceName ? ` de ${projService.serviceName}` : ""
        }. Genera contenido para un entregable empresarial.`,
        `Variable: ${aiVar.label}.\n\nContexto del cliente: ${client.name}, industria: ${client.industry}.\n\nDatos financieros: ${projectionContext}\n\n${
          projService?.serviceName
            ? `Servicio: ${projService.serviceName} (${projService.chosenPct}% del presupuesto, monto anual: $${(projService.annualAmount ?? 0).toLocaleString("es-MX")})\n\n`
            : ""
        }Respuestas del cuestionario:\n${questionnaireContext}\n\nGenera el contenido en español profesional. Responde únicamente con el contenido solicitado, sin encabezados ni explicaciones adicionales.`
      );

      resolvedHtml = resolvedHtml.replace(
        new RegExp(escapeRegex(`{{${aiVar.key}}}`), "g"),
        result.text
      );
      resolvedHtml = resolvedHtml.replace(
        new RegExp(escapeRegex("[AI_PENDIENTE]"), "g"),
        ""
      );
      aiLogs.push(result.log);
    }

    const tokensUsed = aiLogs.reduce((acc, l) => acc + l.inputTokens + l.outputTokens, 0);
    const costUsd = aiLogs.reduce((acc, l) => acc + l.costUsd, 0);
    const elapsedMs = Date.now() - t0;

    return { html: resolvedHtml, aiLog: aiLogs, tokensUsed, costUsd, elapsedMs };
  },
});
```

This action does NOT call `ctx.db.insert` or `ctx.runMutation` anywhere — purely read + AI + return.

### § 4. New internal queries (deliverables/internalQueries.ts)

Add two missing internal queries (the rest already exist):

```ts
export const getTemplateById = internalQuery({
  args: { templateId: v.id("deliverableTemplates") },
  handler: async (ctx, { templateId }) => {
    return await ctx.db.get(templateId);
  },
});

export const getQuestionnaireById = internalQuery({
  args: { questionnaireId: v.id("questionnaireResponses") },
  handler: async (ctx, { questionnaireId }) => {
    return await ctx.db.get(questionnaireId);
  },
});

export const findProjServiceByServiceAndProjection = internalQuery({
  args: {
    projectionId: v.id("projections"),
    serviceId: v.id("services"),
  },
  handler: async (ctx, { projectionId, serviceId }) => {
    return await ctx.db
      .query("projectionServices")
      .withIndex("by_projectionId", (q) => q.eq("projectionId", projectionId))
      .filter((q) => q.eq(q.field("serviceId"), serviceId))
      .first();
  },
});
```

### § 5. New public query for the dropdown — `questionnaires.listTestable`

**File:** `convex/functions/questionnaires/queries.ts` (add a new export)

```ts
export const listTestable = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    const responses = await ctx.db
      .query("questionnaireResponses")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    const filtered = responses.filter(
      (r) => r.status === "completed" || r.status === "in_progress"
    );

    // Enrich with client name for the dropdown label.
    const out = await Promise.all(
      filtered.map(async (r) => {
        const client = await ctx.db.get(r.clientId);
        const projection = await ctx.db.get(r.projectionId);
        return {
          _id: r._id,
          clientName: client?.name ?? "Cliente",
          projectionYear: projection?.year ?? null,
          status: r.status,
          responseCount: r.responses.length,
        };
      })
    );

    return out.sort((a, b) => (a.clientName ?? "").localeCompare(b.clientName ?? ""));
  },
});
```

Dropdown label format: `{clientName} — {projectionYear ?? "—"} ({status}, {responseCount} respuestas)`.

### § 6. Tests

**File modified:** `convex/functions/deliverables/__tests__/previewDeliverable.test.ts` (new file)

Test cases:

| Case | Setup | Expected |
|---|---|---|
| Template without AI variables | Seed template with only `client`/`projection` variables; happy path | Returns `html` with substitutions, `aiLog === []`, `tokensUsed === 0`, `costUsd === 0` |
| Template missing AI key | `ANTHROPIC_API_KEY` unset; template has AI variables | Throws `"ANTHROPIC_API_KEY no configurada..."` |
| Template not found | Pass bogus `templateId` | Throws `"Template no encontrado."` |
| Questionnaire not found | Pass bogus `questionnaireId` | Throws `"Cuestionario no encontrado."` |
| Cross-org template + questionnaire | Seed org-scoped template (orgId=A) and questionnaire (orgId=B); call action | Throws `"Template y cuestionario pertenecen a organizaciones distintas."` |
| Global template + any-org questionnaire | Seed template with `orgId === undefined`; questionnaire in org A | Succeeds — global templates are universal defaults |

The Anthropic-calling path is mocked or skipped — the tests verify routing and error paths, not the actual Claude HTTP calls. Use the same pattern as `convex/functions/deliverables/` tests if they exist; if none exist, follow the `questionnaires` test patterns and seed required tables (`organizations`, `clients`, `projections`, `questionnaireResponses`, `deliverableTemplates`).

**Manual QA:**
1. Open `/platform/templates` as super-admin in the seeded org.
2. Locate the "Plan Anual de Marketing" template (or any with AI variables). Click "🧪 Probar con datos reales".
3. The dropdown lists at least one questionnaire (the master one if it has responses, or a Catimi/ACME one).
4. Click Generar; the loader spins for 10-30s; the iframe renders the result; the metrics row shows non-zero tokens and cost.
5. Click Regenerar; the same flow runs and the iframe re-renders (output may differ slightly because of Claude sampling).
6. Click Copiar HTML; confirm clipboard has the HTML.
7. Close the modal; confirm no `deliverables` row was created (`npx convex data deliverables --limit 5` shows the same count as before).

### § 7. Risks and open questions

- **R1 — Cost runaway**: a misconfigured template (e.g. 30 AI variables) could cost dollars per click. The metrics row surfaces this AFTER the run. Mitigation: future enhancement can add a confirm dialog when `aiVariables.length > 10`. Out of scope for v1.
- **R2 — `getAnthropicClient` lacks a key**: throws inside the action, surfaced as error banner in the modal. Operator must add the key to `.env.local` and restart Convex dev. Documented in the error message.
- **R3 — Cross-org pairing**: the action enforces `template.orgId === questionnaire.orgId` when the template is org-scoped (i.e. `template.orgId !== undefined`). Global templates (`orgId === undefined`, which exist as defaults seeded for all orgs) are usable against any org's questionnaire. Test case "multi-tenant isolation" verifies this.
- **R4 — Template without `serviceId`**: handled gracefully (projService is null and `{{service.*}}` AI prompts omit the service line). Tested in case "Template without AI variables".
- **R5 — Questionnaire `responses` is empty**: the questionnaire context becomes "Sin respuestas de cuestionario disponibles." — AI generation continues but the output is generic. The metrics row + visible iframe make this obvious to the operator.

## Appendix — Files added or modified

**Added:**
- `src/components/templates/test-deliverable-modal.tsx`
- `convex/functions/deliverables/__tests__/previewDeliverable.test.ts`

**Modified:**
- `convex/functions/deliverables/actions.ts` (add `previewDeliverable` action)
- `convex/functions/deliverables/internalQueries.ts` (add `getTemplateById`, `getQuestionnaireById`, `findProjServiceByServiceAndProjection`)
- `convex/functions/questionnaires/queries.ts` (add `listTestable`)
- `src/app/platform/templates/page.tsx` (add "🧪 Probar con datos reales" button + modal mount)
