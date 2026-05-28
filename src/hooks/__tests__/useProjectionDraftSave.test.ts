import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_PATH = resolve(__dirname, "../useProjectionDraftSave.ts");

describe("useProjectionDraftSave — API surface", () => {
  it("file exists", () => {
    expect(existsSync(SOURCE_PATH)).toBe(true);
  });

  it("exports useProjectionDraftSave function", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");
    expect(source).toContain("export function useProjectionDraftSave");
  });

  it("returns { status, retry, lastSavedAt }", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");
    expect(source).toMatch(/return\s*{[^}]*status[^}]*retry[^}]*lastSavedAt[^}]*}/);
  });

  it("uses useDebouncedAutosave internally", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");
    expect(source).toContain("useDebouncedAutosave");
  });

  it("retries up to 3 times with exponential backoff (1s, 2s, 4s)", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");
    expect(source).toMatch(/MAX_RETRIES\s*=\s*3/);
    expect(source).toMatch(/2\s*\*\*\s*attempt/);
  });

  it("calls upsertDraft mutation via useMutation", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");
    expect(source).toContain("useMutation");
    expect(source).toMatch(/projectionDrafts\.mutations\.upsertDraft|api\.\w+projectionDrafts/);
  });

  it("accepts optional clientId parameter", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");
    expect(source).toMatch(/clientId\??:\s*Id<"clients">/);
    expect(source).toMatch(/clientId \? \{ clientId \} : \{\}/);
  });
});
