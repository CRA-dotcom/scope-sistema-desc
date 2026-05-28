import { mutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";
import { requireAdmin, getOrgId } from "../../lib/authHelpers";
import { MASTER_QUESTIONS } from "./masterQuestionnaire";
import { getOrgNotificationEmail } from "../email/resolveRecipients";

export const generate = mutation({
  args: {
    projectionId: v.id("projections"),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgId(ctx);

    const projection = await ctx.db.get(args.projectionId);
    if (!projection || projection.orgId !== orgId) {
      throw new Error("Proyección no encontrada.");
    }

    const existing = await ctx.db
      .query("questionnaireResponses")
      .withIndex("by_projectionId", (q) =>
        q.eq("projectionId", args.projectionId)
      )
      .first();
    if (existing) {
      throw new Error("Ya existe un cuestionario para esta proyección.");
    }

    const projServices = await ctx.db
      .query("projectionServices")
      .withIndex("by_projectionId_active", (q) =>
        q.eq("projectionId", args.projectionId).eq("isActive", true)
      )
      .collect();

    if (projServices.length === 0) {
      throw new Error("No hay servicios activos en esta proyección.");
    }

    const activeServiceNames = projServices.map((ps) => ps.serviceName);

    // 1) Filter by serviceScope
    const applicableQs = MASTER_QUESTIONS.filter((q) =>
      !q.serviceScope ||
      q.serviceScope.some((s) => activeServiceNames.includes(s))
    );

    // 2) Load active templates for this org+services to resolve variable keys
    const orgTemplates = await ctx.db
      .query("deliverableTemplates")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const templatesForActiveServices = orgTemplates.filter(
      (t) => t.isActive && activeServiceNames.includes(t.serviceName)
    );

    // 3) Build responses with resolved templateVariableMappings
    const responses = applicableQs.map((q) => {
      const mappings = q.variableKey
        ? templatesForActiveServices
            .filter((t) => t.variables.some((v) => v.key === q.variableKey))
            .map((t) => ({ templateId: t._id, variableName: q.variableKey! }))
        : undefined;

      return {
        questionId: q.key,
        questionText: q.text,
        answer: "",
        serviceNames: activeServiceNames,
        section: q.section,
        subsection: q.subsection,
        type: q.type,
        options: q.options,
        fileConfig: q.fileConfig,
        variableKey: q.variableKey,
        templateVariableMappings: mappings,
      };
    });

    const accessToken =
      Math.random().toString(36).slice(2) +
      Date.now().toString(36) +
      Math.random().toString(36).slice(2);

    const id = await ctx.db.insert("questionnaireResponses", {
      orgId,
      clientId: projection.clientId,
      projectionId: args.projectionId,
      responses,
      status: "draft",
      accessToken,
      createdAt: Date.now(),
    });

    return id;
  },
});

export const updateResponses = mutation({
  args: {
    id: v.id("questionnaireResponses"),
    responses: v.array(
      v.object({
        questionId: v.string(),
        questionText: v.string(),
        answer: v.string(),
        serviceNames: v.array(v.string()),
        // pass-through fields populated at generate-time:
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
    const orgId = await getOrgId(ctx);
    const questionnaire = await ctx.db.get(args.id);
    if (!questionnaire || questionnaire.orgId !== orgId) {
      throw new Error("Cuestionario no encontrado.");
    }
    if (questionnaire.status === "completed") {
      throw new Error("No se puede editar un cuestionario completado.");
    }

    const newStatus =
      questionnaire.status === "sent" ? "in_progress" : questionnaire.status;

    await ctx.db.patch(args.id, {
      responses: args.responses,
      status: newStatus as "draft" | "sent" | "in_progress" | "completed",
    });
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("questionnaireResponses"),
    status: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("in_progress"),
      v.literal("completed")
    ),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgId(ctx);
    const questionnaire = await ctx.db.get(args.id);
    if (!questionnaire || questionnaire.orgId !== orgId) {
      throw new Error("Cuestionario no encontrado.");
    }

    const patch: Record<string, unknown> = { status: args.status };
    if (args.status === "completed") {
      patch.completedAt = Date.now();
    }

    await ctx.db.patch(args.id, patch);
  },
});

export const submit = mutation({
  args: {
    id: v.id("questionnaireResponses"),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgId(ctx);
    const questionnaire = await ctx.db.get(args.id);
    if (!questionnaire || questionnaire.orgId !== orgId) {
      throw new Error("Cuestionario no encontrado.");
    }
    if (questionnaire.status === "completed") {
      throw new Error("Este cuestionario ya fue completado.");
    }

    await ctx.db.patch(args.id, {
      status: "completed",
      completedAt: Date.now(),
      reopenedAt: undefined,
      reopenedBy: undefined,
    });

    // Get client info for notification email
    const client = await ctx.db.get(questionnaire.clientId);
    const clientName = client?.name ?? "Cliente";

    // Notification gate: only notify if the client has an assigned ejecutivo.
    // We do NOT email the ejecutivo directly (would require a Clerk lookup);
    // instead we notify the org responsable (orgConfigs.notificationEmail),
    // resolved via getOrgNotificationEmail. See ClickUp 86ahjaqzc.
    const assignedTo = client?.assignedTo;
    if (assignedTo) {
      const notifyTo = await getOrgNotificationEmail(ctx, questionnaire.orgId);
      if (!notifyTo) {
        console.warn(
          "[questionnaire] Sin email de notificación para org " +
            `${questionnaire.orgId}; omitiendo notificación de ` +
            "cuestionario completado."
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

export const reopen = mutation({
  args: { id: v.id("questionnaireResponses") },
  handler: async (ctx, args) => {
    const identity = await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    const userId = identity.subject;
    const q = await ctx.db.get(args.id);
    if (!q || q.orgId !== orgId) {
      throw new Error("Cuestionario no encontrado.");
    }
    if (q.status !== "completed") {
      throw new Error("Solo cuestionarios completados se pueden reabrir.");
    }
    await ctx.db.patch(args.id, {
      status: "in_progress" as const,
      completedAt: undefined,
      reopenedAt: Date.now(),
      reopenedBy: userId,
    });
    await ctx.db.insert("documentEvents", {
      orgId,
      clientId: q.clientId,
      entityType: "questionnaire" as const,
      entityId: args.id,
      eventType: "reopened" as const,
      severity: "info" as const,
      actorUserId: userId,
      actorType: "user" as const,
      message: "Cuestionario reabierto.",
      createdAt: Date.now(),
    });
  },
});
