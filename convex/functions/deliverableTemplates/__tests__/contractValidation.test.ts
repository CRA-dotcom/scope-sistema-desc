import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import { setupTest, ORG_A } from "../../../../tests/harness";

function admin(orgId: string) {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `user_admin_${orgId}`,
    orgId,
    orgRole: "org:admin" as const,
  };
}

describe("deliverableTemplates contract validation", () => {
  it("rejects type='contract' without issuingCompanyId", async () => {
    const t = setupTest();
    let subId: Id<"subservices">;
    await t.run(async (ctx) => {
      const svcId = await ctx.db.insert("services", {
        orgId: ORG_A,
        name: "Legal",
        type: "base" as const,
        minPct: 0.01,
        maxPct: 0.03,
        defaultPct: 0.02,
        isDefault: true,
        sortOrder: 1,
      });
      subId = await ctx.db.insert("subservices", {
        orgId: ORG_A,
        parentServiceId: svcId,
        name: "Asesoría Legal",
        slug: "asesoria-legal",
        defaultFrequency: "mensual" as const,
        isActive: true,
        isDefault: false,
        sortOrder: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await expect(
      t
        .withIdentity(admin(ORG_A))
        .mutation(api.functions.deliverableTemplates.mutations.create, {
          type: "contract",
          serviceName: "Legal",
          subserviceId: subId!,
          name: "Contrato Legal",
          htmlTemplate: "<p>{{cliente_nombre}}</p>",
          variables: [
            {
              key: "cliente_nombre",
              label: "Nombre",
              source: "client" as const,
              required: true,
            },
          ],
          isActive: true,
        }),
    ).rejects.toThrow(/issuingCompanyId/i);
  });

  it("rejects type='deliverable_long' with issuingCompanyId set", async () => {
    const t = setupTest();
    let companyId: Id<"issuingCompanies">;
    await t.run(async (ctx) => {
      companyId = await ctx.db.insert("issuingCompanies", {
        orgId: ORG_A,
        name: "Despacho X",
        legalName: "Despacho X SA",
        rfc: "DXX900101AAA",
        regimenFiscalCode: "601",
        codigoPostal: "64000",
        address: {
          street: "Av X",
          city: "Monterrey",
          state: "NL",
          country: "MX",
        },
        email: "x@x.com",
        isDefault: true,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await expect(
      t
        .withIdentity(admin(ORG_A))
        .mutation(api.functions.deliverableTemplates.mutations.create, {
          type: "deliverable_long",
          serviceName: "Legal",
          name: "Reporte legal",
          htmlTemplate: "<p>hi</p>",
          variables: [],
          issuingCompanyId: companyId!,
          isActive: true,
        }),
    ).rejects.toThrow(/issuingCompanyId/i);
  });

  it("accepts type='contract' with valid issuingCompanyId + subserviceId", async () => {
    const t = setupTest();
    let companyId: Id<"issuingCompanies">;
    let subId: Id<"subservices">;
    await t.run(async (ctx) => {
      const svcId = await ctx.db.insert("services", {
        orgId: ORG_A,
        name: "Legal",
        type: "base" as const,
        minPct: 0.01,
        maxPct: 0.03,
        defaultPct: 0.02,
        isDefault: true,
        sortOrder: 1,
      });
      companyId = await ctx.db.insert("issuingCompanies", {
        orgId: ORG_A,
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
        orgId: ORG_A,
        parentServiceId: svcId,
        name: "AL",
        slug: "al",
        defaultFrequency: "mensual" as const,
        isActive: true,
        isDefault: false,
        sortOrder: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const id = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.deliverableTemplates.mutations.create, {
        type: "contract",
        serviceName: "Legal",
        subserviceId: subId!,
        issuingCompanyId: companyId!,
        name: "Contrato Legal",
        htmlTemplate: "<p>{{cliente_nombre}}</p>",
        variables: [
          {
            key: "cliente_nombre",
            label: "Nombre",
            source: "client" as const,
            required: true,
          },
        ],
        isActive: true,
      });
    expect(id).toBeTruthy();
  });
});
