import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
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

async function seedParent(
  t: ReturnType<typeof setupTest>,
  name = "Legal"
): Promise<Id<"services">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("services", {
      orgId: undefined,
      name,
      type: "base" as const,
      minPct: 0.01,
      maxPct: 0.03,
      defaultPct: 0.02,
      isDefault: true,
      isCommission: false,
      isCustom: false,
      sortOrder: 1,
    });
  });
}

async function seedGlobalSub(
  t: ReturnType<typeof setupTest>,
  parentId: Id<"services">,
  slug: string
): Promise<Id<"subservices">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("subservices", {
      orgId: undefined,
      parentServiceId: parentId,
      name: slug,
      slug,
      defaultFrequency: "mensual" as const,
      isActive: true,
      isDefault: true,
      sortOrder: 10,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function seedClone(
  t: ReturnType<typeof setupTest>,
  parentId: Id<"services">,
  slug: string,
  orgId: string
): Promise<Id<"subservices">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("subservices", {
      orgId,
      parentServiceId: parentId,
      name: slug,
      slug,
      defaultFrequency: "mensual" as const,
      isActive: true,
      isDefault: false,
      sortOrder: 10,
      createdAt: now,
      updatedAt: now,
    });
  });
}

describe("subservices.globalMutations.createGlobal", () => {
  it("super-admin inserta con orgId: undefined + log a documentEvents", async () => {
    const t = setupTest();
    const legal = await seedParent(t);

    const id = await t
      .withIdentity(SUPER_ADMIN)
      .mutation(api.functions.subservices.globalMutations.createGlobal, {
        parentServiceId: legal,
        name: "Test Global",
        defaultFrequency: "mensual",
      });

    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row).not.toBeNull();
    expect(row?.orgId).toBeUndefined();
    expect(row?.isDefault).toBe(true);
    expect(row?.slug).toBe("test-global");

    // Verify documentEvent log with platform marker.
    const events = await t.run((ctx) =>
      ctx.db.query("documentEvents").collect()
    );
    expect(events.length).toBe(1);
    expect(events[0].orgId).toBe("__platform__");
    expect(events[0].entityType).toBe("subservice");
    expect(events[0].eventType).toBe("created");
    expect(events[0].severity).toBe("info");
  });

  it("org-admin no-super-admin no puede crear global", async () => {
    const t = setupTest();
    const legal = await seedParent(t);

    await expect(
      t
        .withIdentity(admin(ORG_A))
        .mutation(api.functions.subservices.globalMutations.createGlobal, {
          parentServiceId: legal,
          name: "Hijack",
          defaultFrequency: "mensual",
        })
    ).rejects.toThrow(/Super Admin/i);
  });
});

describe("subservices.globalMutations.updateGlobal", () => {
  it("advierte sobre clones con severity=warning y retorna clonesAffected", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    const globalId = await seedGlobalSub(t, legal, "test-sub");
    await seedClone(t, legal, "test-sub", ORG_A);
    await seedClone(t, legal, "test-sub", ORG_B);

    const result = await t
      .withIdentity(SUPER_ADMIN)
      .mutation(api.functions.subservices.globalMutations.updateGlobal, {
        id: globalId,
        patch: { name: "Renamed" },
      });

    expect(result.clonesAffected).toBe(2);

    const updated = await t.run((ctx) => ctx.db.get(globalId));
    expect(updated?.name).toBe("Renamed");

    // Verify warning event.
    const events = await t.run((ctx) =>
      ctx.db.query("documentEvents").collect()
    );
    const updateEvent = events.find((e) => e.eventType === "updated");
    expect(updateEvent).toBeDefined();
    expect(updateEvent!.severity).toBe("warning");
    expect(updateEvent!.orgId).toBe("__platform__");
    expect(
      (updateEvent!.metadata as { clonesCount?: number } | undefined)
        ?.clonesCount
    ).toBe(2);
  });
});

describe("subservices.globalMutations.deleteGlobal", () => {
  it("bloquea si hay clones sin force; permite con force y deja clones huérfanos", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    const globalId = await seedGlobalSub(t, legal, "to-delete");
    const cloneId = await seedClone(t, legal, "to-delete", ORG_A);

    // Sin force → blocked
    await expect(
      t
        .withIdentity(SUPER_ADMIN)
        .mutation(api.functions.subservices.globalMutations.deleteGlobal, {
          id: globalId,
        })
    ).rejects.toThrow(/orgs tienen copias/i);

    // Con force → success
    const result = await t
      .withIdentity(SUPER_ADMIN)
      .mutation(api.functions.subservices.globalMutations.deleteGlobal, {
        id: globalId,
        force: true,
      });

    expect(result.ok).toBe(true);
    expect(result.clonesLeftOrphan).toBe(1);

    // Global gone, clone still alive.
    const globalGone = await t.run((ctx) => ctx.db.get(globalId));
    expect(globalGone).toBeNull();
    const cloneAlive = await t.run((ctx) => ctx.db.get(cloneId));
    expect(cloneAlive).not.toBeNull();

    // Verify deletion event.
    const events = await t.run((ctx) =>
      ctx.db.query("documentEvents").collect()
    );
    const deleteEvent = events.find((e) => e.eventType === "deleted");
    expect(deleteEvent).toBeDefined();
    expect(deleteEvent!.severity).toBe("warning");
    expect(
      (deleteEvent!.metadata as { clonesLeftOrphan?: number } | undefined)
        ?.clonesLeftOrphan
    ).toBe(1);
  });
});
