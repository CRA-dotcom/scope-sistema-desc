/**
 * Source-level tests for `/configuracion/usuarios` (D2 §4.2).
 *
 * Pattern: vitest + node:fs `readFileSync` + regex (A1/A2 source-level
 * pattern — no RTL installed in this repo).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_PATH = resolve(__dirname, "../page.tsx");
const source = readFileSync(SOURCE_PATH, "utf-8");

describe("/configuracion/usuarios — page contract", () => {
  it("exports a default function component", () => {
    expect(source).toMatch(/export default function UsuariosPage\s*\(\s*\)/);
  });

  it("is a client component (Clerk hooks require client)", () => {
    expect(source).toContain('"use client"');
  });

  it("reads memberships from Clerk useOrganization with infinite pagination", () => {
    expect(source).toMatch(
      /useOrganization\(\{\s*memberships:\s*\{\s*infinite:\s*true,\s*pageSize:\s*50\s*\},?\s*\}\)/
    );
  });

  it("joins Clerk memberships with Convex listAssignmentsForOrg", () => {
    expect(source).toMatch(
      /useQuery\(\s*api\.functions\.users\.queries\.listAssignmentsForOrg/
    );
    // Skips the Convex query until the membership gate passes.
    expect(source).toMatch(/isLoaded\s*&&\s*isAdmin\s*\?\s*\{\}\s*:\s*"skip"/);
  });

  it("renders the Asignar/Desasignar drawer using listAssignedClients", () => {
    expect(source).toMatch(
      /useQuery\(\s*api\.functions\.users\.queries\.listAssignedClients/
    );
    expect(source).toMatch(
      /useMutation\(\s*api\.functions\.users\.mutations\.assignToClient/
    );
    expect(source).toMatch(
      /useMutation\(\s*api\.functions\.users\.mutations\.unassign/
    );
    expect(source).toMatch(/data-testid=\{`user-row-/);
  });
});

describe("/configuracion/usuarios — auth gate (spec §4.2)", () => {
  it("redirects non-admins to /configuracion (mirrors Resend page)", () => {
    expect(source).toContain('membership?.role === "org:admin"');
    expect(source).toMatch(/router\.replace\(\s*"\/configuracion"\s*\)/);
  });

  it("returns null while Clerk is loading or caller is not admin", () => {
    expect(source).toMatch(/if\s*\(!isLoaded\s*\|\|\s*!isAdmin\)\s*return null/);
  });
});

describe("/configuracion/usuarios — Invitar usuario modal (spec §4.2)", () => {
  it("POSTs to /api/clerk/invite-user with email + role payload", () => {
    expect(source).toMatch(/fetch\(\s*"\/api\/clerk\/invite-user"/);
    expect(source).toMatch(/method:\s*"POST"/);
    expect(source).toMatch(/JSON\.stringify\(\{\s*email:[\s\S]*?role[\s\S]*?\}\)/);
  });

  it("validates email format client-side before submit", () => {
    // Same regex as the server (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`).
    expect(source).toMatch(/\/\^\[\^\\s@\]\+@\[\^\\s@\]\+\\\.\[\^\\s@\]\+\$\//);
    expect(source).toContain('"Email inválido."');
  });

  it("restricts role choices to org:admin | org:member only", () => {
    expect(source).toMatch(/"org:admin"\s*\|\s*"org:member"/);
    expect(source).toContain('value="org:member"');
    expect(source).toContain('value="org:admin"');
  });

  it("exposes the invite submit + open buttons with discoverable testids", () => {
    expect(source).toContain('data-testid="invite-user-btn"');
    expect(source).toContain('data-testid="invite-submit-btn"');
  });

  it("dialogs declare role=dialog aria-modal and close on Escape", () => {
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toMatch(/e\.key\s*===\s*"Escape"/);
  });
});

describe("/configuracion/usuarios — OrganizationSwitcher race (spec §7)", () => {
  it("closes the invite modal + drops user selection when organization?.id changes", () => {
    // Effect listens on organization?.id and resets selection + modal flag.
    expect(source).toMatch(
      /useEffect\(\(\)\s*=>\s*\{[\s\S]*?setSelectedUserId\(null\)[\s\S]*?setInviteOpen\(false\)[\s\S]*?\}\s*,\s*\[orgIdKey\]\)/
    );
  });
});
