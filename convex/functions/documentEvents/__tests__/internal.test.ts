import { describe, it, expect } from "vitest";
import { setupTest, ORG_A } from "../../../../tests/harness";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

describe("documentEvents.internal.logEventMutation", () => {
  it("inserts a row with createdAt close to now and default severity=info", async () => {
    const t = setupTest();
    const before = Date.now();

    // Need a real clientId for the optional clientId field.
    const clientId = await t.run(async (ctx) =>
      ctx.db.insert("clients", {
        orgId: ORG_A,
        name: "C",
        rfc: "C240115ABC",
        industry: "x",
        annualRevenue: 1,
        billingFrequency: "mensual" as const,
        isArchived: false,
        createdAt: Date.now(),
      })
    );

    await t.mutation(
      internal.functions.documentEvents.internal.logEventMutation,
      {
        orgId: ORG_A,
        clientId: clientId as Id<"clients">,
        entityType: "invoice",
        entityId: "abc123",
        eventType: "uploaded",
        actorType: "user",
        actorUserId: "u_1",
        message: "Factura subida",
        // severity omitted → should default to "info"
        metadata: { amount: 100 },
      }
    );

    const events = await t.run(async (ctx) =>
      ctx.db.query("documentEvents").collect()
    );
    expect(events.length).toBe(1);
    const e = events[0];
    expect(e.severity).toBe("info");
    expect(e.message).toBe("Factura subida");
    expect(e.eventType).toBe("uploaded");
    expect(e.entityType).toBe("invoice");
    expect(e.actorType).toBe("user");
    expect(e.actorUserId).toBe("u_1");
    expect(e.createdAt).toBeGreaterThanOrEqual(before);
    expect(e.createdAt).toBeLessThanOrEqual(Date.now() + 1000);
    expect((e.metadata as { amount?: number } | undefined)?.amount).toBe(100);
  });
});
