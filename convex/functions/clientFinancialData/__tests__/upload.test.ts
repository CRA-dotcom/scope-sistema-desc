import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTest, ORG_A } from "../../../../tests/harness";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

// Mock Railway S3 + signed URL (also used by extractInternal scheduled call).
const uploadBlobMock = vi.fn(
  async (args: { key: string; buffer: Uint8Array; contentType: string }) => ({
    bucketKey: args.key,
    etag: "test-etag",
  })
);
const signedDownloadUrlMock = vi.fn(
  async (_args: { bucketKey: string; expiresSec?: number }) =>
    "https://signed.example.test/file.xlsx"
);
const deleteBlobMock = vi.fn(async (_key: string) => {});

vi.mock("../../../lib/blobStorage", async (original) => {
  const mod = (await original()) as Record<string, unknown>;
  return {
    ...mod,
    uploadBlob: uploadBlobMock,
    signedDownloadUrl: signedDownloadUrlMock,
    deleteBlob: deleteBlobMock,
  };
});

// Mock the Excel parser so we don't need real xlsx buffers when the
// scheduled extractInternal runs in tests.
vi.mock("../../../lib/excelParser", () => ({
  parseExcel: vi.fn(() => [
    { sheetName: "Hoja1", rows: [["Concepto", "Monto"]] },
  ]),
}));

// Mock global fetch so the scheduled extractInternal doesn't make real calls.
beforeEach(() => {
  uploadBlobMock.mockClear();
  signedDownloadUrlMock.mockClear();
  uploadBlobMock.mockResolvedValue({ bucketKey: "ok", etag: "ok" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ content: [], usage: { input_tokens: 0, output_tokens: 0 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    )
  );
  process.env.ANTHROPIC_API_KEY = "sk-test";
});

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
  orgId: string
): Promise<Id<"clients">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("clients", {
      orgId,
      name: "Acme SA",
      rfc: "ACM240115ABC",
      industry: "Servicios",
      annualRevenue: 1_000_000,
      billingFrequency: "mensual" as const,
      isArchived: false,
      contactEmail: "ops@acme.test",
      createdAt: Date.now(),
    })
  );
}

const XLSX_BYTES = new TextEncoder().encode("fake-xlsx-bytes").buffer;

describe("clientFinancialData.actions.upload", () => {
  it("happy path: writes blob, inserts row status=uploaded, schedules extraction", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);

    const result = await t
      .withIdentity(admin(ORG_A))
      .action(api.functions.clientFinancialData.actions.upload, {
        clientId,
        period: "2026-01",
        periodType: "monthly",
        filename: "estados-enero.xlsx",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        fileBuffer: XLSX_BYTES,
      });

    expect(result.id).toBeTruthy();
    expect(uploadBlobMock).toHaveBeenCalledOnce();

    const row = await t.run(async (ctx) => ctx.db.get(result.id));
    expect(row).toBeTruthy();
    expect(row!.status).toBe("uploaded");
    expect(row!.orgId).toBe(ORG_A);
    expect(row!.period).toBe("2026-01");
    expect(row!.periodType).toBe("monthly");
    expect(row!.filename).toBe("estados-enero.xlsx");
    expect(row!.lineItems).toEqual([]);
    expect(row!.bucketKey).toMatch(
      new RegExp(`^${ORG_A}/${clientId}/finanzas/2026-01-`)
    );

    // documentEvents 'uploaded' logged
    const events = await t.run(async (ctx) =>
      ctx.db.query("documentEvents").collect()
    );
    expect(
      events.some(
        (e) => e.entityType === "financial_data" && e.eventType === "uploaded"
      )
    ).toBe(true);
  });

  it("accepts .xls extension even with application/octet-stream", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);

    const result = await t
      .withIdentity(admin(ORG_A))
      .action(api.functions.clientFinancialData.actions.upload, {
        clientId,
        period: "2026-Q1",
        periodType: "quarterly",
        filename: "estados-q1.xls",
        contentType: "application/octet-stream",
        fileBuffer: XLSX_BYTES,
      });
    expect(result.id).toBeTruthy();
  });

  it("rejects non-Excel filename + content type", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);

    await expect(
      t.withIdentity(admin(ORG_A)).action(
        api.functions.clientFinancialData.actions.upload,
        {
          clientId,
          period: "2026-01",
          periodType: "monthly",
          filename: "documento.pdf",
          contentType: "application/pdf",
          fileBuffer: XLSX_BYTES,
        }
      )
    ).rejects.toThrow(/Excel/);

    expect(uploadBlobMock).not.toHaveBeenCalled();
  });

  it("rejects invalid period format for monthly", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);

    await expect(
      t.withIdentity(admin(ORG_A)).action(
        api.functions.clientFinancialData.actions.upload,
        {
          clientId,
          period: "Enero 2026",
          periodType: "monthly",
          filename: "x.xlsx",
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          fileBuffer: XLSX_BYTES,
        }
      )
    ).rejects.toThrow(/Periodo/);
  });

  it("rejects invalid period format for quarterly", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);

    await expect(
      t.withIdentity(admin(ORG_A)).action(
        api.functions.clientFinancialData.actions.upload,
        {
          clientId,
          period: "2026-Q5",
          periodType: "quarterly",
          filename: "x.xlsx",
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          fileBuffer: XLSX_BYTES,
        }
      )
    ).rejects.toThrow(/Periodo/);
  });

  it("rejects client from a different org", async () => {
    const t = setupTest();
    const otherClientId = await seedClient(t, "ORG_OTHER");

    await expect(
      t.withIdentity(admin(ORG_A)).action(
        api.functions.clientFinancialData.actions.upload,
        {
          clientId: otherClientId,
          period: "2026-01",
          periodType: "monthly",
          filename: "x.xlsx",
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          fileBuffer: XLSX_BYTES,
        }
      )
    ).rejects.toThrow(/Cliente/);
  });
});
