import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";

/**
 * Seed fixtures for sprint v2 — 2 issuing companies + service map + 1 override.
 *
 * Run via:
 *   npx convex run seed:v2Fixtures '{"orgId":"<your-org-id>"}'
 *
 * Guards:
 *   - Refuses to run in production (NODE_ENV check).
 *   - Requires prerequisite data (services "Contable" & "Legal", client "ACME") in the target org.
 *   - Idempotent: wipes issuingCompanies + maps + overrides for this org before inserting.
 */
export const v2Fixtures = internalMutation({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    if (process.env.NODE_ENV === "production") {
      throw new Error("v2Fixtures no puede correr en producción");
    }

    // Prereqs
    const services = await ctx.db
      .query("services")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const contableService = services.find((s) =>
      s.name.toLowerCase().includes("contable")
    );
    const legalService = services.find((s) =>
      s.name.toLowerCase().includes("legal")
    );
    if (!contableService || !legalService) {
      throw new Error(
        `Faltan servicios "Contable" y/o "Legal" en la org ${orgId}. Ejecuta seedServices primero.`
      );
    }

    const clients = await ctx.db
      .query("clients")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const acme = clients.find((c) => c.name.toLowerCase() === "acme");
    if (!acme) {
      throw new Error(
        `Falta cliente "ACME" en la org ${orgId}. Ejecuta seedClients primero.`
      );
    }

    // Idempotency: wipe existing
    const existingCompanies = await ctx.db
      .query("issuingCompanies")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    for (const c of existingCompanies) {
      await ctx.db.delete(c._id);
    }
    const existingMaps = await ctx.db
      .query("servicesIssuingCompanyMap")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    for (const m of existingMaps) {
      await ctx.db.delete(m._id);
    }
    const existingOverrides = await ctx.db
      .query("clientIssuingCompanyOverride")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    for (const o of existingOverrides) {
      await ctx.db.delete(o._id);
    }

    const now = Date.now();

    // Company A — DESC Holding (default)
    const companyAId = await ctx.db.insert("issuingCompanies", {
      orgId,
      name: "DESC Holding",
      legalName: "DESC Holding S.A. de C.V.",
      rfc: "DHO200101ABC",
      regimenFiscalCode: "601",
      regimenFiscalLabel: "General de Ley Personas Morales",
      codigoPostal: "11550",
      address: {
        street: "Av. Reforma",
        exteriorNumber: "100",
        colonia: "Juárez",
        city: "Ciudad de México",
        state: "CDMX",
        country: "México",
      },
      email: "facturacion@desc-holding.mx",
      invoiceSerie: "DESC-A",
      signatoryName: "Christian Cover",
      signatoryTitle: "Director General",
      isDefault: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // Company B — DESC Contable
    const companyBId = await ctx.db.insert("issuingCompanies", {
      orgId,
      name: "DESC Contable",
      legalName: "DESC Contable y Asociados S.C.",
      rfc: "DCA210315XYZ",
      regimenFiscalCode: "603",
      regimenFiscalLabel: "Personas Morales con Fines No Lucrativos",
      codigoPostal: "11000",
      address: {
        street: "Palmas",
        exteriorNumber: "50",
        colonia: "Lomas",
        city: "Ciudad de México",
        state: "CDMX",
        country: "México",
      },
      email: "facturacion@desc-contable.mx",
      invoiceSerie: "DCA-B",
      signatoryName: "Christian Cover",
      signatoryTitle: "Socio Director",
      isDefault: false,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // Service map: Contable + Legal → B
    await ctx.db.insert("servicesIssuingCompanyMap", {
      orgId,
      serviceId: contableService._id,
      issuingCompanyId: companyBId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("servicesIssuingCompanyMap", {
      orgId,
      serviceId: legalService._id,
      issuingCompanyId: companyBId,
      createdAt: now,
      updatedAt: now,
    });

    // Override: ACME + Contable → A
    await ctx.db.insert("clientIssuingCompanyOverride", {
      orgId,
      clientId: acme._id,
      serviceId: contableService._id,
      issuingCompanyId: companyAId,
      reason:
        "ACME pidió que Contable lo facture DESC Holding (cuenta de prueba)",
      createdAt: now,
      updatedAt: now,
    });

    return {
      companies: { A: companyAId, B: companyBId },
      serviceMap: [
        { service: "Contable", company: companyBId },
        { service: "Legal", company: companyBId },
      ],
      overrides: [
        { client: "ACME", service: "Contable", company: companyAId },
      ],
    };
  },
});
