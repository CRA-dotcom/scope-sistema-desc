import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { requireSuperAdmin } from "../../lib/authHelpers";

/**
 * Validate an IANA timezone string. Uses `Intl.supportedValuesOf` when
 * available (Node 18+), with a lightweight fallback that attempts to
 * format with the candidate tz — if it throws, the tz is invalid.
 */
function isValidTimezone(tz: string): boolean {
  if (!tz || typeof tz !== "string") return false;
  const intlAny = Intl as unknown as {
    supportedValuesOf?: (key: string) => string[];
  };
  if (typeof intlAny.supportedValuesOf === "function") {
    try {
      return intlAny.supportedValuesOf("timeZone").includes(tz);
    } catch {
      /* fall through */
    }
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export const upsert = mutation({
  args: {
    orgId: v.string(),
    calculationMode: v.union(v.literal("weighted"), v.literal("fixed")),
    commissionMode: v.union(
      v.literal("proportional"),
      v.literal("fixed_monthly")
    ),
    seasonalityEnabled: v.boolean(),
    featureFlags: v.object({
      advancedConfigVisible: v.boolean(),
      customServicesVisible: v.boolean(),
      seasonalityEditable: v.boolean(),
      manualOverrideAllowed: v.boolean(),
    }),
    currency: v.optional(v.string()),
    fiscalYearStartMonth: v.optional(v.number()),
    notificationEmail: v.optional(v.string()),
    // A3 (R1 #13): IANA timezone, validated server-side.
    timezone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);

    if (args.timezone !== undefined && !isValidTimezone(args.timezone)) {
      throw new Error(
        `Timezone inválida: "${args.timezone}". Usa un identificador IANA, ej. "America/Mexico_City".`
      );
    }

    const existing = await ctx.db
      .query("orgConfigs")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .unique();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        calculationMode: args.calculationMode,
        commissionMode: args.commissionMode,
        seasonalityEnabled: args.seasonalityEnabled,
        featureFlags: args.featureFlags,
        currency: args.currency,
        fiscalYearStartMonth: args.fiscalYearStartMonth,
        notificationEmail: args.notificationEmail,
        timezone: args.timezone,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("orgConfigs", {
      orgId: args.orgId,
      calculationMode: args.calculationMode,
      commissionMode: args.commissionMode,
      seasonalityEnabled: args.seasonalityEnabled,
      featureFlags: args.featureFlags,
      currency: args.currency,
      fiscalYearStartMonth: args.fiscalYearStartMonth,
      notificationEmail: args.notificationEmail,
      timezone: args.timezone,
      updatedAt: now,
    });
  },
});
