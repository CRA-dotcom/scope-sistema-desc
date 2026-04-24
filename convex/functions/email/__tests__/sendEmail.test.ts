import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import { setupTest, ORG_A, ORG_B } from "../../../../tests/harness";

// Mock the Resend SDK. Uses a class so `new Resend(apiKey)` is callable.
// The `send` function is a closure shared across all instances, allowing tests
// to control mock behavior by importing it via getMockSend().
vi.mock("resend", () => {
  const send = vi.fn();
  const domainsList = vi.fn().mockResolvedValue({ data: [], error: null });
  class MockResend {
    emails = { send };
    domains = { list: domainsList };
    constructor(_apiKey: string) {
      void _apiKey;
    }
  }
  return {
    Resend: MockResend,
    __send: send,
  };
});

async function getMockSend() {
  const mod = await import("resend");
  // @ts-expect-error - __send is our injected test handle
  return mod.__send as ReturnType<typeof vi.fn>;
}

function admin(orgId: string) {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `user_admin_${orgId}`,
    orgId,
    orgRole: "org:admin",
  };
}
function member(orgId: string, userId: string) {
  return {
    tokenIdentifier: `test|member_${userId}`,
    subject: userId,
    orgId,
    orgRole: "org:member",
  };
}

async function seedResendConfig(t: ReturnType<typeof setupTest>, orgId: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgIntegrations", {
      orgId,
      provider: "resend",
      config: {
        apiKeySecretRef: "re_test_key",
        fromEmail: "test@ejemplo.com",
        fromName: "Test Org",
      },
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
}

const validSendArgs = {
  to: "client@ejemplo.com",
  subject: "Test",
  bodyHtml: "<p>hola</p>",
  type: "custom" as const,
};

describe("sendEmail action", () => {
  beforeEach(async () => {
    const send = await getMockSend();
    send.mockReset();
  });

  it("sends email and creates emailLog in 'sent' state", async () => {
    const t = setupTest();
    await seedResendConfig(t, ORG_A);
    const send = await getMockSend();
    send.mockResolvedValueOnce({ data: { id: "re_msg_abc" }, error: null });

    const result = await t
      .withIdentity(admin(ORG_A))
      .action(api.functions.email.send.sendEmail, validSendArgs);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.providerMessageId).toBe("re_msg_abc");
      const log = await t.run(async (ctx) => ctx.db.get(result.emailLogId as Id<"emailLog">));
      expect(log?.status).toBe("sent");
      expect(log?.providerMessageId).toBe("re_msg_abc");
    }
    expect(send).toHaveBeenCalledOnce();
  });

  it("Resend 4xx → emailLog 'failed' with errorMessage", async () => {
    const t = setupTest();
    await seedResendConfig(t, ORG_A);
    const send = await getMockSend();
    send.mockResolvedValueOnce({
      data: null,
      error: { message: "Domain not verified", name: "validation_error" },
    });

    const result = await t
      .withIdentity(admin(ORG_A))
      .action(api.functions.email.send.sendEmail, validSendArgs);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorMessage).toMatch(/Domain not verified/);
      const log = await t.run(async (ctx) => ctx.db.get(result.emailLogId as Id<"emailLog">));
      expect(log?.status).toBe("failed");
    }
  });

  it("Resend throws → emailLog 'failed'", async () => {
    const t = setupTest();
    await seedResendConfig(t, ORG_A);
    const send = await getMockSend();
    send.mockRejectedValueOnce(new Error("network timeout"));

    const result = await t
      .withIdentity(admin(ORG_A))
      .action(api.functions.email.send.sendEmail, validSendArgs);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorMessage).toMatch(/network timeout/);
      const log = await t.run(async (ctx) => ctx.db.get(result.emailLogId as Id<"emailLog">));
      expect(log?.status).toBe("failed");
    }
  });

  it("ejecutivo to their assigned client succeeds", async () => {
    const t = setupTest();
    await seedResendConfig(t, ORG_A);
    const userId = "user_ejecutivo_A";
    const clientId = await t.run(async (ctx) =>
      ctx.db.insert("clients", {
        orgId: ORG_A,
        name: "Acme",
        rfc: "ACM100101ABC",
        industry: "Servicios",
        annualRevenue: 1000000,
        billingFrequency: "mensual" as const,
        isArchived: false,
        assignedTo: userId,
        createdAt: Date.now(),
      })
    );
    const send = await getMockSend();
    send.mockResolvedValueOnce({ data: { id: "re_msg_ok" }, error: null });

    const result = await t
      .withIdentity(member(ORG_A, userId))
      .action(api.functions.email.send.sendEmail, {
        ...validSendArgs,
        clientId,
      });
    expect(result.ok).toBe(true);
  });

  it("ejecutivo to NOT-assigned client throws", async () => {
    const t = setupTest();
    await seedResendConfig(t, ORG_A);
    const clientId = await t.run(async (ctx) =>
      ctx.db.insert("clients", {
        orgId: ORG_A,
        name: "Other",
        rfc: "OTR100101ABC",
        industry: "Servicios",
        annualRevenue: 1000000,
        billingFrequency: "mensual" as const,
        isArchived: false,
        assignedTo: "someone_else",
        createdAt: Date.now(),
      })
    );
    await expect(
      t
        .withIdentity(member(ORG_A, "user_ejecutivo_A"))
        .action(api.functions.email.send.sendEmail, {
          ...validSendArgs,
          clientId,
        })
    ).rejects.toThrow(/Cliente no asignado/i);
  });

  it("sin Resend configurado throws before inserting emailLog", async () => {
    const t = setupTest();
    const prev = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      await expect(
        t
          .withIdentity(admin(ORG_A))
          .action(api.functions.email.send.sendEmail, validSendArgs)
      ).rejects.toThrow(/No hay configuración de Resend/i);
    } finally {
      if (prev) process.env.RESEND_API_KEY = prev;
    }
  });

  it("multi-tenant: org A list does NOT see org B's emailLog", async () => {
    const t = setupTest();
    await seedResendConfig(t, ORG_A);
    await seedResendConfig(t, ORG_B);
    const send = await getMockSend();
    send.mockResolvedValue({ data: { id: "re_msg_shared" }, error: null });

    await t
      .withIdentity(admin(ORG_B))
      .action(api.functions.email.send.sendEmail, validSendArgs);

    const resultA = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.email.queries.list, {});
    expect(resultA).toHaveLength(0);
  });
});
