import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  organizations: defineTable({
    clerkOrgId: v.string(),
    name: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("inactive"),
      v.literal("suspended")
    ),
    plan: v.union(
      v.literal("basic"),
      v.literal("pro"),
      v.literal("enterprise")
    ),
    assignedServiceIds: v.optional(v.array(v.id("services"))),
    createdAt: v.number(),
  })
    .index("by_clerkOrgId", ["clerkOrgId"])
    .index("by_status", ["status"]),

  clients: defineTable({
    orgId: v.string(),
    name: v.string(),
    rfc: v.string(),
    industry: v.string(),
    annualRevenue: v.number(),
    billingFrequency: v.union(
      v.literal("semanal"),
      v.literal("quincenal"),
      v.literal("mensual")
    ),
    isArchived: v.boolean(),
    assignedTo: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    contactName: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_industry", ["orgId", "industry"])
    .index("by_orgId_assignedTo", ["orgId", "assignedTo"])
    .index("by_orgId_archived", ["orgId", "isArchived"]),

  projections: defineTable({
    orgId: v.string(),
    clientId: v.id("clients"),
    year: v.number(),
    annualSales: v.number(),
    totalBudget: v.number(),
    commissionRate: v.number(),
    seasonalityData: v.array(
      v.object({
        month: v.number(),
        monthlySales: v.number(),
        feFactor: v.number(),
      })
    ),
    seasonalityDeltas: v.optional(
      v.array(
        v.object({
          month: v.number(),
          deltaPercent: v.number(),
        })
      )
    ),
    seasonalityMode: v.optional(
      v.union(v.literal("legacy"), v.literal("delta_percent"))
    ),
    status: v.union(
      v.literal("draft"),
      v.literal("active"),
      v.literal("archived")
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_clientId", ["clientId"])
    .index("by_orgId_year", ["orgId", "year"])
    .index("by_clientId_year", ["clientId", "year"]),

  services: defineTable({
    orgId: v.optional(v.string()),
    name: v.string(),
    type: v.union(v.literal("base"), v.literal("comodin")),
    minPct: v.number(),
    maxPct: v.number(),
    defaultPct: v.number(),
    isDefault: v.boolean(),
    isCommission: v.optional(v.boolean()),
    isCustom: v.optional(v.boolean()),
    sortOrder: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_name", ["name"]),

  projectionServices: defineTable({
    orgId: v.string(),
    projectionId: v.id("projections"),
    serviceId: v.id("services"),
    serviceName: v.string(),
    chosenPct: v.number(),
    isActive: v.boolean(),
    annualAmount: v.number(),
    normalizedWeight: v.number(),
  })
    .index("by_projectionId", ["projectionId"])
    .index("by_orgId", ["orgId"])
    .index("by_projectionId_active", ["projectionId", "isActive"]),

  monthlyAssignments: defineTable({
    orgId: v.string(),
    projServiceId: v.id("projectionServices"),
    projectionId: v.id("projections"),
    clientId: v.id("clients"),
    serviceName: v.string(),
    month: v.number(),
    year: v.number(),
    amount: v.number(),
    feFactor: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("info_received"),
      v.literal("in_progress"),
      v.literal("delivered")
    ),
    invoiceStatus: v.union(
      v.literal("not_invoiced"),
      v.literal("invoiced"),
      v.literal("paid")
    ),
  })
    .index("by_orgId", ["orgId"])
    .index("by_projServiceId", ["projServiceId"])
    .index("by_projectionId", ["projectionId"])
    .index("by_clientId_month", ["clientId", "month"])
    .index("by_orgId_year_month", ["orgId", "year", "month"])
    .index("by_orgId_status", ["orgId", "status"])
    .index("by_orgId_invoiceStatus", ["orgId", "invoiceStatus"]),

  questionnaireResponses: defineTable({
    orgId: v.string(),
    clientId: v.id("clients"),
    projectionId: v.id("projections"),
    responses: v.array(
      v.object({
        questionId: v.string(),
        questionText: v.string(),
        answer: v.string(),
        serviceNames: v.array(v.string()),
      })
    ),
    status: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("in_progress"),
      v.literal("completed")
    ),
    accessToken: v.optional(v.string()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_clientId", ["clientId"])
    .index("by_projectionId", ["projectionId"])
    .index("by_orgId_status", ["orgId", "status"])
    .index("by_accessToken", ["accessToken"]),

  quotations: defineTable({
    orgId: v.string(),
    projServiceId: v.id("projectionServices"),
    clientId: v.id("clients"),
    serviceName: v.string(),
    content: v.string(),
    pdfStorageId: v.optional(v.id("_storage")),
    status: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("approved"),
      v.literal("rejected")
    ),
    createdAt: v.number(),

    // 3B additions
    lastSentAt: v.optional(v.number()),
    sendCount: v.optional(v.number()),
    accessTokenHash: v.optional(v.string()),
    tokenIssuedAt: v.optional(v.number()),
    tokenExpiresAt: v.optional(v.number()),
    respondedAt: v.optional(v.number()),
    declineReason: v.optional(v.string()),
  })
    .index("by_orgId", ["orgId"])
    .index("by_projServiceId", ["projServiceId"])
    .index("by_clientId", ["clientId"])
    .index("by_orgId_status", ["orgId", "status"])
    .index("by_accessTokenHash", ["accessTokenHash"]),

  contracts: defineTable({
    orgId: v.string(),
    quotationId: v.id("quotations"),
    projServiceId: v.id("projectionServices"),
    clientId: v.id("clients"),
    serviceName: v.string(),
    content: v.string(),
    pdfStorageId: v.optional(v.id("_storage")),
    status: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("signed"),
      v.literal("cancelled")
    ),
    signedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_quotationId", ["quotationId"])
    .index("by_clientId", ["clientId"])
    .index("by_orgId_status", ["orgId", "status"]),

  deliverables: defineTable({
    orgId: v.string(),
    assignmentId: v.id("monthlyAssignments"),
    projServiceId: v.id("projectionServices"),
    clientId: v.id("clients"),
    serviceName: v.string(),
    month: v.number(),
    year: v.number(),
    shortContent: v.string(),
    longContent: v.string(),
    shortPdfStorageId: v.optional(v.id("_storage")),
    longPdfStorageId: v.optional(v.id("_storage")),
    auditStatus: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("corrected")
    ),
    auditFeedback: v.optional(v.string()),
    retryCount: v.number(),
    aiLog: v.optional(
      v.array(
        v.object({
          role: v.string(),
          model: v.string(),
          inputTokens: v.number(),
          outputTokens: v.number(),
          costUsd: v.number(),
          timestamp: v.number(),
        })
      )
    ),
    deliveredAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_assignmentId", ["assignmentId"])
    .index("by_clientId", ["clientId"])
    .index("by_orgId_auditStatus", ["orgId", "auditStatus"])
    .index("by_orgId_year_month", ["orgId", "year", "month"]),

  orgConfigs: defineTable({
    orgId: v.string(),
    calculationMode: v.union(
      v.literal("weighted"),
      v.literal("fixed")
    ),
    commissionMode: v.union(
      v.literal("proportional"),
      v.literal("fixed_monthly")
    ),
    seasonalityEnabled: v.boolean(),
    featureFlags: v.object({
      advancedConfigVisible: v.boolean(),
      customServicesVisible: v.boolean(),
      seasonalityEditable: v.boolean(),
      manualOverrideAllowed: v.boolean(),
    }),
    currency: v.optional(v.string()),
    fiscalYearStartMonth: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"]),

  orgBranding: defineTable({
    orgId: v.string(),
    companyName: v.string(),
    logoStorageId: v.optional(v.id("_storage")),
    primaryColor: v.string(),
    secondaryColor: v.string(),
    accentColor: v.optional(v.string()),
    fontFamily: v.string(),
    headerText: v.optional(v.string()),
    footerText: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"]),

  deliverableTemplates: defineTable({
    orgId: v.optional(v.string()),
    serviceId: v.optional(v.id("services")),
    serviceName: v.string(),
    type: v.union(
      v.literal("quotation"),
      v.literal("contract"),
      v.literal("deliverable_short"),
      v.literal("deliverable_long"),
      v.literal("questionnaire")
    ),
    name: v.string(),
    htmlTemplate: v.string(),
    variables: v.array(
      v.object({
        key: v.string(),
        label: v.string(),
        source: v.union(
          v.literal("client"),
          v.literal("projection"),
          v.literal("service"),
          v.literal("ai"),
          v.literal("manual")
        ),
        required: v.boolean(),
      })
    ),
    version: v.number(),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_serviceId", ["serviceId"])
    .index("by_type", ["type"]),

  issuingCompanies: defineTable({
    orgId: v.string(),
    name: v.string(),
    legalName: v.string(),
    rfc: v.string(),
    regimenFiscalCode: v.string(),
    regimenFiscalLabel: v.optional(v.string()),
    codigoPostal: v.string(),
    address: v.object({
      street: v.string(),
      exteriorNumber: v.optional(v.string()),
      interiorNumber: v.optional(v.string()),
      colonia: v.optional(v.string()),
      city: v.string(),
      state: v.string(),
      country: v.string(),
    }),
    email: v.string(),
    phone: v.optional(v.string()),
    website: v.optional(v.string()),
    bankName: v.optional(v.string()),
    bankAccount: v.optional(v.string()),
    clabe: v.optional(v.string()),
    currency: v.optional(v.string()),
    invoiceSerie: v.optional(v.string()),
    logoStorageId: v.optional(v.id("_storage")),
    signatoryName: v.optional(v.string()),
    signatoryTitle: v.optional(v.string()),
    isDefault: v.boolean(),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_rfc", ["orgId", "rfc"])
    .index("by_orgId_isDefault", ["orgId", "isDefault"])
    .index("by_orgId_isActive", ["orgId", "isActive"]),

  servicesIssuingCompanyMap: defineTable({
    orgId: v.string(),
    serviceId: v.id("services"),
    issuingCompanyId: v.id("issuingCompanies"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_serviceId", ["orgId", "serviceId"])
    .index("by_issuingCompanyId", ["issuingCompanyId"]),

  clientIssuingCompanyOverride: defineTable({
    orgId: v.string(),
    clientId: v.id("clients"),
    serviceId: v.id("services"),
    issuingCompanyId: v.id("issuingCompanies"),
    reason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_clientId", ["clientId"])
    .index("by_orgId_client_service", ["orgId", "clientId", "serviceId"])
    .index("by_issuingCompanyId", ["issuingCompanyId"]),

  emailLog: defineTable({
    orgId: v.string(),
    type: v.union(
      v.literal("quotation"),
      v.literal("quotation_reminder"),
      v.literal("contract"),
      v.literal("contract_reminder"),
      v.literal("deliverable"),
      v.literal("questionnaire"),
      v.literal("reminder"),
      v.literal("custom")
    ),
    direction: v.union(v.literal("outbound"), v.literal("inbound")),
    relatedType: v.optional(
      v.union(
        v.literal("quotation"),
        v.literal("contract"),
        v.literal("deliverable"),
        v.literal("questionnaire"),
        v.literal("assignment")
      )
    ),
    relatedId: v.optional(v.string()),
    clientId: v.optional(v.id("clients")),
    issuingCompanyId: v.optional(v.id("issuingCompanies")),
    fromEmail: v.string(),
    fromName: v.optional(v.string()),
    toEmail: v.string(),
    toName: v.optional(v.string()),
    cc: v.optional(v.array(v.string())),
    bcc: v.optional(v.array(v.string())),
    replyTo: v.optional(v.string()),
    subject: v.string(),
    bodyHtml: v.optional(v.string()),
    bodyText: v.optional(v.string()),
    emlStorageId: v.optional(v.id("_storage")),
    attachments: v.optional(
      v.array(
        v.object({
          storageId: v.id("_storage"),
          filename: v.string(),
          contentType: v.optional(v.string()),
        })
      )
    ),
    status: v.union(
      v.literal("queued"),
      v.literal("sent"),
      v.literal("delivered"),
      v.literal("opened"),
      v.literal("clicked"),
      v.literal("bounced"),
      v.literal("complained"),
      v.literal("failed")
    ),
    provider: v.optional(v.string()),
    providerMessageId: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    deliveredAt: v.optional(v.number()),
    openedAt: v.optional(v.number()),
    clickedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_status", ["orgId", "status"])
    .index("by_orgId_type", ["orgId", "type"])
    .index("by_clientId", ["clientId"])
    .index("by_relatedId", ["relatedId"])
    .index("by_providerMessageId", ["providerMessageId"]),

  emailEvents: defineTable({
    orgId: v.string(),
    emailLogId: v.id("emailLog"),
    providerMessageId: v.optional(v.string()),
    provider: v.string(),
    eventType: v.union(
      v.literal("sent"),
      v.literal("delivered"),
      v.literal("delivery_delayed"),
      v.literal("opened"),
      v.literal("clicked"),
      v.literal("bounced"),
      v.literal("complained"),
      v.literal("failed")
    ),
    metadata: v.optional(
      v.object({
        userAgent: v.optional(v.string()),
        ipAddress: v.optional(v.string()),
        link: v.optional(v.string()),
        bounceType: v.optional(v.string()),
        bounceReason: v.optional(v.string()),
      })
    ),
    rawPayload: v.optional(v.string()),
    occurredAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_emailLogId", ["emailLogId"])
    .index("by_providerMessageId", ["providerMessageId"])
    .index("by_orgId_eventType", ["orgId", "eventType"]),

  orgIntegrations: defineTable({
    orgId: v.string(),
    provider: v.union(
      v.literal("resend"),
      v.literal("mifiel"),
      v.literal("anthropic"),
      v.literal("other")
    ),
    providerLabel: v.optional(v.string()),
    config: v.object({
      apiKeySecretRef: v.optional(v.string()),
      apiKeyMasked: v.optional(v.string()),
      webhookSecretRef: v.optional(v.string()),
      webhookUrl: v.optional(v.string()),
      fromEmail: v.optional(v.string()),
      fromName: v.optional(v.string()),
      sandboxMode: v.optional(v.boolean()),
      extra: v.optional(v.string()),
    }),
    status: v.union(
      v.literal("active"),
      v.literal("inactive"),
      v.literal("error"),
      v.literal("pending_verification")
    ),
    lastCheckedAt: v.optional(v.number()),
    lastErrorMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_provider", ["orgId", "provider"])
    .index("by_orgId_status", ["orgId", "status"]),

  satConcepts: defineTable({
    orgId: v.optional(v.string()),
    claveProdServ: v.string(),
    description: v.string(),
    claveUnidad: v.string(),
    unidadLabel: v.optional(v.string()),
    objetoImp: v.optional(
      v.union(
        v.literal("01"),
        v.literal("02"),
        v.literal("03"),
        v.literal("04")
      )
    ),
    serviceIds: v.optional(v.array(v.id("services"))),
    tags: v.optional(v.array(v.string())),
    isDefault: v.boolean(),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_claveProdServ", ["claveProdServ"])
    .index("by_orgId_active", ["orgId", "isActive"])
    .index("by_orgId_isDefault", ["orgId", "isDefault"]),
});
