// Pure helpers for resolving {{variable}} placeholders in document templates.
// Used by quotation/contract actions. No Convex imports so it can run in any context.

export type TemplateVariable = {
  key: string;
  label: string;
  source: string;
  required: boolean;
};

export type ResolverContext = {
  client: {
    name: string;
    rfc: string;
    industry: string;
    annualRevenue: number;
    billingFrequency: string;
  } | null;
  projection: {
    year: number;
    annualSales: number;
    totalBudget: number;
    commissionRate: number;
  } | null;
  projService: {
    serviceName: string;
    chosenPct: number;
    annualAmount: number;
  } | null;
  orgBranding: {
    companyName: string;
    primaryColor: string;
    secondaryColor: string;
    accentColor?: string;
    fontFamily: string;
    headerText?: string;
    footerText?: string;
  } | null;
  documentMeta?: {
    folio?: string;
    emissionDate?: Date;
    validityDays?: number;
  };
  manual?: Record<string, string>;
};

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatMoney(n: number): string {
  return n.toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Resolves values that depend only on the key name (dates, folios, version markers).
function resolveSystemVar(key: string, meta: ResolverContext["documentMeta"]): string | null {
  const emission = meta?.emissionDate ?? new Date();
  const validityDays = meta?.validityDays ?? 15;
  const validity = new Date(emission.getTime());
  validity.setDate(validity.getDate() + validityDays);

  switch (key) {
    case "current_date":
    case "emission_date":
    case "quotation_date":
    case "contract_date":
    case "diagnostic_date":
      return formatDate(emission);
    case "validity_date":
    case "quotation_validity":
      return formatDate(validity);
    case "quotation_folio":
    case "diagnostic_folio":
    case "contract_folio":
      return meta?.folio ?? `PJX-${Date.now().toString(36).toUpperCase()}`;
    case "quotation_version":
    case "document_version":
      return "1.0";
    case "branding_year":
      return String(emission.getFullYear());
    default:
      return null;
  }
}

// Org branding vars (branding_*, consultant_*, advisor_company_*).
function resolveBrandingVar(
  key: string,
  branding: ResolverContext["orgBranding"]
): string | null {
  if (!branding) return null;

  const fallbackCompany = branding.companyName;

  switch (key) {
    case "branding_company_name":
    case "branding_company_legal_name":
    case "consultant_company":
    case "consultant_company_name":
    case "advisor_company":
    case "advisor_company_name":
      return fallbackCompany;
    case "branding_primary_color":
      return branding.primaryColor;
    case "branding_secondary_color":
      return branding.secondaryColor;
    case "branding_accent_color":
      return branding.accentColor ?? "#22c55e";
    case "branding_font_family":
      return branding.fontFamily;
    case "branding_header_text":
      return branding.headerText ?? "";
    case "branding_footer_text":
      return branding.footerText ?? "";
    default:
      return null;
  }
}

// Client aliases (company_*, client_*).
function resolveClientAlias(
  key: string,
  client: ResolverContext["client"]
): string | null {
  if (!client) return null;

  switch (key) {
    case "company_name":
    case "client_name":
    case "company_full_name":
    case "company_legal_name":
      return client.name;
    case "company_rfc":
    case "client_rfc":
      return client.rfc;
    case "company_industry":
    case "client_industry":
      return client.industry;
    case "company_annual_revenue":
    case "client_annual_revenue":
      return `$${formatMoney(client.annualRevenue)}`;
    case "company_billing_frequency":
    case "client_billing_frequency":
      return client.billingFrequency;
    default:
      return null;
  }
}

// Projection aliases.
function resolveProjectionAlias(
  key: string,
  projection: ResolverContext["projection"]
): string | null {
  if (!projection) return null;

  switch (key) {
    case "projection_year":
    case "fiscal_year":
      return String(projection.year);
    case "projection_annual_sales":
    case "annual_sales":
      return `$${formatMoney(projection.annualSales)}`;
    case "projection_total_budget":
    case "total_budget":
      return `$${formatMoney(projection.totalBudget)}`;
    case "projection_commission_rate":
    case "commission_rate":
      return `${(projection.commissionRate * 100).toFixed(1)}%`;
    default:
      return null;
  }
}

// Projection service aliases.
function resolveServiceAlias(
  key: string,
  projService: ResolverContext["projService"]
): string | null {
  if (!projService) return null;

  switch (key) {
    case "service_name":
    case "svc_name":
      return projService.serviceName;
    case "service_annual_amount":
    case "svc_annual_amount":
    case "svc_subtotal":
    case "svc_anual":
      return `$${formatMoney(projService.annualAmount)}`;
    case "service_monthly_amount":
    case "svc_monthly_amount":
    case "svc_mensual":
      return `$${formatMoney(projService.annualAmount / 12)}`;
    case "service_chosen_pct":
    case "svc_chosen_pct":
      return `${projService.chosenPct}%`;
    default:
      return null;
  }
}

// Direct object lookup by key. Falls back for vars with source=client/projection/service.
function resolveDirect(
  obj: Record<string, unknown> | null,
  key: string
): string | null {
  if (!obj || !(key in obj)) return null;
  const raw = obj[key];
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return raw.toLocaleString("es-MX");
  return String(raw);
}

export function resolveVariable(
  key: string,
  source: string,
  context: ResolverContext
): string | null {
  // Order matters: system > branding > aliases > direct > manual.
  // AI is excluded here (caller handles it).
  if (source === "ai") return null;

  const sys = resolveSystemVar(key, context.documentMeta);
  if (sys !== null) return sys;

  const branding = resolveBrandingVar(key, context.orgBranding);
  if (branding !== null) return branding;

  const clientAlias = resolveClientAlias(key, context.client);
  if (clientAlias !== null) return clientAlias;

  const projectionAlias = resolveProjectionAlias(key, context.projection);
  if (projectionAlias !== null) return projectionAlias;

  const serviceAlias = resolveServiceAlias(key, context.projService);
  if (serviceAlias !== null) return serviceAlias;

  switch (source) {
    case "client":
      return resolveDirect(context.client as unknown as Record<string, unknown>, key);
    case "projection":
      return resolveDirect(context.projection as unknown as Record<string, unknown>, key);
    case "service":
      return resolveDirect(context.projService as unknown as Record<string, unknown>, key);
    case "manual":
      return context.manual?.[key] ?? null;
    default:
      return null;
  }
}

export type ResolutionResult = {
  html: string;
  aiVariables: TemplateVariable[];
  pendingVariables: string[];
};

export function resolveTemplateVariables(
  htmlTemplate: string,
  variables: TemplateVariable[],
  context: ResolverContext,
  options: { pendingMarker?: string } = {}
): ResolutionResult {
  const pendingMarker = options.pendingMarker ?? "[PENDIENTE]";
  const aiVariables: TemplateVariable[] = [];
  const pendingVariables: string[] = [];
  let html = htmlTemplate;

  for (const variable of variables) {
    const placeholder = `{{${variable.key}}}`;
    const pattern = new RegExp(escapeRegex(placeholder), "g");

    if (variable.source === "ai") {
      aiVariables.push(variable);
      continue;
    }

    const value = resolveVariable(variable.key, variable.source, context);
    if (value !== null) {
      html = html.replace(pattern, value);
    } else {
      pendingVariables.push(variable.key);
      html = html.replace(pattern, pendingMarker);
    }
  }

  return { html, aiVariables, pendingVariables };
}
