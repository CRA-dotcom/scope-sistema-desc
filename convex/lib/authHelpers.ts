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
 * Mutation-context variant of getOrgId: identical extraction logic, plus a
 * lazy-seed of the `organizations` row if none exists yet for this Clerk org.
 *
 * Defensive backup: the primary seed path is the Clerk webhook
 * (POST /webhooks/clerk → organization.created). If the webhook does not
 * deliver (network failure, webhook config gap, race with very first mutation),
 * this lazy-seed creates the row at the first mutation so crons
 * (monthlyCheck, overdueCheck, notifyFiscalCloseEvents) never silently skip
 * the org. When the webhook fires first, the existing-check makes this a no-op.
 *
 * MUST only be called from mutation handlers (MutationCtx), never from
 * queries or internalQueries — use getOrgId for those.
 */
export async function getOrgIdMutation(ctx: MutationCtx): Promise<string> {
  const identity = await requireAuth(ctx);
  const orgId = (identity.orgId ?? (identity as Record<string, unknown>).org_id) as string | undefined;
  if (!orgId) {
    throw new Error("No se encontró la organización. Selecciona una organización.");
  }
  // Lazy-seed: create organizations row if it doesn't exist yet
  const existing = await ctx.db
    .query("organizations")
    .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", orgId))
    .first();
  if (!existing) {
    const orgName = (identity.orgSlug as string | undefined)
      ?? `Org ${orgId.slice(-6)}`;
    await ctx.db.insert("organizations", {
      clerkOrgId: orgId,
      name: orgName,
      status: "active",
      plan: "basic",
      createdAt: Date.now(),
    });
    console.log(`[getOrgIdMutation] lazy-seeded organizations row for ${orgId}`);
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
