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
