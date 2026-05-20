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

/**
 * Insert a "Legal" parent service directly into the DB and return its id.
 * Mirrors what services.seedDefaultServices would do, but minimal so tests
 * stay fast and decoupled from the real seed.
 */
async function seedParentService(
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

async function seedGlobalSubservice(
  t: ReturnType<typeof setupTest>,
  parentId: Id<"services">,
  slug: string,
  sortOrder: number,
  opts: { isActive?: boolean; name?: string } = {}
): Promise<Id<"subservices">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("subservices", {
      orgId: undefined,
      parentServiceId: parentId,
      name: opts.name ?? slug,
      slug,
      defaultFrequency: "mensual" as const,
      isActive: opts.isActive ?? true,
      isDefault: true,
      sortOrder,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function seedOrgSubservice(
  t: ReturnType<typeof setupTest>,
  orgId: string,
  parentId: Id<"services">,
  slug: string,
  sortOrder: number,
  opts: { isActive?: boolean; name?: string } = {}
): Promise<Id<"subservices">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("subservices", {
      orgId,
      parentServiceId: parentId,
      name: opts.name ?? slug,
      slug,
      defaultFrequency: "mensual" as const,
      isActive: opts.isActive ?? true,
      isDefault: false,
      sortOrder,
      createdAt: now,
      updatedAt: now,
    });
  });
}

describe("subservices.queries", () => {
  it("listByParent retorna globales activos del padre cuando no hay org-scoped", async () => {
    const t = setupTest();
    const legal = await seedParentService(t);
    await seedGlobalSubservice(t, legal, "compliance", 30);
    await seedGlobalSubservice(t, legal, "gobierno", 10);
    await seedGlobalSubservice(t, legal, "litigios", 50);
    await seedGlobalSubservice(t, legal, "contratos", 20);
    await seedGlobalSubservice(t, legal, "propiedad", 40);

    const result = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.subservices.queries.listByParent, {
        parentServiceId: legal,
      });

    expect(result).toHaveLength(5);
    // ordered by sortOrder ascending
    expect(result.map((r) => r.slug)).toEqual([
      "gobierno",
      "contratos",
      "compliance",
      "propiedad",
      "litigios",
    ]);
    // all global
    expect(result.every((r) => r.orgId === undefined)).toBe(true);
  });

  it("listByParent override: org-scoped reemplaza global con mismo slug", async () => {
    const t = setupTest();
    const legal = await seedParentService(t);
    await seedGlobalSubservice(t, legal, "compliance-lfpdpp", 30, {
      name: "Compliance (global)",
    });
    await seedGlobalSubservice(t, legal, "gobierno", 10);
    await seedGlobalSubservice(t, legal, "litigios", 50);
    await seedOrgSubservice(t, ORG_A, legal, "compliance-lfpdpp", 30, {
      name: "Compliance (org)",
    });

    const result = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.subservices.queries.listByParent, {
        parentServiceId: legal,
      });

    expect(result).toHaveLength(3);
    const compliance = result.find((r) => r.slug === "compliance-lfpdpp");
    expect(compliance).toBeDefined();
    expect(compliance?.orgId).toBe(ORG_A);
    expect(compliance?.name).toBe("Compliance (org)");
  });

  it("listByParent filtra inactivos", async () => {
    const t = setupTest();
    const legal = await seedParentService(t);
    await seedOrgSubservice(t, ORG_A, legal, "activo", 10, { isActive: true });
    await seedOrgSubservice(t, ORG_A, legal, "inactivo", 20, {
      isActive: false,
    });

    const result = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.subservices.queries.listByParent, {
        parentServiceId: legal,
      });

    expect(result).toHaveLength(1);
    expect(result[0].slug).toBe("activo");
  });

  it("listAllForOrg retorna unión global+org con dedup por slug", async () => {
    const t = setupTest();
    const legal = await seedParentService(t);
    const contable = await seedParentService(t, "Contable");
    // 4 globales
    await seedGlobalSubservice(t, legal, "a", 10);
    await seedGlobalSubservice(t, legal, "b", 20);
    await seedGlobalSubservice(t, contable, "c", 10);
    await seedGlobalSubservice(t, contable, "d", 20);
    // 3 org-scoped: 2 override (mismo slug+parent que globales) + 1 nuevo
    await seedOrgSubservice(t, ORG_A, legal, "a", 10); // override
    await seedOrgSubservice(t, ORG_A, contable, "c", 10); // override
    await seedOrgSubservice(t, ORG_A, legal, "x", 30); // nuevo

    const result = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.subservices.queries.listAllForOrg, {});

    // 4 globales − 2 overrideados + 3 org-scoped = 5
    expect(result).toHaveLength(5);
    // the (legal,a) and (contable,c) winners must be org-scoped
    const aRow = result.find((r) => r.parentServiceId === legal && r.slug === "a");
    expect(aRow?.orgId).toBe(ORG_A);
    const cRow = result.find((r) => r.parentServiceId === contable && r.slug === "c");
    expect(cRow?.orgId).toBe(ORG_A);
  });

  it("getById multi-tenant guard: orgB no puede leer subservicio de orgA", async () => {
    const t = setupTest();
    const legal = await seedParentService(t);
    const subA = await seedOrgSubservice(t, ORG_A, legal, "secreto", 10);

    // orgB ve null
    const fromB = await t
      .withIdentity(admin(ORG_B))
      .query(api.functions.subservices.queries.getById, { id: subA });
    expect(fromB).toBeNull();

    // orgA ve el row
    const fromA = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.subservices.queries.getById, { id: subA });
    expect(fromA?._id).toBe(subA);
  });

  it("getById permite leer globales desde cualquier org", async () => {
    const t = setupTest();
    const legal = await seedParentService(t);
    const global = await seedGlobalSubservice(t, legal, "global-sub", 10);

    const fromA = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.subservices.queries.getById, { id: global });
    expect(fromA?._id).toBe(global);
    const fromB = await t
      .withIdentity(admin(ORG_B))
      .query(api.functions.subservices.queries.getById, { id: global });
    expect(fromB?._id).toBe(global);
  });

  it("listByParent retorna [] cuando no hay auth", async () => {
    const t = setupTest();
    const legal = await seedParentService(t);
    await seedGlobalSubservice(t, legal, "x", 10);

    const result = await t.query(
      api.functions.subservices.queries.listByParent,
      { parentServiceId: legal }
    );
    expect(result).toEqual([]);
  });
});
