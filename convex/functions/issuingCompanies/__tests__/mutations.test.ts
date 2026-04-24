import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import { setupTest, ORG_A, ORG_B } from "../../../../tests/harness";

function withAdmin(orgId: string) {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `user_admin_${orgId}`,
    orgId,
    orgRole: "org:admin",
  };
}

const base = {
  name: "Test Co",
  legalName: "Test Co S.A. de C.V.",
  rfc: "TCO200101ABC",
  regimenFiscalCode: "601",
  codigoPostal: "11550",
  address: {
    street: "Av. Uno",
    city: "CDMX",
    state: "CDMX",
    country: "México",
  },
  email: "test@test.mx",
};

describe("issuingCompanies.mutations", () => {
  it("first empresa activa en la org es isDefault=true automáticamente", async () => {
    const t = setupTest();
    const id = await t
      .withIdentity(withAdmin(ORG_A))
      .mutation(api.functions.issuingCompanies.mutations.create, base);
    const doc = await t.run(async (ctx) => ctx.db.get(id));
    expect(doc?.isDefault).toBe(true);
  });

  it("segunda empresa en la org entra con isDefault=false", async () => {
    const t = setupTest();
    await t
      .withIdentity(withAdmin(ORG_A))
      .mutation(api.functions.issuingCompanies.mutations.create, base);
    const id2 = await t
      .withIdentity(withAdmin(ORG_A))
      .mutation(api.functions.issuingCompanies.mutations.create, {
        ...base,
        name: "Second",
        legalName: "Second S.A.",
        rfc: "SEC200101XYZ",
        email: "s@s.mx",
      });
    const doc2 = await t.run(async (ctx) => ctx.db.get(id2));
    expect(doc2?.isDefault).toBe(false);
  });

  it("RFC duplicado en misma org lanza", async () => {
    const t = setupTest();
    await t
      .withIdentity(withAdmin(ORG_A))
      .mutation(api.functions.issuingCompanies.mutations.create, base);
    await expect(
      t
        .withIdentity(withAdmin(ORG_A))
        .mutation(api.functions.issuingCompanies.mutations.create, {
          ...base,
          name: "Clone",
        })
    ).rejects.toThrow(/RFC/i);
  });

  it("RFC duplicado en otra org es OK (multi-tenant isolation)", async () => {
    const t = setupTest();
    await t
      .withIdentity(withAdmin(ORG_A))
      .mutation(api.functions.issuingCompanies.mutations.create, base);
    const idB = await t
      .withIdentity(withAdmin(ORG_B))
      .mutation(api.functions.issuingCompanies.mutations.create, base);
    expect(idB).toBeDefined();
  });

  it("setDefault: pone la nueva en true y la anterior en false", async () => {
    const t = setupTest();
    const id1 = await t
      .withIdentity(withAdmin(ORG_A))
      .mutation(api.functions.issuingCompanies.mutations.create, base);
    const id2 = await t
      .withIdentity(withAdmin(ORG_A))
      .mutation(api.functions.issuingCompanies.mutations.create, {
        ...base,
        name: "Second",
        legalName: "Second S.A.",
        rfc: "SEC200101XYZ",
        email: "s@s.mx",
      });
    await t
      .withIdentity(withAdmin(ORG_A))
      .mutation(api.functions.issuingCompanies.mutations.setDefault, { id: id2 });
    const d1 = await t.run(async (ctx) => ctx.db.get(id1));
    const d2 = await t.run(async (ctx) => ctx.db.get(id2));
    expect(d1?.isDefault).toBe(false);
    expect(d2?.isDefault).toBe(true);
  });

  it("update isActive=false sobre default lanza", async () => {
    const t = setupTest();
    const id = await t
      .withIdentity(withAdmin(ORG_A))
      .mutation(api.functions.issuingCompanies.mutations.create, base);
    await expect(
      t
        .withIdentity(withAdmin(ORG_A))
        .mutation(api.functions.issuingCompanies.mutations.update, {
          id,
          isActive: false,
        })
    ).rejects.toThrow(/default/i);
  });

  it("remove sobre default lanza", async () => {
    const t = setupTest();
    const id = await t
      .withIdentity(withAdmin(ORG_A))
      .mutation(api.functions.issuingCompanies.mutations.create, base);
    await expect(
      t
        .withIdentity(withAdmin(ORG_A))
        .mutation(api.functions.issuingCompanies.mutations.remove, { id })
    ).rejects.toThrow(/default/i);
  });

  it("remove sin referencias elimina", async () => {
    const t = setupTest();
    const id1 = await t
      .withIdentity(withAdmin(ORG_A))
      .mutation(api.functions.issuingCompanies.mutations.create, base);
    const id2 = await t
      .withIdentity(withAdmin(ORG_A))
      .mutation(api.functions.issuingCompanies.mutations.create, {
        ...base,
        name: "Second",
        legalName: "Second S.A.",
        rfc: "SEC200101XYZ",
        email: "s@s.mx",
      });
    await t
      .withIdentity(withAdmin(ORG_A))
      .mutation(api.functions.issuingCompanies.mutations.remove, { id: id2 });
    const gone = await t.run(async (ctx) => ctx.db.get(id2));
    expect(gone).toBeNull();
    const still = await t.run(async (ctx) => ctx.db.get(id1));
    expect(still).not.toBeNull();
  });
});
