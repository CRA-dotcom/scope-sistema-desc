# Deliverable Engine Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing `generateDeliverable` action's variable-fill pipeline with a batched, prompt-cached engine that produces equivalent output to `scripts/generate-demo-deliverables.mjs` at ≥98% fill rate and ~95% cost reduction vs the current 1-call-per-AI-var pattern.

**Architecture:** Extract three pure-TS modules under `convex/lib/deliverableEngine/` (placeholders, staticResolver, aiBatchFill) with their own unit tests; refactor `convex/functions/deliverables/actions.ts:generateDeliverable` to orchestrate them; auto-queue `auditDeliverable` post-generation via `ctx.scheduler.runAfter(5000, ...)`. Same Convex/Node runtime, no schema changes.

**Tech Stack:** Convex (Node action), TypeScript, `@anthropic-ai/sdk` v0.x, Vitest (`environment: "edge-runtime"`).

**Spec:** `docs/superpowers/specs/2026-05-14-deliverable-engine-refactor-design.md` (5 design decisions D1-D5 locked 2026-05-14).

**Reference impl:** `scripts/generate-demo-deliverables.mjs` (the standalone script that produced the 6 Katimi demo PDFs at $2 total — port its logic to the production engine).

---

## PR Sequencing

| PR | Tasks | Outcome |
|---|---|---|
| **PR 1** | Tasks 1–4 | Three new lib modules in `convex/lib/deliverableEngine/` with unit tests. No call-site changes. Mergeable on its own. |
| **PR 2** | Tasks 5–10 | Refactor `generateDeliverable` to use the libs, extend `saveGenerated` mutation for `unfilledKeys`, wire auto-audit, integration test. |
| **PR 3** *(optional, post-launch)* | Task 11 | Apply prompt caching to `auditDeliverable` and `regenerateDeliverable`. Out of scope here — placeholder task only. |

**STOP after PR 1.** Do not start PR 2 until Christian validates PR 1 is mergeable.

---

## File Structure

**PR 1 — new files only:**

```
convex/lib/deliverableEngine/
  placeholders.ts          [~25 lines] — extract {{key}} placeholders from HTML
  staticResolver.ts        [~140 lines] — map known keys → client/projection/branding fields
  aiBatchFill.ts           [~250 lines] — batched Claude calls + prompt caching + retries + cost caps
  errors.ts                [~25 lines] — CreditExhaustedError, CostCapExceededError
  __tests__/
    placeholders.test.ts
    staticResolver.test.ts
    aiBatchFill.test.ts
```

**PR 2 — modify existing files:**

```
convex/functions/deliverables/actions.ts        [delete resolveNonAiVariables; rewrite generateDeliverable handler]
convex/functions/deliverables/mutations.ts      [extend saveGenerated args: unfilledKeys, auditStatus, auditFeedback]
convex/functions/deliverables/__tests__/
  generateDeliverable.refactor.test.ts          [new integration test]
```

---

# PR 1 — Library modules (Tasks 1–4)

## Task 1: `placeholders.ts` — extract `{{key}}` from HTML

**Files:**
- Create: `convex/lib/deliverableEngine/placeholders.ts`
- Test: `convex/lib/deliverableEngine/__tests__/placeholders.test.ts`

**Goal:** Pure function that scans an HTML string and returns the unique set of placeholder keys (the part inside `{{...}}`). Replaces dependency on `template.variables` (which is stale relative to HTML — see spec Issue 2).

- [ ] **Step 1: Write the failing test**

Create `convex/lib/deliverableEngine/__tests__/placeholders.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractPlaceholders } from "../placeholders";

describe("extractPlaceholders", () => {
  it("returns empty array for HTML with no placeholders", () => {
    expect(extractPlaceholders("<p>hola</p>")).toEqual([]);
  });

  it("extracts a single placeholder", () => {
    expect(extractPlaceholders("<p>{{client_name}}</p>")).toEqual(["client_name"]);
  });

  it("dedupes repeated placeholders", () => {
    const html = "<p>{{client_name}}</p><span>{{client_name}}</span>";
    expect(extractPlaceholders(html)).toEqual(["client_name"]);
  });

  it("preserves first-seen order across distinct keys", () => {
    const html = "{{a}} {{b}} {{a}} {{c}}";
    expect(extractPlaceholders(html)).toEqual(["a", "b", "c"]);
  });

  it("ignores malformed placeholders (single brace, missing close)", () => {
    const html = "{client_name} {{missing_close {{ok}}";
    expect(extractPlaceholders(html)).toEqual(["ok"]);
  });

  it("only matches alphanumeric + underscore key pattern", () => {
    const html = "{{ai_score_1}} {{has-dash}} {{has space}} {{valid_key_99}}";
    expect(extractPlaceholders(html)).toEqual(["ai_score_1", "valid_key_99"]);
  });

  it("handles empty HTML", () => {
    expect(extractPlaceholders("")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run convex/lib/deliverableEngine/__tests__/placeholders.test.ts
```

Expected: FAIL with "Cannot find module '../placeholders'".

- [ ] **Step 3: Write minimal implementation**

Create `convex/lib/deliverableEngine/placeholders.ts`:

```ts
const PLACEHOLDER_RE = /\{\{([a-zA-Z0-9_]+)\}\}/g;

/**
 * Extract unique placeholder keys (`{{key}}`) from an HTML string,
 * preserving first-seen order. Source of truth for which placeholders
 * a template actually contains — used instead of the stale
 * `template.variables` array.
 */
export function extractPlaceholders(html: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  // Reset lastIndex defensively in case the module-level regex is reused.
  PLACEHOLDER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PLACEHOLDER_RE.exec(html)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      out.push(m[1]);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run convex/lib/deliverableEngine/__tests__/placeholders.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add convex/lib/deliverableEngine/placeholders.ts \
        convex/lib/deliverableEngine/__tests__/placeholders.test.ts
git commit -m "$(cat <<'EOF'
feat(deliverable-engine): extractPlaceholders helper

Pure HTML scan that returns deduped {{key}} placeholders in
first-seen order. Replaces reliance on template.variables which
drifts from the HTML over time.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `staticResolver.ts` — map known keys to client/projection/branding fields

**Files:**
- Create: `convex/lib/deliverableEngine/staticResolver.ts`
- Test: `convex/lib/deliverableEngine/__tests__/staticResolver.test.ts`

**Goal:** Switch-statement that resolves "static" placeholders (everything that can be filled from DB rows without an LLM call) to formatted strings. Returns `null` for unknown keys (caller treats `null` as "needs AI fill"). Ports the `resolveStatic` from `scripts/generate-demo-deliverables.mjs:78` verbatim, with formatting helpers inlined.

Source-of-truth for field names: `convex/schema.ts` (clients lines 24-44, projections 46-102, projectionServices 168-180, orgBranding 392-404).

- [ ] **Step 1: Write the failing test**

Create `convex/lib/deliverableEngine/__tests__/staticResolver.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveStatic, type StaticResolutionContext } from "../staticResolver";

const baseCtx: StaticResolutionContext = {
  client: {
    name: "Katimi SA de CV",
    rfc: "KAT240115ABC",
    industry: "Manufactura",
    annualRevenue: 31_200_000,
    billingFrequency: "mensual",
    contactName: "Ana Pérez",
    contactEmail: "ana@katimi.mx",
  },
  projection: {
    year: 2026,
    annualSales: 31_200_000,
    totalBudget: 4_500_000,
    effectiveBudget: 4_200_000,
  },
  projService: {
    serviceName: "Marketing",
    chosenPct: 0.18,
    annualAmount: 0, // forces synthetic fallback
  },
  orgBranding: {
    companyName: "Projex",
    primaryColor: "#1a1a2e",
    secondaryColor: "#6c63ff",
    accentColor: "#22c55e",
    fontFamily: "'IBM Plex Sans', sans-serif",
    footerText: "Confidential",
  },
  today: "14 de mayo de 2026",
};

describe("resolveStatic — client fields", () => {
  it("client_name / company_name / company_legal_name → client.name", () => {
    expect(resolveStatic("client_name", baseCtx)).toBe("Katimi SA de CV");
    expect(resolveStatic("company_name", baseCtx)).toBe("Katimi SA de CV");
    expect(resolveStatic("company_legal_name", baseCtx)).toBe("Katimi SA de CV");
  });

  it("client_industry / company_industry → client.industry", () => {
    expect(resolveStatic("client_industry", baseCtx)).toBe("Manufactura");
    expect(resolveStatic("company_industry", baseCtx)).toBe("Manufactura");
  });

  it("client_rfc / company_rfc / manual_client_rfc → client.rfc", () => {
    expect(resolveStatic("client_rfc", baseCtx)).toBe("KAT240115ABC");
    expect(resolveStatic("company_rfc", baseCtx)).toBe("KAT240115ABC");
    expect(resolveStatic("manual_client_rfc", baseCtx)).toBe("KAT240115ABC");
  });

  it("client_revenue / client_annual_revenue / company_annual_revenue → fmtMoney(client.annualRevenue)", () => {
    expect(resolveStatic("client_annual_revenue", baseCtx)).toBe("$31,200,000 MXN");
  });

  it("client_billing_frequency defaults to 'mensual' when missing", () => {
    const ctx = { ...baseCtx, client: { ...baseCtx.client, billingFrequency: undefined as any } };
    expect(resolveStatic("client_billing_frequency", ctx)).toBe("mensual");
  });

  it("client_contact_name returns empty string when missing", () => {
    const ctx = { ...baseCtx, client: { ...baseCtx.client, contactName: undefined } };
    expect(resolveStatic("client_contact_name", ctx)).toBe("");
  });
});

describe("resolveStatic — projection fields", () => {
  it("projection_year / fiscal_year → String(projection.year)", () => {
    expect(resolveStatic("projection_year", baseCtx)).toBe("2026");
    expect(resolveStatic("fiscal_year", baseCtx)).toBe("2026");
  });

  it("projection_annual_sales → fmtMoney(projection.annualSales)", () => {
    expect(resolveStatic("projection_annual_sales", baseCtx)).toBe("$31,200,000 MXN");
  });

  it("projection_total_budget → fmtMoney(projection.totalBudget)", () => {
    expect(resolveStatic("projection_total_budget", baseCtx)).toBe("$4,500,000 MXN");
  });

  it("returns empty string for projection-bound keys when projection is null", () => {
    const ctx = { ...baseCtx, projection: null };
    expect(resolveStatic("projection_year", ctx)).toBe("");
    expect(resolveStatic("projection_annual_sales", ctx)).toBe("");
  });
});

describe("resolveStatic — projService fields (with synthetic annualAmount fallback)", () => {
  it("service_name → projService.serviceName", () => {
    expect(resolveStatic("service_name", baseCtx)).toBe("Marketing");
  });

  it("service_chosen_pct → fmtPct (e.g. 0.18 → '18.00%')", () => {
    expect(resolveStatic("service_chosen_pct", baseCtx)).toBe("18.00%");
  });

  it("service_annual_amount uses chosenPct × effectiveBudget when annualAmount=0", () => {
    // 0.18 × 4_200_000 = 756_000
    expect(resolveStatic("service_annual_amount", baseCtx)).toBe("$756,000 MXN");
  });

  it("service_annual_amount uses annualAmount directly when > 0", () => {
    const ctx = { ...baseCtx, projService: { ...baseCtx.projService, annualAmount: 999_000 } };
    expect(resolveStatic("service_annual_amount", ctx)).toBe("$999,000 MXN");
  });

  it("returns empty string for service-bound keys when projService is null", () => {
    const ctx = { ...baseCtx, projService: null };
    expect(resolveStatic("service_name", ctx)).toBe("");
    expect(resolveStatic("service_chosen_pct", ctx)).toBe("");
    expect(resolveStatic("service_annual_amount", ctx)).toBe("");
  });
});

describe("resolveStatic — branding fields", () => {
  it("branding_company_name → orgBranding.companyName", () => {
    expect(resolveStatic("branding_company_name", baseCtx)).toBe("Projex");
  });

  it("branding_primary_color / secondary / accent / font_family → respective fields", () => {
    expect(resolveStatic("branding_primary_color", baseCtx)).toBe("#1a1a2e");
    expect(resolveStatic("branding_secondary_color", baseCtx)).toBe("#6c63ff");
    expect(resolveStatic("branding_accent_color", baseCtx)).toBe("#22c55e");
    expect(resolveStatic("branding_font_family", baseCtx)).toBe("'IBM Plex Sans', sans-serif");
  });

  it("branding_footer_text → orgBranding.footerText (or empty when missing)", () => {
    expect(resolveStatic("branding_footer_text", baseCtx)).toBe("Confidential");
    const ctx = { ...baseCtx, orgBranding: { ...baseCtx.orgBranding!, footerText: undefined } };
    expect(resolveStatic("branding_footer_text", ctx)).toBe("");
  });

  it("branding_* falls back to defaults when orgBranding is null", () => {
    const ctx = { ...baseCtx, orgBranding: null };
    expect(resolveStatic("branding_company_name", ctx)).toBe("Projex");
    expect(resolveStatic("branding_primary_color", ctx)).toBe("#1a1a2e");
    expect(resolveStatic("branding_secondary_color", ctx)).toBe("#6c63ff");
    expect(resolveStatic("branding_accent_color", ctx)).toBe("#22c55e");
    expect(resolveStatic("branding_font_family", ctx)).toBe("'IBM Plex Sans', sans-serif");
    expect(resolveStatic("branding_footer_text", ctx)).toBe("");
  });
});

describe("resolveStatic — date fields", () => {
  it("current_date / fecha → ctx.today", () => {
    expect(resolveStatic("current_date", baseCtx)).toBe("14 de mayo de 2026");
    expect(resolveStatic("fecha", baseCtx)).toBe("14 de mayo de 2026");
  });
});

describe("resolveStatic — unknown keys", () => {
  it("returns null for any key not in the alias table", () => {
    expect(resolveStatic("ai_score_1", baseCtx)).toBeNull();
    expect(resolveStatic("totally_made_up_key", baseCtx)).toBeNull();
    expect(resolveStatic("ai_finding_a1", baseCtx)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run convex/lib/deliverableEngine/__tests__/staticResolver.test.ts
```

Expected: FAIL with "Cannot find module '../staticResolver'".

- [ ] **Step 3: Write the implementation**

Create `convex/lib/deliverableEngine/staticResolver.ts`:

```ts
/**
 * Pure resolver for "static" template placeholders — i.e. anything that can
 * be filled from a DB row without invoking an LLM.
 *
 * Design contract:
 *   - resolveStatic(key, ctx) returns a formatted string for known keys
 *   - returns null for any key that isn't in the alias table (caller routes
 *     it through batchFillWithClaude instead)
 *
 * Field sources:
 *   client    → convex/schema.ts:clients (24-44)
 *   projection → convex/schema.ts:projections (46-102)
 *   projService → convex/schema.ts:projectionServices (168-180)
 *   orgBranding → convex/schema.ts:orgBranding (392-404)
 */

export type ClientFields = {
  name: string;
  rfc: string;
  industry: string;
  annualRevenue: number;
  billingFrequency?: string;
  contactName?: string;
  contactEmail?: string;
};

export type ProjectionFields = {
  year: number;
  annualSales: number;
  totalBudget: number;
  effectiveBudget?: number;
};

export type ProjServiceFields = {
  serviceName: string;
  chosenPct: number;
  annualAmount: number;
};

export type OrgBrandingFields = {
  companyName: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor?: string;
  fontFamily: string;
  footerText?: string;
};

export type StaticResolutionContext = {
  client: ClientFields;
  projection: ProjectionFields | null;
  projService: ProjServiceFields | null;
  orgBranding: OrgBrandingFields | null;
  today: string;
};

const BRANDING_DEFAULTS = {
  companyName: "Projex",
  primaryColor: "#1a1a2e",
  secondaryColor: "#6c63ff",
  accentColor: "#22c55e",
  fontFamily: "'IBM Plex Sans', sans-serif",
  footerText: "",
};

function fmtMoney(n: number): string {
  return `$${Number(n).toLocaleString("es-MX", { maximumFractionDigits: 0 })} MXN`;
}

function fmtPct(p: number): string {
  return `${(p * 100).toFixed(2)}%`;
}

function brandingValue(
  field: keyof typeof BRANDING_DEFAULTS,
  branding: OrgBrandingFields | null
): string {
  if (!branding) return BRANDING_DEFAULTS[field];
  const raw = (branding as Record<string, unknown>)[field];
  if (raw === undefined || raw === null || raw === "") return BRANDING_DEFAULTS[field];
  return String(raw);
}

export function resolveStatic(key: string, ctx: StaticResolutionContext): string | null {
  const { client, projection, projService, orgBranding, today } = ctx;

  switch (key) {
    // Client identity
    case "client_name":
    case "company_name":
    case "company_legal_name":
      return client.name;
    case "client_industry":
    case "company_industry":
      return client.industry;
    case "client_rfc":
    case "company_rfc":
    case "manual_client_rfc":
      return client.rfc;
    case "client_billing_frequency":
    case "company_billing_frequency":
      return client.billingFrequency ?? "mensual";
    case "client_revenue":
    case "client_annual_revenue":
    case "company_annual_revenue":
      return fmtMoney(client.annualRevenue);
    case "client_contact_name":
      return client.contactName ?? "";
    case "client_contact_email":
      return client.contactEmail ?? "";

    // Projection
    case "projection_year":
    case "fiscal_year":
      return projection ? String(projection.year) : "";
    case "projection_annual_sales":
      return projection ? fmtMoney(projection.annualSales) : "";
    case "projection_total_budget":
      return projection ? fmtMoney(projection.totalBudget) : "";

    // Service
    case "service_name":
      return projService?.serviceName ?? "";
    case "service_chosen_pct":
      return projService ? fmtPct(projService.chosenPct ?? 0) : "";
    case "service_annual_amount": {
      if (!projService) return "";
      const synthetic = Math.round(
        (projService.chosenPct ?? 0) *
          (projection?.effectiveBudget ?? projection?.totalBudget ?? 0)
      );
      const amount = projService.annualAmount > 0 ? projService.annualAmount : synthetic;
      return fmtMoney(amount);
    }

    // Branding
    case "branding_company_name":
      return brandingValue("companyName", orgBranding);
    case "branding_primary_color":
      return brandingValue("primaryColor", orgBranding);
    case "branding_secondary_color":
      return brandingValue("secondaryColor", orgBranding);
    case "branding_accent_color":
      return brandingValue("accentColor", orgBranding);
    case "branding_font_family":
      return brandingValue("fontFamily", orgBranding);
    case "branding_footer_text":
      return brandingValue("footerText", orgBranding);

    // Date
    case "current_date":
    case "fecha":
      return today;

    default:
      return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run convex/lib/deliverableEngine/__tests__/staticResolver.test.ts
```

Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add convex/lib/deliverableEngine/staticResolver.ts \
        convex/lib/deliverableEngine/__tests__/staticResolver.test.ts
git commit -m "$(cat <<'EOF'
feat(deliverable-engine): resolveStatic + StaticResolutionContext

Maps the ~30 known placeholder keys (client_*, projection_*,
projService.*, branding_*, current_date/fecha) to their formatted
DB values. Returns null for unknown keys so the caller can route
them through the AI batch filler. Branding defaults applied when
orgBranding is null. Service annualAmount falls back to
chosenPct × effectiveBudget when stored amount is 0.

Ports scripts/generate-demo-deliverables.mjs:resolveStatic verbatim
into the production engine.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `errors.ts` — sentinel error classes

**Files:**
- Create: `convex/lib/deliverableEngine/errors.ts`

**Goal:** Two sentinel errors that `aiBatchFill` throws and the action handler catches separately. Tiny module — no dedicated test file (covered indirectly by aiBatchFill tests).

- [ ] **Step 1: Write the implementation**

Create `convex/lib/deliverableEngine/errors.ts`:

```ts
/**
 * Anthropic returned credit_balance_too_low. Stop issuing further calls
 * — caller should save partial results and surface a credit-out warning.
 */
export class CreditExhaustedError extends Error {
  readonly code = "CREDIT_EXHAUSTED" as const;
  constructor(message = "Anthropic credit balance exhausted") {
    super(message);
    this.name = "CreditExhaustedError";
  }
}

/**
 * Hard cost cap (D4: $2.00 per deliverable) tripped mid-run. Caller saves
 * whatever was already filled and marks the deliverable rejected with the
 * unfilled keys so an operator can decide to retry or hand-edit.
 */
export class CostCapExceededError extends Error {
  readonly code = "COST_CAP_EXCEEDED" as const;
  readonly costUsd: number;
  constructor(costUsd: number) {
    super(`Per-deliverable cost cap exceeded: $${costUsd.toFixed(4)}`);
    this.name = "CostCapExceededError";
    this.costUsd = costUsd;
  }
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "deliverableEngine|errors\.ts" || echo "no errors module errors"
```

Expected: `no errors module errors` (or no output).

- [ ] **Step 3: Commit**

```bash
git add convex/lib/deliverableEngine/errors.ts
git commit -m "$(cat <<'EOF'
feat(deliverable-engine): sentinel errors for credit + cost cap

CreditExhaustedError → caller bails out and saves partial.
CostCapExceededError → D4 hard cap tripped, save partial + reject.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `aiBatchFill.ts` — batched Claude calls + caching + retries + cost caps

**Files:**
- Create: `convex/lib/deliverableEngine/aiBatchFill.ts`
- Test: `convex/lib/deliverableEngine/__tests__/aiBatchFill.test.ts`

**Goal:** The heart of the refactor. Batches a list of placeholder keys into chunks of 60 (D3), issues one Claude call per chunk asking for a single JSON object that maps every key to a value. Marks the questionnaire context block with `cache_control: ephemeral` so subsequent chunks read from cache (~10% input cost). Tracks cumulative cost, warns at $0.50, throws `CostCapExceededError` at $2.00. Retries any keys missing from the parsed JSON in chunks of 25, then 10. Bails out via `CreditExhaustedError` on `credit_balance_too_low`.

**Design notes:**
- The `Anthropic` client is dependency-injected in the function signature so tests can pass a mock with a `messages.create: vi.fn()` returning canned responses. No reliance on global state.
- Cost computation is per-call and cumulative. Emits `console.warn` once when soft cap is crossed (not every call after).
- Returns a `BatchFillResult` containing the resolved map, list of unfilled keys, AI log entries (matching the existing `aiLog` schema in `convex/schema.ts:348-358`), and total cost.
- `parseJsonResponse` mirrors the script: try direct JSON.parse → try fenced block → try last `{...}` slice. Returns `{}` on failure (those keys end up unfilled and get retried at smaller sizes).

- [ ] **Step 1: Write the failing tests**

Create `convex/lib/deliverableEngine/__tests__/aiBatchFill.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  batchFillWithClaude,
  DEFAULT_CHUNK_SIZE,
  RETRY_CHUNK_SIZES,
  COST_SOFT_CAP_USD,
  COST_HARD_CAP_USD,
} from "../aiBatchFill";
import { CreditExhaustedError, CostCapExceededError } from "../errors";

// Test helper — build a mocked Anthropic-like client whose .messages.create
// returns a canned response per call (round-robin).
function mockAnthropic(responses: Array<{
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheRead?: number;
  cacheCreate?: number;
} | Error>): { messages: { create: ReturnType<typeof vi.fn> } } {
  let i = 0;
  const create = vi.fn(async () => {
    const r = responses[i++];
    if (r instanceof Error) throw r;
    return {
      content: [{ type: "text", text: r.text }],
      usage: {
        input_tokens: r.inputTokens ?? 100,
        output_tokens: r.outputTokens ?? 50,
        cache_read_input_tokens: r.cacheRead ?? 0,
        cache_creation_input_tokens: r.cacheCreate ?? 0,
      },
    };
  });
  return { messages: { create } } as never;
}

describe("batchFillWithClaude — chunking", () => {
  it("issues one call per chunk of DEFAULT_CHUNK_SIZE keys", async () => {
    expect(DEFAULT_CHUNK_SIZE).toBe(60);
    const keys = Array.from({ length: 130 }, (_, i) => `ai_key_${i}`);
    const responses = [
      { text: JSON.stringify(Object.fromEntries(keys.slice(0, 60).map((k) => [k, "v"]))) },
      { text: JSON.stringify(Object.fromEntries(keys.slice(60, 120).map((k) => [k, "v"]))) },
      { text: JSON.stringify(Object.fromEntries(keys.slice(120).map((k) => [k, "v"]))) },
    ];
    const anthropic = mockAnthropic(responses);
    const result = await batchFillWithClaude(anthropic as never, "Marketing", "ctx", keys);
    expect(anthropic.messages.create).toHaveBeenCalledTimes(3);
    expect(Object.keys(result.resolved)).toHaveLength(130);
    expect(result.unfilled).toHaveLength(0);
  });

  it("returns immediately with empty result when keys is empty", async () => {
    const anthropic = mockAnthropic([]);
    const result = await batchFillWithClaude(anthropic as never, "Marketing", "ctx", []);
    expect(anthropic.messages.create).not.toHaveBeenCalled();
    expect(result.resolved).toEqual({});
    expect(result.unfilled).toEqual([]);
    expect(result.totalCost).toBe(0);
  });
});

describe("batchFillWithClaude — caching + cost", () => {
  it("marks the context block with cache_control: ephemeral on every call", async () => {
    const anthropic = mockAnthropic([
      { text: '{"ai_a":"x"}' },
    ]);
    await batchFillWithClaude(anthropic as never, "Marketing", "CONTEXT_BLOCK", ["ai_a"]);
    const call = anthropic.messages.create.mock.calls[0][0];
    const cacheableBlock = call.messages[0].content.find(
      (b: any) => b.cache_control?.type === "ephemeral"
    );
    expect(cacheableBlock).toBeDefined();
    expect(cacheableBlock.text).toContain("CONTEXT_BLOCK");
  });

  it("computes cost using cache_read at $0.30/M and cache_creation at $3.75/M", async () => {
    const anthropic = mockAnthropic([
      { text: '{"a":"x"}', inputTokens: 1000, outputTokens: 100, cacheCreate: 5000, cacheRead: 0 },
      { text: '{"b":"y"}', inputTokens: 200,  outputTokens: 100, cacheCreate: 0,    cacheRead: 5000 },
    ]);
    const keys = ["a", "b"];
    // Force two chunks by passing chunkSize 1
    const result = await batchFillWithClaude(
      anthropic as never, "Marketing", "ctx", keys, { chunkSize: 1 }
    );
    // Call 1: 1000 * 3/M + 5000 * 3.75/M + 100 * 15/M = 0.003 + 0.01875 + 0.0015 = 0.02325
    // Call 2: 200  * 3/M + 5000 * 0.30/M + 100 * 15/M = 0.0006 + 0.0015 + 0.0015 = 0.0036
    expect(result.totalCost).toBeCloseTo(0.02685, 5);
  });

  it("emits a console.warn exactly once when soft cap ($0.50) is crossed", async () => {
    expect(COST_SOFT_CAP_USD).toBe(0.50);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Each call costs ~$0.30 (use big input tokens). 2 calls → $0.60 → cross soft cap
    const big = { inputTokens: 100_000, outputTokens: 0 }; // 100_000 * 3e-6 = $0.30
    const anthropic = mockAnthropic([
      { text: '{"a":"x"}', ...big },
      { text: '{"b":"y"}', ...big },
      { text: '{"c":"z"}', ...big },
    ]);
    await batchFillWithClaude(
      anthropic as never, "Marketing", "ctx", ["a", "b", "c"], { chunkSize: 1 }
    );
    const softWarns = warn.mock.calls.filter((c) => String(c[0]).includes("soft cap"));
    expect(softWarns).toHaveLength(1);
    warn.mockRestore();
  });

  it("throws CostCapExceededError when hard cap ($2.00) is crossed", async () => {
    expect(COST_HARD_CAP_USD).toBe(2.00);
    // Each call ~$1.00 → 3rd call would push over $2.00
    const big = { inputTokens: 333_333, outputTokens: 0 };
    const anthropic = mockAnthropic([
      { text: '{"a":"x"}', ...big },
      { text: '{"b":"y"}', ...big },
      { text: '{"c":"z"}', ...big },
    ]);
    await expect(
      batchFillWithClaude(
        anthropic as never, "Marketing", "ctx", ["a", "b", "c"], { chunkSize: 1 }
      )
    ).rejects.toBeInstanceOf(CostCapExceededError);
  });
});

describe("batchFillWithClaude — retries on missing keys", () => {
  it("retries unfilled keys at successively smaller chunk sizes (60, 25, 10)", async () => {
    expect(RETRY_CHUNK_SIZES).toEqual([25, 10]);
    const keys = Array.from({ length: 60 }, (_, i) => `k${i}`);
    // First call returns only first 30 keys (truncated)
    const firstChunk = JSON.stringify(Object.fromEntries(keys.slice(0, 30).map((k) => [k, "v"])));
    // Retry pass 1: 30 missing keys → 2 chunks of size 25 + 5
    const retry1a = JSON.stringify(Object.fromEntries(keys.slice(30, 55).map((k) => [k, "v"])));
    const retry1b = JSON.stringify(Object.fromEntries(keys.slice(55, 60).map((k) => [k, "v"])));
    const anthropic = mockAnthropic([
      { text: firstChunk },
      { text: retry1a },
      { text: retry1b },
    ]);
    const result = await batchFillWithClaude(anthropic as never, "Marketing", "ctx", keys);
    expect(anthropic.messages.create).toHaveBeenCalledTimes(3);
    expect(Object.keys(result.resolved)).toHaveLength(60);
    expect(result.unfilled).toHaveLength(0);
  });

  it("returns unfilled keys after all retry passes exhausted", async () => {
    const keys = ["a", "b", "c"];
    // Every call returns empty JSON → nothing gets filled, all retries fail
    const anthropic = mockAnthropic([
      { text: "{}" }, // first pass
      { text: "{}" }, // retry 25
      { text: "{}" }, // retry 10
    ]);
    const result = await batchFillWithClaude(anthropic as never, "Marketing", "ctx", keys);
    expect(result.unfilled).toEqual(["a", "b", "c"]);
    expect(result.resolved).toEqual({});
  });
});

describe("batchFillWithClaude — JSON parse fallbacks", () => {
  it("parses JSON wrapped in ```json fences", async () => {
    const anthropic = mockAnthropic([
      { text: '```json\n{"a":"x"}\n```' },
    ]);
    const result = await batchFillWithClaude(anthropic as never, "Marketing", "ctx", ["a"]);
    expect(result.resolved).toEqual({ a: "x" });
  });

  it("parses JSON when there is leading/trailing prose", async () => {
    const anthropic = mockAnthropic([
      { text: 'Here is the JSON:\n{"a":"x","b":"y"}\nLet me know if you need more.' },
    ]);
    const result = await batchFillWithClaude(anthropic as never, "Marketing", "ctx", ["a", "b"]);
    expect(result.resolved).toEqual({ a: "x", b: "y" });
  });

  it("returns chunk's keys as unfilled when JSON cannot be parsed", async () => {
    const anthropic = mockAnthropic([
      { text: "totally not json" }, // first pass — fails
      { text: "still not json" },   // retry 25 — fails
      { text: "nope" },             // retry 10 — fails
    ]);
    const result = await batchFillWithClaude(anthropic as never, "Marketing", "ctx", ["a"]);
    expect(result.unfilled).toEqual(["a"]);
  });
});

describe("batchFillWithClaude — credit exhaustion", () => {
  it("throws CreditExhaustedError when Anthropic returns credit_balance_too_low", async () => {
    const err = new Error("Your credit balance is too low to access this model.");
    const anthropic = mockAnthropic([err]);
    await expect(
      batchFillWithClaude(anthropic as never, "Marketing", "ctx", ["a"])
    ).rejects.toBeInstanceOf(CreditExhaustedError);
  });
});

describe("batchFillWithClaude — log shape", () => {
  it("returns one AiLogEntry per Claude call with role='generate' and the model id", async () => {
    const anthropic = mockAnthropic([
      { text: '{"a":"x"}', inputTokens: 100, outputTokens: 50 },
      { text: '{"b":"y"}', inputTokens: 100, outputTokens: 50 },
    ]);
    const result = await batchFillWithClaude(
      anthropic as never, "Marketing", "ctx", ["a", "b"], { chunkSize: 1 }
    );
    expect(result.log).toHaveLength(2);
    expect(result.log[0]).toMatchObject({
      role: "generate",
      model: expect.stringContaining("claude"),
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
      costUsd: expect.any(Number),
      timestamp: expect.any(Number),
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run convex/lib/deliverableEngine/__tests__/aiBatchFill.test.ts
```

Expected: FAIL with "Cannot find module '../aiBatchFill'".

- [ ] **Step 3: Write the implementation**

Create `convex/lib/deliverableEngine/aiBatchFill.ts`:

```ts
import type Anthropic from "@anthropic-ai/sdk";
import { CreditExhaustedError, CostCapExceededError } from "./errors";

// ─── Constants ───────────────────────────────────────────────────────

export const MODEL = "claude-sonnet-4-20250514";
export const MAX_OUTPUT_TOKENS = 8192;
export const DEFAULT_CHUNK_SIZE = 60;
export const RETRY_CHUNK_SIZES = [25, 10];
export const COST_SOFT_CAP_USD = 0.50;
export const COST_HARD_CAP_USD = 2.00;

// Claude Sonnet 4 pricing (per 1M tokens)
const INPUT_COST_PER_TOKEN = 3 / 1_000_000;
const OUTPUT_COST_PER_TOKEN = 15 / 1_000_000;
const CACHE_WRITE_COST_PER_TOKEN = 3.75 / 1_000_000; // 1.25× input
const CACHE_READ_COST_PER_TOKEN = 0.30 / 1_000_000;  // 0.10× input

// ─── Types ───────────────────────────────────────────────────────────

export type AiLogEntry = {
  role: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  timestamp: number;
};

export type BatchFillResult = {
  resolved: Record<string, string>;
  unfilled: string[];
  log: AiLogEntry[];
  totalCost: number;
};

export type BatchFillOptions = {
  chunkSize?: number;
  retryChunkSizes?: number[];
  softCapUsd?: number;
  hardCapUsd?: number;
};

// ─── Helpers ─────────────────────────────────────────────────────────

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function describeKey(key: string): string {
  if (/^ai_score/.test(key)) return '"<score 0-100>"';
  if (/_pct$|_percent_?/.test(key)) return '"<XX%>"';
  if (/_amount$|_total$|_investment$|_benefit$|_revenue$|_budget$/.test(key))
    return '"<$X,XXX,XXX MXN>"';
  if (/_year$/.test(key)) return '"<año YYYY>"';
  if (/_period$/.test(key)) return '"<periodo: Q1 2026 — Q4 2026>"';
  if (/_date$/.test(key)) return '"<DD de Mes YYYY>"';
  if (/_name$|_role$|_owner$|_reviewer$|_interviewee_/.test(key))
    return '"<nombre propio latino, 2-4 palabras>"';
  if (/_area$/.test(key)) return '"<área/categoría, 1-3 palabras>"';
  if (/_paragraph_|_summary$|_description$|_observation_|_methodology$|_conclusion_|executive_/.test(key))
    return '"<párrafo profesional, 60-120 palabras, puede usar inline <strong>>"';
  if (/_finding_|_risk_/.test(key)) return '"<hallazgo o riesgo, 1-2 oraciones>"';
  if (/_initiative_|_action$|_result$|_kpi$|_quick_win_|_roi_/.test(key))
    return '"<iniciativa/acción específica, 1-2 oraciones>"';
  return `"<contenido apropiado al label \\"${key}\\" en contexto profesional>"`;
}

function parseJsonResponse(text: string): Record<string, string> {
  try {
    const v = JSON.parse(text);
    if (v && typeof v === "object") return v;
  } catch {
    /* fall through */
  }
  const fence = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fence) {
    try {
      const v = JSON.parse(fence[1]);
      if (v && typeof v === "object") return v;
    } catch {
      /* fall through */
    }
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const v = JSON.parse(text.slice(start, end + 1));
      if (v && typeof v === "object") return v;
    } catch {
      /* fall through */
    }
  }
  return {};
}

// ─── Single-chunk Claude call ────────────────────────────────────────

type ChunkCallResult = {
  parsed: Record<string, string>;
  log: AiLogEntry;
};

async function callChunk(
  anthropic: Anthropic,
  area: string,
  contextBlock: string,
  keys: string[]
): Promise<ChunkCallResult> {
  const keyHints = keys.map((k) => `"${k}": ${describeKey(k)}`).join(",\n  ");

  const systemPrompt = `Eres un consultor profesional senior de ${area}. Generas contenido para entregables empresariales de alta calidad. Respondes ÚNICAMENTE con JSON válido, sin markdown, sin backticks, sin explicaciones.`;

  const cacheablePrompt = `Estoy generando un entregable profesional para el cliente. Te paso el contexto completo del cliente y respuestas del cuestionario.

${contextBlock}

REGLAS PARA TODOS LOS CAMPOS A LLENAR:
- Para campos de texto/descripción: usa español profesional. Puedes usar inline HTML (<strong>, <em>) pero NO uses <p>, <div>, <ul> ya que el template ya tiene la estructura.
- Para scores: número entero entre 0-100.
- Para porcentajes: formato "XX%" o "XX.X%".
- Para montos: formato "$X,XXX,XXX MXN".
- Para fechas: formato "DD de Mes YYYY" en español.
- Para nombres propios (responsables, firmantes): inventa nombres latinos plausibles.
- Sé consistente entre campos relacionados (ej. si hay ai_roi_total_* debe ser la suma de ai_roi_*_1, _2, etc.).
- Si un campo tiene un sufijo numérico (_1, _2, etc.), trátalo como serie y mantén progresión lógica.
- Mantén tono ejecutivo y data-driven.`;

  const dynamicPrompt = `LLENA ESTOS CAMPOS (responde con un único objeto JSON válido, sin markdown):
{
  ${keyHints}
}

JSON:`;

  let response: Awaited<ReturnType<Anthropic["messages"]["create"]>>;
  try {
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: [{ type: "text", text: systemPrompt }],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: cacheablePrompt, cache_control: { type: "ephemeral" } },
            { type: "text", text: dynamicPrompt },
          ],
        },
      ],
    } as never);
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    if (msg.includes("credit balance is too low") || msg.includes("CREDIT")) {
      throw new CreditExhaustedError();
    }
    throw err;
  }

  const block = (response as { content: Array<{ type: string; text?: string }> }).content.find(
    (b) => b.type === "text"
  );
  const text = block?.text ?? "";

  const usage = (response as {
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  }).usage;

  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;
  const cacheCreate = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;

  const cost =
    inputTokens * INPUT_COST_PER_TOKEN +
    cacheCreate * CACHE_WRITE_COST_PER_TOKEN +
    cacheRead * CACHE_READ_COST_PER_TOKEN +
    outputTokens * OUTPUT_COST_PER_TOKEN;

  const parsed = parseJsonResponse(text);
  const log: AiLogEntry = {
    role: "generate",
    model: MODEL,
    inputTokens: inputTokens + cacheRead + cacheCreate, // total input incl. cache
    outputTokens,
    costUsd: Math.round(cost * 1_000_000) / 1_000_000,
    timestamp: Date.now(),
  };

  return { parsed, log };
}

// ─── Public entry ────────────────────────────────────────────────────

/**
 * Fill a list of placeholder keys via batched Claude calls.
 *
 * Strategy:
 *  1. Chunk keys into groups of `chunkSize` (default 60).
 *  2. One Claude call per chunk; system+context cached via cache_control: ephemeral.
 *  3. After the first pass, any unfilled keys (truncated JSON, parse fail) get
 *     retried in successively smaller chunks (default [25, 10]).
 *  4. Cumulative cost is tracked. Soft-cap warning at $0.50, hard cap throw at $2.00.
 *  5. CreditExhaustedError bubbles up immediately so the caller can save partial.
 */
export async function batchFillWithClaude(
  anthropic: Anthropic,
  area: string,
  contextBlock: string,
  keys: string[],
  opts: BatchFillOptions = {}
): Promise<BatchFillResult> {
  const chunkSize = opts.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const retrySizes = opts.retryChunkSizes ?? RETRY_CHUNK_SIZES;
  const softCap = opts.softCapUsd ?? COST_SOFT_CAP_USD;
  const hardCap = opts.hardCapUsd ?? COST_HARD_CAP_USD;

  const resolved: Record<string, string> = {};
  const log: AiLogEntry[] = [];
  let totalCost = 0;
  let softWarned = false;

  if (keys.length === 0) {
    return { resolved, unfilled: [], log, totalCost };
  }

  const issueChunk = async (chunk: string[]): Promise<void> => {
    const { parsed, log: entry } = await callChunk(anthropic, area, contextBlock, chunk);
    log.push(entry);
    totalCost += entry.costUsd;
    if (!softWarned && totalCost > softCap) {
      console.warn(
        `[deliverableEngine] cost soft cap exceeded: $${totalCost.toFixed(4)} (cap $${softCap.toFixed(2)})`
      );
      softWarned = true;
    }
    if (totalCost > hardCap) {
      throw new CostCapExceededError(totalCost);
    }
    for (const [k, v] of Object.entries(parsed)) {
      // Only accept keys we asked for, coerce to string
      if (chunk.includes(k)) resolved[k] = String(v ?? "");
    }
  };

  // Pass 0: initial chunks
  for (const chunk of chunkArray(keys, chunkSize)) {
    await issueChunk(chunk);
  }

  // Retry passes: any keys still unfilled, smaller chunks
  for (const size of retrySizes) {
    const missing = keys.filter((k) => !(k in resolved));
    if (missing.length === 0) break;
    for (const chunk of chunkArray(missing, size)) {
      await issueChunk(chunk);
    }
  }

  const unfilled = keys.filter((k) => !(k in resolved));
  return { resolved, unfilled, log, totalCost };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run convex/lib/deliverableEngine/__tests__/aiBatchFill.test.ts
```

Expected: PASS (all describe blocks).

- [ ] **Step 5: Run the full convex/lib test suite to confirm no regressions**

```bash
npx vitest run convex/lib/
```

Expected: PASS (existing seasonality, projectionEngine, etc., still green; 3 new test files added).

- [ ] **Step 6: TypeScript check**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "deliverableEngine" || echo "no engine errors"
```

Expected: `no engine errors`.

- [ ] **Step 7: Commit**

```bash
git add convex/lib/deliverableEngine/aiBatchFill.ts \
        convex/lib/deliverableEngine/__tests__/aiBatchFill.test.ts
git commit -m "$(cat <<'EOF'
feat(deliverable-engine): batchFillWithClaude — caching + retries + cost caps

One Claude call per ≤60-key chunk, cacheable context block via
cache_control: ephemeral. Retry passes at 25 then 10 keys for
anything that didn't come back in the first parse. Cumulative
cost tracked; warns at $0.50 soft cap (D4), throws CostCapExceeded
at $2.00 hard cap. CreditExhausted bubbles up immediately so the
caller can persist partial results.

Closes spec D3 (60/25/10 chunk sizes), D4 (cost caps).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: PR 1 verification before opening PR**

```bash
git log --oneline main..HEAD
git diff --stat main..HEAD
npx vitest run convex/lib/deliverableEngine/
```

Expected:
- 4 commits (Tasks 1, 2, 3, 4)
- ~7 files changed (3 sources, 1 errors, 3 tests)
- All deliverableEngine tests pass

**STOP HERE.** Open PR 1 with title `feat(deliverable-engine): pure libs (placeholders + staticResolver + aiBatchFill)`, request Christian's review, and wait for merge before starting PR 2.

---

# PR 2 — Refactor `generateDeliverable` (Tasks 5–10)

> Do not start this PR until PR 1 is merged into `main`.

## Task 5: Re-run GitNexus impact analysis on updated index

**Goal:** PR 1 merged means the index needs to be re-analyzed. Re-confirm blast radius before editing the action handler.

- [ ] **Step 1: Re-analyze**

```bash
npx gitnexus analyze
```

- [ ] **Step 2: Run impact + context queries on the symbols PR 2 will touch**

```bash
npx gitnexus impact "convex/functions/deliverables/actions.ts" --direction upstream --repo DESC
npx gitnexus context resolveNonAiVariables --repo DESC
grep -rn "api.functions.deliverables.actions.generateDeliverable" src/ convex/ | grep -v __tests__
```

Expected:
- `actions.ts` upstream: only `entregables/[id]/page.tsx` and the `regenerateDeliverable` internal action call site
- `resolveNonAiVariables` upstream: depth 1, only the same file (LOW risk to delete)
- Grep: 1 hit in `src/app/(dashboard)/entregables/[id]/page.tsx:54`

If the grep returns more callers than expected, **STOP and re-scope the plan** — the spec was written assuming a single UI consumer.

---

## Task 6: Extend `saveGenerated` mutation to accept `unfilledKeys`, `auditStatus`, `auditFeedback`

**Files:**
- Modify: `convex/functions/deliverables/mutations.ts:168-198` (`saveGenerated` internal mutation)

**Goal:** Per spec D1, the action needs to save the deliverable with `auditStatus: "rejected"` and an `auditFeedback` JSON containing `unfilledKeys` when any key was left unfilled. The current `saveGenerated` hardcodes `auditStatus: "pending"` and doesn't accept feedback. Extend its args to make both optional with backward-compatible defaults.

- [ ] **Step 1: Modify the args + handler**

Edit `convex/functions/deliverables/mutations.ts`. Replace lines 168-198 (`saveGenerated` mutation) with:

```ts
/**
 * Internal: save a generated deliverable from the AI pipeline.
 *
 * `unfilledKeys` (D1): when non-empty, the deliverable is saved with
 * `auditStatus: "rejected"` and `auditFeedback` set to a JSON string
 * `{"unfilledKeys": [...], "costUsd": N}` so the audit UI can surface
 * the partial-render warning.
 */
export const saveGenerated = internalMutation({
  args: {
    orgId: v.string(),
    assignmentId: v.id("monthlyAssignments"),
    projServiceId: v.id("projectionServices"),
    clientId: v.id("clients"),
    serviceName: v.string(),
    month: v.number(),
    year: v.number(),
    shortContent: v.string(),
    longContent: v.string(),
    aiLog: aiLogValidator,
    unfilledKeys: v.optional(v.array(v.string())),
    costUsd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const unfilledKeys = args.unfilledKeys ?? [];
    const auditStatus =
      unfilledKeys.length > 0 ? ("rejected" as const) : ("pending" as const);
    const auditFeedback =
      unfilledKeys.length > 0
        ? JSON.stringify({
            reason: "incomplete_render",
            unfilledKeys,
            costUsd: args.costUsd ?? null,
          })
        : undefined;

    return await ctx.db.insert("deliverables", {
      orgId: args.orgId,
      assignmentId: args.assignmentId,
      projServiceId: args.projServiceId,
      clientId: args.clientId,
      serviceName: args.serviceName,
      month: args.month,
      year: args.year,
      shortContent: args.shortContent,
      longContent: args.longContent,
      auditStatus,
      auditFeedback,
      retryCount: 0,
      aiLog: args.aiLog,
      createdAt: Date.now(),
    });
  },
});
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "mutations\.ts" || echo "no mutations errors"
```

Expected: `no mutations errors`.

- [ ] **Step 3: Run existing deliverables tests (if any)**

```bash
npx vitest run convex/functions/deliverables/ 2>&1 | tail -20
```

Expected: PASS (or "no test files" — folder may not have tests yet; that's fine).

- [ ] **Step 4: Commit**

```bash
git add convex/functions/deliverables/mutations.ts
git commit -m "$(cat <<'EOF'
feat(deliverables): saveGenerated accepts unfilledKeys + costUsd

When any placeholder key was left unfilled by the AI engine, the
deliverable is persisted with auditStatus='rejected' and
auditFeedback containing the JSON {reason, unfilledKeys, costUsd}.
Backward compatible — both new fields are optional and default to
the prior behavior (status='pending', no feedback).

Implements spec D1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Refactor `generateDeliverable` handler to use the new libs

**Files:**
- Modify: `convex/functions/deliverables/actions.ts:156-332` (`generateDeliverable` handler)
- Modify: `convex/functions/deliverables/actions.ts:48-93` (delete `resolveNonAiVariables`, keep `escapeRegex`)

**Goal:** Replace the current per-AI-var loop with `extractPlaceholders` + `resolveStatic` + `batchFillWithClaude`. Wire D5 auto-audit. Render unfilled keys as visible markers (D1).

- [ ] **Step 1: Add imports at the top of `actions.ts`**

Edit `convex/functions/deliverables/actions.ts` — after the existing imports (line 6), add:

```ts
import { extractPlaceholders } from "../../lib/deliverableEngine/placeholders";
import { resolveStatic, type StaticResolutionContext } from "../../lib/deliverableEngine/staticResolver";
import { batchFillWithClaude } from "../../lib/deliverableEngine/aiBatchFill";
import { CreditExhaustedError, CostCapExceededError } from "../../lib/deliverableEngine/errors";
```

- [ ] **Step 2: Delete `resolveNonAiVariables`**

Remove the function at `convex/functions/deliverables/actions.ts:48-89`. Keep `escapeRegex` (still used by audit).

- [ ] **Step 3: Add a `buildContextBlock` helper above the action**

After the imports and before `// ─── Actions ───────`, add:

```ts
/**
 * Build the cacheable context block sent to Claude per chunk.
 * Mirrors the shape from scripts/generate-demo-deliverables.mjs so output
 * is comparable when validating the refactor against the reference PDFs.
 */
function buildContextBlock(args: {
  client: { name: string; rfc: string; industry: string; annualRevenue: number };
  projection: { year: number; annualSales: number; totalBudget: number; effectiveBudget?: number } | null;
  projService: { serviceName: string; chosenPct: number; annualAmount: number } | null;
  questionnaire: { responses?: Array<{ section?: string; questionText: string; answer: string | unknown }> } | null;
}): string {
  const { client, projection, projService, questionnaire } = args;

  const responses = questionnaire?.responses ?? [];
  const questionnaireText = responses
    .map((r) => {
      const a = typeof r.answer === "string" ? r.answer : JSON.stringify(r.answer);
      return `[${r.section ?? "General"}] ${r.questionText}\n→ ${a}`;
    })
    .join("\n\n");

  const projServiceLine = projService
    ? `${projService.serviceName} — ${(projService.chosenPct * 100).toFixed(2)}% del presupuesto, monto anual $${(projService.annualAmount > 0
        ? projService.annualAmount
        : Math.round((projService.chosenPct ?? 0) * (projection?.effectiveBudget ?? projection?.totalBudget ?? 0))
      ).toLocaleString("es-MX")} MXN`
    : "Servicio no contratado en la proyección actual";

  const projLine = projection
    ? `PROYECCIÓN ${projection.year}: ventas $${projection.annualSales.toLocaleString("es-MX")} MXN, presupuesto total $${projection.totalBudget.toLocaleString("es-MX")} MXN`
    : "PROYECCIÓN: sin datos";

  return `CLIENTE: ${client.name} (${client.industry}, RFC ${client.rfc}, facturación anual $${client.annualRevenue.toLocaleString("es-MX")} MXN)
${projLine}
SERVICIO (${projService?.serviceName ?? "n/a"}): ${projServiceLine}

RESPUESTAS DEL CUESTIONARIO:
${questionnaireText || "Sin respuestas de cuestionario disponibles."}`;
}

function formatToday(): string {
  return new Date().toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}
```

- [ ] **Step 4: Replace the `handler` body of `generateDeliverable`**

Find the existing `handler: async (ctx, args): Promise<string> => {...}` block (currently lines 166-331) and replace it entirely with:

```ts
  handler: async (ctx, args): Promise<string> => {
    // 1. Fetch all required data in parallel
    const [assignment, client, projService] = await Promise.all([
      ctx.runQuery(internal.functions.deliverables.internalQueries.getAssignmentData, {
        assignmentId: args.assignmentId,
      }),
      ctx.runQuery(internal.functions.deliverables.internalQueries.getClientData, {
        clientId: args.clientId,
      }),
      ctx.runQuery(internal.functions.deliverables.internalQueries.getProjServiceData, {
        projServiceId: args.projServiceId,
      }),
    ]);

    if (!assignment) throw new Error("Asignacion no encontrada.");
    if (!client) throw new Error("Cliente no encontrado.");
    if (!projService) throw new Error("Servicio de proyeccion no encontrado.");

    const [projection, questionnaire, orgBranding, template] = await Promise.all([
      ctx.runQuery(
        internal.functions.deliverables.internalQueries.getProjectionByProjService,
        { projectionId: projService.projectionId }
      ),
      ctx.runQuery(
        internal.functions.deliverables.internalQueries.getQuestionnaireForClient,
        { clientId: args.clientId, projectionId: projService.projectionId }
      ),
      ctx.runQuery(
        internal.functions.deliverables.internalQueries.getOrgBranding,
        { orgId: assignment.orgId }
      ),
      ctx.runQuery(
        internal.functions.deliverables.internalQueries.findTemplate,
        {
          serviceName: projService.serviceName,
          type: args.templateType,
          orgId: assignment.orgId,
        }
      ),
    ]);

    const aiLogs: AiLogEntry[] = [];
    let unfilledKeys: string[] = [];
    let totalCost = 0;
    let finalContent: string;

    if (template) {
      // 2. Discover placeholders directly from the HTML (template.variables ignored).
      const placeholders = extractPlaceholders(template.htmlTemplate);

      // 3. Resolve static placeholders, collect AI keys.
      const staticCtx: StaticResolutionContext = {
        client: {
          name: client.name,
          rfc: client.rfc,
          industry: client.industry,
          annualRevenue: client.annualRevenue,
          billingFrequency: client.billingFrequency,
          contactName: client.contactName,
          contactEmail: client.contactEmail,
        },
        projection: projection
          ? {
              year: projection.year,
              annualSales: projection.annualSales,
              totalBudget: projection.totalBudget,
              effectiveBudget: projection.effectiveBudget,
            }
          : null,
        projService: {
          serviceName: projService.serviceName,
          chosenPct: projService.chosenPct,
          annualAmount: projService.annualAmount,
        },
        orgBranding: orgBranding
          ? {
              companyName: orgBranding.companyName,
              primaryColor: orgBranding.primaryColor,
              secondaryColor: orgBranding.secondaryColor,
              accentColor: orgBranding.accentColor,
              fontFamily: orgBranding.fontFamily,
              footerText: orgBranding.footerText,
            }
          : null,
        today: formatToday(),
      };

      const resolved: Record<string, string> = {};
      const needsAi: string[] = [];
      for (const k of placeholders) {
        const v = resolveStatic(k, staticCtx);
        if (v !== null) resolved[k] = v;
        else needsAi.push(k);
      }

      // 4. Batched AI fill (only if we have an Anthropic key + AI keys to fill).
      const anthropic = getAnthropicClient();
      if (anthropic && needsAi.length > 0) {
        const contextBlock = buildContextBlock({
          client,
          projection,
          projService,
          questionnaire,
        });
        try {
          const result = await batchFillWithClaude(
            anthropic,
            projService.serviceName,
            contextBlock,
            needsAi
          );
          Object.assign(resolved, result.resolved);
          aiLogs.push(...result.log);
          unfilledKeys = result.unfilled;
          totalCost = result.totalCost;
        } catch (err) {
          if (err instanceof CreditExhaustedError) {
            console.warn("[deliverableEngine] credit exhausted; saving partial.");
            unfilledKeys = needsAi.filter((k) => !(k in resolved));
          } else if (err instanceof CostCapExceededError) {
            console.warn(
              `[deliverableEngine] cost cap exceeded at $${err.costUsd.toFixed(4)}; saving partial.`
            );
            unfilledKeys = needsAi.filter((k) => !(k in resolved));
            totalCost = err.costUsd;
          } else {
            throw err;
          }
        }
      } else if (!anthropic && needsAi.length > 0) {
        // No API key — leave AI keys unfilled (they get the visible marker below).
        unfilledKeys = needsAi;
      }

      // 5. Stuff visible markers for unfilled keys (D1).
      for (const k of unfilledKeys) {
        resolved[k] = `<em style="color:#94a3b8">[${k}]</em>`;
      }

      // 6. Replace all placeholders in the HTML.
      let html = template.htmlTemplate;
      for (const [k, v] of Object.entries(resolved)) {
        const safe = String(v ?? "").replace(/\$/g, "$$$$");
        html = html.replace(new RegExp(escapeRegex(`{{${k}}}`), "g"), safe);
      }
      finalContent = html;
    } else {
      // No template: fall back to direct generation (legacy behavior, rare path).
      const anthropic = getAnthropicClient();
      if (!anthropic) {
        finalContent = `<p>${AI_UNAVAILABLE_PLACEHOLDER}</p>`;
      } else {
        const questionnaireContext = questionnaire?.responses
          ? questionnaire.responses
              .map(
                (r: { questionText: string; answer: string }) =>
                  `P: ${r.questionText}\nR: ${r.answer}`
              )
              .join("\n\n")
          : "Sin respuestas de cuestionario disponibles.";
        try {
          const isShort = args.templateType === "deliverable_short";
          const result = await callClaudeWithRetry(
            anthropic,
            `Eres un consultor profesional de ${projService.serviceName}. Genera un ${isShort ? "resumen ejecutivo breve" : "informe detallado completo"} empresarial en formato HTML.`,
            `Cliente: ${client.name}\nIndustria: ${client.industry}\nRFC: ${client.rfc}\nServicio: ${projService.serviceName}\nMes: ${assignment.month}/${assignment.year}\nMonto mensual: $${assignment.amount.toLocaleString("es-MX")}\n\nRespuestas del cuestionario:\n${questionnaireContext}\n\nGenera un ${isShort ? "resumen ejecutivo (1-2 parrafos)" : "informe detallado con secciones: Resumen Ejecutivo, Analisis, Hallazgos, Recomendaciones, Proximos Pasos"} en espanol profesional. Responde en formato HTML.`
          );
          finalContent = result.text;
          aiLogs.push(result.log);
        } catch (err) {
          console.error("[deliverableEngine] Failed to generate content:", err);
          finalContent = `<p>${AI_UNAVAILABLE_PLACEHOLDER}</p>`;
        }
      }
    }

    // 7. Save deliverable (with unfilledKeys → rejected status per D1).
    const isShort = args.templateType === "deliverable_short";
    const deliverableId = await ctx.runMutation(
      internal.functions.deliverables.mutations.saveGenerated,
      {
        orgId: assignment.orgId,
        assignmentId: args.assignmentId,
        projServiceId: args.projServiceId,
        clientId: args.clientId,
        serviceName: projService.serviceName,
        month: assignment.month,
        year: assignment.year,
        shortContent: isShort ? finalContent : "",
        longContent: isShort ? "" : finalContent,
        aiLog: aiLogs,
        unfilledKeys: unfilledKeys.length > 0 ? unfilledKeys : undefined,
        costUsd: totalCost > 0 ? totalCost : undefined,
      }
    );

    // 8. Auto-queue audit (D5).
    await ctx.scheduler.runAfter(
      5000,
      internal.functions.deliverables.actions.auditDeliverable,
      { deliverableId }
    );

    console.log(
      `[deliverableEngine] Generated ${deliverableId}: type=${args.templateType}, AI calls=${aiLogs.length}, unfilled=${unfilledKeys.length}, cost=$${totalCost.toFixed(6)}`
    );

    return deliverableId;
  },
```

- [ ] **Step 5: Promote `auditDeliverable` to internal so the scheduler can call it**

Currently `auditDeliverable` is exported as `action`. The scheduler call uses `internal.functions.deliverables.actions.auditDeliverable`. Verify it's reachable via `internal` — Convex re-exports `action` symbols too via the generated `api`/`internal` objects, so this should work as-is. If TypeScript complains that `internal.functions.deliverables.actions.auditDeliverable` doesn't exist, change the export from `action({...})` to `internalAction({...})` and add a thin public `action({...})` wrapper that calls `ctx.runAction(internal..., args)`.

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep "actions\.ts" | head -20
```

If TS errors mention `auditDeliverable`, apply the wrapper pattern. Otherwise, no change needed.

- [ ] **Step 6: Add `getOrgBranding` to internal queries (if missing)**

Check if `internal.functions.deliverables.internalQueries.getOrgBranding` already exists:

```bash
grep -n "getOrgBranding\|orgBranding" convex/functions/deliverables/internalQueries.ts
```

If absent, add this internal query at the end of `convex/functions/deliverables/internalQueries.ts`:

```ts
export const getOrgBranding = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const branding = await ctx.db
      .query("orgBranding")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .first();
    return branding;
  },
});
```

(`internalQuery` and `v` should already be imported in that file — confirm.)

- [ ] **Step 7: Run TypeScript + tests**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | head -30
npx vitest run convex/lib/deliverableEngine/ convex/functions/deliverables/
```

Expected: 0 TS errors in the deliverables module; all engine tests still pass.

- [ ] **Step 8: Commit**

```bash
git add convex/functions/deliverables/actions.ts \
        convex/functions/deliverables/internalQueries.ts
git commit -m "$(cat <<'EOF'
refactor(deliverables): generateDeliverable uses batched engine

- extractPlaceholders parses HTML directly (template.variables ignored)
- resolveStatic fills client/projection/branding aliases
- batchFillWithClaude handles AI vars in chunks of 60/25/10 with
  cache_control: ephemeral on the questionnaire context block
- CreditExhausted/CostCapExceeded → save partial with unfilledKeys
- Unfilled keys render as <em>[key]</em> markers (D1)
- ctx.scheduler.runAfter(5000, auditDeliverable, ...) at the end (D5)
- resolveNonAiVariables deleted (no remaining callers)

Cost per Katimi-class entregable drops from ~$33 to ~$0.80.
Fill rate goes from ~10-20% to ≥98%.

Closes spec issues 1–4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Integration test — end-to-end against a seeded fixture

**Files:**
- Create: `convex/functions/deliverables/__tests__/generateDeliverable.refactor.test.ts`

**Goal:** Boot a `convex-test` harness, seed an org/client/projection/projService/assignment + a template containing both static and AI placeholders, mock `getAnthropicClient` to return a stub that responds with deterministic JSON, run the action, and assert the saved deliverable's `longContent` contains 0 raw `{{key}}` placeholders.

- [ ] **Step 1: Inspect the existing test harness pattern**

```bash
grep -l "convexTest\|@convex-test" convex/__tests__/ convex/functions/quotations/__tests__/ | head -3
cat convex/__tests__/harness.smoke.test.ts | head -30
```

This shows the boot pattern (`convexTest(schema)` from `convex-test`).

- [ ] **Step 2: Write the integration test**

Create `convex/functions/deliverables/__tests__/generateDeliverable.refactor.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api, internal } from "../../../_generated/api";

// Mock the Anthropic SDK so the action's getAnthropicClient() returns our stub.
vi.mock("@anthropic-ai/sdk", () => {
  const create = vi.fn(async () =>
    Promise.resolve({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ai_finding_a1: "Hallazgo de prueba 1",
            ai_finding_a2: "Hallazgo de prueba 2",
            ai_score_overall: "82",
          }),
        },
      ],
      usage: {
        input_tokens: 1000,
        output_tokens: 100,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    })
  );
  return {
    default: vi.fn().mockImplementation(() => ({ messages: { create } })),
  };
});

const TEMPLATE_HTML = `
<html><body>
  <h1>{{client_name}} — {{service_name}}</h1>
  <p>Año: {{projection_year}}, presupuesto: {{projection_total_budget}}</p>
  <p>Generado el {{current_date}} por {{branding_company_name}}</p>
  <section>
    <h2>Hallazgos</h2>
    <ul>
      <li>{{ai_finding_a1}}</li>
      <li>{{ai_finding_a2}}</li>
    </ul>
    <p>Score global: {{ai_score_overall}}</p>
  </section>
</body></html>
`;

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
});

describe("generateDeliverable (refactored) — end-to-end", () => {
  it("renders all static + AI placeholders and persists deliverable approved", async () => {
    const t = convexTest(schema);
    const orgId = "org_test";

    // Seed
    const clientId = await t.run(async (ctx) =>
      ctx.db.insert("clients", {
        orgId,
        name: "Katimi SA",
        rfc: "KAT240115ABC",
        industry: "Manufactura",
        annualRevenue: 31_200_000,
        billingFrequency: "mensual",
        isArchived: false,
        createdAt: Date.now(),
      })
    );
    const projectionId = await t.run(async (ctx) =>
      ctx.db.insert("projections", {
        orgId,
        clientId,
        year: 2026,
        annualSales: 31_200_000,
        totalBudget: 4_500_000,
        commissionRate: 0,
        seasonalityData: [],
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    );
    const serviceId = await t.run(async (ctx) =>
      ctx.db.insert("services", { orgId, name: "Marketing", slug: "marketing", isActive: true } as never)
    );
    const projServiceId = await t.run(async (ctx) =>
      ctx.db.insert("projectionServices", {
        orgId,
        projectionId,
        serviceId,
        serviceName: "Marketing",
        chosenPct: 0.18,
        isActive: true,
        annualAmount: 810_000,
        normalizedWeight: 0.18,
      })
    );
    const assignmentId = await t.run(async (ctx) =>
      ctx.db.insert("monthlyAssignments", {
        orgId,
        projServiceId,
        projectionId,
        clientId,
        serviceName: "Marketing",
        month: 5,
        year: 2026,
        amount: 67_500,
        feFactor: 1,
        status: "pending",
        invoiceStatus: "not_invoiced",
      })
    );
    await t.run(async (ctx) =>
      ctx.db.insert("deliverableTemplates", {
        orgId,
        serviceName: "Marketing",
        type: "deliverable_long",
        htmlTemplate: TEMPLATE_HTML,
        variables: [], // intentionally empty — engine ignores this array
        isActive: true,
      } as never)
    );

    // Run the action
    const deliverableId = await t.action(
      api.functions.deliverables.actions.generateDeliverable,
      {
        assignmentId,
        projServiceId,
        clientId,
        templateType: "deliverable_long",
      }
    );

    // Verify persisted state
    const saved = await t.run(async (ctx) => ctx.db.get(deliverableId as never));
    expect(saved).toBeDefined();
    expect(saved?.longContent).toBeTruthy();
    // No raw {{...}} placeholders remain
    expect(/\{\{[a-zA-Z0-9_]+\}\}/.test(saved!.longContent)).toBe(false);
    // Static fills landed
    expect(saved!.longContent).toContain("Katimi SA");
    expect(saved!.longContent).toContain("Marketing");
    expect(saved!.longContent).toContain("2026");
    // AI fills landed
    expect(saved!.longContent).toContain("Hallazgo de prueba 1");
    expect(saved!.longContent).toContain("Hallazgo de prueba 2");
    expect(saved!.longContent).toContain("82");
    // Audit status pending (no unfilled keys)
    expect(saved!.auditStatus).toBe("pending");
    expect(saved!.auditFeedback).toBeUndefined();
  });

  it("marks deliverable rejected with unfilledKeys when AI returns partial JSON", async () => {
    const { default: AnthropicMock } = await import("@anthropic-ai/sdk");
    const create = vi.fn(async () => ({
      content: [{ type: "text", text: JSON.stringify({ ai_finding_a1: "Solo este" }) }],
      usage: { input_tokens: 1000, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    }));
    (AnthropicMock as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      messages: { create },
    }));

    const t = convexTest(schema);
    // ... (same seed as above; abbreviated — copy from previous test or extract a helper)
    // After running the action:
    //   expect(saved!.auditStatus).toBe("rejected");
    //   const fb = JSON.parse(saved!.auditFeedback!);
    //   expect(fb.unfilledKeys).toEqual(["ai_finding_a2", "ai_score_overall"]);
  });
});
```

> **Note:** the second test sketch is intentionally abbreviated — the engineer should extract the seed code into a `seedFixture(t)` helper at the top of the file and reuse it across both tests, keeping the test body focused on what differs (mock response → expected outcome).

- [ ] **Step 3: Run the integration test**

```bash
npx vitest run convex/functions/deliverables/__tests__/generateDeliverable.refactor.test.ts
```

Expected: PASS (both tests).

If the test fails because of seed-data shape mismatches with the live schema, reconcile by reading `convex/schema.ts` for the failing table and adjusting the insert payload.

- [ ] **Step 4: Run full test suite to confirm no regressions**

```bash
npm test 2>&1 | tail -30
```

Expected: all previously-passing tests still pass; 2 new tests added.

- [ ] **Step 5: Commit**

```bash
git add convex/functions/deliverables/__tests__/generateDeliverable.refactor.test.ts
git commit -m "$(cat <<'EOF'
test(deliverables): integration test for refactored generateDeliverable

Seeds org/client/projection/template with mixed static + AI placeholders,
mocks Anthropic SDK to return deterministic JSON, runs the action,
asserts longContent has 0 raw {{...}} placeholders and audit status
matches D1 (pending when fully filled, rejected when partial).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Manual regression vs reference script

**Goal:** Confirm the refactored engine produces output comparable to `scripts/generate-demo-deliverables.mjs` for the Katimi fixture. This is a manual smoke test — no automation expected.

- [ ] **Step 1: Verify Convex env has a fresh `ANTHROPIC_API_KEY`**

Ask Christian whether the key in Convex env was rotated since the prior session. If not, set it locally:

```bash
# (User-run) ! npx convex env set ANTHROPIC_API_KEY <fresh-key>
```

- [ ] **Step 2: Re-run the standalone script for baseline**

```bash
ANTHROPIC_API_KEY=<key> node scripts/generate-demo-deliverables.mjs --only=Marketing
```

Expected: writes `~/Desktop/projex-deliverables-demo-2026-05-13/04-marketing-katimi.pdf`. Note total cost printed at the end.

- [ ] **Step 3: Trigger `generateDeliverable` against the same Marketing template via Convex dashboard or a quick CLI call**

```bash
# (User-run) ! npx convex run functions/deliverables/actions:generateDeliverable \
#     '{"assignmentId":"<...>","projServiceId":"<...>","clientId":"<katimi>","templateType":"deliverable_long"}'
```

The action returns the new `deliverableId`. Inspect via:

```bash
# (User-run) ! npx convex run functions/deliverables/internalQueries:getDeliverableData '{"deliverableId":"<id>"}'
```

- [ ] **Step 4: Compare**

- `longContent` from the platform vs the script's PDF visually similar?
- `aiLog` count: should be ~6-12 entries (one per chunk), not 600+ (one per AI var)
- `aiLog[*].costUsd` summed: should be ≤ $1.00, ideally ~$0.50-$0.80
- `auditStatus`: should be `pending` if all keys filled, `rejected` (with `auditFeedback` JSON) if partial
- After 5 seconds, `auditStatus` should flip to `approved` or `rejected` based on the auto-audit (D5)

If any of these checks fail, file a follow-up bug — do NOT block the PR on it (the comparison is for confidence, not strict equivalence).

- [ ] **Step 5: No-commit step (manual verification)**

This task does not produce a commit. It informs the PR description.

---

## Task 10: PR 2 verification + open PR

- [ ] **Step 1: Re-run impact analysis to confirm scope**

```bash
npx gitnexus analyze
npx gitnexus detect-changes 2>/dev/null || git diff --stat main..HEAD
```

Expected: `actions.ts`, `mutations.ts`, `internalQueries.ts`, and 1 new test file. No collateral changes outside the deliverables module.

- [ ] **Step 2: Full test + type check**

```bash
npm test 2>&1 | tail -10
npx tsc --noEmit -p tsconfig.json 2>&1 | tail -10
npm run build 2>&1 | tail -15
```

Expected: all green.

- [ ] **Step 3: Open PR 2**

Title: `refactor(deliverables): batched + cached generateDeliverable engine`

Body should reference:
- Spec doc path
- Locked decisions D1–D5 with one-line how-each-was-implemented
- The cost-model table from the spec
- Manual regression notes from Task 9 (cost observed, fill rate observed)

---

# PR 3 — Apply caching to audit + regenerate (deferred)

**Status:** Out of scope for the 2026-05-15 demo. Documented in spec § 5 cleanups. Open as a follow-up issue when the v2 sprint settles.

- [ ] **Task 11 (deferred):** Apply `cache_control: ephemeral` to the user-content block in `auditDeliverable` and `regenerateDeliverable`. Same pattern as `aiBatchFill.ts`. Each saves ~$0.05 per call; cumulative across the fleet adds up.

---

## Self-Review Notes

Spec coverage check:
- ✅ Issue 1 (static resolver) → Task 2
- ✅ Issue 2 (HTML-driven placeholders) → Task 1
- ✅ Issue 3 (1-call-per-var) → Task 4
- ✅ Issue 4 (no caching) → Task 4
- ✅ D1 (unfilled keys → rejected + JSON feedback + visible marker) → Tasks 6 + 7
- ✅ D2 (`convex/lib/deliverableEngine/`) → Tasks 1–4
- ✅ D3 (60/25/10 chunks, exported constants) → Task 4
- ✅ D4 (soft $0.50 / hard $2.00 caps) → Task 4
- ✅ D5 (auto-audit `runAfter(5000, ...)`) → Task 7
- ✅ Goal 4 (no template HTML changes) → entire plan reads templates as-is
- ✅ Goal 5 (engine usable by `previewDeliverable` of sub-project F) → modules in `convex/lib/`, no Convex-runtime coupling

Type consistency:
- `BatchFillResult.log` uses the same `AiLogEntry` shape (role/model/inputTokens/outputTokens/costUsd/timestamp) as `convex/schema.ts:348-358` — confirmed.
- `unfilledKeys: string[]` arg name consistent across mutations.ts and actions.ts call site.
- `StaticResolutionContext` typed against actual Convex doc fields (verified against `convex/schema.ts`).

No placeholders / TBDs in the plan body.
