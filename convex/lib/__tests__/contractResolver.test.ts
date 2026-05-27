import { describe, it, expect } from "vitest";
import type { Id } from "../../_generated/dataModel";
import { setupTest } from "../../../tests/harness";
import { findContractTemplate } from "../contractResolver";

// Seed a minimal service row and return its Id so subservices have a valid parentServiceId.
async function seedService(
  ctx: { db: { insert: (table: string, doc: object) => Promise<Id<"services">> } },
  orgId?: string
): Promise<Id<"services">> {
  return ctx.db.insert("services", {
    orgId,
    name: "Test Service",
    type: "base" as const,
    minPct: 0.05,
    maxPct: 0.3,
    defaultPct: 0.1,
    isDefault: true,
    sortOrder: 0,
  }) as Promise<Id<"services">>;
}

describe("findContractTemplate", () => {
  it("returns exact match by (orgId, type, issuingCompanyId, subserviceId)", async () => {
    const t = setupTest();
    const orgId = "org_1";
    let companyId: Id<"issuingCompanies">;
    let subId: Id<"subservices">;
    let templateId: Id<"deliverableTemplates">;

    await t.run(async (ctx) => {
      const serviceId = await ctx.db.insert("services", {
        orgId,
        name: "Legal",
        type: "base" as const,
        minPct: 0.05,
        maxPct: 0.3,
        defaultPct: 0.1,
        isDefault: true,
        sortOrder: 0,
      });
      companyId = await ctx.db.insert("issuingCompanies", {
        orgId,
        name: "DX",
        legalName: "DX SA",
        rfc: "DXX900101AAA",
        regimenFiscalCode: "601",
        codigoPostal: "64000",
        address: { street: "Av", city: "MTY", state: "NL", country: "MX" },
        email: "x@x.com",
        isDefault: true,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      subId = await ctx.db.insert("subservices", {
        orgId,
        parentServiceId: serviceId,
        name: "AL",
        slug: "al",
        defaultFrequency: "mensual" as const,
        isDefault: false,
        sortOrder: 0,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      templateId = await ctx.db.insert("deliverableTemplates", {
        orgId,
        type: "contract" as const,
        serviceName: "Legal",
        subserviceId: subId,
        issuingCompanyId: companyId,
        name: "Contrato Legal",
        htmlTemplate: "<p>x</p>",
        variables: [],
        version: 1,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const result = await t.run(async (ctx) =>
      findContractTemplate(ctx, {
        orgId,
        issuingCompanyId: companyId!,
        subserviceId: subId!,
      })
    );

    expect(result?._id).toBe(templateId!);
  });

  it("returns null when no match exists", async () => {
    const t = setupTest();
    let fakeCompanyId: Id<"issuingCompanies">;
    let fakeSubId: Id<"subservices">;

    await t.run(async (ctx) => {
      const serviceId = await ctx.db.insert("services", {
        orgId: "org_other",
        name: "Other",
        type: "base" as const,
        minPct: 0.05,
        maxPct: 0.3,
        defaultPct: 0.1,
        isDefault: false,
        sortOrder: 0,
      });
      fakeCompanyId = await ctx.db.insert("issuingCompanies", {
        orgId: "org_other",
        name: "Y",
        legalName: "Y SA",
        rfc: "YYY900101AAA",
        regimenFiscalCode: "601",
        codigoPostal: "00000",
        address: { street: "x", city: "x", state: "x", country: "MX" },
        email: "y@y.com",
        isDefault: false,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      fakeSubId = await ctx.db.insert("subservices", {
        orgId: "org_other",
        parentServiceId: serviceId,
        name: "Y",
        slug: "y",
        defaultFrequency: "mensual" as const,
        isDefault: false,
        sortOrder: 0,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const result = await t.run(async (ctx) =>
      findContractTemplate(ctx, {
        orgId: "org_1",
        issuingCompanyId: fakeCompanyId!,
        subserviceId: fakeSubId!,
      })
    );

    expect(result).toBeNull();
  });

  it("does NOT fall back to global (orgId=undefined) — contracts are org-scoped only", async () => {
    const t = setupTest();
    const orgId = "org_1";
    let companyId: Id<"issuingCompanies">;
    let subId: Id<"subservices">;

    await t.run(async (ctx) => {
      const serviceId = await ctx.db.insert("services", {
        orgId,
        name: "Legal",
        type: "base" as const,
        minPct: 0.05,
        maxPct: 0.3,
        defaultPct: 0.1,
        isDefault: true,
        sortOrder: 0,
      });
      companyId = await ctx.db.insert("issuingCompanies", {
        orgId,
        name: "DX",
        legalName: "DX SA",
        rfc: "DXX900101AAA",
        regimenFiscalCode: "601",
        codigoPostal: "64000",
        address: { street: "Av", city: "MTY", state: "NL", country: "MX" },
        email: "x@x.com",
        isDefault: true,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      subId = await ctx.db.insert("subservices", {
        orgId,
        parentServiceId: serviceId,
        name: "AL",
        slug: "al",
        defaultFrequency: "mensual" as const,
        isDefault: false,
        sortOrder: 0,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      // Insert a global template — resolver should ignore it (no issuingCompanyId)
      await ctx.db.insert("deliverableTemplates", {
        orgId: undefined,
        type: "contract" as const,
        serviceName: "Legal",
        subserviceId: subId,
        name: "Global",
        htmlTemplate: "<p>x</p>",
        variables: [],
        version: 1,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const result = await t.run(async (ctx) =>
      findContractTemplate(ctx, {
        orgId,
        issuingCompanyId: companyId!,
        subserviceId: subId!,
      })
    );

    expect(result).toBeNull();
  });

  it("returns the highest-version active template when multiple exist", async () => {
    const t = setupTest();
    const orgId = "org_versions";
    let companyId: Id<"issuingCompanies">;
    let subId: Id<"subservices">;
    let newerTemplateId: Id<"deliverableTemplates">;

    await t.run(async (ctx) => {
      const serviceId = await ctx.db.insert("services", {
        orgId,
        name: "Legal",
        type: "base" as const,
        minPct: 0.05,
        maxPct: 0.3,
        defaultPct: 0.1,
        isDefault: true,
        sortOrder: 0,
      });
      companyId = await ctx.db.insert("issuingCompanies", {
        orgId,
        name: "Versioned Co",
        legalName: "Versioned Co SA",
        rfc: "VRS900101AAA",
        regimenFiscalCode: "601",
        codigoPostal: "64000",
        address: { street: "Av", city: "MTY", state: "NL", country: "MX" },
        email: "v@v.com",
        isDefault: true,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      subId = await ctx.db.insert("subservices", {
        orgId,
        parentServiceId: serviceId,
        name: "SVC",
        slug: "svc",
        defaultFrequency: "mensual" as const,
        isDefault: false,
        sortOrder: 0,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      // Insert version 1 (older)
      await ctx.db.insert("deliverableTemplates", {
        orgId,
        type: "contract" as const,
        serviceName: "Legal",
        subserviceId: subId,
        issuingCompanyId: companyId,
        name: "Contrato v1",
        htmlTemplate: "<p>v1</p>",
        variables: [],
        version: 1,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      // Insert version 2 (newer)
      newerTemplateId = await ctx.db.insert("deliverableTemplates", {
        orgId,
        type: "contract" as const,
        serviceName: "Legal",
        subserviceId: subId,
        issuingCompanyId: companyId,
        name: "Contrato v2",
        htmlTemplate: "<p>v2</p>",
        variables: [],
        version: 2,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const result = await t.run(async (ctx) =>
      findContractTemplate(ctx, {
        orgId,
        issuingCompanyId: companyId!,
        subserviceId: subId!,
      })
    );

    expect(result?._id).toBe(newerTemplateId!);
    expect(result?.version).toBe(2);
  });

  it("skips inactive templates", async () => {
    const t = setupTest();
    const orgId = "org_inactive";
    let companyId: Id<"issuingCompanies">;
    let subId: Id<"subservices">;

    await t.run(async (ctx) => {
      const serviceId = await ctx.db.insert("services", {
        orgId,
        name: "Legal",
        type: "base" as const,
        minPct: 0.05,
        maxPct: 0.3,
        defaultPct: 0.1,
        isDefault: true,
        sortOrder: 0,
      });
      companyId = await ctx.db.insert("issuingCompanies", {
        orgId,
        name: "Inactive Co",
        legalName: "Inactive Co SA",
        rfc: "INC900101AAA",
        regimenFiscalCode: "601",
        codigoPostal: "64000",
        address: { street: "Av", city: "MTY", state: "NL", country: "MX" },
        email: "i@i.com",
        isDefault: true,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      subId = await ctx.db.insert("subservices", {
        orgId,
        parentServiceId: serviceId,
        name: "INC",
        slug: "inc",
        defaultFrequency: "mensual" as const,
        isDefault: false,
        sortOrder: 0,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      // Only an inactive template
      await ctx.db.insert("deliverableTemplates", {
        orgId,
        type: "contract" as const,
        serviceName: "Legal",
        subserviceId: subId,
        issuingCompanyId: companyId,
        name: "Contrato inactivo",
        htmlTemplate: "<p>old</p>",
        variables: [],
        version: 1,
        isActive: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const result = await t.run(async (ctx) =>
      findContractTemplate(ctx, {
        orgId,
        issuingCompanyId: companyId!,
        subserviceId: subId!,
      })
    );

    expect(result).toBeNull();
  });
});
