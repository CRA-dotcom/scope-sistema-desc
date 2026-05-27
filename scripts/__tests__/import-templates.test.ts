import { describe, it, expect } from "vitest";
import { parseFilename } from "../import-templates";

describe("parseFilename", () => {
  // --- Contract convention: <empresa-slug>__<subservice-slug>-contract.html ---

  it("parses contract template filename with empresa slug", () => {
    const r = parseFilename("desc__asesoria-legal-contract.html");
    expect(r).toEqual({
      kind: "contract",
      empresaSlug: "desc",
      subserviceSlug: "asesoria-legal",
      type: "contract",
    });
  });

  it("parses contract with multi-word empresa slug", () => {
    const r = parseFilename("despacho-xyz__estados-financieros-contract.html");
    expect(r).toEqual({
      kind: "contract",
      empresaSlug: "despacho-xyz",
      subserviceSlug: "estados-financieros",
      type: "contract",
    });
  });

  // --- Standard convention: <parent-svc-slug>__<subservice-slug>[-<type>].html ---

  it("parses deliverable_long filename (default, no suffix)", () => {
    const r = parseFilename("legal__asesoria-legal.html");
    expect(r).toEqual({
      kind: "standard",
      parentSvcSlug: "legal",
      subserviceSlug: "asesoria-legal",
      type: "deliverable_long",
    });
  });

  it("parses deliverable_long filename with explicit -long suffix", () => {
    const r = parseFilename("legal__asesoria-legal-long.html");
    expect(r).toEqual({
      kind: "standard",
      parentSvcSlug: "legal",
      subserviceSlug: "asesoria-legal",
      type: "deliverable_long",
    });
  });

  it("parses deliverable_short filename", () => {
    const r = parseFilename("legal__asesoria-legal-short.html");
    expect(r).toEqual({
      kind: "standard",
      parentSvcSlug: "legal",
      subserviceSlug: "asesoria-legal",
      type: "deliverable_short",
    });
  });

  it("parses quotation filename", () => {
    const r = parseFilename("contable__estados-financieros-quotation.html");
    expect(r).toEqual({
      kind: "standard",
      parentSvcSlug: "contable",
      subserviceSlug: "estados-financieros",
      type: "quotation",
    });
  });

  it("parses questionnaire filename", () => {
    const r = parseFilename("legal__asesoria-legal-questionnaire.html");
    expect(r).toEqual({
      kind: "standard",
      parentSvcSlug: "legal",
      subserviceSlug: "asesoria-legal",
      type: "questionnaire",
    });
  });

  // --- Error cases ---

  it("throws on filename without __ separator", () => {
    expect(() => parseFilename("invalid-no-separator.html")).toThrow(
      /Invalid name/
    );
  });

  it("throws on contract filename with empty subservice slug", () => {
    // empresa__-contract.html — rest = "-contract" → subserviceSlug empty after strip
    expect(() => parseFilename("empresa__-contract.html")).toThrow(
      /subservice slug is empty/
    );
  });
});
