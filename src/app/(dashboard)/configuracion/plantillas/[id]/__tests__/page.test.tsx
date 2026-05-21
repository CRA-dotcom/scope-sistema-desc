/**
 * Source-level tests for `/configuracion/plantillas/[id]` editor page
 * (A2 Phase 2). Mirrors the readFileSync + regex pattern from A1
 * (configuracion/subservicios/__tests__/page.test.tsx) since
 * @testing-library/react is not installed in the project.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_PATH = resolve(__dirname, "../page.tsx");
const source = readFileSync(SOURCE_PATH, "utf-8");

describe("/configuracion/plantillas/[id] — editor contract", () => {
  it("exports a default function component", () => {
    expect(source).toMatch(
      /export default function EditarPlantillaPage\s*\(\s*\)/
    );
  });

  it("is a client component", () => {
    expect(source).toContain('"use client"');
  });

  it("reads the row through getByIdWithBanner (banner metadata)", () => {
    expect(source).toMatch(
      /useQuery\(\s*api\.functions\.deliverableTemplates\.queries\.getByIdWithBanner/
    );
  });

  it("wires the update mutation", () => {
    expect(source).toMatch(
      /useMutation\(\s*api\.functions\.deliverableTemplates\.mutations\.update/
    );
  });

  it("reads :id from useParams (Next.js dynamic route)", () => {
    expect(source).toMatch(
      /params\.id\s*as\s*Id<"deliverableTemplates">/
    );
  });
});

describe("/configuracion/plantillas/[id] — expectedVersion tracking (R15)", () => {
  it("tracks savedVersion state from data.template.version", () => {
    expect(source).toMatch(/setSavedVersion\(tpl\.version\)/);
  });

  it("passes expectedVersion to update mutation on Guardar", () => {
    expect(source).toMatch(/expectedVersion:\s*savedVersion/);
  });

  it("update sends a patch object (matching A2 mutation signature {id, expectedVersion, patch})", () => {
    expect(source).toMatch(
      /updateTemplate\(\{[\s\S]*?id,[\s\S]*?expectedVersion:[\s\S]*?patch:\s*\{/
    );
  });
});

describe("/configuracion/plantillas/[id] — banner: hasNewerGlobal", () => {
  it("renders banner only when data.hasNewerGlobal is true", () => {
    expect(source).toMatch(/\{data\.hasNewerGlobal\s*&&/);
    expect(source).toContain('data-testid="banner-newer-global"');
  });

  it("banner text includes 'personalizada' and 'global disponible'", () => {
    expect(source).toContain("personalizada");
    expect(source).toContain("global disponible");
  });

  it("'Ver cambios' opens the diff modal (side-by-side <pre> blocks, no diff lib)", () => {
    expect(source).toContain("Ver cambios");
    expect(source).toContain("DiffModal");
    // Beta: no diff library, just two <pre> blocks side-by-side per spec §4.2.
    expect(source).toContain("Tu versión personalizada");
    expect(source).toMatch(/<pre[^>]*>[\s\S]*?\{orgHtml\}[\s\S]*?<\/pre>/);
    expect(source).toMatch(/<pre[^>]*>[\s\S]*?parentHtml[\s\S]*?<\/pre>/);
  });

  it("diff modal right pane reads data.globalHtml (no hardcoded placeholder)", () => {
    // Spec §4.2 + §8 R2: the right pane must show the actual parent global's
    // htmlTemplate as exposed by getByIdWithBanner. Before this fix it was
    // hardcoded to null with a fallback placeholder string.
    expect(source).toMatch(/parentHtml[^=]*=\s*data\?\.globalHtml/);
    expect(source).not.toContain(
      "El HTML del global se cargará en una versión futura"
    );
  });
});

describe("/configuracion/plantillas/[id] — banner: stale concurrency", () => {
  it("catches 'Versión obsoleta' from update and shows the stale banner", () => {
    expect(source).toMatch(/msg\.includes\("Versión obsoleta"\)/);
    expect(source).toMatch(/setStaleError\(true\)/);
  });

  it("stale banner is only rendered when staleError is true", () => {
    expect(source).toMatch(/\{staleError\s*&&/);
    expect(source).toContain('data-testid="banner-stale"');
  });

  it("Recargar button resets local form so the live query re-hydrates", () => {
    expect(source).toContain("Recargar");
    expect(source).toMatch(/handleReload/);
    expect(source).toMatch(/setForm\(null\)/);
    expect(source).toMatch(/setStaleError\(false\)/);
  });

  it("Guardar button is disabled while staleError is active", () => {
    expect(source).toMatch(/disabled=\{saving\s*\|\|\s*staleError\}/);
  });
});

describe("/configuracion/plantillas/[id] — auto-extract placeholders warning", () => {
  it("uses extractPlaceholders from src/lib/templateResolver (NOT convex/lib)", () => {
    expect(source).toContain(
      'from "@/lib/templateResolver"'
    );
    expect(source).toContain("extractPlaceholders");
  });

  it("filters out branding_* placeholders from the undeclared warning", () => {
    // Per convex/lib/templatePlaceholders.ts, branding_* tokens live in CSS
    // and are resolved by the renderer, not declared in variables[].
    expect(source).toMatch(/!k\.startsWith\("branding_"\)/);
  });

  it("renders the undeclared warning only when there are undeclared keys", () => {
    expect(source).toMatch(
      /undeclaredPlaceholders\.length\s*>\s*0\s*&&/
    );
    expect(source).toContain('data-testid="undeclared-warning"');
  });
});

describe("/configuracion/plantillas/[id] — vista previa modal", () => {
  it("renders preview in an iframe with sandbox=allow-same-origin", () => {
    expect(source).toContain("sandbox=\"allow-same-origin\"");
    expect(source).toContain("srcDoc={html}");
  });

  it("calls resolveTemplate + generateSampleContext to build preview HTML", () => {
    expect(source).toContain("generateSampleContext");
    expect(source).toContain("resolveTemplate");
  });

  it("preview only renders when previewHtml !== null", () => {
    expect(source).toMatch(/previewHtml\s*!==\s*null/);
  });
});

describe("/configuracion/plantillas/[id] — dirty-form guard on Cancelar", () => {
  it("computes isDirty by comparing form against initialSnapshot", () => {
    expect(source).toMatch(/isDirty/);
    expect(source).toMatch(
      /JSON\.stringify\(form\)\s*!==\s*JSON\.stringify\(initialSnapshot\)/
    );
  });

  it("Cancelar opens ConfirmDirtyDialog when isDirty, else pushes back immediately", () => {
    expect(source).toContain("ConfirmDirtyDialog");
    expect(source).toMatch(/if\s*\(isDirty\)/);
    expect(source).toMatch(
      /router\.push\("\/configuracion\/plantillas"\)/
    );
  });
});

describe("/configuracion/plantillas/[id] — editor type field hides invoice", () => {
  it("type select options do NOT include 'invoice' (operator UI hides it)", () => {
    expect(source).toMatch(/Exclude<TemplateType,\s*"invoice">/);
    // TYPE_LABELS map should also be typed without invoice.
    expect(source).toMatch(
      /TYPE_LABELS:\s*Record<Exclude<TemplateType,\s*"invoice">/
    );
  });

  it("rejects invoice rows at editor mount (no silent type coercion)", () => {
    // The early-return branch must run BEFORE the form is hydrated so the
    // operator never sees an invoice row coerced to 'deliverable_short'.
    expect(source).toMatch(
      /data\.template\?\.type\s*===\s*"invoice"/
    );
    expect(source).toContain('data-testid="banner-invoice-rejected"');
    expect(source).toContain("Esta plantilla no puede editarse desde aquí.");
    // The old silent-coercion branch in the form hydrator must be gone.
    expect(source).not.toMatch(
      /tpl\.type\s*===\s*"invoice"\s*\?\s*"deliverable_short"/
    );
  });
});

describe("/configuracion/plantillas/[id] — stable keys on variable rows", () => {
  it("declares an EditorVariable type with an id field for React keys", () => {
    expect(source).toMatch(/type\s+EditorVariable\s*=\s*Variable\s*&\s*\{\s*id:\s*string\s*\}/);
  });

  it("uses v.id (not array index) as the React key for variable rows", () => {
    expect(source).toMatch(/key=\{v\.id\}/);
    expect(source).not.toMatch(/key=\{i\}/);
  });

  it("strips the editor-only id field before sending the mutation", () => {
    // The schema validator only accepts {key, label, source, required}.
    expect(source).toMatch(/sanitizedVariables/);
    expect(source).toMatch(/\{\s*id:\s*_id,\s*\.\.\.rest\s*\}/);
  });

  it("stamps a new id when adding a variable row", () => {
    expect(source).toMatch(/\.\.\.EMPTY_VAR,\s*id:\s*newRowId\(\)/);
  });
});

describe("/configuracion/plantillas/[id] — a11y", () => {
  it("all dialogs declare role=dialog + aria-modal", () => {
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
  });

  it("Escape key closes modals", () => {
    expect(source).toMatch(/e\.key\s*===\s*"Escape"/);
  });

  it("inputs have associated <label htmlFor=...>", () => {
    expect(source).toMatch(/<label\s+htmlFor="tpl-name"/);
    expect(source).toMatch(/<label\s+htmlFor="tpl-type"/);
    expect(source).toMatch(/<label\s+htmlFor="tpl-html"/);
  });
});
