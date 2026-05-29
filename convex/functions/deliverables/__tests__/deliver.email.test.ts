/**
 * Tests for deliver mutation — contactEmail guard.
 * Phase 1 §3.3: client.contactEmail replaces the @placeholder.com hack.
 */

import { describe, it, expect } from "vitest";
import { setupTest, ORG_A } from "../../../../tests/harness";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

type Seeded = {
  clientId: Id<"clients">;
  projServiceId: Id<"projectionServices">;
  assignmentId: Id<"monthlyAssignments">;
  deliverableId: Id<"deliverables">;
};

async function seedDeliverable(
  t: ReturnType<typeof setupTest>,
  orgId: string,
  opts: { contactEmail?: string } = {}
): Promise<Seeded> {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId,
      name: "Acme Corp",
      rfc: "ACM240115XYZ",
      industry: "Tech",
      annualRevenue: 500_000,
      billingFrequency: "mensual" as const,
      isArchived: false,
      ...(opts.contactEmail !== undefined
        ? { contactEmail: opts.contactEmail }
        : {}),
      createdAt: Date.now(),
    });

    const projectionId = await ctx.db.insert("projections", {
      orgId,
      clientId,
      year: 2026,
      annualSales: 500_000,
      totalBudget: 50_000,
      commissionRate: 0,
      seasonalityData: [],
      status: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const serviceId = await ctx.db.insert("services", {
      orgId,
      name: "Contabilidad",
      type: "base" as const,
      minPct: 0.1,
      maxPct: 0.3,
      defaultPct: 0.15,
      isDefault: true,
      sortOrder: 1,
    });

    const projServiceId = await ctx.db.insert("projectionServices", {
      orgId,
      projectionId,
      serviceId,
      serviceName: "Contabilidad",
      chosenPct: 0.15,
      isActive: true,
      annualAmount: 75_000,
      normalizedWeight: 0.15,
    });

    const assignmentId = await ctx.db.insert("monthlyAssignments", {
      orgId,
      projServiceId,
      projectionId,
      clientId,
      serviceName: "Contabilidad",
      month: 5,
      year: 2026,
      amount: 6_250,
      feFactor: 1,
      status: "pending" as const,
      invoiceStatus: "paid" as const,
    });

    const deliverableId = await ctx.db.insert("deliverables", {
      orgId,
      assignmentId,
      projServiceId,
      clientId,
      serviceName: "Contabilidad",
      month: 5,
      year: 2026,
      shortContent: "<p>Resumen contable mayo 2026</p>",
      longContent: "<p>Detalle contable mayo 2026</p>",
      auditStatus: "approved" as const,
      retryCount: 0,
      createdAt: Date.now(),
    });

    return { clientId, projServiceId, assignmentId, deliverableId };
  });
}

describe("deliverables.mutations.deliver — contactEmail guard", () => {
  it("sends email and marks delivered when client.contactEmail is set", async () => {
    const t = setupTest();
    const seed = await seedDeliverable(t, ORG_A, {
      contactEmail: "facturas@acme.example",
    });

    const auth = t.withIdentity({ orgId: ORG_A, orgRole: "org:member" });
    const result = (await auth.mutation(
      api.functions.deliverables.mutations.deliver,
      { deliverableId: seed.deliverableId }
    )) as { success: boolean; deliverableId: Id<"deliverables">; reason?: string };

    expect(result.success).toBe(true);

    const deliverable = await t.run((ctx) => ctx.db.get(seed.deliverableId));
    expect(deliverable!.deliveredAt).toBeDefined();

    const assignment = await t.run((ctx) => ctx.db.get(seed.assignmentId));
    expect(assignment!.status).toBe("delivered");
  });

  it("marks deliverable as rejected when client has no contactEmail", async () => {
    const t = setupTest();
    // Seed WITHOUT contactEmail
    const seed = await seedDeliverable(t, ORG_A, {});

    const auth = t.withIdentity({ orgId: ORG_A, orgRole: "org:member" });
    const result = (await auth.mutation(
      api.functions.deliverables.mutations.deliver,
      { deliverableId: seed.deliverableId }
    )) as { success: boolean; deliverableId: Id<"deliverables">; reason?: string };

    expect(result.success).toBe(false);
    expect(result.reason).toBe("no_contact_email");

    const deliverable = await t.run((ctx) => ctx.db.get(seed.deliverableId));
    expect(deliverable!.auditStatus).toBe("rejected");
    expect(deliverable!.auditFeedback).toContain("contactEmail");
    expect(deliverable!.deliveredAt).toBeUndefined();

    const assignment = await t.run((ctx) => ctx.db.get(seed.assignmentId));
    expect(assignment!.status).not.toBe("delivered");
  });

  it("rejects whitespace-only contactEmail (trims before check)", async () => {
    const t = setupTest();
    // Seed with whitespace-only contactEmail — should be treated same as missing
    const seed = await seedDeliverable(t, ORG_A, { contactEmail: "   " });

    const auth = t.withIdentity({ orgId: ORG_A, orgRole: "org:member" });
    const result = (await auth.mutation(
      api.functions.deliverables.mutations.deliver,
      { deliverableId: seed.deliverableId }
    )) as { success: boolean; deliverableId: Id<"deliverables">; reason?: string };

    expect(result.success).toBe(false);
    expect(result.reason).toBe("no_contact_email");

    const deliverable = await t.run((ctx) => ctx.db.get(seed.deliverableId));
    expect(deliverable!.auditStatus).toBe("rejected");
    expect(deliverable!.auditFeedback).toContain("contactEmail");
    expect(deliverable!.deliveredAt).toBeUndefined();

    const assignment = await t.run((ctx) => ctx.db.get(seed.assignmentId));
    expect(assignment!.status).not.toBe("delivered");
  });
});
