import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import schema from "../../../schema";

describe("projections.create with previousProjectionId branches to replaceProjection", () => {
  it("re-edit path: deletes downstream + rebuilds projectionServices + logs event", async () => {
    const t = convexTest(schema);
    const asAdmin = t.withIdentity({
      subject: "user_admin_1",
      tokenIdentifier: "test|user_admin_1",
      org_id: "org_a",
      org_role: "org:admin",
    });

    const { projectionId, projServiceId, clientId } = await t.run(
      async (ctx) => {
        await ctx.db.insert("orgConfigs", {
          orgId: "org_a",
          calculationMode: "weighted" as const,
          commissionMode: "proportional" as const,
          seasonalityEnabled: true,
          featureFlags: {
            advancedConfigVisible: true,
            customServicesVisible: true,
            seasonalityEditable: true,
            manualOverrideAllowed: true,
          },
          notificationEmail: undefined,
          updatedAt: Date.now(),
        });

        const clientId = await ctx.db.insert("clients", {
          orgId: "org_a",
          name: "X",
          rfc: "AAA010101AAA",
          industry: "tecnologia",
          annualRevenue: 1_000_000,
          billingFrequency: "mensual" as const,
          isArchived: false,
          assignedTo: "user_admin_1",
          createdAt: Date.now(),
        });

        const serviceId = await ctx.db.insert("services", {
          orgId: "org_a",
          name: "Contabilidad",
          type: "base" as const,
          minPct: 0,
          maxPct: 100,
          defaultPct: 50,
          isDefault: true,
          sortOrder: 1,
        });

        const projectionId = await ctx.db.insert("projections", {
          orgId: "org_a",
          clientId,
          year: 2026,
          annualSales: 1_000_000,
          totalBudget: 100_000,
          commissionRate: 0,
          seasonalityData: [],
          status: "active" as const,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // Seed one projectionService
        const projServiceId = await ctx.db.insert("projectionServices", {
          orgId: "org_a",
          projectionId,
          serviceId,
          serviceName: "Contabilidad",
          chosenPct: 50,
          isActive: true,
          annualAmount: 50_000,
          normalizedWeight: 1,
          pricingModel: "fixed_retainer" as const,
        });

        // Seed one quotation referencing the projectionService
        await ctx.db.insert("quotations", {
          orgId: "org_a",
          projServiceId,
          clientId,
          serviceName: "Test Service",
          content: "Draft quotation content",
          status: "draft" as const,
          createdAt: Date.now(),
        });

        return { projectionId, projServiceId, clientId };
      }
    );

    // Call create with previousProjectionId set — triggers replaceProjection
    await asAdmin.mutation(api.functions.projections.mutations.create, {
      clientId,
      year: 2026,
      annualSales: 1_000_000,
      totalBudget: 100_000,
      commissionRate: 0,
      seasonalityData: [],
      serviceConfigs: [],
      previousProjectionId: projectionId,
    });

    await t.run(async (ctx) => {
      // Old projectionService should be deleted
      const oldPs = await ctx.db.get(projServiceId);
      expect(oldPs).toBeNull();

      // Quotation referencing the old projectionService should be cleared
      const quotes = await ctx.db
        .query("quotations")
        .withIndex("by_projServiceId", (q) =>
          q.eq("projServiceId", projServiceId)
        )
        .collect();
      expect(quotes).toHaveLength(0);

      // The projection itself should still exist (re-used, not recreated)
      const proj = await ctx.db.get(projectionId);
      expect(proj).toBeTruthy();

      // Audit log: "projection re-edited" event
      const events = await ctx.db
        .query("documentEvents")
        .withIndex("by_orgId_entityType_entityId", (q2) =>
          q2
            .eq("orgId", "org_a")
            .eq("entityType", "projection")
            .eq("entityId", projectionId)
        )
        .collect();
      expect(events.some((e) => e.message?.includes("re-edit"))).toBe(true);
    });
  });

  it("throws when re-editing an archived projection", async () => {
    const t = convexTest(schema);
    const asAdmin = t.withIdentity({
      subject: "user_admin_1",
      tokenIdentifier: "test|user_admin_1",
      org_id: "org_a",
      org_role: "org:admin",
    });

    const { projectionId, clientId } = await t.run(async (ctx) => {
      await ctx.db.insert("orgConfigs", {
        orgId: "org_a",
        calculationMode: "weighted" as const,
        commissionMode: "proportional" as const,
        seasonalityEnabled: true,
        featureFlags: {
          advancedConfigVisible: true,
          customServicesVisible: true,
          seasonalityEditable: true,
          manualOverrideAllowed: true,
        },
        updatedAt: Date.now(),
      });
      const clientId = await ctx.db.insert("clients", {
        orgId: "org_a",
        name: "X",
        rfc: "AAA010101AAA",
        industry: "tecnologia",
        annualRevenue: 1_000_000,
        billingFrequency: "mensual" as const,
        isArchived: false,
        assignedTo: "user_admin_1",
        createdAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: "org_a",
        clientId,
        year: 2026,
        annualSales: 1_000_000,
        totalBudget: 100_000,
        commissionRate: 0,
        seasonalityData: [],
        status: "archived" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return { projectionId, clientId };
    });

    await expect(
      asAdmin.mutation(api.functions.projections.mutations.create, {
        clientId,
        year: 2026,
        annualSales: 1_000_000,
        totalBudget: 100_000,
        commissionRate: 0,
        seasonalityData: [],
        serviceConfigs: [],
        previousProjectionId: projectionId,
      })
    ).rejects.toThrow(/archivada/i);
  });

  it("throws when re-edit has add-on projectionServices", async () => {
    const t = convexTest(schema);
    const asAdmin = t.withIdentity({
      subject: "user_admin_1",
      tokenIdentifier: "test|user_admin_1",
      org_id: "org_a",
      org_role: "org:admin",
    });

    const { projectionId, clientId } = await t.run(async (ctx) => {
      await ctx.db.insert("orgConfigs", {
        orgId: "org_a",
        calculationMode: "weighted" as const,
        commissionMode: "proportional" as const,
        seasonalityEnabled: true,
        featureFlags: {
          advancedConfigVisible: true,
          customServicesVisible: true,
          seasonalityEditable: true,
          manualOverrideAllowed: true,
        },
        updatedAt: Date.now(),
      });
      const clientId = await ctx.db.insert("clients", {
        orgId: "org_a",
        name: "X",
        rfc: "AAA010101AAA",
        industry: "tecnologia",
        annualRevenue: 1_000_000,
        billingFrequency: "mensual" as const,
        isArchived: false,
        assignedTo: "user_admin_1",
        createdAt: Date.now(),
      });
      const serviceId = await ctx.db.insert("services", {
        orgId: "org_a",
        name: "Contabilidad",
        type: "base" as const,
        minPct: 0,
        maxPct: 100,
        defaultPct: 50,
        isDefault: true,
        sortOrder: 1,
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: "org_a",
        clientId,
        year: 2026,
        annualSales: 1_000_000,
        totalBudget: 100_000,
        commissionRate: 0,
        seasonalityData: [],
        status: "active" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      // Seed a base projectionService
      const basePsId = await ctx.db.insert("projectionServices", {
        orgId: "org_a",
        projectionId,
        serviceId,
        serviceName: "Contabilidad",
        chosenPct: 50,
        isActive: true,
        annualAmount: 50_000,
        normalizedWeight: 1,
        pricingModel: "fixed_retainer" as const,
      });
      // Seed an add-on service referencing the base
      await ctx.db.insert("projectionServices", {
        orgId: "org_a",
        projectionId,
        serviceId,
        serviceName: "Contabilidad Add-on",
        chosenPct: 0,
        isActive: true,
        annualAmount: 10_000,
        normalizedWeight: 0,
        pricingModel: "fixed_retainer" as const,
        addOnOfProjectionServiceId: basePsId,
        startMonth: 6,
        endMonth: 12,
      });
      return { projectionId, clientId };
    });

    await expect(
      asAdmin.mutation(api.functions.projections.mutations.create, {
        clientId,
        year: 2026,
        annualSales: 1_000_000,
        totalBudget: 100_000,
        commissionRate: 0,
        seasonalityData: [],
        serviceConfigs: [],
        previousProjectionId: projectionId,
      })
    ).rejects.toThrow(/add-on/i);
  });

  it("re-edit deletes questionnaireResponses", async () => {
    const t = convexTest(schema);
    const asAdmin = t.withIdentity({
      subject: "user_admin_1",
      tokenIdentifier: "test|user_admin_1",
      org_id: "org_a",
      org_role: "org:admin",
    });

    const { projectionId, clientId, questionnaireId } = await t.run(async (ctx) => {
      await ctx.db.insert("orgConfigs", {
        orgId: "org_a",
        calculationMode: "weighted" as const,
        commissionMode: "proportional" as const,
        seasonalityEnabled: true,
        featureFlags: {
          advancedConfigVisible: true,
          customServicesVisible: true,
          seasonalityEditable: true,
          manualOverrideAllowed: true,
        },
        updatedAt: Date.now(),
      });
      const clientId = await ctx.db.insert("clients", {
        orgId: "org_a",
        name: "X",
        rfc: "AAA010101AAA",
        industry: "tecnologia",
        annualRevenue: 1_000_000,
        billingFrequency: "mensual" as const,
        isArchived: false,
        assignedTo: "user_admin_1",
        createdAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: "org_a",
        clientId,
        year: 2026,
        annualSales: 1_000_000,
        totalBudget: 100_000,
        commissionRate: 0,
        seasonalityData: [],
        status: "active" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      // Seed a questionnaireResponse tied to this projection
      const questionnaireId = await ctx.db.insert("questionnaireResponses", {
        orgId: "org_a",
        clientId,
        projectionId,
        responses: [],
        status: "draft" as const,
        createdAt: Date.now(),
      });
      return { projectionId, clientId, questionnaireId };
    });

    await asAdmin.mutation(api.functions.projections.mutations.create, {
      clientId,
      year: 2026,
      annualSales: 1_000_000,
      totalBudget: 100_000,
      commissionRate: 0,
      seasonalityData: [],
      serviceConfigs: [],
      previousProjectionId: projectionId,
    });

    await t.run(async (ctx) => {
      const qr = await ctx.db.get(questionnaireId);
      expect(qr).toBeNull();
    });
  });

  it("re-edit logs actorUserId in documentEvents", async () => {
    const t = convexTest(schema);
    const asAdmin = t.withIdentity({
      subject: "user_admin_1",
      tokenIdentifier: "test|user_admin_1",
      org_id: "org_a",
      org_role: "org:admin",
    });

    const { projectionId, clientId } = await t.run(async (ctx) => {
      await ctx.db.insert("orgConfigs", {
        orgId: "org_a",
        calculationMode: "weighted" as const,
        commissionMode: "proportional" as const,
        seasonalityEnabled: true,
        featureFlags: {
          advancedConfigVisible: true,
          customServicesVisible: true,
          seasonalityEditable: true,
          manualOverrideAllowed: true,
        },
        updatedAt: Date.now(),
      });
      const clientId = await ctx.db.insert("clients", {
        orgId: "org_a",
        name: "X",
        rfc: "AAA010101AAA",
        industry: "tecnologia",
        annualRevenue: 1_000_000,
        billingFrequency: "mensual" as const,
        isArchived: false,
        assignedTo: "user_admin_1",
        createdAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: "org_a",
        clientId,
        year: 2026,
        annualSales: 1_000_000,
        totalBudget: 100_000,
        commissionRate: 0,
        seasonalityData: [],
        status: "active" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return { projectionId, clientId };
    });

    await asAdmin.mutation(api.functions.projections.mutations.create, {
      clientId,
      year: 2026,
      annualSales: 1_000_000,
      totalBudget: 100_000,
      commissionRate: 0,
      seasonalityData: [],
      serviceConfigs: [],
      previousProjectionId: projectionId,
    });

    await t.run(async (ctx) => {
      const events = await ctx.db
        .query("documentEvents")
        .withIndex("by_orgId_entityType_entityId", (q2) =>
          q2
            .eq("orgId", "org_a")
            .eq("entityType", "projection")
            .eq("entityId", projectionId)
        )
        .collect();
      const reEditEvent = events.find((e) => e.message?.includes("re-edit"));
      expect(reEditEvent).toBeTruthy();
      expect(reEditEvent?.actorUserId).toBe("user_admin_1");
    });
  });

  it("re-edit keeps projection.status as active (commit nace activo)", async () => {
    const t = convexTest(schema);
    const asAdmin = t.withIdentity({
      subject: "user_admin_1",
      tokenIdentifier: "test|user_admin_1",
      org_id: "org_a",
      org_role: "org:admin",
    });

    const { projectionId, clientId } = await t.run(async (ctx) => {
      await ctx.db.insert("orgConfigs", {
        orgId: "org_a",
        calculationMode: "weighted" as const,
        commissionMode: "proportional" as const,
        seasonalityEnabled: true,
        featureFlags: {
          advancedConfigVisible: true,
          customServicesVisible: true,
          seasonalityEditable: true,
          manualOverrideAllowed: true,
        },
        updatedAt: Date.now(),
      });
      const clientId = await ctx.db.insert("clients", {
        orgId: "org_a",
        name: "X",
        rfc: "AAA010101AAA",
        industry: "tecnologia",
        annualRevenue: 1_000_000,
        billingFrequency: "mensual" as const,
        isArchived: false,
        assignedTo: "user_admin_1",
        createdAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId: "org_a",
        clientId,
        year: 2026,
        annualSales: 1_000_000,
        totalBudget: 100_000,
        commissionRate: 0,
        seasonalityData: [],
        status: "active" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return { projectionId, clientId };
    });

    await asAdmin.mutation(api.functions.projections.mutations.create, {
      clientId,
      year: 2026,
      annualSales: 1_000_000,
      totalBudget: 100_000,
      commissionRate: 0,
      seasonalityData: [],
      serviceConfigs: [],
      previousProjectionId: projectionId,
    });

    await t.run(async (ctx) => {
      const proj = await ctx.db.get(projectionId);
      expect(proj?.status).toBe("active");
    });
  });

  it("throws when re-edit targets a projection from another org", async () => {
    const t = convexTest(schema);
    const asOtherOrg = t.withIdentity({
      subject: "user_admin_other",
      tokenIdentifier: "test|user_admin_other",
      org_id: "org_other",
      org_role: "org:admin",
    });

    const { projectionId, otherClientId } = await t.run(async (ctx) => {
      await ctx.db.insert("orgConfigs", {
        orgId: "org_other",
        calculationMode: "weighted" as const,
        commissionMode: "proportional" as const,
        seasonalityEnabled: true,
        featureFlags: {
          advancedConfigVisible: true,
          customServicesVisible: true,
          seasonalityEditable: true,
          manualOverrideAllowed: true,
        },
        updatedAt: Date.now(),
      });
      const victimClientId = await ctx.db.insert("clients", {
        orgId: "org_a",
        name: "Victim",
        rfc: "BBB010101BBB",
        industry: "X",
        annualRevenue: 1,
        billingFrequency: "mensual" as const,
        isArchived: false,
        assignedTo: "u",
        createdAt: Date.now(),
      });
      const victimProjectionId = await ctx.db.insert("projections", {
        orgId: "org_a",
        clientId: victimClientId,
        year: 2026,
        annualSales: 1_000_000,
        totalBudget: 100_000,
        commissionRate: 0,
        seasonalityData: [],
        status: "active" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      // Attacker has their own client in org_other to pass the client.orgId check
      // if it ran first — but the re-edit branch should reject before that.
      const attackerClientId = await ctx.db.insert("clients", {
        orgId: "org_other",
        name: "Attacker",
        rfc: "CCC010101CCC",
        industry: "X",
        annualRevenue: 1,
        billingFrequency: "mensual" as const,
        isArchived: false,
        assignedTo: "u",
        createdAt: Date.now(),
      });
      return { projectionId: victimProjectionId, otherClientId: attackerClientId };
    });

    await expect(
      asOtherOrg.mutation(api.functions.projections.mutations.create, {
        clientId: otherClientId,
        year: 2026,
        annualSales: 1_000_000,
        totalBudget: 100_000,
        commissionRate: 0,
        seasonalityData: [],
        serviceConfigs: [],
        previousProjectionId: projectionId,
      })
    ).rejects.toThrow(/no encontrada/i);
  });
});
