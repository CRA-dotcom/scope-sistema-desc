import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { internal } from "../../../_generated/api";

const originalOps = process.env.OPS_NOTIFICATION_EMAIL;

async function seedConfig(
  t: ReturnType<typeof setupTest>,
  orgId: string,
  notificationEmail?: string
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgConfigs", {
      orgId,
      calculationMode: "weighted" as const,
      commissionMode: "proportional" as const,
      seasonalityEnabled: true,
      featureFlags: {
        advancedConfigVisible: true,
        customServicesVisible: true,
        seasonalityEditable: true,
        manualOverrideAllowed: true,
      },
      notificationEmail,
      updatedAt: Date.now(),
    });
  });
}

describe("resolveOrgNotificationEmail", () => {
  beforeEach(() => {
    delete process.env.OPS_NOTIFICATION_EMAIL;
  });
  afterEach(() => {
    if (originalOps) process.env.OPS_NOTIFICATION_EMAIL = originalOps;
    else delete process.env.OPS_NOTIFICATION_EMAIL;
  });

  it("returns the org config notificationEmail when set", async () => {
    const t = setupTest();
    await seedConfig(t, "org_a", "responsable@empresa.com");
    const result = await t.query(
      internal.functions.email.resolveRecipients.resolveOrgNotificationEmail,
      { orgId: "org_a" }
    );
    expect(result).toBe("responsable@empresa.com");
  });

  it("falls back to OPS_NOTIFICATION_EMAIL when config has none", async () => {
    process.env.OPS_NOTIFICATION_EMAIL = "ops@interno.com";
    const t = setupTest();
    await seedConfig(t, "org_a");
    const result = await t.query(
      internal.functions.email.resolveRecipients.resolveOrgNotificationEmail,
      { orgId: "org_a" }
    );
    expect(result).toBe("ops@interno.com");
  });

  it("treats an empty/whitespace notificationEmail as not configured", async () => {
    process.env.OPS_NOTIFICATION_EMAIL = "ops@interno.com";
    const t = setupTest();
    await seedConfig(t, "org_a", "   ");
    const result = await t.query(
      internal.functions.email.resolveRecipients.resolveOrgNotificationEmail,
      { orgId: "org_a" }
    );
    expect(result).toBe("ops@interno.com");
  });

  it("returns null when neither config nor env is set", async () => {
    const t = setupTest();
    const result = await t.query(
      internal.functions.email.resolveRecipients.resolveOrgNotificationEmail,
      { orgId: "org_a" }
    );
    expect(result).toBeNull();
  });
});
