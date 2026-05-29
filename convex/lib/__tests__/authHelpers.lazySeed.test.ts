/**
 * Phase 2 adversarial follow-up — lazy-seed organizations row
 *
 * Verifies that getOrgIdMutation (called from any mutation) auto-creates an
 * organizations row on first run for a Clerk org, and does NOT duplicate an
 * existing row.
 */
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { api } from "../../_generated/api";

function withMember(orgId: string) {
  return {
    tokenIdentifier: `test|member_${orgId}`,
    subject: `user_member_${orgId}`,
    orgId,
    orgRole: "org:member",
  };
}

describe("getOrgIdMutation lazy-seed", () => {
  it("creates organizations row on first mutation if missing", async () => {
    const t = convexTest(schema);

    // No organizations row pre-seeded — the mutation should create one
    await t.withIdentity(withMember("org_new_clerk_id")).mutation(
      api.functions.clients.mutations.create,
      {
        name: "Test Client",
        rfc: "TST010101AAA",
        industry: "Tech",
        annualRevenue: 1_000_000,
        billingFrequency: "mensual",
      },
    );

    const orgs = await t.run((ctx) =>
      ctx.db.query("organizations").collect(),
    );
    expect(orgs).toHaveLength(1);
    expect(orgs[0].clerkOrgId).toBe("org_new_clerk_id");
    expect(orgs[0].status).toBe("active");
    expect(orgs[0].plan).toBe("basic");
  });

  it("does NOT create duplicate if organizations row already exists", async () => {
    const t = convexTest(schema);

    // Pre-seed an existing row with plan="pro"
    await t.run(async (ctx) => {
      await ctx.db.insert("organizations", {
        clerkOrgId: "org_existing",
        name: "Org Existing",
        status: "active",
        plan: "pro",
        createdAt: 1000,
      });
    });

    await t.withIdentity(withMember("org_existing")).mutation(
      api.functions.clients.mutations.create,
      {
        name: "Test Client",
        rfc: "TST010101AAA",
        industry: "Tech",
        annualRevenue: 1_000_000,
        billingFrequency: "mensual",
      },
    );

    const orgs = await t.run((ctx) =>
      ctx.db.query("organizations").collect(),
    );
    expect(orgs).toHaveLength(1);
    expect(orgs[0].plan).toBe("pro"); // NOT overwritten to "basic"
    expect(orgs[0].createdAt).toBe(1000); // NOT reset
  });

  it("second mutation by same org still idempotent (row created only once)", async () => {
    const t = convexTest(schema);

    const identity = withMember("org_double");

    await t.withIdentity(identity).mutation(
      api.functions.clients.mutations.create,
      {
        name: "Client One",
        rfc: "ONE010101AAA",
        industry: "Tech",
        annualRevenue: 1_000_000,
        billingFrequency: "mensual",
      },
    );
    await t.withIdentity(identity).mutation(
      api.functions.clients.mutations.create,
      {
        name: "Client Two",
        rfc: "TWO010101AAA",
        industry: "Tech",
        annualRevenue: 1_000_000,
        billingFrequency: "mensual",
      },
    );

    const orgs = await t.run((ctx) =>
      ctx.db.query("organizations").collect(),
    );
    expect(orgs).toHaveLength(1);
    expect(orgs[0].clerkOrgId).toBe("org_double");
  });
});
