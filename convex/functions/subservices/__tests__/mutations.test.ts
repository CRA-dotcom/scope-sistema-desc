import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import { setupTest, ORG_A, ORG_B } from "../../../../tests/harness";

function admin(orgId: string) {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `user_admin_${orgId}`,
    orgId,
    orgRole: "org:admin",
  };
}

function member(orgId: string) {
  return {
    tokenIdentifier: `test|member_${orgId}`,
    subject: `user_member_${orgId}`,
    orgId,
    orgRole: "org:member",
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
  slug: string,
  sortOrder = 10
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
      sortOrder,
      createdAt: now,
      updatedAt: now,
    });
  });
}

describe("subservices.mutations.create", () => {
  it("inserta con orgId del caller y derive slug del name", async () => {
    const t = setupTest();
    const legal = await seedParent(t);

    const id = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.subservices.mutations.create, {
        parentServiceId: legal,
        name: "Gobierno Corporativo",
        defaultFrequency: "trimestral",
      });

    const doc = await t.run((ctx) => ctx.db.get(id));
    expect(doc).not.toBeNull();
    expect(doc?.orgId).toBe(ORG_A);
    expect(doc?.isDefault).toBe(false);
    expect(doc?.slug).toBe("gobierno-corporativo");
    expect(doc?.name).toBe("Gobierno Corporativo");
    expect(doc?.isActive).toBe(true);
  });

  it("rechaza duplicado por (parent, slug, orgId)", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.subservices.mutations.create,
      {
        parentServiceId: legal,
        name: "Compliance",
        slug: "compliance",
        defaultFrequency: "mensual",
      }
    );

    await expect(
      t.withIdentity(admin(ORG_A)).mutation(
        api.functions.subservices.mutations.create,
        {
          parentServiceId: legal,
          name: "Compliance 2",
          slug: "compliance",
          defaultFrequency: "mensual",
        }
      )
    ).rejects.toThrow(/Ya existe/i);
  });

  it("permite mismo slug en orgB (multi-tenant)", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.subservices.mutations.create,
      {
        parentServiceId: legal,
        name: "Compliance",
        defaultFrequency: "mensual",
      }
    );
    const idB = await t.withIdentity(admin(ORG_B)).mutation(
      api.functions.subservices.mutations.create,
      {
        parentServiceId: legal,
        name: "Compliance",
        defaultFrequency: "mensual",
      }
    );
    expect(idB).toBeDefined();
    const docB = await t.run((ctx) => ctx.db.get(idB));
    expect(docB?.orgId).toBe(ORG_B);
  });

  it("permite duplicar slug de un global (caso override esperado)", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    await seedGlobalSub(t, legal, "compliance");

    const id = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.subservices.mutations.create,
      {
        parentServiceId: legal,
        name: "Compliance Custom",
        slug: "compliance",
        defaultFrequency: "trimestral",
      }
    );
    const doc = await t.run((ctx) => ctx.db.get(id));
    expect(doc?.orgId).toBe(ORG_A);
  });

  it("members no pueden crear", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    await expect(
      t.withIdentity(member(ORG_A)).mutation(
        api.functions.subservices.mutations.create,
        {
          parentServiceId: legal,
          name: "X",
          defaultFrequency: "mensual",
        }
      )
    ).rejects.toThrow(/Administrador/i);
  });
});

describe("subservices.mutations.update", () => {
  it("patch parcial actualiza solo los campos pasados", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    const id = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.subservices.mutations.create,
      {
        parentServiceId: legal,
        name: "Test",
        defaultFrequency: "mensual",
      }
    );
    const before = await t.run((ctx) => ctx.db.get(id));

    // small delay so updatedAt strictly > createdAt
    await new Promise((r) => setTimeout(r, 2));

    await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.subservices.mutations.update,
      { id, patch: { defaultFrequency: "trimestral" } }
    );
    const after = await t.run((ctx) => ctx.db.get(id));

    expect(after?.defaultFrequency).toBe("trimestral");
    expect(after?.name).toBe(before?.name);
    expect((after?.updatedAt ?? 0)).toBeGreaterThan(before?.updatedAt ?? 0);
  });

  it("rechaza editar un global desde un org (debe personalizar primero)", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    const globalId = await seedGlobalSub(t, legal, "global-sub");
    await expect(
      t.withIdentity(admin(ORG_A)).mutation(
        api.functions.subservices.mutations.update,
        { id: globalId, patch: { name: "Hijack" } }
      )
    ).rejects.toThrow(/Personaliza/i);
  });

  it("orgB no puede editar subservicio de orgA", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    const id = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.subservices.mutations.create,
      {
        parentServiceId: legal,
        name: "A",
        defaultFrequency: "mensual",
      }
    );
    await expect(
      t.withIdentity(admin(ORG_B)).mutation(
        api.functions.subservices.mutations.update,
        { id, patch: { name: "Hijack" } }
      )
    ).rejects.toThrow(/no encontrado/i);
  });
});

describe("subservices.mutations.personalizeGlobal", () => {
  it("clona el global en org-scoped con tracking de origen", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    const globalId = await seedGlobalSub(t, legal, "compliance");
    const globalBefore = await t.run((ctx) => ctx.db.get(globalId));

    const cloneId = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.subservices.mutations.personalizeGlobal,
      { sourceId: globalId }
    );

    expect(cloneId).not.toBe(globalId);
    const clone = await t.run((ctx) => ctx.db.get(cloneId));
    expect(clone?.orgId).toBe(ORG_A);
    expect(clone?.isDefault).toBe(false);
    expect(clone?.slug).toBe("compliance");
    expect(clone?.parentSubserviceId).toBe(globalId);
    expect(clone?.originalVersionAtClone).toBe(globalBefore?.updatedAt);
  });

  it("idempotente: segunda llamada devuelve el mismo clone, no inserta", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    const globalId = await seedGlobalSub(t, legal, "compliance");

    const first = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.subservices.mutations.personalizeGlobal,
      { sourceId: globalId }
    );
    const second = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.subservices.mutations.personalizeGlobal,
      { sourceId: globalId }
    );
    expect(second).toBe(first);

    const all = await t.run((ctx) =>
      ctx.db
        .query("subservices")
        .withIndex("by_orgId", (q) => q.eq("orgId", ORG_A))
        .collect()
    );
    expect(all).toHaveLength(1);
  });

  it("rechaza personalizar un subservicio que ya es org-scoped", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    const orgSub = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.subservices.mutations.create,
      {
        parentServiceId: legal,
        name: "X",
        defaultFrequency: "mensual",
      }
    );
    await expect(
      t.withIdentity(admin(ORG_A)).mutation(
        api.functions.subservices.mutations.personalizeGlobal,
        { sourceId: orgSub }
      )
    ).rejects.toThrow(/globales/i);
  });
});

describe("subservices.mutations.toggleActive", () => {
  it("flippea isActive en org-scoped y bloquea globales", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    const id = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.subservices.mutations.create,
      {
        parentServiceId: legal,
        name: "X",
        defaultFrequency: "mensual",
      }
    );
    const r1 = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.subservices.mutations.toggleActive,
      { id }
    );
    expect(r1.isActive).toBe(false);
    const r2 = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.subservices.mutations.toggleActive,
      { id }
    );
    expect(r2.isActive).toBe(true);

    // globals are blocked
    const globalId = await seedGlobalSub(t, legal, "global-sub");
    await expect(
      t.withIdentity(admin(ORG_A)).mutation(
        api.functions.subservices.mutations.toggleActive,
        { id: globalId }
      )
    ).rejects.toThrow(/global/i);
  });
});

describe("subservices.mutations.remove", () => {
  it("bloquea con refs activas en projectionServices", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    const subId = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.subservices.mutations.create,
      {
        parentServiceId: legal,
        name: "Test",
        defaultFrequency: "mensual",
      }
    );

    // create a projection + projectionServices referencing this subservice
    await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: ORG_A,
        name: "C",
        rfc: "ZZZ010101AAA",
        industry: "x",
        annualRevenue: 0,
        billingFrequency: "mensual",
        isArchived: false,
        createdAt: Date.now(),
      });
      const projId = await ctx.db.insert("projections", {
        orgId: ORG_A,
        clientId,
        year: 2026,
        annualSales: 100,
        totalBudget: 10,
        commissionRate: 0,
        seasonalityData: [],
        status: "active" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("projectionServices", {
        orgId: ORG_A,
        projectionId: projId,
        serviceId: legal,
        serviceName: "Legal",
        subserviceId: subId,
        chosenPct: 0.02,
        isActive: true,
        annualAmount: 2,
        normalizedWeight: 1,
      });
    });

    await expect(
      t.withIdentity(admin(ORG_A)).mutation(
        api.functions.subservices.mutations.remove,
        { id: subId }
      )
    ).rejects.toThrow(/proyecciones activas/i);
  });

  it("acepta sin refs", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    const subId = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.subservices.mutations.create,
      {
        parentServiceId: legal,
        name: "Sin refs",
        defaultFrequency: "mensual",
      }
    );
    const result = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.subservices.mutations.remove,
      { id: subId }
    );
    expect(result).toEqual({ ok: true });
    const gone = await t.run((ctx) => ctx.db.get(subId));
    expect(gone).toBeNull();
  });

  it("bloquea borrar globales desde un org", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    const globalId = await seedGlobalSub(t, legal, "global-sub");
    await expect(
      t.withIdentity(admin(ORG_A)).mutation(
        api.functions.subservices.mutations.remove,
        { id: globalId }
      )
    ).rejects.toThrow(/global/i);
  });

  it("orgB no puede borrar subservicio de orgA", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    const subId = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.subservices.mutations.create,
      {
        parentServiceId: legal,
        name: "OrgA Only",
        defaultFrequency: "mensual",
      }
    );
    await expect(
      t.withIdentity(admin(ORG_B)).mutation(
        api.functions.subservices.mutations.remove,
        { id: subId }
      )
    ).rejects.toThrow(/no encontrado/i);
  });
});

describe("subservices.mutations.restoreToGlobal", () => {
  it("borra el clone org-scoped — query siguiente cae a global", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    const globalId = await seedGlobalSub(t, legal, "compliance");
    const cloneId = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.subservices.mutations.personalizeGlobal,
      { sourceId: globalId }
    );

    const result = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.subservices.mutations.restoreToGlobal,
      { id: cloneId }
    );
    expect(result).toEqual({ ok: true });
    const gone = await t.run((ctx) => ctx.db.get(cloneId));
    expect(gone).toBeNull();

    // listByParent now resolves to the global
    const list = await t.withIdentity(admin(ORG_A)).query(
      api.functions.subservices.queries.listByParent,
      { parentServiceId: legal }
    );
    expect(list).toHaveLength(1);
    expect(list[0]._id).toBe(globalId);
  });

  it("rechaza restaurar un global (nada que restaurar)", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    const globalId = await seedGlobalSub(t, legal, "x");
    await expect(
      t.withIdentity(admin(ORG_A)).mutation(
        api.functions.subservices.mutations.restoreToGlobal,
        { id: globalId }
      )
    ).rejects.toThrow(/global/i);
  });
});
