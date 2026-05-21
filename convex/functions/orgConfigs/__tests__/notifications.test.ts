import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import { setupTest, ORG_A, ORG_B } from "../../../../tests/harness";

function admin(orgId: string) {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `user_admin_${orgId}`,
    orgId,
    orgRole: "org:admin" as const,
  };
}

describe("orgConfigs.mutations.updateNotificationPreferences", () => {
  it("rejects an invalid email format", async () => {
    const t = setupTest();
    await expect(
      t
        .withIdentity(admin(ORG_A))
        .mutation(
          api.functions.orgConfigs.mutations.updateNotificationPreferences,
          { notificationEmail: "not-an-email" }
        )
    ).rejects.toThrow(/Email inválido/i);
  });

  it("creates an orgConfigs row with conservative defaults when none exists", async () => {
    const t = setupTest();
    // sanity: no row exists for ORG_B
    const before = await t.run(async (ctx) =>
      ctx.db
        .query("orgConfigs")
        .withIndex("by_orgId", (q) => q.eq("orgId", ORG_B))
        .unique()
    );
    expect(before).toBeNull();

    await t
      .withIdentity(admin(ORG_B))
      .mutation(
        api.functions.orgConfigs.mutations.updateNotificationPreferences,
        {
          notificationEmail: "admin@orgb.mx",
          reminderHourLocal: 9,
          notifyOnInvoicePaid: true,
        }
      );

    const after = await t.run(async (ctx) =>
      ctx.db
        .query("orgConfigs")
        .withIndex("by_orgId", (q) => q.eq("orgId", ORG_B))
        .unique()
    );
    expect(after?.notificationEmail).toBe("admin@orgb.mx");
    expect(after?.notificationPreferences?.reminderHourLocal).toBe(9);
    expect(after?.notificationPreferences?.notifyOnInvoicePaid).toBe(true);
    expect(after?.featureFlags.advancedConfigVisible).toBe(false);
  });

  it("multi-tenant: editing in orgA never touches orgB row", async () => {
    const t = setupTest();
    // seed orgB row
    await t
      .withIdentity(admin(ORG_B))
      .mutation(
        api.functions.orgConfigs.mutations.updateNotificationPreferences,
        { notificationEmail: "orgb@x.mx" }
      );

    // orgA admin edits — should never touch orgB
    await t
      .withIdentity(admin(ORG_A))
      .mutation(
        api.functions.orgConfigs.mutations.updateNotificationPreferences,
        { notificationEmail: "orga@x.mx" }
      );

    const orgARow = await t.run(async (ctx) =>
      ctx.db
        .query("orgConfigs")
        .withIndex("by_orgId", (q) => q.eq("orgId", ORG_A))
        .unique()
    );
    const orgBRow = await t.run(async (ctx) =>
      ctx.db
        .query("orgConfigs")
        .withIndex("by_orgId", (q) => q.eq("orgId", ORG_B))
        .unique()
    );
    expect(orgARow?.orgId).toBe(ORG_A);
    expect(orgARow?.notificationEmail).toBe("orga@x.mx");
    expect(orgBRow?.orgId).toBe(ORG_B);
    expect(orgBRow?.notificationEmail).toBe("orgb@x.mx");
  });

  it("rejects reminderHourLocal out of [0,23]", async () => {
    const t = setupTest();
    await expect(
      t
        .withIdentity(admin(ORG_A))
        .mutation(
          api.functions.orgConfigs.mutations.updateNotificationPreferences,
          { reminderHourLocal: 25 }
        )
    ).rejects.toThrow(/0 y 23/);
  });
});
