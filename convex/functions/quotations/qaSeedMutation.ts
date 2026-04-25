import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import type { Id } from "../../_generated/dataModel";

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * QA-only V8 mutation invoked by qaSeed.ts. Inserts a quotation row plus
 * minimum-required ancestors (client, projection, projService, default
 * issuingCompany) so the public landing query resolves correctly.
 *
 * Idempotent on `tokenHash` — any prior row with the same hash is deleted
 * first. Refuses to run in production.
 */
export const insertSeedRow = internalMutation({
  args: {
    orgId: v.string(),
    tokenHash: v.string(),
    status: v.union(
      v.literal("sent"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("sent_expired")
    ),
    declineReason: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ quotationId: Id<"quotations"> }> => {
    if (process.env.QA_SEED_ALLOWED !== "true") {
      throw new Error(
        "insertSeedRow is QA-only and requires QA_SEED_ALLOWED=true."
      );
    }

    // Idempotent: clean up any prior seed row with the same hash
    const existing = await ctx.db
      .query("quotations")
      .withIndex("by_accessTokenHash", (q) =>
        q.eq("accessTokenHash", args.tokenHash)
      )
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }

    // Seed minimum required ancestors so the landing query works.
    let clientId: Id<"clients"> | undefined = await ctx.db
      .query("clients")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .first()
      .then((c) => c?._id);
    if (!clientId) {
      clientId = await ctx.db.insert("clients", {
        orgId: args.orgId,
        name: "Cliente QA",
        rfc: "QAA010101AAA",
        industry: "Servicios",
        annualRevenue: 1_000_000,
        billingFrequency: "mensual",
        isArchived: false,
        contactEmail: "qa@ejemplo.mx",
        contactName: "Contacto QA",
        createdAt: Date.now(),
      });
    }

    let serviceId: Id<"services"> | undefined = await ctx.db
      .query("services")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .first()
      .then((s) => s?._id);
    if (!serviceId) {
      serviceId = await ctx.db.insert("services", {
        orgId: args.orgId,
        name: "QA Service",
        type: "base",
        minPct: 5,
        maxPct: 15,
        defaultPct: 10,
        isDefault: true,
        sortOrder: 1,
      });
    }

    let projectionId: Id<"projections"> | undefined = await ctx.db
      .query("projections")
      .withIndex("by_clientId", (q) => q.eq("clientId", clientId!))
      .first()
      .then((p) => p?._id);
    if (!projectionId) {
      projectionId = await ctx.db.insert("projections", {
        orgId: args.orgId,
        clientId: clientId!,
        year: new Date().getFullYear(),
        annualSales: 1_000_000,
        totalBudget: 100_000,
        commissionRate: 0,
        seasonalityData: [],
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    const projServiceId = await ctx.db.insert("projectionServices", {
      orgId: args.orgId,
      projectionId,
      serviceId: serviceId!,
      serviceName: "QA Service",
      chosenPct: 10,
      annualAmount: 10_000,
      isActive: true,
      normalizedWeight: 1,
    });

    // Default issuing company (only created if none exists for this org).
    const existingCompany = await ctx.db
      .query("issuingCompanies")
      .withIndex("by_orgId_isDefault", (q) =>
        q.eq("orgId", args.orgId).eq("isDefault", true)
      )
      .first();
    if (!existingCompany) {
      await ctx.db.insert("issuingCompanies", {
        orgId: args.orgId,
        name: "Empresa QA",
        legalName: "Empresa QA S.A.",
        rfc: "EQA200101ABC",
        regimenFiscalCode: "601",
        codigoPostal: "00000",
        address: {
          street: "Calle 1",
          city: "CDMX",
          state: "CDMX",
          country: "MX",
        },
        email: "contacto@ejemplo.mx",
        isDefault: true,
        isActive: true,
        signatoryName: "Lic. QA",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    const isExpired = args.status === "sent_expired";
    const actualStatus: "sent" | "approved" | "rejected" = isExpired
      ? "sent"
      : args.status;
    const tokenExpiresAt = isExpired
      ? Date.now() - 60_000
      : Date.now() + TOKEN_TTL_MS;

    const content = `<div style="padding: 20px; font-family: Arial, sans-serif;">
  <h1 style="color: #1a1a2e;">Cotización QA</h1>
  <p>Esta es una cotización generada para fines de QA.</p>
  <table style="width: 100%; margin-top: 16px; border-collapse: collapse;">
    <thead><tr style="background: #f5f5ff;"><th style="padding: 10px; border: 1px solid #ddd;">Concepto</th><th style="padding: 10px; border: 1px solid #ddd;">Monto</th></tr></thead>
    <tbody>
      <tr><td style="padding: 10px; border: 1px solid #ddd;">Inversión anual</td><td style="padding: 10px; border: 1px solid #ddd;">$120,000.00 MXN</td></tr>
      <tr><td style="padding: 10px; border: 1px solid #ddd;">Inversión mensual</td><td style="padding: 10px; border: 1px solid #ddd;">$10,000.00 MXN</td></tr>
    </tbody>
  </table>
  <p style="margin-top: 20px; color: #666;">Vigencia: 30 días naturales.</p>
</div>`;

    const quotationId = await ctx.db.insert("quotations", {
      orgId: args.orgId,
      projServiceId,
      clientId: clientId!,
      serviceName: "QA Service — Cotización de prueba",
      content,
      status: actualStatus,
      sendCount: 1,
      lastSentAt: Date.now(),
      accessTokenHash: args.tokenHash,
      tokenIssuedAt: Date.now(),
      tokenExpiresAt,
      respondedAt:
        actualStatus === "approved" || actualStatus === "rejected"
          ? Date.now()
          : undefined,
      declineReason: args.declineReason,
      createdAt: Date.now(),
    });

    return { quotationId };
  },
});
