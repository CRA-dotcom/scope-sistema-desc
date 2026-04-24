import { describe, it, expect } from "vitest";
import { internal } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../../tests/harness";
import { seedClient, seedQuotation } from "./helpers/quotations";

describe("rotateTokenAndMarkSent", () => {
  it("patches quotation to sent, increments sendCount, sets token fields", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const quotationId = await seedQuotation(t, ORG_A, clientId, { status: "draft" });

    const tokenIssuedAt = Date.now();
    const tokenExpiresAt = tokenIssuedAt + 30 * 24 * 60 * 60 * 1000;

    await t.mutation(
      internal.functions.quotations.internalMutations.rotateTokenAndMarkSent,
      {
        quotationId,
        tokenHash: "hash_v1",
        tokenIssuedAt,
        tokenExpiresAt,
      }
    );

    const after = await t.run((ctx) => ctx.db.get(quotationId));
    expect(after?.status).toBe("sent");
    expect(after?.sendCount).toBe(1);
    expect(after?.accessTokenHash).toBe("hash_v1");
    expect(after?.tokenIssuedAt).toBe(tokenIssuedAt);
    expect(after?.tokenExpiresAt).toBe(tokenExpiresAt);
    expect(after?.lastSentAt).toBeGreaterThan(0);
  });

  it("increments sendCount from 2 to 3 on re-send and overwrites token", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const quotationId = await seedQuotation(t, ORG_A, clientId, {
      status: "sent",
      sendCount: 2,
      accessTokenHash: "old_hash",
    });

    await t.mutation(
      internal.functions.quotations.internalMutations.rotateTokenAndMarkSent,
      {
        quotationId,
        tokenHash: "new_hash",
        tokenIssuedAt: Date.now(),
        tokenExpiresAt: Date.now() + 1000,
      }
    );

    const after = await t.run((ctx) => ctx.db.get(quotationId));
    expect(after?.sendCount).toBe(3);
    expect(after?.accessTokenHash).toBe("new_hash");
  });
});
