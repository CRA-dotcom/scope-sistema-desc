import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal } from "../../../_generated/api";
import schema from "../../../schema";

const PLACEHOLDER_HTML = `<div class="placeholder">x</div>`;
const REAL_HTML = `<h1>Real</h1>`;

async function seedFixtures(t: ReturnType<typeof convexTest>) {
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
    const t1 = await ctx.db.insert("deliverableTemplates", {
      orgId: undefined,
      serviceId,
      serviceName: "TI",
      type: "deliverable_long",
      name: "A (placeholder)",
      htmlTemplate: PLACEHOLDER_HTML,
      variables: [],
      version: 1,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const t2 = await ctx.db.insert("deliverableTemplates", {
      orgId: undefined,
      serviceId,
      serviceName: "TI",
      type: "deliverable_long",
      name: "B (real)",
      htmlTemplate: REAL_HTML,
      variables: [],
      version: 1,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const t3 = await ctx.db.insert("deliverableTemplates", {
      orgId: undefined,
      serviceId,
      serviceName: "TI",
      type: "deliverable_long",
      name: "C (already set)",
      htmlTemplate: REAL_HTML,
      variables: [],
      version: 1,
      isActive: true,
      contentStatus: "ready",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { t1, t2, t3 };
  });
}

describe("migrations.templateContentStatus.migrate", () => {
  it("dry run reports counts without patching", async () => {
    const t = convexTest(schema);
    await seedFixtures(t);

    const result = await t.mutation(
      internal.functions.migrations.templateContentStatus.migrate,
      { dryRun: true }
    );

    expect(result.dryRun).toBe(true);
    expect(result.templates).toBe(2);

    const tpls = await t.run(async (ctx) =>
      ctx.db.query("deliverableTemplates").collect()
    );
    expect(tpls.filter((t) => !t.contentStatus).length).toBe(2);
  });

  it("apply patches each row with correct derived status", async () => {
    const t = convexTest(schema);
    const { t1, t2 } = await seedFixtures(t);

    await t.mutation(
      internal.functions.migrations.templateContentStatus.migrate,
      { dryRun: false }
    );

    const tpl1 = await t.run(async (ctx) => ctx.db.get(t1));
    const tpl2 = await t.run(async (ctx) => ctx.db.get(t2));
    expect(tpl1?.contentStatus).toBe("placeholder");
    expect(tpl2?.contentStatus).toBe("ready");
  });

  it("is idempotent — second run patches 0 rows", async () => {
    const t = convexTest(schema);
    await seedFixtures(t);

    await t.mutation(internal.functions.migrations.templateContentStatus.migrate, { dryRun: false });
    const second = await t.mutation(
      internal.functions.migrations.templateContentStatus.migrate,
      { dryRun: false }
    );

    expect(second.templates).toBe(0);
  });

  it("verifyComplete returns 0 pending after apply", async () => {
    const t = convexTest(schema);
    await seedFixtures(t);
    await t.mutation(internal.functions.migrations.templateContentStatus.migrate, { dryRun: false });

    const verify = await t.query(
      internal.functions.migrations.templateContentStatus.verifyComplete,
      {}
    );
    expect(verify.templatesPending).toBe(0);
  });
});
