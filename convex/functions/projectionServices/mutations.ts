import { mutation, MutationCtx } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgId, getOrgIdMutation, requireAuth, requireAdmin } from "../../lib/authHelpers";
import { Id } from "../../_generated/dataModel";

/**
 * #1 — Post-creation subservice picker.
 *
 * Patches the subserviceIds (and the legacy subserviceId backcompat field) on
 * a projectionServices row. Called from /proyecciones/[id]/subservicios.
 *
 * - Passing an empty array clears both fields (user removed all selections).
 * - Cross-org access throws.
 */
export const setSubserviceIds = mutation({
  args: {
    projServiceId: v.id("projectionServices"),
    subserviceIds: v.array(v.id("subservices")),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgIdMutation(ctx);
    const ps = await ctx.db.get(args.projServiceId);
    if (!ps || ps.orgId !== orgId) {
      throw new Error("Servicio no encontrado.");
    }
    if (args.subserviceIds.length === 0) {
      // Clear both fields atomically (empty array → no selection).
      await ctx.db.patch(args.projServiceId, {
        subserviceIds: undefined,
        subserviceId: undefined,
      });
    } else {
      // Persist array + keep legacy scalar in sync (backcompat).
      await ctx.db.patch(args.projServiceId, {
        subserviceIds: args.subserviceIds,
        subserviceId: args.subserviceIds[0], // backcompat: primary subservice
      });
    }
  },
});

export const toggleActive = mutation({
  args: {
    id: v.id("projectionServices"),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const orgId = await getOrgIdMutation(ctx);
    const ps = await ctx.db.get(args.id);
    if (!ps || ps.orgId !== orgId) throw new Error("No encontrado.");
    await ctx.db.patch(args.id, { isActive: args.isActive });
  },
});

export const updateChosenPct = mutation({
  args: {
    id: v.id("projectionServices"),
    chosenPct: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const orgId = await getOrgIdMutation(ctx);
    const ps = await ctx.db.get(args.id);
    if (!ps || ps.orgId !== orgId) throw new Error("No encontrado.");
    await ctx.db.patch(args.id, { chosenPct: args.chosenPct });
  },
});

/**
 * Switch pricingModel of a projectionService row mid-cycle.
 * - newModel = dynamic_retainer  → flip all cells to isManuallyOverridden=true
 *                                  (snapshot freeze of current amounts)
 * - newModel = anything else     → flip all cells to isManuallyOverridden=false
 *                                  (engine will recompute on next recalc)
 *
 * Requires confirmReset=true acknowledgement because cell behavior changes
 * abruptly.
 *
 * Spec: docs/superpowers/specs/2026-05-25-pricing-model-frequency-foundation-design.md §3.2
 */
export const changePricingModel = mutation({
  args: {
    id: v.id("projectionServices"),
    newModel: v.union(
      v.literal("fixed_retainer"),
      v.literal("dynamic_retainer"),
      v.literal("commission"),
      v.literal("one_time")
    ),
    confirmReset: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const orgId = await getOrgIdMutation(ctx);
    const ps = await ctx.db.get(args.id);
    if (!ps || ps.orgId !== orgId) throw new Error("No encontrado.");

    if (!args.confirmReset) {
      throw new Error(
        "confirmReset=true requerido — cambiar pricingModel mid-cycle reescribe el comportamiento de las celdas."
      );
    }

    await ctx.db.patch(args.id, { pricingModel: args.newModel });

    const cells = await ctx.db
      .query("monthlyAssignments")
      .withIndex("by_projServiceId", (q) => q.eq("projServiceId", args.id))
      .collect();

    const newFlag = args.newModel === "dynamic_retainer";
    for (const cell of cells) {
      await ctx.db.patch(cell._id, { isManuallyOverridden: newFlag });
    }

    return { ok: true, cellsTouched: cells.length };
  },
});

/**
 * recalcOneServiceCells — internal helper shared by setAnnualAmount (F1) and
 * updateContractualWindow (F8).
 *
 * Redistributes `annualAmount` (as stored on the projectionServices row after
 * any patch has already been applied) across the monthly cells of a single
 * projectionService, respecting:
 *   - isManuallyOverridden cells: amount is FROZEN, not touched.
 *   - Contractual window (startMonth / endMonth): out-of-window cells → 0.
 *   - FE factors from the parent projection's seasonalityData.
 *
 * The helper does NOT call the full projection engine (which re-derives
 * annualAmount from budget weights). Instead it treats annualAmount as a
 * fixed given and distributes it proportionally by feFactor across eligible
 * non-overridden in-window months. This mirrors the invariant maintained by
 * recalculate() in projections/mutations.ts (override-map + delete/recreate).
 *
 * TODO: if recalculate() in projections/mutations.ts is ever refactored to a
 * shared helper, consolidate this logic there.
 */
async function recalcOneServiceCells(
  ctx: MutationCtx,
  projServiceId: Id<"projectionServices">
): Promise<void> {
  const ps = await ctx.db.get(projServiceId);
  if (!ps) return;

  const projection = await ctx.db.get(ps.projectionId);
  if (!projection) return;

  const annualAmount = ps.annualAmount;
  const startMonth = ps.startMonth;
  const endMonth = ps.endMonth;

  // Resolve seasonality from the parent projection.
  // Prefer stored seasonalityData (12-entry array); fall back to even spread.
  const seasonality: { month: number; feFactor: number }[] =
    projection.seasonalityData && projection.seasonalityData.length === 12
      ? projection.seasonalityData
      : Array.from({ length: 12 }, (_, i) => ({ month: i + 1, feFactor: 1 }));

  // Build a month→feFactor lookup for the 12 calendar months.
  const feByMonth = new Map<number, number>(
    seasonality.map((m) => [m.month, m.feFactor])
  );

  // Read all existing monthly cells for this service.
  const existingCells = await ctx.db
    .query("monthlyAssignments")
    .withIndex("by_projServiceId", (q) => q.eq("projServiceId", projServiceId))
    .collect();

  // Split: overridden cells are frozen; non-overridden cells will be recomputed.
  const overriddenSum = existingCells
    .filter((c) => c.isManuallyOverridden)
    .reduce((s, c) => s + c.amount, 0);

  // Amount available to distribute among non-overridden in-window months.
  const distributable = annualAmount - overriddenSum;

  // Determine which calendar months are in-window and NOT overridden.
  const lo = startMonth ?? 1;
  const hi = endMonth ?? 12;

  // Non-overridden cells that are in-window receive a proportional share.
  // Out-of-window cells are zeroed out (regardless of override status — a
  // manually overridden cell in a now-out-of-window month is kept at its
  // override amount per the spec; the window just zeroes non-override cells).
  // Actually: per spec, manual overrides always win — don't zero them even
  // if out of window. Only zero non-overridden out-of-window cells.
  const eligibleCells = existingCells.filter(
    (c) => !c.isManuallyOverridden && c.month >= lo && c.month <= hi
  );

  const sumFE = eligibleCells.reduce(
    (s, c) => s + (feByMonth.get(c.month) ?? 1),
    0
  );

  for (const cell of existingCells) {
    if (cell.isManuallyOverridden) continue; // frozen — never touch

    const inWindow = cell.month >= lo && cell.month <= hi;
    if (!inWindow) {
      // Out-of-window non-override → zero out
      await ctx.db.patch(cell._id, { amount: 0 });
    } else {
      // In-window non-override → proportional share of distributable
      const fe = feByMonth.get(cell.month) ?? 1;
      const share = sumFE > 0 ? distributable * (fe / sumFE) : 0;
      await ctx.db.patch(cell._id, { amount: share });
    }
  }
}

/**
 * setAnnualAmount — SS6: Directly override the annualAmount on a
 * projectionServices row (used by the year-over-year discount "Aplicar" button).
 *
 * After patching annualAmount, redistributes monthlyAssignments cells so the
 * monthly sum stays consistent with the new annual total (F1 fix).
 * Manual overrides (isManuallyOverridden=true) are preserved — only
 * non-overridden in-window cells are recalculated.
 *
 * Requires org:admin. Value must be ≥ 0.
 */
export const setAnnualAmount = mutation({
  args: {
    projServiceId: v.id("projectionServices"),
    annualAmount: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgIdMutation(ctx);
    const ps = await ctx.db.get(args.projServiceId);
    if (!ps || ps.orgId !== orgId) throw new Error("No encontrado.");
    if (args.annualAmount < 0) throw new Error("annualAmount debe ser ≥ 0.");
    await ctx.db.patch(args.projServiceId, { annualAmount: args.annualAmount });
    await recalcOneServiceCells(ctx, args.projServiceId);
    return { ok: true };
  },
});

/**
 * Set or clear the contractual window (startMonth / endMonth) for a
 * projectionServices row.
 *
 * - Pass a number (1–12) to set the bound.
 * - Omit the field (undefined) to clear it — the service then spans the full
 *   year (legacy / no window restriction).
 * - Both bounds must satisfy 1 ≤ n ≤ 12, and startMonth ≤ endMonth when both
 *   are provided.
 *
 * After patching the window, triggers cell recalculation via recalcOneServiceCells
 * so monthlyAssignments stay consistent with the new window (F8 fix).
 * Out-of-window non-overridden cells are zeroed; in-window cells are
 * redistributed by FE factor. Manual overrides (isManuallyOverridden=true) are
 * always preserved, even if the overridden cell is now outside the window.
 *
 * Spec: B1 mid-year add-on window (schema comment in projectionServices table)
 */
export const updateContractualWindow = mutation({
  args: {
    projServiceId: v.id("projectionServices"),
    startMonth: v.optional(v.number()),
    endMonth: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgIdMutation(ctx);

    const ps = await ctx.db.get(args.projServiceId);
    if (!ps || ps.orgId !== orgId) {
      throw new Error("Servicio de proyección no encontrado.");
    }

    if (args.startMonth !== undefined) {
      if (args.startMonth < 1 || args.startMonth > 12) {
        throw new Error("startMonth debe estar entre 1 y 12.");
      }
    }

    if (args.endMonth !== undefined) {
      if (args.endMonth < 1 || args.endMonth > 12) {
        throw new Error("endMonth debe estar entre 1 y 12.");
      }
    }

    if (args.startMonth !== undefined && args.endMonth !== undefined) {
      if (args.startMonth > args.endMonth) {
        throw new Error(
          "startMonth no puede ser mayor que endMonth (ventana invertida)."
        );
      }
    }

    await ctx.db.patch(args.projServiceId, {
      startMonth: args.startMonth,
      endMonth: args.endMonth,
    });

    await recalcOneServiceCells(ctx, args.projServiceId);

    return { ok: true };
  },
});
