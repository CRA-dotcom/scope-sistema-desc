import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_PATH = resolve(__dirname, "../DraftSaveStatus.tsx");

describe("DraftSaveStatus — source contract", () => {
  it("file exists", () => {
    expect(existsSync(SOURCE_PATH)).toBe(true);
  });

  it("renders each of the 4 statuses", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");
    expect(source).toMatch(/Guardando/);
    expect(source).toMatch(/Guardado/);
    expect(source).toMatch(/Reintentando/);
    expect(source).toMatch(/No se pudo guardar/);
  });

  it("accepts status, retry, lastSavedAt props", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");
    expect(source).toMatch(/status\??:/);
    expect(source).toMatch(/retry\??:/);
    expect(source).toMatch(/lastSavedAt\??:/);
  });
});
