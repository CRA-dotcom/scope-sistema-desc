export type ResolvedVariable = {
  key: string;
  value: string;
  source: string;
};

export type TemplateContext = {
  client?: {
    name: string;
    rfc: string;
    industry: string;
    annualRevenue: number;
    billingFrequency: string;
  };
  projection?: {
    year: number;
    annualSales: number;
    totalBudget: number;
    commissionRate: number;
  };
  service?: {
    name: string;
    type: string;
    chosenPct: number;
    annualAmount: number;
  };
  manual?: Record<string, string>;
  branding?: {
    primary_color: string;
    secondary_color: string;
    accent_color: string;
    font_family: string;
    company_name: string;
  };
};

export type TemplateVariable = {
  key: string;
  label: string;
  source: string;
  required: boolean;
};

/**
 * Resolves {{variable}} placeholders in an HTML template using data from multiple sources.
 */
export function resolveTemplate(
  htmlTemplate: string,
  variables: TemplateVariable[],
  context: TemplateContext
): { html: string; resolved: ResolvedVariable[]; missing: string[] } {
  const resolved: ResolvedVariable[] = [];
  const missing: string[] = [];
  let html = htmlTemplate;

  // Replace branding variables first (they're in the CSS, not in the variables array)
  if (context.branding) {
    html = html.replace(/\{\{branding_primary_color\}\}/g, context.branding.primary_color || '#1a1a2e');
    html = html.replace(/\{\{branding_secondary_color\}\}/g, context.branding.secondary_color || '#6c63ff');
    html = html.replace(/\{\{branding_accent_color\}\}/g, context.branding.accent_color || '#22c55e');
    html = html.replace(/\{\{branding_font_family\}\}/g, context.branding.font_family || 'IBM Plex Sans, sans-serif');
    html = html.replace(/\{\{branding_company_name\}\}/g, context.branding.company_name || 'Projex');
  }

  for (const variable of variables) {
    const { key, source, required } = variable;
    let value: string | undefined;

    switch (source) {
      case "client": {
        const data = context.client;
        if (data && key in data) {
          const raw = data[key as keyof typeof data];
          value = formatValue(raw);
        }
        break;
      }
      case "projection": {
        const data = context.projection;
        if (data && key in data) {
          const raw = data[key as keyof typeof data];
          value = formatValue(raw);
        }
        break;
      }
      case "service": {
        const data = context.service;
        if (data && key in data) {
          const raw = data[key as keyof typeof data];
          value = formatValue(raw);
        }
        break;
      }
      case "manual": {
        value = context.manual?.[key];
        if (!value) {
          value = "[PENDIENTE]";
        }
        break;
      }
      case "ai": {
        value = "[AI_PENDIENTE]";
        break;
      }
    }

    if (value !== undefined) {
      resolved.push({ key, value, source });
      // Replace all occurrences of {{key}}
      html = html.replace(new RegExp(`\\{\\{${escapeRegex(key)}\\}\\}`, "g"), value);
    } else {
      if (required) {
        missing.push(key);
      }
      // Leave placeholder visible for missing required variables
      html = html.replace(
        new RegExp(`\\{\\{${escapeRegex(key)}\\}\\}`, "g"),
        `<span style="color: #ef4444; font-weight: bold;">[FALTA: ${key}]</span>`
      );
    }
  }

  return { html, resolved, missing };
}

function formatValue(raw: string | number): string {
  if (typeof raw === "number") {
    return raw.toLocaleString("es-MX");
  }
  return String(raw);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract unique `{{key}}` placeholders from an HTML template in first-seen
 * order. Mirrors the regex in `convex/lib/templatePlaceholders.ts` so the
 * client-side editor warning stays in sync with server-side validation.
 *
 * Per A2 §4.2 (the operator editor parses placeholders client-side as the
 * operator types and surfaces a warning for any `{{x}}` not declared in
 * `variables[]`).
 */
export function extractPlaceholders(htmlTemplate: string): string[] {
  const re = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(htmlTemplate)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      out.push(m[1]);
    }
  }
  return out;
}

/**
 * Generates sample data for template preview based on variable definitions.
 */
export function generateSampleContext(
  variables: TemplateVariable[]
): TemplateContext {
  const context: TemplateContext = {};
  const hasSource = (src: string) => variables.some((v) => v.source === src);

  if (hasSource("client")) {
    context.client = {
      name: "Empresa Ejemplo S.A. de C.V.",
      rfc: "EEJ920101ABC",
      industry: "Tecnologia",
      annualRevenue: 5000000,
      billingFrequency: "mensual",
    };
  }

  if (hasSource("projection")) {
    context.projection = {
      year: 2026,
      annualSales: 5000000,
      totalBudget: 500000,
      commissionRate: 10,
    };
  }

  if (hasSource("service")) {
    context.service = {
      name: "Marketing Digital",
      type: "base",
      chosenPct: 15,
      annualAmount: 75000,
    };
  }

  if (hasSource("manual")) {
    const manual: Record<string, string> = {};
    variables
      .filter((v) => v.source === "manual")
      .forEach((v) => {
        manual[v.key] = `[Ejemplo: ${v.label}]`;
      });
    context.manual = manual;
  }

  // Always include sample branding
  context.branding = {
    primary_color: '#1a1a2e',
    secondary_color: '#6c63ff',
    accent_color: '#22c55e',
    font_family: 'IBM Plex Sans, sans-serif',
    company_name: 'Projex',
  };

  return context;
}
