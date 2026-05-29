import { query } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgIdSafe } from "../../lib/authHelpers";
import { Doc, Id } from "../../_generated/dataModel";

export const list = query({
  args: {
    includeArchived: v.optional(v.boolean()),
    search: v.optional(v.string()),
    industry: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    const identity = await ctx.auth.getUserIdentity();
    const role = (identity?.orgRole as string) ?? "org:member";

    // Pick the most selective index available based on the filter combo.
    let clients: Doc<"clients">[];
    if (args.industry) {
      clients = await ctx.db
        .query("clients")
        .withIndex("by_orgId_industry", (q) =>
          q.eq("orgId", orgId).eq("industry", args.industry!)
        )
        .collect();
    } else if (role === "org:member") {
      const subject = identity?.subject;
      if (!subject) return [];
      clients = await ctx.db
        .query("clients")
        .withIndex("by_orgId_assignedTo", (q) =>
          q.eq("orgId", orgId).eq("assignedTo", subject)
        )
        .collect();
    } else if (!args.includeArchived) {
      clients = await ctx.db
        .query("clients")
        .withIndex("by_orgId_archived", (q) =>
          q.eq("orgId", orgId).eq("isArchived", false)
        )
        .collect();
    } else {
      clients = await ctx.db
        .query("clients")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect();
    }

    // Apply remaining filters that weren't covered by the chosen index.
    // Needed: industry branch does not filter archived; full branch when includeArchived is unset.
    if (!args.includeArchived) {
      clients = clients.filter((c) => !c.isArchived);
    }
    // Needed: industry branch does not filter assignedTo (member may pass industry).
    if (role === "org:member") {
      clients = clients.filter((c) => c.assignedTo === identity?.subject);
    }
    if (args.search) {
      const term = args.search.toLowerCase();
      clients = clients.filter(
        (c) =>
          c.name.toLowerCase().includes(term) ||
          c.rfc.toLowerCase().includes(term)
      );
    }

    return clients.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const getById = query({
  args: { id: v.id("clients") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;
    const client = await ctx.db.get(args.id);
    if (!client || client.orgId !== orgId) return null;
    return client;
  },
});

/**
 * B1 — Agrega los projectionServices activos del cliente bajo la proyección
 * activa (o más reciente si no hay activa), agrupados por servicio padre.
 *
 * Devuelve filas listas para UI:
 *  - monthlyAmount = annualAmount / monthsInWindow (no /12 forzado)
 *  - status derivado relativo al año de la proyección y mes actual
 *  - isAddOn / supplementaryQuotationId para badges + deep link
 *  - nextDueMonth heurístico (sólo UI; la fuente de verdad es A3 selector)
 *
 * Multi-tenant guard: retorna null si el cliente no pertenece al org del JWT.
 *
 * Per docs/superpowers/specs/2026-05-26-client-services-overview-design.md §2.2
 */
export const getServicesOverview = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;

    // 1. Multi-tenant guard.
    const client = await ctx.db.get(args.clientId);
    if (!client || client.orgId !== orgId) return null;

    // 2. Resolver proyección activa más reciente (heurística: status=active,
    //    year max). Si no hay activa, usar la más reciente por createdAt.
    const projections = await ctx.db
      .query("projections")
      .withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
      .collect();

    const active =
      projections
        .filter((p) => p.status === "active")
        .sort((a, b) => b.year - a.year)[0] ??
      [...projections].sort((a, b) => b.createdAt - a.createdAt)[0];

    if (!active) {
      return { activeProjection: null, groups: [] };
    }

    // 3. Cargar projectionServices activos de esa proyección.
    const projServices = await ctx.db
      .query("projectionServices")
      .withIndex("by_projectionId_active", (q) =>
        q.eq("projectionId", active._id).eq("isActive", true)
      )
      .collect();

    // 4. Resolver subservices (batch).
    const subserviceIds = projServices
      .map((ps) => ps.subserviceId)
      .filter((id): id is Id<"subservices"> => Boolean(id));
    const subservices = await Promise.all(
      subserviceIds.map((id) => ctx.db.get(id))
    );
    const subById = new Map<string, Doc<"subservices">>();
    for (const s of subservices) {
      if (s) subById.set(s._id as string, s);
    }

    // 5. Resolver servicios padre (batch).
    const serviceIds = Array.from(
      new Set(projServices.map((ps) => ps.serviceId as string))
    );
    const services = await Promise.all(
      serviceIds.map((id) => ctx.db.get(id as Id<"services">))
    );
    const svcById = new Map<string, Doc<"services">>();
    for (const s of services) {
      if (s) svcById.set(s._id as string, s);
    }

    // 6. Helper de fecha (UTC; A3 TZ org-aware queda como deuda post-beta).
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth() + 1;

    // 7. Agrupar por parentServiceId.
    const groupsMap = new Map<
      string,
      { parent: Doc<"services">; rows: ReturnType<typeof buildRow>[] }
    >();

    for (const ps of projServices) {
      const parent = svcById.get(ps.serviceId as string);
      if (!parent) continue;
      const sub = ps.subserviceId
        ? subById.get(ps.subserviceId as string) ?? null
        : null;
      const row = buildRow(ps, sub, active.year, currentYear, currentMonth);
      if (!row) continue;
      const key = ps.serviceId as string;
      if (!groupsMap.has(key)) groupsMap.set(key, { parent, rows: [] });
      groupsMap.get(key)!.rows.push(row);
    }

    const groups = Array.from(groupsMap.values())
      .map(({ parent, rows }) => ({
        parentService: { _id: parent._id, name: parent.name },
        rows: rows
          .filter((r): r is NonNullable<typeof r> => r !== null)
          .sort((a, b) => a.serviceName.localeCompare(b.serviceName)),
      }))
      .sort((a, b) =>
        a.parentService.name.localeCompare(b.parentService.name)
      );

    return {
      activeProjection: {
        _id: active._id,
        year: active.year,
        status: active.status,
      },
      groups,
    };
  },
});

function buildRow(
  ps: Doc<"projectionServices">,
  sub: Doc<"subservices"> | null,
  projectionYear: number,
  currentYear: number,
  currentMonth: number
) {
  const startMonth = ps.startMonth ?? 1;
  const endMonth = ps.endMonth ?? 12;
  if (endMonth < startMonth) return null; // dato inválido; skip silencioso
  const monthsInWindow = endMonth - startMonth + 1;
  const monthlyAmount = ps.annualAmount / monthsInWindow;

  let status: "active" | "upcoming" | "ended";
  if (projectionYear < currentYear) status = "ended";
  else if (projectionYear > currentYear) status = "upcoming";
  else if (currentMonth < startMonth) status = "upcoming";
  else if (currentMonth > endMonth) status = "ended";
  else status = "active";

  const nextDueMonth = computeNextDueMonth(
    sub?.defaultFrequency,
    sub?.applicableMonths,
    startMonth,
    endMonth,
    currentMonth,
    projectionYear,
    currentYear
  );

  return {
    projectionServiceId: ps._id,
    subservice: sub
      ? {
          _id: sub._id,
          name: sub.name,
          slug: sub.slug,
          defaultFrequency: sub.defaultFrequency,
        }
      : null,
    serviceName: ps.serviceName,
    monthlyAmount,
    annualAmount: ps.annualAmount,
    startMonth,
    endMonth,
    status,
    isAddOn: Boolean(
      ps.addOnOfProjectionServiceId || ps.supplementaryQuotationId
    ),
    supplementaryQuotationId: ps.supplementaryQuotationId ?? null,
    nextDueMonth,
  };
}

function computeNextDueMonth(
  freq: string | undefined,
  applicable: number[] | undefined,
  startMonth: number,
  endMonth: number,
  currentMonth: number,
  projectionYear: number,
  currentYear: number
): number | null {
  if (projectionYear !== currentYear) return null;
  if (currentMonth > endMonth) return null;
  const eligible: number[] = (() => {
    if (applicable && applicable.length > 0) return applicable;
    switch (freq) {
      case "mensual":
        return Array.from({ length: 12 }, (_, i) => i + 1);
      case "trimestral":
        return [3, 6, 9, 12];
      case "semestral":
        return [6, 12];
      case "anual":
        return [12];
      case "una_vez":
        return [startMonth];
      default:
        return Array.from({ length: 12 }, (_, i) => i + 1);
    }
  })();
  const candidates = eligible
    .filter((m) => m >= startMonth && m <= endMonth && m >= currentMonth)
    .sort((a, b) => a - b);
  return candidates[0] ?? null;
}

export const getIndustries = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];
    const clients = await ctx.db
      .query("clients")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    const industries = [...new Set(clients.map((c) => c.industry))];
    return industries.sort();
  },
});
