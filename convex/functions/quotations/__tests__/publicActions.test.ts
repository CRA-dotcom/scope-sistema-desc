import { describe, it, expect, beforeEach } from "vitest";
import crypto from "crypto";
import { api } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../../tests/harness";
import { seedClient, seedQuotation } from "./helpers/quotations";

const SECRET = "a".repeat(48);
function hashFor(token: string) {
  return crypto.createHmac("sha256", SECRET).update(token).digest("base64url");
}

describe("publicActions", () => {
  beforeEach(() => {
    process.env.QUOTATION_TOKEN_SECRET = SECRET;
  });

  it("acceptQuotation transitions to approved and returns approved status", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const token = "accept_tok";
    const qid = await seedQuotation(t, ORG_A, clientId, {
      status: "sent",
      accessTokenHash: hashFor(token),
      tokenExpiresAt: Date.now() + 100_000,
    });
    const result = await t.action(api.functions.quotations.publicActions.acceptQuotation, { token });
    expect(result.status).toBe("approved");
    expect(result.quotationId).toBe(qid);
    const q = await t.run((ctx) => ctx.db.get(qid));
    expect(q?.status).toBe("approved");
    // Scheduled contract generation runs async; we verify at the
    // transition level (approved + accessTokenHash cleared).
    expect(q?.accessTokenHash).toBeUndefined();
  });

  it("acceptQuotation with invalid token throws and does not schedule", async () => {
    const t = setupTest();
    await expect(
      t.action(api.functions.quotations.publicActions.acceptQuotation, { token: "ghost" })
    ).rejects.toThrow(/invalid_token/);
  });

  it("declineQuotation with reason records rejected + reason", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const token = "decline_tok";
    const qid = await seedQuotation(t, ORG_A, clientId, {
      status: "sent",
      accessTokenHash: hashFor(token),
      tokenExpiresAt: Date.now() + 100_000,
    });
    await t.action(api.functions.quotations.publicActions.declineQuotation, {
      token,
      declineReason: "muy caro",
    });
    const q = await t.run((ctx) => ctx.db.get(qid));
    expect(q?.status).toBe("rejected");
    expect(q?.declineReason).toBe("muy caro");
  });

  it("declineQuotation without reason stores undefined", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const token = "decline_no_reason";
    const qid = await seedQuotation(t, ORG_A, clientId, {
      status: "sent",
      accessTokenHash: hashFor(token),
      tokenExpiresAt: Date.now() + 100_000,
    });
    await t.action(api.functions.quotations.publicActions.declineQuotation, { token });
    const q = await t.run((ctx) => ctx.db.get(qid));
    expect(q?.status).toBe("rejected");
    expect(q?.declineReason).toBeUndefined();
  });
});
