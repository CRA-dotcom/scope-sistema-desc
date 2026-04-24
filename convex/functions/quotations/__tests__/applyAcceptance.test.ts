import { describe, it, expect } from "vitest";
import { internal } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../../tests/harness";
import { seedClient, seedQuotation } from "./helpers/quotations";

describe("applyAcceptance", () => {
  it("transitions sent to approved and clears accessTokenHash", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const quotationId = await seedQuotation(t, ORG_A, clientId, {
      status: "sent",
      accessTokenHash: "hash_v1",
      tokenExpiresAt: Date.now() + 100_000,
    });

    const result = await t.mutation(
      internal.functions.quotations.internalMutations.applyAcceptance,
      { tokenHash: "hash_v1" }
    );

    expect(result.quotationId).toBe(quotationId);
    expect(result.orgId).toBe(ORG_A);

    const after = await t.run((ctx) => ctx.db.get(quotationId));
    expect(after?.status).toBe("approved");
    expect(after?.accessTokenHash).toBeUndefined();
    expect(after?.respondedAt).toBeGreaterThan(0);
  });

  it("throws invalid_token when hash not found", async () => {
    const t = setupTest();
    await expect(
      t.mutation(internal.functions.quotations.internalMutations.applyAcceptance, {
        tokenHash: "missing",
      })
    ).rejects.toThrow(/invalid_token/);
  });

  it("throws already_responded when status is approved", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    await seedQuotation(t, ORG_A, clientId, {
      status: "approved",
      accessTokenHash: "hash_v1",
      tokenExpiresAt: Date.now() + 100_000,
    });
    await expect(
      t.mutation(internal.functions.quotations.internalMutations.applyAcceptance, {
        tokenHash: "hash_v1",
      })
    ).rejects.toThrow(/already_responded/);
  });

  it("throws already_responded when status is rejected", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    await seedQuotation(t, ORG_A, clientId, {
      status: "rejected",
      accessTokenHash: "hash_v1",
      tokenExpiresAt: Date.now() + 100_000,
    });
    await expect(
      t.mutation(internal.functions.quotations.internalMutations.applyAcceptance, {
        tokenHash: "hash_v1",
      })
    ).rejects.toThrow(/already_responded/);
  });

  it("throws expired when tokenExpiresAt < now", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    await seedQuotation(t, ORG_A, clientId, {
      status: "sent",
      accessTokenHash: "hash_v1",
      tokenExpiresAt: Date.now() - 1000,
    });
    await expect(
      t.mutation(internal.functions.quotations.internalMutations.applyAcceptance, {
        tokenHash: "hash_v1",
      })
    ).rejects.toThrow(/expired/);
  });

  it("second concurrent call throws already_responded", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    await seedQuotation(t, ORG_A, clientId, {
      status: "sent",
      accessTokenHash: "hash_v1",
      tokenExpiresAt: Date.now() + 100_000,
    });

    const [first, second] = await Promise.allSettled([
      t.mutation(internal.functions.quotations.internalMutations.applyAcceptance, {
        tokenHash: "hash_v1",
      }),
      t.mutation(internal.functions.quotations.internalMutations.applyAcceptance, {
        tokenHash: "hash_v1",
      }),
    ]);
    const fulfilled = [first, second].filter((r) => r.status === "fulfilled");
    const rejected = [first, second].filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(
      (rejected[0] as PromiseRejectedResult).reason.message
    ).toMatch(/already_responded|invalid_token/);
  });
});
