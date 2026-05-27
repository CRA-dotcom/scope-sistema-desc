import { describe, it, expect } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

function identity(orgId: string, role: "org:admin" | "org:member" = "org:admin") {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `user_admin_${orgId}`,
    orgId,
    orgRole: role,
  };
}

async function seedInvoice(
  t: ReturnType<typeof setupTest>,
  opts: {
    orgId: string;
    status?: "uploaded" | "paid" | "void";
  }
): Promise<Id<"invoices">> {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId: opts.orgId,
      name: "C",
      rfc: "XXX900101AAA",
      industry: "Servicios",
      annualRevenue: 0,
      billingFrequency: "mensual" as const,
      isArchived: false,
      createdAt: 0,
    });
    const projectionId = await ctx.db.insert("projections", {
      orgId: opts.orgId,
      clientId,
      year: 2026,
      annualSales: 0,
      totalBudget: 0,
      commissionRate: 0,
      seasonalityData: [],
      status: "active" as const,
      createdAt: 0,
      updatedAt: 0,
    });
    return await ctx.db.insert("invoices", {
      orgId: opts.orgId,
      clientId,
      projectionId,
      serviceName: "S",
      month: 1,
      year: 2026,
      amount: 1000,
      bucketKey: "k",
      contentType: "application/pdf",
      sizeBytes: 1,
      filename: "x.pdf",
      status: (opts.status ?? "uploaded") as "uploaded" | "paid" | "void",
      uploadedAt: 0,
      uploadedBy: "u",
      createdAt: 0,
    });
  });
}

describe("updateIssueDate mutation", () => {
  it("admin updates issueDate on uploaded invoice", async () => {
    const t = setupTest();
    const orgId = "org_1";
    const invoiceId = await seedInvoice(t, { orgId });
    const auth = t.withIdentity(identity(orgId));

    const newDate = Date.UTC(2026, 0, 20);
    await auth.mutation(api.functions.invoices.mutations.updateIssueDate, {
      invoiceId,
      issueDate: newDate,
    });

    await t.run(async (ctx) => {
      const inv = await ctx.db.get(invoiceId);
      expect(inv?.issueDate).toBe(newDate);
    });
  });

  it("rejects update on void invoice", async () => {
    const t = setupTest();
    const orgId = "org_1";
    const invoiceId = await seedInvoice(t, { orgId, status: "void" });
    const auth = t.withIdentity(identity(orgId));

    await expect(
      auth.mutation(api.functions.invoices.mutations.updateIssueDate, {
        invoiceId,
        issueDate: Date.UTC(2026, 0, 20),
      })
    ).rejects.toThrow(/cancelada/i);
  });

  it("rejects update across orgs", async () => {
    const t = setupTest();
    const invoiceId = await seedInvoice(t, { orgId: "org_a" });
    const auth = t.withIdentity(identity("org_b"));

    await expect(
      auth.mutation(api.functions.invoices.mutations.updateIssueDate, {
        invoiceId,
        issueDate: Date.UTC(2026, 0, 20),
      })
    ).rejects.toThrow(/no encontrada/i);
  });

  it("logs documentEvents 'updated' on success", async () => {
    const t = setupTest();
    const orgId = "org_1";
    const invoiceId = await seedInvoice(t, { orgId });
    const auth = t.withIdentity(identity(orgId));

    await auth.mutation(api.functions.invoices.mutations.updateIssueDate, {
      invoiceId,
      issueDate: Date.UTC(2026, 0, 20),
    });

    await t.run(async (ctx) => {
      const events = await ctx.db
        .query("documentEvents")
        .withIndex("by_orgId_entityType_entityId", (q) =>
          q.eq("orgId", orgId).eq("entityType", "invoice").eq("entityId", invoiceId)
        )
        .collect();
      expect(events.some((e) => e.eventType === "updated")).toBe(true);
    });
  });
});
