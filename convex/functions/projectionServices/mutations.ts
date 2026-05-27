import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgId, requireAuth, requireAdmin } from "../../lib/authHelpers";

export const toggleActive = mutation({
  args: {
    id: v.id("projectionServices"),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const orgId = await getOrgId(ctx);
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
    const orgId = await getOrgId(ctx);
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
    const orgId = await getOrgId(ctx);
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
 * Set or clear the contractual window (startMonth / endMonth) for a
 * projectionServices row.
 *
 * - Pass a number (1–12) to set the bound.
 * - Omit the field (undefined) to clear it — the service then spans the full
 *   year (legacy / no window restriction).
 * - Both bounds must satisfy 1 ≤ n ≤ 12, and startMonth ≤ endMonth when both
 *   are provided.
 *
 * Does NOT trigger cell recalculation — caller must invoke recalculate via
 * the existing UI button.
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
    const orgId = await getOrgId(ctx);

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

    return { ok: true };
  },
});
