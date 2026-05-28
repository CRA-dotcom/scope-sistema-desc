import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTest, ORG_A } from "../../../../tests/harness";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

// Mock blob storage so the download URL fetch can be intercepted.
const signedDownloadUrlMock = vi.fn(
  async (_args: { bucketKey: string; expiresSec?: number }) =>
    "https://signed.example.test/file.xlsx"
);
vi.mock("../../../lib/blobStorage", async (original) => {
  const mod = (await original()) as Record<string, unknown>;
  return {
    ...mod,
    uploadBlob: vi.fn(async (a: { key: string }) => ({
      bucketKey: a.key,
      etag: "ok",
    })),
    signedDownloadUrl: signedDownloadUrlMock,
    deleteBlob: vi.fn(async (_k: string) => {}),
  };
});

vi.mock("../../../lib/excelParser", () => ({
  parseExcel: vi.fn(() => [
    {
      sheetName: "P&L",
      rows: [
        ["Concepto", "Monto"],
        ["Ingresos", 150000],
      ],
    },
  ]),
}));

function admin(orgId: string) {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `user_admin_${orgId}`,
    orgId,
    orgRole: "org:admin",
  };
}

async function seedClientAndRow(
  t: ReturnType<typeof setupTest>,
  orgId: string
): Promise<{ clientId: Id<"clients">; rowId: Id<"clientFinancialData"> }> {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId,
      name: "Acme SA",
      rfc: "ACM240115ABC",
      industry: "Servicios",
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
      bucketKey: `${orgId}/${clientId}/finanzas/2026-01-fake.xlsx`,
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: 1000,
      filename: "estados.xlsx",
      lineItems: [],
      status: "uploaded" as const,
      uploadedBy: "user_admin",
      uploadedAt: Date.now(),
    });
    return { clientId, rowId };
  });
}

function buildFetchMockSequence(responses: Response[]): typeof fetch {
  let i = 0;
  return vi.fn(async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return r;
  }) as unknown as typeof fetch;
}

function blobResponse(body = "fake-xlsx-bytes"): Response {
  return new Response(new TextEncoder().encode(body).buffer, { status: 200 });
}

function claudeResponse(text: string): Response {
  return new Response(
    JSON.stringify({
      content: [{ type: "text", text }],
      usage: { input_tokens: 100, output_tokens: 50 },
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function claudeError(status: number): Response {
  return new Response(`server error ${status}`, { status });
}

beforeEach(() => {
  signedDownloadUrlMock.mockClear();
  process.env.ANTHROPIC_API_KEY = "sk-test";
});

describe("clientFinancialData.actions.extractInternal", () => {
  it("happy path: parses Claude JSON → patches row status=extracted with lineItems + aiExtraction", async () => {
    const t = setupTest();
    const { rowId } = await seedClientAndRow(t, ORG_A);

    vi.stubGlobal(
      "fetch",
      buildFetchMockSequence([
        blobResponse(),
        claudeResponse(
          JSON.stringify({
            lineItems: [
              { label: "Ingresos", amount: 150000, category: "ingresos" },
              {
                label: "Gastos",
                amount: 50000,
                category: "gastos_operativos",
              },
            ],
          })
        ),
      ])
    );

    await t
      .withIdentity(admin(ORG_A))
      .action(internal.functions.clientFinancialData.actions.extractInternal, {
        id: rowId,
      });

    const row = await t.run(async (ctx) => ctx.db.get(rowId));
    expect(row!.status).toBe("extracted");
    expect(row!.lineItems).toHaveLength(2);
    expect(row!.lineItems[0]).toEqual({
      label: "Ingresos",
      amount: 150000,
      category: "ingresos",
      satConcept: undefined,
    });
    expect(row!.aiExtraction).toBeDefined();
    expect(row!.aiExtraction!.model).toBe("claude-sonnet-4-20250514");
    expect(row!.aiExtraction!.promptVersion).toBe("v1-2026-05-27");
    expect(row!.aiExtraction!.costUsd).toBeGreaterThan(0);
    expect(row!.errorMessage).toBeUndefined();
  });

  it("marks status=error when Claude API fails after retries", async () => {
    const t = setupTest();
    const { rowId } = await seedClientAndRow(t, ORG_A);

    vi.stubGlobal(
      "fetch",
      buildFetchMockSequence([
        blobResponse(),
        claudeError(500),
        claudeError(500),
        claudeError(500),
      ])
    );

    await t
      .withIdentity(admin(ORG_A))
      .action(internal.functions.clientFinancialData.actions.extractInternal, {
        id: rowId,
      });

    const row = await t.run(async (ctx) => ctx.db.get(rowId));
    expect(row!.status).toBe("error");
    expect(row!.errorMessage).toContain("Claude API 500");
    expect(row!.lineItems).toEqual([]);
  }, 30_000);

  it("marks status=error when ANTHROPIC_API_KEY is missing", async () => {
    const t = setupTest();
    const { rowId } = await seedClientAndRow(t, ORG_A);
    delete process.env.ANTHROPIC_API_KEY;

    await t
      .withIdentity(admin(ORG_A))
      .action(internal.functions.clientFinancialData.actions.extractInternal, {
        id: rowId,
      });

    const row = await t.run(async (ctx) => ctx.db.get(rowId));
    expect(row!.status).toBe("error");
    expect(row!.errorMessage).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("is idempotent: skips rows already extracted/validated", async () => {
    const t = setupTest();
    const { rowId } = await seedClientAndRow(t, ORG_A);

    await t.run(async (ctx) =>
      ctx.db.patch(rowId, {
        status: "extracted" as const,
        lineItems: [
          { label: "old", amount: 1, category: "otros" as const },
        ],
      })
    );

    vi.stubGlobal(
      "fetch",
      buildFetchMockSequence([
        blobResponse(),
        claudeResponse(
          JSON.stringify({
            lineItems: [
              { label: "new", amount: 999, category: "ingresos" },
            ],
          })
        ),
      ])
    );

    await t
      .withIdentity(admin(ORG_A))
      .action(internal.functions.clientFinancialData.actions.extractInternal, {
        id: rowId,
      });

    const row = await t.run(async (ctx) => ctx.db.get(rowId));
    // unchanged: still the seeded "old" line item
    expect(row!.lineItems[0].label).toBe("old");
  });

  it("retries Claude API on transient 500 then succeeds", async () => {
    const t = setupTest();
    const { rowId } = await seedClientAndRow(t, ORG_A);

    vi.stubGlobal(
      "fetch",
      buildFetchMockSequence([
        blobResponse(),
        claudeError(500),
        claudeResponse(
          JSON.stringify({
            lineItems: [
              { label: "Recovered", amount: 100, category: "ingresos" },
            ],
          })
        ),
      ])
    );

    await t
      .withIdentity(admin(ORG_A))
      .action(internal.functions.clientFinancialData.actions.extractInternal, {
        id: rowId,
      });

    const row = await t.run(async (ctx) => ctx.db.get(rowId));
    expect(row!.status).toBe("extracted");
    expect(row!.lineItems).toHaveLength(1);
    expect(row!.lineItems[0].label).toBe("Recovered");
  }, 30_000);
});
