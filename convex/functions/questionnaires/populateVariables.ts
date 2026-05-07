import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgId } from "../../lib/authHelpers";
import { buildTemplateVariables } from "../../lib/questionnaireMappings";

/**
 * Fase D4 — Populate template variables from questionnaire responses.
 *
 * Reads the questionnaireResponse for a projection, walks each response's
 * templateVariableMappings, and builds { variableName: value } per templateId
 * via the D1 buildTemplateVariables helper.
 *
 * For file_upload questions the helper produces {var}_storageId; this mutation
 * resolves that to a signed URL via ctx.storage.getUrl and exposes it as
 * {var}_url. The raw storage ID is dropped from the returned variables.
 *
 * NOTE: The schema does not include a `deliverableJobs` table, so the computed
 * variables are returned to the caller rather than persisted to a job row.
 * The existing AI generation action in convex/functions/deliverables/actions.ts
 * reads questionnaire responses directly; callers can pass the variables
 * returned here as supplemental context or store them in their own state.
 *
 * Returns:
 *   { templatesPopulated: number, variables: Record<templateId, Record<varName, string>> }
 */
export const populateTemplateVariables = mutation({
  args: { projectionId: v.id("projections") },
  handler: async (ctx, { projectionId }) => {
    // 1. Auth check
    const orgId = await getOrgId(ctx);

    // 2. Read projection and verify org ownership
    const projection = await ctx.db.get(projectionId);
    if (!projection || projection.orgId !== orgId) {
      throw new Error("Proyección no encontrada.");
    }

    // 3. Read questionnaire response for this projection
    const questionnaire = await ctx.db
      .query("questionnaireResponses")
      .withIndex("by_projectionId", (q) => q.eq("projectionId", projectionId))
      .first();

    if (!questionnaire) {
      // No questionnaire yet — return empty mappings
      return { templatesPopulated: 0, variables: {} };
    }

    // 4. Map schema responses to the shapes expected by buildTemplateVariables
    const questions = questionnaire.responses.map((r) => ({
      key: r.questionId,
      type: r.type ?? "text",
      templateVariableMappings: r.templateVariableMappings,
    }));

    const responses = questionnaire.responses.map((r) => ({
      questionKey: r.questionId,
      value: r.answer,
      filename: r.filename,
    }));

    // 5. Build per-template variable maps via D1 helper
    const templateVarsMap = buildTemplateVariables(questions, responses);

    // 6. Resolve _storageId entries to signed URLs
    let templatesPopulated = 0;
    const resolvedVariables: Record<string, Record<string, string>> = {};

    for (const [templateId, vars] of templateVarsMap.entries()) {
      const resolvedVars: Record<string, string> = {};

      for (const [varName, value] of Object.entries(vars)) {
        if (varName.endsWith("_storageId")) {
          // Resolve storage ID → signed URL; drop the raw ID from results
          const baseName = varName.replace(/_storageId$/, "");
          try {
            const url = await ctx.storage.getUrl(value as any);
            if (url) {
              resolvedVars[`${baseName}_url`] = url;
            }
          } catch (err) {
            // Storage ID may be invalid / expired; skip gracefully
            console.warn(
              `[D4] Could not resolve storage URL for ${varName}:`,
              err
            );
          }
          // filename is already handled by buildTemplateVariables as a separate key
        } else {
          resolvedVars[varName] = value;
        }
      }

      resolvedVariables[templateId] = resolvedVars;
      templatesPopulated++;
    }

    // NOTE: No deliverableJobs table exists in the schema.
    // Variables are returned to the caller for use at AI-generation time.
    // If a deliverableJobs table is added in a future sprint, patch it here:
    //
    //   const existingJob = await ctx.db
    //     .query("deliverableJobs")
    //     .filter((q) => q.and(
    //       q.eq(q.field("projectionId"), projectionId),
    //       q.eq(q.field("templateId"), templateId),
    //     ))
    //     .first();
    //   if (existingJob) {
    //     await ctx.db.patch(existingJob._id, { aiVariables: resolvedVars });
    //   }

    return { templatesPopulated, variables: resolvedVariables };
  },
});
