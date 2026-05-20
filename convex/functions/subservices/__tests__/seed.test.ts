import { describe, it, expect } from "vitest";
import { internal } from "../../../_generated/api";
import { setupTest } from "../../../../tests/harness";
import { DEFAULT_SUBSERVICES } from "../seed";

/**
 * Seed all 9 default parent services (matches services/seed.seedDefaultServices
 * shape) so the subservices seed can resolve `parentName` lookups.
 */
async function seedAllParents(t: ReturnType<typeof setupTest>) {
  const parents = [
    { name: "Legal", type: "base" as const, sortOrder: 1 },
    { name: "Contable", type: "base" as const, sortOrder: 2 },
    { name: "TI", type: "base" as const, sortOrder: 3 },
    { name: "Marketing", type: "base" as const, sortOrder: 4 },
    { name: "RH", type: "base" as const, sortOrder: 5 },
    { name: "Admin", type: "base" as const, sortOrder: 6 },
    { name: "Comisiones", type: "comodin" as const, sortOrder: 7, isCommission: true },
    { name: "Logística", type: "comodin" as const, sortOrder: 8 },
    { name: "Construcción", type: "comodin" as const, sortOrder: 9 },
  ];
  await t.run(async (ctx) => {
    for (const p of parents) {
      await ctx.db.insert("services", {
        orgId: undefined,
        name: p.name,
        type: p.type,
        minPct: 0,
        maxPct: 0,
        defaultPct: 0,
        isDefault: true,
        isCommission: p.isCommission ?? false,
        isCustom: false,
        sortOrder: p.sortOrder,
      });
    }
  });
}

describe("subservices.seed", () => {
  it("seedDefaultSubservices es idempotente", async () => {
    const t = setupTest();
    await seedAllParents(t);

    const first = await t.mutation(
      internal.functions.subservices.seed.seedDefaultSubservices,
      {}
    );
    expect(first.created).toBeGreaterThan(0);
    expect(first.skipped).toBe(0);

    const second = await t.mutation(
      internal.functions.subservices.seed.seedDefaultSubservices,
      {}
    );
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(first.created);
  });

  it("seed crea exactamente DEFAULT_SUBSERVICES.length rows cuando todos los padres existen", async () => {
    const t = setupTest();
    await seedAllParents(t);

    const result = await t.mutation(
      internal.functions.subservices.seed.seedDefaultSubservices,
      {}
    );
    expect(result.created).toBe(DEFAULT_SUBSERVICES.length);

    const all = await t.run((ctx) =>
      ctx.db
        .query("subservices")
        .withIndex("by_orgId", (q) => q.eq("orgId", undefined))
        .collect()
    );
    expect(all).toHaveLength(DEFAULT_SUBSERVICES.length);
    // every row is a global default
    expect(all.every((s) => s.orgId === undefined && s.isDefault)).toBe(true);
    // every row is active
    expect(all.every((s) => s.isActive)).toBe(true);
  });

  it("seed skipea entries cuyo parentName no existe", async () => {
    const t = setupTest();
    // Only seed Legal — the other 8 parents are absent
    await t.run(async (ctx) => {
      await ctx.db.insert("services", {
        orgId: undefined,
        name: "Legal",
        type: "base" as const,
        minPct: 0,
        maxPct: 0,
        defaultPct: 0,
        isDefault: true,
        isCustom: false,
        sortOrder: 1,
      });
    });

    const result = await t.mutation(
      internal.functions.subservices.seed.seedDefaultSubservices,
      {}
    );
    const expectedLegal = DEFAULT_SUBSERVICES.filter(
      (e) => e.parentName === "Legal"
    ).length;
    expect(result.created).toBe(expectedLegal);
  });
});
