import { describe, it, expect } from "vitest";
import { resolveStatic, type StaticResolutionContext } from "../staticResolver";

const baseCtx: StaticResolutionContext = {
  client: {
    name: "Katimi SA de CV",
    rfc: "KAT240115ABC",
    industry: "Manufactura",
    annualRevenue: 31_200_000,
    billingFrequency: "mensual",
    contactName: "Ana Pérez",
    contactEmail: "ana@katimi.mx",
  },
  projection: {
    year: 2026,
    annualSales: 31_200_000,
    totalBudget: 4_500_000,
    effectiveBudget: 4_200_000,
  },
  projService: {
    serviceName: "Marketing",
    chosenPct: 0.18,
    annualAmount: 0,
  },
  orgBranding: {
    companyName: "Projex",
    primaryColor: "#1a1a2e",
    secondaryColor: "#6c63ff",
    accentColor: "#22c55e",
    fontFamily: "'IBM Plex Sans', sans-serif",
    footerText: "Confidential",
  },
  today: "14 de mayo de 2026",
};

describe("resolveStatic — client fields", () => {
  it("client_name / company_name / company_legal_name → client.name", () => {
    expect(resolveStatic("client_name", baseCtx)).toBe("Katimi SA de CV");
    expect(resolveStatic("company_name", baseCtx)).toBe("Katimi SA de CV");
    expect(resolveStatic("company_legal_name", baseCtx)).toBe("Katimi SA de CV");
  });

  it("client_industry / company_industry → client.industry", () => {
    expect(resolveStatic("client_industry", baseCtx)).toBe("Manufactura");
    expect(resolveStatic("company_industry", baseCtx)).toBe("Manufactura");
  });

  it("client_rfc / company_rfc / manual_client_rfc → client.rfc", () => {
    expect(resolveStatic("client_rfc", baseCtx)).toBe("KAT240115ABC");
    expect(resolveStatic("company_rfc", baseCtx)).toBe("KAT240115ABC");
    expect(resolveStatic("manual_client_rfc", baseCtx)).toBe("KAT240115ABC");
  });

  it("client_annual_revenue / company_annual_revenue / client_revenue → fmtMoney(annualRevenue)", () => {
    expect(resolveStatic("client_annual_revenue", baseCtx)).toBe("$31,200,000 MXN");
    expect(resolveStatic("company_annual_revenue", baseCtx)).toBe("$31,200,000 MXN");
    expect(resolveStatic("client_revenue", baseCtx)).toBe("$31,200,000 MXN");
  });

  it("client_billing_frequency defaults to 'mensual' when missing", () => {
    const ctx: StaticResolutionContext = {
      ...baseCtx,
      client: { ...baseCtx.client, billingFrequency: undefined },
    };
    expect(resolveStatic("client_billing_frequency", ctx)).toBe("mensual");
  });

  it("client_contact_name returns empty string when missing", () => {
    const ctx: StaticResolutionContext = {
      ...baseCtx,
      client: { ...baseCtx.client, contactName: undefined },
    };
    expect(resolveStatic("client_contact_name", ctx)).toBe("");
  });

  it("client_contact_email returns the field when present", () => {
    expect(resolveStatic("client_contact_email", baseCtx)).toBe("ana@katimi.mx");
  });
});

describe("resolveStatic — projection fields", () => {
  it("projection_year / fiscal_year → String(projection.year)", () => {
    expect(resolveStatic("projection_year", baseCtx)).toBe("2026");
    expect(resolveStatic("fiscal_year", baseCtx)).toBe("2026");
  });

  it("projection_annual_sales → fmtMoney(projection.annualSales)", () => {
    expect(resolveStatic("projection_annual_sales", baseCtx)).toBe("$31,200,000 MXN");
  });

  it("projection_total_budget → fmtMoney(projection.totalBudget)", () => {
    expect(resolveStatic("projection_total_budget", baseCtx)).toBe("$4,500,000 MXN");
  });

  it("returns empty string for projection-bound keys when projection is null", () => {
    const ctx: StaticResolutionContext = { ...baseCtx, projection: null };
    expect(resolveStatic("projection_year", ctx)).toBe("");
    expect(resolveStatic("fiscal_year", ctx)).toBe("");
    expect(resolveStatic("projection_annual_sales", ctx)).toBe("");
    expect(resolveStatic("projection_total_budget", ctx)).toBe("");
  });
});

describe("resolveStatic — projService fields", () => {
  it("service_name → projService.serviceName", () => {
    expect(resolveStatic("service_name", baseCtx)).toBe("Marketing");
  });

  it("service_chosen_pct → fmtPct (0.18 → '18.00%')", () => {
    expect(resolveStatic("service_chosen_pct", baseCtx)).toBe("18.00%");
  });

  it("service_annual_amount uses chosenPct × effectiveBudget when annualAmount=0", () => {
    // 0.18 × 4_200_000 = 756_000
    expect(resolveStatic("service_annual_amount", baseCtx)).toBe("$756,000 MXN");
  });

  it("service_annual_amount uses annualAmount directly when > 0", () => {
    const ctx: StaticResolutionContext = {
      ...baseCtx,
      projService: { ...baseCtx.projService!, annualAmount: 999_000 },
    };
    expect(resolveStatic("service_annual_amount", ctx)).toBe("$999,000 MXN");
  });

  it("service_annual_amount falls back to totalBudget when effectiveBudget is missing", () => {
    const ctx: StaticResolutionContext = {
      ...baseCtx,
      projection: { year: 2026, annualSales: 0, totalBudget: 1_000_000 },
    };
    // 0.18 × 1_000_000 = 180_000
    expect(resolveStatic("service_annual_amount", ctx)).toBe("$180,000 MXN");
  });

  it("returns empty string for service-bound keys when projService is null", () => {
    const ctx: StaticResolutionContext = { ...baseCtx, projService: null };
    expect(resolveStatic("service_name", ctx)).toBe("");
    expect(resolveStatic("service_chosen_pct", ctx)).toBe("");
    expect(resolveStatic("service_annual_amount", ctx)).toBe("");
  });
});

describe("resolveStatic — branding fields", () => {
  it("branding_company_name → orgBranding.companyName", () => {
    expect(resolveStatic("branding_company_name", baseCtx)).toBe("Projex");
  });

  it("branding_primary/secondary/accent_color + font_family map to respective fields", () => {
    expect(resolveStatic("branding_primary_color", baseCtx)).toBe("#1a1a2e");
    expect(resolveStatic("branding_secondary_color", baseCtx)).toBe("#6c63ff");
    expect(resolveStatic("branding_accent_color", baseCtx)).toBe("#22c55e");
    expect(resolveStatic("branding_font_family", baseCtx)).toBe("'IBM Plex Sans', sans-serif");
  });

  it("branding_footer_text returns the field when present", () => {
    expect(resolveStatic("branding_footer_text", baseCtx)).toBe("Confidential");
  });

  it("branding_footer_text returns empty string when missing", () => {
    const ctx: StaticResolutionContext = {
      ...baseCtx,
      orgBranding: { ...baseCtx.orgBranding!, footerText: undefined },
    };
    expect(resolveStatic("branding_footer_text", ctx)).toBe("");
  });

  it("branding_* falls back to defaults when orgBranding is null", () => {
    const ctx: StaticResolutionContext = { ...baseCtx, orgBranding: null };
    expect(resolveStatic("branding_company_name", ctx)).toBe("Projex");
    expect(resolveStatic("branding_primary_color", ctx)).toBe("#1a1a2e");
    expect(resolveStatic("branding_secondary_color", ctx)).toBe("#6c63ff");
    expect(resolveStatic("branding_accent_color", ctx)).toBe("#22c55e");
    expect(resolveStatic("branding_font_family", ctx)).toBe("'IBM Plex Sans', sans-serif");
    expect(resolveStatic("branding_footer_text", ctx)).toBe("");
  });
});

describe("resolveStatic — date fields", () => {
  it("current_date / fecha → ctx.today", () => {
    expect(resolveStatic("current_date", baseCtx)).toBe("14 de mayo de 2026");
    expect(resolveStatic("fecha", baseCtx)).toBe("14 de mayo de 2026");
  });
});

describe("resolveStatic — unknown keys", () => {
  it("returns null for any key not in the alias table", () => {
    expect(resolveStatic("ai_score_1", baseCtx)).toBeNull();
    expect(resolveStatic("totally_made_up_key", baseCtx)).toBeNull();
    expect(resolveStatic("ai_finding_a1", baseCtx)).toBeNull();
    expect(resolveStatic("", baseCtx)).toBeNull();
  });
});
