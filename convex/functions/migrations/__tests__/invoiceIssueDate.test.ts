import { describe, it, expect } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

/**
 * Seed helpers for invoiceIssueDate migration tests.
 * Uses real schema shapes (no `as any`) to satisfy Convex validators.
 */
async function seedInvoice(
  t: ReturnType<typeof setupTest>,
  opts: {
    orgId: string;
    uploadedAt: number;
    issueDate?: number;
  }
): Promise<Id<"invoices">> {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId: opts.orgId,
      name: "Test Client",
      rfc: "TST900101AAA",
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
      serviceName: "Servicio Test",
      month: 1,
      year: 2026,
      amount: 1000,
      bucketKey: "test/invoice.pdf",
      contentType: "application/pdf",
      sizeBytes: 1024,
      filename: "invoice.pdf",
      status: "uploaded" as const,
      uploadedAt: opts.uploadedAt,
      uploadedBy: "user_test",
      issueDate: opts.issueDate,
      createdAt: opts.uploadedAt,
    });
  });
}

describe("invoiceIssueDate migration", () => {
  it("backfills issueDate from uploadedAt when issueDate is undefined", async () => {
    const t = setupTest();
    const uploadedAt = Date.UTC(2026, 0, 15); // 2026-01-15
    const id = await seedInvoice(t, { orgId: "org_1", uploadedAt });

    const result = await t.mutation(
      internal.functions.migrations.invoiceIssueDate.migrate,
      { cursor: null, limit: 100 }
    );

    expect(result.migrated).toBe(1);
    expect(result.done).toBe(true);

    await t.run(async (ctx) => {
      const row = await ctx.db.get(id);
      expect(row?.issueDate).toBe(uploadedAt);
    });
  });

  it("does NOT touch rows that already have issueDate set", async () => {
    const t = setupTest();
    const uploadedAt = Date.UTC(2026, 0, 15);
    const issueDate = Date.UTC(2026, 0, 10); // earlier fiscal date
    const id = await seedInvoice(t, { orgId: "org_1", uploadedAt, issueDate });

    const result = await t.mutation(
      internal.functions.migrations.invoiceIssueDate.migrate,
      { cursor: null, limit: 100 }
    );

    expect(result.migrated).toBe(0);
    await t.run(async (ctx) => {
      const row = await ctx.db.get(id);
      expect(row?.issueDate).toBe(issueDate); // unchanged
    });
  });

  it("is idempotent — re-running after first pass yields 0 migrated", async () => {
    const t = setupTest();
    await seedInvoice(t, { orgId: "org_1", uploadedAt: Date.UTC(2026, 0, 15) });

    const first = await t.mutation(
      internal.functions.migrations.invoiceIssueDate.migrate,
      { cursor: null, limit: 100 }
    );
    expect(first.migrated).toBe(1);
    expect(first.done).toBe(true);

    const second = await t.mutation(
      internal.functions.migrations.invoiceIssueDate.migrate,
      { cursor: null, limit: 100 }
    );
    expect(second.migrated).toBe(0);
    expect(second.done).toBe(true);
  });
});
