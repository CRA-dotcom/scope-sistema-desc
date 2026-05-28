import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTest, ORG_A, ORG_B } from "../../../../tests/harness";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

const deleteBlobMock = vi.fn(async (_key: string) => {});
vi.mock("../../../lib/blobStorage", async (original) => {
  const mod = (await original()) as Record<string, unknown>;
  return {
    ...mod,
    deleteBlob: deleteBlobMock,
  };
});

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

async function seedRow(
  t: ReturnType<typeof setupTest>,
  orgId: string,
  overrides: Partial<{
    status: "uploaded" | "extracted" | "validated" | "rejected" | "error";
    lineItems: { label: string; amount: number; category: any; satConcept?: string }[];
  }> = {}
): Promise<{ clientId: Id<"clients">; rowId: Id<"clientFinancialData"> }> {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId,
      name: "Acme",
      rfc: "ACM240115ABC",
      industry: "S",
      annualRevenue: 1_000_000,
      billingFrequency: "mensual" as const,
      isArchived: false,
      createdAt: Date.now(),
    });
    const rowId = await ctx.db.insert("clientFinancialData", {
      orgId,
      clientId,
      period: "2026-01",
      periodType: "monthly" as const,
      bucketKey: `${orgId}/${clientId}/finanzas/x.xlsx`,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: 100,
      filename: "x.xlsx",
      lineItems: overrides.lineItems ?? [
        { label: "Ingresos", amount: 100, category: "ingresos" as const },
      ],
      status: overrides.status ?? "extracted",
      uploadedBy: "u1",
      uploadedAt: Date.now(),
      aiExtraction: {
        model: "claude",
        promptVersion: "v1",
        extractedAt: Date.now(),
      },
    });
    return { clientId, rowId };
  });
}

beforeEach(() => {
  deleteBlobMock.mockClear();
});

describe("clientFinancialData.mutations.markValidated", () => {
  it("happy: admin marks extracted row as validated", async () => {
    const t = setupTest();
    const { rowId } = await seedRow(t, ORG_A);
    await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.clientFinancialData.mutations.markValidated, {
        id: rowId,
      });
    const row = await t.run(async (ctx) => ctx.db.get(rowId));
    expect(row!.status).toBe("validated");
    expect(row!.validatedBy).toBe(`user_admin_${ORG_A}`);
    expect(row!.validatedAt).toBeGreaterThan(0);
  });

  it("can flip rejected → validated (allowing re-review)", async () => {
    const t = setupTest();
    const { rowId } = await seedRow(t, ORG_A, { status: "rejected" });
    await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.clientFinancialData.mutations.markValidated, {
        id: rowId,
      });
    const row = await t.run(async (ctx) => ctx.db.get(rowId));
    expect(row!.status).toBe("validated");
    expect(row!.rejectionReason).toBeUndefined();
  });

  it("rejects when row not in extracted/rejected status", async () => {
    const t = setupTest();
    const { rowId } = await seedRow(t, ORG_A, { status: "uploaded" });
    await expect(
      t
        .withIdentity(admin(ORG_A))
        .mutation(api.functions.clientFinancialData.mutations.markValidated, {
          id: rowId,
        })
    ).rejects.toThrow(/extracción/);
  });

  it("rejects non-admin caller", async () => {
    const t = setupTest();
    const { rowId } = await seedRow(t, ORG_A);
    await expect(
      t
        .withIdentity(member(ORG_A))
        .mutation(api.functions.clientFinancialData.mutations.markValidated, {
          id: rowId,
        })
    ).rejects.toThrow(/Administrador/);
  });

  it("rejects cross-org access", async () => {
    const t = setupTest();
    const { rowId } = await seedRow(t, ORG_A);
    await expect(
      t
        .withIdentity(admin(ORG_B))
        .mutation(api.functions.clientFinancialData.mutations.markValidated, {
          id: rowId,
        })
    ).rejects.toThrow(/no encontrado/);
  });
});

describe("clientFinancialData.mutations.markRejected", () => {
  it("happy: admin rejects with reason", async () => {
    const t = setupTest();
    const { rowId } = await seedRow(t, ORG_A);
    await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.clientFinancialData.mutations.markRejected, {
        id: rowId,
        reason: "Categorías mezcladas",
      });
    const row = await t.run(async (ctx) => ctx.db.get(rowId));
    expect(row!.status).toBe("rejected");
    expect(row!.rejectionReason).toBe("Categorías mezcladas");
  });

  it("rejects empty reason", async () => {
    const t = setupTest();
    const { rowId } = await seedRow(t, ORG_A);
    await expect(
      t
        .withIdentity(admin(ORG_A))
        .mutation(api.functions.clientFinancialData.mutations.markRejected, {
          id: rowId,
          reason: "   ",
        })
    ).rejects.toThrow(/razón/);
  });

  it("rejects when status != extracted", async () => {
    const t = setupTest();
    const { rowId } = await seedRow(t, ORG_A, { status: "validated" });
    await expect(
      t
        .withIdentity(admin(ORG_A))
        .mutation(api.functions.clientFinancialData.mutations.markRejected, {
          id: rowId,
          reason: "incorrect",
        })
    ).rejects.toThrow(/extracción/);
  });
});

describe("clientFinancialData.mutations.manuallySetLineItems", () => {
  it("happy: replaces line items + flags editedAt", async () => {
    const t = setupTest();
    const { rowId } = await seedRow(t, ORG_A);
    await t
      .withIdentity(admin(ORG_A))
      .mutation(
        api.functions.clientFinancialData.mutations.manuallySetLineItems,
        {
          id: rowId,
          lineItems: [
            { label: "Manual A", amount: 200, category: "ingresos" as const },
            {
              label: "Manual B",
              amount: 50,
              category: "gastos_operativos" as const,
            },
          ],
        }
      );
    const row = await t.run(async (ctx) => ctx.db.get(rowId));
    expect(row!.lineItems).toHaveLength(2);
    expect(row!.lineItems[0].label).toBe("Manual A");
    expect(row!.aiExtraction!.editedAt).toBeGreaterThan(0);
  });

  it("rejects edits on a rejected row", async () => {
    const t = setupTest();
    const { rowId } = await seedRow(t, ORG_A, { status: "rejected" });
    await expect(
      t
        .withIdentity(admin(ORG_A))
        .mutation(
          api.functions.clientFinancialData.mutations.manuallySetLineItems,
          { id: rowId, lineItems: [] }
        )
    ).rejects.toThrow(/Re-extrae/);
  });
});

describe("clientFinancialData.actions.deleteRecord", () => {
  it("happy: deletes blob + row + logs deleted event", async () => {
    const t = setupTest();
    const { rowId } = await seedRow(t, ORG_A);
    await t
      .withIdentity(admin(ORG_A))
      .action(api.functions.clientFinancialData.actions.deleteRecord, {
        id: rowId,
      });
    expect(deleteBlobMock).toHaveBeenCalledOnce();
    const row = await t.run(async (ctx) => ctx.db.get(rowId));
    expect(row).toBeNull();
    const events = await t.run(async (ctx) =>
      ctx.db.query("documentEvents").collect()
    );
    expect(
      events.some(
        (e) => e.entityType === "financial_data" && e.eventType === "deleted"
      )
    ).toBe(true);
  });

  it("proceeds with row delete even if blob delete throws", async () => {
    const t = setupTest();
    const { rowId } = await seedRow(t, ORG_A);
    deleteBlobMock.mockRejectedValueOnce(new Error("S3 down"));
    await t
      .withIdentity(admin(ORG_A))
      .action(api.functions.clientFinancialData.actions.deleteRecord, {
        id: rowId,
      });
    const row = await t.run(async (ctx) => ctx.db.get(rowId));
    expect(row).toBeNull();
  });

  it("rejects cross-org delete", async () => {
    const t = setupTest();
    const { rowId } = await seedRow(t, ORG_A);
    await expect(
      t
        .withIdentity(admin(ORG_B))
        .action(api.functions.clientFinancialData.actions.deleteRecord, {
          id: rowId,
        })
    ).rejects.toThrow(/no encontrado/);
  });
});
