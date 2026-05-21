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

function member(orgId: string) {
  return {
    tokenIdentifier: `test|member_${orgId}`,
    subject: `user_member_${orgId}`,
    orgId,
    orgRole: "org:member" as const,
  };
}

const SUPER_ADMIN = {
  tokenIdentifier: "test|super_admin",
  subject: "user_super_admin",
  // super_admin queries inspect publicMetadata.role; no orgId is needed.
  publicMetadata: { role: "super_admin" } as const,
};

const baseVar = {
  key: "client_name",
  label: "Cliente",
  source: "client" as const,
  required: true,
};

async function seedGlobalTemplate(
  t: ReturnType<typeof setupTest>,
  overrides: Partial<{
    htmlTemplate: string;
    variables: Array<{
      key: string;
      label: string;
      source: "client" | "projection" | "service" | "ai" | "manual";
      required: boolean;
    }>;
    type:
      | "quotation"
      | "contract"
      | "deliverable_short"
      | "deliverable_long"
      | "questionnaire"
      | "invoice";
    version: number;
    isActive: boolean;
    serviceName: string;
    subserviceId: Id<"subservices">;
    serviceId: Id<"services">;
    name: string;
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
      name: overrides.name ?? "Global Marketing",
      htmlTemplate: overrides.htmlTemplate ?? "<p>{{client_name}}</p>",
      variables: overrides.variables ?? [baseVar],
      version: overrides.version ?? 3,
      isActive: overrides.isActive ?? true,
      parentTemplateId: undefined,
      originalVersionAtClone: undefined,
      createdAt: now,
      updatedAt: now,
    });
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Test #1 — create as org-admin inserts org-scoped row
// ───────────────────────────────────────────────────────────────────────────

describe("deliverableTemplates.mutations.create — permisos refactor", () => {
  it("org-admin crea plantilla org-scoped sin pasar orgId", async () => {
    const t = setupTest();

    const id = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.deliverableTemplates.mutations.create, {
        serviceName: "Marketing",
        type: "quotation",
        name: "Cotización A",
        htmlTemplate: "<p>Hola {{client_name}}</p>",
        variables: [baseVar],
        isActive: true,
      });

    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row).not.toBeNull();
    expect(row?.orgId).toBe(ORG_A);
    expect(row?.parentTemplateId).toBeUndefined();
    expect(row?.originalVersionAtClone).toBeUndefined();
    expect(row?.version).toBe(1);
    expect(row?.type).toBe("quotation");
    expect(row?.name).toBe("Cotización A");
  });

  // Test #2 — operator passing another org's orgId is rejected.
  it("org-admin con orgId distinto al suyo es rechazado", async () => {
    const t = setupTest();
    await expect(
      t.withIdentity(admin(ORG_A)).mutation(
        api.functions.deliverableTemplates.mutations.create,
        {
          orgId: ORG_B,
          serviceName: "Marketing",
          type: "quotation",
          name: "Cotización Hijack",
          htmlTemplate: "<p>{{client_name}}</p>",
          variables: [baseVar],
          isActive: true,
        },
      ),
    ).rejects.toThrow(/otra organización/i);
  });

  it("members no pueden crear", async () => {
    const t = setupTest();
    await expect(
      t.withIdentity(member(ORG_A)).mutation(
        api.functions.deliverableTemplates.mutations.create,
        {
          serviceName: "Marketing",
          type: "quotation",
          name: "x",
          htmlTemplate: "<p>{{client_name}}</p>",
          variables: [baseVar],
          isActive: true,
        },
      ),
    ).rejects.toThrow(/Administrador/i);
  });

  it("super_admin puede crear global (orgId undefined)", async () => {
    const t = setupTest();
    const id = await t
      .withIdentity(SUPER_ADMIN)
      .mutation(api.functions.deliverableTemplates.mutations.create, {
        serviceName: "Marketing",
        type: "deliverable_short",
        name: "Global SA",
        htmlTemplate: "<p>{{client_name}}</p>",
        variables: [baseVar],
        isActive: true,
      });
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.orgId).toBeUndefined();
  });
});

describe("deliverableTemplates.mutations.update — permisos + concurrencia + validación", () => {
  // Test #3 — org-admin cannot edit a global template.
  it("rechaza editar global desde org-admin", async () => {
    const t = setupTest();
    const globalId = await seedGlobalTemplate(t);
    await expect(
      t.withIdentity(admin(ORG_A)).mutation(
        api.functions.deliverableTemplates.mutations.update,
        {
          id: globalId,
          expectedVersion: 3,
          patch: { name: "Hijack" },
        },
      ),
    ).rejects.toThrow(/Super Admin/i);
  });

  // Cross-org guard for org-scoped rows.
  it("rechaza editar plantilla org-scoped de otra org", async () => {
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
    await expect(
      t.withIdentity(admin(ORG_B)).mutation(
        api.functions.deliverableTemplates.mutations.update,
        {
          id: orgAId,
          expectedVersion: 1,
          patch: { name: "Hijack" },
        },
      ),
    ).rejects.toThrow(/otra organización/i);
  });

  // Test #14 — optimistic concurrency: stale expectedVersion rejects + state unchanged.
  it("rechaza update con expectedVersion stale; estado no cambia", async () => {
    const t = setupTest();
    const orgAId = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.deliverableTemplates.mutations.create, {
        serviceName: "Marketing",
        type: "deliverable_short",
        name: "Initial",
        htmlTemplate: "<p>{{client_name}}</p>",
        variables: [baseVar],
        isActive: true,
      });

    // Cliente B bumpea la versión: 1 -> 2.
    await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.deliverableTemplates.mutations.update,
      {
        id: orgAId,
        expectedVersion: 1,
        patch: { name: "Bumped by B" },
      },
    );

    // Cliente A intenta con la versión vieja (1).
    await expect(
      t.withIdentity(admin(ORG_A)).mutation(
        api.functions.deliverableTemplates.mutations.update,
        {
          id: orgAId,
          expectedVersion: 1,
          patch: { name: "Stale A" },
        },
      ),
    ).rejects.toThrow(/obsoleta/i);

    const row = await t.run((ctx) => ctx.db.get(orgAId));
    expect(row?.version).toBe(2);
    expect(row?.name).toBe("Bumped by B");
  });

  // Test #15 — placeholder validation
  it("rechaza update con placeholder no declarado", async () => {
    const t = setupTest();
    const orgAId = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.deliverableTemplates.mutations.create, {
        serviceName: "Marketing",
        type: "deliverable_short",
        name: "PH",
        htmlTemplate: "<p>{{client_name}}</p>",
        variables: [baseVar],
        isActive: true,
      });

    await expect(
      t.withIdentity(admin(ORG_A)).mutation(
        api.functions.deliverableTemplates.mutations.update,
        {
          id: orgAId,
          expectedVersion: 1,
          patch: {
            htmlTemplate: "<p>{{client_name}} {{unknown_placeholder}}</p>",
          },
        },
      ),
    ).rejects.toThrow(/unknown_placeholder/i);
  });

  it("update exitoso bumpea version y actualiza updatedAt", async () => {
    const t = setupTest();
    const id = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.deliverableTemplates.mutations.create, {
        serviceName: "Marketing",
        type: "deliverable_short",
        name: "X",
        htmlTemplate: "<p>{{client_name}}</p>",
        variables: [baseVar],
        isActive: true,
      });
    const before = await t.run((ctx) => ctx.db.get(id));
    await new Promise((r) => setTimeout(r, 2));
    await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.deliverableTemplates.mutations.update,
      {
        id,
        expectedVersion: 1,
        patch: { name: "Renamed" },
      },
    );
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.version).toBe(2);
    expect(after?.name).toBe("Renamed");
    expect((after?.updatedAt ?? 0)).toBeGreaterThan(before?.updatedAt ?? 0);
  });
});

describe("deliverableTemplates.mutations.personalizeGlobal — copy-on-write", () => {
  // Test #4 — clones correctly with parent linkage.
  it("clona global en org-scoped con parentTemplateId + originalVersionAtClone", async () => {
    const t = setupTest();
    const globalId = await seedGlobalTemplate(t, {
      version: 3,
      htmlTemplate: "<p>H {{client_name}}</p>",
      variables: [baseVar],
    });

    const cloneId = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.deliverableTemplates.mutations.personalizeGlobal,
      { globalTemplateId: globalId },
    );

    expect(cloneId).not.toBe(globalId);
    const clone = await t.run((ctx) => ctx.db.get(cloneId));
    expect(clone?.orgId).toBe(ORG_A);
    expect(clone?.parentTemplateId).toBe(globalId);
    expect(clone?.originalVersionAtClone).toBe(3);
    expect(clone?.version).toBe(1);
    expect(clone?.htmlTemplate).toBe("<p>H {{client_name}}</p>");
    expect(clone?.variables.length).toBe(1);
  });

  // Test #6 — copies HTML + variables + type + subserviceId
  it("copia htmlTemplate, variables, type, serviceName y subserviceId", async () => {
    const t = setupTest();
    // Seed a parent service + subservice so the clone has a real subserviceId.
    const { serviceId, subId } = await t.run(async (ctx) => {
      const svc = await ctx.db.insert("services", {
        orgId: undefined,
        name: "Legal",
        type: "base" as const,
        minPct: 0.01,
        maxPct: 0.03,
        defaultPct: 0.02,
        isDefault: true,
        sortOrder: 1,
      });
      const sub = await ctx.db.insert("subservices", {
        orgId: undefined,
        parentServiceId: svc,
        name: "Gob Corp",
        slug: "gob-corp",
        defaultFrequency: "trimestral" as const,
        isActive: true,
        isDefault: true,
        sortOrder: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return { serviceId: svc, subId: sub };
    });

    const vars = [
      baseVar,
      {
        key: "annual_amount",
        label: "Monto",
        source: "service" as const,
        required: true,
      },
    ];
    const globalId = await seedGlobalTemplate(t, {
      serviceId,
      subserviceId: subId,
      type: "contract",
      htmlTemplate: "<p>{{client_name}} {{annual_amount}}</p>",
      variables: vars,
      serviceName: "Legal",
      name: "Contrato Gob Corp",
    });

    const cloneId = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.deliverableTemplates.mutations.personalizeGlobal,
      { globalTemplateId: globalId },
    );

    const clone = await t.run((ctx) => ctx.db.get(cloneId));
    expect(clone?.type).toBe("contract");
    expect(clone?.serviceId).toBe(serviceId);
    expect(clone?.serviceName).toBe("Legal");
    expect(clone?.subserviceId).toBe(subId);
    expect(clone?.htmlTemplate).toBe("<p>{{client_name}} {{annual_amount}}</p>");
    expect(clone?.variables).toEqual(vars);
  });

  // Test #7 — idempotent: second call returns the same id.
  it("idempotente: segunda llamada devuelve el mismo _id", async () => {
    const t = setupTest();
    const globalId = await seedGlobalTemplate(t);

    const first = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.deliverableTemplates.mutations.personalizeGlobal,
      { globalTemplateId: globalId },
    );
    const second = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.deliverableTemplates.mutations.personalizeGlobal,
      { globalTemplateId: globalId },
    );
    expect(second).toBe(first);

    const all = await t.run((ctx) =>
      ctx.db
        .query("deliverableTemplates")
        .withIndex("by_parentTemplateId", (q) =>
          q.eq("parentTemplateId", globalId),
        )
        .filter((q) => q.eq(q.field("orgId"), ORG_A))
        .collect(),
    );
    expect(all).toHaveLength(1);
  });

  it("rechaza personalizar un template org-scoped (solo globals)", async () => {
    const t = setupTest();
    const orgAId = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.deliverableTemplates.mutations.create, {
        serviceName: "Marketing",
        type: "deliverable_short",
        name: "Already org",
        htmlTemplate: "<p>{{client_name}}</p>",
        variables: [baseVar],
        isActive: true,
      });
    await expect(
      t.withIdentity(admin(ORG_A)).mutation(
        api.functions.deliverableTemplates.mutations.personalizeGlobal,
        { globalTemplateId: orgAId },
      ),
    ).rejects.toThrow(/globales/i);
  });

  it("members no pueden personalizar", async () => {
    const t = setupTest();
    const globalId = await seedGlobalTemplate(t);
    await expect(
      t.withIdentity(member(ORG_A)).mutation(
        api.functions.deliverableTemplates.mutations.personalizeGlobal,
        { globalTemplateId: globalId },
      ),
    ).rejects.toThrow(/Administrador/i);
  });
});

describe("deliverableTemplates.mutations.remove — globals bloqueados + soft-delete con refs", () => {
  // Test #5 — remove global from org-admin is rejected.
  it("rechaza eliminar global desde org-admin", async () => {
    const t = setupTest();
    const globalId = await seedGlobalTemplate(t);
    await expect(
      t.withIdentity(admin(ORG_A)).mutation(
        api.functions.deliverableTemplates.mutations.remove,
        { id: globalId },
      ),
    ).rejects.toThrow(/Super Admin/i);
  });

  // Test #16 (extra) — soft-delete when deliverables reference the template.
  it("soft-delete cuando hay deliverables apuntando", async () => {
    const t = setupTest();
    const orgAId = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.deliverableTemplates.mutations.create, {
        serviceName: "Marketing",
        type: "deliverable_short",
        name: "ToRemove",
        htmlTemplate: "<p>{{client_name}}</p>",
        variables: [baseVar],
        isActive: true,
      });

    // Plant a deliverable pointing to this template.
    await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: ORG_A,
        name: "C",
        rfc: "AAA010101AAA",
        industry: "x",
        annualRevenue: 0,
        billingFrequency: "mensual" as const,
        isArchived: false,
        createdAt: Date.now(),
      });
      const projId = await ctx.db.insert("projections", {
        orgId: ORG_A,
        clientId,
        year: 2026,
        annualSales: 100,
        totalBudget: 10,
        commissionRate: 0,
        seasonalityData: [],
        status: "active" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const svc = await ctx.db.insert("services", {
        orgId: ORG_A,
        name: "Marketing",
        type: "base" as const,
        minPct: 0.05,
        maxPct: 0.3,
        defaultPct: 0.18,
        isDefault: true,
        sortOrder: 1,
      });
      const projServiceId = await ctx.db.insert("projectionServices", {
        orgId: ORG_A,
        projectionId: projId,
        serviceId: svc,
        serviceName: "Marketing",
        chosenPct: 0.18,
        isActive: true,
        annualAmount: 810,
        normalizedWeight: 0.18,
      });
      const assignmentId = await ctx.db.insert("monthlyAssignments", {
        orgId: ORG_A,
        projServiceId,
        projectionId: projId,
        clientId,
        serviceName: "Marketing",
        month: 5,
        year: 2026,
        amount: 67,
        feFactor: 1,
        status: "pending" as const,
        invoiceStatus: "not_invoiced" as const,
      });
      await ctx.db.insert("deliverables", {
        orgId: ORG_A,
        assignmentId,
        projServiceId,
        clientId,
        serviceName: "Marketing",
        month: 5,
        year: 2026,
        shortContent: "s",
        longContent: "",
        templateId: orgAId,
        templateVersion: 1,
        templateHtmlSnapshot: "<p>{{client_name}}</p>",
        auditStatus: "pending" as const,
        retryCount: 0,
        createdAt: Date.now(),
      });
    });

    const result = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.deliverableTemplates.mutations.remove,
      { id: orgAId },
    );
    expect(result.mode).toBe("soft");
    const row = await t.run((ctx) => ctx.db.get(orgAId));
    expect(row).not.toBeNull();
    expect(row?.isActive).toBe(false);
  });

  it("hard-delete cuando no hay deliverables apuntando", async () => {
    const t = setupTest();
    const id = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.deliverableTemplates.mutations.create, {
        serviceName: "Marketing",
        type: "deliverable_short",
        name: "Lonely",
        htmlTemplate: "<p>{{client_name}}</p>",
        variables: [baseVar],
        isActive: true,
      });
    const result = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.deliverableTemplates.mutations.remove,
      { id },
    );
    expect(result.mode).toBe("hard");
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row).toBeNull();
  });
});

describe("deliverableTemplates.mutations.restoreToGlobal", () => {
  it("hard-deletes el clon cuando no hay deliverables y listForOrg vuelve al global", async () => {
    const t = setupTest();
    const globalId = await seedGlobalTemplate(t);
    const cloneId = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.deliverableTemplates.mutations.personalizeGlobal,
      { globalTemplateId: globalId },
    );

    const result = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.deliverableTemplates.mutations.restoreToGlobal,
      { orgTemplateId: cloneId },
    );
    expect(result.mode).toBe("hard");
    const gone = await t.run((ctx) => ctx.db.get(cloneId));
    expect(gone).toBeNull();

    const list = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.deliverableTemplates.queries.listForOrg, {});
    expect(list.map((row) => row.template._id)).toContain(globalId);
  });

  it("soft-delete (isActive=false) cuando hay deliverables apuntando", async () => {
    const t = setupTest();
    const globalId = await seedGlobalTemplate(t);
    const cloneId = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.deliverableTemplates.mutations.personalizeGlobal,
      { globalTemplateId: globalId },
    );

    await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId: ORG_A,
        name: "C",
        rfc: "AAA010101AAA",
        industry: "x",
        annualRevenue: 0,
        billingFrequency: "mensual" as const,
        isArchived: false,
        createdAt: Date.now(),
      });
      const projId = await ctx.db.insert("projections", {
        orgId: ORG_A,
        clientId,
        year: 2026,
        annualSales: 100,
        totalBudget: 10,
        commissionRate: 0,
        seasonalityData: [],
        status: "active" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const svc = await ctx.db.insert("services", {
        orgId: ORG_A,
        name: "Marketing",
        type: "base" as const,
        minPct: 0.05,
        maxPct: 0.3,
        defaultPct: 0.18,
        isDefault: true,
        sortOrder: 1,
      });
      const projServiceId = await ctx.db.insert("projectionServices", {
        orgId: ORG_A,
        projectionId: projId,
        serviceId: svc,
        serviceName: "Marketing",
        chosenPct: 0.18,
        isActive: true,
        annualAmount: 810,
        normalizedWeight: 0.18,
      });
      const assignmentId = await ctx.db.insert("monthlyAssignments", {
        orgId: ORG_A,
        projServiceId,
        projectionId: projId,
        clientId,
        serviceName: "Marketing",
        month: 5,
        year: 2026,
        amount: 67,
        feFactor: 1,
        status: "pending" as const,
        invoiceStatus: "not_invoiced" as const,
      });
      await ctx.db.insert("deliverables", {
        orgId: ORG_A,
        assignmentId,
        projServiceId,
        clientId,
        serviceName: "Marketing",
        month: 5,
        year: 2026,
        shortContent: "s",
        longContent: "",
        templateId: cloneId,
        templateVersion: 1,
        templateHtmlSnapshot: "<p>{{client_name}}</p>",
        auditStatus: "pending" as const,
        retryCount: 0,
        createdAt: Date.now(),
      });
    });

    const result = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.deliverableTemplates.mutations.restoreToGlobal,
      { orgTemplateId: cloneId },
    );
    expect(result.mode).toBe("soft");
    const row = await t.run((ctx) => ctx.db.get(cloneId));
    expect(row).not.toBeNull();
    expect(row?.isActive).toBe(false);
  });

  it("rechaza restaurar template sin parent (no es clon)", async () => {
    const t = setupTest();
    const orgAId = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.deliverableTemplates.mutations.create, {
        serviceName: "Marketing",
        type: "deliverable_short",
        name: "Fresh",
        htmlTemplate: "<p>{{client_name}}</p>",
        variables: [baseVar],
        isActive: true,
      });
    await expect(
      t.withIdentity(admin(ORG_A)).mutation(
        api.functions.deliverableTemplates.mutations.restoreToGlobal,
        { orgTemplateId: orgAId },
      ),
    ).rejects.toThrow(/no se basa/i);
  });

  it("orgB no puede restaurar el clon de orgA", async () => {
    const t = setupTest();
    const globalId = await seedGlobalTemplate(t);
    const cloneA = await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.deliverableTemplates.mutations.personalizeGlobal,
      { globalTemplateId: globalId },
    );
    await expect(
      t.withIdentity(admin(ORG_B)).mutation(
        api.functions.deliverableTemplates.mutations.restoreToGlobal,
        { orgTemplateId: cloneA },
      ),
    ).rejects.toThrow(/otra organización/i);
  });
});

describe("deliverableTemplates.mutations.toggleActive — guard org-scope", () => {
  it("operador puede togglear su row pero no el global", async () => {
    const t = setupTest();
    const id = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.deliverableTemplates.mutations.create, {
        serviceName: "Marketing",
        type: "deliverable_short",
        name: "T",
        htmlTemplate: "<p>{{client_name}}</p>",
        variables: [baseVar],
        isActive: true,
      });
    await t.withIdentity(admin(ORG_A)).mutation(
      api.functions.deliverableTemplates.mutations.toggleActive,
      { id },
    );
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.isActive).toBe(false);

    // Global blocked
    const globalId = await seedGlobalTemplate(t);
    await expect(
      t.withIdentity(admin(ORG_A)).mutation(
        api.functions.deliverableTemplates.mutations.toggleActive,
        { id: globalId },
      ),
    ).rejects.toThrow(/Super Admin/i);
  });
});
