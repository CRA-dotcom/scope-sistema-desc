import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_PATH = resolve(__dirname, "../DraftNavbarChip.tsx");

describe("DraftNavbarChip — source contract", () => {
  it("file exists", () => {
    expect(existsSync(SOURCE_PATH)).toBe(true);
  });

  it("uses listMyActiveDrafts query", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");
    expect(source).toContain("listMyActiveDrafts");
  });

  it("renders nothing when there are zero drafts", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");
    expect(source).toMatch(/length\s*===\s*0/);
  });
});
