import { describe, it, expect, vi } from "vitest";
import {
  batchFillWithClaude,
  DEFAULT_CHUNK_SIZE,
  RETRY_CHUNK_SIZES,
  COST_SOFT_CAP_USD,
  COST_HARD_CAP_USD,
} from "../aiBatchFill";
import { CreditExhaustedError, CostCapExceededError } from "../errors";

type MockResponse =
  | {
      text: string;
      inputTokens?: number;
      outputTokens?: number;
      cacheRead?: number;
      cacheCreate?: number;
    }
  | Error;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockAnthropic(responses: MockResponse[]) {
  let i = 0;
  const create = vi.fn(async (_args: unknown) => {
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
  return { messages: { create } };
}

describe("batchFillWithClaude — constants", () => {
  it("exports D3 chunk sizes (60 / [25, 10])", () => {
    expect(DEFAULT_CHUNK_SIZE).toBe(60);
    expect(RETRY_CHUNK_SIZES).toEqual([25, 10]);
  });

  it("exports D4 cost caps (soft $0.50, hard $2.00)", () => {
    expect(COST_SOFT_CAP_USD).toBe(0.5);
    expect(COST_HARD_CAP_USD).toBe(2.0);
  });
});

describe("batchFillWithClaude — chunking", () => {
  it("returns immediately with empty result when keys is empty", async () => {
    const anthropic = mockAnthropic([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await batchFillWithClaude(anthropic as any, "Marketing", "ctx", []);
    expect(anthropic.messages.create).not.toHaveBeenCalled();
    expect(result.resolved).toEqual({});
    expect(result.unfilled).toEqual([]);
    expect(result.totalCost).toBe(0);
    expect(result.log).toEqual([]);
  });

  it("issues one call per chunk of DEFAULT_CHUNK_SIZE keys", async () => {
    const keys = Array.from({ length: 130 }, (_, i) => `ai_key_${i}`);
    const responses: MockResponse[] = [
      { text: JSON.stringify(Object.fromEntries(keys.slice(0, 60).map((k) => [k, "v"]))) },
      { text: JSON.stringify(Object.fromEntries(keys.slice(60, 120).map((k) => [k, "v"]))) },
      { text: JSON.stringify(Object.fromEntries(keys.slice(120).map((k) => [k, "v"]))) },
    ];
    const anthropic = mockAnthropic(responses);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await batchFillWithClaude(anthropic as any, "Marketing", "ctx", keys);
    expect(anthropic.messages.create).toHaveBeenCalledTimes(3);
    expect(Object.keys(result.resolved)).toHaveLength(130);
    expect(result.unfilled).toHaveLength(0);
  });
});

describe("batchFillWithClaude — caching + cost", () => {
  it("marks the context block with cache_control: ephemeral on every call", async () => {
    const anthropic = mockAnthropic([{ text: '{"ai_a":"x"}' }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await batchFillWithClaude(anthropic as any, "Marketing", "CONTEXT_BLOCK_TOKEN", ["ai_a"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call: any = anthropic.messages.create.mock.calls[0][0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cacheableBlock = call.messages[0].content.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (b: any) => b.cache_control?.type === "ephemeral"
    );
    expect(cacheableBlock).toBeDefined();
    expect(cacheableBlock.text).toContain("CONTEXT_BLOCK_TOKEN");
  });

  it("computes cost using cache_read at $0.30/M and cache_creation at $3.75/M", async () => {
    const anthropic = mockAnthropic([
      { text: '{"a":"x"}', inputTokens: 1000, outputTokens: 100, cacheCreate: 5000, cacheRead: 0 },
      { text: '{"b":"y"}', inputTokens: 200, outputTokens: 100, cacheCreate: 0, cacheRead: 5000 },
    ]);
    const result = await batchFillWithClaude(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      anthropic as any,
      "Marketing",
      "ctx",
      ["a", "b"],
      { chunkSize: 1 }
    );
    // Call 1: 1000*3/M + 5000*3.75/M + 100*15/M = 0.003 + 0.01875 + 0.0015 = 0.02325
    // Call 2: 200*3/M  + 5000*0.30/M + 100*15/M = 0.0006 + 0.0015  + 0.0015 = 0.0036
    expect(result.totalCost).toBeCloseTo(0.02685, 5);
  });

  it("emits a console.warn exactly once when soft cap ($0.50) is crossed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const big = { inputTokens: 100_000, outputTokens: 0 }; // $0.30 per call
    const anthropic = mockAnthropic([
      { text: '{"a":"x"}', ...big },
      { text: '{"b":"y"}', ...big },
      { text: '{"c":"z"}', ...big },
    ]);
    await batchFillWithClaude(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      anthropic as any,
      "Marketing",
      "ctx",
      ["a", "b", "c"],
      { chunkSize: 1 }
    );
    const softWarns = warn.mock.calls.filter((c) => String(c[0]).includes("soft cap"));
    expect(softWarns).toHaveLength(1);
    warn.mockRestore();
  });

  it("throws CostCapExceededError when hard cap ($2.00) is crossed", async () => {
    const big = { inputTokens: 333_333, outputTokens: 0 }; // ~$1.00 per call
    const anthropic = mockAnthropic([
      { text: '{"a":"x"}', ...big },
      { text: '{"b":"y"}', ...big },
      { text: '{"c":"z"}', ...big },
    ]);
    await expect(
      batchFillWithClaude(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        anthropic as any,
        "Marketing",
        "ctx",
        ["a", "b", "c"],
        { chunkSize: 1 }
      )
    ).rejects.toBeInstanceOf(CostCapExceededError);
  });
});

describe("batchFillWithClaude — retries on missing keys", () => {
  it("retries unfilled keys at successively smaller chunk sizes", async () => {
    const keys = Array.from({ length: 60 }, (_, i) => `k${i}`);
    // First call returns only first 30 keys (truncated)
    const firstChunk = JSON.stringify(Object.fromEntries(keys.slice(0, 30).map((k) => [k, "v"])));
    // Retry pass 1 (size 25): 30 missing → chunks of 25 + 5
    const retry1a = JSON.stringify(Object.fromEntries(keys.slice(30, 55).map((k) => [k, "v"])));
    const retry1b = JSON.stringify(Object.fromEntries(keys.slice(55, 60).map((k) => [k, "v"])));
    const anthropic = mockAnthropic([
      { text: firstChunk },
      { text: retry1a },
      { text: retry1b },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await batchFillWithClaude(anthropic as any, "Marketing", "ctx", keys);
    expect(anthropic.messages.create).toHaveBeenCalledTimes(3);
    expect(Object.keys(result.resolved)).toHaveLength(60);
    expect(result.unfilled).toHaveLength(0);
  });

  it("returns unfilled keys after all retry passes exhausted", async () => {
    const keys = ["a", "b", "c"];
    const anthropic = mockAnthropic([
      { text: "{}" }, // first pass
      { text: "{}" }, // retry size 25
      { text: "{}" }, // retry size 10
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await batchFillWithClaude(anthropic as any, "Marketing", "ctx", keys);
    expect(result.unfilled).toEqual(["a", "b", "c"]);
    expect(result.resolved).toEqual({});
  });

  it("only accepts keys that were actually requested in the chunk", async () => {
    // Claude returns extra keys that weren't asked for — they should be ignored.
    const anthropic = mockAnthropic([
      { text: JSON.stringify({ a: "x", surprise_key: "leak" }) },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await batchFillWithClaude(anthropic as any, "Marketing", "ctx", ["a"]);
    expect(result.resolved).toEqual({ a: "x" });
    expect(result.resolved).not.toHaveProperty("surprise_key");
  });
});

describe("batchFillWithClaude — JSON parse fallbacks", () => {
  it("parses JSON wrapped in ```json fences", async () => {
    const anthropic = mockAnthropic([{ text: '```json\n{"a":"x"}\n```' }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await batchFillWithClaude(anthropic as any, "Marketing", "ctx", ["a"]);
    expect(result.resolved).toEqual({ a: "x" });
  });

  it("parses JSON when there is leading/trailing prose", async () => {
    const anthropic = mockAnthropic([
      { text: 'Here is the JSON:\n{"a":"x","b":"y"}\nLet me know if you need more.' },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await batchFillWithClaude(anthropic as any, "Marketing", "ctx", ["a", "b"]);
    expect(result.resolved).toEqual({ a: "x", b: "y" });
  });

  it("returns chunk's keys as unfilled when JSON cannot be parsed at all", async () => {
    const anthropic = mockAnthropic([
      { text: "totally not json" },
      { text: "still not json" },
      { text: "nope" },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await batchFillWithClaude(anthropic as any, "Marketing", "ctx", ["a"]);
    expect(result.unfilled).toEqual(["a"]);
  });
});

describe("batchFillWithClaude — credit exhaustion", () => {
  it("throws CreditExhaustedError when Anthropic returns credit_balance_too_low", async () => {
    const err = new Error("Your credit balance is too low to access this model.");
    const anthropic = mockAnthropic([err]);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      batchFillWithClaude(anthropic as any, "Marketing", "ctx", ["a"])
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      anthropic as any,
      "Marketing",
      "ctx",
      ["a", "b"],
      { chunkSize: 1 }
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
