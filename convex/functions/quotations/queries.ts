import { query } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgIdSafe } from "../../lib/authHelpers";
import { internal } from "../../_generated/api";

export const getById = query({
  args: { id: v.id("quotations") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;
    const quotation = await ctx.db.get(args.id);
    if (!quotation || quotation.orgId !== orgId) return null;
    return quotation;
  },
});

export const getByProjService = query({
  args: { projServiceId: v.id("projectionServices") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;

    const quotation = await ctx.db
      .query("quotations")
      .withIndex("by_projServiceId", (q) =>
        q.eq("projServiceId", args.projServiceId)
      )
      .first();

    if (!quotation || quotation.orgId !== orgId) return null;
    return quotation;
  },
});

export const listByClient = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    const quotations = await ctx.db
      .query("quotations")
      .withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
      .collect();

    return quotations
      .filter((q) => q.orgId === orgId)
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const listByOrg = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("sent"),
        v.literal("approved"),
        v.literal("rejected")
      )
    ),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    let quotations;
    if (args.status) {
      quotations = await ctx.db
        .query("quotations")
        .withIndex("by_orgId_status", (q) =>
          q.eq("orgId", orgId).eq("status", args.status!)
        )
        .collect();
    } else {
      quotations = await ctx.db
        .query("quotations")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect();
    }

    return quotations.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const getSendPreviewContext = query({
  args: { quotationId: v.id("quotations") },
  handler: async (
    ctx,
    args
  ): Promise<{
    client: {
      name: string;
      contactEmail?: string;
      contactName?: string;
    };
    issuingCompany: {
      _id: string;
      name: string;
      primaryColor?: string;
      logoStorageUrl?: string | null;
    } | null;
    issuingCompanyError: string | null;
    pdfFilename: string;
    defaultSubject: string;
    tokenTtlDays: number;
    hasPdf: boolean;
    status: "draft" | "sent" | "approved" | "rejected";
    sendCount: number;
  } | null> => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;

    const quotation = await ctx.db.get(args.quotationId);
    if (!quotation || quotation.orgId !== orgId) return null;

    const client = await ctx.db.get(quotation.clientId);
    if (!client || client.orgId !== orgId) return null;

    // Ejecutivo permission gate
    const identity = await ctx.auth.getUserIdentity();
    const role = (identity?.orgRole as string) ?? "org:member";
    if (role === "org:member" && client.assignedTo && client.assignedTo !== identity?.subject) {
      return null;
    }

    const projService = await ctx.db.get(quotation.projServiceId);
    if (!projService) return null;

    // Attempt issuingCompany resolution without throwing.
    let issuingCompanyPreview: {
      _id: string;
      name: string;
      primaryColor?: string;
      logoStorageUrl?: string | null;
    } | null = null;
    let issuingCompanyError: string | null = null;
    try {
      const resolved = await ctx.runQuery(
        internal.functions.issuingCompanies.resolve.resolveIssuingCompanyQuery,
        {
          orgId,
          clientId: client._id,
          serviceId: projService.serviceId,
        }
      );
      const logoUrl = resolved.issuingCompany.logoStorageId
        ? await ctx.storage.getUrl(resolved.issuingCompany.logoStorageId)
        : null;
      // primaryColor lives on orgBranding, not issuingCompanies. Source it
      // from there so the preview matches the actual landing-page rendering.
      const orgBranding = await ctx.db
        .query("orgBranding")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .first();
      issuingCompanyPreview = {
        _id: resolved.issuingCompany._id,
        name: resolved.issuingCompany.name,
        primaryColor: orgBranding?.primaryColor,
        logoStorageUrl: logoUrl,
      };
    } catch (err) {
      issuingCompanyError = err instanceof Error ? err.message : String(err);
    }

    const pdfFilename = `cotizacion-${slug(quotation.serviceName)}-${slug(client.name)}.pdf`;
    const defaultSubject = `Cotización ${quotation.serviceName}${issuingCompanyPreview ? ` — ${issuingCompanyPreview.name}` : ""}`;

    return {
      client: {
        name: client.name,
        contactEmail: client.contactEmail,
        contactName: client.contactName,
      },
      issuingCompany: issuingCompanyPreview,
      issuingCompanyError,
      pdfFilename,
      defaultSubject,
      tokenTtlDays: 30,
      hasPdf: !!quotation.pdfStorageId,
      status: quotation.status,
      sendCount: quotation.sendCount ?? 0,
    };
  },
});

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
