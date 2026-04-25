import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../../tests/harness";
import { seedClient, seedQuotation } from "./helpers/quotations";

vi.mock("resend", () => {
  const send = vi.fn().mockResolvedValue({ data: { id: "msg" }, error: null });
  class MockResend {
    emails = { send };
    domains = { list: vi.fn() };
    constructor(_: string) {
      void _;
    }
  }
  return { Resend: MockResend };
});

function member(orgId: string, userId: string) {
  return {
    tokenIdentifier: `test|${userId}`,
    subject: userId,
    orgId,
    orgRole: "org:member",
  };
}

async function seedFullContext(
  t: ReturnType<typeof setupTest>,
  orgId: string,
  assignedTo?: string
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgIntegrations", {
      orgId,
      provider: "resend",
      config: { apiKeySecretRef: "re_x", fromEmail: "n@x.mx" },
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("issuingCompanies", {
      orgId,
      name: "EA",
      legalName: "EA",
      rfc: "EA200101ABC",
      regimenFiscalCode: "601",
      codigoPostal: "00000",
      address: { street: "s", city: "c", state: "s", country: "MX" },
      email: "a@b.mx",
      isDefault: true,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
  const clientId = await seedClient(t, orgId, {
    assignedTo,
    contactEmail: "x@y.mx",
  });
  const svcId = await t.run((ctx) =>
    ctx.db.insert("services", {
      orgId,
      name: "Contable",
      type: "base",
      minPct: 5,
      maxPct: 15,
      defaultPct: 10,
      isDefault: true,
      sortOrder: 1,
    })
  );
  const projId = await t.run((ctx) =>
    ctx.db.insert("projections", {
      orgId,
      clientId,
      year: 2026,
      annualSales: 1,
      totalBudget: 1,
      commissionRate: 0,
      seasonalityData: [],
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  );
  const projServiceId = await t.run((ctx) =>
    ctx.db.insert("projectionServices", {
      orgId,
      projectionId: projId,
      serviceId: svcId,
      serviceName: "Contable",
      chosenPct: 10,
      annualAmount: 100,
      isActive: true,
      normalizedWeight: 1,
    })
  );
  const qid = await t.run(async (ctx) => {
    const pdfId = await ctx.storage.store(
      new Blob(["%PDF-1.4 fake"], { type: "application/pdf" })
    );
    return await ctx.db.insert("quotations", {
      orgId,
      projServiceId,
      clientId,
      serviceName: "Contable",
      content: "<div>Q</div>",
      pdfStorageId: pdfId,
      status: "draft",
      createdAt: Date.now(),
    });
  });
  return { clientId, qid };
}

describe("quotations permissions", () => {
  beforeEach(() => {
    process.env.QUOTATION_TOKEN_SECRET = "a".repeat(48);
    process.env.APP_URL = "http://localhost:3000";
  });

  it("ejecutivo can send quotation of own client", async () => {
    const t = setupTest();
    const { qid } = await seedFullContext(t, ORG_A, "user_1");
    const result = await t
      .withIdentity(member(ORG_A, "user_1"))
      .action(api.functions.quotations.actions.sendQuotation, {
        quotationId: qid,
      });
    expect(result.ok).toBe(true);
  });

  it("ejecutivo cannot send quotation of other user's client", async () => {
    const t = setupTest();
    const { qid } = await seedFullContext(t, ORG_A, "user_1");
    await expect(
      t
        .withIdentity(member(ORG_A, "user_OTHER"))
        .action(api.functions.quotations.actions.sendQuotation, {
          quotationId: qid,
        })
    ).rejects.toThrow();
  });

  it("updateStatus blocks terminal -> other transitions", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const qid = await seedQuotation(t, ORG_A, clientId, { status: "approved" });
    await expect(
      t
        .withIdentity(member(ORG_A, "user_1"))
        .mutation(api.functions.quotations.mutations.updateStatus, {
          id: qid,
          status: "sent",
        })
    ).rejects.toThrow();
  });
});
