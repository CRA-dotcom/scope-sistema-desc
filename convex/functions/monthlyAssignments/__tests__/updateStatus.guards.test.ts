import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api } from "../../../_generated/api";

const ORG_A = "org_test_A";

async function seedAssignment(
  t: ReturnType<typeof convexTest>,
  status: "pending" | "info_received" | "in_progress" | "delivered"
) {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId: ORG_A,
      name: "C",
      rfc: "XAXX010101000",
      industry: "tecnologia",
      annualRevenue: 0,
      billingFrequency: "mensual",
      isArchived: false,
      createdAt: Date.now(),
    });
    const projectionId = await ctx.db.insert("projections", {
      orgId: ORG_A,
      clientId,
      year: 2026,
      annualSales: 0,
      totalBudget: 0,
      commissionRate: 0,
      seasonalityData: [],
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const serviceId = await ctx.db.insert("services", {
      orgId: undefined,
      name: "S",
      type: "base",
      minPct: 0,
      maxPct: 100,
      defaultPct: 10,
      isDefault: true,
      sortOrder: 0,
    });
    const psId = await ctx.db.insert("projectionServices", {
      orgId: ORG_A,
      projectionId,
      serviceId,
      serviceName: "S",
      chosenPct: 10,
      isActive: true,
      annualAmount: 0,
      normalizedWeight: 1,
    });
    return await ctx.db.insert("monthlyAssignments", {
      orgId: ORG_A,
      projServiceId: psId,
      projectionId,
      clientId,
      serviceName: "S",
      month: 6,
      year: 2026,
      amount: 100,
      feFactor: 1,
      status,
      invoiceStatus: "not_invoiced",
    });
  });
}

describe("monthlyAssignments.updateStatus guards", () => {
  it("allows pending → info_received", async () => {
    const t = convexTest(schema);
    const id = await seedAssignment(t, "pending");
    await t
      .withIdentity({
        subject: "u",
        tokenIdentifier: "u",
        org_id: ORG_A,
      } as any)
      .mutation(api.functions.monthlyAssignments.mutations.updateStatus, {
        id,
        status: "info_received",
      });
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.status).toBe("info_received");
  });

  it("allows info_received → in_progress", async () => {
    const t = convexTest(schema);
    const id = await seedAssignment(t, "info_received");
    await t
      .withIdentity({
        subject: "u",
        tokenIdentifier: "u",
        org_id: ORG_A,
      } as any)
      .mutation(api.functions.monthlyAssignments.mutations.updateStatus, {
        id,
        status: "in_progress",
      });
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.status).toBe("in_progress");
  });

  it("allows in_progress → delivered", async () => {
    const t = convexTest(schema);
    const id = await seedAssignment(t, "in_progress");
    await t
      .withIdentity({
        subject: "u",
        tokenIdentifier: "u",
        org_id: ORG_A,
      } as any)
      .mutation(api.functions.monthlyAssignments.mutations.updateStatus, {
        id,
        status: "delivered",
      });
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.status).toBe("delivered");
  });

  it("allows reversal info_received → pending (corrección)", async () => {
    const t = convexTest(schema);
    const id = await seedAssignment(t, "info_received");
    await t
      .withIdentity({
        subject: "u",
        tokenIdentifier: "u",
        org_id: ORG_A,
      } as any)
      .mutation(api.functions.monthlyAssignments.mutations.updateStatus, {
        id,
        status: "pending",
      });
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.status).toBe("pending");
  });

  it("is idempotent (delivered → delivered no throw)", async () => {
    const t = convexTest(schema);
    const id = await seedAssignment(t, "delivered");
    // Should resolve without throwing (mutation returns null for void)
    const result = await t
      .withIdentity({
        subject: "u",
        tokenIdentifier: "u",
        org_id: ORG_A,
      } as any)
      .mutation(api.functions.monthlyAssignments.mutations.updateStatus, {
        id,
        status: "delivered",
      });
    // null is Convex's representation of void — the key thing is no throw
    expect(result).toBeNull();
  });

  it("throws INVALID_TRANSITION on delivered → pending", async () => {
    const t = convexTest(schema);
    const id = await seedAssignment(t, "delivered");
    await expect(
      t
        .withIdentity({
          subject: "u",
          tokenIdentifier: "u",
          org_id: ORG_A,
        } as any)
        .mutation(api.functions.monthlyAssignments.mutations.updateStatus, {
          id,
          status: "pending",
        })
    ).rejects.toThrow(/INVALID_TRANSITION|delivered.*pending/i);
  });

  it("throws INVALID_TRANSITION on pending → delivered (saltó in_progress)", async () => {
    const t = convexTest(schema);
    const id = await seedAssignment(t, "pending");
    await expect(
      t
        .withIdentity({
          subject: "u",
          tokenIdentifier: "u",
          org_id: ORG_A,
        } as any)
        .mutation(api.functions.monthlyAssignments.mutations.updateStatus, {
          id,
          status: "delivered",
        })
    ).rejects.toThrow(/INVALID_TRANSITION|pending.*delivered/i);
  });
});
