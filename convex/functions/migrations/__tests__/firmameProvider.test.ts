import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal } from "../../../_generated/api";
import schema from "../../../schema";

describe("migrations.firmameProvider.migrate", () => {
  it("converts other+firmame label rows to provider='firmame'", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgIntegrations", {
        orgId: "org_test_1",
        provider: "other",
        providerLabel: "firmame",
        config: { apiKeyMasked: "***1234" },
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("orgIntegrations", {
        orgId: "org_test_2",
        provider: "resend",
        config: {},
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const result = await t.mutation(
      internal.functions.migrations.firmameProvider.migrate,
      { cursor: null, limit: 100 }
    );

    expect(result.migrated).toBe(1);
    expect(result.done).toBe(true);

    await t.run(async (ctx) => {
      const rows = await ctx.db.query("orgIntegrations").collect();
      const fm = rows.find((r) => r.orgId === "org_test_1");
      expect(fm?.provider).toBe("firmame");
      const resend = rows.find((r) => r.orgId === "org_test_2");
      expect(resend?.provider).toBe("resend"); // untouched
    });
  });

  it("is idempotent (re-running does nothing)", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgIntegrations", {
        orgId: "org_test_1",
        provider: "firmame",
        config: {},
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const result = await t.mutation(
      internal.functions.migrations.firmameProvider.migrate,
      { cursor: null, limit: 100 }
    );
    expect(result.migrated).toBe(0);
  });

  it("supports cursor-based pagination across multiple pages", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      for (let i = 0; i < 5; i++) {
        await ctx.db.insert("orgIntegrations", {
          orgId: `org_page_${i}`,
          provider: "other",
          providerLabel: "firmame",
          config: {},
          status: "active",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    });

    // First page: limit 3
    const page1 = await t.mutation(
      internal.functions.migrations.firmameProvider.migrate,
      { cursor: null, limit: 3 }
    );
    expect(page1.done).toBe(false);
    expect(page1.migrated).toBe(3);
    expect(page1.nextCursor).toBeTruthy();

    // Second page: remaining 2
    const page2 = await t.mutation(
      internal.functions.migrations.firmameProvider.migrate,
      { cursor: page1.nextCursor, limit: 3 }
    );
    expect(page2.done).toBe(true);
    expect(page2.migrated).toBe(2);

    // All rows should now be firmame
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("orgIntegrations").collect();
      expect(rows.every((r) => r.provider === "firmame")).toBe(true);
    });
  });
});
