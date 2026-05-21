import { QueryCtx, MutationCtx } from "../_generated/server";

export async function requireAuth(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("No autenticado. Inicia sesión para continuar.");
  }
  return identity;
}

export async function getOrgId(ctx: QueryCtx | MutationCtx): Promise<string> {
  const identity = await requireAuth(ctx);
  // Clerk JWT may use org_id (snake_case) or orgId (camelCase) depending on version
  const orgId = (identity.orgId ?? (identity as Record<string, unknown>).org_id) as string | undefined;
  if (!orgId) {
    throw new Error("No se encontró la organización. Selecciona una organización.");
  }
  return orgId;
}

/**
 * Safe version for queries - returns null instead of throwing
 * so Convex reactive queries don't error before auth is ready.
 */
export async function getOrgIdSafe(ctx: QueryCtx | MutationCtx): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return ((identity.orgId ?? (identity as Record<string, unknown>).org_id) as string | undefined) ?? null;
}

export async function requireAdmin(ctx: QueryCtx | MutationCtx) {
  const identity = await requireAuth(ctx);
  const role = (identity.orgRole as string) ?? "org:member";
  if (role !== "org:admin") {
    throw new Error("Acceso denegado. Se requiere rol de Administrador.");
  }
  return identity;
}

export async function requireSuperAdmin(ctx: QueryCtx | MutationCtx) {
  const identity = await requireAuth(ctx);
  if (!isSuperAdminFromIdentity(identity)) {
    throw new Error("Acceso denegado. Se requiere rol de Super Admin.");
  }
  return identity;
}

/**
 * Stateless super-admin check from a Clerk identity object. Reuse this in
 * queries/mutations/actions where you already have the identity in hand and
 * want to branch instead of throw. Mirrors the role-detection logic in
 * `requireSuperAdmin` (publicMetadata.role | metadata.role === "super_admin").
 */
export function isSuperAdminFromIdentity(identity: unknown): boolean {
  if (!identity || typeof identity !== "object") return false;
  const id = identity as Record<string, unknown>;
  const publicMeta = id.publicMetadata as Record<string, unknown> | undefined;
  const customMeta = id.metadata as Record<string, unknown> | undefined;
  const role = publicMeta?.role ?? customMeta?.role;
  return role === "super_admin";
}
