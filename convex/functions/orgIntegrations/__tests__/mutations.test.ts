import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../../tests/harness";

function admin(orgId: string) {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `user_admin_${orgId}`,
    orgId,
    orgRole: "org:admin" as const,
  };
}

describe("orgIntegrations.mutations.upsertFirmameConfig", () => {
  it("inserts a new row with masked apiKey and pending status", async () => {
    const t = setupTest();
    const id = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.orgIntegrations.mutations.upsertFirmameConfig, {
        apiKey: "fm_secret_1234567890",
      });

    const stored = await t.run(async (ctx) => ctx.db.get(id));
    expect(stored?.provider).toBe("other");
    expect(stored?.providerLabel).toBe("firmame");
    expect(stored?.status).toBe("pending_verification");
    expect(stored?.config.apiKeySecretRef).toBe("fm_secret_1234567890");
    expect(stored?.config.apiKeyMasked).toBe("fm_secr****7890");
    expect(stored?.config.sandboxMode).toBe(true);
  });

  it("patches existing row instead of inserting on re-call", async () => {
    const t = setupTest();
    await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.orgIntegrations.mutations.upsertFirmameConfig, {
        apiKey: "fm_secret_aaaaaaaa1111",
      });
    await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.orgIntegrations.mutations.upsertFirmameConfig, {
        apiKey: "fm_secret_bbbbbbbb2222",
      });

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("orgIntegrations")
        .withIndex("by_orgId_provider", (q) =>
          q.eq("orgId", ORG_A).eq("provider", "other")
        )
        .collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].config.apiKeySecretRef).toBe("fm_secret_bbbbbbbb2222");
  });

  it("rejects an apiKey shorter than 8 chars", async () => {
    const t = setupTest();
    await expect(
      t
        .withIdentity(admin(ORG_A))
        .mutation(api.functions.orgIntegrations.mutations.upsertFirmameConfig, {
          apiKey: "abc",
        })
    ).rejects.toThrow(/inválido/i);
  });
});

describe("orgIntegrations.queries.listForOrg", () => {
  it("never returns apiKeySecretRef or webhookSecretRef (mask only)", async () => {
    const t = setupTest();
    await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.orgIntegrations.mutations.upsertFirmameConfig, {
        apiKey: "fm_secret_supersafe_xyz",
        apiSecret: "wh_super_secret_value",
      });

    const result = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.orgIntegrations.queries.listForOrg, {});

    expect(result).toHaveLength(1);
    const row = result[0] as Record<string, unknown>;
    expect(row.apiKeyMasked).toMatch(/^fm_secr\*\*\*\*/);
    expect("apiKeySecretRef" in row).toBe(false);
    expect("webhookSecretRef" in row).toBe(false);
    expect(row.hasWebhookSecret).toBe(true);
    expect(row.providerLabel).toBe("firmame");
  });
});
