import { describe, it, expect } from "vitest";
import { Webhook } from "svix";
import { setupTest, ORG_A } from "../../../../tests/harness";

const WEBHOOK_SECRET = "whsec_testSecret1234567890abcdefghij";

function signPayload(body: string, secret: string = WEBHOOK_SECRET) {
  const wh = new Webhook(secret);
  const msgId = "msg_" + Math.random().toString(36).slice(2);
  const timestampSec = Math.floor(Date.now() / 1000);
  const signature = wh.sign(
    msgId,
    new Date(timestampSec * 1000),
    body
  );
  return {
    "svix-id": msgId,
    "svix-timestamp": String(timestampSec),
    "svix-signature": signature,
    "content-type": "application/json",
  };
}

async function seedOrgAndEmail(
  t: ReturnType<typeof setupTest>,
  providerMessageId: string
) {
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
    await ctx.db.insert("emailLog", {
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

describe("POST /webhooks/resend", () => {
  it("valid signed delivered event → 200 + emailLog.status advances", async () => {
    const t = setupTest();
    const messageId = "re_http_delivered";
    await seedOrgAndEmail(t, messageId);

    const body = JSON.stringify({
      type: "email.delivered",
      created_at: new Date().toISOString(),
      data: { email_id: messageId },
    });
    const headers = signPayload(body);

    const res = await t.fetch("/webhooks/resend", {
      method: "POST",
      headers,
      body,
    });

    expect(res.status).toBe(200);

    const log = await t.run(async (ctx) =>
      ctx.db
        .query("emailLog")
        .withIndex("by_providerMessageId", (q) =>
          q.eq("providerMessageId", messageId)
        )
        .first()
    );
    expect(log?.status).toBe("delivered");
  });

  it("missing svix headers → 400", async () => {
    const t = setupTest();
    const res = await t.fetch("/webhooks/resend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "email.sent", data: { email_id: "x" } }),
    });
    expect(res.status).toBe(400);
  });

  it("invalid signature → 401", async () => {
    const t = setupTest();
    const messageId = "re_http_invalid_sig";
    await seedOrgAndEmail(t, messageId);

    const body = JSON.stringify({
      type: "email.delivered",
      created_at: new Date().toISOString(),
      data: { email_id: messageId },
    });
    // Sign with a different valid-format secret — signature won't verify against WEBHOOK_SECRET
    const headers = signPayload(body, "whsec_differentValidSecret0000000000");

    const res = await t.fetch("/webhooks/resend", {
      method: "POST",
      headers,
      body,
    });
    expect(res.status).toBe(401);

    // emailLog status should NOT change on rejected signature
    const log = await t.run(async (ctx) =>
      ctx.db
        .query("emailLog")
        .withIndex("by_providerMessageId", (q) =>
          q.eq("providerMessageId", messageId)
        )
        .first()
    );
    expect(log?.status).toBe("sent");
  });

  it("unknown providerMessageId → 200 (idempotent)", async () => {
    const t = setupTest();
    const body = JSON.stringify({
      type: "email.delivered",
      created_at: new Date().toISOString(),
      data: { email_id: "re_unknown_msgid" },
    });
    const headers = signPayload(body);

    const res = await t.fetch("/webhooks/resend", {
      method: "POST",
      headers,
      body,
    });
    expect(res.status).toBe(200);
  });

  it("malformed JSON body → 400", async () => {
    const t = setupTest();
    const body = "{not-valid-json";
    const headers = signPayload(body);
    const res = await t.fetch("/webhooks/resend", {
      method: "POST",
      headers,
      body,
    });
    expect(res.status).toBe(400);
  });
});
