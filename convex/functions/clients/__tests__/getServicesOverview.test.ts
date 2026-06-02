import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import { setupTest, ORG_A, ORG_B } from "../../../../tests/harness";

/**
 * B1 — clients.getServicesOverview
 *
 * Per docs/superpowers/specs/2026-05-26-client-services-overview-design.md §5
 */

function admin(orgId: string) {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `user_admin_${orgId}`,
    orgId,
    orgRole: "org:admin",
  };
}

async function seedClient(
  t: ReturnType<typeof setupTest>,
  orgId: string,
  name = "ACME"
): Promise<Id<"clients">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("clients", {
      orgId,
      name,
      rfc: "AAA010101AAA",
      industry: "Marketing",
      annualRevenue: 1_000_000,
      billingFrequency: "mensual" as const,
      isArchived: false,
      createdAt: Date.now(),
    });
  });
}

async function seedService(
  t: ReturnType<typeof setupTest>,
  name = "Marketing"
): Promise<Id<"services">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("services", {
      orgId: undefined,
      name,
      type: "base" as const,
      minPct: 0.05,
      maxPct: 0.15,
      defaultPct: 0.1,
      isDefault: true,
      sortOrder: 10,
    });
  });
}

async function seedSubservice(
  t: ReturnType<typeof setupTest>,
  parentServiceId: Id<"services">,
  slug = "redes-sociales"
): Promise<Id<"subservices">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("subservices", {
      orgId: undefined,
      parentServiceId,
      name: "Redes Sociales",
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

describe("clients.getServicesOverview", () => {
  it("happy path: groups by parent, computes monthlyAmount per window, surfaces add-on metadata", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const marketingId = await seedService(t, "Marketing");
    const subBaseId = await seedSubservice(t, marketingId, "branding");
    const subAddOnId = await seedSubservice(t, marketingId, "redes-sociales");

    // Seed: active projection 2026 + 2 base rows (Ene-Dic) + 1 add-on (Jul-Dic).
    await t.run(async (ctx) => {
      const projectionId = await ctx.db.insert("projections", {
        orgId: ORG_A,
        clientId,
        year: 2026,
        annualSales: 1_000_000,
        totalBudget: 120_000,
        commissionRate: 0,
        seasonalityData: [],
        status: "active" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      // base row 1
      await ctx.db.insert("projectionServices", {
        orgId: ORG_A,
        projectionId,
        serviceId: marketingId,
        serviceName: "Marketing",
        subserviceIds: [subBaseId],
        chosenPct: 0.05,
        isActive: true,
        annualAmount: 60_000,
        normalizedWeight: 0.5,
        // startMonth/endMonth undefined → legacy = año completo
      });
      // base row 2 (no subservice — legacy path)
      await ctx.db.insert("projectionServices", {
        orgId: ORG_A,
        projectionId,
        serviceId: marketingId,
        serviceName: "Marketing",
        chosenPct: 0.05,
        isActive: true,
        annualAmount: 24_000,
        normalizedWeight: 0.2,
      });
      // add-on Jul-Dic — primero el row, luego la cotización (necesita
      // projServiceId real), luego patch para enlazar inversamente.
      const addOnPsId = await ctx.db.insert("projectionServices", {
        orgId: ORG_A,
        projectionId,
        serviceId: marketingId,
        serviceName: "Marketing",
        subserviceIds: [subAddOnId],
        chosenPct: 0,
        isActive: true,
        annualAmount: 27_000,
        normalizedWeight: 0,
        startMonth: 7,
        endMonth: 12,
      });
      const fakeQuotationId = await ctx.db.insert("quotations", {
        orgId: ORG_A,
        projServiceId: addOnPsId,
        clientId,
        serviceName: "Marketing",
        content: "<p/>",
        status: "draft" as const,
        createdAt: Date.now(),
        isSupplementary: true,
      });
      await ctx.db.patch(addOnPsId, {
        supplementaryQuotationId: fakeQuotationId,
      });
    });

    const overview = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.clients.queries.getServicesOverview, { clientId });

    expect(overview).not.toBeNull();
    expect(overview!.activeProjection).not.toBeNull();
    expect(overview!.activeProjection!.year).toBe(2026);
    expect(overview!.groups).toHaveLength(1);

    const group = overview!.groups[0];
    expect(group.parentService.name).toBe("Marketing");
    expect(group.rows).toHaveLength(3);

    const addOn = group.rows.find((r) => r.isAddOn);
    expect(addOn).toBeDefined();
    expect(addOn!.startMonth).toBe(7);
    expect(addOn!.endMonth).toBe(12);
    // monthlyAmount = annualAmount / 6 (no /12)
    expect(addOn!.monthlyAmount).toBeCloseTo(27_000 / 6);
    expect(addOn!.supplementaryQuotationId).not.toBeNull();

    const baseRows = group.rows.filter((r) => !r.isAddOn);
    expect(baseRows).toHaveLength(2);
    // monthlyAmount = annualAmount / 12 for legacy rows
    const baseWithSub = baseRows.find((r) => r.subservice !== null);
    expect(baseWithSub!.monthlyAmount).toBeCloseTo(60_000 / 12);
    expect(baseWithSub!.startMonth).toBe(1);
    expect(baseWithSub!.endMonth).toBe(12);
  });

  it("client with no projection: returns activeProjection=null, groups=[]", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);

    const overview = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.clients.queries.getServicesOverview, { clientId });

    expect(overview).not.toBeNull();
    expect(overview!.activeProjection).toBeNull();
    expect(overview!.groups).toEqual([]);
  });

  it("multi-tenant guard: orgA client invisible to orgB caller", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);

    const overview = await t
      .withIdentity(admin(ORG_B))
      .query(api.functions.clients.queries.getServicesOverview, { clientId });

    expect(overview).toBeNull();
  });
});
