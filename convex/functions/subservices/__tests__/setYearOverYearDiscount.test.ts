import { describe, it, expect } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

async function seedParentService(t: ReturnType<typeof setupTest>): Promise<Id<"services">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("services", {
      name: "S",
      type: "base" as const,
      minPct: 0.01,
      maxPct: 0.03,
      defaultPct: 0.02,
      isDefault: true,
      isCommission: false,
      sortOrder: 1,
    });
  });
}

async function seedOrgSubservice(t: ReturnType<typeof setupTest>, orgId: string): Promise<Id<"subservices">> {
  return await t.run(async (ctx) => {
    const parentServiceId = await ctx.db.insert("services", {
      name: "S",
      type: "base" as const,
      minPct: 0.01, maxPct: 0.03, defaultPct: 0.02,
      isDefault: true, isCommission: false, sortOrder: 1,
    });
    return await ctx.db.insert("subservices", {
      orgId, parentServiceId, name: "Sub", slug: "sub",
      defaultFrequency: "mensual" as const, isDefault: false, sortOrder: 0,
      isActive: true,
      createdAt: 0, updatedAt: 0,
    });
  });
}

async function seedGlobalSubservice(t: ReturnType<typeof setupTest>): Promise<Id<"subservices">> {
  return await t.run(async (ctx) => {
    const parentServiceId = await ctx.db.insert("services", {
      name: "S",
      type: "base" as const,
      minPct: 0.01, maxPct: 0.03, defaultPct: 0.02,
      isDefault: true, isCommission: false, sortOrder: 1,
    });
    return await ctx.db.insert("subservices", {
      orgId: undefined, parentServiceId, name: "Global", slug: "global",
      defaultFrequency: "mensual" as const, isDefault: false, sortOrder: 0,
      isActive: true,
      createdAt: 0, updatedAt: 0,
    });
  });
}

describe("setYearOverYearDiscount", () => {
  it("admin sets discount=25 on org subservice", async () => {
    const t = setupTest();
    const orgId = "org_1";
    const subserviceId = await seedOrgSubservice(t, orgId);
    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });

    await auth.mutation(api.functions.subservices.mutations.setYearOverYearDiscount, {
      subserviceId, discount: 25,
    });

    await t.run(async (ctx) => {
      const row = await ctx.db.get(subserviceId);
      expect(row?.yearOverYearDiscount).toBe(25);
    });
  });

  it("clears discount by passing undefined", async () => {
    const t = setupTest();
    const orgId = "org_1";
    const subserviceId = await seedOrgSubservice(t, orgId);
    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });

    await auth.mutation(api.functions.subservices.mutations.setYearOverYearDiscount, {
      subserviceId, discount: 25,
    });
    await auth.mutation(api.functions.subservices.mutations.setYearOverYearDiscount, {
      subserviceId,
    });

    await t.run(async (ctx) => {
      const row = await ctx.db.get(subserviceId);
      expect(row?.yearOverYearDiscount).toBeUndefined();
    });
  });

  it("rejects discount=0 (zero is meaningless — use undefined to clear)", async () => {
    const t = setupTest();
    const orgId = "org_1";
    const subserviceId = await seedOrgSubservice(t, orgId);
    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });

    await expect(
      auth.mutation(api.functions.subservices.mutations.setYearOverYearDiscount, {
        subserviceId, discount: 0,
      })
    ).rejects.toThrow(/mayor.*0|positive/i);
  });

  it("rejects discount < 0", async () => {
    const t = setupTest();
    const orgId = "org_1";
    const subserviceId = await seedOrgSubservice(t, orgId);
    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });

    await expect(
      auth.mutation(api.functions.subservices.mutations.setYearOverYearDiscount, {
        subserviceId, discount: -1,
      })
    ).rejects.toThrow(/mayor.*0|discount/i);
  });

  it("rejects discount > 100", async () => {
    const t = setupTest();
    const orgId = "org_1";
    const subserviceId = await seedOrgSubservice(t, orgId);
    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });

    await expect(
      auth.mutation(api.functions.subservices.mutations.setYearOverYearDiscount, {
        subserviceId, discount: 101,
      })
    ).rejects.toThrow(/mayor.*0|discount/i);
  });

  it("requires super_admin for global subservices", async () => {
    const t = setupTest();
    const subserviceId = await seedGlobalSubservice(t);
    const auth = t.withIdentity({ orgId: "org_x", orgRole: "org:admin" });

    await expect(
      auth.mutation(api.functions.subservices.mutations.setYearOverYearDiscount, {
        subserviceId, discount: 10,
      })
    ).rejects.toThrow(/super|admin/i);
  });

  it("rejects cross-org access on org subservice", async () => {
    const t = setupTest();
    const subserviceId = await seedOrgSubservice(t, "org_a");
    const auth = t.withIdentity({ orgId: "org_b", orgRole: "org:admin" });

    await expect(
      auth.mutation(api.functions.subservices.mutations.setYearOverYearDiscount, {
        subserviceId, discount: 25,
      })
    ).rejects.toThrow(/no.*org|forbidden/i);
  });
});
