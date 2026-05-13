import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api } from "../../../_generated/api";

function asUserOfOrg(orgId: string, userSubject: string = `user|${orgId}`) {
  return {
    subject: userSubject,
    issuer: "test",
    tokenIdentifier: `test|${userSubject}`,
    orgId,
  };
}

const emptyState = (step: number = 0) => ({ step });

describe("projectionDrafts.upsertDraft", () => {
  it("creates a draft when none exists for (orgId, userId, clientId)", async () => {
    const t = convexTest(schema);
    const id = await t
      .withIdentity(asUserOfOrg("org_a"))
      .mutation(api.functions.projectionDrafts.mutations.upsertDraft, {
        clientId: undefined,
        state: emptyState(0),
      });
    expect(id).toBeDefined();

    const drafts = await t.run(async (ctx) => {
      return await ctx.db.query("projectionDrafts").collect();
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].orgId).toBe("org_a");
    expect(drafts[0].state.step).toBe(0);
  });

  it("patches the existing draft when one already exists for (orgId, userId, clientId)", async () => {
    const t = convexTest(schema);
    const ident = asUserOfOrg("org_a");

    const id1 = await t.withIdentity(ident).mutation(
      api.functions.projectionDrafts.mutations.upsertDraft,
      { clientId: undefined, state: emptyState(0) }
    );
    const id2 = await t.withIdentity(ident).mutation(
      api.functions.projectionDrafts.mutations.upsertDraft,
      { clientId: undefined, state: emptyState(2) }
    );
    expect(id1).toBe(id2);

    const drafts = await t.run(async (ctx) => {
      return await ctx.db.query("projectionDrafts").collect();
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].state.step).toBe(2);
  });

  it("multi-tenant isolation: drafts of org_a are not visible from org_b", async () => {
    const t = convexTest(schema);

    await t.withIdentity(asUserOfOrg("org_a")).mutation(
      api.functions.projectionDrafts.mutations.upsertDraft,
      { clientId: undefined, state: emptyState(0) }
    );

    const fromB = await t.withIdentity(asUserOfOrg("org_b")).query(
      api.functions.projectionDrafts.queries.getMyDraft,
      { clientId: undefined }
    );
    expect(fromB).toBeNull();
  });

  it("clearPreClientDraft removes the (clientId=null) slot when promoting to a real client", async () => {
    const t = convexTest(schema);
    const ident = asUserOfOrg("org_a");

    // Seed a clientId=null draft
    await t.withIdentity(ident).mutation(
      api.functions.projectionDrafts.mutations.upsertDraft,
      { clientId: undefined, state: emptyState(0) }
    );

    // Seed a client and upsert with that clientId + clearPreClientDraft: true
    const clientId = await t.run(async (ctx) =>
      ctx.db.insert("clients", {
        orgId: "org_a",
        name: "Catimi",
        rfc: "CTM010101AAA",
        industry: "Seguros",
        annualRevenue: 60_000_000,
        billingFrequency: "mensual" as const,
        isArchived: false,
        createdAt: Date.now(),
      })
    );

    await t.withIdentity(ident).mutation(
      api.functions.projectionDrafts.mutations.upsertDraft,
      { clientId, state: emptyState(1), clearPreClientDraft: true }
    );

    const drafts = await t.run(async (ctx) =>
      ctx.db.query("projectionDrafts").collect()
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].clientId).toBe(clientId);
  });
});

describe("projectionDrafts.deleteMyDraft", () => {
  it("deletes the matching draft", async () => {
    const t = convexTest(schema);
    const ident = asUserOfOrg("org_a");

    await t.withIdentity(ident).mutation(
      api.functions.projectionDrafts.mutations.upsertDraft,
      { clientId: undefined, state: emptyState(0) }
    );

    await t.withIdentity(ident).mutation(
      api.functions.projectionDrafts.mutations.deleteMyDraft,
      { clientId: undefined }
    );

    const drafts = await t.run(async (ctx) =>
      ctx.db.query("projectionDrafts").collect()
    );
    expect(drafts).toHaveLength(0);
  });

  it("is a no-op when no matching draft", async () => {
    const t = convexTest(schema);
    await t.withIdentity(asUserOfOrg("org_a")).mutation(
      api.functions.projectionDrafts.mutations.deleteMyDraft,
      { clientId: undefined }
    );
    // No throw, no assertion needed.
    expect(true).toBe(true);
  });
});
