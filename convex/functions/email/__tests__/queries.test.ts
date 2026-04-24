import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../../tests/harness";

function admin(orgId: string) {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `user_admin_${orgId}`,
    orgId,
    orgRole: "org:admin",
  };
}
function member(orgId: string, userId: string) {
  return {
    tokenIdentifier: `test|member_${userId}`,
    subject: userId,
    orgId,
    orgRole: "org:member",
  };
}

async function seedLog(
  t: ReturnType<typeof setupTest>,
  overrides: Record<string, unknown> = {}
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("emailLog", {
      orgId: ORG_A,
      type: "custom" as const,
      direction: "outbound" as const,
      fromEmail: "from@ejemplo.com",
      toEmail: "to@ejemplo.com",
      subject: "Asunto test",
      status: "sent" as const,
      provider: "resend",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    })
  );
}

describe("email.queries.list", () => {
  it("admin sees all emailLog rows in their org", async () => {
    const t = setupTest();
    await seedLog(t);
    await seedLog(t);
    await seedLog(t, { type: "quotation" as const });
    const rows = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.email.queries.list, {});
    expect(rows.length).toBe(3);
  });

  it("filters by status and type", async () => {
    const t = setupTest();
    await seedLog(t, { status: "bounced" as const, type: "quotation" as const });
    await seedLog(t, { status: "sent" as const });
    const bounced = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.email.queries.list, { status: "bounced" });
    expect(bounced.length).toBe(1);
    const quotations = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.email.queries.list, { type: "quotation" });
    expect(quotations.length).toBe(1);
  });

  it("search matches toEmail and subject", async () => {
    const t = setupTest();
    await seedLog(t, { toEmail: "acme@cliente.com", subject: "Cotización agosto" });
    await seedLog(t, { toEmail: "other@cliente.com", subject: "Otro asunto" });
    const search = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.email.queries.list, { search: "acme" });
    expect(search.length).toBe(1);
    expect(search[0].toEmail).toBe("acme@cliente.com");
  });

  it("ejecutivo only sees emails tied to their clients", async () => {
    const t = setupTest();
    const userId = "user_X";
    const mineClient = await t.run(async (ctx) =>
      ctx.db.insert("clients", {
        orgId: ORG_A,
        name: "Mine",
        rfc: "MIN100101ABC",
        industry: "Servicios",
        annualRevenue: 100,
        billingFrequency: "mensual" as const,
        isArchived: false,
        assignedTo: userId,
        createdAt: Date.now(),
      })
    );
    const otherClient = await t.run(async (ctx) =>
      ctx.db.insert("clients", {
        orgId: ORG_A,
        name: "Other",
        rfc: "OTR100101ABC",
        industry: "Servicios",
        annualRevenue: 100,
        billingFrequency: "mensual" as const,
        isArchived: false,
        assignedTo: "someone_else",
        createdAt: Date.now(),
      })
    );
    await seedLog(t, { clientId: mineClient });
    await seedLog(t, { clientId: otherClient });
    await seedLog(t);
    const rows = await t
      .withIdentity(member(ORG_A, userId))
      .query(api.functions.email.queries.list, {});
    expect(rows.length).toBe(1);
  });

  it("getById returns null for id of another org", async () => {
    const t = setupTest();
    const otherOrgLogId = await t.run(async (ctx) =>
      ctx.db.insert("emailLog", {
        orgId: "org_OTHER",
        type: "custom" as const,
        direction: "outbound" as const,
        fromEmail: "x@y.com",
        toEmail: "a@b.com",
        subject: "x",
        status: "sent" as const,
        provider: "resend",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    );
    const result = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.email.queries.getById, { id: otherOrgLogId });
    expect(result).toBeNull();
  });

  it("getEvents returns timeline sorted by occurredAt", async () => {
    const t = setupTest();
    const logId = await seedLog(t, { providerMessageId: "re_timeline" });
    const t2 = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("emailEvents", {
        orgId: ORG_A,
        emailLogId: logId,
        providerMessageId: "re_timeline",
        provider: "resend",
        eventType: "delivered",
        occurredAt: t2 + 100,
        createdAt: t2 + 100,
      });
      await ctx.db.insert("emailEvents", {
        orgId: ORG_A,
        emailLogId: logId,
        providerMessageId: "re_timeline",
        provider: "resend",
        eventType: "sent",
        occurredAt: t2,
        createdAt: t2,
      });
    });
    const events = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.email.queries.getEvents, { emailLogId: logId });
    expect(events.map((e) => e.eventType)).toEqual(["sent", "delivered"]);
  });
});
