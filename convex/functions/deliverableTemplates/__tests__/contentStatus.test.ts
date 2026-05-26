import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import { setupTest } from "../../../../tests/harness";

const PLACEHOLDER_HTML = `<div class="placeholder">Plantilla placeholder.</div>`;
const REAL_HTML = `<h1>Reporte Real</h1><p>{{cliente_nombre}}</p>`;

const STANDARD_VARS = [
  { key: "cliente_nombre", label: "Nombre", source: "client" as const, required: true },
];

function admin(orgId: string) {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `user_admin_${orgId}`,
    orgId,
    orgRole: "org:admin" as const,
  };
}

async function setupServiceAndSubservice(t: ReturnType<typeof setupTest>) {
  return await t.run(async (ctx) => {
    const serviceId = await ctx.db.insert("services", {
      orgId: undefined,
      name: "TI",
      type: "base",
      minPct: 0,
      maxPct: 100,
      defaultPct: 30,
      isDefault: true,
      sortOrder: 1,
    });
    const subserviceId = await ctx.db.insert("subservices", {
      orgId: undefined,
      parentServiceId: serviceId,
      name: "Soporte",
      slug: "soporte",
      defaultFrequency: "mensual",
      isActive: true,
      isDefault: false,
      sortOrder: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { serviceId, subserviceId };
  });
}

describe("deliverableTemplates contentStatus hooks", () => {
  it("create with placeholder HTML sets contentStatus='placeholder'", async () => {
    const t = setupTest();
    const { serviceId, subserviceId } = await setupServiceAndSubservice(t);

    const tplId = await t.withIdentity(admin("org_test")).mutation(
      api.functions.deliverableTemplates.mutations.create,
      {
        serviceId,
        serviceName: "TI",
        subserviceId,
        type: "deliverable_long",
        name: "Test",
        htmlTemplate: PLACEHOLDER_HTML,
        variables: STANDARD_VARS,
        isActive: true,
      },
    );

    const tpl = await t.run(async (ctx) => ctx.db.get(tplId));
    expect(tpl?.contentStatus).toBe("placeholder");
  });

  it("create with real HTML sets contentStatus='ready'", async () => {
    const t = setupTest();
    const { serviceId, subserviceId } = await setupServiceAndSubservice(t);

    const tplId = await t.withIdentity(admin("org_test")).mutation(
      api.functions.deliverableTemplates.mutations.create,
      {
        serviceId,
        serviceName: "TI",
        subserviceId,
        type: "deliverable_long",
        name: "Test",
        htmlTemplate: REAL_HTML,
        variables: STANDARD_VARS,
        isActive: true,
      },
    );

    const tpl = await t.run(async (ctx) => ctx.db.get(tplId));
    expect(tpl?.contentStatus).toBe("ready");
  });

  it("update flips placeholder → ready when marker removed", async () => {
    const t = setupTest();
    const { serviceId, subserviceId } = await setupServiceAndSubservice(t);

    const tplId = await t.withIdentity(admin("org_test")).mutation(
      api.functions.deliverableTemplates.mutations.create,
      {
        serviceId,
        serviceName: "TI",
        subserviceId,
        type: "deliverable_long",
        name: "Test",
        htmlTemplate: PLACEHOLDER_HTML,
        variables: STANDARD_VARS,
        isActive: true,
      },
    );

    await t.withIdentity(admin("org_test")).mutation(
      api.functions.deliverableTemplates.mutations.update,
      {
        id: tplId,
        expectedVersion: 1,
        patch: { htmlTemplate: REAL_HTML },
      },
    );

    const tpl = await t.run(async (ctx) => ctx.db.get(tplId));
    expect(tpl?.contentStatus).toBe("ready");
  });

  it("update flips ready → placeholder when marker re-introduced", async () => {
    const t = setupTest();
    const { serviceId, subserviceId } = await setupServiceAndSubservice(t);

    const tplId = await t.withIdentity(admin("org_test")).mutation(
      api.functions.deliverableTemplates.mutations.create,
      {
        serviceId,
        serviceName: "TI",
        subserviceId,
        type: "deliverable_long",
        name: "Test",
        htmlTemplate: REAL_HTML,
        variables: STANDARD_VARS,
        isActive: true,
      },
    );

    await t.withIdentity(admin("org_test")).mutation(
      api.functions.deliverableTemplates.mutations.update,
      {
        id: tplId,
        expectedVersion: 1,
        patch: { htmlTemplate: PLACEHOLDER_HTML },
      },
    );

    const tpl = await t.run(async (ctx) => ctx.db.get(tplId));
    expect(tpl?.contentStatus).toBe("placeholder");
  });

  it("personalizeGlobal inherits contentStatus from source", async () => {
    const t = setupTest();
    const { serviceId, subserviceId } = await setupServiceAndSubservice(t);

    const globalId = await t.run(async (ctx) =>
      ctx.db.insert("deliverableTemplates", {
        orgId: undefined,
        serviceId,
        serviceName: "TI",
        subserviceId,
        type: "deliverable_long",
        name: "Global",
        htmlTemplate: REAL_HTML,
        variables: STANDARD_VARS,
        version: 1,
        isActive: true,
        contentStatus: "ready",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    const cloneId = await t.withIdentity(admin("org_test")).mutation(
      api.functions.deliverableTemplates.mutations.personalizeGlobal,
      { globalTemplateId: globalId },
    );

    const clone = await t.run(async (ctx) => ctx.db.get(cloneId));
    expect(clone?.contentStatus).toBe("ready");
  });
});
