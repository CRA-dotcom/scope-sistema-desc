import { describe, it, expect } from "vitest";
import { setupTest, ORG_A, ORG_B } from "../../../../tests/harness";
import { api, internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

function admin(orgId: string) {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `user_admin_${orgId}`,
    orgId,
    orgRole: "org:admin",
  };
}

function member(orgId: string) {
  return {
    tokenIdentifier: `test|member_${orgId}`,
    subject: `user_member_${orgId}`,
    orgId,
    orgRole: "org:member",
  };
}

async function seedClient(
  t: ReturnType<typeof setupTest>,
  orgId: string
): Promise<Id<"clients">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("clients", {
      orgId,
      name: "Acme",
      rfc: "ACM240115ABC",
      industry: "S",
      annualRevenue: 1_000_000,
      billingFrequency: "mensual" as const,
      isArchived: false,
      createdAt: Date.now(),
    })
  );
}

async function insertRow(
  t: ReturnType<typeof setupTest>,
  args: {
    orgId: string;
    clientId: Id<"clients">;
    period: string;
    periodType: "monthly" | "quarterly" | "annual";
    status: "uploaded" | "extracted" | "validated" | "rejected" | "error";
  }
): Promise<Id<"clientFinancialData">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("clientFinancialData", {
      orgId: args.orgId,
      clientId: args.clientId,
      period: args.period,
      periodType: args.periodType,
      bucketKey: `${args.orgId}/${args.clientId}/finanzas/${args.period}.xlsx`,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: 100,
      filename: `${args.period}.xlsx`,
      lineItems: [],
      status: args.status,
      uploadedBy: "u1",
      uploadedAt: Date.now(),
    })
  );
}

describe("clientFinancialData.queries.listByClient", () => {
  it("returns rows for client, ordered by period desc", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    await insertRow(t, {
      orgId: ORG_A,
      clientId,
      period: "2026-01",
      periodType: "monthly",
      status: "validated",
    });
    await insertRow(t, {
      orgId: ORG_A,
      clientId,
      period: "2026-03",
      periodType: "monthly",
      status: "extracted",
    });
    await insertRow(t, {
      orgId: ORG_A,
      clientId,
      period: "2026-02",
      periodType: "monthly",
      status: "uploaded",
    });

    const rows = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.clientFinancialData.queries.listByClient, {
        clientId,
      });
    expect(rows.map((r) => r.period)).toEqual([
      "2026-03",
      "2026-02",
      "2026-01",
    ]);
  });

  it("filters by periodType when supplied", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    await insertRow(t, {
      orgId: ORG_A,
      clientId,
      period: "2026-01",
      periodType: "monthly",
      status: "extracted",
    });
    await insertRow(t, {
      orgId: ORG_A,
      clientId,
      period: "2026-Q1",
      periodType: "quarterly",
      status: "extracted",
    });

    const rows = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.clientFinancialData.queries.listByClient, {
        clientId,
        periodType: "quarterly",
      });
    expect(rows).toHaveLength(1);
    expect(rows[0].periodType).toBe("quarterly");
  });

  it("scopes to org (cross-org returns nothing)", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    await insertRow(t, {
      orgId: ORG_A,
      clientId,
      period: "2026-01",
      periodType: "monthly",
      status: "validated",
    });

    const rows = await t
      .withIdentity(admin(ORG_B))
      .query(api.functions.clientFinancialData.queries.listByClient, {
        clientId,
      });
    expect(rows).toEqual([]);
  });

  it("rejects non-admin caller", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    await expect(
      t
        .withIdentity(member(ORG_A))
        .query(api.functions.clientFinancialData.queries.listByClient, {
          clientId,
        })
    ).rejects.toThrow(/Administrador/);
  });
});

describe("clientFinancialData.queries.getFinancialContext", () => {
  it("returns most recent validated row ≤ asOfPeriod", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    await insertRow(t, {
      orgId: ORG_A,
      clientId,
      period: "2026-01",
      periodType: "monthly",
      status: "validated",
    });
    await insertRow(t, {
      orgId: ORG_A,
      clientId,
      period: "2026-02",
      periodType: "monthly",
      status: "validated",
    });
    await insertRow(t, {
      orgId: ORG_A,
      clientId,
      period: "2026-04",
      periodType: "monthly",
      status: "validated",
    });

    const ctx = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.clientFinancialData.queries.getFinancialContext, {
        clientId,
        periodType: "monthly",
        asOfPeriod: "2026-03",
      });
    expect(ctx).toBeTruthy();
    expect(ctx!.period).toBe("2026-02");
  });

  it("ignores non-validated rows", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    await insertRow(t, {
      orgId: ORG_A,
      clientId,
      period: "2026-02",
      periodType: "monthly",
      status: "extracted",
    });
    await insertRow(t, {
      orgId: ORG_A,
      clientId,
      period: "2026-01",
      periodType: "monthly",
      status: "validated",
    });

    const ctx = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.clientFinancialData.queries.getFinancialContext, {
        clientId,
        periodType: "monthly",
        asOfPeriod: "2026-03",
      });
    expect(ctx!.period).toBe("2026-01");
  });

  it("returns null when no validated rows match", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const ctx = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.clientFinancialData.queries.getFinancialContext, {
        clientId,
        periodType: "monthly",
        asOfPeriod: "2026-12",
      });
    expect(ctx).toBeNull();
  });

  it("scopes by periodType", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    await insertRow(t, {
      orgId: ORG_A,
      clientId,
      period: "2026-Q1",
      periodType: "quarterly",
      status: "validated",
    });
    const noMonthly = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.clientFinancialData.queries.getFinancialContext, {
        clientId,
        periodType: "monthly",
        asOfPeriod: "2026-12",
      });
    expect(noMonthly).toBeNull();
    const matchQuarter = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.clientFinancialData.queries.getFinancialContext, {
        clientId,
        periodType: "quarterly",
        asOfPeriod: "2026-Q4",
      });
    expect(matchQuarter!.period).toBe("2026-Q1");
  });

  it("internal variant works without auth context", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    await insertRow(t, {
      orgId: ORG_A,
      clientId,
      period: "2026-01",
      periodType: "monthly",
      status: "validated",
    });

    const ctx = await t.query(
      internal.functions.clientFinancialData.queries.getFinancialContextInternal,
      {
        orgId: ORG_A,
        clientId,
        periodType: "monthly",
        asOfPeriod: "2026-12",
      }
    );
    expect(ctx).toBeTruthy();
    expect(ctx!.period).toBe("2026-01");
  });
});
