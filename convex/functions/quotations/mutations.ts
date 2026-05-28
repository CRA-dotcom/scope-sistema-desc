import { mutation, internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgId } from "../../lib/authHelpers";
import { Doc, Id } from "../../_generated/dataModel";

export const generate = mutation({
  args: {
    projServiceId: v.id("projectionServices"),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgId(ctx);

    // Get projection service
    const projService = await ctx.db.get(args.projServiceId);
    if (!projService || projService.orgId !== orgId) {
      throw new Error("Servicio de proyección no encontrado.");
    }

    // Get projection
    const projection = await ctx.db.get(projService.projectionId);
    if (!projection || projection.orgId !== orgId) {
      throw new Error("Proyección no encontrada.");
    }

    // Get client
    const client = await ctx.db.get(projection.clientId);
    if (!client || client.orgId !== orgId) {
      throw new Error("Cliente no encontrado.");
    }

    // Get service details
    const service = await ctx.db.get(projService.serviceId);

    // Look for a matching template: first service-specific, then generic quotation
    let template = null;

    // Try service-specific template
    const templatesByType = await ctx.db
      .query("deliverableTemplates")
      .withIndex("by_type", (q) => q.eq("type", "quotation"))
      .collect();

    template = templatesByType.find(
      (t) =>
        t.isActive &&
        t.serviceId === projService.serviceId &&
        (t.orgId === orgId || !t.orgId)
    );

    // Fall back to generic quotation template for this org
    if (!template) {
      template = templatesByType.find(
        (t) => t.isActive && !t.serviceId && (t.orgId === orgId || !t.orgId)
      );
    }

    let content: string;

    if (template) {
      // Resolve template variables
      // We do a simple replacement inline since we're in Convex (no access to client-side templateResolver)
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
      // Default HTML quotation structure
      const monthlyAmount = (projService.annualAmount / 12).toLocaleString(
        "es-MX",
        { minimumFractionDigits: 2, maximumFractionDigits: 2 }
      );
      content = `
<div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px;">
  <div style="text-align: center; margin-bottom: 40px;">
    <h1 style="font-size: 24px; color: #1a1a2e; margin-bottom: 8px;">COTIZACI&Oacute;N DE SERVICIOS</h1>
    <p style="color: #666; font-size: 14px;">Fecha: ${new Date().toLocaleDateString("es-MX")}</p>
  </div>

  <div style="margin-bottom: 32px;">
    <h2 style="font-size: 16px; color: #1a1a2e; border-bottom: 2px solid #6c63ff; padding-bottom: 8px;">DATOS DEL CLIENTE</h2>
    <table style="width: 100%; margin-top: 12px; font-size: 14px;">
      <tr><td style="padding: 4px 0; color: #666; width: 160px;">Empresa:</td><td style="font-weight: 600;">${client.name}</td></tr>
      <tr><td style="padding: 4px 0; color: #666;">RFC:</td><td>${client.rfc}</td></tr>
      <tr><td style="padding: 4px 0; color: #666;">Industria:</td><td>${client.industry}</td></tr>
    </table>
  </div>

  <div style="margin-bottom: 32px;">
    <h2 style="font-size: 16px; color: #1a1a2e; border-bottom: 2px solid #6c63ff; padding-bottom: 8px;">SERVICIO COTIZADO</h2>
    <table style="width: 100%; margin-top: 12px; font-size: 14px;">
      <tr><td style="padding: 4px 0; color: #666; width: 160px;">Servicio:</td><td style="font-weight: 600;">${projService.serviceName}</td></tr>
      <tr><td style="padding: 4px 0; color: #666;">A&ntilde;o fiscal:</td><td>${projection.year}</td></tr>
      <tr><td style="padding: 4px 0; color: #666;">Porcentaje asignado:</td><td>${projService.chosenPct}%</td></tr>
    </table>
  </div>

  <div style="margin-bottom: 32px;">
    <h2 style="font-size: 16px; color: #1a1a2e; border-bottom: 2px solid #6c63ff; padding-bottom: 8px;">INVERSI&Oacute;N</h2>
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
      </tbody>
    </table>
  </div>

  <div style="margin-bottom: 32px;">
    <h2 style="font-size: 16px; color: #1a1a2e; border-bottom: 2px solid #6c63ff; padding-bottom: 8px;">CONDICIONES</h2>
    <ul style="font-size: 14px; color: #444; line-height: 1.8;">
      <li>Vigencia de la cotizaci&oacute;n: 30 d&iacute;as naturales.</li>
      <li>Frecuencia de facturaci&oacute;n: ${client.billingFrequency}.</li>
      <li>Los montos no incluyen IVA.</li>
      <li>El servicio se presta conforme al contrato correspondiente.</li>
    </ul>
  </div>

  <div style="margin-top: 48px; text-align: center; color: #999; font-size: 12px;">
    <p>Documento generado autom&aacute;ticamente. Este documento no tiene validez fiscal.</p>
  </div>
</div>`.trim();
    }

    // Check if a quotation already exists for this projService
    const existing = await ctx.db
      .query("quotations")
      .withIndex("by_projServiceId", (q) =>
        q.eq("projServiceId", args.projServiceId)
      )
      .first();

    if (existing && existing.orgId === orgId) {
      // Update existing draft
      if (existing.status !== "draft") {
        throw new Error(
          "Ya existe una cotización para este servicio que no está en borrador."
        );
      }
      await ctx.db.patch(existing._id, { content });
      return existing._id;
    }

    // Create new quotation
    return await ctx.db.insert("quotations", {
      orgId,
      projServiceId: args.projServiceId,
      clientId: projection.clientId,
      serviceName: projService.serviceName,
      content,
      status: "draft",
      createdAt: Date.now(),
    });
  },
});

export const updateContent = mutation({
  args: {
    id: v.id("quotations"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgId(ctx);
    const quotation = await ctx.db.get(args.id);
    if (!quotation || quotation.orgId !== orgId) {
      throw new Error("Cotización no encontrada.");
    }
    if (quotation.status !== "draft") {
      throw new Error("Solo se pueden editar cotizaciones en borrador.");
    }
    await ctx.db.patch(args.id, { content: args.content });
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("quotations"),
    status: v.union(
      v.literal("sent"),
      v.literal("approved"),
      v.literal("rejected")
    ),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgId(ctx);
    const quotation = await ctx.db.get(args.id);
    if (!quotation || quotation.orgId !== orgId) {
      throw new Error("Cotización no encontrada.");
    }

    // Validate transitions
    const validTransitions: Record<string, string[]> = {
      draft: ["sent"],
      sent: ["approved", "rejected"],
    };

    const allowed = validTransitions[quotation.status];
    if (!allowed || !allowed.includes(args.status)) {
      throw new Error(
        `No se puede cambiar de "${quotation.status}" a "${args.status}".`
      );
    }

    await ctx.db.patch(args.id, { status: args.status });
  },
});

export const saveGenerated = internalMutation({
  args: {
    orgId: v.string(),
    projServiceId: v.id("projectionServices"),
    clientId: v.id("clients"),
    serviceName: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("quotations")
      .withIndex("by_projServiceId", (q) =>
        q.eq("projServiceId", args.projServiceId)
      )
      .first();

    if (existing && existing.orgId === args.orgId) {
      if (existing.status !== "draft") {
        throw new Error(
          "Ya existe una cotización para este servicio que no está en borrador."
        );
      }
      await ctx.db.patch(existing._id, { content: args.content });
      return existing._id;
    }

    return await ctx.db.insert("quotations", {
      orgId: args.orgId,
      projServiceId: args.projServiceId,
      clientId: args.clientId,
      serviceName: args.serviceName,
      content: args.content,
      status: "draft",
      createdAt: Date.now(),
    });
  },
});

/**
 * B1 — Internal mutation que crea una cotización suplementaria a partir de
 * un projectionServices add-on. Reusa el flujo accept/decline del módulo
 * (publicActions no requiere cambios).
 *
 * Per docs/superpowers/specs/2026-05-26-client-services-overview-design.md §2.4
 */
export const createSupplementary = internalMutation({
  args: {
    projServiceId: v.id("projectionServices"),
    parentQuotationId: v.optional(v.id("quotations")),
    startMonth: v.number(),
    endMonth: v.number(),
    monthlyAmount: v.number(),
    notes: v.optional(v.string()),
  },
  returns: v.id("quotations"),
  handler: async (ctx, args) => {
    const projService = await ctx.db.get(args.projServiceId);
    if (!projService) {
      throw new Error("projectionServices no encontrado.");
    }
    const orgId = projService.orgId;
    const projection = await ctx.db.get(projService.projectionId);
    if (!projection) {
      throw new Error("projection no encontrada.");
    }
    const client = await ctx.db.get(projection.clientId);
    if (!client) {
      throw new Error("client no encontrado.");
    }

    // Multi-tenant guard on parentQuotationId when present.
    if (args.parentQuotationId) {
      const parent = await ctx.db.get(args.parentQuotationId);
      if (!parent || parent.orgId !== orgId) {
        throw new Error(
          "parentQuotationId inválido (otro org o no existe)."
        );
      }
    }

    // Build lineItems (mes calendario × monto fijo).
    const lineItems: Array<{ month: number; label: string; amount: number }> =
      [];
    for (let m = args.startMonth; m <= args.endMonth; m++) {
      lineItems.push({
        month: m,
        label: `${MONTH_LABELS_ES[m - 1]} ${projection.year}`,
        amount: args.monthlyAmount,
      });
    }
    const totalAmount = lineItems.reduce((s, li) => s + li.amount, 0);

    const content = renderSupplementaryHtml({
      client,
      projection,
      projService,
      lineItems,
      totalAmount,
      parentQuotationId: args.parentQuotationId,
      notes: args.notes,
    });

    const now = Date.now();
    return await ctx.db.insert("quotations", {
      orgId,
      projServiceId: args.projServiceId,
      clientId: projection.clientId,
      serviceName: projService.serviceName,
      subserviceId: projService.subserviceId,
      content,
      status: "draft" as const,
      createdAt: now,
      parentQuotationId: args.parentQuotationId,
      isSupplementary: true,
      lineItems,
      totalAmount,
    });
  },
});

const MONTH_LABELS_ES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

function renderSupplementaryHtml(args: {
  client: Doc<"clients">;
  projection: Doc<"projections">;
  projService: Doc<"projectionServices">;
  lineItems: Array<{ month: number; label: string; amount: number }>;
  totalAmount: number;
  parentQuotationId?: Id<"quotations">;
  notes?: string;
}): string {
  const rows = args.lineItems
    .map(
      (li) =>
        `<tr><td style="padding:8px;border-bottom:1px solid #eee">${li.label}</td><td style="padding:8px;text-align:right;border-bottom:1px solid #eee">$${li.amount.toLocaleString("es-MX", { minimumFractionDigits: 2 })}</td></tr>`
    )
    .join("");
  const supplementaryNote = args.parentQuotationId
    ? `<p style="font-size:12px;color:#666">Cotización suplementaria del contrato principal vigente.</p>`
    : "";
  const notesBlock = args.notes
    ? `<p style="margin-top:24px;font-size:13px;color:#444"><strong>Notas:</strong> ${escapeHtml(args.notes)}</p>`
    : "";
  return `
<div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px;">
  <h1 style="font-size:20px;color:#1a1a2e">Cotización suplementaria</h1>
  ${supplementaryNote}
  <p><strong>Cliente:</strong> ${escapeHtml(args.client.name)}</p>
  <p><strong>Servicio:</strong> ${escapeHtml(args.projService.serviceName)}</p>
  <p style="font-size:12px;color:#666">Vigente hasta el 31 de diciembre de ${args.projection.year}. Se renovará junto con el contrato anual el 1 de enero.</p>
  <table style="width:100%;margin-top:24px;border-collapse:collapse;font-size:14px">
    <thead>
      <tr>
        <th style="text-align:left;padding:8px;border-bottom:2px solid #1a1a2e">Mes</th>
        <th style="text-align:right;padding:8px;border-bottom:2px solid #1a1a2e">Monto MXN</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <th style="text-align:left;padding:8px;border-top:2px solid #1a1a2e">Total</th>
        <th style="text-align:right;padding:8px;border-top:2px solid #1a1a2e">$${args.totalAmount.toLocaleString("es-MX", { minimumFractionDigits: 2 })}</th>
      </tr>
    </tfoot>
  </table>
  ${notesBlock}
</div>`.trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const setPdfStorageId = mutation({
  args: {
    id: v.id("quotations"),
    pdfStorageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgId(ctx);
    const quotation = await ctx.db.get(args.id);
    if (!quotation || quotation.orgId !== orgId) {
      throw new Error("Cotización no encontrada.");
    }
    await ctx.db.patch(args.id, { pdfStorageId: args.pdfStorageId });
  },
});

export const deleteQuotation = mutation({
  args: { id: v.id("quotations") },
  handler: async (ctx, args) => {
    const orgId = await getOrgId(ctx);
    const q = await ctx.db.get(args.id);
    if (!q || q.orgId !== orgId) throw new Error("Cotización no encontrada.");
    if (q.status !== "draft") {
      throw new Error(
        "Solo cotizaciones en estado borrador pueden eliminarse."
      );
    }
    await ctx.db.delete(args.id);
  },
});
