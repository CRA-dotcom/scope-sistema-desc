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
function member(orgId: string) {
  return {
    tokenIdentifier: `test|member_${orgId}`,
    subject: `user_member_${orgId}`,
    orgId,
    orgRole: "org:member" as const,
  };
}

async function seedClient(
  t: ReturnType<typeof setupTest>,
  opts: { orgId: string; assignedTo?: string }
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("clients", {
      orgId: opts.orgId,
      name: "Test client",
      rfc: "XAXX010101000",
      industry: "demo",
      annualRevenue: 0,
      billingFrequency: "mensual",
      isArchived: false,
      assignedTo: opts.assignedTo,
      createdAt: Date.now(),
    })
  );
}

describe("users.mutations.assignToClient", () => {
  it("admin in same org can assign", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, { orgId: ORG_A });
    const result = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.users.mutations.assignToClient, {
        clientId,
        userId: "user_executive_1",
      });
    expect(result.ok).toBe(true);
    const fresh = await t.run(async (ctx) => ctx.db.get(clientId));
    expect(fresh?.assignedTo).toBe("user_executive_1");
  });

  it("rejects assignment to a client from a different org (multi-tenant guard)", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, {
      orgId: ORG_A,
      assignedTo: "original_user",
    });

    await expect(
      t
        .withIdentity(admin(ORG_B))
        .mutation(api.functions.users.mutations.assignToClient, {
          clientId,
          userId: "user_executive_2",
        })
    ).rejects.toThrow(/otra organización/i);

    // ensure the original assignment is intact
    const fresh = await t.run(async (ctx) => ctx.db.get(clientId));
    expect(fresh?.assignedTo).toBe("original_user");
  });

  it("rejects non-admin caller", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, { orgId: ORG_A });
    await expect(
      t
        .withIdentity(member(ORG_A))
        .mutation(api.functions.users.mutations.assignToClient, {
          clientId,
          userId: "user_x",
        })
    ).rejects.toThrow(/Administrador/i);
  });
});

describe("users.mutations.unassign", () => {
  it("clears the assignedTo field for a client in caller org", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, {
      orgId: ORG_A,
      assignedTo: "user_executive_1",
    });
    await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.users.mutations.unassign, { clientId });
    const fresh = await t.run(async (ctx) => ctx.db.get(clientId));
    expect(fresh?.assignedTo).toBeUndefined();
  });
});
