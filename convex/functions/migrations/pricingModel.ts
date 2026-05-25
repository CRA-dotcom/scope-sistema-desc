import { internalMutation, internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { derivePricingModel, type PricingModel } from "../../lib/pricingModel";

/**
 * One-shot backfill for Sub-spec 0.
 * Idempotent: skips rows that already have the field set.
 * Spec: docs/superpowers/specs/2026-05-25-pricing-model-frequency-foundation-design.md §4
 *
 * Run via: npx convex run functions/migrations/pricingModel:migrate '{"dryRun": false}'
 */
export const migrate = internalMutation({
  args: { dryRun: v.boolean() },
  handler: async (ctx, { dryRun }) => {
    let subCount = 0;
    for await (const sub of ctx.db.query("subservices")) {
      if (sub.defaultPricingModel) continue;
      const model = derivePricingModel({
        isCommission: sub.isCommission,
        defaultFrequency: sub.defaultFrequency,
      });
      if (!dryRun) await ctx.db.patch(sub._id, { defaultPricingModel: model });
      subCount++;
    }

    let projCount = 0;
    for await (const ps of ctx.db.query("projectionServices")) {
      if (ps.pricingModel) continue;
      let model: PricingModel;
      if (ps.subserviceId) {
        const sub = await ctx.db.get(ps.subserviceId);
        model = sub?.defaultPricingModel ?? "fixed_retainer";
      } else {
        const svc = await ctx.db.get(ps.serviceId);
        model = svc?.isCommission ? "commission" : "fixed_retainer";
      }
      if (!dryRun) await ctx.db.patch(ps._id, { pricingModel: model });
      projCount++;
    }

    let cellCount = 0;
    for await (const cell of ctx.db.query("monthlyAssignments")) {
      if (cell.isManuallyOverridden !== undefined) continue;
      if (!dryRun) await ctx.db.patch(cell._id, { isManuallyOverridden: false });
      cellCount++;
    }

    return {
      subservices: subCount,
      projectionServices: projCount,
      monthlyAssignments: cellCount,
      dryRun,
    };
  },
});

export const verifyComplete = internalQuery({
  args: {},
  handler: async (ctx) => {
    let subservicesPending = 0;
    for await (const sub of ctx.db.query("subservices")) {
      if (!sub.defaultPricingModel) subservicesPending++;
    }
    let projectionServicesPending = 0;
    for await (const ps of ctx.db.query("projectionServices")) {
      if (!ps.pricingModel) projectionServicesPending++;
    }
    let cellsPending = 0;
    for await (const cell of ctx.db.query("monthlyAssignments")) {
      if (cell.isManuallyOverridden === undefined) cellsPending++;
    }
    return { subservicesPending, projectionServicesPending, cellsPending };
  },
});
