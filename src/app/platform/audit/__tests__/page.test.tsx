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

  it("populates the Org dropdown from organizations.queries.list", () => {
    expect(source).toMatch(
      /useQuery\(api\.functions\.organizations\.queries\.list\)/
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

  it("renders an Entidad dropdown with all 7 entityType options", () => {
    expect(source).toContain('data-testid="filter-entity"');
    // ENTITY_TYPES array must list all 7 union members per schema §2.3.
    expect(source).toContain('"deliverable"');
    expect(source).toContain('"invoice"');
    expect(source).toContain('"quotation"');
    expect(source).toContain('"contract"');
    expect(source).toContain('"template"');
    expect(source).toContain('"subservice"');
    expect(source).toContain('"questionnaire"');
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

describe("/platform/audit — cliente cross-org note", () => {
  it("shows the 'Solo lista clientes de tu organización actual' note when viewing another org", () => {
    // Fix #8: small muted note appears when the selected audit-target org
    // does not match the caller's current Clerk org.
    expect(source).toContain("Solo lista clientes de tu organización actual.");
    expect(source).toMatch(/isViewingOtherOrg/);
    expect(source).toContain('data-testid="filter-client-other-org-note"');
    // The check must use the caller's *current* Clerk org id.
    expect(source).toMatch(/useOrganization/);
  });
});

describe("/platform/audit — datetime helper", () => {
  it("formats createdAt via the shared formatLocalDateTime helper", () => {
    expect(source).toMatch(/import\s*\{\s*formatLocalDateTime\s*\}/);
    expect(source).toMatch(/formatLocalDateTime\(event\.createdAt\)/);
  });
});
