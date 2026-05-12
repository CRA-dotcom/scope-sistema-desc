/**
 * Source-level tests for QuestionField.
 *
 * NOTE: The vitest environment is "edge-runtime" with no DOM/jsdom, and
 * @testing-library/react is not installed, so we cannot mount React components
 * at test time. These tests verify structural and API contracts by reading the
 * component source, consistent with the pattern used elsewhere in this repo
 * (e.g. file-upload-field.test.tsx).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_PATH = resolve(__dirname, "../QuestionField.tsx");
const source = readFileSync(SOURCE_PATH, "utf-8");

describe("QuestionField — exported types and props", () => {
  it("exports QuestionFieldProps interface", () => {
    expect(source).toContain("export interface QuestionFieldProps");
  });

  it("exports QuestionField component", () => {
    expect(source).toContain("export function QuestionField");
  });

  it("declares QuestionType union with all 6 literals", () => {
    expect(source).toContain('"text"');
    expect(source).toContain('"textarea"');
    expect(source).toContain('"select"');
    expect(source).toContain('"number"');
    expect(source).toContain('"date"');
    expect(source).toContain('"file_upload"');
  });

  it("Props include questionId, type, value, onChange, options, disabled, placeholder", () => {
    expect(source).toMatch(/questionId:\s*string/);
    expect(source).toMatch(/type:\s*QuestionType\s*\|\s*undefined/);
    expect(source).toMatch(/value:\s*string/);
    expect(source).toMatch(/onChange:\s*\(v:\s*string\)\s*=>\s*void/);
    expect(source).toMatch(/options\?:\s*string\[\]/);
    expect(source).toMatch(/disabled\?:\s*boolean/);
    expect(source).toMatch(/placeholder\?:\s*string/);
  });

  it("is a client component", () => {
    expect(source).toContain('"use client"');
  });
});

describe("QuestionField — render branches by type", () => {
  it("renders <textarea> for type=textarea", () => {
    expect(source).toMatch(/case "textarea":[\s\S]*?<textarea/);
  });

  it("renders <input type=number> for type=number", () => {
    expect(source).toMatch(/case "number":[\s\S]*?type="number"/);
  });

  it("renders <input type=date> for type=date", () => {
    expect(source).toMatch(/case "date":[\s\S]*?type="date"/);
  });

  it("renders <select> with the supplied options for type=select", () => {
    expect(source).toMatch(/case "select":[\s\S]*?<select/);
    expect(source).toMatch(/\(options \?\? \[\]\)\.map/);
    expect(source).toContain("— Seleccione —");
  });

  it("renders a fallback <input type=text> for type=file_upload", () => {
    expect(source).toMatch(/case "file_upload":[\s\S]*?type="text"/);
    expect(source).toContain("(carga de archivos no habilitada)");
  });

  it("renders <input type=text> for type=text and default branch", () => {
    expect(source).toMatch(/case "text":\s*default:[\s\S]*?type="text"/);
  });
});

describe("QuestionField — accessibility and behavior", () => {
  it("threads the questionId as the input id (for <label htmlFor>)", () => {
    // Every branch sets id={questionId}
    const idMatches = source.match(/id=\{questionId\}/g);
    expect(idMatches).not.toBeNull();
    expect(idMatches!.length).toBeGreaterThanOrEqual(6); // one per branch
  });

  it("forwards disabled prop on every branch", () => {
    const disabledMatches = source.match(/disabled=\{disabled\}/g);
    expect(disabledMatches).not.toBeNull();
    expect(disabledMatches!.length).toBeGreaterThanOrEqual(6);
  });

  it("calls onChange with the string value from each input event", () => {
    expect(source).toMatch(/onChange=\{\(e\)\s*=>\s*onChange\(e\.target\.value\)\}/);
  });
});
