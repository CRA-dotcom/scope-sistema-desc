/**
 * Source-level tests for SectionNav.
 *
 * NOTE: The vitest environment is "edge-runtime" with no DOM/jsdom, and
 * @testing-library/react is not installed, so we cannot mount React components
 * at test time. These tests verify structural and API contracts by reading
 * the component source, consistent with the repo's pattern.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_PATH = resolve(__dirname, "../SectionNav.tsx");
const source = readFileSync(SOURCE_PATH, "utf-8");

describe("SectionNav — exported types and component", () => {
  it("exports SectionNavItem type with id/label/answered/total", () => {
    expect(source).toContain("export type SectionNavItem");
    expect(source).toMatch(/id:\s*string/);
    expect(source).toMatch(/label:\s*string/);
    expect(source).toMatch(/answered:\s*number/);
    expect(source).toMatch(/total:\s*number/);
  });

  it("exports the SectionNav component", () => {
    expect(source).toContain("export function SectionNav");
  });

  it("accepts `sections: SectionNavItem[]` as the sole prop", () => {
    expect(source).toMatch(/\{\s*sections\s*\}:\s*\{\s*sections:\s*SectionNavItem\[\]\s*\}/);
  });

  it("is a client component", () => {
    expect(source).toContain('"use client"');
  });
});

describe("SectionNav — desktop sidebar markup", () => {
  it("renders a <nav> with aria-label for the section list", () => {
    expect(source).toContain('<nav');
    expect(source).toContain('aria-label="Secciones del cuestionario"');
  });

  it("emits one <a> per section linking to #<id>", () => {
    expect(source).toContain('href={`#${s.id}`}');
  });

  it("shows the answered/total counter on every section row", () => {
    expect(source).toContain("{s.answered}/{s.total}");
  });

  it("uses a sticky sidebar on lg breakpoint only", () => {
    expect(source).toContain("hidden lg:block sticky");
  });
});

describe("SectionNav — mobile dropdown", () => {
  it("renders a fallback <select> visible only below lg", () => {
    expect(source).toContain("lg:hidden");
    expect(source).toContain("Saltar a sección");
  });

  it("jumps to the picked section by setting location.hash", () => {
    expect(source).toContain("location.hash = id");
  });

  it("includes a placeholder option labeled '— Selecciona —'", () => {
    expect(source).toContain("— Selecciona —");
  });
});
