import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { requireAdmin, getOrgId } from "../../lib/authHelpers";
import { isValidRFC } from "../../lib/validators";
import { validateRegimenFiscal, getRegimenLabel } from "./helpers";

const addressValidator = v.object({
  street: v.string(),
  exteriorNumber: v.optional(v.string()),
  interiorNumber: v.optional(v.string()),
  colonia: v.optional(v.string()),
  city: v.string(),
  state: v.string(),
  country: v.string(),
});

export const create = mutation({
  args: {
    name: v.string(),
    legalName: v.string(),
    rfc: v.string(),
    regimenFiscalCode: v.string(),
    codigoPostal: v.string(),
    address: addressValidator,
    email: v.string(),
    phone: v.optional(v.string()),
    website: v.optional(v.string()),
    bankName: v.optional(v.string()),
    bankAccount: v.optional(v.string()),
    clabe: v.optional(v.string()),
    currency: v.optional(v.string()),
    invoiceSerie: v.optional(v.string()),
    signatoryName: v.optional(v.string()),
    signatoryTitle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);

    const rfcUpper = args.rfc.toUpperCase().trim();

    // Validations
    if (!isValidRFC(rfcUpper)) {
      throw new Error("Formato de RFC inválido");
    }
    if (!validateRegimenFiscal(args.regimenFiscalCode)) {
      throw new Error("Régimen fiscal inválido");
    }
    if (!/^\d{5}$/.test(args.codigoPostal)) {
      throw new Error("Código postal debe tener 5 dígitos");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.email)) {
      throw new Error("Formato de email inválido");
    }

    // Unique RFC per org
    const existing = await ctx.db
      .query("issuingCompanies")
      .withIndex("by_orgId_rfc", (q) => q.eq("orgId", orgId).eq("rfc", rfcUpper))
      .first();
    if (existing) {
      throw new Error("Ya existe una empresa emitente con ese RFC en la organización");
    }

    // Auto-default: if no active issuingCompany exists yet for this org, this one becomes default
    const activeExisting = await ctx.db
      .query("issuingCompanies")
      .withIndex("by_orgId_isActive", (q) => q.eq("orgId", orgId).eq("isActive", true))
      .first();
    const isDefault = !activeExisting;

    const now = Date.now();
    return await ctx.db.insert("issuingCompanies", {
      orgId,
      name: args.name.trim(),
      legalName: args.legalName.trim(),
      rfc: rfcUpper,
      regimenFiscalCode: args.regimenFiscalCode,
      regimenFiscalLabel: getRegimenLabel(args.regimenFiscalCode) ?? undefined,
      codigoPostal: args.codigoPostal,
      address: args.address,
      email: args.email.trim(),
      phone: args.phone,
      website: args.website,
      bankName: args.bankName,
      bankAccount: args.bankAccount,
      clabe: args.clabe,
      currency: args.currency,
      invoiceSerie: args.invoiceSerie,
      signatoryName: args.signatoryName,
      signatoryTitle: args.signatoryTitle,
      isDefault,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("issuingCompanies"),
    name: v.optional(v.string()),
    legalName: v.optional(v.string()),
    rfc: v.optional(v.string()),
    regimenFiscalCode: v.optional(v.string()),
    codigoPostal: v.optional(v.string()),
    address: v.optional(addressValidator),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    website: v.optional(v.string()),
    bankName: v.optional(v.string()),
    bankAccount: v.optional(v.string()),
    clabe: v.optional(v.string()),
    currency: v.optional(v.string()),
    invoiceSerie: v.optional(v.string()),
    signatoryName: v.optional(v.string()),
    signatoryTitle: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    const doc = await ctx.db.get(args.id);
    if (!doc || doc.orgId !== orgId) {
      throw new Error("Empresa emitente no encontrada");
    }

    // Guard: cannot deactivate default
    if (args.isActive === false && doc.isDefault) {
      throw new Error("No puedes desactivar la empresa default. Marca otra como default primero.");
    }

    const { id, ...rest } = args;
    const patch: Record<string, unknown> = { updatedAt: Date.now() };

    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) patch[key] = value;
    }

    // Normalize / re-validate fields that were included
    if (patch.rfc) {
      const rfcUpper = (patch.rfc as string).toUpperCase().trim();
      if (!isValidRFC(rfcUpper)) throw new Error("Formato de RFC inválido");
      // Unique RFC per org (excluding self)
      const existing = await ctx.db
        .query("issuingCompanies")
        .withIndex("by_orgId_rfc", (q) => q.eq("orgId", orgId).eq("rfc", rfcUpper))
        .first();
      if (existing && existing._id !== id) {
        throw new Error("Ya existe una empresa emitente con ese RFC en la organización");
      }
      patch.rfc = rfcUpper;
    }
    if (patch.regimenFiscalCode) {
      if (!validateRegimenFiscal(patch.regimenFiscalCode as string)) {
        throw new Error("Régimen fiscal inválido");
      }
      patch.regimenFiscalLabel = getRegimenLabel(patch.regimenFiscalCode as string) ?? undefined;
    }
    if (patch.codigoPostal && !/^\d{5}$/.test(patch.codigoPostal as string)) {
      throw new Error("Código postal debe tener 5 dígitos");
    }
    if (patch.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.email as string)) {
      throw new Error("Formato de email inválido");
    }

    await ctx.db.patch(id, patch);
  },
});

export const setDefault = mutation({
  args: { id: v.id("issuingCompanies") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    const target = await ctx.db.get(args.id);
    if (!target || target.orgId !== orgId) {
      throw new Error("Empresa emitente no encontrada");
    }
    if (!target.isActive) {
      throw new Error("Reactiva la empresa antes de marcarla como default");
    }
    if (target.isDefault) {
      return; // already default, noop
    }

    const currentDefaults = await ctx.db
      .query("issuingCompanies")
      .withIndex("by_orgId_isDefault", (q) => q.eq("orgId", orgId).eq("isDefault", true))
      .collect();

    const now = Date.now();
    for (const d of currentDefaults) {
      if (d._id !== args.id) {
        await ctx.db.patch(d._id, { isDefault: false, updatedAt: now });
      }
    }
    await ctx.db.patch(args.id, { isDefault: true, updatedAt: now });
  },
});

export const remove = mutation({
  args: { id: v.id("issuingCompanies") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    const doc = await ctx.db.get(args.id);
    if (!doc || doc.orgId !== orgId) {
      throw new Error("Empresa emitente no encontrada");
    }
    if (doc.isDefault) {
      throw new Error("No puedes borrar la empresa default. Marca otra como default primero.");
    }

    const [emailLogsArr, serviceMapsArr, clientOverridesArr] = await Promise.all([
      ctx.db
        .query("emailLog")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect()
        .then((rows) => rows.filter((r) => r.issuingCompanyId === args.id)),
      ctx.db
        .query("servicesIssuingCompanyMap")
        .withIndex("by_issuingCompanyId", (q) => q.eq("issuingCompanyId", args.id))
        .collect(),
      ctx.db
        .query("clientIssuingCompanyOverride")
        .withIndex("by_issuingCompanyId", (q) => q.eq("issuingCompanyId", args.id))
        .collect(),
    ]);
    // TODO: cuando secciones 3/4 agreguen issuingCompanyId a quotations/contracts/deliverables/deliverableTemplates,
    // contar esas referencias aquí también.

    const total = emailLogsArr.length + serviceMapsArr.length + clientOverridesArr.length;
    if (total > 0) {
      const parts: string[] = [];
      if (emailLogsArr.length) parts.push(`${emailLogsArr.length} email(s)`);
      if (serviceMapsArr.length) parts.push(`${serviceMapsArr.length} asignación(es) de servicio`);
      if (clientOverridesArr.length) parts.push(`${clientOverridesArr.length} override(s) por cliente`);
      throw new Error(
        `No puede borrarse: tiene ${parts.join(", ")}. Desactívala en lugar de borrar.`
      );
    }

    if (doc.logoStorageId) {
      await ctx.storage.delete(doc.logoStorageId);
    }
    await ctx.db.delete(args.id);
  },
});

export const assignServicesToCompany = mutation({
  args: {
    issuingCompanyId: v.id("issuingCompanies"),
    serviceIds: v.array(v.id("services")),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    const company = await ctx.db.get(args.issuingCompanyId);
    if (!company || company.orgId !== orgId) {
      throw new Error("Empresa emitente no encontrada");
    }

    for (const sid of args.serviceIds) {
      const service = await ctx.db.get(sid);
      if (!service) throw new Error(`Servicio ${sid} no existe`);
      if (service.orgId !== undefined && service.orgId !== orgId) {
        throw new Error(`Servicio ${service.name} pertenece a otra organización`);
      }
    }

    const now = Date.now();

    const existingForCompany = await ctx.db
      .query("servicesIssuingCompanyMap")
      .withIndex("by_issuingCompanyId", (q) => q.eq("issuingCompanyId", args.issuingCompanyId))
      .collect();
    for (const m of existingForCompany) {
      await ctx.db.delete(m._id);
    }

    for (const sid of args.serviceIds) {
      const foreign = await ctx.db
        .query("servicesIssuingCompanyMap")
        .withIndex("by_orgId_serviceId", (q) => q.eq("orgId", orgId).eq("serviceId", sid))
        .first();
      if (foreign) await ctx.db.delete(foreign._id);
    }

    for (const sid of args.serviceIds) {
      await ctx.db.insert("servicesIssuingCompanyMap", {
        orgId,
        serviceId: sid,
        issuingCompanyId: args.issuingCompanyId,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});
