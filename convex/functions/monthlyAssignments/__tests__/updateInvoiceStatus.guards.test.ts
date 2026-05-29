import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api } from "../../../_generated/api";

const ORG_A = "org_test_A";

async function seedAssignment(
  t: ReturnType<typeof convexTest>,
  status: "pending" | "info_received" | "in_progress" | "delivered",
  invoiceStatus: "not_invoiced" | "invoiced" | "paid"
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
      invoiceStatus,
    });
  });
}

describe("monthlyAssignments.updateInvoiceStatus guards", () => {
  it("allows not_invoiced → invoiced", async () => {
    const t = convexTest(schema);
    const id = await seedAssignment(t, "pending", "not_invoiced");
    await t
      .withIdentity({ subject: "u", tokenIdentifier: "u", org_id: ORG_A } as any)
      .mutation(api.functions.monthlyAssignments.mutations.updateInvoiceStatus, {
        id,
        invoiceStatus: "invoiced",
      });
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.invoiceStatus).toBe("invoiced");
  });

  it("allows invoiced → paid", async () => {
    const t = convexTest(schema);
    const id = await seedAssignment(t, "pending", "invoiced");
    await t
      .withIdentity({ subject: "u", tokenIdentifier: "u", org_id: ORG_A } as any)
      .mutation(api.functions.monthlyAssignments.mutations.updateInvoiceStatus, {
        id,
        invoiceStatus: "paid",
      });
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.invoiceStatus).toBe("paid");
  });

  it("is idempotent (paid → paid no throw)", async () => {
    const t = convexTest(schema);
    const id = await seedAssignment(t, "delivered", "paid");
    const result = await t
      .withIdentity({ subject: "u", tokenIdentifier: "u", org_id: ORG_A } as any)
      .mutation(api.functions.monthlyAssignments.mutations.updateInvoiceStatus, {
        id,
        invoiceStatus: "paid",
      });
    expect(result).toBeNull();
  });

  it("throws INVALID_TRANSITION on paid → invoiced (reversa)", async () => {
    const t = convexTest(schema);
    const id = await seedAssignment(t, "delivered", "paid");
    await expect(
      t
        .withIdentity({ subject: "u", tokenIdentifier: "u", org_id: ORG_A } as any)
        .mutation(api.functions.monthlyAssignments.mutations.updateInvoiceStatus, {
          id,
          invoiceStatus: "invoiced",
        })
    ).rejects.toThrow(/INVALID_TRANSITION|paid.*invoiced/i);
  });

  it("throws INVALID_TRANSITION on invoiced → not_invoiced (reversa)", async () => {
    const t = convexTest(schema);
    const id = await seedAssignment(t, "pending", "invoiced");
    await expect(
      t
        .withIdentity({ subject: "u", tokenIdentifier: "u", org_id: ORG_A } as any)
        .mutation(api.functions.monthlyAssignments.mutations.updateInvoiceStatus, {
          id,
          invoiceStatus: "not_invoiced",
        })
    ).rejects.toThrow(/INVALID_TRANSITION|invoiced.*not_invoiced/i);
  });

  it("throws INVALID_TRANSITION on not_invoiced → paid (saltó invoiced)", async () => {
    const t = convexTest(schema);
    const id = await seedAssignment(t, "pending", "not_invoiced");
    await expect(
      t
        .withIdentity({ subject: "u", tokenIdentifier: "u", org_id: ORG_A } as any)
        .mutation(api.functions.monthlyAssignments.mutations.updateInvoiceStatus, {
          id,
          invoiceStatus: "paid",
        })
    ).rejects.toThrow(/INVALID_TRANSITION|not_invoiced.*paid/i);
  });

  it("cross-machine: delivered + invoiced cannot regress to delivered + not_invoiced", async () => {
    const t = convexTest(schema);
    const id = await seedAssignment(t, "delivered", "invoiced");
    await expect(
      t
        .withIdentity({ subject: "u", tokenIdentifier: "u", org_id: ORG_A } as any)
        .mutation(api.functions.monthlyAssignments.mutations.updateInvoiceStatus, {
          id,
          invoiceStatus: "not_invoiced",
        })
    ).rejects.toThrow(/INVALID_TRANSITION/i);
  });
});
