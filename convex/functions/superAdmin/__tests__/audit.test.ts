import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../../tests/harness";

const SUPER_ADMIN = {
  tokenIdentifier: "test|super_admin",
  subject: "user_super_admin",
  publicMetadata: { role: "super_admin" } as const,
};

function admin(orgId: string) {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `user_admin_${orgId}`,
    orgId,
    orgRole: "org:admin" as const,
  };
}

describe("superAdmin.audit.listOrgsForAuditFilter", () => {
  it("retorna {clerkOrgId,name} orden alfabético + multi-tenant guard", async () => {
    const t = setupTest();
    await t.run(async (ctx) => {
      await ctx.db.insert("organizations", {
        clerkOrgId: "org_c",
        name: "Charlie",
        status: "active" as const,
        plan: "basic" as const,
        createdAt: Date.now(),
      });
      await ctx.db.insert("organizations", {
        clerkOrgId: "org_a",
        name: "Alpha",
        status: "active" as const,
        plan: "basic" as const,
        createdAt: Date.now(),
      });
      await ctx.db.insert("organizations", {
        clerkOrgId: "org_b",
        name: "Beta",
        status: "active" as const,
        plan: "basic" as const,
        createdAt: Date.now(),
      });
    });

    const result = await t
      .withIdentity(SUPER_ADMIN)
      .query(api.functions.superAdmin.audit.listOrgsForAuditFilter, {});

    expect(result.map((o) => o.name)).toEqual(["Alpha", "Beta", "Charlie"]);

    // Multi-tenant guard: non-super-admin → empty.
    const denied = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.superAdmin.audit.listOrgsForAuditFilter, {});
    expect(denied).toEqual([]);
  });
});
