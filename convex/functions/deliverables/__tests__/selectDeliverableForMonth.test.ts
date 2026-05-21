import { describe, it, expect } from "vitest";
import { setupTest, ORG_A } from "../../../../tests/harness";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

type Frequency =
  | "mensual"
  | "trimestral"
  | "semestral"
  | "anual"
  | "una_vez";

async function seedSubservice(
  t: ReturnType<typeof setupTest>,
  orgId: string,
  defaultFrequency: Frequency,
  opts: {
    applicableMonths?: number[];
    cooldownMonths?: number;
    serviceName?: string;
  } = {}
): Promise<{
  clientId: Id<"clients">;
  serviceId: Id<"services">;
  subserviceId: Id<"subservices">;
  templateId: Id<"deliverableTemplates">;
}> {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId,
      name: "C",
      rfc: "C240115ABC",
      industry: "x",
      annualRevenue: 1,
      billingFrequency: "mensual" as const,
      isArchived: false,
      createdAt: Date.now(),
    });
    const serviceId = await ctx.db.insert("services", {
      orgId,
      name: "Marketing",
      type: "base" as const,
      minPct: 0.1,
      maxPct: 0.3,
      defaultPct: 0.18,
      isDefault: true,
      sortOrder: 1,
    });
    const subserviceId = await ctx.db.insert("subservices", {
      orgId,
      parentServiceId: serviceId,
      name: "Boletín",
      slug: `b-${defaultFrequency}`,
      defaultFrequency,
      applicableMonths: opts.applicableMonths,
      cooldownMonths: opts.cooldownMonths,
      isActive: true,
      isDefault: true,
      sortOrder: 10,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const templateId = await ctx.db.insert("deliverableTemplates", {
      orgId,
      serviceName: opts.serviceName ?? "Marketing",
      subserviceId,
      type: "deliverable_short" as const,
      name: "tpl",
      htmlTemplate: "<p/>",
      variables: [],
      version: 1,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { clientId, serviceId, subserviceId, templateId };
  });
}

describe("selectDeliverableForMonth", () => {
  it("mensual: matches any month", async () => {
    const t = setupTest();
    const { clientId, subserviceId, templateId } = await seedSubservice(
      t,
      ORG_A,
      "mensual"
    );

    for (const month of [1, 4, 7, 10, 12]) {
      const result = await t.query(
        internal.functions.deliverables.internalQueries
          .selectDeliverableForMonth,
        {
          orgId: ORG_A,
          clientId,
          subserviceId,
          month,
          year: 2026,
          projectionMode: "rolling",
          templateType: "deliverable_short",
        }
      );
      expect(result).not.toBeNull();
      expect(result!.template._id).toBe(templateId);
      expect(result!.reason).toBe("monthly");
    }
  });

  it("trimestral: matches [3,6,9,12], null otherwise", async () => {
    const t = setupTest();
    const { clientId, subserviceId, templateId } = await seedSubservice(
      t,
      ORG_A,
      "trimestral"
    );

    const r3 = await t.query(
      internal.functions.deliverables.internalQueries.selectDeliverableForMonth,
      {
        orgId: ORG_A,
        clientId,
        subserviceId,
        month: 3,
        year: 2026,
        projectionMode: "rolling",
        templateType: "deliverable_short",
      }
    );
    expect(r3!.template._id).toBe(templateId);
    expect(r3!.reason).toBe("quarterly_match");

    const r5 = await t.query(
      internal.functions.deliverables.internalQueries.selectDeliverableForMonth,
      {
        orgId: ORG_A,
        clientId,
        subserviceId,
        month: 5,
        year: 2026,
        projectionMode: "rolling",
        templateType: "deliverable_short",
      }
    );
    expect(r5).toBeNull();

    const r6 = await t.query(
      internal.functions.deliverables.internalQueries.selectDeliverableForMonth,
      {
        orgId: ORG_A,
        clientId,
        subserviceId,
        month: 6,
        year: 2026,
        projectionMode: "rolling",
        templateType: "deliverable_short",
      }
    );
    expect(r6).not.toBeNull();
  });

  it("anual: matches month=12 only (default)", async () => {
    const t = setupTest();
    const { clientId, subserviceId, templateId } = await seedSubservice(
      t,
      ORG_A,
      "anual"
    );

    const r12 = await t.query(
      internal.functions.deliverables.internalQueries.selectDeliverableForMonth,
      {
        orgId: ORG_A,
        clientId,
        subserviceId,
        month: 12,
        year: 2026,
        projectionMode: "rolling",
        templateType: "deliverable_short",
      }
    );
    expect(r12!.template._id).toBe(templateId);
    expect(r12!.reason).toBe("annual_match");

    const r6 = await t.query(
      internal.functions.deliverables.internalQueries.selectDeliverableForMonth,
      {
        orgId: ORG_A,
        clientId,
        subserviceId,
        month: 6,
        year: 2026,
        projectionMode: "rolling",
        templateType: "deliverable_short",
      }
    );
    expect(r6).toBeNull();
  });

  it("una_vez: returns null if previous deliverable for same subservice exists", async () => {
    const t = setupTest();
    const { clientId, subserviceId } = await seedSubservice(
      t,
      ORG_A,
      "una_vez"
    );

    // No previous → eligible.
    const before = await t.query(
      internal.functions.deliverables.internalQueries.selectDeliverableForMonth,
      {
        orgId: ORG_A,
        clientId,
        subserviceId,
        month: 5,
        year: 2026,
        projectionMode: "rolling",
        templateType: "deliverable_short",
      }
    );
    expect(before).not.toBeNull();
    expect(before!.reason).toBe("one_time_first");

    // Insert a deliverable matching subserviceId (needs real projection IDs).
    await t.run(async (ctx) => {
      const projectionId = await ctx.db.insert("projections", {
        orgId: ORG_A,
        clientId,
        year: 2026,
        annualSales: 1,
        totalBudget: 1,
        commissionRate: 0,
        seasonalityData: [],
        status: "active" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      // Re-use the serviceId from seedSubservice via lookup.
      const services = await ctx.db.query("services").collect();
      const projServiceId = await ctx.db.insert("projectionServices", {
        orgId: ORG_A,
        projectionId,
        serviceId: services[0]._id,
        serviceName: "Marketing",
        subserviceId,
        chosenPct: 0.18,
        isActive: true,
        annualAmount: 1,
        normalizedWeight: 0,
      });
      const assignmentId = await ctx.db.insert("monthlyAssignments", {
        orgId: ORG_A,
        projServiceId,
        projectionId,
        clientId,
        serviceName: "Marketing",
        subserviceId,
        month: 3,
        year: 2026,
        amount: 0,
        feFactor: 1,
        status: "delivered" as const,
        invoiceStatus: "paid" as const,
      });
      await ctx.db.insert("deliverables", {
        orgId: ORG_A,
        assignmentId,
        projServiceId,
        clientId,
        serviceName: "Marketing",
        subserviceId,
        month: 3,
        year: 2026,
        shortContent: "x",
        longContent: "",
        auditStatus: "approved" as const,
        retryCount: 0,
        createdAt: Date.now(),
      });
    });

    const after = await t.query(
      internal.functions.deliverables.internalQueries.selectDeliverableForMonth,
      {
        orgId: ORG_A,
        clientId,
        subserviceId,
        month: 5,
        year: 2026,
        projectionMode: "rolling",
        templateType: "deliverable_short",
      }
    );
    expect(after).toBeNull();
  });

  it("dual-matching: prefers template with subserviceId over serviceName-only", async () => {
    const t = setupTest();
    const seed = await seedSubservice(t, ORG_A, "mensual");

    // Insert a competing serviceName-only template.
    await t.run(async (ctx) =>
      ctx.db.insert("deliverableTemplates", {
        orgId: ORG_A,
        serviceName: "Marketing",
        type: "deliverable_short" as const,
        name: "serviceName-only",
        htmlTemplate: "<p/>",
        variables: [],
        version: 1,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    );

    const result = await t.query(
      internal.functions.deliverables.internalQueries.selectDeliverableForMonth,
      {
        orgId: ORG_A,
        clientId: seed.clientId,
        subserviceId: seed.subserviceId,
        serviceName: "Marketing",
        month: 5,
        year: 2026,
        projectionMode: "rolling",
        templateType: "deliverable_short",
      }
    );
    expect(result).not.toBeNull();
    expect(result!.template._id).toBe(seed.templateId);
  });

  it("B1: respects projectionServices [startMonth, endMonth] window", async () => {
    // Setup: subservice mensual + projectionServices con ventana Jul-Dic.
    const t = setupTest();
    const { clientId, serviceId, subserviceId, templateId } =
      await seedSubservice(t, ORG_A, "mensual");

    const projServiceId = await t.run(async (ctx) => {
      const projectionId = await ctx.db.insert("projections", {
        orgId: ORG_A,
        clientId,
        year: 2026,
        annualSales: 1,
        totalBudget: 1,
        commissionRate: 0,
        seasonalityData: [],
        status: "active" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return await ctx.db.insert("projectionServices", {
        orgId: ORG_A,
        projectionId,
        serviceId,
        serviceName: "Marketing",
        subserviceId,
        chosenPct: 0,
        isActive: true,
        annualAmount: 27_000,
        normalizedWeight: 0,
        startMonth: 7,
        endMonth: 12,
      });
    });

    // Month 6 (outside window): null.
    const r6 = await t.query(
      internal.functions.deliverables.internalQueries
        .selectDeliverableForMonth,
      {
        orgId: ORG_A,
        clientId,
        subserviceId,
        projServiceId,
        month: 6,
        year: 2026,
        projectionMode: "rolling",
        templateType: "deliverable_short",
      }
    );
    expect(r6).toBeNull();

    // Month 8 (inside window): match.
    const r8 = await t.query(
      internal.functions.deliverables.internalQueries
        .selectDeliverableForMonth,
      {
        orgId: ORG_A,
        clientId,
        subserviceId,
        projServiceId,
        month: 8,
        year: 2026,
        projectionMode: "rolling",
        templateType: "deliverable_short",
      }
    );
    expect(r8).not.toBeNull();
    expect(r8!.template._id).toBe(templateId);
    expect(r8!.reason).toBe("monthly");

    // Sanity: without projServiceId, gate is skipped (legacy behavior).
    const r6Legacy = await t.query(
      internal.functions.deliverables.internalQueries
        .selectDeliverableForMonth,
      {
        orgId: ORG_A,
        clientId,
        subserviceId,
        month: 6,
        year: 2026,
        projectionMode: "rolling",
        templateType: "deliverable_short",
      }
    );
    expect(r6Legacy).not.toBeNull();
  });

  it("dual-matching fallback: serviceName when subserviceId is undefined", async () => {
    const t = setupTest();
    const { clientId } = await t.run(async (ctx) => {
      const cid = await ctx.db.insert("clients", {
        orgId: ORG_A,
        name: "Legacy",
        rfc: "LEG240115ABC",
        industry: "x",
        annualRevenue: 1,
        billingFrequency: "mensual" as const,
        isArchived: false,
        createdAt: Date.now(),
      });
      // Insert a serviceName-only template.
      await ctx.db.insert("deliverableTemplates", {
        orgId: ORG_A,
        serviceName: "MarketingLegacy",
        type: "deliverable_short" as const,
        name: "legacy",
        htmlTemplate: "<p/>",
        variables: [],
        version: 1,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return { clientId: cid };
    });

    const result = await t.query(
      internal.functions.deliverables.internalQueries.selectDeliverableForMonth,
      {
        orgId: ORG_A,
        clientId,
        serviceName: "MarketingLegacy",
        month: 5,
        year: 2026,
        projectionMode: "rolling",
        templateType: "deliverable_short",
      }
    );
    expect(result).not.toBeNull();
    expect(result!.template.serviceName).toBe("MarketingLegacy");
    expect(result!.template.subserviceId).toBeUndefined();
  });
});
