"use node";

import { action } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";
import Anthropic from "@anthropic-ai/sdk";
import {
  resolveTemplateVariables,
  escapeRegex,
  type ResolverContext,
  type TemplateVariable,
} from "../../lib/templateVariables";

const MODEL = "claude-sonnet-4-20250514";
const MAX_RETRIES = 3;
const AI_UNAVAILABLE_PLACEHOLDER = "[AI no disponible — configurar API key]";

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "placeholder") {
    console.warn(
      "[Quotation Pipeline] ANTHROPIC_API_KEY not configured. AI variables will use placeholder."
    );
    return null;
  }
  return new Anthropic({ apiKey });
}

async function callClaudeWithRetry(
  client: Anthropic,
  systemPrompt: string,
  userPrompt: string,
  maxRetries: number = MAX_RETRIES
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });
      const textBlock = response.content.find((b) => b.type === "text");
      return textBlock && "text" in textBlock ? textBlock.text.trim() : "";
    } catch (err) {
      lastError = err;
      console.error(
        `[Quotation Pipeline] Claude API attempt ${attempt + 1}/${maxRetries} failed:`,
        err
      );
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

function buildFallbackHtml(
  client: ResolverContext["client"],
  projection: ResolverContext["projection"],
  projService: ResolverContext["projService"],
  branding: ResolverContext["orgBranding"]
): string {
  const safeMoney = (n: number) =>
    n.toLocaleString("es-MX", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const primary = branding?.primaryColor ?? "#1a1a2e";
  const secondary = branding?.secondaryColor ?? "#6c63ff";
  const consultantName = branding?.companyName ?? "Projex";

  const monthly =
    projService != null ? safeMoney(projService.annualAmount / 12) : "0.00";
  const annual =
    projService != null ? safeMoney(projService.annualAmount) : "0.00";

  return `
<div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px;">
  <div style="text-align: center; margin-bottom: 40px;">
    <h1 style="font-size: 24px; color: ${primary}; margin-bottom: 8px;">COTIZACIÓN DE SERVICIOS</h1>
    <p style="color: #666; font-size: 14px;">${consultantName} · ${new Date().toLocaleDateString("es-MX")}</p>
  </div>
  <div style="margin-bottom: 32px;">
    <h2 style="font-size: 16px; color: ${primary}; border-bottom: 2px solid ${secondary}; padding-bottom: 8px;">DATOS DEL CLIENTE</h2>
    <table style="width: 100%; margin-top: 12px; font-size: 14px;">
      <tr><td style="padding: 4px 0; color: #666; width: 160px;">Empresa:</td><td style="font-weight: 600;">${client?.name ?? ""}</td></tr>
      <tr><td style="padding: 4px 0; color: #666;">RFC:</td><td>${client?.rfc ?? ""}</td></tr>
      <tr><td style="padding: 4px 0; color: #666;">Industria:</td><td>${client?.industry ?? ""}</td></tr>
    </table>
  </div>
  <div style="margin-bottom: 32px;">
    <h2 style="font-size: 16px; color: ${primary}; border-bottom: 2px solid ${secondary}; padding-bottom: 8px;">SERVICIO COTIZADO</h2>
    <table style="width: 100%; margin-top: 12px; font-size: 14px;">
      <tr><td style="padding: 4px 0; color: #666; width: 160px;">Servicio:</td><td style="font-weight: 600;">${projService?.serviceName ?? ""}</td></tr>
      <tr><td style="padding: 4px 0; color: #666;">Año fiscal:</td><td>${projection?.year ?? ""}</td></tr>
      <tr><td style="padding: 4px 0; color: #666;">Porcentaje asignado:</td><td>${projService?.chosenPct ?? 0}%</td></tr>
    </table>
  </div>
  <div style="margin-bottom: 32px;">
    <h2 style="font-size: 16px; color: ${primary}; border-bottom: 2px solid ${secondary}; padding-bottom: 8px;">INVERSIÓN</h2>
    <table style="width: 100%; margin-top: 12px; font-size: 14px; border-collapse: collapse;">
      <thead><tr style="background: #f5f5ff;"><th style="text-align: left; padding: 10px; border: 1px solid #e0e0e0;">Concepto</th><th style="text-align: right; padding: 10px; border: 1px solid #e0e0e0;">Monto</th></tr></thead>
      <tbody>
        <tr><td style="padding: 10px; border: 1px solid #e0e0e0;">Inversión anual</td><td style="text-align: right; padding: 10px; border: 1px solid #e0e0e0; font-weight: 600;">$${annual}</td></tr>
        <tr><td style="padding: 10px; border: 1px solid #e0e0e0;">Inversión mensual estimada</td><td style="text-align: right; padding: 10px; border: 1px solid #e0e0e0; font-weight: 600;">$${monthly}</td></tr>
      </tbody>
    </table>
  </div>
  <div style="margin-bottom: 32px;">
    <h2 style="font-size: 16px; color: ${primary}; border-bottom: 2px solid ${secondary}; padding-bottom: 8px;">CONDICIONES</h2>
    <ul style="font-size: 14px; color: #444; line-height: 1.8;">
      <li>Vigencia de la cotización: 30 días naturales.</li>
      <li>Frecuencia de facturación: ${client?.billingFrequency ?? "mensual"}.</li>
      <li>Los montos no incluyen IVA.</li>
    </ul>
  </div>
</div>`.trim();
}

/**
 * Generate a quotation with full variable resolution (client, projection, service,
 * org branding, date helpers, folios) and AI fill for `ai` source variables.
 * Falls back to a basic HTML template if no template is registered.
 */
export const generateQuotation = action({
  args: {
    projServiceId: v.id("projectionServices"),
  },
  handler: async (ctx, args): Promise<string> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("No autenticado. Inicia sesión para continuar.");
    }
    const orgId = (identity.orgId ??
      (identity as Record<string, unknown>).org_id) as string | undefined;
    if (!orgId) {
      throw new Error("No se encontró la organización. Selecciona una organización.");
    }

    const projService = await ctx.runQuery(
      internal.functions.quotations.internalQueries.getProjServiceData,
      { projServiceId: args.projServiceId }
    );
    if (!projService || projService.orgId !== orgId) {
      throw new Error("Servicio de proyección no encontrado.");
    }

    const projection = await ctx.runQuery(
      internal.functions.quotations.internalQueries.getProjectionData,
      { projectionId: projService.projectionId }
    );
    if (!projection || projection.orgId !== orgId) {
      throw new Error("Proyección no encontrada.");
    }

    const client = await ctx.runQuery(
      internal.functions.quotations.internalQueries.getClientData,
      { clientId: projection.clientId }
    );
    if (!client || client.orgId !== orgId) {
      throw new Error("Cliente no encontrado.");
    }

    const [service, orgBranding, questionnaire, template] = await Promise.all([
      ctx.runQuery(
        internal.functions.quotations.internalQueries.getServiceData,
        { serviceId: projService.serviceId }
      ),
      ctx.runQuery(
        internal.functions.quotations.internalQueries.getOrgBranding,
        { orgId }
      ),
      ctx.runQuery(
        internal.functions.quotations.internalQueries.getQuestionnaireForProjection,
        { projectionId: projService.projectionId }
      ),
      ctx.runQuery(
        internal.functions.quotations.internalQueries.findQuotationTemplate,
        { serviceId: projService.serviceId, orgId }
      ),
    ]);

    const context: ResolverContext = {
      client: {
        name: client.name,
        rfc: client.rfc,
        industry: client.industry,
        annualRevenue: client.annualRevenue,
        billingFrequency: client.billingFrequency,
      },
      projection: {
        year: projection.year,
        annualSales: projection.annualSales,
        totalBudget: projection.totalBudget,
        commissionRate: projection.commissionRate,
      },
      projService: {
        serviceName: projService.serviceName,
        chosenPct: projService.chosenPct,
        annualAmount: projService.annualAmount,
      },
      orgBranding: orgBranding
        ? {
            companyName: orgBranding.companyName,
            primaryColor: orgBranding.primaryColor,
            secondaryColor: orgBranding.secondaryColor,
            accentColor: orgBranding.accentColor,
            fontFamily: orgBranding.fontFamily,
            headerText: orgBranding.headerText,
            footerText: orgBranding.footerText,
          }
        : null,
      documentMeta: {
        emissionDate: new Date(),
        validityDays: 30,
      },
    };

    let finalContent: string;

    if (template) {
      const { html, aiVariables, pendingVariables } = resolveTemplateVariables(
        template.htmlTemplate,
        template.variables as TemplateVariable[],
        context
      );

      let resolvedHtml = html;
      const anthropic = getAnthropicClient();

      if (aiVariables.length > 0 && anthropic) {
        const questionnaireContext = questionnaire?.responses
          ? questionnaire.responses
              .map(
                (r: { questionText: string; answer: string }) =>
                  `P: ${r.questionText}\nR: ${r.answer}`
              )
              .join("\n\n")
          : "Sin respuestas de cuestionario disponibles.";

        const systemPrompt = `Eres un consultor profesional que elabora propuestas comerciales para servicios de ${projService.serviceName}. Genera contenido conciso, profesional y específico al cliente.`;

        for (const aiVar of aiVariables) {
          try {
            const text = await callClaudeWithRetry(
              anthropic,
              systemPrompt,
              `Variable: ${aiVar.label} (${aiVar.key})\n\nCliente: ${client.name}\nIndustria: ${client.industry}\nRFC: ${client.rfc}\nFacturación anual: $${client.annualRevenue.toLocaleString("es-MX")}\n\nServicio: ${projService.serviceName}\n% del presupuesto: ${projService.chosenPct}%\nMonto anual del servicio: $${projService.annualAmount.toLocaleString("es-MX")}\n\nRespuestas del cuestionario:\n${questionnaireContext}\n\nGenera el contenido para la variable "${aiVar.label}". Responde solo con el contenido, sin explicaciones, sin encabezados, sin comillas.`
            );

            resolvedHtml = resolvedHtml.replace(
              new RegExp(escapeRegex(`{{${aiVar.key}}}`), "g"),
              text
            );
          } catch (err) {
            console.error(
              `[Quotation Pipeline] AI variable "${aiVar.key}" failed:`,
              err
            );
            resolvedHtml = resolvedHtml.replace(
              new RegExp(escapeRegex(`{{${aiVar.key}}}`), "g"),
              AI_UNAVAILABLE_PLACEHOLDER
            );
          }
        }
      } else if (aiVariables.length > 0) {
        for (const aiVar of aiVariables) {
          resolvedHtml = resolvedHtml.replace(
            new RegExp(escapeRegex(`{{${aiVar.key}}}`), "g"),
            AI_UNAVAILABLE_PLACEHOLDER
          );
        }
      }

      if (pendingVariables.length > 0) {
        console.log(
          `[Quotation Pipeline] ${pendingVariables.length} variables con marca [PENDIENTE]: ${pendingVariables.slice(0, 5).join(", ")}${pendingVariables.length > 5 ? "..." : ""}`
        );
      }

      finalContent = resolvedHtml;
    } else {
      finalContent = buildFallbackHtml(
        context.client,
        context.projection,
        context.projService,
        context.orgBranding
      );
    }

    const quotationId = await ctx.runMutation(
      internal.functions.quotations.mutations.saveGenerated,
      {
        orgId,
        projServiceId: args.projServiceId,
        clientId: client._id,
        serviceName: projService.serviceName,
        content: finalContent,
      }
    );

    return quotationId;
  },
});

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildQuotationEmailHtml(input: {
  client: { name: string; contactName?: string };
  serviceName: string;
  issuingCompany: { name: string; primaryColor?: string };
  token: string;
  appUrl: string;
}): string {
  const greeting = input.client.contactName
    ? `Estimado/a ${input.client.contactName}`
    : `Estimado/a cliente`;
  const link = `${input.appUrl}/q/cotizacion/${input.token}`;
  const primary = input.issuingCompany.primaryColor ?? "#1a1a2e";
  return `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px;">
  <p>${greeting},</p>
  <p>Te compartimos la cotización de <strong>${input.serviceName}</strong> por parte de <strong>${input.issuingCompany.name}</strong>.</p>
  <p>Puedes revisarla y responder directamente desde el siguiente enlace:</p>
  <p style="margin: 32px 0; text-align: center;">
    <a href="${link}" style="display: inline-block; background: ${primary}; color: white; padding: 14px 28px; border-radius: 6px; text-decoration: none; font-weight: 600;">Ver cotización</a>
  </p>
  <p style="color: #666; font-size: 13px;">También adjuntamos el PDF. La cotización es válida por 30 días naturales.</p>
  <p style="color: #666; font-size: 13px;">Si el botón no funciona, copia este link en tu navegador:<br/><span style="color: ${primary}; word-break: break-all;">${link}</span></p>
</div>`.trim();
}
