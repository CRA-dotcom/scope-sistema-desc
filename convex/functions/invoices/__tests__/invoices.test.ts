import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTest, ORG_A, ORG_B } from "../../../../tests/harness";
import { api, internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

// ── blobStorage mock ──────────────────────────────────────────────────
// `upload` calls `uploadBlob` (Railway S3) which would otherwise fail in
// tests. The mock returns success unless a test calls `__triggerFail`.
const uploadBlobMock = vi.fn(
  async (args: { key: string; buffer: Uint8Array; contentType: string }) => ({
    bucketKey: args.key,
    etag: "test-etag",
  })
);
const signedDownloadUrlMock = vi.fn(
  async (_args: { bucketKey: string; expiresSec?: number }) =>
    "https://signed.example.test/file.pdf"
);

vi.mock("../../../lib/blobStorage", async (original) => {
  const mod = (await original()) as Record<string, unknown>;
  return {
    ...mod,
    uploadBlob: uploadBlobMock,
    signedDownloadUrl: signedDownloadUrlMock,
  };
});

// ── helpers ──────────────────────────────────────────────────────────
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

type Seeded = {
  clientId: Id<"clients">;
  projectionId: Id<"projections">;
  serviceId: Id<"services">;
  projServiceId: Id<"projectionServices">;
  subserviceId: Id<"subservices">;
  monthlyAssignmentId: Id<"monthlyAssignments">;
};

async function seedFixture(
  t: ReturnType<typeof setupTest>,
  orgId: string
): Promise<Seeded> {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId,
      name: "Acme SA",
      rfc: "ACM240115ABC",
      industry: "Servicios",
      annualRevenue: 1_000_000,
      billingFrequency: "mensual" as const,
      isArchived: false,
      contactEmail: "ops@acme.test",
      createdAt: Date.now(),
    });
    const projectionId = await ctx.db.insert("projections", {
      orgId,
      clientId,
      year: 2026,
      annualSales: 1_000_000,
      totalBudget: 100_000,
      commissionRate: 0,
      seasonalityData: [],
      status: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const serviceId = await ctx.db.insert("services", {
      orgId,
      name: "Marketing",
      type: "base" as const,
      minPct: 0.1,
      maxPct: 0.3,
      defaultPct: 0.18,
      isDefault: true,
      sortOrder: 1,
    });
    const subserviceId = await ctx.db.insert("subservices", {
      orgId,
      parentServiceId: serviceId,
      name: "Boletín Mensual",
      slug: "boletin-mensual",
      defaultFrequency: "mensual" as const,
      isActive: true,
      isDefault: true,
      sortOrder: 10,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const projServiceId = await ctx.db.insert("projectionServices", {
      orgId,
      projectionId,
      serviceId,
      serviceName: "Marketing",
      subserviceId,
      chosenPct: 0.18,
      isActive: true,
      annualAmount: 180_000,
      normalizedWeight: 0.18,
    });
    const monthlyAssignmentId = await ctx.db.insert("monthlyAssignments", {
      orgId,
      projServiceId,
      projectionId,
      clientId,
      serviceName: "Marketing",
      subserviceId,
      month: 5,
      year: 2026,
      amount: 15_000,
      feFactor: 1,
      status: "pending" as const,
      invoiceStatus: "not_invoiced" as const,
    });
    return {
      clientId,
      projectionId,
      serviceId,
      projServiceId,
      subserviceId,
      monthlyAssignmentId,
    };
  });
}

beforeEach(() => {
  uploadBlobMock.mockClear();
  signedDownloadUrlMock.mockClear();
  uploadBlobMock.mockResolvedValue({
    bucketKey: "ok",
    etag: "ok",
  });
});

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 fake-pdf-bytes").buffer;

describe("invoices.actions.upload", () => {
  it("happy path: inserts row, calls uploadBlob, emits uploaded event", async () => {
    const t = setupTest();
    const seed = await seedFixture(t, ORG_A);

    const result = await t
      .withIdentity(admin(ORG_A))
      .action(api.functions.invoices.actions.upload, {
        clientId: seed.clientId,
        projectionId: seed.projectionId,
        projServiceId: seed.projServiceId,
        subserviceId: seed.subserviceId,
        serviceName: "Marketing",
        monthlyAssignmentId: seed.monthlyAssignmentId,
        month: 5,
        year: 2026,
        amount: 15_000,
        filename: "factura.pdf",
        contentType: "application/pdf",
        fileBuffer: PDF_BYTES,
      });

    expect(result.invoiceId).toBeTruthy();
    expect(result.duplicateOf).toBeUndefined();
    expect(uploadBlobMock).toHaveBeenCalledOnce();

    const row = await t.run(async (ctx) => ctx.db.get(result.invoiceId));
    expect(row).toBeTruthy();
    expect(row!.status).toBe("uploaded");
    expect(row!.orgId).toBe(ORG_A);
    expect(row!.bucketKey.startsWith(`${ORG_A}/${seed.clientId}/invoices/`)).toBe(
      true
    );

    // Event log
    const events = await t.run(async (ctx) =>
      ctx.db.query("documentEvents").collect()
    );
    expect(events.some((e) => e.eventType === "uploaded")).toBe(true);
  });

  it("rejects non-PDF content type", async () => {
    const t = setupTest();
    const seed = await seedFixture(t, ORG_A);

    await expect(
      t.withIdentity(admin(ORG_A)).action(
        api.functions.invoices.actions.upload,
        {
          clientId: seed.clientId,
          projectionId: seed.projectionId,
          projServiceId: seed.projServiceId,
          subserviceId: seed.subserviceId,
          serviceName: "Marketing",
          monthlyAssignmentId: seed.monthlyAssignmentId,
          month: 5,
          year: 2026,
          amount: 15_000,
          filename: "factura.jpg",
          contentType: "image/jpeg",
          fileBuffer: PDF_BYTES,
        }
      )
    ).rejects.toThrow(/Solo PDFs/);

    expect(uploadBlobMock).not.toHaveBeenCalled();
    const rows = await t.run(async (ctx) =>
      ctx.db.query("invoices").collect()
    );
    expect(rows.length).toBe(0);
  });

  it("detects duplicate invoice for same client+year+month+subservice", async () => {
    const t = setupTest();
    const seed = await seedFixture(t, ORG_A);

    // Pre-insert an invoice manually.
    const previousId = await t.run(async (ctx) =>
      ctx.db.insert("invoices", {
        orgId: ORG_A,
        clientId: seed.clientId,
        projectionId: seed.projectionId,
        projServiceId: seed.projServiceId,
        subserviceId: seed.subserviceId,
        serviceName: "Marketing",
        monthlyAssignmentId: seed.monthlyAssignmentId,
        month: 5,
        year: 2026,
        amount: 15_000,
        bucketKey: "pre/existing.pdf",
        contentType: "application/pdf",
        sizeBytes: 1,
        filename: "previa.pdf",
        status: "uploaded" as const,
        uploadedAt: Date.now(),
        uploadedBy: "user_x",
        createdAt: Date.now(),
      })
    );

    const result = await t.withIdentity(admin(ORG_A)).action(
      api.functions.invoices.actions.upload,
      {
        clientId: seed.clientId,
        projectionId: seed.projectionId,
        projServiceId: seed.projServiceId,
        subserviceId: seed.subserviceId,
        serviceName: "Marketing",
        monthlyAssignmentId: seed.monthlyAssignmentId,
        month: 5,
        year: 2026,
        amount: 15_000,
        filename: "factura.pdf",
        contentType: "application/pdf",
        fileBuffer: PDF_BYTES,
      }
    );

    expect(result.duplicateOf).toBe(previousId);

    const events = await t.run(async (ctx) =>
      ctx.db.query("documentEvents").collect()
    );
    expect(
      events.some(
        (e) => e.severity === "warning" && e.eventType === "created"
      )
    ).toBe(true);
  });

  it("upload fails (bucket throws) → no row inserted", async () => {
    const t = setupTest();
    const seed = await seedFixture(t, ORG_A);

    uploadBlobMock.mockRejectedValueOnce(new Error("Railway down"));

    await expect(
      t.withIdentity(admin(ORG_A)).action(
        api.functions.invoices.actions.upload,
        {
          clientId: seed.clientId,
          projectionId: seed.projectionId,
          projServiceId: seed.projServiceId,
          subserviceId: seed.subserviceId,
          serviceName: "Marketing",
          monthlyAssignmentId: seed.monthlyAssignmentId,
          month: 5,
          year: 2026,
          amount: 15_000,
          filename: "factura.pdf",
          contentType: "application/pdf",
          fileBuffer: PDF_BYTES,
        }
      )
    ).rejects.toThrow(/Railway down/);

    const rows = await t.run(async (ctx) =>
      ctx.db.query("invoices").collect()
    );
    expect(rows.length).toBe(0);
  });
});

describe("invoices.mutations.markSent", () => {
  it("emits sent event without mutating status", async () => {
    const t = setupTest();
    const seed = await seedFixture(t, ORG_A);

    const invoiceId = await t.run(async (ctx) =>
      ctx.db.insert("invoices", {
        orgId: ORG_A,
        clientId: seed.clientId,
        projectionId: seed.projectionId,
        projServiceId: seed.projServiceId,
        subserviceId: seed.subserviceId,
        serviceName: "Marketing",
        monthlyAssignmentId: seed.monthlyAssignmentId,
        month: 5,
        year: 2026,
        amount: 15_000,
        bucketKey: "a/b.pdf",
        contentType: "application/pdf",
        sizeBytes: 1,
        filename: "factura.pdf",
        status: "uploaded" as const,
        uploadedAt: Date.now(),
        uploadedBy: "u",
        createdAt: Date.now(),
      })
    );

    await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.invoices.mutations.markSent, { invoiceId });

    const row = await t.run(async (ctx) => ctx.db.get(invoiceId));
    expect(row!.status).toBe("uploaded");

    const events = await t.run(async (ctx) =>
      ctx.db.query("documentEvents").collect()
    );
    expect(events.some((e) => e.eventType === "sent")).toBe(true);
  });
});

describe("invoices.mutations.markPaid", () => {
  it("patches status=paid, schedules generateFromInvoice", async () => {
    const t = setupTest();
    const seed = await seedFixture(t, ORG_A);

    const invoiceId = await t.run(async (ctx) =>
      ctx.db.insert("invoices", {
        orgId: ORG_A,
        clientId: seed.clientId,
        projectionId: seed.projectionId,
        projServiceId: seed.projServiceId,
        subserviceId: seed.subserviceId,
        serviceName: "Marketing",
        monthlyAssignmentId: seed.monthlyAssignmentId,
        month: 5,
        year: 2026,
        amount: 15_000,
        bucketKey: "a/b.pdf",
        contentType: "application/pdf",
        sizeBytes: 1,
        filename: "factura.pdf",
        status: "uploaded" as const,
        uploadedAt: Date.now(),
        uploadedBy: "u",
        createdAt: Date.now(),
      })
    );

    const result = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.invoices.mutations.markPaid, { invoiceId });
    expect(result.alreadyPaid).toBe(false);

    const row = await t.run(async (ctx) => ctx.db.get(invoiceId));
    expect(row!.status).toBe("paid");
    expect(row!.paidAt).toBeTruthy();

    // Scheduler should have queued a generateFromInvoice job whose first
    // argument references the invoice id.
    const scheduled = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect()
    );
    expect(
      scheduled.some(
        (s: { args?: unknown[] }) =>
          Array.isArray(s.args) &&
          (s.args[0] as { invoiceId?: string } | undefined)?.invoiceId ===
            invoiceId
      )
    ).toBe(true);

    // monthlyAssignments.invoiceStatus is synced to "paid"
    const ma = await t.run(async (ctx) =>
      ctx.db.get(seed.monthlyAssignmentId)
    );
    expect(ma!.invoiceStatus).toBe("paid");
  });

  it("idempotent: second call returns alreadyPaid=true, no double-schedule", async () => {
    const t = setupTest();
    const seed = await seedFixture(t, ORG_A);

    const invoiceId = await t.run(async (ctx) =>
      ctx.db.insert("invoices", {
        orgId: ORG_A,
        clientId: seed.clientId,
        projectionId: seed.projectionId,
        projServiceId: seed.projServiceId,
        subserviceId: seed.subserviceId,
        serviceName: "Marketing",
        monthlyAssignmentId: seed.monthlyAssignmentId,
        month: 5,
        year: 2026,
        amount: 15_000,
        bucketKey: "a/b.pdf",
        contentType: "application/pdf",
        sizeBytes: 1,
        filename: "factura.pdf",
        status: "uploaded" as const,
        uploadedAt: Date.now(),
        uploadedBy: "u",
        createdAt: Date.now(),
      })
    );

    await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.invoices.mutations.markPaid, { invoiceId });
    const second = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.invoices.mutations.markPaid, { invoiceId });
    expect(second.alreadyPaid).toBe(true);

    const scheduled = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect()
    );
    const genJobs = scheduled.filter(
      (s: { args?: unknown[] }) =>
        Array.isArray(s.args) &&
        (s.args[0] as { invoiceId?: string } | undefined)?.invoiceId ===
          invoiceId
    );
    expect(genJobs.length).toBe(1);
  });

  it("multi-tenant: orgB cannot markPaid invoice belonging to orgA", async () => {
    const t = setupTest();
    const seed = await seedFixture(t, ORG_A);

    const invoiceId = await t.run(async (ctx) =>
      ctx.db.insert("invoices", {
        orgId: ORG_A,
        clientId: seed.clientId,
        projectionId: seed.projectionId,
        projServiceId: seed.projServiceId,
        subserviceId: seed.subserviceId,
        serviceName: "Marketing",
        monthlyAssignmentId: seed.monthlyAssignmentId,
        month: 5,
        year: 2026,
        amount: 15_000,
        bucketKey: "a/b.pdf",
        contentType: "application/pdf",
        sizeBytes: 1,
        filename: "factura.pdf",
        status: "uploaded" as const,
        uploadedAt: Date.now(),
        uploadedBy: "u",
        createdAt: Date.now(),
      })
    );

    await expect(
      t
        .withIdentity(admin(ORG_B))
        .mutation(api.functions.invoices.mutations.markPaid, { invoiceId })
    ).rejects.toThrow(/no encontrada/i);

    const row = await t.run(async (ctx) => ctx.db.get(invoiceId));
    expect(row!.status).toBe("uploaded");
  });
});
