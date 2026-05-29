import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api } from "../../../_generated/api";

const ORG_A = "org_test_A";

async function seedClients(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const a = await ctx.db.insert("clients", {
      orgId: ORG_A, name: "Acme", rfc: "ACM010101AAA",
      industry: "Tech", annualRevenue: 0, billingFrequency: "mensual",
      isArchived: false, assignedTo: "user_X", createdAt: 1,
    });
    const b = await ctx.db.insert("clients", {
      orgId: ORG_A, name: "Beta", rfc: "BTA010101BBB",
      industry: "Retail", annualRevenue: 0, billingFrequency: "mensual",
      isArchived: false, assignedTo: "user_Y", createdAt: 2,
    });
    const c = await ctx.db.insert("clients", {
      orgId: ORG_A, name: "Gamma", rfc: "GMA010101CCC",
      industry: "Tech", annualRevenue: 0, billingFrequency: "mensual",
      isArchived: true, assignedTo: "user_X", createdAt: 3,
    });
    return { a, b, c };
  });
}

describe("clients.list", () => {
  it("returns non-archived clients by default for admin", async () => {
    const t = convexTest(schema);
    await seedClients(t);

    const result = await t
      .withIdentity({
        subject: "user_X", tokenIdentifier: "u", orgId: ORG_A,
        orgRole: "org:admin",
      } as any)
      .query(api.functions.clients.queries.list, {});

    expect(result.map((c: any) => c.name).sort()).toEqual(["Acme", "Beta"]);
  });

  it("filters by industry when set", async () => {
    const t = convexTest(schema);
    await seedClients(t);

    const result = await t
      .withIdentity({
        subject: "user_X", tokenIdentifier: "u", orgId: ORG_A,
        orgRole: "org:admin",
      } as any)
      .query(api.functions.clients.queries.list, { industry: "Tech" });

    expect(result.map((c: any) => c.name).sort()).toEqual(["Acme"]);
  });

  it("filters by assignedTo for org:member role", async () => {
    const t = convexTest(schema);
    await seedClients(t);

    const result = await t
      .withIdentity({
        subject: "user_X", tokenIdentifier: "u", orgId: ORG_A,
        orgRole: "org:member",
      } as any)
      .query(api.functions.clients.queries.list, {});

    expect(result.map((c: any) => c.name).sort()).toEqual(["Acme"]);
  });

  it("includes archived when includeArchived=true", async () => {
    const t = convexTest(schema);
    await seedClients(t);

    const result = await t
      .withIdentity({
        subject: "user_X", tokenIdentifier: "u", orgId: ORG_A,
        orgRole: "org:admin",
      } as any)
      .query(api.functions.clients.queries.list, { includeArchived: true });

    expect(result.map((c: any) => c.name).sort()).toEqual(["Acme", "Beta", "Gamma"]);
  });

  it("filters by search term (name or RFC)", async () => {
    const t = convexTest(schema);
    await seedClients(t);

    const result = await t
      .withIdentity({
        subject: "user_X", tokenIdentifier: "u", orgId: ORG_A,
        orgRole: "org:admin",
      } as any)
      .query(api.functions.clients.queries.list, { search: "bta" });

    expect(result.map((c: any) => c.name)).toEqual(["Beta"]);
  });

  it("filters by industry AND assignedTo for org:member role (cross-filter)", async () => {
    const t = convexTest(schema);
    await seedClients(t);

    const result = await t
      .withIdentity({
        subject: "user_X", tokenIdentifier: "u", orgId: ORG_A,
        orgRole: "org:member",
      } as any)
      .query(api.functions.clients.queries.list, { industry: "Tech" });

    // Acme is Tech + assignedTo=user_X + non-archived → include
    // Gamma is Tech + assignedTo=user_X but archived → exclude
    // Beta is non-archived + assignedTo=user_Y → exclude (wrong industry)
    expect(result.map((c: any) => c.name).sort()).toEqual(["Acme"]);
  });

  it("returns archived when industry filter + includeArchived=true (admin)", async () => {
    const t = convexTest(schema);
    await seedClients(t);

    const result = await t
      .withIdentity({
        subject: "user_X", tokenIdentifier: "u", orgId: ORG_A,
        orgRole: "org:admin",
      } as any)
      .query(api.functions.clients.queries.list, {
        industry: "Tech",
        includeArchived: true,
      });

    // Acme (Tech, non-archived) + Gamma (Tech, archived) both included.
    expect(result.map((c: any) => c.name).sort()).toEqual(["Acme", "Gamma"]);
  });
});
