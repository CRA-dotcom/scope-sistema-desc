import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import { setupTest, ORG_A, ORG_B } from "../../../../tests/harness";

function admin(orgId: string) {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `user_admin_${orgId}`,
    orgId,
    orgRole: "org:admin" as const,
  };
}

const baseVar = {
  key: "client_name",
  label: "Cliente",
  source: "client" as const,
  required: true,
};

async function seedGlobal(
  t: ReturnType<typeof setupTest>,
  overrides: Partial<{
    type:
      | "deliverable_short"
      | "deliverable_long"
      | "quotation"
      | "contract"
      | "questionnaire"
      | "invoice";
    serviceName: string;
    serviceId: Id<"services">;
    subserviceId: Id<"subservices">;
    version: number;
    isActive: boolean;
    name: string;
    htmlTemplate: string;
  }> = {},
): Promise<Id<"deliverableTemplates">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("deliverableTemplates", {
      orgId: undefined,
      serviceId: overrides.serviceId,
      serviceName: overrides.serviceName ?? "Marketing",
      subserviceId: overrides.subserviceId,
      type: overrides.type ?? "deliverable_short",
      name: overrides.name ?? "Global",
      htmlTemplate: overrides.htmlTemplate ?? "<p>{{client_name}}</p>",
      variables: [baseVar],
      version: overrides.version ?? 1,
      isActive: overrides.isActive ?? true,
      parentTemplateId: undefined,
      originalVersionAtClone: undefined,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function seedSubservice(
  t: ReturnType<typeof setupTest>,
): Promise<{ serviceId: Id<"services">; subId: Id<"subservices"> }> {
  return await t.run(async (ctx) => {
    const svc = await ctx.db.insert("services", {
      orgId: undefined,
      name: "Marketing",
      type: "base" as const,
      minPct: 0.05,
      maxPct: 0.3,
      defaultPct: 0.18,
      isDefault: true,
      sortOrder: 1,
    });
    const sub = await ctx.db.insert("subservices", {
      orgId: undefined,
      parentServiceId: svc,
      name: "Plan Anual",
      slug: "plan-anual",
      defaultFrequency: "anual" as const,
      isActive: true,
      isDefault: true,
      sortOrder: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { serviceId: svc, subId: sub };
  });
}

describe("deliverableTemplates.queries.getResolved — dual-matching", () => {
  // Test #9 — prefers org-scoped over global when subserviceId matches.
  it("prefiere org-scoped sobre global con mismo subserviceId", async () => {
    const t = setupTest();
    const { serviceId, subId } = await seedSubservice(t);
    const globalId = await seedGlobal(t, {
      subserviceId: subId,
      serviceId,
      type: "deliverable_short",
    });
    const cloneId = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.deliverableTemplates.mutations.personalizeGlobal,
      { globalTemplateId: globalId },
    );

    const got = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.deliverableTemplates.queries.getResolved, {
        type: "deliverable_short",
        subserviceId: subId,
      });
    expect(got?._id).toBe(cloneId);
    expect(got?.orgId).toBe(ORG_A);
  });

  // Test #10 — fallback to global when no org clone exists.
  it("fallback al global si no hay clon de la org", async () => {
    const t = setupTest();
    const { serviceId, subId } = await seedSubservice(t);
    const globalId = await seedGlobal(t, {
      subserviceId: subId,
      serviceId,
      type: "deliverable_short",
    });
    const got = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.deliverableTemplates.queries.getResolved, {
        type: "deliverable_short",
        subserviceId: subId,
      });
    expect(got?._id).toBe(globalId);
    expect(got?.orgId).toBeUndefined();
  });

  // Test #11 — legacy dual-matching via serviceId / serviceName when no subserviceId.
  it("dual-matching legacy: usa serviceId + serviceName cuando no hay subserviceId", async () => {
    const t = setupTest();
    const { serviceId } = await seedSubservice(t);
    const legacyId = await seedGlobal(t, {
      serviceId,
      serviceName: "Marketing",
      type: "deliverable_short",
      // intencionalmente sin subserviceId — fila legacy
    });
    const got = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.deliverableTemplates.queries.getResolved, {
        type: "deliverable_short",
        serviceId,
        serviceName: "Marketing",
      });
    expect(got?._id).toBe(legacyId);
  });

  it("retorna null cuando no hay match en ninguna estrategia", async () => {
    const t = setupTest();
    const got = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.deliverableTemplates.queries.getResolved, {
        type: "deliverable_short",
        serviceName: "Nada",
      });
    expect(got).toBeNull();
  });
});

describe("deliverableTemplates.queries.getByIdWithBanner — banner global", () => {
  // Test #8 — hasNewerGlobal banner true when global bumps past originalVersionAtClone.
  it("hasNewerGlobal=true cuando global sube de versión después del clon", async () => {
    const t = setupTest();
    const globalId = await seedGlobal(t, { version: 3 });
    // orgA personaliza el global v3 → clon con originalVersionAtClone=3
    const cloneId = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.deliverableTemplates.mutations.personalizeGlobal,
      { globalTemplateId: globalId },
    );
    // Super-admin (simulado) bumpea el global a v4 directamente vía db.patch.
    await t.run(async (ctx) => {
      await ctx.db.patch(globalId, { version: 4, updatedAt: Date.now() });
    });

    const banner = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.deliverableTemplates.queries.getByIdWithBanner, {
        id: cloneId,
      });
    expect(banner).not.toBeNull();
    expect(banner!.hasNewerGlobal).toBe(true);
    expect(banner!.globalVersion).toBe(4);
  });

  it("hasNewerGlobal=false cuando no hay parent (template creado from-scratch)", async () => {
    const t = setupTest();
    const id = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.deliverableTemplates.mutations.create, {
        serviceName: "Marketing",
        type: "deliverable_short",
        name: "Fresh",
        htmlTemplate: "<p>{{client_name}}</p>",
        variables: [baseVar],
        isActive: true,
      });
    const banner = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.deliverableTemplates.queries.getByIdWithBanner, {
        id,
      });
    expect(banner?.hasNewerGlobal).toBe(false);
  });

  it("orgB no puede ver template org-scoped de orgA via banner", async () => {
    const t = setupTest();
    const orgAId = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.deliverableTemplates.mutations.create, {
        serviceName: "Marketing",
        type: "deliverable_short",
        name: "A only",
        htmlTemplate: "<p>{{client_name}}</p>",
        variables: [baseVar],
        isActive: true,
      });
    const banner = await t
      .withIdentity(admin(ORG_B))
      .query(api.functions.deliverableTemplates.queries.getByIdWithBanner, {
        id: orgAId,
      });
    expect(banner).toBeNull();
  });
});

describe("deliverableTemplates.queries.listForOrg — dedup global+clon", () => {
  // Test #17 (extra) — deduplication: when an org has personalized a global, only the clone appears.
  it("deduplica: si org personalizó un global, solo aparece el clon", async () => {
    const t = setupTest();
    const globalId = await seedGlobal(t);
    const cloneId = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.deliverableTemplates.mutations.personalizeGlobal,
      { globalTemplateId: globalId },
    );

    const list = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.deliverableTemplates.queries.listForOrg, {});
    const ids = list.map((t) => t._id);
    expect(ids).toContain(cloneId);
    expect(ids).not.toContain(globalId);
  });

  it("incluye globales sin clonar + org-scoped propios; orgB no ve orgA", async () => {
    const t = setupTest();
    const globalUntouched = await seedGlobal(t, {
      name: "Global free",
      serviceName: "Otro",
    });
    const orgAId = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.deliverableTemplates.mutations.create, {
        serviceName: "Marketing",
        type: "deliverable_short",
        name: "OrgA only",
        htmlTemplate: "<p>{{client_name}}</p>",
        variables: [baseVar],
        isActive: true,
      });

    const listA = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.deliverableTemplates.queries.listForOrg, {});
    const idsA = listA.map((t) => t._id);
    expect(idsA).toContain(globalUntouched);
    expect(idsA).toContain(orgAId);

    const listB = await t
      .withIdentity(admin(ORG_B))
      .query(api.functions.deliverableTemplates.queries.listForOrg, {});
    const idsB = listB.map((t) => t._id);
    expect(idsB).toContain(globalUntouched); // global visible
    expect(idsB).not.toContain(orgAId); // org-scoped de A invisible para B
  });
});

describe("deliverableTemplates.queries.list — operator open access", () => {
  it("operador ve globales + sus org-scoped, no los de otra org", async () => {
    const t = setupTest();
    const globalId = await seedGlobal(t);
    const orgAId = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.deliverableTemplates.mutations.create, {
        serviceName: "Marketing",
        type: "deliverable_short",
        name: "A",
        htmlTemplate: "<p>{{client_name}}</p>",
        variables: [baseVar],
        isActive: true,
      });
    const orgBId = await t
      .withIdentity(admin(ORG_B))
      .mutation(api.functions.deliverableTemplates.mutations.create, {
        serviceName: "Marketing",
        type: "deliverable_short",
        name: "B",
        htmlTemplate: "<p>{{client_name}}</p>",
        variables: [baseVar],
        isActive: true,
      });
    const listA = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.deliverableTemplates.queries.list, {});
    const idsA = listA.map((t) => t._id);
    expect(idsA).toContain(globalId);
    expect(idsA).toContain(orgAId);
    expect(idsA).not.toContain(orgBId);
  });
});
