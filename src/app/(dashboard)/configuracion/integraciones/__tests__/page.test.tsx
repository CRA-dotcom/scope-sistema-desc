/**
 * Source-level tests for `/configuracion/integraciones` hub (D2 §4.4).
 *
 * Verifies the provider hub structure: Resend + Firmame + Railway cards,
 * status chips, Firmame "Backlog post-beta" banner, and defensive masking
 * (only `apiKeyMasked` is ever rendered — never `apiKeySecretRef`).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_PATH = resolve(__dirname, "../page.tsx");
const source = readFileSync(SOURCE_PATH, "utf-8");

describe("/configuracion/integraciones — hub contract (D2 §4.4)", () => {
  it("exports a default function component", () => {
    expect(source).toMatch(
      /export default function IntegracionesPage\s*\(\s*\)/
    );
  });

  it("is a client component", () => {
    expect(source).toContain('"use client"');
  });

  it("queries listForOrg + getRailwayInfo from Convex", () => {
    expect(source).toMatch(
      /useQuery\(\s*api\.functions\.orgIntegrations\.queries\.listForOrg/
    );
    expect(source).toMatch(
      /useQuery\(\s*api\.functions\.orgIntegrations\.queries\.getRailwayInfo/
    );
  });

  it("renders three provider cards: Resend, Firmame, Railway", () => {
    expect(source).toContain('data-testid="integration-card-resend"');
    expect(source).toContain('data-testid="integration-card-firmame"');
    expect(source).toContain('data-testid="integration-card-railway"');
  });

  it("links Resend card to the existing /configuracion/integraciones/resend page", () => {
    expect(source).toMatch(/href="\/configuracion\/integraciones\/resend"/);
  });
});

describe("/configuracion/integraciones — auth gate", () => {
  it("redirects non-admins back to /configuracion", () => {
    expect(source).toContain('membership?.role === "org:admin"');
    expect(source).toMatch(/router\.replace\(\s*"\/configuracion"\s*\)/);
  });
});

describe("/configuracion/integraciones — Firmame card (spec §4.4)", () => {
  it("shows the literal Backlog post-beta banner text (spec §7)", () => {
    // The text is split across two lines in JSX prose so we match it via a
    // regex that tolerates a soft-wrapped line break + indentation.
    expect(source).toMatch(
      /Backlog post-beta\s+—\s+credenciales se guardan,\s+la integración\s+real se\s+conecta post-beta\./
    );
  });

  it("renders a 'No configurado' chip when Firmame row is absent", () => {
    expect(source).toContain('"No configurado"');
  });

  it("opens the Firmame configure dialog from the hub button", () => {
    expect(source).toContain('data-testid="firmame-configure-btn"');
    expect(source).toContain('data-testid="firmame-save-btn"');
    expect(source).toContain('data-testid="firmame-test-btn"');
  });

  it("wires upsertFirmameConfig + testFirmameConnection actions", () => {
    expect(source).toMatch(
      /useMutation\(\s*api\.functions\.orgIntegrations\.mutations\.upsertFirmameConfig/
    );
    expect(source).toMatch(
      /useAction\(\s*api\.functions\.orgIntegrations\.actions\.testFirmameConnection/
    );
  });
});

describe("/configuracion/integraciones — defensive masking (spec §7)", () => {
  it("only references apiKeyMasked, never apiKeySecretRef", () => {
    expect(source).toContain("apiKeyMasked");
    expect(source).not.toMatch(/apiKeySecretRef/);
    expect(source).not.toMatch(/webhookSecretRef/);
  });

  it("a11y: Firmame dialog is role=dialog aria-modal and closes on Escape", () => {
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toMatch(/e\.key\s*===\s*"Escape"/);
  });
});
