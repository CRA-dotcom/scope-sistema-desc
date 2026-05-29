import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { internal } from "../../../_generated/api";

describe("organizations webhook mutations", () => {
  it("createFromClerkWebhook inserts new org with active status", async () => {
    const t = convexTest(schema);
    const id = await t.mutation(
      internal.functions.organizations.webhookMutations.createFromClerkWebhook,
      {
        clerkOrgId: "org_test_clerk_123",
        name: "Test Org",
        createdAt: 1000,
      }
    );
    expect(id).toBeDefined();
    const org = await t.run((ctx) => ctx.db.get(id!));
    expect(org?.status).toBe("active");
    expect(org?.plan).toBe("basic");
    expect(org?.name).toBe("Test Org");
  });

  it("createFromClerkWebhook is idempotent (same clerkOrgId returns existing)", async () => {
    const t = convexTest(schema);
    const args = {
      clerkOrgId: "org_test_clerk_456",
      name: "Test Org",
      createdAt: 1000,
    };
    const firstId = await t.mutation(
      internal.functions.organizations.webhookMutations.createFromClerkWebhook,
      args
    );
    const secondId = await t.mutation(
      internal.functions.organizations.webhookMutations.createFromClerkWebhook,
      { ...args, name: "Different Name" }
    );
    expect(secondId).toBe(firstId);
    const orgs = await t.run((ctx) => ctx.db.query("organizations").collect());
    expect(orgs).toHaveLength(1);
    expect(orgs[0].name).toBe("Test Org"); // first write wins
  });

  it("updateFromClerkWebhook patches name when changed", async () => {
    const t = convexTest(schema);
    const id = await t.run((ctx) =>
      ctx.db.insert("organizations", {
        clerkOrgId: "org_test_update",
        name: "Original",
        status: "active",
        plan: "basic",
        createdAt: 1000,
      })
    );
    await t.mutation(
      internal.functions.organizations.webhookMutations.updateFromClerkWebhook,
      { clerkOrgId: "org_test_update", name: "Updated" }
    );
    const org = await t.run((ctx) => ctx.db.get(id));
    expect(org?.name).toBe("Updated");
  });

  it("markInactiveFromClerkWebhook flips status to inactive", async () => {
    const t = convexTest(schema);
    const id = await t.run((ctx) =>
      ctx.db.insert("organizations", {
        clerkOrgId: "org_to_delete",
        name: "X",
        status: "active",
        plan: "basic",
        createdAt: 1000,
      })
    );
    await t.mutation(
      internal.functions.organizations.webhookMutations.markInactiveFromClerkWebhook,
      { clerkOrgId: "org_to_delete" }
    );
    const org = await t.run((ctx) => ctx.db.get(id));
    expect(org?.status).toBe("inactive");
  });
});
