import { describe, it, expect, vi } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

// Mock blobStorage to avoid Railway S3 calls.
// Mirrors the pattern in invoices.test.ts (preserves other exports).
vi.mock("../../../lib/blobStorage", async (original) => {
  const mod = (await original()) as Record<string, unknown>;
  return {
    ...mod,
    uploadBlob: vi.fn(async () => ({ bucketKey: "test-key", etag: "etag" })),
    buildKey: () => "o/c/invoices/test.pdf",
    signedDownloadUrl: vi.fn(async () => "https://fake/test.pdf"),
  };
});

const CFDI_XML = `<?xml version="1.0"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Fecha="2026-01-15T10:30:00" Total="1000.00"></cfdi:Comprobante>`;

/**
 * Seed the minimum FK rows needed by the upload action:
 *   clients + projections (no services row needed — invoices has no FK to services).
 */
async function seedOrg(
  t: ReturnType<typeof setupTest>,
  orgId: string
): Promise<{ clientId: Id<"clients">; projectionId: Id<"projections"> }> {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId,
      name: "Test Client",
      rfc: "TST900101AAA",
      industry: "Servicios",
      annualRevenue: 0,
      billingFrequency: "mensual" as const,
      isArchived: false,
      createdAt: 0,
    });
    const projectionId = await ctx.db.insert("projections", {
      orgId,
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
    return { clientId, projectionId };
  });
}

function identity(orgId: string) {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `user_admin_${orgId}`,
    orgId,
    orgRole: "org:admin",
  };
}

function pdfBytes(): ArrayBuffer {
  return new TextEncoder().encode("%PDF-1.4 fake-pdf-bytes").buffer;
}

describe("upload action — issueDate resolution", () => {
  it("uses CFDI XML Fecha when xmlBuffer provided and valid", async () => {
    const t = setupTest();
    const orgId = "org_test";
    const { clientId, projectionId } = await seedOrg(t, orgId);

    const xmlBuffer = new TextEncoder().encode(CFDI_XML).buffer;
    const result = await t.withIdentity(identity(orgId)).action(
      api.functions.invoices.actions.upload,
      {
        clientId,
        projectionId,
        serviceName: "Servicio Test",
        month: 1,
        year: 2026,
        amount: 1000,
        filename: "test.pdf",
        contentType: "application/pdf",
        fileBuffer: pdfBytes(),
        xmlBuffer,
      }
    );

    await t.run(async (ctx) => {
      const inv = await ctx.db.get(result.invoiceId);
      // CFDI Fecha="2026-01-15T10:30:00" treated as UTC → Date.UTC(2026,0,15,10,30,0)
      const expected = Date.UTC(2026, 0, 15, 10, 30, 0);
      expect(inv?.issueDate).toBe(expected);
    });
  });

  it("falls back to manual issueDate arg when xmlBuffer absent", async () => {
    const t = setupTest();
    const orgId = "org_test";
    const { clientId, projectionId } = await seedOrg(t, orgId);

    const manualIssueDate = Date.UTC(2026, 1, 10);
    const result = await t.withIdentity(identity(orgId)).action(
      api.functions.invoices.actions.upload,
      {
        clientId,
        projectionId,
        serviceName: "Servicio Test",
        month: 2,
        year: 2026,
        amount: 500,
        filename: "test.pdf",
        contentType: "application/pdf",
        fileBuffer: pdfBytes(),
        issueDate: manualIssueDate,
      }
    );

    await t.run(async (ctx) => {
      const inv = await ctx.db.get(result.invoiceId);
      expect(inv?.issueDate).toBe(manualIssueDate);
    });
  });

  it("XML wins when both xmlBuffer (valid) and manual issueDate provided", async () => {
    const t = setupTest();
    const orgId = "org_test";
    const { clientId, projectionId } = await seedOrg(t, orgId);

    const xmlBuffer = new TextEncoder().encode(CFDI_XML).buffer;
    const manualIssueDate = Date.UTC(2025, 11, 1); // Dec 2025 — should be overridden
    const result = await t.withIdentity(identity(orgId)).action(
      api.functions.invoices.actions.upload,
      {
        clientId,
        projectionId,
        serviceName: "Servicio Test",
        month: 1,
        year: 2026,
        amount: 1000,
        filename: "test.pdf",
        contentType: "application/pdf",
        fileBuffer: pdfBytes(),
        xmlBuffer,
        issueDate: manualIssueDate,
      }
    );

    const expectedXmlDate = Date.UTC(2026, 0, 15, 10, 30, 0);
    await t.run(async (ctx) => {
      const inv = await ctx.db.get(result.invoiceId);
      expect(inv?.issueDate).toBe(expectedXmlDate); // XML wins
    });
  });

  it("falls back to manual when xmlBuffer is malformed", async () => {
    const t = setupTest();
    const orgId = "org_test";
    const { clientId, projectionId } = await seedOrg(t, orgId);

    const malformedXml = new TextEncoder().encode("not xml at all <<<").buffer;
    const manualIssueDate = Date.UTC(2026, 2, 1);
    const result = await t.withIdentity(identity(orgId)).action(
      api.functions.invoices.actions.upload,
      {
        clientId,
        projectionId,
        serviceName: "Servicio Test",
        month: 3,
        year: 2026,
        amount: 250,
        filename: "test.pdf",
        contentType: "application/pdf",
        fileBuffer: pdfBytes(),
        xmlBuffer: malformedXml,
        issueDate: manualIssueDate,
      }
    );

    await t.run(async (ctx) => {
      const inv = await ctx.db.get(result.invoiceId);
      expect(inv?.issueDate).toBe(manualIssueDate);
    });
  });

  it("issueDate is undefined when neither xmlBuffer nor manual provided", async () => {
    const t = setupTest();
    const orgId = "org_test";
    const { clientId, projectionId } = await seedOrg(t, orgId);

    const result = await t.withIdentity(identity(orgId)).action(
      api.functions.invoices.actions.upload,
      {
        clientId,
        projectionId,
        serviceName: "Servicio Test",
        month: 4,
        year: 2026,
        amount: 100,
        filename: "test.pdf",
        contentType: "application/pdf",
        fileBuffer: pdfBytes(),
      }
    );

    await t.run(async (ctx) => {
      const inv = await ctx.db.get(result.invoiceId);
      expect(inv?.issueDate).toBeUndefined();
    });
  });
});
