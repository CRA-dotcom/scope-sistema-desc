/**
 * Static source-level tests for FileUploadField.
 *
 * NOTE: The vitest environment is "edge-runtime" with no DOM/jsdom, and
 * @testing-library/react is not installed, so we cannot mount React components
 * at test time. These tests verify structural and API contracts by reading the
 * component source, consistent with the pattern used elsewhere in this repo
 * (e.g. proyecciones/__tests__/nueva-page.gate.test.tsx).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_PATH = resolve(
  __dirname,
  "../file-upload-field.tsx"
);

const source = readFileSync(SOURCE_PATH, "utf-8");

describe("FileUploadField — exported types and props", () => {
  it("exports FileUploadValue type", () => {
    expect(source).toContain("export type FileUploadValue");
  });

  it("exports FileConfig type", () => {
    expect(source).toContain("export type FileConfig");
  });

  it("exports FileUploadFieldProps with required props", () => {
    expect(source).toContain("export type FileUploadFieldProps");
    expect(source).toContain("questionId: string");
    expect(source).toContain("questionText: string");
    expect(source).toContain("fileConfig: FileConfig");
    expect(source).toContain("uploadFn:");
    expect(source).toContain("onChange:");
    expect(source).toContain("getDownloadUrlFn?:");
  });

  it("exports the FileUploadField function component", () => {
    expect(source).toContain("export function FileUploadField(");
  });
});

describe("FileUploadField — validation logic", () => {
  it("validates max file size using maxSizeMB", () => {
    expect(source).toContain("fileConfig.maxSizeMB");
    expect(source).toContain("excede el límite");
  });

  it("validates accepted MIME types using acceptedMimeTypes", () => {
    expect(source).toContain("fileConfig.acceptedMimeTypes");
    expect(source).toContain("Tipo de archivo no permitido");
  });
});

describe("FileUploadField — UI states", () => {
  it("renders a spinner state (Subiendo...)", () => {
    expect(source).toContain("Subiendo...");
    expect(source).toContain("animate-spin");
  });

  it("renders an upload drop zone with Spanish placeholder", () => {
    expect(source).toContain("+ Subir archivo");
    expect(source).toContain("Zona de carga de archivo");
  });

  it("renders Reemplazar and Eliminar actions on success", () => {
    expect(source).toContain("Reemplazar");
    expect(source).toContain("Eliminar");
  });

  it("renders an error message using role=alert", () => {
    expect(source).toContain('role="alert"');
    expect(source).toContain("text-destructive");
  });

  it("shows image thumbnail on success for image MIME types", () => {
    expect(source).toContain("isImageMime");
    expect(source).toContain("previewUrl");
  });

  it("drag-and-drop handlers are present", () => {
    expect(source).toContain("onDrop={handleDrop}");
    expect(source).toContain("onDragOver={handleDragOver}");
    expect(source).toContain("onDragLeave={handleDragLeave}");
  });
});

describe("FileUploadField — mobile accessibility", () => {
  it("uses a hidden file input with aria-required", () => {
    expect(source).toContain('className="sr-only"');
    expect(source).toContain("aria-required={required}");
  });

  it("drop zone is keyboard-accessible (role=button, tabIndex, onKeyDown)", () => {
    expect(source).toContain('role="button"');
    expect(source).toContain("tabIndex={0}");
    expect(source).toContain("onKeyDown");
  });
});

describe("FileUploadField — memory management", () => {
  it("revokes object URLs on clear to prevent memory leaks", () => {
    expect(source).toContain("URL.revokeObjectURL");
  });
});

describe("convex/functions/storage/upload.ts — backend mutations", () => {
  const backendSource = readFileSync(
    resolve(__dirname, "../../../../convex/functions/storage/upload.ts"),
    "utf-8"
  );

  it("exports generateUploadUrl for authenticated contexts", () => {
    expect(backendSource).toContain("export const generateUploadUrl");
  });

  it("exports generateUploadUrlByToken for public token contexts", () => {
    expect(backendSource).toContain("export const generateUploadUrlByToken");
  });

  it("generateUploadUrlByToken validates token and rejects completed questionnaires", () => {
    expect(backendSource).toContain("by_accessToken");
    expect(backendSource).toContain("completado");
  });

  it("exports getUploadUrl for download URL resolution (authenticated)", () => {
    expect(backendSource).toContain("export const getUploadUrl");
  });

  it("exports getUploadUrlByToken for download URL resolution (public)", () => {
    expect(backendSource).toContain("export const getUploadUrlByToken");
  });
});
