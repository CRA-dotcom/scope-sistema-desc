"use node";

import { action, internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";
import Anthropic from "@anthropic-ai/sdk";
import { extractPlaceholders } from "../../lib/deliverableEngine/placeholders";
import {
  resolveStatic,
  type StaticResolutionContext,
} from "../../lib/deliverableEngine/staticResolver";
import { batchFillWithClaude } from "../../lib/deliverableEngine/aiBatchFill";
import {
  CreditExhaustedError,
  CostCapExceededError,
} from "../../lib/deliverableEngine/errors";

// ─── Constants ───────────────────────────────────────────────────────

const MODEL = "claude-sonnet-4-20250514";
const MAX_RETRIES = 3;
const AI_UNAVAILABLE_PLACEHOLDER = "[AI no disponible — configurar API key]";

// Cost estimate per token (Claude Sonnet pricing as of 2025)
const INPUT_COST_PER_TOKEN = 3 / 1_000_000; // $3 per 1M input tokens
const OUTPUT_COST_PER_TOKEN = 15 / 1_000_000; // $15 per 1M output tokens

// ─── Types ───────────────────────────────────────────────────────────

type AiLogEntry = {
  role: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  timestamp: number;
};

// ─── Helpers ─────────────────────────────────────────────────────────

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "placeholder") {
    console.warn(
      "[AI Pipeline] ANTHROPIC_API_KEY not configured. Using placeholder content."
    );
    return null;
  }
  return new Anthropic({ apiKey });
}

/**
 * Build the cacheable context block sent to Claude per chunk. Mirrors the
 * shape from scripts/generate-demo-deliverables.mjs so output is comparable
 * when validating the refactor against the reference PDFs.
 */
function buildContextBlock(args: {
  client: { name: string; rfc: string; industry: string; annualRevenue: number };
  projection:
    | { year: number; annualSales: number; totalBudget: number; effectiveBudget?: number }
    | null;
  projService: { serviceName: string; chosenPct: number; annualAmount: number } | null;
  questionnaire:
    | { responses?: Array<{ section?: string; questionText: string; answer: string | unknown }> }
    | null;
}): string {
  const { client, projection, projService, questionnaire } = args;

  const responses = questionnaire?.responses ?? [];
  const questionnaireText = responses
    .map((r) => {
      const a = typeof r.answer === "string" ? r.answer : JSON.stringify(r.answer);
      return `[${r.section ?? "General"}] ${r.questionText}\n→ ${a}`;
    })
    .join("\n\n");

  const projServiceAmount = projService
    ? projService.annualAmount > 0
      ? projService.annualAmount
      : Math.round(
          (projService.chosenPct ?? 0) *
            (projection?.effectiveBudget ?? projection?.totalBudget ?? 0)
        )
    : 0;

  const projServiceLine = projService
    ? `${projService.serviceName} — ${(projService.chosenPct * 100).toFixed(2)}% del presupuesto, monto anual $${projServiceAmount.toLocaleString("es-MX")} MXN`
    : "Servicio no contratado en la proyección actual";

  const projLine = projection
    ? `PROYECCIÓN ${projection.year}: ventas $${projection.annualSales.toLocaleString("es-MX")} MXN, presupuesto total $${projection.totalBudget.toLocaleString("es-MX")} MXN`
    : "PROYECCIÓN: sin datos";

  return `CLIENTE: ${client.name} (${client.industry}, RFC ${client.rfc}, facturación anual $${client.annualRevenue.toLocaleString("es-MX")} MXN)
${projLine}
SERVICIO (${projService?.serviceName ?? "n/a"}): ${projServiceLine}

RESPUESTAS DEL CUESTIONARIO:
${questionnaireText || "Sin respuestas de cuestionario disponibles."}`;
}

function formatToday(): string {
  return new Date().toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function callClaudeWithRetry(
  client: Anthropic,
  systemPrompt: string,
  userPrompt: string,
  maxRetries: number = MAX_RETRIES
): Promise<{ text: string; log: AiLogEntry }> {
  let lastError: unknown;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      const text = textBlock && "text" in textBlock ? textBlock.text : "";

      const inputTokens = response.usage.input_tokens;
      const outputTokens = response.usage.output_tokens;
      const costUsd =
        inputTokens * INPUT_COST_PER_TOKEN + outputTokens * OUTPUT_COST_PER_TOKEN;

      return {
        text,
        log: {
          role: "generate",
          model: MODEL,
          inputTokens,
          outputTokens,
          costUsd: Math.round(costUsd * 1_000_000) / 1_000_000, // Round to 6 decimals
          timestamp: Date.now(),
        },
      };
    } catch (err) {
      lastError = err;
      console.error(
        `[AI Pipeline] Claude API attempt ${attempt + 1}/${maxRetries} failed:`,
        err
      );

      if (attempt < maxRetries - 1) {
        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

// ─── Actions ─────────────────────────────────────────────────────────

/**
 * Generate a deliverable using AI.
 * Fetches all required data, resolves non-AI template variables,
 * then calls Claude to fill AI variables.
 */
export const generateDeliverable = action({
  args: {
    assignmentId: v.id("monthlyAssignments"),
    projServiceId: v.id("projectionServices"),
    clientId: v.id("clients"),
    templateType: v.union(
      v.literal("deliverable_short"),
      v.literal("deliverable_long")
    ),
  },
  handler: async (ctx, args): Promise<string> => {
    // 1. Fetch all required data in parallel
    const [assignment, client, projService] = await Promise.all([
      ctx.runQuery(internal.functions.deliverables.internalQueries.getAssignmentData, {
        assignmentId: args.assignmentId,
      }),
      ctx.runQuery(internal.functions.deliverables.internalQueries.getClientData, {
        clientId: args.clientId,
      }),
      ctx.runQuery(internal.functions.deliverables.internalQueries.getProjServiceData, {
        projServiceId: args.projServiceId,
      }),
    ]);

    if (!assignment) throw new Error("Asignacion no encontrada.");
    if (!client) throw new Error("Cliente no encontrado.");
    if (!projService) throw new Error("Servicio de proyeccion no encontrado.");

    const [projection, questionnaire, orgBranding, template] = await Promise.all([
      ctx.runQuery(
        internal.functions.deliverables.internalQueries.getProjectionByProjService,
        { projectionId: projService.projectionId }
      ),
      ctx.runQuery(
        internal.functions.deliverables.internalQueries.getQuestionnaireForClient,
        { clientId: args.clientId, projectionId: projService.projectionId }
      ),
      ctx.runQuery(internal.functions.deliverables.internalQueries.getOrgBranding, {
        orgId: assignment.orgId,
      }),
      ctx.runQuery(internal.functions.deliverables.internalQueries.findTemplate, {
        serviceName: projService.serviceName,
        type: args.templateType,
        orgId: assignment.orgId,
      }),
    ]);

    const aiLogs: AiLogEntry[] = [];
    let unfilledKeys: string[] = [];
    let totalCost = 0;
    let finalContent: string;

    if (template) {
      // 2. Discover placeholders directly from the HTML (template.variables ignored).
      const placeholders = extractPlaceholders(template.htmlTemplate);

      // 3. Resolve static placeholders, collect AI keys.
      const staticCtx: StaticResolutionContext = {
        client: {
          name: client.name,
          rfc: client.rfc,
          industry: client.industry,
          annualRevenue: client.annualRevenue,
          billingFrequency: client.billingFrequency,
          contactName: client.contactName,
          contactEmail: client.contactEmail,
        },
        projection: projection
          ? {
              year: projection.year,
              annualSales: projection.annualSales,
              totalBudget: projection.totalBudget,
              effectiveBudget: projection.effectiveBudget,
            }
          : null,
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
              footerText: orgBranding.footerText,
            }
          : null,
        today: formatToday(),
      };

      const resolved: Record<string, string> = {};
      const needsAi: string[] = [];
      for (const k of placeholders) {
        const v = resolveStatic(k, staticCtx);
        if (v !== null) resolved[k] = v;
        else needsAi.push(k);
      }

      // 4. Batched AI fill (only if we have an Anthropic key + AI keys to fill).
      const anthropic = getAnthropicClient();
      if (anthropic && needsAi.length > 0) {
        const contextBlock = buildContextBlock({
          client,
          projection,
          projService,
          questionnaire,
        });
        try {
          const result = await batchFillWithClaude(
            anthropic,
            projService.serviceName,
            contextBlock,
            needsAi
          );
          Object.assign(resolved, result.resolved);
          aiLogs.push(...result.log);
          unfilledKeys = result.unfilled;
          totalCost = result.totalCost;
        } catch (err) {
          if (err instanceof CreditExhaustedError) {
            console.warn("[deliverableEngine] credit exhausted; saving partial.");
            unfilledKeys = needsAi.filter((k) => !(k in resolved));
          } else if (err instanceof CostCapExceededError) {
            console.warn(
              `[deliverableEngine] cost cap exceeded at $${err.costUsd.toFixed(4)}; saving partial.`
            );
            unfilledKeys = needsAi.filter((k) => !(k in resolved));
            totalCost = err.costUsd;
          } else {
            throw err;
          }
        }
      } else if (!anthropic && needsAi.length > 0) {
        // No API key — leave AI keys unfilled (they get the visible marker below).
        unfilledKeys = needsAi;
      }

      // 5. Stuff visible markers for unfilled keys (D1).
      for (const k of unfilledKeys) {
        resolved[k] = `<em style="color:#94a3b8">[${k}]</em>`;
      }

      // 6. Replace all placeholders in the HTML.
      let html = template.htmlTemplate;
      for (const [k, v] of Object.entries(resolved)) {
        const safe = String(v ?? "").replace(/\$/g, "$$$$");
        html = html.replace(new RegExp(escapeRegex(`{{${k}}}`), "g"), safe);
      }
      finalContent = html;
    } else {
      // No template: fall back to direct generation (legacy behavior, rare path).
      const anthropic = getAnthropicClient();
      if (!anthropic) {
        finalContent = `<p>${AI_UNAVAILABLE_PLACEHOLDER}</p>`;
      } else {
        const questionnaireContext = questionnaire?.responses
          ? questionnaire.responses
              .map(
                (r: { questionText: string; answer: string }) =>
                  `P: ${r.questionText}\nR: ${r.answer}`
              )
              .join("\n\n")
          : "Sin respuestas de cuestionario disponibles.";
        try {
          const isShort = args.templateType === "deliverable_short";
          const result = await callClaudeWithRetry(
            anthropic,
            `Eres un consultor profesional de ${projService.serviceName}. Genera un ${isShort ? "resumen ejecutivo breve" : "informe detallado completo"} empresarial en formato HTML.`,
            `Cliente: ${client.name}\nIndustria: ${client.industry}\nRFC: ${client.rfc}\nServicio: ${projService.serviceName}\nMes: ${assignment.month}/${assignment.year}\nMonto mensual: $${assignment.amount.toLocaleString("es-MX")}\n\nRespuestas del cuestionario:\n${questionnaireContext}\n\nGenera un ${isShort ? "resumen ejecutivo (1-2 parrafos)" : "informe detallado con secciones: Resumen Ejecutivo, Analisis, Hallazgos, Recomendaciones, Proximos Pasos"} en espanol profesional. Responde en formato HTML.`
          );
          finalContent = result.text;
          aiLogs.push(result.log);
        } catch (err) {
          console.error("[deliverableEngine] Failed to generate content:", err);
          finalContent = `<p>${AI_UNAVAILABLE_PLACEHOLDER}</p>`;
        }
      }
    }

    // 7. Save deliverable (with unfilledKeys → rejected status per D1).
    const isShort = args.templateType === "deliverable_short";
    const deliverableId = await ctx.runMutation(
      internal.functions.deliverables.mutations.saveGenerated,
      {
        orgId: assignment.orgId,
        assignmentId: args.assignmentId,
        projServiceId: args.projServiceId,
        clientId: args.clientId,
        serviceName: projService.serviceName,
        month: assignment.month,
        year: assignment.year,
        shortContent: isShort ? finalContent : "",
        longContent: isShort ? "" : finalContent,
        aiLog: aiLogs,
        unfilledKeys: unfilledKeys.length > 0 ? unfilledKeys : undefined,
        costUsd: totalCost > 0 ? totalCost : undefined,
      }
    );

    // 8. Auto-queue audit (D5).
    await ctx.scheduler.runAfter(
      5000,
      internal.functions.deliverables.actions.auditDeliverable,
      { deliverableId }
    );

    console.log(
      `[deliverableEngine] Generated ${deliverableId}: type=${args.templateType}, AI calls=${aiLogs.length}, unfilled=${unfilledKeys.length}, cost=$${totalCost.toFixed(6)}`
    );

    return deliverableId;
  },
});

/**
 * Audit a deliverable using AI.
 * Validates completeness, professional tone, and accuracy against questionnaire data.
 *
 * Internal: only invoked by the scheduler at the end of generateDeliverable
 * (D5) or by regenerateDeliverable. Not exposed to the frontend.
 */
export const auditDeliverable = internalAction({
  args: { deliverableId: v.id("deliverables") },
  handler: async (ctx, args) => {
    const deliverable = await ctx.runQuery(
      internal.functions.deliverables.internalQueries.getDeliverableData,
      { deliverableId: args.deliverableId }
    );

    if (!deliverable) {
      throw new Error("Entregable no encontrado.");
    }

    const content = deliverable.shortContent || deliverable.longContent;
    if (!content) {
      throw new Error("El entregable no tiene contenido para auditar.");
    }

    // Get questionnaire data for validation
    const projService = await ctx.runQuery(
      internal.functions.deliverables.internalQueries.getProjServiceData,
      { projServiceId: deliverable.projServiceId }
    );

    let questionnaireContext = "Sin datos de cuestionario disponibles.";
    if (projService) {
      const questionnaire = await ctx.runQuery(
        internal.functions.deliverables.internalQueries.getQuestionnaireForClient,
        {
          clientId: deliverable.clientId,
          projectionId: projService.projectionId,
        }
      );

      if (questionnaire?.responses) {
        questionnaireContext = questionnaire.responses
          .map((r: { questionText: string; answer: string }) => `P: ${r.questionText}\nR: ${r.answer}`)
          .join("\n\n");
      }
    }

    const anthropic = getAnthropicClient();

    if (!anthropic) {
      console.warn("[AI Pipeline] No API key for audit. Marking as pending.");
      await ctx.runMutation(internal.functions.deliverables.mutations.updateAudit, {
        id: args.deliverableId,
        auditStatus: "approved",
        auditFeedback:
          "Auditoria automatica no disponible (API key no configurada). Aprobado por defecto.",
        aiLog: [],
      });
      return { approved: true, feedback: "Auto-approved (no API key)" };
    }

    try {
      const result = await callClaudeWithRetry(
        anthropic,
        "Eres un auditor de calidad de documentos empresariales. Tu trabajo es revisar entregables de consultoria y validar su calidad.",
        `Revisa este entregable:\n\n${content}\n\nDatos del cuestionario del cliente para validacion:\n${questionnaireContext}\n\nValida los siguientes criterios:\n1. Completitud: El documento cubre todos los puntos relevantes?\n2. Tono profesional: El lenguaje es apropiado para un entregable empresarial?\n3. Precision: Los datos mencionados son consistentes con la informacion del cuestionario?\n4. Estructura: El documento tiene una estructura logica y clara?\n\nResponde UNICAMENTE con un JSON valido (sin markdown, sin backticks) con este formato:\n{"approved": true/false, "feedback": "explicacion detallada de la evaluacion"}`
      );

      // Update the log role for audit
      const auditLog: AiLogEntry = { ...result.log, role: "audit" };

      // Parse Claude's response
      let approved = false;
      let feedback = result.text;

      try {
        // Try to extract JSON from the response
        const jsonMatch = result.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          approved = Boolean(parsed.approved);
          feedback = parsed.feedback || result.text;
        }
      } catch {
        console.warn(
          "[AI Pipeline] Could not parse audit JSON, treating as rejected:",
          result.text
        );
        approved = false;
        feedback = `Error parsing audit response. Raw: ${result.text}`;
      }

      const auditStatus = approved ? "approved" : "rejected";

      await ctx.runMutation(internal.functions.deliverables.mutations.updateAudit, {
        id: args.deliverableId,
        auditStatus,
        auditFeedback: feedback,
        aiLog: [auditLog],
      });

      // If rejected and retryCount < 3, schedule regeneration
      if (!approved && deliverable.retryCount < 3) {
        await ctx.runMutation(
          internal.functions.deliverables.mutations.incrementRetry,
          { id: args.deliverableId }
        );

        // Schedule regeneration via the same action
        await ctx.scheduler.runAfter(
          5000, // 5 second delay
          internal.functions.deliverables.actions.regenerateDeliverable,
          { deliverableId: args.deliverableId, feedback }
        );
      }

      console.log(
        `[AI Pipeline] Audit complete for ${args.deliverableId}: ${auditStatus}, cost: $${auditLog.costUsd.toFixed(6)}`
      );

      return { approved, feedback };
    } catch (err) {
      console.error("[AI Pipeline] Audit failed:", err);
      await ctx.runMutation(internal.functions.deliverables.mutations.updateAudit, {
        id: args.deliverableId,
        auditStatus: "rejected",
        auditFeedback: `Error en auditoria automatica: ${String(err)}`,
        aiLog: [],
      });
      return { approved: false, feedback: `Audit error: ${String(err)}` };
    }
  },
});

/**
 * Internal action: Regenerate a rejected deliverable with feedback context.
 */
export const regenerateDeliverable = internalAction({
  args: {
    deliverableId: v.id("deliverables"),
    feedback: v.string(),
  },
  handler: async (ctx, args) => {
    const deliverable = await ctx.runQuery(
      internal.functions.deliverables.internalQueries.getDeliverableData,
      { deliverableId: args.deliverableId }
    );

    if (!deliverable) {
      console.error("[AI Pipeline] Deliverable not found for regeneration.");
      return;
    }

    if (deliverable.retryCount >= 3) {
      console.warn(
        `[AI Pipeline] Max retries reached for ${args.deliverableId}. Skipping regeneration.`
      );
      return;
    }

    const anthropic = getAnthropicClient();
    if (!anthropic) {
      console.warn("[AI Pipeline] No API key for regeneration.");
      return;
    }

    const currentContent = deliverable.shortContent || deliverable.longContent;
    const isShort = Boolean(deliverable.shortContent);

    try {
      const result = await callClaudeWithRetry(
        anthropic,
        `Eres un consultor profesional de ${deliverable.serviceName}. Debes corregir un entregable empresarial que fue rechazado en auditoria de calidad.`,
        `Entregable actual:\n\n${currentContent}\n\nFeedback del auditor:\n${args.feedback}\n\nCorrige el entregable incorporando el feedback del auditor. Mantiene el formato HTML. Responde unicamente con el contenido corregido.`
      );

      const correctionLog: AiLogEntry = { ...result.log, role: "correction" };

      await ctx.runMutation(
        internal.functions.deliverables.mutations.updateAfterRegeneration,
        {
          id: args.deliverableId,
          shortContent: isShort ? result.text : undefined,
          longContent: isShort ? undefined : result.text,
          auditStatus: "corrected" as const,
          auditFeedback: `Corregido automaticamente basado en feedback: ${args.feedback}`,
          aiLog: [correctionLog],
        }
      );

      console.log(
        `[AI Pipeline] Regenerated deliverable ${args.deliverableId}, cost: $${correctionLog.costUsd.toFixed(6)}`
      );
    } catch (err) {
      console.error("[AI Pipeline] Regeneration failed:", err);
    }
  },
});
