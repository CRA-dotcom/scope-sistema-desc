/**
 * Source-level tests for the A3 refactored `/facturacion` page.
 *
 * Same pattern as `src/app/(dashboard)/configuracion/subservicios/__tests__/page.test.tsx`:
 * read the source and assert structural contracts (queries wired, columns
 * present, dialogs and badges rendered for each invoice lifecycle state).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_PATH = resolve(__dirname, "../page.tsx");
const source = readFileSync(SOURCE_PATH, "utf-8");

describe("/facturacion — page contract", () => {
  it("is a client component (Convex hooks require client)", () => {
    expect(source).toContain('"use client"');
  });

  it("exports a default function component", () => {
    expect(source).toMatch(/export default function FacturacionPage\s*\(\s*\)/);
  });

  it("queries billing assignments via listForInvoiceTracking", () => {
    expect(source).toMatch(
      /useQuery\(\s*api\.functions\.monthlyAssignments\.billingQueries\.listForInvoiceTracking/
    );
  });

  it("queries invoices via listForBilling to cross-reference rows", () => {
    expect(source).toMatch(
      /useQuery\(\s*api\.functions\.invoices\.queries\.listForBilling/
    );
  });
});

describe("/facturacion — legacy dropdown removed", () => {
  it("does NOT render the legacy invoice status <select> dropdown", () => {
    // The old code wired a <select> bound to monthlyAssignments.updateInvoiceStatus.
    // After the A3 refactor the dropdown is gone (decision 2026-05-20).
    expect(source).not.toMatch(
      /onChange=\{[^}]*handleStatusChange[^}]*\}/
    );
    // The old column header text must not appear in the table head.
    expect(source).not.toMatch(/text-center font-medium">Estado Factura</);
    // The mutation alias must not be used to drive a dropdown.
    expect(source).not.toMatch(
      /useMutation\(\s*api\.functions\.monthlyAssignments\.mutations\.updateInvoiceStatus/
    );
  });
});

describe("/facturacion — Factura PDF column", () => {
  it("renders a 'Factura PDF' column between 'Monto' and 'Estado Entrega'", () => {
    // Order check: Monto → Factura PDF → Estado Entrega.
    const order = source.indexOf(">Monto<");
    const pdfCol = source.indexOf(">Factura PDF<");
    const estado = source.indexOf(">Estado Entrega<");
    expect(order).toBeGreaterThan(0);
    expect(pdfCol).toBeGreaterThan(order);
    expect(estado).toBeGreaterThan(pdfCol);
  });

  it("renders the InvoicePdfCell component with all four lifecycle states", () => {
    expect(source).toContain("function InvoicePdfCell");
    // No-invoice branch — Subir factura button.
    expect(source).toContain("Subir factura");
    // uploaded badge + Marcar pagada button.
    expect(source).toContain('data-testid="badge-uploaded"');
    expect(source).toContain("Marcar pagada");
    // paid badge.
    expect(source).toContain('data-testid="badge-paid"');
    // void badge (deshabilitado link).
    expect(source).toContain('data-testid="badge-void"');
    expect(source).toContain("Anulada");
  });

  it("uses signed URL action to open the invoice PDF (Ver link)", () => {
    expect(source).toMatch(
      /useAction\(\s*\n?\s*api\.functions\.invoices\.actions\.getDownloadUrl/
    );
  });

  it("groups invoice rows by monthlyAssignmentId and picks the most recent non-void duplicate", () => {
    // Spec: "If multiple invoices exist for a single MA (duplicates), show the
    // most recent non-void."
    expect(source).toContain("monthlyAssignmentId");
    expect(source).toMatch(/invoiceByMaId/);
    expect(source).toMatch(/existingIsVoid|status === "void"/);
  });
});

describe("/facturacion — Upload dialog wiring", () => {
  it("renders an UploadInvoiceDialog modal with role=dialog and aria-modal", () => {
    expect(source).toContain("function UploadInvoiceDialog");
    expect(source).toMatch(/role="dialog"/);
    expect(source).toMatch(/aria-modal="true"/);
  });

  it("uses an <input type='file' accept='application/pdf'>", () => {
    expect(source).toMatch(/type="file"/);
    expect(source).toMatch(/accept="application\/pdf"/);
  });

  it("calls invoices.actions.upload with fileBuffer/contentType/filename/amount", () => {
    expect(source).toMatch(
      /useAction\(api\.functions\.invoices\.actions\.upload\)/
    );
    expect(source).toContain("fileBuffer");
    expect(source).toContain("contentType");
    expect(source).toContain("filename");
    expect(source).toContain("amount,");
  });

  it("reads the file as ArrayBuffer before submit", () => {
    expect(source).toMatch(/await file\.arrayBuffer\(\)/);
  });

  it("client-side validates PDF mime type before uploading", () => {
    expect(source).toMatch(/file\.type !== "application\/pdf"/);
    expect(source).toContain("Solo se aceptan archivos PDF.");
  });

  it("prefills amount from the assignment row", () => {
    expect(source).toMatch(/useState<number>\(assignment\.amount\)/);
  });

  it("does NOT render the legacy notify-client checkbox (deceptive UI removed)", () => {
    // V1 always notifies via the backend action; the checkbox was dead UI.
    expect(source).not.toMatch(/id="invoice-notify"/);
    expect(source).not.toMatch(/setNotify\(/);
    expect(source).not.toMatch(/Notificar cliente con signed URL/);
    // The inline disclaimer is shown instead.
    expect(source).toContain(
      "El cliente recibirá un correo con la factura automáticamente."
    );
  });

  it("rejects zero-amount invoices on the client (server still re-validates)", () => {
    expect(source).toMatch(/amount\s*<=\s*0/);
    expect(source).toContain("El monto debe ser mayor a $0");
    // The number input min must be >= 0.01 (not 0).
    expect(source).toMatch(/min=\{0\.01\}/);
  });

  it("shows a warning when the upload returns duplicateOf", () => {
    expect(source).toMatch(/result\.duplicateOf/);
    expect(source).toContain("Ya existe factura previa");
  });

  it("auto-close after duplicateOf is tracked via useEffect cleanup (no leaked timer)", () => {
    // The previous implementation called setTimeout(() => onClose(), 2500)
    // inline. The fix wraps it in a useEffect whose cleanup clears the timer.
    expect(source).toMatch(/useEffect\(\(\)\s*=>\s*\{[\s\S]*?duplicateOf[\s\S]*?clearTimeout/);
    expect(source).toMatch(/setDuplicateOf\(true\)/);
  });
});

describe("/facturacion — MarkPaid confirm wiring", () => {
  it("renders the MarkPaidConfirm dialog with the spec confirmation text", () => {
    expect(source).toContain("function MarkPaidConfirm");
    expect(source).toContain("¿Marcar la factura como pagada?");
    expect(source).toContain("Esto generará automáticamente el entregable");
  });

  it("wires the markPaid mutation behind the confirm button", () => {
    expect(source).toMatch(
      /useMutation\(api\.functions\.invoices\.mutations\.markPaid\)/
    );
    expect(source).toContain('data-testid="mark-paid-confirm-btn"');
  });

  it("triggers optimistic UI: badge becomes 'Pagada · generando…' for ~30s", () => {
    expect(source).toContain("Pagada · generando…");
    // 30_000 ms timeout per spec §4.1.
    expect(source).toMatch(/30_000|30000/);
    expect(source).toMatch(/paidPendingGen/);
  });

  it("tracks the 30s fallback timer in a ref so unmount cancels it", () => {
    // Map<invoiceId, timeoutId> stored in a ref — see Fix #1.
    expect(source).toMatch(/paidGenTimersRef/);
    expect(source).toMatch(/useRef<Map<[^>]+, number>>/);
    // Cleanup on unmount clears every outstanding timer.
    expect(source).toMatch(/clearTimeout/);
  });

  it("subscribes to deliverables.listByOrg to clear the optimistic badge early", () => {
    // When a deliverable with `triggerInvoiceId === pendingInvoiceId` arrives
    // via the live query, we clear the badge without waiting the full 30s.
    expect(source).toMatch(
      /useQuery\(\s*\n?\s*api\.functions\.deliverables\.queries\.listByOrg/
    );
    expect(source).toMatch(/triggerInvoiceId/);
  });
});

describe("/facturacion — non-mutating sort", () => {
  it("uses a spread copy before .sort() to avoid mutating grouped[] in place", () => {
    // Fix #7: `[...items].sort(...)` instead of `items.sort(...)`.
    expect(source).toMatch(/\[\.\.\.items\]\s*\.sort\(/);
    // Be sure the mutating form is gone.
    expect(source).not.toMatch(/^\s*items\.sort\(/m);
  });
});

describe("/facturacion — Void dialog (admin only)", () => {
  it("renders VoidInvoiceDialog with reason textarea required", () => {
    expect(source).toContain("function VoidInvoiceDialog");
    expect(source).toContain("Anular factura");
    // textarea has id="void-reason" with required attribute somewhere in its
    // tag (self-closing or otherwise).
    expect(source).toMatch(/<textarea[\s\S]*?id="void-reason"[\s\S]*?\/>/);
    expect(source).toMatch(/id="void-reason"[\s\S]{0,200}required/);
  });

  it("wires the markVoid mutation with reason arg", () => {
    expect(source).toMatch(
      /useMutation\(api\.functions\.invoices\.mutations\.markVoid\)/
    );
    expect(source).toMatch(/reason:\s*reason\.trim\(\)/);
  });

  it("admin gate hides the void button + dialog for non-admin members", () => {
    expect(source).toContain('membership?.role === "org:admin"');
    expect(source).toContain("isAdmin");
    // Void button is conditioned on isAdmin.
    expect(source).toMatch(/\{isAdmin && \(\s*<button[\s\S]*?Anular/);
    // The pending dialog is also gated.
    expect(source).toMatch(/pendingVoid && isAdmin/);
  });
});
