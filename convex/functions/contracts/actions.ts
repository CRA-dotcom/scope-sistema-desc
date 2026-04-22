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
      "[Contract Pipeline] ANTHROPIC_API_KEY not configured. AI variables will use placeholder."
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
        `[Contract Pipeline] Claude API attempt ${attempt + 1}/${maxRetries} failed:`,
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
  const today = new Date().toLocaleDateString("es-MX", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const monthly =
    projService != null ? safeMoney(projService.annualAmount / 12) : "0.00";
  const annual =
    projService != null ? safeMoney(projService.annualAmount) : "0.00";

  return `
<div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px;">
  <div style="text-align: center; margin-bottom: 40px;">
    <h1 style="font-size: 24px; color: ${primary}; margin-bottom: 8px;">CONTRATO DE PRESTACIÓN DE SERVICIOS</h1>
    <p style="color: #666; font-size: 14px;">Fecha: ${today}</p>
  </div>
  <div style="margin-bottom: 32px;">
    <h2 style="font-size: 16px; color: ${primary}; border-bottom: 2px solid ${secondary}; padding-bottom: 8px;">PARTES</h2>
    <div style="margin-top: 12px; font-size: 14px; line-height: 1.8;">
      <p><strong>EL PRESTADOR:</strong> ${consultantName}</p>
      <p><strong>EL CLIENTE:</strong> ${client?.name ?? ""}</p>
      <p><strong>RFC:</strong> ${client?.rfc ?? ""}</p>
      <p><strong>Industria:</strong> ${client?.industry ?? ""}</p>
    </div>
  </div>
  <div style="margin-bottom: 32px;">
    <h2 style="font-size: 16px; color: ${primary}; border-bottom: 2px solid ${secondary}; padding-bottom: 8px;">OBJETO DEL CONTRATO</h2>
    <p style="margin-top: 12px; font-size: 14px; line-height: 1.8;">
      El PRESTADOR se compromete a proporcionar al CLIENTE el servicio de <strong>${projService?.serviceName ?? ""}</strong>
      durante el año fiscal <strong>${projection?.year ?? ""}</strong>, conforme a las condiciones establecidas
      en la cotización aprobada y las cláusulas del presente contrato.
    </p>
  </div>
  <div style="margin-bottom: 32px;">
    <h2 style="font-size: 16px; color: ${primary}; border-bottom: 2px solid ${secondary}; padding-bottom: 8px;">CONDICIONES ECONÓMICAS</h2>
    <table style="width: 100%; margin-top: 12px; font-size: 14px; border-collapse: collapse;">
      <thead><tr style="background: #f5f5ff;"><th style="text-align: left; padding: 10px; border: 1px solid #e0e0e0;">Concepto</th><th style="text-align: right; padding: 10px; border: 1px solid #e0e0e0;">Monto</th></tr></thead>
      <tbody>
        <tr><td style="padding: 10px; border: 1px solid #e0e0e0;">Inversión anual</td><td style="text-align: right; padding: 10px; border: 1px solid #e0e0e0; font-weight: 600;">$${annual}</td></tr>
        <tr><td style="padding: 10px; border: 1px solid #e0e0e0;">Inversión mensual estimada</td><td style="text-align: right; padding: 10px; border: 1px solid #e0e0e0; font-weight: 600;">$${monthly}</td></tr>
        <tr><td style="padding: 10px; border: 1px solid #e0e0e0;">Porcentaje asignado</td><td style="text-align: right; padding: 10px; border: 1px solid #e0e0e0;">${projService?.chosenPct ?? 0}%</td></tr>
      </tbody>
    </table>
  </div>
  <div style="margin-bottom: 32px;">
    <h2 style="font-size: 16px; color: ${primary}; border-bottom: 2px solid ${secondary}; padding-bottom: 8px;">CLÁUSULAS GENERALES</h2>
    <ol style="font-size: 14px; color: #444; line-height: 1.8; padding-left: 20px;">
      <li><strong>Vigencia:</strong> El presente contrato tendrá vigencia durante el año fiscal ${projection?.year ?? ""}.</li>
      <li><strong>Facturación:</strong> La facturación se realizará de forma ${client?.billingFrequency ?? "mensual"}.</li>
      <li><strong>IVA:</strong> Los montos no incluyen IVA, el cual se agregará conforme a la legislación vigente.</li>
      <li><strong>Confidencialidad:</strong> Ambas partes se comprometen a mantener la confidencialidad de la información compartida.</li>
      <li><strong>Cancelación:</strong> Cualquiera de las partes podrá cancelar el contrato con 30 días naturales de anticipación por escrito.</li>
      <li><strong>Jurisdicción:</strong> Para cualquier controversia, las partes se someten a la jurisdicción de los tribunales competentes.</li>
    </ol>
  </div>
  <div style="margin-bottom: 32px;">
    <h2 style="font-size: 16px; color: ${primary}; border-bottom: 2px solid ${secondary}; padding-bottom: 8px;">FIRMAS</h2>
    <div style="display: flex; justify-content: space-between; margin-top: 40px;">
      <div style="text-align: center; width: 45%;">
        <div style="border-bottom: 1px solid #333; height: 60px;"></div>
        <p style="margin-top: 8px; font-size: 14px; font-weight: 600;">EL PRESTADOR</p>
        <p style="font-size: 12px; color: #666;">${consultantName}</p>
      </div>
      <div style="text-align: center; width: 45%;">
        <div style="border-bottom: 1px solid #333; height: 60px;"></div>
        <p style="margin-top: 8px; font-size: 14px; font-weight: 600;">EL CLIENTE</p>
        <p style="font-size: 12px; color: #666;">${client?.name ?? ""}</p>
      </div>
    </div>
  </div>
</div>`.trim();
}

/**
 * Generate a contract from an approved quotation with full variable resolution
 * (client, projection, service, org branding, dates) and AI fill for `ai` source
 * variables. Falls back to a basic HTML contract if no template is registered.
 */
export const generateContract = action({
  args: {
    quotationId: v.id("quotations"),
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

    const quotation = await ctx.runQuery(
      internal.functions.contracts.internalQueries.getQuotationData,
      { quotationId: args.quotationId }
    );
    if (!quotation || quotation.orgId !== orgId) {
      throw new Error("Cotización no encontrada.");
    }
    if (quotation.status !== "approved") {
      throw new Error(
        "Solo se pueden generar contratos a partir de cotizaciones aprobadas."
      );
    }

    const projService = await ctx.runQuery(
      internal.functions.contracts.internalQueries.getProjServiceData,
      { projServiceId: quotation.projServiceId }
    );
    if (!projService || projService.orgId !== orgId) {
      throw new Error("Servicio de proyección no encontrado.");
    }

    const projection = await ctx.runQuery(
      internal.functions.contracts.internalQueries.getProjectionData,
      { projectionId: projService.projectionId }
    );
    if (!projection || projection.orgId !== orgId) {
      throw new Error("Proyección no encontrada.");
    }

    const client = await ctx.runQuery(
      internal.functions.contracts.internalQueries.getClientData,
      { clientId: quotation.clientId }
    );
    if (!client || client.orgId !== orgId) {
      throw new Error("Cliente no encontrado.");
    }

    const [orgBranding, questionnaire, template] = await Promise.all([
      ctx.runQuery(
        internal.functions.contracts.internalQueries.getOrgBranding,
        { orgId }
      ),
      ctx.runQuery(
        internal.functions.contracts.internalQueries.getQuestionnaireForProjection,
        { projectionId: projService.projectionId }
      ),
      ctx.runQuery(
        internal.functions.contracts.internalQueries.findContractTemplate,
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
        validityDays: 365,
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

        const systemPrompt = `Eres un abogado corporativo que redacta contratos profesionales de prestación de servicios de ${projService.serviceName}. El tono debe ser formal, claro y legalmente correcto.`;

        for (const aiVar of aiVariables) {
          try {
            const text = await callClaudeWithRetry(
              anthropic,
              systemPrompt,
              `Variable: ${aiVar.label} (${aiVar.key})\n\nCliente: ${client.name}\nRFC: ${client.rfc}\nIndustria: ${client.industry}\n\nServicio contratado: ${projService.serviceName}\nAño fiscal: ${projection.year}\nMonto anual: $${projService.annualAmount.toLocaleString("es-MX")}\nFrecuencia de facturación: ${client.billingFrequency}\n\nRespuestas del cuestionario:\n${questionnaireContext}\n\nGenera el contenido para la variable "${aiVar.label}" con lenguaje legal profesional en español. Responde solo con el contenido — sin explicaciones, sin encabezados, sin comillas.`
            );

            resolvedHtml = resolvedHtml.replace(
              new RegExp(escapeRegex(`{{${aiVar.key}}}`), "g"),
              text
            );
          } catch (err) {
            console.error(
              `[Contract Pipeline] AI variable "${aiVar.key}" failed:`,
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
          `[Contract Pipeline] ${pendingVariables.length} variables con marca [PENDIENTE]: ${pendingVariables.slice(0, 5).join(", ")}${pendingVariables.length > 5 ? "..." : ""}`
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

    const contractId = await ctx.runMutation(
      internal.functions.contracts.mutations.saveGenerated,
      {
        orgId,
        quotationId: args.quotationId,
        projServiceId: quotation.projServiceId,
        clientId: client._id,
        serviceName: projService.serviceName,
        content: finalContent,
      }
    );

    return contractId;
  },
});
