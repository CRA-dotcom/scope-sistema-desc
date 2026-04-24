import type { setupTest } from "../../../../../tests/harness";
import type { Id } from "../../../../_generated/dataModel";

type T = ReturnType<typeof setupTest>;

export async function seedClient(
  t: T,
  orgId: string,
  overrides: Partial<{
    name: string;
    rfc: string;
    industry: string;
    annualRevenue: number;
    assignedTo?: string;
    contactEmail?: string;
    contactName?: string;
  }> = {}
): Promise<Id<"clients">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("clients", {
      orgId,
      name: overrides.name ?? "Test Client",
      rfc: overrides.rfc ?? "TEST010101ABC",
      industry: overrides.industry ?? "Servicios",
      annualRevenue: overrides.annualRevenue ?? 1_000_000,
      billingFrequency: "mensual",
      isArchived: false,
      assignedTo: overrides.assignedTo,
      contactEmail: overrides.contactEmail,
      contactName: overrides.contactName,
      createdAt: Date.now(),
    });
  });
}

export async function seedQuotation(
  t: T,
  orgId: string,
  clientId: Id<"clients">,
  overrides: Partial<{
    status: "draft" | "sent" | "approved" | "rejected";
    pdfStorageId?: Id<"_storage">;
    accessTokenHash?: string;
    tokenExpiresAt?: number;
    sendCount?: number;
    projServiceId: Id<"projectionServices">;
  }> = {}
): Promise<Id<"quotations">> {
  return await t.run(async (ctx) => {
    let projServiceId = overrides.projServiceId;
    if (!projServiceId) {
      const projectionId = await ctx.db.insert("projections", {
        orgId,
        clientId,
        year: 2026,
        annualSales: 1_000_000,
        totalBudget: 100_000,
        commissionRate: 0.05,
        seasonalityData: [],
        status: "draft",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const serviceId = await ctx.db.insert("services", {
        name: "Contable",
        type: "base",
        minPct: 0,
        maxPct: 100,
        defaultPct: 10,
        isDefault: true,
        sortOrder: 0,
      });
      projServiceId = await ctx.db.insert("projectionServices", {
        orgId,
        projectionId,
        serviceId,
        serviceName: "Contable",
        chosenPct: 10,
        isActive: true,
        annualAmount: 100_000,
        normalizedWeight: 1,
      });
    }
    return await ctx.db.insert("quotations", {
      orgId,
      projServiceId,
      clientId,
      serviceName: "Contable",
      content: "<div>Cotización</div>",
      pdfStorageId: overrides.pdfStorageId,
      status: overrides.status ?? "draft",
      sendCount: overrides.sendCount,
      accessTokenHash: overrides.accessTokenHash,
      tokenExpiresAt: overrides.tokenExpiresAt,
      createdAt: Date.now(),
    });
  });
}
