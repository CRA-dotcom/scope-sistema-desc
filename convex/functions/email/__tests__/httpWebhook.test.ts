import { describe, it, expect } from "vitest";
import { internal } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../../tests/harness";

const WEBHOOK_SECRET = "whsec_testSecret1234567890abcdefghij";

async function seedEmailLog(t: ReturnType<typeof setupTest>, providerMessageId: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgIntegrations", {
      orgId: ORG_A,
      provider: "resend",
      config: {
        apiKeySecretRef: "re_test",
        webhookSecretRef: WEBHOOK_SECRET,
      },
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return await ctx.db.insert("emailLog", {
      orgId: ORG_A,
      type: "custom",
      direction: "outbound",
      fromEmail: "test@ejemplo.com",
      toEmail: "client@ejemplo.com",
      subject: "Test",
      status: "sent",
      provider: "resend",
      providerMessageId,
      sentAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
}

describe("handleWebhookEvent (internal mutation)", () => {
  it("delivered event transitions status from sent to delivered", async () => {
    const t = setupTest();
    const messageId = "re_abc_delivered";
    await seedEmailLog(t, messageId);

    await t.mutation(
      internal.functions.email.internalMutations.handleWebhookEvent,
      {
        providerMessageId: messageId,
        event: {
          type: "email.delivered",
          occurredAt: Date.now(),
          metadata: { email_id: messageId },
        },
      }
    );

    const log = await t.run(async (ctx) =>
      ctx.db
        .query("emailLog")
        .withIndex("by_providerMessageId", (q) => q.eq("providerMessageId", messageId))
        .first()
    );
    expect(log?.status).toBe("delivered");
    expect(log?.deliveredAt).toBeGreaterThan(0);
  });

  it("opened event with existing delivered status advances to opened", async () => {
    const t = setupTest();
    const messageId = "re_abc_opened";
    await seedEmailLog(t, messageId);
    await t.mutation(
      internal.functions.email.internalMutations.handleWebhookEvent,
      {
        providerMessageId: messageId,
        event: { type: "email.delivered", occurredAt: Date.now(), metadata: {} },
      }
    );
    await t.mutation(
      internal.functions.email.internalMutations.handleWebhookEvent,
      {
        providerMessageId: messageId,
        event: {
          type: "email.opened",
          occurredAt: Date.now() + 1000,
          metadata: { user_agent: "Chrome" },
        },
      }
    );
    const log = await t.run(async (ctx) =>
      ctx.db
        .query("emailLog")
        .withIndex("by_providerMessageId", (q) => q.eq("providerMessageId", messageId))
        .first()
    );
    expect(log?.status).toBe("opened");
    expect(log?.openedAt).toBeGreaterThan(0);
  });

  it("clicked event records link metadata", async () => {
    const t = setupTest();
    const messageId = "re_abc_clicked";
    await seedEmailLog(t, messageId);
    await t.mutation(
      internal.functions.email.internalMutations.handleWebhookEvent,
      {
        providerMessageId: messageId,
        event: {
          type: "email.clicked",
          occurredAt: Date.now(),
          metadata: { link: "https://example.com/accept" },
        },
      }
    );
    const events = await t.run(async (ctx) =>
      ctx.db
        .query("emailEvents")
        .withIndex("by_providerMessageId", (q) => q.eq("providerMessageId", messageId))
        .collect()
    );
    expect(events.length).toBe(1);
    expect(events[0].metadata?.link).toBe("https://example.com/accept");
  });

  it("bounced event sets status to bounced (terminal) and records bounce metadata", async () => {
    const t = setupTest();
    const messageId = "re_abc_bounced";
    await seedEmailLog(t, messageId);
    await t.mutation(
      internal.functions.email.internalMutations.handleWebhookEvent,
      {
        providerMessageId: messageId,
        event: {
          type: "email.bounced",
          occurredAt: Date.now(),
          metadata: {
            bounce: { type: "HardBounce", message: "mailbox does not exist" },
          },
        },
      }
    );
    const log = await t.run(async (ctx) =>
      ctx.db
        .query("emailLog")
        .withIndex("by_providerMessageId", (q) => q.eq("providerMessageId", messageId))
        .first()
    );
    expect(log?.status).toBe("bounced");
    const events = await t.run(async (ctx) =>
      ctx.db
        .query("emailEvents")
        .withIndex("by_providerMessageId", (q) => q.eq("providerMessageId", messageId))
        .collect()
    );
    expect(events[0].metadata?.bounceType).toBe("HardBounce");
    expect(events[0].metadata?.bounceReason).toBe("mailbox does not exist");
  });

  it("complained event sets status to complained (terminal)", async () => {
    const t = setupTest();
    const messageId = "re_abc_complained";
    await seedEmailLog(t, messageId);
    await t.mutation(
      internal.functions.email.internalMutations.handleWebhookEvent,
      {
        providerMessageId: messageId,
        event: {
          type: "email.complained",
          occurredAt: Date.now(),
          metadata: {},
        },
      }
    );
    const log = await t.run(async (ctx) =>
      ctx.db
        .query("emailLog")
        .withIndex("by_providerMessageId", (q) => q.eq("providerMessageId", messageId))
        .first()
    );
    expect(log?.status).toBe("complained");
  });

  it("unknown providerMessageId is idempotent (no throw)", async () => {
    const t = setupTest();
    await expect(
      t.mutation(
        internal.functions.email.internalMutations.handleWebhookEvent,
        {
          providerMessageId: "re_unknown",
          event: {
            type: "email.delivered",
            occurredAt: Date.now(),
            metadata: {},
          },
        }
      )
    ).resolves.not.toThrow();
  });

  it("delivered event arriving AFTER opened does not downgrade status", async () => {
    const t = setupTest();
    const messageId = "re_abc_out_of_order";
    await seedEmailLog(t, messageId);
    await t.mutation(
      internal.functions.email.internalMutations.handleWebhookEvent,
      {
        providerMessageId: messageId,
        event: { type: "email.delivered", occurredAt: Date.now(), metadata: {} },
      }
    );
    await t.mutation(
      internal.functions.email.internalMutations.handleWebhookEvent,
      {
        providerMessageId: messageId,
        event: { type: "email.opened", occurredAt: Date.now() + 100, metadata: {} },
      }
    );
    await t.mutation(
      internal.functions.email.internalMutations.handleWebhookEvent,
      {
        providerMessageId: messageId,
        event: { type: "email.delivered", occurredAt: Date.now() + 200, metadata: {} },
      }
    );
    const log = await t.run(async (ctx) =>
      ctx.db
        .query("emailLog")
        .withIndex("by_providerMessageId", (q) => q.eq("providerMessageId", messageId))
        .first()
    );
    expect(log?.status).toBe("opened");
    const events = await t.run(async (ctx) =>
      ctx.db
        .query("emailEvents")
        .withIndex("by_providerMessageId", (q) => q.eq("providerMessageId", messageId))
        .collect()
    );
    expect(events.length).toBe(3);
  });
});
