import { QueryCtx, MutationCtx } from "../_generated/server";
import { Doc } from "../_generated/dataModel";
import { getOrgIdMutation, requireAdmin, requireSuperAdmin } from "./authHelpers";
import type { UserIdentity } from "convex/server";

/**
 * Verifica que el caller pueda editar el template.
 *
 * - Global (orgId === undefined): solo super_admin.
 * - Org-scoped: requiere org:admin Y mismo orgId que el template.
 *
 * Returns the caller's identity so that callers can attribute audit events
 * (A3 §3.5 — logEvent actorUserId) without re-querying auth.
 *
 * Per A2 §3.1 (docs/superpowers/specs/2026-05-22-templates-operator-access-design.md).
 */
export async function requireTemplateEditAccess(
  ctx: MutationCtx,
  template: Doc<"deliverableTemplates">,
): Promise<UserIdentity> {
  if (template.orgId === undefined) {
    return await requireSuperAdmin(ctx);
  }
  const identity = await requireAdmin(ctx);
  const callerOrg = await getOrgIdMutation(ctx);
  if (template.orgId !== callerOrg) {
    throw new Error("No puedes editar plantillas de otra organización.");
  }
  return identity;
}

/**
 * Lectura: caller puede ver el template si es global o pertenece a su org.
 * Pure helper — no throws. Caller decides how to react (return null / [], etc).
 */
export function canReadTemplate(
  _ctx: QueryCtx,
  template: Doc<"deliverableTemplates">,
  callerOrgId: string | null,
): boolean {
  if (template.orgId === undefined) return true; // global lectura libre a autenticados
  return template.orgId === callerOrgId;
}
