/**
 * Source-level tests for `/platform/audit` super-admin page.
 *
 * Same pattern as A1/A2 page tests: read the file, assert structural contracts
 * (filters wired, severity badges, paginated cursor, empty-state Q7 default).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_PATH = resolve(__dirname, "../page.tsx");
const source = readFileSync(SOURCE_PATH, "utf-8");

describe("/platform/audit — page contract", () => {
  it("is a client component", () => {
    expect(source).toContain('"use client"');
  });

  it("exports a default function component", () => {
    expect(source).toMatch(/export default function AuditPage\s*\(\s*\)/);
  });

  it("queries documentEvents.queries.list (server-side super-admin guard)", () => {
    expect(source).toMatch(
      /useQuery\(\s*\n?\s*api\.functions\.documentEvents\.queries\.list/
    );
  });

  it("populates the Org dropdown from superAdmin.audit.listOrgsForAuditFilter", () => {
    // D1: A3 used organizations.queries.list which leaked extra fields. D1's
    // lightweight helper returns only {clerkOrgId, name} ordered alphabetically.
    expect(source).toMatch(
      /useQuery\(\s*\n?\s*api\.functions\.superAdmin\.audit\.listOrgsForAuditFilter/
    );
  });

  it("uses superAdmin.audit.listClientsForOrg for cross-org Cliente dropdown (D1)", () => {
    // D1 fixes the A3 review gap: clients.queries.list was scoped to the
    // caller's own org. listClientsForOrg is super-admin gated and accepts
    // any orgId so the dropdown surfaces the correct clients of the audited org.
    expect(source).toMatch(
      /useQuery\(\s*\n?\s*api\.functions\.superAdmin\.audit\.listClientsForOrg/
    );
  });
});

describe("/platform/audit — filter wiring", () => {
  it("renders an Org dropdown (required for any results)", () => {
    expect(source).toContain('data-testid="filter-org"');
    expect(source).toContain("Selecciona una organización");
  });

  it("renders a Cliente dropdown", () => {
    expect(source).toContain('data-testid="filter-client"');
  });

  it("renders an Entidad dropdown driven by the shared DOCUMENT_EVENT_ENTITY_TYPES constant (9 types)", () => {
    expect(source).toContain('data-testid="filter-entity"');
    // Entity types are now sourced from convex/lib/documentEventTypes.ts (DRY
    // refactor, SS7 fix). The page imports DOCUMENT_EVENT_ENTITY_TYPES and
    // spreads it into ENTITY_TYPES, so the individual string literals no longer
    // appear inline — verify the import and the spread instead.
    expect(source).toContain("DOCUMENT_EVENT_ENTITY_TYPES");
    expect(source).toContain("documentEventTypes");
    // Labels map must cover all 9 union members including SS7 additions.
    expect(source).toContain('"financial_data"');
    expect(source).toContain('"projection"');
    expect(source).toContain("Proyección");
    expect(source).toContain("Datos financieros");
  });

  it("renders Severity chips (info / warning / error)", () => {
    expect(source).toContain('data-testid="filter-severity"');
    expect(source).toContain('"info"');
    expect(source).toContain('"warning"');
    expect(source).toContain('"error"');
  });

  it("renders a 'Desde' date picker that converts to sinceMs", () => {
    expect(source).toContain('data-testid="filter-since"');
    expect(source).toMatch(/type="date"/);
    expect(source).toMatch(/sinceMs/);
  });

  it("changing any filter resets cursor + accumulated rows", () => {
    expect(source).toContain("function resetWith");
    expect(source).toMatch(/setCursor\(null\)/);
    expect(source).toMatch(/setAccumulated\(\[\]\)/);
  });
});

describe("/platform/audit — pagination", () => {
  it("paginates with cursor state and a 'Cargar más' button", () => {
    expect(source).toContain('data-testid="load-more-btn"');
    expect(source).toContain("Cargar más");
    expect(source).toMatch(/PAGE_SIZE = 50/);
  });

  it("appends pages to accumulated rows via loadMore", () => {
    expect(source).toContain("function loadMore");
    expect(source).toMatch(/setAccumulated\(\(prev\)\s*=>\s*\[\.\.\.prev,\s*\.\.\.result\.rows\]\)/);
  });

  it("shows 'Fin de la lista.' when result.isDone is true", () => {
    expect(source).toContain("Fin de la lista.");
    expect(source).toMatch(/result\.isDone/);
  });
});

describe("/platform/audit — severity badges", () => {
  it("renders a SeverityBadge with info/warning/error styles", () => {
    expect(source).toContain("function SeverityBadge");
    expect(source).toContain('data-testid={`severity-${severity}`}');
    // info → gris (muted), warning → ámbar, error → rojo.
    expect(source).toMatch(/bg-muted text-muted-foreground/);
    expect(source).toMatch(/bg-amber-500\/10 text-amber-400/);
    expect(source).toMatch(/bg-red-500\/10 text-red-400/);
  });
});

describe("/platform/audit — Q7 default empty state", () => {
  it("uses 'skip' for the query until an org is selected", () => {
    // Without an org, the convex query is replaced with the literal "skip"
    // via a ternary `selectedOrgId ? {...} : "skip"`.
    expect(source).toMatch(/selectedOrgId[\s\S]*?: "skip"/);
    expect(source).toContain('"skip"');
  });

  it("shows the 'Selecciona una organización' empty state by default", () => {
    expect(source).toContain("Selecciona una organización para ver eventos.");
  });
});

describe("/platform/audit — row expansion", () => {
  it("expanding a row shows metadata JSON in a <pre> block", () => {
    expect(source).toContain("function FragmentRow");
    expect(source).toContain("setExpandedRow");
    expect(source).toMatch(/data-testid=\{`audit-metadata-\$\{event\._id\}`\}/);
    expect(source).toMatch(/JSON\.stringify\(event\.metadata,\s*null,\s*2\)/);
  });

  it("audit row is keyboard-accessible (Enter/Space toggles expansion)", () => {
    // Fix #6: row must be reachable via Tab and respond to Enter/Space.
    expect(source).toMatch(/tabIndex=\{0\}/);
    expect(source).toMatch(/role="button"/);
    expect(source).toMatch(/aria-expanded=\{expanded\}/);
    expect(source).toMatch(/aria-controls=\{detailsId\}/);
    // onKeyDown handles Enter and Space + prevents default scroll.
    expect(source).toMatch(/onKeyDown=\{\(e\)\s*=>\s*\{[\s\S]*?Enter[\s\S]*?" "[\s\S]*?preventDefault/);
  });
});

describe("/platform/audit — pagination flash guard", () => {
  it("uses a pendingMore flag so 'Cargar más' never flashes the same page twice", () => {
    // Fix #5: between the click and the next Convex tick, result.rows is
    // stale (= current page). We render only `accumulated` while pendingMore
    // is true, then drop the flag once a new result lands.
    expect(source).toMatch(/pendingMore/);
    expect(source).toMatch(/setPendingMore\(true\)/);
    expect(source).toMatch(/setPendingMore\(false\)/);
  });
});

describe("/platform/audit — cross-org Cliente dropdown (D1)", () => {
  it("no longer needs the 'Solo lista clientes de tu organización actual' note", () => {
    // D1 replaced clients.queries.list with superAdmin.audit.listClientsForOrg,
    // which is super-admin gated and accepts any orgId. The cross-org note
    // (and the useOrganization dependency that drove it) are obsolete.
    expect(source).not.toContain(
      "Solo lista clientes de tu organización actual."
    );
    expect(source).not.toContain('data-testid="filter-client-other-org-note"');
    expect(source).not.toMatch(/useOrganization/);
  });
});

describe("/platform/audit — datetime helper", () => {
  it("formats createdAt via the shared formatLocalDateTime helper", () => {
    expect(source).toMatch(/import\s*\{\s*formatLocalDateTime\s*\}/);
    expect(source).toMatch(/formatLocalDateTime\(event\.createdAt\)/);
  });
});
