import { describe, it, expect } from "vitest";
import { ADMIN_TEMPLATE } from "../admin-resumen";
import { RH_TEMPLATE } from "../rh-resumen";
import { TI_TEMPLATE } from "../ti-resumen";
import { MARKETING_TEMPLATE } from "../marketing-resumen";
import { LEGAL_TEMPLATE } from "../legal-resumen";
import type { DeliverableTemplateDef } from "../base-layout";

const TEMPLATES: DeliverableTemplateDef[] = [
  ADMIN_TEMPLATE,
  RH_TEMPLATE,
  TI_TEMPLATE,
  MARKETING_TEMPLATE,
  LEGAL_TEMPLATE,
];

describe("deliverable templates D5", () => {
  it("each template has unique service slug and name", () => {
    const slugs = new Set(TEMPLATES.map((t) => t.service));
    expect(slugs.size).toBe(5);
    const names = new Set(TEMPLATES.map((t) => t.name));
    expect(names.size).toBe(5);
  });

  it("each template declares at least 2 AI variables", () => {
    for (const t of TEMPLATES) {
      expect(t.aiVariables.length, `${t.service} should have >= 2 AI variables`).toBeGreaterThanOrEqual(2);
    }
  });

  it("each AI variable has a non-empty prompt with at least one {placeholder}", () => {
    for (const t of TEMPLATES) {
      for (const v of t.aiVariables) {
        expect(v.prompt.length, `${t.service}/${v.name} prompt too short`).toBeGreaterThan(50);
        expect(v.prompt, `${t.service}/${v.name} must have a {placeholder}`).toMatch(/\{[a-z_]+\}/i);
        expect(v.requiredContext, `${t.service}/${v.name} requiredContext must be Array`).toBeInstanceOf(Array);
        expect(v.requiredContext.length, `${t.service}/${v.name} requiredContext must not be empty`).toBeGreaterThan(0);
      }
    }
  });

  it("prompts don't contain banned generic phrases", () => {
    const BANNED = [
      "como cualquier empresa",
      "toda organización debe",
      "es importante considerar",
      "se recomienda implementar",
    ];
    for (const t of TEMPLATES) {
      for (const v of t.aiVariables) {
        for (const banned of BANNED) {
          expect(
            v.prompt.toLowerCase(),
            `${t.service}/${v.name} contains banned phrase: "${banned}"`
          ).not.toContain(banned);
        }
      }
    }
  });

  it("each template has at least 4 layout sections (portada, contexto, servicios, detalle, próximos pasos)", () => {
    for (const t of TEMPLATES) {
      expect(
        t.sections.length,
        `${t.service} should have >= 4 sections, got ${t.sections.length}`
      ).toBeGreaterThanOrEqual(4);
    }
  });

  it("each template has exactly 2 AI sections", () => {
    for (const t of TEMPLATES) {
      const aiSections = t.sections.filter((s) => s.kind === "ai");
      expect(
        aiSections.length,
        `${t.service} should have 2 AI sections`
      ).toBe(2);
    }
  });

  it("AI sections reference valid AI variable names", () => {
    for (const t of TEMPLATES) {
      const aiVarNames = new Set(t.aiVariables.map((v) => v.name));
      const aiSections = t.sections.filter((s) => s.kind === "ai");
      for (const section of aiSections) {
        expect(
          section.aiVariable,
          `${t.service} section "${section.id}" must have aiVariable`
        ).toBeDefined();
        expect(
          aiVarNames.has(section.aiVariable!),
          `${t.service} section "${section.id}" aiVariable "${section.aiVariable}" not in aiVariables`
        ).toBe(true);
      }
    }
  });

  it("htmlTemplate contains {{placeholder}} markers for all AI variable keys", () => {
    for (const t of TEMPLATES) {
      for (const v of t.aiVariables) {
        const marker = `{{${v.name}}}`;
        expect(
          t.htmlTemplate,
          `${t.service}: htmlTemplate must contain ${marker}`
        ).toContain(marker);
      }
    }
  });

  it("variables array contains entries for all AI variable keys with source='ai'", () => {
    for (const t of TEMPLATES) {
      for (const aiVar of t.aiVariables) {
        const dbVar = t.variables.find((v) => v.key === aiVar.name);
        expect(
          dbVar,
          `${t.service}: variables array must include entry for "${aiVar.name}"`
        ).toBeDefined();
        expect(
          dbVar?.source,
          `${t.service}: variable "${aiVar.name}" must have source="ai"`
        ).toBe("ai");
      }
    }
  });

  it("all templates have type='deliverable_long'", () => {
    for (const t of TEMPLATES) {
      expect(t.type, `${t.service} must have type deliverable_long`).toBe("deliverable_long");
    }
  });

  it("service slugs match expected values: Admin, RH, TI, Marketing, Legal", () => {
    const expectedSlugs = new Set(["Admin", "RH", "TI", "Marketing", "Legal"]);
    for (const t of TEMPLATES) {
      expect(
        expectedSlugs.has(t.service),
        `unexpected service slug: "${t.service}"`
      ).toBe(true);
    }
  });
});
