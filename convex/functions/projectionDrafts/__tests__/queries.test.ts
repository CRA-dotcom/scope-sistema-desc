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

describe("projectionDrafts.getMyDraft", () => {
  it("returns null when there is no draft", async () => {
    const t = convexTest(schema);
    const r = await t.withIdentity(asUserOfOrg("org_a")).query(
      api.functions.projectionDrafts.queries.getMyDraft,
      { clientId: undefined }
    );
    expect(r).toBeNull();
  });

  it("returns the user's draft for clientId=null", async () => {
    const t = convexTest(schema);
    const ident = asUserOfOrg("org_a");

    await t.withIdentity(ident).mutation(
      api.functions.projectionDrafts.mutations.upsertDraft,
      { clientId: undefined, state: { step: 2, year: 2026 } }
    );

    const r = await t.withIdentity(ident).query(
      api.functions.projectionDrafts.queries.getMyDraft,
      { clientId: undefined }
    );
    expect(r).not.toBeNull();
    expect(r!.state.step).toBe(2);
    expect(r!.state.year).toBe(2026);
  });
});

describe("projectionDrafts.listMyDrafts", () => {
  it("returns the user's drafts (both null-slot and per-client)", async () => {
    const t = convexTest(schema);
    const ident = asUserOfOrg("org_a");

    const clientId = await t.run(async (ctx) =>
      ctx.db.insert("clients", {
        orgId: "org_a",
        name: "C", rfc: "CCC010101AAA", industry: "X",
        annualRevenue: 1_000_000,
        billingFrequency: "mensual" as const,
        isArchived: false,
        createdAt: Date.now(),
      })
    );

    await t.withIdentity(ident).mutation(
      api.functions.projectionDrafts.mutations.upsertDraft,
      { clientId: undefined, state: emptyState(0) }
    );
    await t.withIdentity(ident).mutation(
      api.functions.projectionDrafts.mutations.upsertDraft,
      { clientId, state: emptyState(1) }
    );

    const r = await t.withIdentity(ident).query(
      api.functions.projectionDrafts.queries.listMyDrafts,
      {}
    );
    expect(r).toHaveLength(2);
  });

  it("does not return drafts from other orgs", async () => {
    const t = convexTest(schema);

    await t.withIdentity(asUserOfOrg("org_a")).mutation(
      api.functions.projectionDrafts.mutations.upsertDraft,
      { clientId: undefined, state: emptyState(0) }
    );

    const r = await t.withIdentity(asUserOfOrg("org_b")).query(
      api.functions.projectionDrafts.queries.listMyDrafts,
      {}
    );
    expect(r).toHaveLength(0);
  });
});
