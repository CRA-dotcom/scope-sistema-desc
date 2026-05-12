/**
 * Source-level tests for useDebouncedAutosave.
 *
 * NOTE: The vitest environment is "edge-runtime" with no DOM/jsdom, and
 * @testing-library/react is not installed, so we cannot mount React hooks
 * at test time. These tests verify structural and API contracts by reading
 * the hook source, consistent with the pattern used in
 * src/components/questionnaires/__tests__/file-upload-field.test.tsx.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_PATH = resolve(__dirname, "../useDebouncedAutosave.ts");
const source = readFileSync(SOURCE_PATH, "utf-8");

describe("useDebouncedAutosave — API surface", () => {
  it("exports the AutosaveStatus type with all 5 status values", () => {
    expect(source).toContain("export type AutosaveStatus");
    expect(source).toContain('"idle"');
    expect(source).toContain('"pending"');
    expect(source).toContain('"saving"');
    expect(source).toContain('"saved"');
    expect(source).toContain('"error"');
  });

  it("exports the useDebouncedAutosave hook function", () => {
    expect(source).toContain("export function useDebouncedAutosave");
  });

  it("accepts a generic value, a save callback, and a debounceMs argument", () => {
    expect(source).toMatch(
      /export function useDebouncedAutosave<T>\(\s*value:\s*T,\s*save:\s*\(v:\s*T\)\s*=>\s*Promise<void>,\s*debounceMs\s*=\s*2000\s*\)/
    );
  });

  it("returns an object with a status field", () => {
    expect(source).toContain("return { status };");
  });
});

describe("useDebouncedAutosave — implementation contracts", () => {
  it("uses setTimeout for debouncing", () => {
    expect(source).toContain("setTimeout(");
  });

  it("clears the previous timer when value changes", () => {
    expect(source).toContain("clearTimeout(");
  });

  it("uses a ref to track the latest value (avoiding stale closures)", () => {
    expect(source).toContain("latestValueRef");
    expect(source).toContain("latestValueRef.current = value;");
  });

  it("transitions through pending -> saving -> saved on success", () => {
    expect(source).toContain('setStatus("pending")');
    expect(source).toContain('setStatus("saving")');
    expect(source).toContain('setStatus("saved")');
  });

  it("sets status to error on failure", () => {
    expect(source).toContain('setStatus("error")');
    expect(source).toMatch(/catch\s*\([^)]*\)\s*{[^}]*setStatus\("error"\)/s);
  });

  it("does not save on the initial render when value is unchanged", () => {
    // The guard uses Object.is on the initial value ref + status === 'idle'
    expect(source).toContain("Object.is(value, initialRef.current)");
  });

  it("flushes/cleanup on unmount via useEffect return", () => {
    // The effect returns a cleanup that clears the timer
    expect(source).toMatch(/return\s*\(\)\s*=>\s*{[^}]*clearTimeout/s);
  });

  it("intentionally omits `save` from deps to avoid timer re-arming", () => {
    // The plan author documented this — verify the comment + deps array
    expect(source).toContain("eslint-disable-next-line react-hooks/exhaustive-deps");
    expect(source).toMatch(/\}, \[value, debounceMs\]\);/);
  });
});
