/**
 * Source-level tests for `/configuracion/branding` (D2 §4.3).
 *
 * Verifies the org-admin wrapper around the shared `BrandingForm` component
 * + correct wiring to the org-admin path of `orgBranding.upsert` (no `orgId`
 * arg) and the storage upload flow.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PAGE_SOURCE = readFileSync(
  resolve(__dirname, "../page.tsx"),
  "utf-8"
);
const FORM_SOURCE = readFileSync(
  resolve(
    __dirname,
    "../../../../../../src/components/branding/BrandingForm.tsx"
  ),
  "utf-8"
);

describe("/configuracion/branding — page contract (D2 §4.3)", () => {
  it("exports a default function component", () => {
    expect(PAGE_SOURCE).toMatch(
      /export default function BrandingPage\s*\(\s*\)/
    );
  });

  it("is a client component (Convex + Clerk hooks)", () => {
    expect(PAGE_SOURCE).toContain('"use client"');
  });

  it("redirects non-admins back to /configuracion", () => {
    expect(PAGE_SOURCE).toContain('membership?.role === "org:admin"');
    expect(PAGE_SOURCE).toMatch(/router\.replace\(\s*"\/configuracion"\s*\)/);
  });

  it("reads the org's branding via org-admin path (no orgId arg)", () => {
    expect(PAGE_SOURCE).toMatch(
      /useQuery\(\s*api\.functions\.orgBranding\.queries\.getByOrgId/
    );
    // Resolves the logo URL using getLogoUrl which P1 backend guards by org.
    expect(PAGE_SOURCE).toMatch(
      /useQuery\(\s*api\.functions\.orgBranding\.queries\.getLogoUrl/
    );
  });

  it("calls upsert without passing orgId (server uses caller's own org)", () => {
    const upsertCall = PAGE_SOURCE.match(/await\s+upsertBranding\(\{[\s\S]*?\}\);/);
    expect(upsertCall).toBeTruthy();
    expect(upsertCall![0]).not.toMatch(/\borgId:/);
  });

  it("renders the shared BrandingForm with mode='org'", () => {
    expect(PAGE_SOURCE).toMatch(/<BrandingForm[\s\S]*?mode="org"[\s\S]*?\/>/);
    expect(PAGE_SOURCE).toContain(
      'from "@/components/branding/BrandingForm"'
    );
  });
});

describe("BrandingForm component (D2 §4.3 shared)", () => {
  it("exports a named BrandingForm function for both org + platform paths", () => {
    expect(FORM_SOURCE).toMatch(/export function BrandingForm\s*\(/);
    expect(FORM_SOURCE).toMatch(
      /mode:\s*"org"\s*\|\s*"platform"/
    );
  });

  it("caps logo upload at 1MB client-side (spec §7)", () => {
    // MAX_LOGO_BYTES constant + check before invoking onUpload.
    expect(FORM_SOURCE).toMatch(
      /MAX_LOGO_BYTES\s*=\s*1\s*\*\s*1024\s*\*\s*1024/
    );
    expect(FORM_SOURCE).toMatch(/file\.size\s*>\s*MAX_LOGO_BYTES/);
    expect(FORM_SOURCE).toContain('"El logo no puede exceder 1MB."');
    // Help text reflects the new cap (not the legacy 2MB).
    expect(FORM_SOURCE).toContain("Max 1MB.");
  });

  it("validates hex colors before saving", () => {
    expect(FORM_SOURCE).toMatch(/HEX_COLOR_REGEX\s*=\s*\/\^#\[0-9a-fA-F\]\{6\}\$\//);
    expect(FORM_SOURCE).toContain("color primario debe ser un hex válido");
    expect(FORM_SOURCE).toContain("color secundario debe ser un hex válido");
  });

  it("declares discoverable testids for the save button + logo input", () => {
    expect(FORM_SOURCE).toContain('data-testid="branding-save-btn"');
    expect(FORM_SOURCE).toContain('data-testid="branding-logo-input"');
  });

  it("renders the live preview inline (no puppeteer per spec §8 Q2)", () => {
    // Spec §8 Q2 — preview is HTML/CSS inline, no PDF roundtrip.
    expect(FORM_SOURCE).not.toMatch(/puppeteer/i);
    expect(FORM_SOURCE).toContain("Vista Previa");
  });
});
