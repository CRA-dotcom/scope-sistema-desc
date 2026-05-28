import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_PATH = resolve(__dirname, "../DraftPendingBanner.tsx");

describe("DraftPendingBanner — source contract", () => {
  it("file exists", () => {
    expect(existsSync(SOURCE_PATH)).toBe(true);
  });

  it("uses listMyActiveDrafts query", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");
    expect(source).toContain("listMyActiveDrafts");
  });

  it("links continuation to /proyecciones/nueva?draftId=…", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");
    expect(source).toMatch(/proyecciones\/nueva\?draftId=/);
  });

  it("limits to 3 drafts shown", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");
    expect(source).toMatch(/slice\(0,\s*3\)|\.slice\(0,3\)/);
  });
});
