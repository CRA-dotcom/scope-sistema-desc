import { ConvexError } from "convex/values";

/**
 * Extract the Spanish user-facing message from a guard ConvexError.
 * Returns null if the error isn't a guard error with structured data.
 *
 * Codes producidos por el backend:
 * - INVALID_TRANSITION (Phase 3 state machine guards)
 * - COHERENCE_VIOLATION (delivered requires invoice)
 * - HAS_ACTIVE_REFS, HAS_CONTRACT (Phase 1 cascade guards)
 * - Others producidos por mutations específicas
 */
export function extractGuardMessage(err: unknown): string | null {
  if (err instanceof ConvexError && typeof err.data === "object" && err.data !== null) {
    const data = err.data as { code?: string; message?: string };
    if (typeof data.message === "string" && data.message.length > 0) {
      return data.message;
    }
  }
  if (err instanceof Error && typeof err.message === "string") {
    // Strip Convex's "Server Error\n[CONVEX M(...)]" prefix if present
    // Use [\s\S]* instead of .* with /s flag for ES2017 compat
    const stripped = err.message.replace(/^[\s\S]*\[CONVEX [^\]]+\]\s*/, "").trim();
    return stripped || err.message;
  }
  return null;
}
