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

// ─── D4: populateTemplateVariables helper-level tests ─────────────────────────
// The Convex mutation itself (ctx.db, ctx.storage) requires the convex-test
// scaffolding which is not present in this project, so integration testing is
// deferred to manual smoke. These tests validate the pure helper transformations
// that D4 depends on, including the _storageId → _url rename convention.

describe("D4 — _storageId resolution contract (populateVariables helper logic)", () => {
  /**
   * Simulates what populateTemplateVariables does after calling
   * buildTemplateVariables: strips _storageId keys and replaces them with
   * _url keys (as if ctx.storage.getUrl resolved successfully).
   */
  function simulateStorageResolution(
    vars: Record<string, string>,
    urlResolver: (storageId: string) => string | null
  ): Record<string, string> {
    const resolved: Record<string, string> = {};
    for (const [key, value] of Object.entries(vars)) {
      if (key.endsWith("_storageId")) {
        const baseName = key.replace(/_storageId$/, "");
        const url = urlResolver(value);
        if (url) {
          resolved[`${baseName}_url`] = url;
        }
        // raw _storageId is intentionally dropped
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }

  it("converts _storageId to _url using the resolved URL", () => {
    const vars = { actas_storageId: "stor_abc", actas_filename: "acta.pdf" };
    const result = simulateStorageResolution(
      vars,
      (id) => `https://cdn.example.com/${id}`
    );
    expect(result.actas_url).toBe("https://cdn.example.com/stor_abc");
    expect(result.actas_filename).toBe("acta.pdf");
    expect(result.actas_storageId).toBeUndefined();
  });

  it("drops _storageId key when the URL resolver returns null (e.g. expired)", () => {
    const vars = { actas_storageId: "stor_missing" };
    const result = simulateStorageResolution(vars, () => null);
    expect(result.actas_url).toBeUndefined();
    expect(result.actas_storageId).toBeUndefined();
  });

  it("preserves non-storage text variables untouched", () => {
    const vars = { razon_social: "ACME SA", rfc: "ACM123456" };
    const result = simulateStorageResolution(vars, () => "https://x.com");
    expect(result).toEqual({ razon_social: "ACME SA", rfc: "ACM123456" });
  });

  it("handles mixed storage and text variables in one template", () => {
    const vars = {
      logo_storageId: "stor_logo",
      logo_filename: "logo.png",
      company_name: "TechCorp",
    };
    const result = simulateStorageResolution(
      vars,
      (id) => `https://files.example.com/${id}`
    );
    expect(result.logo_url).toBe("https://files.example.com/stor_logo");
    expect(result.logo_filename).toBe("logo.png");
    expect(result.company_name).toBe("TechCorp");
    expect(result.logo_storageId).toBeUndefined();
  });

  it("returns empty object when given no variables", () => {
    const result = simulateStorageResolution({}, () => "https://x.com");
    expect(result).toEqual({});
  });

  it("full roundtrip: buildTemplateVariables + storage resolution for file_upload", () => {
    const rawMap = buildTemplateVariables(
      [
        {
          key: "contrato",
          type: "file_upload",
          templateVariableMappings: [
            { templateId: "t1" as any, variableName: "contrato" },
          ],
        },
        {
          key: "nombre_empresa",
          type: "text",
          templateVariableMappings: [
            { templateId: "t1" as any, variableName: "nombre_empresa" },
          ],
        },
      ],
      [
        { questionKey: "contrato", value: "stor_xyz", filename: "contrato-firmado.pdf" },
        { questionKey: "nombre_empresa", value: "ACME Consulting" },
      ]
    );

    const rawVars = rawMap.get("t1" as any)!;
    expect(rawVars.contrato_storageId).toBe("stor_xyz");
    expect(rawVars.contrato_filename).toBe("contrato-firmado.pdf");
    expect(rawVars.nombre_empresa).toBe("ACME Consulting");

    // Simulate what the mutation does with ctx.storage.getUrl
    const resolved = simulateStorageResolution(
      rawVars,
      (id) => `https://cdn.convex.cloud/files/${id}`
    );
    expect(resolved.contrato_url).toBe("https://cdn.convex.cloud/files/stor_xyz");
    expect(resolved.contrato_filename).toBe("contrato-firmado.pdf");
    expect(resolved.nombre_empresa).toBe("ACME Consulting");
    expect(resolved.contrato_storageId).toBeUndefined();
  });
});
