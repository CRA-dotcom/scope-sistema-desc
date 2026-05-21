import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import { setupTest, ORG_A, ORG_B } from "../../../../tests/harness";

function admin(orgId: string) {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `user_admin_${orgId}`,
    orgId,
    orgRole: "org:admin" as const,
  };
}

const baseArgs = {
  companyName: "Acme S.A.",
  primaryColor: "#3B82F6",
  secondaryColor: "#1E293B",
  fontFamily: "Inter",
};

describe("orgBranding.mutations.upsert — operator path", () => {
  it("org-admin without orgId arg uses caller org", async () => {
    const t = setupTest();
    const id = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.orgBranding.mutations.upsert, baseArgs);

    const stored = await t.run(async (ctx) => ctx.db.get(id));
    expect(stored?.orgId).toBe(ORG_A);
    expect(stored?.companyName).toBe("Acme S.A.");
  });

  it("org-admin passing a foreign orgId is rejected", async () => {
    const t = setupTest();
    await expect(
      t
        .withIdentity(admin(ORG_A))
        .mutation(api.functions.orgBranding.mutations.upsert, {
          ...baseArgs,
          orgId: ORG_B,
        })
    ).rejects.toThrow(/otra organización/i);
  });
});
