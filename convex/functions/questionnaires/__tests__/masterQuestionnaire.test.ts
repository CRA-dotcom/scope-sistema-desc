import { describe, it, expect } from "vitest";
import { MASTER_QUESTIONS } from "../masterQuestionnaire";

describe("MASTER_QUESTIONS integrity", () => {
  it("has unique question keys", () => {
    const keys = MASTER_QUESTIONS.map((q) => q.key);
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(keys.length);
  });

  it("every select question has at least 2 options", () => {
    const selects = MASTER_QUESTIONS.filter((q) => q.type === "select");
    expect(selects.length).toBeGreaterThan(0);
    for (const q of selects) {
      expect(q.options, `question ${q.key} missing options`).toBeDefined();
      expect(q.options!.length, `question ${q.key} has <2 options`).toBeGreaterThanOrEqual(2);
    }
  });

  it("every file_upload question has fileConfig", () => {
    const uploads = MASTER_QUESTIONS.filter((q) => q.type === "file_upload");
    for (const q of uploads) {
      expect(q.fileConfig, `question ${q.key} missing fileConfig`).toBeDefined();
    }
  });

  it("each section follows the 'N. Title' format", () => {
    const sectionRegex = /^\d+\.\s.+/;
    for (const q of MASTER_QUESTIONS) {
      expect(sectionRegex.test(q.section), `bad section format on ${q.key}: ${q.section}`).toBe(true);
    }
  });

  it("each subsection follows the 'N.M Title' format", () => {
    const subsectionRegex = /^\d+\.\d+\s.+/;
    for (const q of MASTER_QUESTIONS) {
      expect(subsectionRegex.test(q.subsection), `bad subsection format on ${q.key}: ${q.subsection}`).toBe(true);
    }
  });

  it("non-select / non-file_upload questions do not have options/fileConfig", () => {
    for (const q of MASTER_QUESTIONS) {
      if (q.type !== "select") {
        expect(q.options, `question ${q.key} unexpectedly has options`).toBeUndefined();
      }
      if (q.type !== "file_upload") {
        expect(q.fileConfig, `question ${q.key} unexpectedly has fileConfig`).toBeUndefined();
      }
    }
  });

  it("at least one variableKey matches a key in deliverableTemplates COMMON_VARS", () => {
    // These are the keys present in convex/functions/deliverableTemplates/seedDefaults.ts COMMON_VARS.
    const knownTemplateKeys = new Set([
      "company_name",
      "company_rfc",
      "company_industry",
      "company_annual_revenue",
      "company_billing_frequency",
      "projection_year",
      "projection_annual_sales",
      "projection_total_budget",
      "service_name",
      "service_chosen_pct",
      "service_annual_amount",
      "branding_company_name",
      "branding_footer_text",
      "current_date",
    ]);
    const matching = MASTER_QUESTIONS.filter(
      (q) => q.variableKey && knownTemplateKeys.has(q.variableKey)
    );
    expect(matching.length).toBeGreaterThan(0);
  });
});
