import { describe, it, expect } from "vitest";
import {
  buildPeriodLabel,
  buildProjectionPdfHtml,
} from "../projectionPdfBuilder";

// ── buildPeriodLabel ─────────────────────────────────────────────────

describe("buildPeriodLabel", () => {
  it("rolling 12 months Jan→Dec same year", () => {
    const label = buildPeriodLabel(1, 12, 2026, 2026, 12, "rolling");
    expect(label).toBe("Enero 2026 – Diciembre 2026 (12 meses)");
  });

  it("rolling 12 months May→Apr wraps to next year", () => {
    const label = buildPeriodLabel(5, 4, 2026, 2027, 12, "rolling");
    expect(label).toBe("Mayo 2026 – Abril 2027 (12 meses)");
  });

  it("fiscal 8 months May→Dec same year includes año fiscal hint", () => {
    const label = buildPeriodLabel(5, 12, 2026, 2026, 8, "fiscal");
    expect(label).toBe("Mayo 2026 – Diciembre 2026 (8 meses · año fiscal)");
  });

  it("fiscal 1 month Dec→Dec same year", () => {
    const label = buildPeriodLabel(12, 12, 2026, 2026, 1, "fiscal");
    expect(label).toBe("Diciembre 2026 – Diciembre 2026 (1 meses · año fiscal)");
  });
});

// ── buildProjectionPdfHtml ───────────────────────────────────────────

const BASE_PROJECTION = {
  year: 2026,
  annualSales: 5_000_000,
  totalBudget: 600_000,
  commissionRate: 0.1,
};

const SERVICES = [
  { _id: "svc1", serviceName: "Marketing Digital", isActive: true, annualAmount: 120_000 },
  { _id: "svc2", serviceName: "SEO", isActive: true, annualAmount: 60_000 },
  { _id: "svc3", serviceName: "Diseño", isActive: false, annualAmount: 30_000 },
];

const ASSIGNMENTS = [
  { projServiceId: "svc1", month: 1, amount: 10_000, status: "pending" },
  { projServiceId: "svc1", month: 5, amount: 10_000, status: "delivered" },
  { projServiceId: "svc2", month: 1, amount: 5_000, status: "pending" },
];

describe("buildProjectionPdfHtml — legacy rolling (no startMonth/projectionMode)", () => {
  it("renders 12 month columns Jan-Dec", () => {
    const html = buildProjectionPdfHtml(BASE_PROJECTION, SERVICES, ASSIGNMENTS);
    // All 12 short month labels should appear as column headers
    expect(html).toContain("Ene 26");
    expect(html).toContain("Dic 26");
    expect(html).toContain("May 26");
  });

  it("includes the period line", () => {
    const html = buildProjectionPdfHtml(BASE_PROJECTION, SERVICES, ASSIGNMENTS);
    expect(html).toContain("Periodo:");
    expect(html).toContain("Enero 2026");
    expect(html).toContain("Diciembre 2026");
    expect(html).toContain("12 meses");
  });

  it("does NOT include año fiscal hint for rolling", () => {
    const html = buildProjectionPdfHtml(BASE_PROJECTION, SERVICES, ASSIGNMENTS);
    expect(html).not.toContain("año fiscal");
    expect(html).not.toContain("prorrateo");
  });

  it("only renders active services (omits inactive)", () => {
    const html = buildProjectionPdfHtml(BASE_PROJECTION, SERVICES, ASSIGNMENTS);
    expect(html).toContain("Marketing Digital");
    expect(html).toContain("SEO");
    expect(html).not.toContain("Diseño");
  });

  it("includes heading with year", () => {
    const html = buildProjectionPdfHtml(BASE_PROJECTION, SERVICES, ASSIGNMENTS);
    expect(html).toContain("Proyección 2026");
  });
});

describe("buildProjectionPdfHtml — fiscal 8 months May-Dec", () => {
  const fiscalProjection = {
    ...BASE_PROJECTION,
    startMonth: 5,
    projectionMode: "fiscal" as const,
  };

  it("renders exactly 8 month columns", () => {
    const html = buildProjectionPdfHtml(fiscalProjection, SERVICES, ASSIGNMENTS);
    // Months 5-12 (May-Dec) should be present
    expect(html).toContain("May 26");
    expect(html).toContain("Dic 26");
    // Months 1-4 (Jan-Apr) should NOT appear as column headers
    // (they appear elsewhere as text so we check the th pattern)
    const thMatches = html.match(/<th[^>]*>.*?Ene 26.*?<\/th>/s);
    expect(thMatches).toBeNull();
  });

  it("period label says 8 meses · año fiscal", () => {
    const html = buildProjectionPdfHtml(fiscalProjection, SERVICES, ASSIGNMENTS);
    expect(html).toContain("8 meses · año fiscal");
    expect(html).toContain("Mayo 2026");
    expect(html).toContain("Diciembre 2026");
  });

  it("includes prorrateo año fiscal hint block", () => {
    const html = buildProjectionPdfHtml(fiscalProjection, SERVICES, ASSIGNMENTS);
    expect(html).toContain("prorrateo año fiscal");
  });

  it("includes effective budget KPI card", () => {
    const html = buildProjectionPdfHtml(fiscalProjection, SERVICES, ASSIGNMENTS);
    expect(html).toContain("Presupuesto Efectivo");
  });
});

describe("buildProjectionPdfHtml — rolling May→Apr wraps to 2027", () => {
  const rollingMay = {
    ...BASE_PROJECTION,
    startMonth: 5,
    projectionMode: "rolling" as const,
  };

  it("wraps year in labels: May 26 … Apr 27", () => {
    const html = buildProjectionPdfHtml(rollingMay, SERVICES, ASSIGNMENTS);
    expect(html).toContain("May 26");
    expect(html).toContain("Abr 27");
  });

  it("period label says 12 meses without año fiscal", () => {
    const html = buildProjectionPdfHtml(rollingMay, SERVICES, ASSIGNMENTS);
    expect(html).toContain("12 meses");
    expect(html).not.toContain("año fiscal");
  });
});
