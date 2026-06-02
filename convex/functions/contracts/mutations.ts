import { mutation, internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgId, getOrgIdMutation, requireAuth } from "../../lib/authHelpers";
import { cancelFuturePendingAssignments } from "../../lib/projectionDownstream";

export const generate = mutation({
  args: {
    quotationId: v.id("quotations"),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdMutation(ctx);

    // Get quotation (must be approved)
    const quotation = await ctx.db.get(args.quotationId);
    if (!quotation || quotation.orgId !== orgId) {
      throw new Error("Cotizaci\u00f3n no encontrada.");
    }
    if (quotation.status !== "approved") {
      throw new Error(
        "Solo se pueden generar contratos a partir de cotizaciones aprobadas."
      );
    }

    // Get projection service
    const projService = await ctx.db.get(quotation.projServiceId);
    if (!projService || projService.orgId !== orgId) {
      throw new Error("Servicio de proyecci\u00f3n no encontrado.");
    }

    // Get projection
    const projection = await ctx.db.get(projService.projectionId);
    if (!projection || projection.orgId !== orgId) {
      throw new Error("Proyecci\u00f3n no encontrada.");
    }

    // Get client
    const client = await ctx.db.get(quotation.clientId);
    if (!client || client.orgId !== orgId) {
      throw new Error("Cliente no encontrado.");
    }

    // Get service details
    const service = await ctx.db.get(projService.serviceId);

    // Look for a matching template (type "contract")
    let template = null;
    const templatesByType = await ctx.db
      .query("deliverableTemplates")
      .withIndex("by_type", (q) => q.eq("type", "contract"))
      .collect();

    // Try service-specific template
    template = templatesByType.find(
      (t) =>
        t.isActive &&
        t.serviceId === projService.serviceId &&
        (t.orgId === orgId || !t.orgId)
    );

    // Fall back to generic contract template
    if (!template) {
      template = templatesByType.find(
        (t) => t.isActive && !t.serviceId && (t.orgId === orgId || !t.orgId)
      );
    }

    let content: string;

    if (template) {
      content = template.htmlTemplate;
      const replacements: Record<string, string> = {
        name: client.name,
        rfc: client.rfc,
        industry: client.industry,
        annualRevenue: client.annualRevenue.toLocaleString("es-MX"),
        billingFrequency: client.billingFrequency,
        year: String(projection.year),
        annualSales: projection.annualSales.toLocaleString("es-MX"),
        totalBudget: projection.totalBudget.toLocaleString("es-MX"),
        commissionRate: String(projection.commissionRate),
        serviceName: projService.serviceName,
        type: service?.type ?? "base",
        chosenPct: String(projService.chosenPct),
        annualAmount: projService.annualAmount.toLocaleString("es-MX"),
      };

      for (const [key, value] of Object.entries(replacements)) {
        content = content.replace(
          new RegExp(`\\{\\{${key}\\}\\}`, "g"),
          value
        );
      }
    } else {
      // Default HTML contract structure
      const monthlyAmount = (projService.annualAmount / 12).toLocaleString(
        "es-MX",
        { minimumFractionDigits: 2, maximumFractionDigits: 2 }
      );
      const today = new Date().toLocaleDateString("es-MX", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      content = `
<div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px;">
  <div style="text-align: center; margin-bottom: 40px;">
    <h1 style="font-size: 24px; color: #1a1a2e; margin-bottom: 8px;">CONTRATO DE PRESTACI&Oacute;N DE SERVICIOS</h1>
    <p style="color: #666; font-size: 14px;">Fecha: ${today}</p>
  </div>

  <div style="margin-bottom: 32px;">
    <h2 style="font-size: 16px; color: #1a1a2e; border-bottom: 2px solid #6c63ff; padding-bottom: 8px;">PARTES</h2>
    <div style="margin-top: 12px; font-size: 14px; line-height: 1.8;">
      <p><strong>EL PRESTADOR:</strong> [Nombre de la empresa prestadora]</p>
      <p><strong>EL CLIENTE:</strong> ${client.name}</p>
      <p><strong>RFC:</strong> ${client.rfc}</p>
      <p><strong>Industria:</strong> ${client.industry}</p>
    </div>
  </div>

  <div style="margin-bottom: 32px;">
    <h2 style="font-size: 16px; color: #1a1a2e; border-bottom: 2px solid #6c63ff; padding-bottom: 8px;">OBJETO DEL CONTRATO</h2>
    <p style="margin-top: 12px; font-size: 14px; line-height: 1.8;">
      El PRESTADOR se compromete a proporcionar al CLIENTE el servicio de <strong>${projService.serviceName}</strong>
      durante el a&ntilde;o fiscal <strong>${projection.year}</strong>, conforme a las condiciones establecidas
      en la cotizaci&oacute;n aprobada y las cl&aacute;usulas del presente contrato.
    </p>
  </div>

  <div style="margin-bottom: 32px;">
    <h2 style="font-size: 16px; color: #1a1a2e; border-bottom: 2px solid #6c63ff; padding-bottom: 8px;">CONDICIONES ECON&Oacute;MICAS</h2>
    <table style="width: 100%; margin-top: 12px; font-size: 14px; border-collapse: collapse;">
      <thead>
        <tr style="background: #f5f5ff;">
          <th style="text-align: left; padding: 10px; border: 1px solid #e0e0e0;">Concepto</th>
          <th style="text-align: right; padding: 10px; border: 1px solid #e0e0e0;">Monto</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="padding: 10px; border: 1px solid #e0e0e0;">Inversi&oacute;n anual</td>
          <td style="text-align: right; padding: 10px; border: 1px solid #e0e0e0; font-weight: 600;">$${projService.annualAmount.toLocaleString("es-MX", { minimumFractionDigits: 2 })}</td>
        </tr>
        <tr>
          <td style="padding: 10px; border: 1px solid #e0e0e0;">Inversi&oacute;n mensual estimada</td>
          <td style="text-align: right; padding: 10px; border: 1px solid #e0e0e0; font-weight: 600;">$${monthlyAmount}</td>
        </tr>
        <tr>
          <td style="padding: 10px; border: 1px solid #e0e0e0;">Porcentaje asignado</td>
          <td style="text-align: right; padding: 10px; border: 1px solid #e0e0e0;">${projService.chosenPct}%</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div style="margin-bottom: 32px;">
    <h2 style="font-size: 16px; color: #1a1a2e; border-bottom: 2px solid #6c63ff; padding-bottom: 8px;">CL&Aacute;USULAS GENERALES</h2>
    <ol style="font-size: 14px; color: #444; line-height: 1.8; padding-left: 20px;">
      <li><strong>Vigencia:</strong> El presente contrato tendr&aacute; vigencia durante el a&ntilde;o fiscal ${projection.year}.</li>
      <li><strong>Facturaci&oacute;n:</strong> La facturaci&oacute;n se realizar&aacute; de forma ${client.billingFrequency}.</li>
      <li><strong>IVA:</strong> Los montos no incluyen IVA, el cual se agregar&aacute; conforme a la legislaci&oacute;n vigente.</li>
      <li><strong>Confidencialidad:</strong> Ambas partes se comprometen a mantener la confidencialidad de la informaci&oacute;n compartida.</li>
      <li><strong>Cancelaci&oacute;n:</strong> Cualquiera de las partes podr&aacute; cancelar el contrato con 30 d&iacute;as naturales de anticipaci&oacute;n por escrito.</li>
      <li><strong>Jurisdicci&oacute;n:</strong> Para cualquier controversia, las partes se someten a la jurisdicci&oacute;n de los tribunales competentes.</li>
    </ol>
  </div>

  <div style="margin-bottom: 32px;">
    <h2 style="font-size: 16px; color: #1a1a2e; border-bottom: 2px solid #6c63ff; padding-bottom: 8px;">FIRMAS</h2>
    <div style="display: flex; justify-content: space-between; margin-top: 40px;">
      <div style="text-align: center; width: 45%;">
        <div style="border-bottom: 1px solid #333; height: 60px;"></div>
        <p style="margin-top: 8px; font-size: 14px; font-weight: 600;">EL PRESTADOR</p>
        <p style="font-size: 12px; color: #666;">[Nombre y cargo]</p>
      </div>
      <div style="text-align: center; width: 45%;">
        <div style="border-bottom: 1px solid #333; height: 60px;"></div>
        <p style="margin-top: 8px; font-size: 14px; font-weight: 600;">EL CLIENTE</p>
        <p style="font-size: 12px; color: #666;">${client.name}</p>
      </div>
    </div>
  </div>

  <div style="margin-top: 48px; text-align: center; color: #999; font-size: 12px;">
    <p>Documento generado autom&aacute;ticamente a partir de la cotizaci&oacute;n aprobada.</p>
  </div>
</div>`.trim();
    }

    // Check if a contract already exists for this quotation
    const existing = await ctx.db
      .query("contracts")
      .withIndex("by_quotationId", (q) =>
        q.eq("quotationId", args.quotationId)
      )
      .first();

    if (existing && existing.orgId === orgId) {
      if (existing.status !== "draft") {
        throw new Error(
          "Ya existe un contrato para esta cotizaci\u00f3n que no est\u00e1 en borrador."
        );
      }
      await ctx.db.patch(existing._id, { content });
      return existing._id;
    }

    // Create new contract
    return await ctx.db.insert("contracts", {
      orgId,
      quotationId: args.quotationId,
      projServiceId: quotation.projServiceId,
      clientId: quotation.clientId,
      serviceName: quotation.serviceName,
      content,
      status: "draft",
      createdAt: Date.now(),
    });
  },
});

export const updateContent = mutation({
  args: {
    id: v.id("contracts"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdMutation(ctx);
    const contract = await ctx.db.get(args.id);
    if (!contract || contract.orgId !== orgId) {
      throw new Error("Contrato no encontrado.");
    }
    if (contract.status !== "draft") {
      throw new Error("Solo se pueden editar contratos en borrador.");
    }
    await ctx.db.patch(args.id, { content: args.content });
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("contracts"),
    status: v.union(
      v.literal("sent"),
      v.literal("signed"),
      v.literal("cancelled")
    ),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdMutation(ctx);
    const contract = await ctx.db.get(args.id);
    if (!contract || contract.orgId !== orgId) {
      throw new Error("Contrato no encontrado.");
    }

    // Validate transitions: draft->sent, sent->signed, sent->cancelled
    const validTransitions: Record<string, string[]> = {
      draft: ["sent"],
      sent: ["signed", "cancelled"],
    };

    const allowed = validTransitions[contract.status];
    if (!allowed || !allowed.includes(args.status)) {
      throw new Error(
        `No se puede cambiar de "${contract.status}" a "${args.status}".`
      );
    }

    const patch: Record<string, unknown> = { status: args.status };
    if (args.status === "signed") {
      patch.signedAt = Date.now();
    }

    await ctx.db.patch(args.id, patch);
  },
});

export const saveGenerated = internalMutation({
  args: {
    orgId: v.string(),
    quotationId: v.id("quotations"),
    projServiceId: v.id("projectionServices"),
    clientId: v.id("clients"),
    serviceName: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("contracts")
      .withIndex("by_quotationId", (q) => q.eq("quotationId", args.quotationId))
      .first();

    if (existing && existing.orgId === args.orgId) {
      // Phase 1 §3.1 — race guard: duplicate call (acceptQuotation double-click /
      // tab-dup). Return the existing contract ID without overwriting its content
      // so the race winner's data is preserved. Non-draft contracts are not
      // expected here (acceptance only generates drafts), but guard anyway.
      return existing._id;
    }

    return await ctx.db.insert("contracts", {
      orgId: args.orgId,
      quotationId: args.quotationId,
      projServiceId: args.projServiceId,
      clientId: args.clientId,
      serviceName: args.serviceName,
      content: args.content,
      status: "draft",
      createdAt: Date.now(),
    });
  },
});

export const cancelContract = mutation({
  args: {
    contractId: v.id("contracts"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const orgId = await getOrgIdMutation(ctx);

    const contract = await ctx.db.get(args.contractId);
    if (!contract) throw new Error("Contract not found");
    if (contract.orgId !== orgId) throw new Error("Forbidden");
    if (contract.status === "signed") {
      throw new Error("Cannot cancel a signed contract");
    }
    if (contract.status === "cancelled") {
      return; // already cancelled — idempotent no-op
    }

    await ctx.db.patch(args.contractId, {
      status: "cancelled",
      cancellationReason: args.reason,
    });

    // Phase 1 §3.2 — cascade: desactivar projService y cancelar MAs futuros pending
    const projService = await ctx.db.get(contract.projServiceId);
    if (projService && projService.isActive) {
      await ctx.db.patch(projService._id, { isActive: false });
      await cancelFuturePendingAssignments(ctx, projService._id);
    }

    await ctx.db.insert("documentEvents", {
      orgId: contract.orgId,
      clientId: contract.clientId,
      entityType: "contract",
      entityId: args.contractId,
      eventType: "voided",
      severity: "info",
      actorType: "user",
      message: `Contrato cancelado: ${args.reason}`,
      createdAt: Date.now(),
    });

    // TODO post-MVP: if firmameDocumentId exists, call firmameClient.cancelDocument() to revoke link
  },
});

export const setPdfStorageId = mutation({
  args: {
    id: v.id("contracts"),
    pdfStorageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdMutation(ctx);
    const contract = await ctx.db.get(args.id);
    if (!contract || contract.orgId !== orgId) {
      throw new Error("Contrato no encontrado.");
    }
    await ctx.db.patch(args.id, { pdfStorageId: args.pdfStorageId });
  },
});

// ─────────────────────────────────────────────
// #23 — Issuing company selector on contract form
// ─────────────────────────────────────────────

/**
 * Override the issuing company on a contract (draft only).
 * Pass null to clear the override and let the auto-resolve flow take over.
 */
export const updateIssuingCompany = mutation({
  args: {
    id: v.id("contracts"),
    issuingCompanyId: v.union(v.id("issuingCompanies"), v.null()),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdMutation(ctx);
    const contract = await ctx.db.get(args.id);
    if (!contract || contract.orgId !== orgId) {
      throw new Error("Contrato no encontrado.");
    }
    if (contract.status !== "draft") {
      throw new Error(
        "Solo se puede cambiar la empresa emitente de contratos en borrador."
      );
    }
    if (args.issuingCompanyId !== null) {
      const company = await ctx.db.get(args.issuingCompanyId);
      if (!company || company.orgId !== orgId) {
        throw new Error("Empresa emitente no encontrada.");
      }
    }
    await ctx.db.patch(args.id, {
      issuingCompanyId: args.issuingCompanyId ?? undefined,
    });
  },
});
