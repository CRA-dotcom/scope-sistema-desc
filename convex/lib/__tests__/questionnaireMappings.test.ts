import { describe, it, expect } from "vitest";
import { buildTemplateVariables } from "../questionnaireMappings";

describe("buildTemplateVariables", () => {
  it("maps a text answer to a single template variable", () => {
    const result = buildTemplateVariables(
      [
        {
          key: "razon_social",
          type: "text",
          templateVariableMappings: [{ templateId: "tmpl1" as any, variableName: "razon_social" }],
        },
      ],
      [{ questionKey: "razon_social", value: "ACME SA de CV" }]
    );
    expect(result.get("tmpl1" as any)).toEqual({ razon_social: "ACME SA de CV" });
  });

  it("maps one answer to multiple templates", () => {
    const result = buildTemplateVariables(
      [
        {
          key: "razon_social",
          type: "text",
          templateVariableMappings: [
            { templateId: "tmpl1" as any, variableName: "razon_social" },
            { templateId: "tmpl2" as any, variableName: "razon_social" },
          ],
        },
      ],
      [{ questionKey: "razon_social", value: "ACME" }]
    );
    expect(result.get("tmpl1" as any)?.razon_social).toBe("ACME");
    expect(result.get("tmpl2" as any)?.razon_social).toBe("ACME");
  });

  it("file_upload exposes _storageId and _filename", () => {
    const result = buildTemplateVariables(
      [
        {
          key: "actas",
          type: "file_upload",
          templateVariableMappings: [{ templateId: "tmpl1" as any, variableName: "actas" }],
        },
      ],
      [{ questionKey: "actas", value: "stor_abc123", filename: "acta-2024.pdf" }]
    );
    const vars = result.get("tmpl1" as any)!;
    expect(vars.actas_storageId).toBe("stor_abc123");
    expect(vars.actas_filename).toBe("acta-2024.pdf");
  });

  it("question without mappings is skipped", () => {
    const result = buildTemplateVariables(
      [{ key: "x", type: "text" }],
      [{ questionKey: "x", value: "val" }]
    );
    expect(result.size).toBe(0);
  });

  it("question without a response is skipped silently", () => {
    const result = buildTemplateVariables(
      [
        {
          key: "x",
          type: "text",
          templateVariableMappings: [{ templateId: "tmpl1" as any, variableName: "x" }],
        },
      ],
      []
    );
    expect(result.size).toBe(0);
  });
});
