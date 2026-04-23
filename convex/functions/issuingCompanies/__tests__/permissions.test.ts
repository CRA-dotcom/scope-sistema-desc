import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../__tests__/harness";

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

const base = {
  name: "Test",
  legalName: "Test S.A.",
  rfc: "TCO200101ABC",
  regimenFiscalCode: "601",
  codigoPostal: "11550",
  address: { street: "Uno", city: "CDMX", state: "CDMX", country: "México" },
  email: "t@t.mx",
};

describe("issuingCompanies permissions", () => {
  it("member puede list", async () => {
    const t = setupTest();
    await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.issuingCompanies.mutations.create, base);
    const result = await t
      .withIdentity(member(ORG_A))
      .query(api.functions.issuingCompanies.queries.list, {});
    expect(result.length).toBe(1);
  });

  it("member NO puede create", async () => {
    const t = setupTest();
    await expect(
      t
        .withIdentity(member(ORG_A))
        .mutation(api.functions.issuingCompanies.mutations.create, base)
    ).rejects.toThrow(/Administrador/i);
  });

  it("member NO puede update/setDefault/remove/assign", async () => {
    const t = setupTest();
    const id = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.issuingCompanies.mutations.create, base);
    await expect(
      t
        .withIdentity(member(ORG_A))
        .mutation(api.functions.issuingCompanies.mutations.update, {
          id,
          name: "x",
        })
    ).rejects.toThrow(/Administrador/i);
    await expect(
      t
        .withIdentity(member(ORG_A))
        .mutation(api.functions.issuingCompanies.mutations.setDefault, { id })
    ).rejects.toThrow(/Administrador/i);
    await expect(
      t
        .withIdentity(member(ORG_A))
        .mutation(api.functions.issuingCompanies.mutations.remove, { id })
    ).rejects.toThrow(/Administrador/i);
    await expect(
      t
        .withIdentity(member(ORG_A))
        .mutation(
          api.functions.issuingCompanies.mutations.assignServicesToCompany,
          { issuingCompanyId: id, serviceIds: [] }
        )
    ).rejects.toThrow(/Administrador/i);
  });

  it("member NO puede listAvailableServices (admin-only)", async () => {
    const t = setupTest();
    await expect(
      t
        .withIdentity(member(ORG_A))
        .query(api.functions.issuingCompanies.queries.listAvailableServices, {})
    ).rejects.toThrow(/Administrador/i);
  });

  it("member NO puede countReferences (admin-only)", async () => {
    const t = setupTest();
    const id = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.issuingCompanies.mutations.create, base);
    await expect(
      t
        .withIdentity(member(ORG_A))
        .query(api.functions.issuingCompanies.queries.countReferences, { id })
    ).rejects.toThrow(/Administrador/i);
  });
});
