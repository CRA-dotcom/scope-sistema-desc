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

  it("rechaza slug inválido (no kebab-case)", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    await expect(
      t.withIdentity(admin(ORG_A)).mutation(
        api.functions.subservices.mutations.create,
        {
          parentServiceId: legal,
          name: "Random",
          slug: "Some Random Slug!",
          defaultFrequency: "mensual",
        }
      )
    ).rejects.toThrow(/kebab-case/i);
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

  it("members no pueden actualizar", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    const id = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.subservices.mutations.create,
      {
        parentServiceId: legal,
        name: "MemberTest",
        defaultFrequency: "mensual",
      }
    );
    const before = await t.run((ctx) => ctx.db.get(id));
    await expect(
      t.withIdentity(member(ORG_A)).mutation(
        api.functions.subservices.mutations.update,
        { id, patch: { name: "Hijack" } }
      )
    ).rejects.toThrow(/Administrador/i);
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.name).toBe(before?.name);
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

  it("orgB personalizando el mismo global produce un clone separado (no toca el de orgA)", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    const globalId = await seedGlobalSub(t, legal, "compliance");

    const cloneA = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.subservices.mutations.personalizeGlobal,
      { sourceId: globalId }
    );
    const cloneB = await t.withIdentity(admin(ORG_B)).mutation(
      api.functions.subservices.mutations.personalizeGlobal,
      { sourceId: globalId }
    );

    expect(cloneB).not.toBe(cloneA);

    const docA = await t.run((ctx) => ctx.db.get(cloneA));
    const docB = await t.run((ctx) => ctx.db.get(cloneB));
    expect(docA?.orgId).toBe(ORG_A);
    expect(docB?.orgId).toBe(ORG_B);
    expect(docA?.parentSubserviceId).toBe(globalId);
    expect(docB?.parentSubserviceId).toBe(globalId);

    // orgA's clone untouched: still exists and its orgId is still ORG_A.
    expect(docA).not.toBeNull();

    // Each org sees exactly its own clone (not the other's).
    const allA = await t.run((ctx) =>
      ctx.db
        .query("subservices")
        .withIndex("by_orgId", (q) => q.eq("orgId", ORG_A))
        .collect()
    );
    const allB = await t.run((ctx) =>
      ctx.db
        .query("subservices")
        .withIndex("by_orgId", (q) => q.eq("orgId", ORG_B))
        .collect()
    );
    expect(allA).toHaveLength(1);
    expect(allB).toHaveLength(1);
    expect(allA[0]._id).toBe(cloneA);
    expect(allB[0]._id).toBe(cloneB);
  });

  it("members no pueden personalizar", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    const globalId = await seedGlobalSub(t, legal, "compliance");
    await expect(
      t.withIdentity(member(ORG_A)).mutation(
        api.functions.subservices.mutations.personalizeGlobal,
        { sourceId: globalId }
      )
    ).rejects.toThrow(/Administrador/i);
    // No clone created.
    const orgRows = await t.run((ctx) =>
      ctx.db
        .query("subservices")
        .withIndex("by_orgId", (q) => q.eq("orgId", ORG_A))
        .collect()
    );
    expect(orgRows).toHaveLength(0);
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

  it("orgB no puede togglear el subservicio de orgA", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    const id = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.subservices.mutations.create,
      {
        parentServiceId: legal,
        name: "Solo OrgA",
        defaultFrequency: "mensual",
      }
    );
    const before = await t.run((ctx) => ctx.db.get(id));

    await expect(
      t.withIdentity(admin(ORG_B)).mutation(
        api.functions.subservices.mutations.toggleActive,
        { id }
      )
    ).rejects.toThrow(/no encontrado/i);

    // State unchanged.
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.isActive).toBe(before?.isActive);
  });

  it("members no pueden togglear", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    const id = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.subservices.mutations.create,
      {
        parentServiceId: legal,
        name: "ToggleMember",
        defaultFrequency: "mensual",
      }
    );
    const before = await t.run((ctx) => ctx.db.get(id));
    await expect(
      t.withIdentity(member(ORG_A)).mutation(
        api.functions.subservices.mutations.toggleActive,
        { id }
      )
    ).rejects.toThrow(/Administrador/i);
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.isActive).toBe(before?.isActive);
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

  it("bloquea con refs activas en monthlyAssignments", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    const subId = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.subservices.mutations.create,
      {
        parentServiceId: legal,
        name: "Test MA",
        defaultFrequency: "mensual",
      }
    );

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
      const projServiceId = await ctx.db.insert("projectionServices", {
        orgId: ORG_A,
        projectionId: projId,
        serviceId: legal,
        serviceName: "Legal",
        // NOTE: do NOT reference subId here — we are isolating the
        // monthlyAssignments blocker, not the projectionServices one.
        chosenPct: 0.02,
        isActive: true,
        annualAmount: 2,
        normalizedWeight: 1,
      });
      await ctx.db.insert("monthlyAssignments", {
        orgId: ORG_A,
        projServiceId,
        projectionId: projId,
        clientId,
        serviceName: "Legal",
        subserviceId: subId,
        month: 1,
        year: 2026,
        amount: 1,
        feFactor: 1,
        status: "pending" as const,
        invoiceStatus: "not_invoiced" as const,
      });
    });

    await expect(
      t.withIdentity(admin(ORG_A)).mutation(
        api.functions.subservices.mutations.remove,
        { id: subId }
      )
    ).rejects.toThrow(/asignaciones mensuales/i);

    const stillThere = await t.run((ctx) => ctx.db.get(subId));
    expect(stillThere).not.toBeNull();
  });

  it("bloquea con refs activas en quotations", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    const subId = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.subservices.mutations.create,
      {
        parentServiceId: legal,
        name: "Test Q",
        defaultFrequency: "mensual",
      }
    );

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
      const projServiceId = await ctx.db.insert("projectionServices", {
        orgId: ORG_A,
        projectionId: projId,
        serviceId: legal,
        serviceName: "Legal",
        chosenPct: 0.02,
        isActive: true,
        annualAmount: 2,
        normalizedWeight: 1,
      });
      await ctx.db.insert("quotations", {
        orgId: ORG_A,
        projServiceId,
        clientId,
        serviceName: "Legal",
        subserviceId: subId,
        content: "stub",
        status: "draft" as const,
        createdAt: Date.now(),
      });
    });

    await expect(
      t.withIdentity(admin(ORG_A)).mutation(
        api.functions.subservices.mutations.remove,
        { id: subId }
      )
    ).rejects.toThrow(/cotizaciones/i);

    const stillThere = await t.run((ctx) => ctx.db.get(subId));
    expect(stillThere).not.toBeNull();
  });

  it("bloquea con refs activas en contracts", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    const subId = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.subservices.mutations.create,
      {
        parentServiceId: legal,
        name: "Test K",
        defaultFrequency: "mensual",
      }
    );

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
      const projServiceId = await ctx.db.insert("projectionServices", {
        orgId: ORG_A,
        projectionId: projId,
        serviceId: legal,
        serviceName: "Legal",
        chosenPct: 0.02,
        isActive: true,
        annualAmount: 2,
        normalizedWeight: 1,
      });
      const quotationId = await ctx.db.insert("quotations", {
        orgId: ORG_A,
        projServiceId,
        clientId,
        serviceName: "Legal",
        // NOTE: do NOT reference subId on the quotation — only on the contract,
        // so we isolate the contracts blocker.
        content: "stub",
        status: "approved" as const,
        createdAt: Date.now(),
      });
      await ctx.db.insert("contracts", {
        orgId: ORG_A,
        quotationId,
        projServiceId,
        clientId,
        serviceName: "Legal",
        subserviceId: subId,
        content: "stub",
        status: "draft" as const,
        createdAt: Date.now(),
      });
    });

    await expect(
      t.withIdentity(admin(ORG_A)).mutation(
        api.functions.subservices.mutations.remove,
        { id: subId }
      )
    ).rejects.toThrow(/contratos/i);

    const stillThere = await t.run((ctx) => ctx.db.get(subId));
    expect(stillThere).not.toBeNull();
  });

  it("bloquea con refs activas en deliverables", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    const subId = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.subservices.mutations.create,
      {
        parentServiceId: legal,
        name: "Test D",
        defaultFrequency: "mensual",
      }
    );

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
      const projServiceId = await ctx.db.insert("projectionServices", {
        orgId: ORG_A,
        projectionId: projId,
        serviceId: legal,
        serviceName: "Legal",
        chosenPct: 0.02,
        isActive: true,
        annualAmount: 2,
        normalizedWeight: 1,
      });
      const assignmentId = await ctx.db.insert("monthlyAssignments", {
        orgId: ORG_A,
        projServiceId,
        projectionId: projId,
        clientId,
        serviceName: "Legal",
        // NOTE: do NOT reference subId on the assignment — only on the
        // deliverable, so we isolate the deliverables blocker.
        month: 1,
        year: 2026,
        amount: 1,
        feFactor: 1,
        status: "pending" as const,
        invoiceStatus: "not_invoiced" as const,
      });
      await ctx.db.insert("deliverables", {
        orgId: ORG_A,
        assignmentId,
        projServiceId,
        clientId,
        serviceName: "Legal",
        subserviceId: subId,
        month: 1,
        year: 2026,
        shortContent: "s",
        longContent: "l",
        auditStatus: "pending" as const,
        retryCount: 0,
        createdAt: Date.now(),
      });
    });

    await expect(
      t.withIdentity(admin(ORG_A)).mutation(
        api.functions.subservices.mutations.remove,
        { id: subId }
      )
    ).rejects.toThrow(/entregables/i);

    const stillThere = await t.run((ctx) => ctx.db.get(subId));
    expect(stillThere).not.toBeNull();
  });

  it("bloquea con refs activas en deliverableTemplates", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    const subId = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.subservices.mutations.create,
      {
        parentServiceId: legal,
        name: "Test T",
        defaultFrequency: "mensual",
      }
    );

    await t.run(async (ctx) => {
      await ctx.db.insert("deliverableTemplates", {
        orgId: ORG_A,
        serviceId: legal,
        serviceName: "Legal",
        subserviceId: subId,
        type: "deliverable_short" as const,
        name: "Plantilla Stub",
        htmlTemplate: "<p></p>",
        variables: [],
        version: 1,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await expect(
      t.withIdentity(admin(ORG_A)).mutation(
        api.functions.subservices.mutations.remove,
        { id: subId }
      )
    ).rejects.toThrow(/plantillas/i);

    const stillThere = await t.run((ctx) => ctx.db.get(subId));
    expect(stillThere).not.toBeNull();
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

  it("members no pueden borrar", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    const subId = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.subservices.mutations.create,
      {
        parentServiceId: legal,
        name: "RemoveMember",
        defaultFrequency: "mensual",
      }
    );
    await expect(
      t.withIdentity(member(ORG_A)).mutation(
        api.functions.subservices.mutations.remove,
        { id: subId }
      )
    ).rejects.toThrow(/Administrador/i);
    const stillThere = await t.run((ctx) => ctx.db.get(subId));
    expect(stillThere).not.toBeNull();
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

  it("bloquea restaurar al global si el clone tiene refs activas", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    const globalId = await seedGlobalSub(t, legal, "compliance");
    const cloneId = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.subservices.mutations.personalizeGlobal,
      { sourceId: globalId }
    );

    // attach a projectionServices row referencing the clone — same
    // findActiveRefs gate as `remove`.
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
        subserviceId: cloneId,
        chosenPct: 0.02,
        isActive: true,
        annualAmount: 2,
        normalizedWeight: 1,
      });
    });

    await expect(
      t.withIdentity(admin(ORG_A)).mutation(
        api.functions.subservices.mutations.restoreToGlobal,
        { id: cloneId }
      )
    ).rejects.toThrow(/restaurar/i);

    const stillThere = await t.run((ctx) => ctx.db.get(cloneId));
    expect(stillThere).not.toBeNull();
  });

  it("orgB no puede restaurar el clone de orgA", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    const globalId = await seedGlobalSub(t, legal, "compliance");
    const cloneA = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.subservices.mutations.personalizeGlobal,
      { sourceId: globalId }
    );

    await expect(
      t.withIdentity(admin(ORG_B)).mutation(
        api.functions.subservices.mutations.restoreToGlobal,
        { id: cloneA }
      )
    ).rejects.toThrow(/no encontrado/i);

    // orgA's clone is intact.
    const stillThere = await t.run((ctx) => ctx.db.get(cloneA));
    expect(stillThere).not.toBeNull();
    expect(stillThere?.orgId).toBe(ORG_A);
  });

  it("members no pueden restaurar al global", async () => {
    const t = setupTest();
    const legal = await seedParent(t);
    const globalId = await seedGlobalSub(t, legal, "compliance");
    const cloneId = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.subservices.mutations.personalizeGlobal,
      { sourceId: globalId }
    );
    await expect(
      t.withIdentity(member(ORG_A)).mutation(
        api.functions.subservices.mutations.restoreToGlobal,
        { id: cloneId }
      )
    ).rejects.toThrow(/Administrador/i);
    const stillThere = await t.run((ctx) => ctx.db.get(cloneId));
    expect(stillThere).not.toBeNull();
  });
});
