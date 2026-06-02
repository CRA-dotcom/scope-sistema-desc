import { internalMutation } from "../../_generated/server";

/**
 * One-shot cleanup migration: limpia legacy fields que rows existentes en
 * dev/prod aún tienen, permitiendo el drop real del schema.
 *
 * Phase 4 §4.1 cleanup completion. Sin esta migration el deploy fallaba
 * porque dev DB tenía rows con estos campos y el schema sin ellos los
 * rechazaba.
 *
 * Idempotente: skips rows que ya no tienen los campos.
 *
 * Campos cleared:
 * - `projections.seasonalityMode` (write-only legacy, no readers)
 * - `projections.seasonalityDeltas` (read fallback removido en e7de103)
 * - `projectionServices.subserviceId` scalar (helper effectiveSubserviceIds
 *    ya lee solo el array; rows con scalar pero array sin estar backfilled
 *    se sincronizan aquí en un solo paso)
 */
export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    let projModeCleared = 0;
    let projDeltasCleared = 0;
    let psScalarCleared = 0;
    let psArrayBackfilled = 0;

    // projections legacy fields
    const projections = await ctx.db.query("projections").collect();
    for (const p of projections) {
      const patch: Record<string, unknown> = {};
      if ((p as any).seasonalityMode !== undefined) {
        patch.seasonalityMode = undefined;
        projModeCleared++;
      }
      if ((p as any).seasonalityDeltas !== undefined) {
        patch.seasonalityDeltas = undefined;
        projDeltasCleared++;
      }
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(p._id, patch);
      }
    }

    // projectionServices legacy scalar
    const ps = await ctx.db.query("projectionServices").collect();
    for (const row of ps) {
      const scalar = (row as any).subserviceId as
        | { __tableName: "subservices" }
        | undefined;
      if (scalar === undefined) continue;
      const patch: Record<string, unknown> = { subserviceId: undefined };
      psScalarCleared++;
      // Backfill array if missing so we don't lose the relationship
      if (!row.subserviceIds || row.subserviceIds.length === 0) {
        patch.subserviceIds = [scalar];
        psArrayBackfilled++;
      }
      await ctx.db.patch(row._id, patch);
    }

    return {
      projModeCleared,
      projDeltasCleared,
      psScalarCleared,
      psArrayBackfilled,
    };
  },
});
