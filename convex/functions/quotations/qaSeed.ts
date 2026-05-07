"use node";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";
import { hashToken } from "./tokenHelpers";

/**
 * QA-only: create a quotation with a known plaintext token so the public
 * landing route can be visited deterministically for screenshots / manual QA.
 *
 * Refuses to run in production. Idempotent on the token hash (any prior seed
 * row with the same hash is deleted before insert).
 *
 * Usage:
 *   npx convex run quotations/qaSeed:seedForCapture \
 *     '{"orgId":"org_qa_screenshot","plaintextToken":"qa_ready_001","status":"sent"}'
 *
 * Returns: { quotationId, plaintextToken, landingUrl }
 */
export const seedForCapture = internalAction({
  args: {
    orgId: v.string(),
    plaintextToken: v.string(),
    status: v.union(
      v.literal("sent"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("sent_expired") // synthetic: status=sent but tokenExpiresAt in the past
    ),
    declineReason: v.optional(v.string()),
    appUrl: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    quotationId: string;
    plaintextToken: string;
    landingUrl: string;
  }> => {
    // If this guard pattern appears in a third QA file, extract to convex/lib/qaGuard.ts
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "qaSeed (seedForCapture) está deshabilitado en producción. Usa staging/dev."
      );
    }
    // QA-only: refuses to run unless explicitly opted-in via env var.
    // Convex deployments default NODE_ENV to "production" even on dev tier,
    // so we gate on an explicit QA_SEED_ALLOWED=true env var that must be
    // set on the dev deployment only.
    if (process.env.QA_SEED_ALLOWED !== "true") {
      throw new Error(
        "seedForCapture is QA-only and requires QA_SEED_ALLOWED=true (must NOT be set in production)."
      );
    }
    const tokenHash = hashToken(args.plaintextToken);
    const result: { quotationId: string } = await ctx.runMutation(
      internal.functions.quotations.qaSeedMutation.insertSeedRow,
      {
        orgId: args.orgId,
        tokenHash,
        status: args.status,
        declineReason: args.declineReason,
      }
    );
    const appUrl =
      args.appUrl ?? process.env.APP_URL ?? "http://localhost:3000";
    return {
      quotationId: result.quotationId,
      plaintextToken: args.plaintextToken,
      landingUrl: `${appUrl}/q/cotizacion/${args.plaintextToken}`,
    };
  },
});
