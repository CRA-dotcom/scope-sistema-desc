import { describe, it, expect } from "vitest";
import { internal } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../../tests/harness";
import { seedClient, seedQuotation } from "./helpers/quotations";

describe("applyDecline", () => {
  it("transitions sent to rejected and stores declineReason", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const quotationId = await seedQuotation(t, ORG_A, clientId, {
      status: "sent",
      accessTokenHash: "hash_d1",
      tokenExpiresAt: Date.now() + 100_000,
    });

    await t.mutation(
      internal.functions.quotations.internalMutations.applyDecline,
      { tokenHash: "hash_d1", declineReason: "muy caro" }
    );

    const after = await t.run((ctx) => ctx.db.get(quotationId));
    expect(after?.status).toBe("rejected");
    expect(after?.declineReason).toBe("muy caro");
    expect(after?.respondedAt).toBeGreaterThan(0);
    expect(after?.accessTokenHash).toBeUndefined();
  });

  it("truncates declineReason to 500 chars", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const quotationId = await seedQuotation(t, ORG_A, clientId, {
      status: "sent",
      accessTokenHash: "hash_d1",
      tokenExpiresAt: Date.now() + 100_000,
    });
    const long = "x".repeat(600);
    await t.mutation(
      internal.functions.quotations.internalMutations.applyDecline,
      { tokenHash: "hash_d1", declineReason: long }
    );
    const after = await t.run((ctx) => ctx.db.get(quotationId));
    expect(after?.declineReason).toHaveLength(500);
  });

  it("stores undefined when declineReason is undefined", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const quotationId = await seedQuotation(t, ORG_A, clientId, {
      status: "sent",
      accessTokenHash: "hash_d1",
      tokenExpiresAt: Date.now() + 100_000,
    });
    await t.mutation(
      internal.functions.quotations.internalMutations.applyDecline,
      { tokenHash: "hash_d1" }
    );
    const after = await t.run((ctx) => ctx.db.get(quotationId));
    expect(after?.declineReason).toBeUndefined();
  });

  it("normalizes empty string to undefined", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const quotationId = await seedQuotation(t, ORG_A, clientId, {
      status: "sent",
      accessTokenHash: "hash_d1",
      tokenExpiresAt: Date.now() + 100_000,
    });
    await t.mutation(
      internal.functions.quotations.internalMutations.applyDecline,
      { tokenHash: "hash_d1", declineReason: "" }
    );
    const after = await t.run((ctx) => ctx.db.get(quotationId));
    expect(after?.declineReason).toBeUndefined();
  });
});
