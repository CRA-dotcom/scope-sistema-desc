import { query } from "../../_generated/server";
import { v } from "convex/values";

function base64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hashTokenSubtle(token: string): Promise<string> {
  const secret = process.env.QUOTATION_TOKEN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("QUOTATION_TOKEN_SECRET no configurado o < 32 chars.");
  }
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(token));
  return base64urlEncode(new Uint8Array(sig));
}

export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    let tokenHash: string;
    try {
      tokenHash = await hashTokenSubtle(args.token);
    } catch {
      return { kind: "invalid" as const };
    }

    const quotation = await ctx.db
      .query("quotations")
      .withIndex("by_accessTokenHash", (q) =>
        q.eq("accessTokenHash", tokenHash)
      )
      .unique();

    if (!quotation) return { kind: "invalid" as const };

    if (quotation.status !== "sent") {
      return {
        kind: "already_responded" as const,
        status: quotation.status,
        respondedAt: quotation.respondedAt ?? null,
      };
    }

    if (
      !quotation.tokenExpiresAt ||
      quotation.tokenExpiresAt < Date.now()
    ) {
      return { kind: "expired" as const };
    }

    const client = await ctx.db.get(quotation.clientId);
    const projService = await ctx.db.get(quotation.projServiceId);
    if (!client || !projService) return { kind: "invalid" as const };

    // Resolve issuing company for branding (inline to avoid runQuery from query).
    let issuingCompanyOut: {
      name: string;
      logoStorageUrl: string | null;
      signatoryName?: string;
      primaryColor?: string;
      secondaryColor?: string;
      address?: unknown;
    } | null = null;
    try {
      const override = await ctx.db
        .query("clientIssuingCompanyOverride")
        .withIndex("by_orgId_client_service", (q) =>
          q
            .eq("orgId", quotation.orgId)
            .eq("clientId", client._id)
            .eq("serviceId", projService.serviceId)
        )
        .first();
      let companyId = override?.issuingCompanyId;
      if (!companyId) {
        const map = await ctx.db
          .query("servicesIssuingCompanyMap")
          .withIndex("by_orgId_serviceId", (q) =>
            q.eq("orgId", quotation.orgId).eq("serviceId", projService.serviceId)
          )
          .first();
        companyId = map?.issuingCompanyId;
      }
      if (!companyId) {
        const defaults = await ctx.db
          .query("issuingCompanies")
          .withIndex("by_orgId_isDefault", (q) =>
            q.eq("orgId", quotation.orgId).eq("isDefault", true)
          )
          .collect();
        const active = defaults.find((c) => c.isActive);
        if (active) companyId = active._id;
      }
      if (companyId) {
        const company = await ctx.db.get(companyId);
        if (company) {
          const logoUrl = company.logoStorageId
            ? await ctx.storage.getUrl(company.logoStorageId)
            : null;
          issuingCompanyOut = {
            name: company.name,
            logoStorageUrl: logoUrl,
            signatoryName: company.signatoryName,
            address: company.address,
          };
        }
      }
    } catch {
      // issuingCompany missing → landing still renders without branding
    }

    // Org branding for colors fallback.
    const orgBranding = await ctx.db
      .query("orgBranding")
      .withIndex("by_orgId", (q) => q.eq("orgId", quotation.orgId))
      .first();
    if (issuingCompanyOut) {
      issuingCompanyOut.primaryColor = orgBranding?.primaryColor;
      issuingCompanyOut.secondaryColor = orgBranding?.secondaryColor;
    }

    return {
      kind: "ready" as const,
      quotation: {
        content: quotation.content,
        serviceName: quotation.serviceName,
        tokenExpiresAt: quotation.tokenExpiresAt,
      },
      client: {
        name: client.name,
        contactName: client.contactName,
      },
      issuingCompany: issuingCompanyOut,
    };
  },
});
