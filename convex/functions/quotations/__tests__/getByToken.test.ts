import { describe, it, expect, beforeEach } from "vitest";
import crypto from "crypto";
import { api } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../../tests/harness";
import { seedClient, seedQuotation } from "./helpers/quotations";

const SECRET = "a".repeat(48);

function hashFor(token: string): string {
  return crypto.createHmac("sha256", SECRET).update(token).digest("base64url");
}

async function seedIssuingCompanyForQuotation(
  t: ReturnType<typeof setupTest>,
  orgId: string,
  clientId: string
) {
  const svcId = await t.run(async (ctx) =>
    ctx.db.insert("services", {
      orgId,
      name: "Contable",
      type: "base",
      minPct: 5, maxPct: 15, defaultPct: 10, isDefault: true,
      sortOrder: 1,  // schema requires
    })
  );
  await t.run(async (ctx) =>
    ctx.db.insert("issuingCompanies", {
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
    })
  );
  return svcId;
}

describe("getByToken public query", () => {
  beforeEach(() => {
    process.env.QUOTATION_TOKEN_SECRET = SECRET;
  });

  it("returns kind=ready for valid, non-expired, sent quotation", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A, { contactName: "Juan" });
    const svcId = await seedIssuingCompanyForQuotation(t, ORG_A, clientId);
    const projectionId = await t.run((ctx) =>
      ctx.db.insert("projections", {
        orgId: ORG_A, clientId, year: 2026,
        annualSales: 1, totalBudget: 1, commissionRate: 0,
        seasonalityData: [], status: "active",
        createdAt: Date.now(), updatedAt: Date.now(),
      })
    );
    const projServiceId = await t.run((ctx) =>
      ctx.db.insert("projectionServices", {
        orgId: ORG_A, projectionId, serviceId: svcId, serviceName: "Contable",
        chosenPct: 10, annualAmount: 100, isActive: true,
        normalizedWeight: 1,  // schema requires
      })
    );
    const token = "valid_token_xyz";
    await seedQuotation(t, ORG_A, clientId, {
      status: "sent",
      accessTokenHash: hashFor(token),
      tokenExpiresAt: Date.now() + 100_000,
      projServiceId,
    });
    const result = await t.query(api.functions.quotations.publicQueries.getByToken, { token });
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.quotation.serviceName).toBe("Contable");
      expect(result.client.name).toBe("Test Client");
    }
  });

  it("returns kind=expired when tokenExpiresAt < now", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const token = "expired_token";
    await seedQuotation(t, ORG_A, clientId, {
      status: "sent",
      accessTokenHash: hashFor(token),
      tokenExpiresAt: Date.now() - 1000,
    });
    const result = await t.query(api.functions.quotations.publicQueries.getByToken, { token });
    expect(result.kind).toBe("expired");
  });

  it("returns kind=invalid when token hash not found", async () => {
    const t = setupTest();
    const result = await t.query(api.functions.quotations.publicQueries.getByToken, {
      token: "ghost_token",
    });
    expect(result.kind).toBe("invalid");
  });

  it("returns kind=already_responded when status=approved (simulated)", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const token = "post_accept_token";
    // Simulate a race: the hash field was still set but status already moved.
    await seedQuotation(t, ORG_A, clientId, {
      status: "approved",
      accessTokenHash: hashFor(token),
      tokenExpiresAt: Date.now() + 100_000,
    });
    const result = await t.query(api.functions.quotations.publicQueries.getByToken, { token });
    expect(result.kind).toBe("already_responded");
  });

  it("returns kind=invalid for malformed token", async () => {
    const t = setupTest();
    const result = await t.query(api.functions.quotations.publicQueries.getByToken, {
      token: "not a real token!!!",
    });
    expect(result.kind).toBe("invalid");
  });
});
