import { describe, it, expect } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { api } from "../../../_generated/api";

const SUPER_ADMIN = {
  subject: "user_superadmin",
  issuer: "test",
  tokenIdentifier: "test|user_superadmin",
  publicMetadata: { role: "super_admin" },
};

const baseArgs = {
  orgId: "org_a",
  calculationMode: "weighted" as const,
  commissionMode: "proportional" as const,
  seasonalityEnabled: true,
  featureFlags: {
    advancedConfigVisible: true,
    customServicesVisible: true,
    seasonalityEditable: true,
    manualOverrideAllowed: true,
  },
};

describe("orgConfigs.upsert notificationEmail", () => {
  it("persists notificationEmail on insert", async () => {
    const t = setupTest();
    await t
      .withIdentity(SUPER_ADMIN)
      .mutation(api.functions.orgConfigs.mutations.upsert, {
        ...baseArgs,
        notificationEmail: "responsable@empresa.com",
      });

    const stored = await t.run(async (ctx) =>
      ctx.db
        .query("orgConfigs")
        .withIndex("by_orgId", (q) => q.eq("orgId", "org_a"))
        .unique()
    );
    expect(stored?.notificationEmail).toBe("responsable@empresa.com");
  });

  it("updates notificationEmail on existing config", async () => {
    const t = setupTest();
    const id = await t
      .withIdentity(SUPER_ADMIN)
      .mutation(api.functions.orgConfigs.mutations.upsert, {
        ...baseArgs,
        notificationEmail: "old@empresa.com",
      });
    await t
      .withIdentity(SUPER_ADMIN)
      .mutation(api.functions.orgConfigs.mutations.upsert, {
        ...baseArgs,
        notificationEmail: "new@empresa.com",
      });

    const stored = await t.run(async (ctx) => ctx.db.get(id));
    expect(stored?.notificationEmail).toBe("new@empresa.com");
  });

  it("leaves notificationEmail undefined when omitted", async () => {
    const t = setupTest();
    await t
      .withIdentity(SUPER_ADMIN)
      .mutation(api.functions.orgConfigs.mutations.upsert, baseArgs);

    const stored = await t.run(async (ctx) =>
      ctx.db
        .query("orgConfigs")
        .withIndex("by_orgId", (q) => q.eq("orgId", "org_a"))
        .unique()
    );
    expect(stored?.notificationEmail).toBeUndefined();
  });

  it("clears notificationEmail when omitted on update", async () => {
    const t = setupTest();
    const id = await t
      .withIdentity(SUPER_ADMIN)
      .mutation(api.functions.orgConfigs.mutations.upsert, {
        ...baseArgs,
        notificationEmail: "x@empresa.com",
      });
    await t
      .withIdentity(SUPER_ADMIN)
      .mutation(api.functions.orgConfigs.mutations.upsert, baseArgs);

    const stored = await t.run(async (ctx) => ctx.db.get(id));
    expect(stored?.notificationEmail).toBeUndefined();
  });
});
