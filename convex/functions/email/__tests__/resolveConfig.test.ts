import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { internal } from "../../../_generated/api";
import { setupTest, ORG_A, ORG_B } from "../../../../tests/harness";

describe("resolveResendCredentials", () => {
  const originalKey = process.env.RESEND_API_KEY;
  const originalFromEmail = process.env.RESEND_FROM_EMAIL;

  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
  });
  afterEach(() => {
    if (originalKey) process.env.RESEND_API_KEY = originalKey;
    else delete process.env.RESEND_API_KEY;
    if (originalFromEmail) process.env.RESEND_FROM_EMAIL = originalFromEmail;
    else delete process.env.RESEND_FROM_EMAIL;
  });

  it("returns org_integration source when orgIntegrations.resend is active", async () => {
    const t = setupTest();
    await t.run(async (ctx) => {
      await ctx.db.insert("orgIntegrations", {
        orgId: ORG_A,
        provider: "resend",
        config: {
          apiKeySecretRef: "re_live_abc123",
          fromEmail: "test@ejemplo.mx",
          fromName: "Test Org",
          webhookSecretRef: "whsec_abc",
        },
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const result = await t.query(
      internal.functions.email.resolveConfig.resolveResendCredentialsQuery,
      { orgId: ORG_A }
    );
    expect(result.source).toBe("org_integration");
    expect(result.apiKey).toBe("re_live_abc123");
    expect(result.fromEmail).toBe("test@ejemplo.mx");
    expect(result.fromName).toBe("Test Org");
    expect(result.webhookSigningSecret).toBe("whsec_abc");
  });

  it("falls back to platform_env when orgIntegrations status=inactive", async () => {
    process.env.RESEND_API_KEY = "re_platform_fallback";
    const t = setupTest();
    await t.run(async (ctx) => {
      await ctx.db.insert("orgIntegrations", {
        orgId: ORG_A,
        provider: "resend",
        config: { apiKeySecretRef: "re_org" },
        status: "inactive",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const result = await t.query(
      internal.functions.email.resolveConfig.resolveResendCredentialsQuery,
      { orgId: ORG_A }
    );
    expect(result.source).toBe("platform_env");
    expect(result.apiKey).toBe("re_platform_fallback");
  });

  it("uses platform_env when no orgIntegrations exist", async () => {
    process.env.RESEND_API_KEY = "re_platform_only";
    const t = setupTest();
    const result = await t.query(
      internal.functions.email.resolveConfig.resolveResendCredentialsQuery,
      { orgId: ORG_A }
    );
    expect(result.source).toBe("platform_env");
    expect(result.apiKey).toBe("re_platform_only");
  });

  it("throws ResendNotConfiguredError when no org config AND no env", async () => {
    const t = setupTest();
    await expect(
      t.query(
        internal.functions.email.resolveConfig.resolveResendCredentialsQuery,
        { orgId: ORG_A }
      )
    ).rejects.toThrow(/No hay configuración de Resend/i);
  });

  it("org B config does not leak into org A resolution", async () => {
    const t = setupTest();
    await t.run(async (ctx) => {
      await ctx.db.insert("orgIntegrations", {
        orgId: ORG_B,
        provider: "resend",
        config: { apiKeySecretRef: "re_B_secret" },
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    await expect(
      t.query(
        internal.functions.email.resolveConfig.resolveResendCredentialsQuery,
        { orgId: ORG_A }
      )
    ).rejects.toThrow(/No hay configuración/i);
  });
});
