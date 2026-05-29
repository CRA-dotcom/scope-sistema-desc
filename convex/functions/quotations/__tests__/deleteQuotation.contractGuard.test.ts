import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../../tests/harness";
import { seedClient, seedQuotation } from "./helpers/quotations";

function admin(orgId: string) {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `admin_${orgId}`,
    orgId,
    orgRole: "org:admin",
  };
}

describe("deleteQuotation contract guard", () => {
  it("throws HAS_CONTRACT when a contract references the draft quotation", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const quotationId = await seedQuotation(t, ORG_A, clientId, {
      status: "draft",
    });

    // Seed a contract pointing at the quotation
    await t.run(async (ctx) => {
      const q = await ctx.db.get(quotationId);
      if (!q) throw new Error("quotation not found in seed");
      await ctx.db.insert("contracts", {
        orgId: ORG_A,
        quotationId,
        projServiceId: q.projServiceId,
        clientId,
        serviceName: q.serviceName,
        content: "<p/>",
        status: "draft",
        createdAt: Date.now(),
      });
    });

    const err = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.quotations.mutations.deleteQuotation, {
        id: quotationId,
      })
      .catch((e: unknown) => e);

    // convex-test serializes ConvexError.data as a JSON string
    const data =
      typeof (err as any)?.data === "string"
        ? JSON.parse((err as any).data)
        : (err as any)?.data;
    expect(data).toMatchObject({ code: "HAS_CONTRACT" });

    // Quotation must still exist — delete was blocked
    const q = await t.run((ctx) => ctx.db.get(quotationId));
    expect(q).not.toBeNull();
  });

  it("deletes a draft quotation with no contract (happy path unaffected)", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const quotationId = await seedQuotation(t, ORG_A, clientId, {
      status: "draft",
    });

    await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.quotations.mutations.deleteQuotation, {
        id: quotationId,
      });

    const deleted = await t.run((ctx) => ctx.db.get(quotationId));
    expect(deleted).toBeNull();
  });
});
