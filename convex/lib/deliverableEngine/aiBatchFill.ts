import type Anthropic from "@anthropic-ai/sdk";
import { CreditExhaustedError, CostCapExceededError } from "./errors";

// ─── Constants ───────────────────────────────────────────────────────

export const MODEL = "claude-sonnet-4-20250514";
export const MAX_OUTPUT_TOKENS = 8192;
export const DEFAULT_CHUNK_SIZE = 60;
export const RETRY_CHUNK_SIZES = [25, 10];
export const COST_SOFT_CAP_USD = 0.5;
export const COST_HARD_CAP_USD = 2.0;

// Claude Sonnet 4 pricing (USD per token)
const INPUT_COST_PER_TOKEN = 3 / 1_000_000;
const OUTPUT_COST_PER_TOKEN = 15 / 1_000_000;
const CACHE_WRITE_COST_PER_TOKEN = 3.75 / 1_000_000; // 1.25× input
const CACHE_READ_COST_PER_TOKEN = 0.3 / 1_000_000; // 0.10× input

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
  if (
    /_paragraph_|_summary$|_description$|_observation_|_methodology$|_conclusion_|executive_/.test(
      key
    )
  )
    return '"<párrafo profesional, 60-120 palabras, puede usar inline <strong>>"';
  if (/_finding_|_risk_/.test(key)) return '"<hallazgo o riesgo, 1-2 oraciones>"';
  if (/_initiative_|_action$|_result$|_kpi$|_quick_win_|_roi_/.test(key))
    return '"<iniciativa/acción específica, 1-2 oraciones>"';
  return `"<contenido apropiado al label \\"${key}\\" en contexto profesional>"`;
}

function parseJsonResponse(text: string): Record<string, unknown> {
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
  parsed: Record<string, unknown>;
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
            {
              type: "text",
              text: cacheablePrompt,
              cache_control: { type: "ephemeral" },
            },
            { type: "text", text: dynamicPrompt },
          ],
        },
      ],
    } as Parameters<Anthropic["messages"]["create"]>[0]);
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    if (msg.includes("credit balance is too low") || msg.includes("CREDIT")) {
      throw new CreditExhaustedError();
    }
    throw err;
  }

  const content = (response as { content: Array<{ type: string; text?: string }> }).content;
  const block = content.find((b) => b.type === "text");
  const text = block?.text ?? "";

  const usage = (
    response as {
      usage: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
    }
  ).usage;

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
    inputTokens: inputTokens + cacheRead + cacheCreate,
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
 *  4. Cumulative cost is tracked. Soft warning at $0.50, hard cap throw at $2.00.
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
    const requested = new Set(chunk);
    for (const [k, v] of Object.entries(parsed)) {
      if (requested.has(k)) resolved[k] = String(v ?? "");
    }
  };

  for (const chunk of chunkArray(keys, chunkSize)) {
    await issueChunk(chunk);
  }

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
