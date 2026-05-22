import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { getOrgNotificationEmail } from "../email/resolveRecipients";

// NO auth required - uses token for verification
export const updateResponsesByToken = mutation({
  args: {
    token: v.string(),
    responses: v.array(
      v.object({
        questionId: v.string(),
        questionText: v.string(),
        answer: v.string(),
        serviceNames: v.array(v.string()),
        type: v.optional(
          v.union(
            v.literal("text"),
            v.literal("textarea"),
            v.literal("select"),
            v.literal("number"),
            v.literal("date"),
            v.literal("file_upload")
          )
        ),
        fileConfig: v.optional(
          v.object({
            acceptedMimeTypes: v.array(v.string()),
            maxSizeMB: v.number(),
            multiple: v.boolean(),
          })
        ),
        templateVariableMappings: v.optional(
          v.array(
            v.object({
              templateId: v.id("deliverableTemplates"),
              variableName: v.string(),
            })
          )
        ),
        filename: v.optional(v.string()),
        section: v.optional(v.string()),
        subsection: v.optional(v.string()),
        variableKey: v.optional(v.string()),
        options: v.optional(v.array(v.string())),
      })
    ),
  },
  handler: async (ctx, args) => {
    const questionnaire = await ctx.db
      .query("questionnaireResponses")
      .withIndex("by_accessToken", (q) => q.eq("accessToken", args.token))
      .first();
    if (!questionnaire) throw new Error("Cuestionario no encontrado.");
    if (questionnaire.status === "completed")
      throw new Error("Este cuestionario ya fue completado.");

    await ctx.db.patch(questionnaire._id, {
      responses: args.responses,
      status:
        questionnaire.status === "draft" || questionnaire.status === "sent"
          ? "in_progress"
          : questionnaire.status,
    });
    return { success: true };
  },
});

export const submitByToken = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const questionnaire = await ctx.db
      .query("questionnaireResponses")
      .withIndex("by_accessToken", (q) => q.eq("accessToken", args.token))
      .first();
    if (!questionnaire) throw new Error("Cuestionario no encontrado.");
    if (questionnaire.status === "completed")
      throw new Error("Ya fue completado.");

    await ctx.db.patch(questionnaire._id, {
      status: "completed",
      completedAt: Date.now(),
    });

    // Notif por email al responsable del org (espejo de markCompleted en
    // mutations.ts:200+). El cliente termina via token publico, no hay
    // auth — same recipient resolution: orgConfigs.notificationEmail.
    const client = await ctx.db.get(questionnaire.clientId);
    const clientName = client?.name ?? "Cliente";
    const assignedTo = client?.assignedTo;
    if (assignedTo) {
      const notifyTo = await getOrgNotificationEmail(ctx, questionnaire.orgId);
      if (!notifyTo) {
        console.warn(
          "[questionnaire/public] Sin email de notificacion para org " +
            `${questionnaire.orgId}; omitiendo notificacion de cuestionario ` +
            "completado por cliente."
        );
      } else {
        await ctx.scheduler.runAfter(
          0,
          internal.functions.email.send.sendEmailInternal,
          {
            to: notifyTo,
            subject: `Cuestionario completado - ${clientName}`,
            html: `<p>El cliente <strong>${clientName}</strong> ha completado su cuestionario.</p><p>Revisa las respuestas en la plataforma.</p>`,
          }
        );
      }
    }

    return { success: true };
  },
});
