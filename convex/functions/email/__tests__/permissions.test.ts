import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../../tests/harness";

function admin(orgId: string) {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `user_admin_${orgId}`,
    orgId,
    orgRole: "org:admin",
  };
}
function member(orgId: string) {
  return {
    tokenIdentifier: `test|member_${orgId}`,
    subject: `user_member_${orgId}`,
    orgId,
    orgRole: "org:member",
  };
}

describe("email permissions", () => {
  it("ejecutivo can list (gets filtered result)", async () => {
    const t = setupTest();
    const result = await t
      .withIdentity(member(ORG_A))
      .query(api.functions.email.queries.list, {});
    expect(result).toEqual([]);
  });

  it("ejecutivo cannot getResendConfig (admin-only)", async () => {
    const t = setupTest();
    await expect(
      t
        .withIdentity(member(ORG_A))
        .query(api.functions.email.queries.getResendConfig, {})
    ).rejects.toThrow(/Administrador/i);
  });

  it("ejecutivo cannot upsertResendConfig", async () => {
    const t = setupTest();
    await expect(
      t
        .withIdentity(member(ORG_A))
        .mutation(api.functions.email.mutations.upsertResendConfig, {
          apiKey: "re_test_1234",
          fromEmail: "x@y.com",
        })
    ).rejects.toThrow(/Administrador/i);
  });

  it("admin can upsertResendConfig and read it back", async () => {
    const t = setupTest();
    const id = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.email.mutations.upsertResendConfig, {
        apiKey: "re_abc123def456",
        fromEmail: "hola@ejemplo.com",
        fromName: "Hola",
      });
    expect(id).toBeDefined();
    const cfg = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.email.queries.getResendConfig, {});
    expect(cfg?.configured).toBe(true);
    if (cfg && cfg.configured) {
      expect(cfg.apiKeyMasked).toMatch(/^re_abc1\*\*\*\*/);
    }
  });

  it("unauthenticated call returns null (reactive-safe)", async () => {
    const t = setupTest();
    const result = await t.query(api.functions.email.queries.getResendConfig, {});
    expect(result).toBeNull();
  });
});
