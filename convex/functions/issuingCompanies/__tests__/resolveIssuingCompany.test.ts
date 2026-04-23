import { describe, it, expect } from "vitest";

type MockDoc = { _id: string; [k: string]: unknown };

interface IndexQ {
  eq: (f: string, v: unknown) => IndexQ;
}

function makeCtx(docs: {
  issuingCompanies: MockDoc[];
  servicesIssuingCompanyMap: MockDoc[];
  clientIssuingCompanyOverride: MockDoc[];
}) {
  const store: Record<string, MockDoc[]> = {
    issuingCompanies: docs.issuingCompanies,
    servicesIssuingCompanyMap: docs.servicesIssuingCompanyMap,
    clientIssuingCompanyOverride: docs.clientIssuingCompanyOverride,
  };

  function queryBuilder(tableName: string) {
    let rows = [...(store[tableName] ?? [])];
    const api = {
      withIndex: (_name: string, fn: (q: IndexQ) => IndexQ) => {
        const filters: Array<(r: MockDoc) => boolean> = [];
        const q: IndexQ = {
          eq(field: string, value: unknown) {
            filters.push((r) => r[field] === value);
            return q;
          },
        };
        fn(q);
        rows = rows.filter((r) => filters.every((f) => f(r)));
        return api;
      },
      async first() {
        return rows[0] ?? null;
      },
      async collect() {
        return rows;
      },
    };
    return api;
  }

  return {
    db: {
      query: (tableName: string) => queryBuilder(tableName),
      get: async (id: string) => {
        for (const t of Object.values(store)) {
          const hit = t.find((r) => r._id === id);
          if (hit) return hit;
        }
        return null;
      },
    },
  };
}

import { resolveIssuingCompany, NoIssuingCompanyError } from "../resolve";

describe("resolveIssuingCompany", () => {
  const orgId = "org_A";
  const clientId = "client_1";
  const serviceId = "service_1";

  it("returns override when client override is present and active", async () => {
    const ctx = makeCtx({
      issuingCompanies: [
        { _id: "company_A", orgId, name: "A", isActive: true, isDefault: true },
        { _id: "company_B", orgId, name: "B", isActive: true, isDefault: false },
      ],
      servicesIssuingCompanyMap: [{ _id: "m1", orgId, serviceId, issuingCompanyId: "company_B" }],
      clientIssuingCompanyOverride: [
        { _id: "o1", orgId, clientId, serviceId, issuingCompanyId: "company_A" },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await resolveIssuingCompany(ctx as any, { orgId, clientId: clientId as any, serviceId: serviceId as any });
    expect(res.source).toBe("client_override");
    expect(res.issuingCompany._id).toBe("company_A");
  });

  it("falls back to service map when no override", async () => {
    const ctx = makeCtx({
      issuingCompanies: [
        { _id: "company_A", orgId, name: "A", isActive: true, isDefault: true },
        { _id: "company_B", orgId, name: "B", isActive: true, isDefault: false },
      ],
      servicesIssuingCompanyMap: [{ _id: "m1", orgId, serviceId, issuingCompanyId: "company_B" }],
      clientIssuingCompanyOverride: [],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await resolveIssuingCompany(ctx as any, { orgId, clientId: clientId as any, serviceId: serviceId as any });
    expect(res.source).toBe("service_map");
    expect(res.issuingCompany._id).toBe("company_B");
  });

  it("falls back to org default when no override and no service map", async () => {
    const ctx = makeCtx({
      issuingCompanies: [
        { _id: "company_A", orgId, name: "A", isActive: true, isDefault: true },
      ],
      servicesIssuingCompanyMap: [],
      clientIssuingCompanyOverride: [],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await resolveIssuingCompany(ctx as any, { orgId, clientId: clientId as any, serviceId: serviceId as any });
    expect(res.source).toBe("org_default");
    expect(res.issuingCompany._id).toBe("company_A");
  });

  it("throws NoIssuingCompanyError when no active company exists", async () => {
    const ctx = makeCtx({
      issuingCompanies: [],
      servicesIssuingCompanyMap: [],
      clientIssuingCompanyOverride: [],
    });
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolveIssuingCompany(ctx as any, { orgId, clientId: clientId as any, serviceId: serviceId as any })
    ).rejects.toBeInstanceOf(NoIssuingCompanyError);
  });

  it("degrades from override to service_map when override points to inactive company", async () => {
    const ctx = makeCtx({
      issuingCompanies: [
        { _id: "company_A", orgId, name: "A (inactive)", isActive: false, isDefault: false },
        { _id: "company_B", orgId, name: "B", isActive: true, isDefault: true },
      ],
      servicesIssuingCompanyMap: [{ _id: "m1", orgId, serviceId, issuingCompanyId: "company_B" }],
      clientIssuingCompanyOverride: [
        { _id: "o1", orgId, clientId, serviceId, issuingCompanyId: "company_A" },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await resolveIssuingCompany(ctx as any, { orgId, clientId: clientId as any, serviceId: serviceId as any });
    expect(res.source).toBe("service_map");
    expect(res.issuingCompany._id).toBe("company_B");
  });

  it("degrades from service_map to org_default when service map points to inactive", async () => {
    const ctx = makeCtx({
      issuingCompanies: [
        { _id: "company_A", orgId, name: "A (inactive)", isActive: false, isDefault: false },
        { _id: "company_B", orgId, name: "B default", isActive: true, isDefault: true },
      ],
      servicesIssuingCompanyMap: [{ _id: "m1", orgId, serviceId, issuingCompanyId: "company_A" }],
      clientIssuingCompanyOverride: [],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await resolveIssuingCompany(ctx as any, { orgId, clientId: clientId as any, serviceId: serviceId as any });
    expect(res.source).toBe("org_default");
    expect(res.issuingCompany._id).toBe("company_B");
  });

  it("throws when only default is inactive", async () => {
    const ctx = makeCtx({
      issuingCompanies: [
        { _id: "company_A", orgId, name: "A", isActive: false, isDefault: true },
      ],
      servicesIssuingCompanyMap: [],
      clientIssuingCompanyOverride: [],
    });
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolveIssuingCompany(ctx as any, { orgId, clientId: clientId as any, serviceId: serviceId as any })
    ).rejects.toBeInstanceOf(NoIssuingCompanyError);
  });
});
