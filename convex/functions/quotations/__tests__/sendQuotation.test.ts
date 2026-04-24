import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "../../../_generated/api";
import { setupTest, ORG_A, ORG_B } from "../../../../tests/harness";
import { seedClient, seedQuotation } from "./helpers/quotations";

vi.mock("resend", () => {
  const send = vi.fn();
  class MockResend {
    emails = { send };
    domains = { list: vi.fn().mockResolvedValue({ data: [], error: null }) };
    constructor(_k: string) {
      void _k;
    }
  }
  return { Resend: MockResend, __send: send };
});

async function getMockSend() {
  const m = await import("resend");
  // @ts-expect-error test handle
  return m.__send as ReturnType<typeof vi.fn>;
}

function admin(orgId: string) {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `user_admin_${orgId}`,
    orgId,
    orgRole: "org:admin",
  };
}

async function seedResend(t: ReturnType<typeof setupTest>, orgId: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgIntegrations", {
      orgId,
      provider: "resend",
      config: { apiKeySecretRef: "re_test", fromEmail: "noreply@test.mx" },
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
}

async function seedIssuingCompanyDefault(
  t: ReturnType<typeof setupTest>,
  orgId: string
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("issuingCompanies", {
      orgId,
      name: "Empresa Emisora A",
      legalName: "Empresa Emisora A S.A.",
      rfc: "EEA200101ABC",
      regimenFiscalCode: "601",
      codigoPostal: "00000",
      address: { street: "Calle 1", city: "CDMX", state: "CDMX", country: "MX" },
      email: "contacto@ejemplo.mx",
      isDefault: true,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
}

async function seedQuotationForSend(
  t: ReturnType<typeof setupTest>,
  orgId: string,
  opts: {
    assignedTo?: string;
    contactEmail?: string;
    status?: "draft" | "sent";
    sendCount?: number;
    /** Pass `false` to omit the pdf entirely (test missing PDF). */
    withPdf?: boolean;
  } = {}
) {
  const contactEmail =
    "contactEmail" in opts ? opts.contactEmail : "cliente@test.mx";
  const clientId = await seedClient(t, orgId, {
    assignedTo: opts.assignedTo,
    contactEmail,
  });
  const svcId = await t.run(async (ctx) =>
    ctx.db.insert("services", {
      orgId,
      name: "Contable",
      type: "base",
      minPct: 5,
      maxPct: 15,
      defaultPct: 10,
      isDefault: true,
      sortOrder: 0,
    })
  );
  const projectionId = await t.run(async (ctx) =>
    ctx.db.insert("projections", {
      orgId,
      clientId,
      year: 2026,
      annualSales: 1_000_000,
      totalBudget: 100_000,
      commissionRate: 0,
      seasonalityData: [],
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  );
  const projServiceId = await t.run(async (ctx) =>
    ctx.db.insert("projectionServices", {
      orgId,
      projectionId,
      serviceId: svcId,
      serviceName: "Contable",
      chosenPct: 10,
      annualAmount: 10_000,
      isActive: true,
      normalizedWeight: 1,
    })
  );
  let pdfStorageId: any = undefined;
  if (opts.withPdf !== false) {
    pdfStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["%PDF-1.4 fake"], { type: "application/pdf" }))
    );
  }
  return await seedQuotation(t, orgId, clientId, {
    status: opts.status ?? "draft",
    sendCount: opts.sendCount,
    projServiceId,
    pdfStorageId,
  });
}

describe("sendQuotation", () => {
  beforeEach(async () => {
    process.env.QUOTATION_TOKEN_SECRET = "a".repeat(48);
    process.env.APP_URL = "http://localhost:3000";
    const send = await getMockSend();
    send.mockReset();
    send.mockResolvedValue({ data: { id: "resend_msg_1" }, error: null });
  });

  it("admin sends a draft quotation: status becomes sent, sendCount=1, token hash stored", async () => {
    const t = setupTest();
    await seedResend(t, ORG_A);
    await seedIssuingCompanyDefault(t, ORG_A);
    const qid = await seedQuotationForSend(t, ORG_A);
    const result = await t
      .withIdentity(admin(ORG_A))
      .action(api.functions.quotations.actions.sendQuotation, {
        quotationId: qid,
      });

    expect(result.ok).toBe(true);
    expect(result.sendCount).toBe(1);
    expect(result.plaintextToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const q = await t.run((ctx) => ctx.db.get(qid));
    expect(q?.status).toBe("sent");
    expect(q?.accessTokenHash).toBeTruthy();
    expect(q?.tokenExpiresAt).toBeGreaterThan(Date.now());
  });

  it("re-send on status sent increments sendCount and rotates token", async () => {
    const t = setupTest();
    await seedResend(t, ORG_A);
    await seedIssuingCompanyDefault(t, ORG_A);
    const qid = await seedQuotationForSend(t, ORG_A, {
      status: "sent",
      sendCount: 1,
    });
    const r1 = await t
      .withIdentity(admin(ORG_A))
      .action(api.functions.quotations.actions.sendQuotation, {
        quotationId: qid,
      });
    expect(r1.sendCount).toBe(2);
    const q = await t.run((ctx) => ctx.db.get(qid));
    expect(q?.sendCount).toBe(2);
  });

  it("throws when client has no contactEmail", async () => {
    const t = setupTest();
    await seedResend(t, ORG_A);
    await seedIssuingCompanyDefault(t, ORG_A);
    const qid = await seedQuotationForSend(t, ORG_A, { contactEmail: undefined });
    await expect(
      t
        .withIdentity(admin(ORG_A))
        .action(api.functions.quotations.actions.sendQuotation, {
          quotationId: qid,
        })
    ).rejects.toThrow(/email/i);
  });

  it("throws when quotation has no pdfStorageId", async () => {
    const t = setupTest();
    await seedResend(t, ORG_A);
    await seedIssuingCompanyDefault(t, ORG_A);
    const qid = await seedQuotationForSend(t, ORG_A, {
      withPdf: false,
    });
    await expect(
      t
        .withIdentity(admin(ORG_A))
        .action(api.functions.quotations.actions.sendQuotation, {
          quotationId: qid,
        })
    ).rejects.toThrow(/PDF/i);
  });

  it("throws when status is approved", async () => {
    const t = setupTest();
    await seedResend(t, ORG_A);
    await seedIssuingCompanyDefault(t, ORG_A);
    const clientId = await seedClient(t, ORG_A, { contactEmail: "c@x.mx" });
    const pdfStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["%PDF-1.4 fake"], { type: "application/pdf" }))
    );
    const qid = await seedQuotation(t, ORG_A, clientId, {
      status: "approved",
      pdfStorageId,
    });
    await expect(
      t
        .withIdentity(admin(ORG_A))
        .action(api.functions.quotations.actions.sendQuotation, {
          quotationId: qid,
        })
    ).rejects.toThrow();
  });

  it("cross-org send is blocked", async () => {
    const t = setupTest();
    await seedResend(t, ORG_A);
    await seedIssuingCompanyDefault(t, ORG_A);
    const qid = await seedQuotationForSend(t, ORG_A);
    await expect(
      t
        .withIdentity(admin(ORG_B))
        .action(api.functions.quotations.actions.sendQuotation, {
          quotationId: qid,
        })
    ).rejects.toThrow();
  });

  it("resend 4xx surfaces as error; token still rotated (trade-off documented)", async () => {
    const t = setupTest();
    await seedResend(t, ORG_A);
    await seedIssuingCompanyDefault(t, ORG_A);
    const send = await getMockSend();
    send.mockResolvedValue({
      data: null,
      error: { message: "invalid from domain" },
    });
    const qid = await seedQuotationForSend(t, ORG_A);
    await expect(
      t
        .withIdentity(admin(ORG_A))
        .action(api.functions.quotations.actions.sendQuotation, {
          quotationId: qid,
        })
    ).rejects.toThrow(/invalid from domain/);
    const q = await t.run((ctx) => ctx.db.get(qid));
    expect(q?.status).toBe("sent"); // rotation happened even though send failed
    expect(q?.accessTokenHash).toBeTruthy();
  });
});
