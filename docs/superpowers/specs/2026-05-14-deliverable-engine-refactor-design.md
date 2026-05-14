# Deliverable Engine Refactor — Design

**Date:** 2026-05-14
**Sprint:** v2 (toward 2026-05-15 demo)
**Owner:** Christian
**Status:** Approved — design decisions locked 2026-05-14
**Related:** `2026-05-12-deliverables-test-generator-F-design.md` (depends on this refactor)

---

## Context

While generating demo PDFs for Katimi (review call BiHive 2026-05-13), the action `convex/functions/deliverables/actions.ts:generateDeliverable` could not be used end-to-end against the **real templates stored in production DB**. A standalone script bypassed the action entirely and produced six demo PDFs of high enough quality to show clients (`~/Desktop/projex-deliverables-demo-2026-05-13/`). This document specifies the changes needed for the platform engine to produce the same output natively.

The script (`scripts/generate-demo-deliverables.mjs`) is the **reference implementation** for what the production action should behave like. It diverges from `generateDeliverable` in four meaningful ways — each of those divergences corresponds to a fix this spec captures.

The cost difference is material: the current production code would consume ~$33 of Claude credit per fully rendered entregable for the Katimi-class workload (Contabilidad alone = 422 AI variables × one Claude call each). The reference implementation produces equivalent output for ~$0.50 per entregable thanks to batched JSON output + prompt caching.

## What the standalone script does (reference implementation)

`scripts/generate-demo-deliverables.mjs` reads templates dumped from Convex (`npx convex data deliverableTemplates --format json > scripts/.demo-data/templates.json`) and Katimi's context dump (`convex/functions/devtools/dumpDemoContext:dumpForClient`), then for each of six picked templates:

1. **Discovers placeholders directly from the HTML.** It runs `template.htmlTemplate.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)` to find every `{{key}}` in the document. It does **not** rely on `template.variables` (the array stored alongside the HTML), because that array is stale relative to the HTML in production — TI Long has 23 entries in `variables` and 113 placeholders in the HTML.
2. **Resolves "static" placeholders with an explicit name-aware switch.** For every key found, a `resolveStatic(key, ctx)` function maps known prefixes to the right field of the right doc:
   - `client_name`, `company_name`, `company_legal_name` → `client.name`
   - `client_industry` → `client.industry`
   - `manual_client_rfc`, `client_rfc`, `company_rfc` → `client.rfc`
   - `branding_*` → `orgBranding.*` with defaults for color/font when null
   - `current_date`, `fecha` → today
   - `service_name`, `service_chosen_pct`, `service_annual_amount` → `projService.*` (with synthetic amount = `chosenPct × effectiveBudget` when the service is inactive)
   - `projection_year`, `projection_annual_sales`, `projection_total_budget` → `projection.*`
3. **Batches the remaining placeholders through Claude.** Anything `resolveStatic` returns `null` for (whether tagged `ai`, `manual`, or undeclared in `template.variables`) is collected and partitioned into chunks of ≤80 keys. Each chunk is sent in **one** Claude call asking for a single JSON object mapping every key to a value, with hints like `"ai_score_*": "<score 0-100>"`, `"ai_*_amount": "<$X,XXX,XXX MXN>"`, `"ai_roi_total_*"` should equal the sum of the corresponding `_1, _2, ..., _N` entries.
4. **Caches the system + context block via `cache_control: ephemeral`.** The ~5K-token "client + projection + 185 questionnaire responses" block is marked as cacheable; subsequent chunks within the same template read from cache at ~10% of normal input cost. Measured: chunk 1 = 9.3K input tokens, chunks 2-6 = 2.9-3.2K input tokens each (the difference is what gets served from cache).
5. **Retries truncated chunks at smaller sizes.** When a chunk's output exceeds Claude's 8192-token max, the JSON gets cut mid-value and parse fails. The script collects keys that didn't appear in the parsed JSON and retries them in chunks of 30, then 12.
6. **Bails out on credit exhaustion.** If Claude returns `credit_balance_too_low`, the script raises `CreditExhaustedError` and stops issuing further calls in this run (saves 35+ wasted retry attempts when the wallet is empty).
7. **Renders the resolved HTML with `puppeteer-core` + system Chrome to PDF.** Identical engine to `src/app/api/generate-pdf/route.ts`, but called directly rather than via the API route.

Output for Katimi: six full-quality PDFs, total cost ~$2.

## Issues with the current production engine

All four issues live in `convex/functions/deliverables/actions.ts:156` (`generateDeliverable`) and the helper it calls, `resolveNonAiVariables` (`actions.ts:49`).

### Issue 1 — Static var resolver checks for keys that don't exist on the doc

`resolveNonAiVariables` looks up each variable like this:

```ts
if (source === "client" && context.client && key in context.client) {
  const raw = context.client[key];
  value = typeof raw === "number" ? raw.toLocaleString("es-MX") : String(raw ?? "");
}
```

This requires `key` to be a literal field name on the client doc. But the templates in DB use prefixed keys: `client_name`, `client_industry`, `company_rfc`. The client doc has `name`, `industry`, `rfc`. The lookup always fails, so every "client"-sourced var stays as `{{client_name}}` in the rendered HTML.

Same problem affects `projection`, `service`, and especially `manual` (which is never resolved at all — the action treats `manual` source as effectively unfillable, leaving `{{branding_company_name}}`, `{{current_date}}`, etc. unfilled).

### Issue 2 — `template.variables` array is stale relative to the HTML

`resolveNonAiVariables` iterates over `template.variables` and only acts on declared variables. But the HTML contains many more `{{key}}` placeholders than appear in `variables`. Measured counts on production templates:

| Template | `variables.length` | placeholders in HTML | orphan count |
|---|---|---|---|
| TI - Diagnóstico Largo | 23 | 113 | 90 |
| Admin - Manual Operativo Master | 60 | 72 | 12 |
| Legal - Master Corporate Governance Blueprint (Largo) | 86 | 86 | 0 |
| Marketing - Plan Anual Completo | 121 | 215 | 94 |
| Financiero - Reporte Diagnóstico Largo | 33 | 754 | 721 |
| Informe de Auditoría Interna y Cumplimiento Fiscal | 425 | 425 | 0 |

The orphans render literally as `{{ai_finding_a1}}` in the PDF. Worst case (Financiero) the PDF is mostly raw placeholder text.

### Issue 3 — One Claude call per AI variable

`generateDeliverable` does this loop (`actions.ts:238`):

```ts
for (const aiVar of aiVariables) {
  const result = await callClaudeWithRetry(anthropic, systemPrompt, userPrompt);
  resolvedHtml = resolvedHtml.replace(...);
}
```

For Katimi, that means **668 sequential Claude calls** to fill one entregable batch. Each call sends the full system prompt + questionnaire context (~5K tokens) and gets back a 50-2000 token response. Cost ≈ $0.05/call × 668 = $33 per entregable cycle. Latency: ~15-30 minutes. The script demonstrates the same content can be produced in ~12 Claude calls per Katimi (one per template chunk).

### Issue 4 — No prompt caching

Even setting aside batching, each Claude call sends the full system prompt and full context (client + projection + questionnaire ~5K tokens) every time. Anthropic supports `cache_control: ephemeral` since 2024 — for the action's pattern of "many calls with the same system+context, different variable to fill", caching the static portion saves ~85% on input tokens at scale.

---

## Goals

1. The production action `generateDeliverable` produces PDFs visually equivalent to the standalone script's output when run against Katimi (or any production client) with the templates as-stored in DB.
2. Fill rate (placeholders successfully replaced) goes from current ~10-20% to ≥98% across all six production deliverable_long templates.
3. AI cost per entregable for a Katimi-class workload drops by ≥90% vs the current 1-call-per-var pattern.
4. The refactor does not require any change to existing template HTML or `variables` arrays. Templates work as-is.
5. The new code path is used by both `generateDeliverable` (assignment-bound, persists to `deliverables`) and the not-yet-implemented `previewDeliverable` from sub-project F (ephemeral preview).

## Non-Goals

- Editing the HTML of any template. (Issue 2 is fixed by *parsing HTML for placeholders* rather than syncing the array.)
- Repopulating `template.variables` so it matches the HTML. (Optional follow-up, not required.)
- Changing the React-side `usePdfGenerator` hook or the `/api/generate-pdf` route. The Puppeteer rendering layer is fine.
- Changing the `deliverables` schema, `monthlyAssignments`, `projectionServices`, or any DB schema.
- Implementing sub-project F (`previewDeliverable`). This refactor unblocks it; F is built in a follow-up.
- Streaming results, partial renders, progress callbacks. Generation stays as a single action call returning when finished.

---

## Design

The refactor splits cleanly into four extractable concerns. All sit in `convex/lib/` so they can be unit-tested independently of the Convex runtime, with `convex/functions/deliverables/actions.ts` becoming a thin orchestrator.

### § 1. Placeholder discovery (replaces dependency on `template.variables`)

**File:** `convex/lib/deliverableEngine/placeholders.ts` (new)

```ts
const PLACEHOLDER_RE = /\{\{([a-zA-Z0-9_]+)\}\}/g;

export function extractPlaceholders(html: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = PLACEHOLDER_RE.exec(html)) !== null) out.add(m[1]);
  return [...out];
}
```

Pure function. ~10 lines. Replaces the `for (const variable of template.variables)` iteration in `resolveNonAiVariables`.

### § 2. Static var resolver (fixes Issue 1)

**File:** `convex/lib/deliverableEngine/staticResolver.ts` (new)

```ts
export type StaticResolutionContext = {
  client: Doc<"clients">;
  projection: Doc<"projections"> | null;
  projService: Doc<"projectionServices"> | null;
  orgBranding: Doc<"orgBranding"> | null;
  today: string;
};

export function resolveStatic(key: string, ctx: StaticResolutionContext): string | null {
  const branding = {
    companyName: ctx.orgBranding?.companyName ?? "Projex",
    footerText: ctx.orgBranding?.footerText ?? "",
    primaryColor: ctx.orgBranding?.primaryColor ?? "#1a1a2e",
    secondaryColor: ctx.orgBranding?.secondaryColor ?? "#6c63ff",
    accentColor: ctx.orgBranding?.accentColor ?? "#22c55e",
    fontFamily: ctx.orgBranding?.fontFamily ?? "'IBM Plex Sans', sans-serif",
  };
  switch (key) {
    case "client_name":
    case "company_name":
    case "company_legal_name":
      return ctx.client.name;
    case "client_industry":
    case "company_industry":
      return ctx.client.industry;
    case "client_rfc":
    case "company_rfc":
    case "manual_client_rfc":
      return ctx.client.rfc;
    case "client_billing_frequency":
    case "company_billing_frequency":
      return ctx.client.billingFrequency ?? "mensual";
    case "client_revenue":
    case "client_annual_revenue":
    case "company_annual_revenue":
      return fmtMoney(ctx.client.annualRevenue);
    case "current_date":
    case "fecha":
      return ctx.today;
    case "branding_company_name":
      return branding.companyName;
    case "branding_footer_text":
      return branding.footerText;
    case "branding_primary_color":
    case "branding_secondary_color":
    case "branding_accent_color":
    case "branding_font_family":
      return branding[/* derive from key */];
    case "projection_year":
    case "fiscal_year":
      return ctx.projection ? String(ctx.projection.year) : "";
    case "projection_annual_sales":
      return ctx.projection ? fmtMoney(ctx.projection.annualSales) : "";
    case "projection_total_budget":
      return ctx.projection ? fmtMoney(ctx.projection.totalBudget) : "";
    case "service_name":
      return ctx.projService?.serviceName ?? "";
    case "service_chosen_pct":
      return ctx.projService ? fmtPct(ctx.projService.chosenPct ?? 0) : "";
    case "service_annual_amount":
      return ctx.projService ? fmtMoney(
        ctx.projService.annualAmount > 0
          ? ctx.projService.annualAmount
          : Math.round((ctx.projService.chosenPct ?? 0) * (ctx.projection?.effectiveBudget ?? ctx.projection?.totalBudget ?? 0))
      ) : "";
    default:
      return null;
  }
}
```

Returns `null` for unknown keys. Caller treats `null` as "needs AI fill". The full key list above is exactly what the script ships today — port it verbatim and test against all six production templates.

### § 3. Batched AI fill with prompt caching (fixes Issues 3 & 4)

**File:** `convex/lib/deliverableEngine/aiBatchFill.ts` (new)

```ts
export type BatchFillResult = {
  resolved: Record<string, string>;
  unfilled: string[];
  log: AiLogEntry[];
  totalCost: number;
};

export async function batchFillWithClaude(
  anthropic: Anthropic,
  area: string,
  contextBlock: string,    // cacheable: system context + questionnaire
  keys: string[],
  opts: { chunkSize?: number; retryChunkSizes?: number[] } = {}
): Promise<BatchFillResult> {
  const chunkSize = opts.chunkSize ?? 80;
  const retrySizes = opts.retryChunkSizes ?? [30, 12];
  // ... implementation mirrors scripts/generate-demo-deliverables.mjs
}

class CreditExhaustedError extends Error { code = "CREDIT_EXHAUSTED"; }
```

Internals:

- **Build the messages with `cache_control: { type: "ephemeral" }`** on the user content block that contains the questionnaire. System prompt also cached.
- Issue chunks sequentially (Claude rate limits make parallel risky for templates with 6+ chunks). Per chunk: parse JSON; merge into `resolved`.
- Failures (truncated JSON, non-credit errors): skip and retry the missing keys in successively smaller chunks.
- Failures (`credit_balance_too_low`): throw `CreditExhaustedError`; let the caller decide whether to leave the deliverable in an `incomplete` state or fail the entire run.
- Returns the final `resolved` map, list of unfilled keys, AI log entries, and total cost.

### § 4. Putting it together — refactor `generateDeliverable`

**File:** `convex/functions/deliverables/actions.ts` (modify, ~150 lines net change)

The current `handler` in `generateDeliverable`:

1. fetches assignment, client, projService, projection, questionnaire, template (unchanged)
2. calls `resolveNonAiVariables(template.htmlTemplate, template.variables, context)` → **replace** with `extractPlaceholders + resolveStatic + batchFillWithClaude`
3. for each AI var, calls Claude individually → **delete** (replaced by step 2)
4. saves deliverable (unchanged)

New shape of the handler:

```ts
const placeholders = extractPlaceholders(template.htmlTemplate);
const today = formatToday();
const staticCtx = { client, projection, projService, orgBranding, today };
const resolved: Record<string, string> = {};
const needsAi: string[] = [];
for (const k of placeholders) {
  const v = resolveStatic(k, staticCtx);
  if (v !== null) resolved[k] = v;
  else needsAi.push(k);
}

const anthropic = getAnthropicClient();
let aiLog: AiLogEntry[] = [];
let unfilled: string[] = needsAi;
if (anthropic && needsAi.length > 0) {
  const contextBlock = buildContextBlock(client, projection, projService, questionnaire);
  const result = await batchFillWithClaude(
    anthropic, projService.serviceName, contextBlock, needsAi
  );
  Object.assign(resolved, result.resolved);
  aiLog = result.log;
  unfilled = result.unfilled;
}

// Stuff any still-unfilled keys with a visible marker so we can spot incomplete renders in QA
for (const k of unfilled) {
  resolved[k] = `<em style="color:#94a3b8">[${k}]</em>`;
}

let html = template.htmlTemplate;
for (const [k, v] of Object.entries(resolved)) {
  html = replaceAll(html, k, v);
}

await ctx.runMutation(internal.functions.deliverables.mutations.saveGenerated, {
  // ... existing args, but shortContent/longContent = html, plus an unfilled-keys note for QA
});
```

The action stays an `action` (uses `"use node"`), continues to depend on `internal.functions.deliverables.internalQueries.*` for data fetches.

### § 5. Cleanups (optional, recommended)

- **Delete `resolveNonAiVariables`** from `actions.ts` once nothing calls it. (Search confirms only `generateDeliverable` uses it.)
- **Keep the "no AI key configured" branch.** It currently produces `AI_UNAVAILABLE_PLACEHOLDER` per var; under the new shape, the same branch fires when `getAnthropicClient()` returns `null` — all `needsAi` keys get the placeholder.
- **Audit `auditDeliverable` and `regenerateDeliverable`** in the same file. They currently do their own Claude calls with the full content. Consider whether they should also use prompt caching for the questionnaire context. Out of scope for this spec but worth a follow-up task.
- **`template.variables` array.** Stop treating it as authoritative. A future seed update can sync it back, but the engine no longer cares.

---

## Locked design decisions (2026-05-14)

### D1 — Behavior when keys remain unfilled

**Decision: save the deliverable with `auditStatus: "rejected"` + list of unfilled keys in `auditFeedback`.**

The existing audit pipeline already classifies deliverables as approved/rejected/corrected; we extend it to also surface "incomplete render" cases. `saveGenerated` accepts an optional `unfilledKeys: string[]` and stores them inside `auditFeedback` as JSON. The audit UI surfaces the list so the operator can decide to re-run or hand-edit before sending.

Implementation note: the rendered HTML still gets a visible `[key_name]` marker for each unfilled placeholder so the PDF doesn't have raw `{{...}}` braces. The marker color is `#94a3b8` (slate-400) — visible to QA but not screaming.

### D2 — Where do the new modules live

**Decision: `convex/lib/deliverableEngine/`** (new shared directory).

This altitude lets `previewDeliverable` (sub-project F) consume the same modules without cross-importing from `convex/functions/deliverables/`, and leaves the door open for quotation + contract generation to use the same engine once they get the AI treatment.

### D3 — Chunk sizes

**Decision: 60 / 25 / 10.**

First chunk: 60 keys. Retry pass 1 (for any keys missing from parsed JSON): 25 keys. Retry pass 2: 10 keys. Beyond retry pass 2, the key is treated as unfilled and falls into D1's path.

Constants live in `convex/lib/deliverableEngine/aiBatchFill.ts` as exported `DEFAULT_CHUNK_SIZE`, `RETRY_CHUNK_SIZES` so they can be tuned without redeploying.

### D4 — Cost caps per deliverable

**Decision: soft warning at $0.50, hard cap at $2.00.**

`batchFillWithClaude` accumulates `totalCost` as it issues calls. When `totalCost > 0.50`, emit `console.warn("[deliverableEngine] cost soft cap exceeded: $X.XX")` to Convex logs. When `totalCost > 2.00`, abort the remaining chunks, throw a `CostCapExceededError`, and let the action save the partial result via the D1 path (rejected + unfilled keys + cost note).

Both thresholds are exported constants for easy tuning.

### D5 — Auto-trigger audit after generation

**Decision: auto-queue `auditDeliverable` via `ctx.scheduler.runAfter(5000, ...)` at the end of `generateDeliverable`.**

Every generated deliverable gets audited within 5s. This guarantees operator/UI sees a current audit status without waiting for a manual trigger. Adds ~$0.10 of Claude cost per entregable (the audit call still does 1 Claude request — out of scope to also batch-cache that one in this PR, but worth a follow-up).

If `getAnthropicClient()` returns null (no API key), the scheduled audit is skipped (the audit action already handles that — returns approved-by-default with a note).

---

## Migration / rollout

This is a behavior-changing refactor of the most-used action in the deliverables module. Sequencing matters.

1. **PR 1 — Add the three lib files** (`placeholders.ts`, `staticResolver.ts`, `aiBatchFill.ts`) with full unit tests. No call sites changed. Mergeable on its own.
2. **PR 2 — Refactor `generateDeliverable`** to use the new libs. Update affected tests in `convex/functions/deliverables/__tests__/`. Run `gitnexus_impact` first.
3. **PR 3 (optional) — Apply prompt caching to `auditDeliverable` and `regenerateDeliverable`.** Same module; separate PR keeps diff size readable.
4. **Post-merge sanity check:** run the standalone script against a fresh Katimi (or any seeded client) — confirm the script's PDFs visually match what the platform now produces.

## Testing strategy

### Unit tests (per lib file)

- `placeholders.test.ts`: extracts duplicates correctly, ignores nested braces, handles empty HTML.
- `staticResolver.test.ts`: every documented alias resolves; unknown keys return `null`; null orgBranding still produces defaults.
- `aiBatchFill.test.ts`: mock Anthropic SDK; verify chunking, retry on truncation, credit-exhausted bail-out, JSON parse fallbacks.

### Integration test

`convex/functions/deliverables/__tests__/generateDeliverable.test.ts` (new or extend existing):

- Seed a test org + client + projection + projService + assignment + a template with mixed static/AI placeholders (use one of the six prod templates as fixture).
- Mock Claude API responses for the AI chunks (deterministic JSON).
- Assert the saved deliverable's `longContent` has 0 placeholders remaining (`!/{{\w+}}/.test(content)`).

### Manual / regression

- Run `node scripts/generate-demo-deliverables.mjs` and compare its output PDFs (the reference set in `~/Desktop/projex-deliverables-demo-2026-05-13/`) byte-for-byte against the platform's output for the same client.
- Inspect `aiLog` entries on the saved deliverable: `inputTokens` should drop sharply across chunks of the same entregable (caching evidence).

## Impact analysis (to run before implementation)

Per CLAUDE.md, GitNexus impact analysis is required before editing any symbol. Pre-implementation TODO:

```bash
gitnexus_impact({target: "generateDeliverable", direction: "upstream"})
gitnexus_impact({target: "resolveNonAiVariables", direction: "upstream"})
gitnexus_context({name: "generateDeliverable"})
```

Expected callers of `generateDeliverable`: cron-driven monthly assignment runner, the deliverable detail page's "regenerate" button, the audit-driven `regenerateDeliverable` retry. Confirm before merging PR 2.

## Cost model after refactor

For the Katimi reference scenario (6 templates, 1697 total placeholders, ~80% AI):

| Mode | Calls | Cost | Latency |
|---|---|---|---|
| Production today (1:1) | ~1300 | ~$32 | ~30 min |
| Reference script (script-as-is) | 12 | $2.00 | ~6 min |
| Reference script (with caching, as shipped) | 12 | $0.66 | ~6 min |
| Refactored platform engine (60/25/10 chunks) | ~15 | $0.80 | ~7 min |

Numbers from actual runs in the demo session 2026-05-13.

---

## Appendix — Files touched

```
convex/lib/deliverableEngine/                              [new dir]
  placeholders.ts                                          [new, ~15 lines]
  staticResolver.ts                                        [new, ~120 lines]
  aiBatchFill.ts                                           [new, ~180 lines]
  __tests__/
    placeholders.test.ts                                   [new]
    staticResolver.test.ts                                 [new]
    aiBatchFill.test.ts                                    [new]

convex/functions/deliverables/actions.ts                   [modify, -100 +50 lines]
  - delete: resolveNonAiVariables (lines 49-89)
  - modify: generateDeliverable handler (lines 156-332)
  - keep:   getAnthropicClient, callClaudeWithRetry (still used by audit)
  - keep:   auditDeliverable, regenerateDeliverable (out of scope for this PR)

convex/functions/deliverables/__tests__/
  (new) generateDeliverable.refactor.test.ts               [new integration test]
```

## Appendix — Reference script artifacts (already in repo)

- `scripts/generate-demo-deliverables.mjs` — reference implementation
- `scripts/.demo-data/katimi-context.json` — frozen dev DB dump for Katimi
- `scripts/.demo-data/templates.json` — frozen dev DB dump for `deliverableTemplates`
- `convex/functions/devtools/dumpDemoContext.ts` — internal query that produces the context dump

These can stay in the repo as living references. Delete after the refactored engine has been verified against them, or keep as ongoing fixtures for regression testing.
