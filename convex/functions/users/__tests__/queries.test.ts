import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../../tests/harness";

function adminIdentity(orgId: string) {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `user_admin_${orgId}`,
    orgId,
    orgRole: "org:admin" as const,
  };
}

async function seedClient(
  t: ReturnType<typeof setupTest>,
  opts: { orgId: string; name: string; assignedTo?: string; isArchived?: boolean }
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("clients", {
      orgId: opts.orgId,
      name: opts.name,
      rfc: "XAXX010101000",
      industry: "demo",
      annualRevenue: 0,
      billingFrequency: "mensual",
      isArchived: opts.isArchived ?? false,
      assignedTo: opts.assignedTo,
      createdAt: Date.now(),
    })
  );
}

describe("users.queries.listAssignmentsForOrg", () => {
  it("counts active clients assigned per userId in caller org", async () => {
    const t = setupTest();
    await seedClient(t, { orgId: ORG_A, name: "Cli 1", assignedTo: "user_x" });
    await seedClient(t, { orgId: ORG_A, name: "Cli 2", assignedTo: "user_x" });
    await seedClient(t, { orgId: ORG_A, name: "Cli 3", assignedTo: "user_y" });
    // unassigned should not appear
    await seedClient(t, { orgId: ORG_A, name: "Cli 4" });

    const result = await t
      .withIdentity(adminIdentity(ORG_A))
      .query(api.functions.users.queries.listAssignmentsForOrg, {});

    expect(result).toHaveLength(2);
    const byUser = Object.fromEntries(
      result.map((r) => [r.userId, r.assignedClientCount])
    );
    expect(byUser["user_x"]).toBe(2);
    expect(byUser["user_y"]).toBe(1);
  });

  it("ignores archived clients in the count", async () => {
    const t = setupTest();
    await seedClient(t, { orgId: ORG_A, name: "Active", assignedTo: "user_z" });
    await seedClient(t, {
      orgId: ORG_A,
      name: "Archived",
      assignedTo: "user_z",
      isArchived: true,
    });

    const result = await t
      .withIdentity(adminIdentity(ORG_A))
      .query(api.functions.users.queries.listAssignmentsForOrg, {});
    const entry = result.find((r) => r.userId === "user_z");
    expect(entry?.assignedClientCount).toBe(1);
  });
});
