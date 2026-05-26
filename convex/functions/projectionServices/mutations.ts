import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgId, requireAuth } from "../../lib/authHelpers";

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
