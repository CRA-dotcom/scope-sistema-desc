import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgId, getOrgIdMutation, requireAdmin, requireSuperAdmin } from "../../lib/authHelpers";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

/**
 * D2 §3.4 — `updateNotificationPreferences`
 *
 * Operator-facing subset of `orgConfigs.upsert`: only the notification
 * fields. Requires `org:admin` role (vs `requireSuperAdmin` for the full
 * upsert). Validates email format and preference bounds. If no `orgConfigs`
 * row exists yet, inserts a defensive default with conservative feature
 * flags.
 */
export const updateNotificationPreferences = mutation({
  args: {
    notificationEmail: v.optional(v.string()),
    reminderHourLocal: v.optional(v.number()),
    notifyOnDeliverableGenerated: v.optional(v.boolean()),
    notifyOnInvoicePaid: v.optional(v.boolean()),
    notifyOnQuotationAccepted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgIdMutation(ctx);

    if (
      args.notificationEmail !== undefined &&
      args.notificationEmail !== "" &&
      !EMAIL_REGEX.test(args.notificationEmail)
    ) {
      throw new Error("Email inválido.");
    }
    if (args.reminderHourLocal !== undefined) {
      if (
        !Number.isInteger(args.reminderHourLocal) ||
        args.reminderHourLocal < 0 ||
        args.reminderHourLocal > 23
      ) {
        throw new Error("Hora debe estar entre 0 y 23.");
      }
    }

    const normalizedEmail =
      args.notificationEmail === undefined
        ? undefined
        : args.notificationEmail === ""
          ? undefined
          : args.notificationEmail.trim();

    // Build a notificationPreferences object, dropping undefined keys so
    // the stored shape mirrors the schema validator (object with optional
    // fields).
    type NotificationPrefs = {
      reminderHourLocal?: number;
      notifyOnDeliverableGenerated?: boolean;
      notifyOnInvoicePaid?: boolean;
      notifyOnQuotationAccepted?: boolean;
    };
    const prefsCandidate: NotificationPrefs = {};
    if (args.reminderHourLocal !== undefined) {
      prefsCandidate.reminderHourLocal = args.reminderHourLocal;
    }
    if (args.notifyOnDeliverableGenerated !== undefined) {
      prefsCandidate.notifyOnDeliverableGenerated =
        args.notifyOnDeliverableGenerated;
    }
    if (args.notifyOnInvoicePaid !== undefined) {
      prefsCandidate.notifyOnInvoicePaid = args.notifyOnInvoicePaid;
    }
    if (args.notifyOnQuotationAccepted !== undefined) {
      prefsCandidate.notifyOnQuotationAccepted = args.notifyOnQuotationAccepted;
    }
    const hasPrefs = Object.keys(prefsCandidate).length > 0;

    const existing = await ctx.db
      .query("orgConfigs")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .unique();

    const now = Date.now();

    if (existing) {
      const mergedPrefs = hasPrefs
        ? { ...(existing.notificationPreferences ?? {}), ...prefsCandidate }
        : existing.notificationPreferences;
      await ctx.db.patch(existing._id, {
        notificationEmail:
          args.notificationEmail === undefined
            ? existing.notificationEmail
            : normalizedEmail,
        notificationPreferences: mergedPrefs,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("orgConfigs", {
      orgId,
      calculationMode: "weighted",
      commissionMode: "proportional",
      seasonalityEnabled: false,
      featureFlags: {
        advancedConfigVisible: false,
        customServicesVisible: false,
        seasonalityEditable: false,
        manualOverrideAllowed: false,
      },
      notificationEmail: normalizedEmail,
      notificationPreferences: hasPrefs ? prefsCandidate : undefined,
      updatedAt: now,
    });
  },
});
