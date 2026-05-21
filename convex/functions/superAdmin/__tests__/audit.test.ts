import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import { setupTest, ORG_A, ORG_B } from "../../../../tests/harness";

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

describe("superAdmin.audit.listClientsForOrg", () => {
  it("super-admin: cross-org listing returns only target org's clients", async () => {
    const t = setupTest();
    await t.run(async (ctx) => {
      // Seed ORG_A with 2 clients.
      await ctx.db.insert("clients", {
        orgId: ORG_A,
        name: "Cliente A1",
        rfc: "AAA010101AAA",
        industry: "Consultoría",
        annualRevenue: 1_000_000,
        billingFrequency: "mensual" as const,
        isArchived: false,
        createdAt: Date.now(),
      });
      await ctx.db.insert("clients", {
        orgId: ORG_A,
        name: "Cliente A2",
        rfc: "AAA020202BBB",
        industry: "Servicios",
        annualRevenue: 500_000,
        billingFrequency: "mensual" as const,
        isArchived: false,
        createdAt: Date.now(),
      });
      // Seed ORG_B with 2 different clients.
      await ctx.db.insert("clients", {
        orgId: ORG_B,
        name: "Cliente B1",
        rfc: "BBB010101CCC",
        industry: "Manufactura",
        annualRevenue: 2_000_000,
        billingFrequency: "quincenal" as const,
        isArchived: false,
        createdAt: Date.now(),
      });
      await ctx.db.insert("clients", {
        orgId: ORG_B,
        name: "Cliente B2",
        rfc: "BBB020202DDD",
        industry: "Comercio",
        annualRevenue: 750_000,
        billingFrequency: "semanal" as const,
        isArchived: false,
        createdAt: Date.now(),
      });
    });

    // Super-admin querying ORG_B should see ORG_B's clients (NOT ORG_A's).
    const rows = await t
      .withIdentity(SUPER_ADMIN)
      .query(api.functions.superAdmin.audit.listClientsForOrg, {
        orgId: ORG_B,
      });

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.name).sort()).toEqual(["Cliente B1", "Cliente B2"]);
    // Confirm none of the ORG_A names leaked in.
    expect(rows.map((r) => r.name)).not.toContain("Cliente A1");
    expect(rows.map((r) => r.name)).not.toContain("Cliente A2");
  });

  it("non-super-admin: org:admin cross-org call returns [] (guard, no throw)", async () => {
    const t = setupTest();
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", {
        orgId: ORG_B,
        name: "Cliente B1",
        rfc: "BBB010101CCC",
        industry: "Manufactura",
        annualRevenue: 2_000_000,
        billingFrequency: "quincenal" as const,
        isArchived: false,
        createdAt: Date.now(),
      });
    });

    // ORG_A admin attempts to read ORG_B's clients → must return [] silently.
    const denied = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.superAdmin.audit.listClientsForOrg, {
        orgId: ORG_B,
      });
    expect(denied).toEqual([]);
  });
});
