import { describe, it, expect } from "vitest";
import { extractPlaceholders } from "../placeholders";

describe("extractPlaceholders", () => {
  it("returns empty array for HTML with no placeholders", () => {
    expect(extractPlaceholders("<p>hola</p>")).toEqual([]);
  });

  it("extracts a single placeholder", () => {
    expect(extractPlaceholders("<p>{{client_name}}</p>")).toEqual(["client_name"]);
  });

  it("dedupes repeated placeholders", () => {
    const html = "<p>{{client_name}}</p><span>{{client_name}}</span>";
    expect(extractPlaceholders(html)).toEqual(["client_name"]);
  });

  it("preserves first-seen order across distinct keys", () => {
    const html = "{{a}} {{b}} {{a}} {{c}}";
    expect(extractPlaceholders(html)).toEqual(["a", "b", "c"]);
  });

  it("ignores malformed placeholders (single brace, missing close)", () => {
    const html = "{client_name} {{missing_close {{ok}}";
    expect(extractPlaceholders(html)).toEqual(["ok"]);
  });

  it("only matches alphanumeric + underscore key pattern", () => {
    const html = "{{ai_score_1}} {{has-dash}} {{has space}} {{valid_key_99}}";
    expect(extractPlaceholders(html)).toEqual(["ai_score_1", "valid_key_99"]);
  });

  it("handles empty HTML", () => {
    expect(extractPlaceholders("")).toEqual([]);
  });

  it("does not leak regex state between calls", () => {
    const html = "{{a}} {{b}}";
    expect(extractPlaceholders(html)).toEqual(["a", "b"]);
    expect(extractPlaceholders(html)).toEqual(["a", "b"]);
    expect(extractPlaceholders(html)).toEqual(["a", "b"]);
  });
});
