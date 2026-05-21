import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * D2 §3.5 — POST /api/clerk/invite-user
 *
 * Org admin invites a new user to their org via Clerk's
 * `createOrganizationInvitation`. Accepts `org:admin` or `org:member` role
 * (R1 §7.3: the custom `"operator"` role maps to `org:admin` in beta).
 *
 * Auth: requires an authenticated session WITH a selected org AND
 * `org:admin` org-role.
 */
export async function POST(req: NextRequest) {
  const { userId, orgId, orgRole } = await auth();
  if (!userId || !orgId) {
    return NextResponse.json(
      { error: "Sin sesión activa o sin organización seleccionada." },
      { status: 401 }
    );
  }
  if (orgRole !== "org:admin") {
    return NextResponse.json(
      { error: "Se requiere rol de Administrador para invitar." },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Body inválido (JSON requerido)." },
      { status: 400 }
    );
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "Body inválido." },
      { status: 400 }
    );
  }
  const { email, role } = body as { email?: unknown; role?: unknown };

  if (typeof email !== "string" || !email.trim()) {
    return NextResponse.json(
      { error: "Email es requerido." },
      { status: 400 }
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return NextResponse.json({ error: "Email inválido." }, { status: 400 });
  }
  if (role !== "org:admin" && role !== "org:member") {
    return NextResponse.json(
      { error: "Rol inválido. Debe ser 'org:admin' o 'org:member'." },
      { status: 400 }
    );
  }

  try {
    const client = await clerkClient();
    const invitation =
      await client.organizations.createOrganizationInvitation({
        organizationId: orgId,
        inviterUserId: userId,
        emailAddress: email.trim(),
        role,
      });
    return NextResponse.json({ ok: true, invitationId: invitation.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
