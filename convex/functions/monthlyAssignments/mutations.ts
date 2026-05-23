import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgId, requireAdmin, requireAuth } from "../../lib/authHelpers";

export const updateStatus = mutation({
  args: {
    id: v.id("monthlyAssignments"),
    status: v.union(
      v.literal("pending"),
      v.literal("info_received"),
      v.literal("in_progress"),
      v.literal("delivered")
    ),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const orgId = await getOrgId(ctx);
    const ma = await ctx.db.get(args.id);
    if (!ma || ma.orgId !== orgId) throw new Error("No encontrado.");
    await ctx.db.patch(args.id, { status: args.status });
  },
});

export const updateInvoiceStatus = mutation({
  args: {
    id: v.id("monthlyAssignments"),
    invoiceStatus: v.union(
      v.literal("not_invoiced"),
      v.literal("invoiced"),
      v.literal("paid")
    ),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const orgId = await getOrgId(ctx);
    const ma = await ctx.db.get(args.id);
    if (!ma || ma.orgId !== orgId) throw new Error("No encontrado.");
    await ctx.db.patch(args.id, { invoiceStatus: args.invoiceStatus });
  },
});

export const updateAmount = mutation({
  args: {
    id: v.id("monthlyAssignments"),
    amount: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const orgId = await getOrgId(ctx);
    const ma = await ctx.db.get(args.id);
    if (!ma || ma.orgId !== orgId) throw new Error("No encontrado.");
    await ctx.db.patch(args.id, { amount: args.amount });
  },
});

/**
 * Set the subservice for a specific monthly cell. Admin-only.
 * Validates that the chosen subservice belongs to the parent service
 * of the assignment's projectionService. Pass null to clear.
 * Spec: docs/superpowers/specs/2026-05-22-monthly-subservice-selection-design.md §3.1
 */
export const setSubservice = mutation({
  args: {
    id: v.id("monthlyAssignments"),
    subserviceId: v.union(v.id("subservices"), v.null()),
  },
  handler: async (ctx, args) => {
    // 2026-05-22: abierto a cualquier miembro autenticado (no admin-only).
    // Razon: picking subservice es PLANIFICACION del mes, no una accion
    // sensible que altere generacion. La generacion sigue gated por
    // markPaid (admin via invoices/mutations) o override manual (admin via
    // matrix-cell-detail). El operator que captura el mes a mes no necesita
    // ser admin.
    await requireAuth(ctx);
    const orgId = await getOrgId(ctx);

    const assignment = await ctx.db.get(args.id);
    if (!assignment || assignment.orgId !== orgId) {
      throw new Error("Asignacion no encontrada.");
    }

    if (args.subserviceId !== null) {
      const subservice = await ctx.db.get(args.subserviceId);
      if (!subservice) throw new Error("Subservicio no encontrado.");

      const projService = await ctx.db.get(assignment.projServiceId);
      if (!projService) {
        throw new Error("Servicio de proyeccion no encontrado.");
      }
      if (subservice.parentServiceId !== projService.serviceId) {
        throw new Error(
          "El subservicio no pertenece al servicio padre de esta celda."
        );
      }
    }

    await ctx.db.patch(args.id, {
      subserviceId: args.subserviceId ?? undefined,
    });

    return { ok: true };
  },
});
