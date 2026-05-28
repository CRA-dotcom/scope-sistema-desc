"use node";

import { action, internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import {
  buildKey,
  uploadBlob,
  signedDownloadUrl,
} from "../../lib/blobStorage";
import { parseExcel } from "../../lib/excelParser";
import {
  PROMPT_VERSION,
  buildExtractionPrompt,
  parseExtractionResponse,
  type ExtractedLineItem,
} from "../../lib/financialExtractionPrompt";

const DOWNLOAD_URL_TTL_SEC = 60 * 5;
const EXCEL_CONTENT_TYPES = new Set<string>([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/octet-stream", // some browsers/uploaders
]);
const EXCEL_EXT = /\.(xlsx|xls)$/i;

// Period regex per periodType.
const MONTHLY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const QUARTERLY_RE = /^\d{4}-Q[1-4]$/;
const ANNUAL_RE = /^\d{4}$/;

function validatePeriod(
  period: string,
  periodType: "monthly" | "quarterly" | "annual"
): boolean {
  switch (periodType) {
    case "monthly":
      return MONTHLY_RE.test(period);
    case "quarterly":
      return QUARTERLY_RE.test(period);
    case "annual":
      return ANNUAL_RE.test(period);
  }
}

/**
 * SS4 — Upload a client financial statement Excel.
 *
 * Bucket-first ordering (mirrors invoices.actions.upload): blob is uploaded
 * BEFORE the row is inserted. Schedules extractInternal which uses Claude
 * to map columns → structured line items.
 *
 * Per docs/superpowers/specs/2026-05-27-financial-statements-ingestion-design.md §3
 */
export const upload = action({
  args: {
    clientId: v.id("clients"),
    period: v.string(),
    periodType: v.union(
      v.literal("monthly"),
      v.literal("quarterly"),
      v.literal("annual")
    ),
    filename: v.string(),
    contentType: v.string(),
    fileBuffer: v.bytes(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ id: Id<"clientFinancialData"> }> => {
    const { userId, orgId } = await ctx.runQuery(
      internal.functions.clientFinancialData.internalQueries.requireAuthCtx,
      {}
    );

    const client = await ctx.runQuery(
      internal.functions.clientFinancialData.internalQueries.getClientForOrg,
      { clientId: args.clientId, orgId }
    );
    if (!client) {
      throw new Error("Cliente no encontrado o no pertenece al org.");
    }

    const isExcelContentType = EXCEL_CONTENT_TYPES.has(args.contentType);
    const isExcelExt = EXCEL_EXT.test(args.filename);
    if (!isExcelContentType && !isExcelExt) {
      throw new Error("Solo archivos Excel (.xlsx, .xls) aceptados en V1.");
    }

    if (!validatePeriod(args.period, args.periodType)) {
      throw new Error(
        `Periodo inválido para tipo ${args.periodType}. Formato esperado: ` +
          (args.periodType === "monthly"
            ? "YYYY-MM"
            : args.periodType === "quarterly"
              ? "YYYY-Qn"
              : "YYYY") +
          "."
      );
    }

    // Bucket-first.
    const safeFilename = args.filename
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 80);
    const suffix = `${args.period}-${Date.now()}-${safeFilename}`;
    const bucketKey = buildKey({
      orgId,
      clientId: args.clientId,
      kind: "finanzas",
      suffix,
    });

    await uploadBlob({
      buffer: Buffer.from(args.fileBuffer),
      key: bucketKey,
      contentType: args.contentType,
    });

    const id: Id<"clientFinancialData"> = await ctx.runMutation(
      internal.functions.clientFinancialData.internalMutations.insertRow,
      {
        orgId,
        clientId: args.clientId,
        period: args.period,
        periodType: args.periodType,
        bucketKey,
        contentType: args.contentType,
        sizeBytes: args.fileBuffer.byteLength,
        filename: safeFilename,
        uploadedBy: userId,
      }
    );

    await ctx.scheduler.runAfter(
      0,
      internal.functions.clientFinancialData.actions.extractInternal,
      { id }
    );

    return { id };
  },
});

/**
 * SS4 — Action returning a short-lived signed URL for downloading the
 * Excel original. Auth + multi-tenant enforced via getRowForOrg.
 */
export const getDownloadUrl = action({
  args: { id: v.id("clientFinancialData") },
  handler: async (ctx, args): Promise<string> => {
    const row = await ctx.runQuery(
      internal.functions.clientFinancialData.internalQueries.getRowForOrg,
      { id: args.id }
    );
    if (!row) throw new Error("Estado financiero no encontrado.");
    return await signedDownloadUrl({
      bucketKey: row.bucketKey,
      expiresSec: DOWNLOAD_URL_TTL_SEC,
    });
  },
});

/**
 * SS4 — AI extraction action. Scheduled by `upload`. Reads the blob,
 * parses Excel, calls Claude to map columns → line items, patches row.
 * Retries 3x with exponential backoff before marking status=error.
 *
 * Per spec §3 + §6.
 */
const EXTRACTION_MODEL = "claude-sonnet-4-20250514";
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;

async function callClaudeWithRetry(args: {
  apiKey: string;
  system: string;
  user: string;
}): Promise<{ text: string; usage: { input_tokens: number; output_tokens: number } }> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": args.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: EXTRACTION_MODEL,
          max_tokens: 4096,
          system: args.system,
          messages: [{ role: "user", content: args.user }],
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Claude API ${res.status}: ${body.slice(0, 300)}`);
      }
      const data = (await res.json()) as {
        content: { type: string; text: string }[];
        usage: { input_tokens: number; output_tokens: number };
      };
      const text = data.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
      return { text, usage: data.usage };
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        const delay = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Claude API failed");
}

// Pricing per million tokens for claude-sonnet-4 (USD).
// Source: model card at integration time.
const PRICE_INPUT_PER_MTOK = 3.0;
const PRICE_OUTPUT_PER_MTOK = 15.0;

function estimateCostUsd(usage: {
  input_tokens: number;
  output_tokens: number;
}): number {
  return (
    (usage.input_tokens / 1_000_000) * PRICE_INPUT_PER_MTOK +
    (usage.output_tokens / 1_000_000) * PRICE_OUTPUT_PER_MTOK
  );
}

export const extractInternal = internalAction({
  args: { id: v.id("clientFinancialData") },
  handler: async (ctx, args): Promise<void> => {
    const row = await ctx.runQuery(
      internal.functions.clientFinancialData.internalQueries.getRowRaw,
      { id: args.id }
    );
    if (!row) {
      console.warn(`[extractInternal] row ${args.id} not found`);
      return;
    }
    if (row.status !== "uploaded") {
      // Idempotent: only extract once.
      return;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      await ctx.runMutation(
        internal.functions.clientFinancialData.internalMutations.markError,
        {
          id: args.id,
          errorMessage:
            "ANTHROPIC_API_KEY no configurado en el deployment Convex.",
        }
      );
      return;
    }

    try {
      const url = await signedDownloadUrl({
        bucketKey: row.bucketKey,
        expiresSec: DOWNLOAD_URL_TTL_SEC,
      });
      const fileRes = await fetch(url);
      if (!fileRes.ok) {
        throw new Error(
          `Blob download ${fileRes.status} for ${row.bucketKey}`
        );
      }
      const buffer = await fileRes.arrayBuffer();
      const sheets = parseExcel(buffer);
      if (sheets.length === 0) {
        throw new Error("Excel sin hojas.");
      }

      const { system, user } = buildExtractionPrompt(sheets);
      const { text, usage } = await callClaudeWithRetry({
        apiKey,
        system,
        user,
      });
      const lineItems: ExtractedLineItem[] = parseExtractionResponse(text);

      await ctx.runMutation(
        internal.functions.clientFinancialData.internalMutations.patchExtraction,
        {
          id: args.id,
          lineItems: lineItems.map((li) => ({
            label: li.label,
            amount: li.amount,
            category: li.category,
            satConcept: li.satConcept,
          })),
          aiExtraction: {
            model: EXTRACTION_MODEL,
            promptVersion: PROMPT_VERSION,
            extractedAt: Date.now(),
            costUsd: estimateCostUsd(usage),
            rawSnippet: text.slice(0, 500),
          },
        }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[extractInternal ${args.id}] failed:`, msg);
      await ctx.runMutation(
        internal.functions.clientFinancialData.internalMutations.markError,
        { id: args.id, errorMessage: msg.slice(0, 500) }
      );
    }
  },
});
