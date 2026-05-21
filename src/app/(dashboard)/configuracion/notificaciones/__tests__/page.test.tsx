/**
 * Source-level tests for `/configuracion/notificaciones` (D2 §4.5).
 *
 * Verifies the form persists via `updateNotificationPreferences`, the
 * "Enviar prueba" button calls `sendTestNotification`, and the form
 * validates email + hour client-side.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_PATH = resolve(__dirname, "../page.tsx");
const source = readFileSync(SOURCE_PATH, "utf-8");

describe("/configuracion/notificaciones — page contract", () => {
  it("exports a default function component", () => {
    expect(source).toMatch(
      /export default function NotificacionesPage\s*\(\s*\)/
    );
  });

  it("is a client component", () => {
    expect(source).toContain('"use client"');
  });

  it("reads orgConfigs.getByOrgId to hydrate the form", () => {
    expect(source).toMatch(
      /useQuery\(\s*api\.functions\.orgConfigs\.queries\.getByOrgId/
    );
  });

  it("wires the updateNotificationPreferences mutation for save", () => {
    expect(source).toMatch(
      /useMutation\(\s*api\.functions\.orgConfigs\.mutations\.updateNotificationPreferences/
    );
    expect(source).toContain('data-testid="notif-save-btn"');
  });

  it("wires the sendTestNotification action for the 'Enviar prueba' button", () => {
    expect(source).toMatch(
      /useAction\(\s*api\.functions\.orgConfigs\.actions\.sendTestNotification/
    );
    expect(source).toContain('data-testid="notif-test-btn"');
    expect(source).toContain("Enviar email de prueba");
  });
});

describe("/configuracion/notificaciones — auth gate", () => {
  it("redirects non-admins back to /configuracion", () => {
    expect(source).toContain('membership?.role === "org:admin"');
    expect(source).toMatch(/router\.replace\(\s*"\/configuracion"\s*\)/);
  });
});

describe("/configuracion/notificaciones — validation (spec §4.5)", () => {
  it("validates email format client-side with the same regex as the server", () => {
    expect(source).toMatch(/\/\^\[\^\\s@\]\+@\[\^\\s@\]\+\\\.\[\^\\s@\]\+\$\//);
    expect(source).toContain('"Email inválido."');
  });

  it("validates hour range 0-23 client-side", () => {
    expect(source).toMatch(/hour\s*<\s*0\s*\|\|\s*hour\s*>\s*23/);
    expect(source).toContain("La hora debe estar entre 0 y 23.");
  });

  it("blocks 'Enviar prueba' when no email is set (spec §4.5)", () => {
    expect(source).toContain("Guarda un email destino antes de probar.");
  });
});

describe("/configuracion/notificaciones — event toggles (spec §4.5)", () => {
  it("renders three event-toggle checkboxes with discoverable testids", () => {
    expect(source).toContain('data-testid="notif-toggle-deliverable"');
    expect(source).toContain('data-testid="notif-toggle-invoice"');
    expect(source).toContain('data-testid="notif-toggle-quotation"');
  });

  it("persists toggle values via the notify* args (Phase 1 schema delta)", () => {
    const updateCall = source.match(/await\s+updatePrefs\(\{[\s\S]*?\}\);/);
    expect(updateCall).toBeTruthy();
    expect(updateCall![0]).toMatch(/notifyOnDeliverableGenerated:/);
    expect(updateCall![0]).toMatch(/notifyOnInvoicePaid:/);
    expect(updateCall![0]).toMatch(/notifyOnQuotationAccepted:/);
    expect(updateCall![0]).toMatch(/reminderHourLocal:/);
  });
});
