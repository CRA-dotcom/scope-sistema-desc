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
      v.union(
        v.literal("legacy"),
        v.literal("delta_percent"),
        v.literal("outliers")
      )
    ),
    seasonalityOutliers: v.optional(
      v.array(
        v.object({
          month: v.number(),
          value: v.number(),
          unit: v.union(v.literal("percent"), v.literal("amount")),
        })
      )
    ),
    startMonth: v.optional(v.number()),
    projectionMode: v.optional(
      v.union(v.literal("rolling"), v.literal("fiscal"))
    ),
    monthCount: v.optional(v.number()),
    effectiveBudget: v.optional(v.number()),
    previousProjectionId: v.optional(v.id("projections")),
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

  projectionDrafts: defineTable({
    orgId: v.string(),
    userId: v.string(),
    clientId: v.optional(v.id("clients")),
    state: v.object({
      step: v.number(),
      year: v.optional(v.number()),
      annualSales: v.optional(v.number()),
      totalBudget: v.optional(v.number()),
      commissionRate: v.optional(v.number()),
      startMonth: v.optional(v.number()),
      projectionMode: v.optional(
        v.union(v.literal("rolling"), v.literal("fiscal"))
      ),
      useSeasonality: v.optional(v.boolean()),
      seasonalityDeltas: v.optional(
        v.array(
          v.object({
            month: v.number(),
            deltaPercent: v.number(),
          })
        )
      ),
      seasonalityOutliers: v.optional(
        v.array(
          v.object({
            month: v.number(),
            value: v.number(),
            unit: v.union(v.literal("percent"), v.literal("amount")),
          })
        )
      ),
      serviceStates: v.optional(
        v.array(
          v.object({
            serviceId: v.string(),
            chosenPct: v.number(),
            isActive: v.boolean(),
          })
        )
      ),
      previousProjectionId: v.optional(v.id("projections")),
    }),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_userId_clientId", ["orgId", "userId", "clientId"]),

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

  // A1: padre→hijo de servicios contractuales. Ver
  // docs/superpowers/specs/2026-05-21-subservices-model-design.md §2.1
  subservices: defineTable({
    orgId: v.optional(v.string()),
    parentServiceId: v.id("services"),
    name: v.string(),
    slug: v.string(),
    description: v.optional(v.string()),
    defaultFrequency: v.union(
      v.literal("mensual"),
      v.literal("trimestral"),
      v.literal("semestral"),
      v.literal("anual"),
      v.literal("una_vez")
    ),
    defaultPricingModel: v.optional(
      v.union(
        v.literal("fixed_retainer"),
        v.literal("dynamic_retainer"),
        v.literal("commission"),
        v.literal("one_time")
      )
    ),
    applicableMonths: v.optional(v.array(v.number())),
    cooldownMonths: v.optional(v.number()),
    defaultPricingHint: v.optional(v.number()),
    isCommission: v.optional(v.boolean()),
    isActive: v.boolean(),
    isDefault: v.boolean(),
    sortOrder: v.number(),
    // Copy-on-write tracking (explicit personalizeGlobal, per R1 §12 #2)
    parentSubserviceId: v.optional(v.id("subservices")),
    originalVersionAtClone: v.optional(v.number()),
    // SS6: % discount for year 2+ tier (admin opt-in via wizard).
    yearOverYearDiscount: v.optional(v.number()),
    // SS4: flag para inyectar contexto financiero del cliente al prompt Claude
    // cuando se genera un entregable de este subservicio. Admin opt-in.
    isFinancialRelated: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_parentService", ["orgId", "parentServiceId"])
    // reserved for B1 active-only listing per spec §6.1
    .index("by_orgId_isActive", ["orgId", "isActive"])
    .index("by_parent_slug", ["parentServiceId", "slug"])
    // reserved for D1 super-admin "which orgs personalized this global" view
    .index("by_parentSubserviceId", ["parentSubserviceId"]),

  projectionServices: defineTable({
    orgId: v.string(),
    projectionId: v.id("projections"),
    serviceId: v.id("services"),
    serviceName: v.string(),
    subserviceId: v.optional(v.id("subservices")),
    pricingModel: v.optional(
      v.union(
        v.literal("fixed_retainer"),
        v.literal("dynamic_retainer"),
        v.literal("commission"),
        v.literal("one_time")
      )
    ),
    chosenPct: v.number(),
    isActive: v.boolean(),
    annualAmount: v.number(),
    normalizedWeight: v.number(),
    // B1 — ventana contractual del row.
    // null/undefined = año completo (legacy + servicios base normales);
    //   set = mid-year add-on con ventana específica (julio→dic, etc.).
    // Per docs/superpowers/specs/2026-05-26-client-services-overview-design.md §2.1
    startMonth: v.optional(v.number()),
    endMonth: v.optional(v.number()),
    // Audit trail: si el add-on clona/extiende un row existente.
    addOnOfProjectionServiceId: v.optional(v.id("projectionServices")),
    // Referencia inversa a la cotización suplementaria que originó el row.
    supplementaryQuotationId: v.optional(v.id("quotations")),
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
    subserviceId: v.optional(v.id("subservices")),
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
    isManuallyOverridden: v.optional(v.boolean()),
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
        // D1: new question type support (optional — existing questions default to "text" behaviour)
        type: v.optional(
          v.union(
            v.literal("text"),
            v.literal("textarea"),
            v.literal("select"),
            v.literal("number"),
            v.literal("date"),
            v.literal("file_upload")
          )
        ),
        // D1: file_upload constraints (only meaningful when type === "file_upload")
        fileConfig: v.optional(
          v.object({
            acceptedMimeTypes: v.array(v.string()),
            maxSizeMB: v.number(),
            multiple: v.boolean(),
          })
        ),
        // D1: links this question to deliverable template variables
        templateVariableMappings: v.optional(
          v.array(
            v.object({
              templateId: v.id("deliverableTemplates"),
              variableName: v.string(),
            })
          )
        ),
        // D1: for file_upload answers, holds the original filename alongside the
        //     Convex _storage ID stored in `answer`
        filename: v.optional(v.string()),
        // NEW (master questionnaire v1):
        section: v.optional(v.string()),
        subsection: v.optional(v.string()),
        variableKey: v.optional(v.string()),
        options: v.optional(v.array(v.string())),
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
    reopenedAt: v.optional(v.number()),
    reopenedBy: v.optional(v.string()),  // Clerk userId
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
    subserviceId: v.optional(v.id("subservices")),
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

    // B1 — cotización suplementaria (mid-year add-on).
    // Per docs/superpowers/specs/2026-05-26-client-services-overview-design.md §2.1
    parentQuotationId: v.optional(v.id("quotations")),
    isSupplementary: v.optional(v.boolean()),
    lineItems: v.optional(
      v.array(
        v.object({
          month: v.number(),
          label: v.string(),
          amount: v.number(),
        })
      )
    ),
    totalAmount: v.optional(v.number()),
  })
    .index("by_orgId", ["orgId"])
    .index("by_projServiceId", ["projServiceId"])
    .index("by_clientId", ["clientId"])
    .index("by_orgId_status", ["orgId", "status"])
    .index("by_accessTokenHash", ["accessTokenHash"])
    .index("by_parentQuotationId", ["parentQuotationId"]),

  contracts: defineTable({
    orgId: v.string(),
    quotationId: v.id("quotations"),
    projServiceId: v.id("projectionServices"),
    clientId: v.id("clients"),
    serviceName: v.string(),
    subserviceId: v.optional(v.id("subservices")),
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
    // SS2: Firmame integration
    firmameDocumentId: v.optional(v.string()),
    firmameSignUrl: v.optional(v.string()),
    // TODO(post-MVP): tighten to v.union(v.literal(...)) once Firmame webhook event names are documented
    firmameStatus: v.optional(v.string()),
    // Railway S3 key (NOT a Convex _storage ID — see convex/lib/blobStorage.ts)
    signedPdfBucketKey: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    lastReminderAt: v.optional(v.number()),
    reminderCount: v.optional(v.number()),
    // snapshot from template at send time; template may mutate later
    signerMode: v.optional(
      v.union(
        v.literal("client_only"),
        v.literal("co_sign")
      )
    ),
    cancellationReason: v.optional(v.string()),
  })
    .index("by_orgId", ["orgId"])
    .index("by_quotationId", ["quotationId"])
    .index("by_projServiceId", ["projServiceId"])
    .index("by_clientId", ["clientId"])
    .index("by_orgId_status", ["orgId", "status"])
    .index("by_firmameDocumentId", ["firmameDocumentId"]),

  deliverables: defineTable({
    orgId: v.string(),
    assignmentId: v.id("monthlyAssignments"),
    projServiceId: v.id("projectionServices"),
    clientId: v.id("clients"),
    serviceName: v.string(),
    subserviceId: v.optional(v.id("subservices")),
    month: v.number(),
    year: v.number(),
    shortContent: v.string(),
    longContent: v.string(),
    shortPdfStorageId: v.optional(v.id("_storage")),
    longPdfStorageId: v.optional(v.id("_storage")),
    // A2: snapshot por valor (R1 decisión #1). Reproducibilidad histórica del
    // entregable aunque la plantilla mute. Legacy rows tienen undefined.
    templateId: v.optional(v.id("deliverableTemplates")),
    templateVersion: v.optional(v.number()),
    templateHtmlSnapshot: v.optional(v.string()),
    // A3: origen del trigger (R1 decisión #5). Legacy rows tienen undefined.
    triggerSource: v.optional(
      v.union(
        v.literal("manual"),
        v.literal("cron"),
        v.literal("invoice_paid"),
        v.literal("api")
      )
    ),
    // A3: factura origen cuando triggerSource === "invoice_paid".
    triggerInvoiceId: v.optional(v.id("invoices")),
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
    .index("by_projServiceId", ["projServiceId"])
    .index("by_clientId", ["clientId"])
    .index("by_orgId_auditStatus", ["orgId", "auditStatus"])
    .index("by_orgId_year_month", ["orgId", "year", "month"])
    // A2: "qué deliverables usan esta plantilla" para banner y restoreToGlobal
    .index("by_templateId", ["templateId"])
    // A3: idempotencia en generateFromInvoice
    .index("by_triggerInvoiceId", ["triggerInvoiceId"]),

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
    notificationEmail: v.optional(v.string()),
    // A3 (R1 decisión #13): IANA timezone (ej. "America/Mexico_City").
    // Default UTC si null/undefined. Usado por el cron de eligibility para
    // computar "hoy" en zona local de cada org (sáb-dom skip).
    timezone: v.optional(v.string()),
    // D2 (§8 Q5): preferencias de notificación operator-editable. Todos los
    // sub-campos son opcionales para permitir backfill gradual. UI lo edita
    // vía `orgConfigs.updateNotificationPreferences`.
    notificationPreferences: v.optional(
      v.object({
        reminderHourLocal: v.optional(v.number()),
        notifyOnDeliverableGenerated: v.optional(v.boolean()),
        notifyOnInvoicePaid: v.optional(v.boolean()),
        notifyOnQuotationAccepted: v.optional(v.boolean()),
      })
    ),
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
    subserviceId: v.optional(v.id("subservices")),
    type: v.union(
      v.literal("quotation"),
      v.literal("contract"),
      v.literal("deliverable_short"),
      v.literal("deliverable_long"),
      v.literal("questionnaire"),
      // A2: R1 decisión #4 — reservado V2 (UI lo oculta en beta)
      v.literal("invoice")
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
    contentStatus: v.optional(
      v.union(
        v.literal("placeholder"),
        v.literal("ready")
      )
    ),
    // A2: copy-on-write tracking — apunta al global del que se clonó (R1 #2)
    parentTemplateId: v.optional(v.id("deliverableTemplates")),
    originalVersionAtClone: v.optional(v.number()),
    // SS2: lookup contract templates by org + type + issuingCompany
    issuingCompanyId: v.optional(v.id("issuingCompanies")),
    signerMode: v.optional(
      v.union(
        v.literal("client_only"),
        v.literal("co_sign")
      )
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_serviceId", ["serviceId"])
    .index("by_type", ["type"])
    // A2: dual-matching resolver (org-scoped → global por subserviceId)
    .index("by_orgId_subserviceId", ["orgId", "subserviceId"])
    // A2: banner "hay vN global disponible" + idempotencia personalizeGlobal
    .index("by_parentTemplateId", ["parentTemplateId"])
    .index("by_subservice_contentStatus", ["subserviceId", "contentStatus"])
    .index("by_orgId_type_issuingCompanyId_subserviceId", [
      "orgId",
      "type",
      "issuingCompanyId",
      "subserviceId",
    ]),

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
      v.literal("firmame"),
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

  // A3: lifecycle de facturas V1 manuales. PDF en Railway bucket; metadata aquí.
  // Per docs/superpowers/specs/2026-05-23-document-lifecycle-design.md §2.1
  invoices: defineTable({
    orgId: v.string(),
    clientId: v.id("clients"),
    projectionId: v.id("projections"),
    projServiceId: v.optional(v.id("projectionServices")),
    subserviceId: v.optional(v.id("subservices")),
    serviceName: v.string(),
    monthlyAssignmentId: v.optional(v.id("monthlyAssignments")),
    month: v.number(),                 // 1-12 calendario
    year: v.number(),
    amount: v.number(),                // MXN
    // Blob storage (Railway)
    bucketKey: v.string(),
    contentType: v.string(),           // "application/pdf"
    sizeBytes: v.number(),
    filename: v.string(),
    // Lifecycle
    status: v.union(
      v.literal("uploaded"),
      v.literal("paid"),
      v.literal("void")
    ),
    uploadedAt: v.number(),
    uploadedBy: v.string(),
    paidAt: v.optional(v.number()),
    paidBy: v.optional(v.string()),
    voidedAt: v.optional(v.number()),
    voidedBy: v.optional(v.string()),
    voidReason: v.optional(v.string()),
    notes: v.optional(v.string()),
    // SS5: fiscal issue date (separate from operational uploadedAt).
    // CFDI Fecha attribute when XML provided, manual capture otherwise.
    issueDate: v.optional(v.number()),
    // V2 hooks
    facturapiInvoiceId: v.optional(v.string()),
    cfdiUuid: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_clientId", ["orgId", "clientId"])
    .index("by_orgId_clientId_year_month", ["orgId", "clientId", "year", "month"])
    .index("by_orgId_status", ["orgId", "status"])
    .index("by_projectionId", ["projectionId"])
    .index("by_projServiceId", ["projServiceId"])
    .index("by_monthlyAssignmentId", ["monthlyAssignmentId"]),

  // SS4: estados financieros del cliente para inyectar contexto al
  // generateDeliverable. Excel-only V1; PDF/OCR diferido a V2.
  // Per docs/superpowers/specs/2026-05-27-financial-statements-ingestion-design.md §4
  clientFinancialData: defineTable({
    orgId: v.string(),
    clientId: v.id("clients"),
    period: v.string(), // "2026-01" / "2026-Q1" / "2026"
    periodType: v.union(
      v.literal("monthly"),
      v.literal("quarterly"),
      v.literal("annual")
    ),
    // Railway S3 blob metadata
    bucketKey: v.string(),
    contentType: v.string(),
    sizeBytes: v.number(),
    filename: v.string(),
    // Extracted line items (AI o manual)
    lineItems: v.array(
      v.object({
        label: v.string(),
        amount: v.number(),
        category: v.union(
          v.literal("ingresos"),
          v.literal("gastos_operativos"),
          v.literal("impuestos"),
          v.literal("otros")
        ),
        satConcept: v.optional(v.string()),
      })
    ),
    aiExtraction: v.optional(
      v.object({
        model: v.string(),
        promptVersion: v.string(),
        extractedAt: v.number(),
        costUsd: v.optional(v.number()),
        rawSnippet: v.optional(v.string()),
        editedAt: v.optional(v.number()),
      })
    ),
    status: v.union(
      v.literal("uploaded"),
      v.literal("extracted"),
      v.literal("validated"),
      v.literal("rejected"),
      v.literal("error")
    ),
    rejectionReason: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    uploadedBy: v.string(),
    uploadedAt: v.number(),
    validatedBy: v.optional(v.string()),
    validatedAt: v.optional(v.number()),
  })
    .index("by_orgId_clientId", ["orgId", "clientId"])
    .index("by_orgId_clientId_period", ["orgId", "clientId", "period"])
    .index("by_orgId_status", ["orgId", "status"]),

  // A3: append-only audit log of document lifecycle events.
  // Per docs/superpowers/specs/2026-05-23-document-lifecycle-design.md §2.3
  documentEvents: defineTable({
    orgId: v.string(),
    clientId: v.optional(v.id("clients")),
    entityType: v.union(
      v.literal("deliverable"),
      v.literal("invoice"),
      v.literal("quotation"),
      v.literal("contract"),
      v.literal("template"),
      v.literal("subservice"),
      v.literal("questionnaire"),
      v.literal("financial_data"),
      v.literal("projection")
    ),
    entityId: v.string(),
    eventType: v.union(
      v.literal("created"),
      v.literal("updated"),
      v.literal("sent"),
      v.literal("signed"),
      v.literal("paid"),
      v.literal("generated"),
      v.literal("audited"),
      v.literal("deleted"),
      v.literal("personalized"),
      v.literal("restored"),
      v.literal("reminder_sent"),
      v.literal("uploaded"),
      v.literal("voided"),
      v.literal("error"),
      v.literal("reopened")
    ),
    severity: v.union(
      v.literal("info"),
      v.literal("warning"),
      v.literal("error")
    ),
    actorUserId: v.optional(v.string()),
    actorType: v.union(
      v.literal("user"),
      v.literal("cron"),
      v.literal("system"),
      v.literal("client_link")
    ),
    message: v.string(),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_orgId_createdAt", ["orgId", "createdAt"])
    .index("by_orgId_clientId_createdAt", ["orgId", "clientId", "createdAt"])
    .index("by_orgId_entityType_entityId", ["orgId", "entityType", "entityId"])
    .index("by_orgId_severity_createdAt", ["orgId", "severity", "createdAt"])
    .index("by_orgId_eventType_createdAt", ["orgId", "eventType", "createdAt"]),

  // C5: in-app notifications for dashboard
  notifications: defineTable({
    orgId: v.string(),
    assignedTo: v.optional(v.string()),       // userId of assignee (undefined = org-wide)
    type: v.string(),                          // "fiscal_close" | future types
    message: v.string(),
    relatedProjectionId: v.optional(v.id("projections")),
    relatedClientId: v.optional(v.id("clients")),
    createdAt: v.number(),
    readAt: v.optional(v.number()),
  })
    .index("by_orgId", ["orgId"]),
});
