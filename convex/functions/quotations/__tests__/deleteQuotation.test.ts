import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import { setupTest, ORG_A, ORG_B } from "../../../../tests/harness";
import { seedClient, seedQuotation } from "./helpers/quotations";

function admin(orgId: string) {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `admin_${orgId}`,
    orgId,
    orgRole: "org:admin",
  };
}

describe("quotations.mutations.deleteQuotation", () => {
  it("deletes a draft quotation successfully", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const qid = await seedQuotation(t, ORG_A, clientId, { status: "draft" });

    await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.quotations.mutations.deleteQuotation, {
        id: qid,
      });

    const deleted = await t.run((ctx) => ctx.db.get(qid));
    expect(deleted).toBeNull();
  });

  it("throws when trying to delete a non-draft quotation", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);

    for (const status of ["sent", "approved", "rejected"] as const) {
      const qid = await seedQuotation(t, ORG_A, clientId, { status });
      await expect(
        t
          .withIdentity(admin(ORG_A))
          .mutation(api.functions.quotations.mutations.deleteQuotation, {
            id: qid,
          })
      ).rejects.toThrow(
        "Solo cotizaciones en estado borrador pueden eliminarse."
      );
    }
  });

  it("throws when quotation belongs to a different org", async () => {
    const t = setupTest();
    const clientB = await seedClient(t, ORG_B);
    const qid = await seedQuotation(t, ORG_B, clientB, { status: "draft" });

    // ORG_A identity should not find the ORG_B quotation
    await expect(
      t
        .withIdentity(admin(ORG_A))
        .mutation(api.functions.quotations.mutations.deleteQuotation, {
          id: qid,
        })
    ).rejects.toThrow("Cotización no encontrada.");
  });
});
