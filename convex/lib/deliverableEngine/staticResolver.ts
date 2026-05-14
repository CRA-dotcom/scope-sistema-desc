/**
 * Pure resolver for "static" template placeholders — i.e. anything that can
 * be filled from a DB row without invoking an LLM.
 *
 * Contract:
 *   - resolveStatic(key, ctx) returns a formatted string for known keys
 *   - returns null for any key that isn't in the alias table (caller routes
 *     it through batchFillWithClaude instead)
 *
 * Field sources (see convex/schema.ts):
 *   client      → clients table (24-44)
 *   projection  → projections table (46-102)
 *   projService → projectionServices table (168-180)
 *   orgBranding → orgBranding table (392-404)
 */

export type ClientFields = {
  name: string;
  rfc: string;
  industry: string;
  annualRevenue: number;
  billingFrequency?: string;
  contactName?: string;
  contactEmail?: string;
};

export type ProjectionFields = {
  year: number;
  annualSales: number;
  totalBudget: number;
  effectiveBudget?: number;
};

export type ProjServiceFields = {
  serviceName: string;
  chosenPct: number;
  annualAmount: number;
};

export type OrgBrandingFields = {
  companyName: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor?: string;
  fontFamily: string;
  footerText?: string;
};

export type StaticResolutionContext = {
  client: ClientFields;
  projection: ProjectionFields | null;
  projService: ProjServiceFields | null;
  orgBranding: OrgBrandingFields | null;
  today: string;
};

const BRANDING_DEFAULTS = {
  companyName: "Projex",
  primaryColor: "#1a1a2e",
  secondaryColor: "#6c63ff",
  accentColor: "#22c55e",
  fontFamily: "'IBM Plex Sans', sans-serif",
  footerText: "",
} as const;

function fmtMoney(n: number): string {
  return `$${Number(n).toLocaleString("es-MX", { maximumFractionDigits: 0 })} MXN`;
}

function fmtPct(p: number): string {
  return `${(p * 100).toFixed(2)}%`;
}

function brandingValue(
  field: keyof typeof BRANDING_DEFAULTS,
  branding: OrgBrandingFields | null
): string {
  if (!branding) return BRANDING_DEFAULTS[field];
  const raw = (branding as Record<string, unknown>)[field];
  if (raw === undefined || raw === null || raw === "") return BRANDING_DEFAULTS[field];
  return String(raw);
}

export function resolveStatic(key: string, ctx: StaticResolutionContext): string | null {
  const { client, projection, projService, orgBranding, today } = ctx;

  switch (key) {
    case "client_name":
    case "company_name":
    case "company_legal_name":
      return client.name;
    case "client_industry":
    case "company_industry":
      return client.industry;
    case "client_rfc":
    case "company_rfc":
    case "manual_client_rfc":
      return client.rfc;
    case "client_billing_frequency":
    case "company_billing_frequency":
      return client.billingFrequency ?? "mensual";
    case "client_revenue":
    case "client_annual_revenue":
    case "company_annual_revenue":
      return fmtMoney(client.annualRevenue);
    case "client_contact_name":
      return client.contactName ?? "";
    case "client_contact_email":
      return client.contactEmail ?? "";

    case "projection_year":
    case "fiscal_year":
      return projection ? String(projection.year) : "";
    case "projection_annual_sales":
      return projection ? fmtMoney(projection.annualSales) : "";
    case "projection_total_budget":
      return projection ? fmtMoney(projection.totalBudget) : "";

    case "service_name":
      return projService?.serviceName ?? "";
    case "service_chosen_pct":
      return projService ? fmtPct(projService.chosenPct ?? 0) : "";
    case "service_annual_amount": {
      if (!projService) return "";
      const synthetic = Math.round(
        (projService.chosenPct ?? 0) *
          (projection?.effectiveBudget ?? projection?.totalBudget ?? 0)
      );
      const amount = projService.annualAmount > 0 ? projService.annualAmount : synthetic;
      return fmtMoney(amount);
    }

    case "branding_company_name":
      return brandingValue("companyName", orgBranding);
    case "branding_primary_color":
      return brandingValue("primaryColor", orgBranding);
    case "branding_secondary_color":
      return brandingValue("secondaryColor", orgBranding);
    case "branding_accent_color":
      return brandingValue("accentColor", orgBranding);
    case "branding_font_family":
      return brandingValue("fontFamily", orgBranding);
    case "branding_footer_text":
      return brandingValue("footerText", orgBranding);

    case "current_date":
    case "fecha":
      return today;

    default:
      return null;
  }
}
