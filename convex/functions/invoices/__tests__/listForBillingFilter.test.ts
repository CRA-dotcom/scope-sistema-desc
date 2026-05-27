import { describe, it, expect } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { api } from "../../../_generated/api";

async function seedInvoiceWithDate(t: ReturnType<typeof setupTest>, opts: {
  orgId: string;
  issueDate?: number;
  uploadedAt: number;
  serviceName?: string;
}) {
  await t.run(async (ctx) => {
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
    await ctx.db.insert("invoices", {
      orgId: opts.orgId,
      clientId,
      projectionId,
      serviceName: opts.serviceName ?? "S",
      month: 1,
      year: 2026,
      amount: 1000,
      bucketKey: "k",
      contentType: "application/pdf",
      sizeBytes: 1,
      filename: "x.pdf",
      status: "uploaded" as const,
      uploadedAt: opts.uploadedAt,
      uploadedBy: "u",
      issueDate: opts.issueDate,
      createdAt: opts.uploadedAt,
    });
  });
}

describe("listForBilling — issueDate range filter", () => {
  it("filters by issueDate >= issueDateFrom", async () => {
    const t = setupTest();
    const orgId = "org_1";
    const Jan1 = Date.UTC(2026, 0, 1);
    const Feb1 = Date.UTC(2026, 1, 1);
    const Mar1 = Date.UTC(2026, 2, 1);

    await seedInvoiceWithDate(t, { orgId, uploadedAt: Mar1, issueDate: Jan1, serviceName: "Old" });
    await seedInvoiceWithDate(t, { orgId, uploadedAt: Mar1, issueDate: Feb1, serviceName: "Mid" });
    await seedInvoiceWithDate(t, { orgId, uploadedAt: Mar1, issueDate: Mar1, serviceName: "New" });

    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });
    const result = await auth.query(api.functions.invoices.queries.listForBilling, {
      year: 2026,
      issueDateFrom: Feb1,
    });
    const names = result.map((r: any) => r.serviceName).sort();
    expect(names).toEqual(["Mid", "New"]);
  });

  it("filters by issueDate <= issueDateTo", async () => {
    const t = setupTest();
    const orgId = "org_1";
    const Jan1 = Date.UTC(2026, 0, 1);
    const Feb1 = Date.UTC(2026, 1, 1);
    const Mar1 = Date.UTC(2026, 2, 1);

    await seedInvoiceWithDate(t, { orgId, uploadedAt: Mar1, issueDate: Jan1, serviceName: "A" });
    await seedInvoiceWithDate(t, { orgId, uploadedAt: Mar1, issueDate: Feb1, serviceName: "B" });
    await seedInvoiceWithDate(t, { orgId, uploadedAt: Mar1, issueDate: Mar1, serviceName: "C" });

    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });
    const result = await auth.query(api.functions.invoices.queries.listForBilling, {
      year: 2026,
      issueDateTo: Feb1,
    });
    const names = result.map((r: any) => r.serviceName).sort();
    expect(names).toEqual(["A", "B"]);
  });

  it("falls back to uploadedAt when issueDate is undefined", async () => {
    const t = setupTest();
    const orgId = "org_1";
    const Jan1 = Date.UTC(2026, 0, 1);
    const Feb1 = Date.UTC(2026, 1, 1);

    await seedInvoiceWithDate(t, { orgId, uploadedAt: Jan1, serviceName: "NoIssue" }); // no issueDate
    await seedInvoiceWithDate(t, { orgId, uploadedAt: Feb1, serviceName: "Later", issueDate: Feb1 });

    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });
    const result = await auth.query(api.functions.invoices.queries.listForBilling, {
      year: 2026,
      issueDateFrom: Feb1,
    });
    const names = result.map((r: any) => r.serviceName);
    // NoIssue (uploadedAt=Jan1) excluded; Later (issueDate=Feb1) included
    expect(names).toEqual(["Later"]);
  });
});
