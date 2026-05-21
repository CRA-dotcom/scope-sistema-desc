import { action } from "../../_generated/server";
import { internal } from "../../_generated/api";

/**
 * D2 §3.3 — `testFirmameConnection`
 *
 * Beta stub. Firmame is backlog post-beta, so this action only validates
 * that credentials exist + meet a basic format heuristic; it does NOT call
 * the Firmame API. Returns `{ ok: false, reason }` consistently when there
 * is nothing to do, so the UI can show a sensible toast.
 *
 * Auth is enforced inline because `requireAdmin`/`getOrgId` need a
 * Query/MutationCtx (actions get an ActionCtx).
 *
 * Real Firmame ping will live here once we have the SDK + sandbox account
 * (see `project_firma_provider` memory).
 */
export const testFirmameConnection = action({
  args: {},
  handler: async (
    ctx
  ): Promise<{ ok: boolean; reason: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("No autenticado. Inicia sesión para continuar.");
    }
    const role = (identity.orgRole as string) ?? "org:member";
    if (role !== "org:admin") {
      throw new Error("Acceso denegado. Se requiere rol de Administrador.");
    }
    const orgId = (identity.orgId ??
      (identity as Record<string, unknown>).org_id) as string | undefined;
    if (!orgId) {
      throw new Error(
        "No se encontró la organización. Selecciona una organización."
      );
    }

    const config = await ctx.runQuery(
      internal.functions.orgIntegrations.queries.getFirmameConfigInternal,
      { orgId }
    );

    if (!config?.apiKeySecretRef) {
      return {
        ok: false,
        reason: "No hay credenciales configuradas para Firmame.",
      };
    }
    if (config.apiKeySecretRef.length < 16) {
      return {
        ok: false,
        reason: "API key con formato inválido (longitud < 16).",
      };
    }
    return {
      ok: false,
      reason:
        "Backlog post-beta: la verificación real con Firmame estará disponible próximamente.",
    };
  },
});
