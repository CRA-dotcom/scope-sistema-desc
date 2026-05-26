import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal } from "../../../_generated/api";
import schema from "../../../schema";

const REAL_HTML = `<h1>Mensual {{cliente.nombre}}</h1>`;
const PLACEHOLDER_HTML = `<div class="placeholder">stub</div>`;

async function setup(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const serviceId = await ctx.db.insert("services", {
      orgId: undefined,
      name: "Legal",
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
      name: "Asesoría Legal",
      slug: "asesoria-legal",
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

describe("deliverableTemplates.bulkImport.upsertFromFile", () => {
  it("creates new global template when none exists", async () => {
    const t = convexTest(schema);
    await setup(t);

    const result = await t.mutation(
      internal.functions.deliverableTemplates.bulkImport.upsertFromFile,
      {
        parentServiceName: "Legal",
        subserviceSlug: "asesoria-legal",
        type: "deliverable_long",
        name: "Asesoría Legal — Reporte",
        htmlTemplate: REAL_HTML,
      }
    );

    expect(result.action).toBe("created");
    expect(result.contentStatus).toBe("ready");

    const tpl = await t.run(async (ctx) => ctx.db.get(result.templateId));
    expect(tpl?.htmlTemplate).toBe(REAL_HTML);
    expect(tpl?.contentStatus).toBe("ready");
    expect(tpl?.orgId).toBeUndefined();
    expect(tpl?.version).toBe(1);
  });

  it("updates existing template + bumps version when one exists", async () => {
    const t = convexTest(schema);
    const { serviceId, subserviceId } = await setup(t);

    const existingId = await t.run(async (ctx) =>
      ctx.db.insert("deliverableTemplates", {
        orgId: undefined,
        serviceId,
        serviceName: "Legal",
        subserviceId,
        type: "deliverable_long",
        name: "Old name",
        htmlTemplate: PLACEHOLDER_HTML,
        variables: [],
        version: 1,
        isActive: true,
        contentStatus: "placeholder",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    );

    const result = await t.mutation(
      internal.functions.deliverableTemplates.bulkImport.upsertFromFile,
      {
        parentServiceName: "Legal",
        subserviceSlug: "asesoria-legal",
        type: "deliverable_long",
        name: "New name",
        htmlTemplate: REAL_HTML,
      }
    );

    expect(result.action).toBe("updated");
    expect(result.templateId).toBe(existingId);
    expect(result.contentStatus).toBe("ready");

    const tpl = await t.run(async (ctx) => ctx.db.get(existingId));
    expect(tpl?.name).toBe("New name");
    expect(tpl?.htmlTemplate).toBe(REAL_HTML);
    expect(tpl?.contentStatus).toBe("ready");
    expect(tpl?.version).toBe(2);
  });

  it("throws when subservice slug not found", async () => {
    const t = convexTest(schema);
    await setup(t);

    await expect(
      t.mutation(internal.functions.deliverableTemplates.bulkImport.upsertFromFile, {
        parentServiceName: "Legal",
        subserviceSlug: "no-existe",
        type: "deliverable_long",
        name: "x",
        htmlTemplate: REAL_HTML,
      })
    ).rejects.toThrow(/Subservice .* not found/);
  });

  it("throws when parent service not found", async () => {
    const t = convexTest(schema);
    await setup(t);

    await expect(
      t.mutation(internal.functions.deliverableTemplates.bulkImport.upsertFromFile, {
        parentServiceName: "NoExiste",
        subserviceSlug: "asesoria-legal",
        type: "deliverable_long",
        name: "x",
        htmlTemplate: REAL_HTML,
      })
    ).rejects.toThrow(/Service .* not found/);
  });
});
