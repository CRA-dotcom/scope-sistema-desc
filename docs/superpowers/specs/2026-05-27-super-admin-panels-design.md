# D1 — Super Admin Panel Completion

**Fecha:** 2026-05-27
**Sub-spec del maestro:** `docs/superpowers/specs/2026-05-20-prod-readiness-revision.md`
**Estado:** propuesto
**Días estimados:** 1.5
**Dependencias:** R1 aprobado, A1 mergeado (`subservices` + `listGlobalsForAdmin`), A3 mergeado (`documentEvents` + `documentEvents.queries.list`).
**Owner:** Christian

---

## 1. Objetivo

Completar `/platform` con las páginas faltantes para que el super-admin tenga
visibilidad operacional cross-org del beta sin abrir el Convex dashboard.
D1 NO inventa features nuevos; solo expone como UI lo que A1+A3 ya dejaron en
backend, más métricas y billing que se derivan de queries live sobre
`deliverables`, `quotations` y `invoices`.

Cambios concretos:

1. **`/platform/metrics`** — overview cross-org: deliverables/mes, costo
   Claude USD, top orgs por uso, gráfica simple de 30 días.
2. **`/platform/billing`** — uso mensual por org en MXN, plan asignado, %
   utilizado vs. límites (read-only, sin procesar pagos).
3. **`/platform/audit`** — tabla cross-org de `documentEvents` (creado por A3)
   con filtros por org, cliente, entidad, severidad, fecha. La decisión #11
   del R1 §12 explícita que esta UI es parte de D1 — NO un Z1 standalone.
4. **`/platform/subservices`** — CRUD del catálogo global de subservicios
   (`orgId: undefined`), wrapper sobre las mutations equivalentes a A1 pero
   gated `requireSuperAdmin`. A1 expuso `listGlobalsForAdmin`; D1 añade las
   mutations `createGlobal/updateGlobal/deleteGlobal`.
5. **`/platform/orgs/[id]`** — expandir la página existente con tabs
   (Detalles, Métricas, Billing, Audit) reutilizando las queries nuevas con
   filtro `orgId`.
6. **Sidebar:** añadir entries nuevas bajo el bloque super-admin
   (`src/components/layout/sidebar.tsx:104-119`).

Lo que D1 NO toca:

- `/platform/templates` y `/platform/servicios` siguen funcionales sin
  cambio (A2 ya migró templates a copy-on-write; D1 no re-litiga).
- Sistema de planes/facturación real (Stripe etc.): out-of-scope beta.
  `/platform/billing` es info-only (decisión O10 R1 §11).
- Export CSV / PDF de métricas: out-of-scope beta (R1 §9.3 mitigation).
- Mutations destructivas cross-org sobre datos de tenants (ej. "suspender
  org" ya existe vía `organizations.mutations.updateStatus` reusada en
  `/platform/orgs/[id]`).

---

## 2. Gap analysis

### 2.1 Páginas existentes (no se tocan)

| Ruta | Archivo | Estado actual | D1 |
|---|---|---|---|
| `/platform` | `src/app/platform/page.tsx` | Lista orgs (tabla, link a detalle, crear nueva). Funcional. | Sin cambio. |
| `/platform/servicios` | `src/app/platform/servicios/page.tsx` | CRUD servicios globales (los 9 padre). Funcional. | Sin cambio. |
| `/platform/templates` | `src/app/platform/templates/page.tsx` | CRUD plantillas globales. Post-A2: solo defaults globales editables aquí (copies org-scoped viven en `/configuracion/plantillas`). | Sin cambio (A2 ya hizo el refactor). |
| `/platform/orgs/[id]` | `src/app/platform/orgs/[id]/page.tsx` | Detalle org: info, servicios asignados, calculationMode, featureFlags. Funcional. | **Expandir** con tabs Métricas, Billing, Audit (§4.5). |
| `/platform/orgs/[id]/branding` | `src/app/platform/orgs/[id]/branding/page.tsx` | Branding por org. Funcional. | Sin cambio. |

### 2.2 Páginas a crear

| Página | Estado | Acción | Spec § |
|---|---|---|---|
| `/platform/metrics` | NO existe | Crear | §3.1 + §4.1 |
| `/platform/billing` | NO existe | Crear | §3.2 + §4.2 |
| `/platform/audit` | NO existe | Crear (lee `documentEvents.queries.list` de A3, sin nuevo backend) | §3.3 + §4.3 |
| `/platform/subservices` | NO existe | Crear (nuevas mutations globales + `listGlobalsForAdmin` de A1) | §3.4 + §4.4 |

### 2.3 Decisiones del R1 que D1 honra (no re-litiga)

- **O9 (R1 §11):** métricas en query live, sin tabla agregada. Con < 100 orgs
  es viable; el `n_orgs * n_deliverables_mes` collect cabe en presupuesto
  Convex query (~ 30 orgs × 100 deliverables/mes = 3000 rows). Si beta pasa
  100 orgs (improbable este sprint), se materializa.
- **O10 (R1 §11):** `/platform/billing` muestra MXN para el operador del
  despacho; costo Claude se reporta auditable en USD aparte (mismo card,
  línea separada).
- **#11 (R1 §12):** `documentEvents` UI minimalista en `/platform/audit` es
  parte de D1; NO se difiere a un Z1 standalone.
- **§9.3 mitigation:** si el sprint se desborda, D1.metrics y D1.billing son
  los primeros candidatos a placeholder (orden: metrics → billing →
  audit → subservices). D1.subservices NO se descarta — sin ella el super
  admin no puede mantener el catálogo global.

---

## 3. Backend

Todo lo nuevo vive en `convex/functions/superAdmin/` (módulo nuevo) excepto
las mutations globales de subservicios, que viven en
`convex/functions/subservices/` como variants de las existentes de A1. Todas
las queries del módulo `superAdmin` están gated con `requireSuperAdmin` y
NO filtran por orgId del caller — el caller pasa orgId explícito o `null`
para cross-org.

### 3.1 `convex/functions/superAdmin/metrics.ts`

Queries live sobre `deliverables`, `quotations`, `invoices` (de A3). Sin
materialización.

```ts
import { query } from "../../_generated/server";
import { v } from "convex/values";
import { requireSuperAdmin } from "../../lib/authHelpers";

const MS_DAY = 24 * 60 * 60 * 1000;
const MS_30D = 30 * MS_DAY;

/**
 * Overview cross-org para /platform/metrics.
 * Una sola query, todas las orgs, último mes calendario corriente.
 */
export const getOverviewAll = query({
  args: {},
  returns: v.object({
    totals: v.object({
      orgsActive: v.number(),
      deliverablesMonth: v.number(),
      quotationsMonth: v.number(),
      aiCostUsdMonth: v.number(),
      clientsTotal: v.number(),
    }),
    perOrg: v.array(v.object({
      orgId: v.string(),
      name: v.string(),
      plan: v.string(),
      clientsCount: v.number(),
      deliverablesMonth: v.number(),
      aiCostUsdMonth: v.number(),
      activeSubservices: v.number(),
      lastActivityMs: v.union(v.number(), v.null()),
    })),
    last30Days: v.array(v.object({
      dateMs: v.number(),
      deliverables: v.number(),
    })),
  }),
  handler: async (ctx) => {
    try {
      await requireSuperAdmin(ctx);
    } catch {
      // Multi-tenant guard: cualquier no-super-admin recibe estructura vacía
      // (no throw para no romper SSR/reactividad mientras Clerk carga).
      return {
        totals: { orgsActive: 0, deliverablesMonth: 0, quotationsMonth: 0, aiCostUsdMonth: 0, clientsTotal: 0 },
        perOrg: [],
        last30Days: [],
      };
    }

    const now = Date.now();
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const monthStartMs = monthStart.getTime();
    const thirtyDaysAgo = now - MS_30D;

    // 1. Orgs activas
    const orgs = await ctx.db
      .query("organizations")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    // 2. Deliverables del mes (filtrados por createdAt >= monthStart).
    //    Index `by_orgId_year_month` permite filtrado, pero como necesitamos
    //    cross-org barremos todo y filtramos en memoria. Con ~3000 rows/mes
    //    es manejable; si crece, agregar `by_year_month` global index.
    const allDeliverables = await ctx.db.query("deliverables").collect();
    const deliverablesMonth = allDeliverables.filter((d) => d.createdAt >= monthStartMs);
    const deliverables30d = allDeliverables.filter((d) => d.createdAt >= thirtyDaysAgo);

    // 3. Quotations del mes (signal de pipeline comercial).
    const allQuotations = await ctx.db.query("quotations").collect();
    const quotationsMonth = allQuotations.filter((q) => q.createdAt >= monthStartMs);

    // 4. Clients totales (no filtramos por isArchived en métricas para que el
    //    delta histórico sea estable; UI puede filtrar después si necesario).
    const allClients = await ctx.db.query("clients").collect();

    // 5. Subservicios activos por org (org-scoped only; los globales no cuentan
    //    como "uso" del org).
    const allSubservices = await ctx.db.query("subservices").collect();

    // 6. Cost calculation: aiLog[].costUsd existe desde el engine refactor
    //    mergeado en main (deliverables.actions.ts). Sum sobre el mes.
    const costUsdByOrg = new Map<string, number>();
    let aiCostUsdTotal = 0;
    for (const d of deliverablesMonth) {
      const log = d.aiLog ?? [];
      const orgCost = log.reduce((acc, entry) => acc + (entry.costUsd ?? 0), 0);
      costUsdByOrg.set(d.orgId, (costUsdByOrg.get(d.orgId) ?? 0) + orgCost);
      aiCostUsdTotal += orgCost;
    }

    // 7. Per-org rollup.
    const perOrg = orgs.map((org) => {
      const clientsOfOrg = allClients.filter((c) => c.orgId === org.clerkOrgId);
      const delivOfOrg = deliverablesMonth.filter((d) => d.orgId === org.clerkOrgId);
      const subsOfOrg = allSubservices.filter(
        (s) => s.orgId === org.clerkOrgId && s.isActive
      );
      const lastDeliv = allDeliverables
        .filter((d) => d.orgId === org.clerkOrgId)
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      return {
        orgId: org.clerkOrgId,
        name: org.name,
        plan: org.plan,
        clientsCount: clientsOfOrg.length,
        deliverablesMonth: delivOfOrg.length,
        aiCostUsdMonth: costUsdByOrg.get(org.clerkOrgId) ?? 0,
        activeSubservices: subsOfOrg.length,
        lastActivityMs: lastDeliv?.createdAt ?? null,
      };
    }).sort((a, b) => b.deliverablesMonth - a.deliverablesMonth);

    // 8. last30Days timeseries (gráfica): bucket por día UTC.
    const buckets = new Map<number, number>();
    for (let i = 0; i < 30; i++) {
      const dayStart = now - i * MS_DAY;
      const d = new Date(dayStart);
      d.setUTCHours(0, 0, 0, 0);
      buckets.set(d.getTime(), 0);
    }
    for (const d of deliverables30d) {
      const day = new Date(d.createdAt);
      day.setUTCHours(0, 0, 0, 0);
      const key = day.getTime();
      if (buckets.has(key)) buckets.set(key, buckets.get(key)! + 1);
    }
    const last30Days = Array.from(buckets.entries())
      .map(([dateMs, deliverables]) => ({ dateMs, deliverables }))
      .sort((a, b) => a.dateMs - b.dateMs);

    return {
      totals: {
        orgsActive: orgs.length,
        deliverablesMonth: deliverablesMonth.length,
        quotationsMonth: quotationsMonth.length,
        aiCostUsdMonth: aiCostUsdTotal,
        clientsTotal: allClients.length,
      },
      perOrg,
      last30Days,
    };
  },
});

/**
 * Drill-down per org. Usado por /platform/orgs/[id] tab "Métricas".
 */
export const getOrgDetails = query({
  args: { orgId: v.string() },
  handler: async (ctx, args) => {
    try {
      await requireSuperAdmin(ctx);
    } catch {
      return null;
    }

    const org = await ctx.db
      .query("organizations")
      .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", args.orgId))
      .unique();
    if (!org) return null;

    const now = Date.now();
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const monthStartMs = monthStart.getTime();

    // Top clientes por # deliverables del mes.
    const deliverables = await ctx.db
      .query("deliverables")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .collect();
    const deliverablesMonth = deliverables.filter((d) => d.createdAt >= monthStartMs);

    const byClient = new Map<string, { count: number; cost: number }>();
    for (const d of deliverablesMonth) {
      const entry = byClient.get(d.clientId) ?? { count: 0, cost: 0 };
      entry.count += 1;
      entry.cost += (d.aiLog ?? []).reduce((acc, e) => acc + (e.costUsd ?? 0), 0);
      byClient.set(d.clientId, entry);
    }

    const clients = await ctx.db
      .query("clients")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .collect();
    const clientName = new Map(clients.map((c) => [c._id as string, c.name]));

    const topClients = Array.from(byClient.entries())
      .map(([clientId, agg]) => ({
        clientId,
        clientName: clientName.get(clientId) ?? "(cliente borrado)",
        deliverablesMonth: agg.count,
        aiCostUsdMonth: agg.cost,
      }))
      .sort((a, b) => b.deliverablesMonth - a.deliverablesMonth)
      .slice(0, 10);

    // Distribución por subservicio (helps detect concentración).
    const bySubservice = new Map<string, number>();
    for (const d of deliverablesMonth) {
      const key = d.subserviceId ?? d.serviceName ?? "unknown";
      bySubservice.set(key, (bySubservice.get(key) ?? 0) + 1);
    }

    return {
      org: { id: org._id, name: org.name, plan: org.plan, status: org.status, createdAt: org.createdAt },
      monthTotals: {
        deliverables: deliverablesMonth.length,
        aiCostUsd: deliverablesMonth.reduce(
          (acc, d) => acc + (d.aiLog ?? []).reduce((a, e) => a + (e.costUsd ?? 0), 0),
          0
        ),
        clientsActive: clients.filter((c) => !c.isArchived).length,
      },
      topClients,
      distributionBySubservice: Array.from(bySubservice.entries()).map(
        ([key, count]) => ({ key, count })
      ),
    };
  },
});
```

**Por qué query, no action:** las métricas se calculan from-scratch en cada
llamada. Reactividad de Convex automática → la UI ve nuevos números cuando
se inserta un deliverable sin polling explícito. El costo computacional vive
en el servidor Convex y se mide en tiempo de query (~ ms para 3000 rows).

### 3.2 `convex/functions/superAdmin/billing.ts`

Read-only en beta. Calcula uso del mes y lo cruza con plan asignado para
señalar % consumido vs. caps soft del plan.

```ts
import { query } from "../../_generated/server";
import { v } from "convex/values";
import { requireSuperAdmin } from "../../lib/authHelpers";

// Caps soft del plan — beta hardcoded. Post-beta: tabla `plans`.
const PLAN_CAPS: Record<string, { deliverablesMonth: number; clientsTotal: number }> = {
  basic:      { deliverablesMonth: 50,  clientsTotal: 5  },
  pro:        { deliverablesMonth: 200, clientsTotal: 25 },
  enterprise: { deliverablesMonth: 999, clientsTotal: 999 },
};

// Conversión Claude USD → MXN (audit only). FX rate ref. 2026-05; ajustable.
const USD_TO_MXN = 17.5;

// Precio MXN sugerido por deliverable generado (lo que la org cobra a cliente).
const SUGGESTED_PRICE_MXN_PER_DELIVERABLE = 850;

export const getUsage = query({
  args: { orgId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    try {
      await requireSuperAdmin(ctx);
    } catch {
      return { rows: [] };
    }

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const monthStartMs = monthStart.getTime();

    let orgs;
    if (args.orgId) {
      const single = await ctx.db
        .query("organizations")
        .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", args.orgId!))
        .unique();
      orgs = single ? [single] : [];
    } else {
      orgs = await ctx.db.query("organizations").collect();
    }

    const allDeliverables = await ctx.db.query("deliverables").collect();
    const allClients = await ctx.db.query("clients").collect();

    const rows = orgs.map((org) => {
      const delivMonth = allDeliverables.filter(
        (d) => d.orgId === org.clerkOrgId && d.createdAt >= monthStartMs
      );
      const clientsActive = allClients.filter(
        (c) => c.orgId === org.clerkOrgId && !c.isArchived
      );
      const aiCostUsd = delivMonth.reduce(
        (acc, d) => acc + (d.aiLog ?? []).reduce((a, e) => a + (e.costUsd ?? 0), 0),
        0
      );
      const aiCostMxn = aiCostUsd * USD_TO_MXN;
      const billableMxn = delivMonth.length * SUGGESTED_PRICE_MXN_PER_DELIVERABLE;
      const caps = PLAN_CAPS[org.plan] ?? PLAN_CAPS.basic;
      const deliverablesPct = Math.min(100, Math.round((delivMonth.length / caps.deliverablesMonth) * 100));
      const clientsPct = Math.min(100, Math.round((clientsActive.length / caps.clientsTotal) * 100));

      // Status heurístico (no es source-of-truth, solo indicador).
      let status: "al_dia" | "por_cobrar" | "sobre_limite" = "al_dia";
      if (delivMonth.length > caps.deliverablesMonth) status = "sobre_limite";
      else if (billableMxn > 0) status = "por_cobrar";

      return {
        orgId: org.clerkOrgId,
        orgName: org.name,
        plan: org.plan,
        status,
        deliverablesMonth: delivMonth.length,
        deliverablesCap: caps.deliverablesMonth,
        deliverablesPct,
        clientsActive: clientsActive.length,
        clientsCap: caps.clientsTotal,
        clientsPct,
        billableMxn,
        aiCostUsd,
        aiCostMxn,
        marginMxn: billableMxn - aiCostMxn,
      };
    });

    return { rows: rows.sort((a, b) => b.billableMxn - a.billableMxn) };
  },
});
```

**Notas:**

- `SUGGESTED_PRICE_MXN_PER_DELIVERABLE` y `USD_TO_MXN` son constantes
  hardcoded en beta. Quedan TODO post-beta: leerlos de `organizations` (campo
  nuevo `pricingPerDeliverable`) o de tabla `plans`. Lo que importa para el
  beta es que el super admin pueda decir "esta org generó X deliverables, te
  toca cobrar Y MXN, te costó Z USD/MXN — margen W".
- `status === "sobre_limite"` NO bloquea operaciones — solo señala. El cap
  duro del costo Claude (50 gen/día) sigue viviendo en el engine
  (`deliverables.actions.ts`).

### 3.3 Audit — wrapper sobre `documentEvents.queries.list` (A3)

A3 ya entregó `convex/functions/documentEvents/queries.ts` con la query `list`
que acepta `{ orgId?, clientId?, entityType?, severity?, sinceMs?, cursor?,
pageSize? }` y aplica `requireSuperAdmin` antes de honrar `orgId` arbitrario
(spec A3 §3.6, líneas 1452-1467). D1 NO necesita backend nuevo para audit.

UI (§4.3) consume `api.functions.documentEvents.queries.list` directamente
con paginación cursor-based.

**Lo único que D1 añade en backend para audit:**

```ts
// convex/functions/superAdmin/audit.ts — helpers de filtros
import { query } from "../../_generated/server";
import { requireSuperAdmin } from "../../lib/authHelpers";

/**
 * Lista de orgs como opciones de filtro (dropdown del audit UI).
 * Más liviano que reusar organizations.queries.list porque retorna solo lo
 * que necesita el dropdown.
 */
export const listOrgsForAuditFilter = query({
  args: {},
  handler: async (ctx) => {
    try {
      await requireSuperAdmin(ctx);
    } catch {
      return [];
    }
    const orgs = await ctx.db.query("organizations").collect();
    return orgs
      .map((o) => ({ clerkOrgId: o.clerkOrgId, name: o.name }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  },
});

/**
 * Clientes de una org específica (autocomplete del audit filter).
 */
export const listClientsForOrg = query({
  args: { orgId: v.string() },
  handler: async (ctx, args) => {
    try {
      await requireSuperAdmin(ctx);
    } catch {
      return [];
    }
    const clients = await ctx.db
      .query("clients")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .collect();
    return clients
      .map((c) => ({ id: c._id, name: c.name, rfc: c.rfc }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  },
});
```

### 3.4 Mutations globales de subservicios

Archivo: `convex/functions/subservices/globalMutations.ts` (NUEVO — separado
de `mutations.ts` que A1 entregó para el path org-scoped). A1 ya documentó en
su §3.2 que las mutations org-scoped NO permiten editar globales: "No puedes
editar el catálogo global directamente. Personaliza este subservicio para tu
org primero" (línea 362). D1 expone los equivalentes super-admin.

```ts
"use server";

import { mutation, query } from "../../_generated/server";
import { v } from "convex/values";
import { requireSuperAdmin } from "../../lib/authHelpers";
import { internal } from "../../_generated/api";

// Reuso del helper privado de A1 — exportar slugify desde subservices/mutations.ts
// o duplicar localmente. Decisión: exportar desde mutations.ts en este sprint.
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export const createGlobal = mutation({
  args: {
    parentServiceId: v.id("services"),
    name: v.string(),
    slug: v.optional(v.string()),
    description: v.optional(v.string()),
    defaultFrequency: v.union(
      v.literal("mensual"),
      v.literal("trimestral"),
      v.literal("semestral"),
      v.literal("anual"),
      v.literal("una_vez")
    ),
    applicableMonths: v.optional(v.array(v.number())),
    cooldownMonths: v.optional(v.number()),
    defaultPricingHint: v.optional(v.number()),
    isCommission: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    const parent = await ctx.db.get(args.parentServiceId);
    if (!parent) throw new Error("Servicio padre no encontrado.");

    const slug = args.slug ?? slugify(args.name);

    // Unicidad global: (parentServiceId, slug, orgId=undefined).
    const existing = await ctx.db
      .query("subservices")
      .withIndex("by_parent_slug", (q) =>
        q.eq("parentServiceId", args.parentServiceId).eq("slug", slug)
      )
      .filter((q) => q.eq(q.field("orgId"), undefined))
      .first();
    if (existing) {
      throw new Error(`Ya existe subservicio global "${slug}" bajo ${parent.name}.`);
    }

    const now = Date.now();
    const id = await ctx.db.insert("subservices", {
      orgId: undefined,        // global
      parentServiceId: args.parentServiceId,
      name: args.name,
      slug,
      description: args.description,
      defaultFrequency: args.defaultFrequency,
      applicableMonths: args.applicableMonths,
      cooldownMonths: args.cooldownMonths,
      defaultPricingHint: args.defaultPricingHint,
      isCommission: args.isCommission ?? parent.isCommission ?? false,
      isActive: true,
      isDefault: true,
      sortOrder: args.sortOrder ?? 100,
      createdAt: now,
      updatedAt: now,
    });

    // Log via wrapper de A3 (ya existe).
    await ctx.runMutation(internal.functions.documentEvents.internal.logEventMutation, {
      orgId: "__platform__",      // marker para eventos super-admin sin org concreto
      entityType: "subservice",
      entityId: id as string,
      eventType: "created",
      severity: "info",
      actorType: "user",
      actorUserId: (await ctx.auth.getUserIdentity())?.subject,
      message: `Subservicio global creado: ${parent.name} → ${args.name}`,
      metadata: { scope: "global", parentServiceId: args.parentServiceId },
    });

    return id;
  },
});

export const updateGlobal = mutation({
  args: {
    id: v.id("subservices"),
    patch: v.object({
      name: v.optional(v.string()),
      description: v.optional(v.string()),
      defaultFrequency: v.optional(v.union(
        v.literal("mensual"),
        v.literal("trimestral"),
        v.literal("semestral"),
        v.literal("anual"),
        v.literal("una_vez")
      )),
      applicableMonths: v.optional(v.array(v.number())),
      cooldownMonths: v.optional(v.number()),
      defaultPricingHint: v.optional(v.number()),
      isCommission: v.optional(v.boolean()),
      sortOrder: v.optional(v.number()),
      isActive: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    const sub = await ctx.db.get(args.id);
    if (!sub) throw new Error("Subservicio no encontrado.");
    if (sub.orgId !== undefined) {
      throw new Error("Esta mutation solo edita globales. Usa subservices.update para org-scoped.");
    }

    // Warning si hay orgs con clones del mismo slug (R1 §10 R2 — drift silencioso).
    const clones = await ctx.db
      .query("subservices")
      .withIndex("by_parent_slug", (q) =>
        q.eq("parentServiceId", sub.parentServiceId).eq("slug", sub.slug)
      )
      .filter((q) => q.neq(q.field("orgId"), undefined))
      .collect();

    await ctx.db.patch(args.id, { ...args.patch, updatedAt: Date.now() });

    await ctx.runMutation(internal.functions.documentEvents.internal.logEventMutation, {
      orgId: "__platform__",
      entityType: "subservice",
      entityId: args.id as string,
      eventType: "updated",
      severity: clones.length > 0 ? "warning" : "info",
      actorType: "user",
      actorUserId: (await ctx.auth.getUserIdentity())?.subject,
      message: clones.length > 0
        ? `Subservicio global actualizado. Hay ${clones.length} orgs con clones que NO recibirán este cambio.`
        : `Subservicio global actualizado.`,
      metadata: { scope: "global", clonesCount: clones.length },
    });

    return { id: args.id, clonesAffected: clones.length };
  },
});

export const deleteGlobal = mutation({
  args: { id: v.id("subservices"), force: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    const sub = await ctx.db.get(args.id);
    if (!sub) throw new Error("Subservicio no encontrado.");
    if (sub.orgId !== undefined) {
      throw new Error("Esta mutation solo borra globales.");
    }

    // Bloquear si hay clones org-scoped activos — answer a Q3 de §8.
    const clones = await ctx.db
      .query("subservices")
      .withIndex("by_parent_slug", (q) =>
        q.eq("parentServiceId", sub.parentServiceId).eq("slug", sub.slug)
      )
      .filter((q) => q.neq(q.field("orgId"), undefined))
      .collect();

    if (clones.length > 0 && !args.force) {
      throw new Error(
        `No se puede eliminar: ${clones.length} orgs tienen copias de este subservicio. ` +
        `Usa toggleActive en su lugar, o pasa { force: true } para eliminar SOLO el global ` +
        `(las copias org-scoped siguen vivas).`
      );
    }

    await ctx.db.delete(args.id);

    await ctx.runMutation(internal.functions.documentEvents.internal.logEventMutation, {
      orgId: "__platform__",
      entityType: "subservice",
      entityId: args.id as string,
      eventType: "deleted",
      severity: "warning",
      actorType: "user",
      actorUserId: (await ctx.auth.getUserIdentity())?.subject,
      message: `Subservicio global eliminado.${clones.length > 0 ? ` ${clones.length} clones org-scoped quedan huérfanos.` : ""}`,
      metadata: { scope: "global", clonesLeftOrphan: clones.length, force: args.force ?? false },
    });

    return { ok: true, clonesLeftOrphan: clones.length };
  },
});

/**
 * Query auxiliar: qué orgs tienen clones de un global dado.
 * Usado por el botón "Ver orgs con clon" en /platform/subservices.
 */
export const listOrgsWithClones = query({
  args: { globalSubserviceId: v.id("subservices") },
  handler: async (ctx, args) => {
    try {
      await requireSuperAdmin(ctx);
    } catch {
      return [];
    }
    const global = await ctx.db.get(args.globalSubserviceId);
    if (!global || global.orgId !== undefined) return [];

    const clones = await ctx.db
      .query("subservices")
      .withIndex("by_parent_slug", (q) =>
        q.eq("parentServiceId", global.parentServiceId).eq("slug", global.slug)
      )
      .filter((q) => q.neq(q.field("orgId"), undefined))
      .collect();

    // Resolver nombre de cada org.
    const orgIds = Array.from(new Set(clones.map((c) => c.orgId!)));
    const orgs = await Promise.all(
      orgIds.map((oid) =>
        ctx.db
          .query("organizations")
          .withIndex("by_clerkOrgId", (q) => q.eq("clerkOrgId", oid))
          .unique()
      )
    );
    const nameMap = new Map(orgs.filter(Boolean).map((o) => [o!.clerkOrgId, o!.name]));

    return clones.map((c) => ({
      cloneId: c._id,
      orgId: c.orgId!,
      orgName: nameMap.get(c.orgId!) ?? c.orgId!,
      lastUpdated: c.updatedAt,
      isActive: c.isActive,
    }));
  },
});
```

---

## 4. Frontend

### 4.1 `/platform/metrics`

Ruta: `src/app/platform/metrics/page.tsx`. Layout:

```
┌──────────────────────────────────────────────────────────────────┐
│  Métricas de la plataforma                                       │
│  Vista cross-org. Datos en tiempo real (Convex reactive).        │
├──────────────────────────────────────────────────────────────────┤
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐         │
│  │ Orgs   │ │ Deliv. │ │ Quotes │ │ Clientes│ │ AI Cost│         │
│  │   12   │ │  340   │ │   89   │ │   45   │ │$172 USD│         │
│  │ activas│ │  /mes  │ │  /mes  │ │ totales│ │  /mes  │         │
│  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘         │
├──────────────────────────────────────────────────────────────────┤
│  Deliverables últimos 30 días                                    │
│  ╭──────────────────────────────────────────────╮               │
│  │  ▁▂▃▅▆▇▆▅▃▄▆▅▃▂▁▃▅▆▇▆▅▃▄▆▅▃▂▁▃                │               │
│  ╰──────────────────────────────────────────────╯               │
├──────────────────────────────────────────────────────────────────┤
│  Por organización (sortable)                                     │
│  ┌─────────────┬──────┬─────────┬───────┬──────────┬────────┐   │
│  │ Org         │ Plan │ Clientes│ Deliv │ Cost USD │ Última │   │
│  ├─────────────┼──────┼─────────┼───────┼──────────┼────────┤   │
│  │ Acme Co     │ pro  │   12    │  84   │  $42.30  │ 2h     │   │
│  │ Beta SA     │basic │    5    │  31   │  $14.20  │ 1d     │   │
│  │ ...                                                       │   │
│  └─────────────┴──────┴─────────┴───────┴──────────┴────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

**Componente:**

```tsx
"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Activity, Users, FileText, DollarSign, Building2 } from "lucide-react";
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Link from "next/link";
import { useState } from "react";

type SortKey = "deliverablesMonth" | "aiCostUsdMonth" | "clientsCount" | "lastActivityMs";

export default function MetricsPage() {
  const data = useQuery(api.functions.superAdmin.metrics.getOverviewAll);
  const [sortBy, setSortBy] = useState<SortKey>("deliverablesMonth");

  if (!data) {
    return <div className="flex justify-center py-20"><div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" /></div>;
  }

  const sorted = [...data.perOrg].sort((a, b) => {
    const av = a[sortBy] ?? 0;
    const bv = b[sortBy] ?? 0;
    return (bv as number) - (av as number);
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Métricas de la plataforma</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Vista cross-org. Datos en tiempo real.
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <KpiCard icon={<Building2 size={18} />} label="Orgs activas" value={data.totals.orgsActive} />
        <KpiCard icon={<FileText size={18} />} label="Deliverables (mes)" value={data.totals.deliverablesMonth} />
        <KpiCard icon={<Activity size={18} />} label="Cotizaciones (mes)" value={data.totals.quotationsMonth} />
        <KpiCard icon={<Users size={18} />} label="Clientes totales" value={data.totals.clientsTotal} />
        <KpiCard icon={<DollarSign size={18} />} label="Costo IA (mes)" value={`$${data.totals.aiCostUsdMonth.toFixed(2)} USD`} />
      </div>

      {/* Chart 30d */}
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-sm font-semibold text-foreground">Deliverables — últimos 30 días</h2>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.last30Days}>
              <XAxis
                dataKey="dateMs"
                tickFormatter={(ms) => new Date(ms).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}
                fontSize={11}
                stroke="hsl(var(--muted-foreground))"
              />
              <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" />
              <Tooltip
                labelFormatter={(ms) => new Date(ms as number).toLocaleDateString("es-MX")}
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
              />
              <Line type="monotone" dataKey="deliverables" stroke="hsl(var(--accent))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Table per org */}
      <div className="rounded-lg border border-border bg-card">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <th className="px-6 py-3">Organización</th>
              <th className="px-6 py-3">Plan</th>
              <th className="cursor-pointer px-6 py-3" onClick={() => setSortBy("clientsCount")}>Clientes</th>
              <th className="cursor-pointer px-6 py-3" onClick={() => setSortBy("deliverablesMonth")}>Deliverables (mes)</th>
              <th className="cursor-pointer px-6 py-3" onClick={() => setSortBy("aiCostUsdMonth")}>Costo IA (USD)</th>
              <th className="cursor-pointer px-6 py-3" onClick={() => setSortBy("lastActivityMs")}>Última actividad</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.map((org) => (
              <tr key={org.orgId} className="hover:bg-secondary/50 transition-colors">
                <td className="px-6 py-4 text-sm font-medium text-foreground">
                  <Link href={`/platform/orgs/${org.orgId}?tab=metrics`} className="hover:text-accent">
                    {org.name}
                  </Link>
                </td>
                <td className="px-6 py-4 text-sm text-muted-foreground capitalize">{org.plan}</td>
                <td className="px-6 py-4 text-sm">{org.clientsCount}</td>
                <td className="px-6 py-4 text-sm">{org.deliverablesMonth}</td>
                <td className="px-6 py-4 text-sm">${org.aiCostUsdMonth.toFixed(2)}</td>
                <td className="px-6 py-4 text-sm text-muted-foreground">
                  {org.lastActivityMs
                    ? new Date(org.lastActivityMs).toLocaleDateString("es-MX")
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KpiCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground">{icon}<span className="text-xs">{label}</span></div>
      <div className="mt-2 text-2xl font-bold text-foreground">{value}</div>
    </div>
  );
}
```

**Auto-poll:** Convex queries son reactivas — cuando se inserta un
`deliverable` la UI se actualiza sin polling explícito. Decisión Q1 §8:
NO se añade polling manual.

### 4.2 `/platform/billing`

Ruta: `src/app/platform/billing/page.tsx`.

```
┌──────────────────────────────────────────────────────────────────┐
│  Billing                                                         │
│  Uso por org. Info-only (no procesa pagos en beta).              │
├──────────────────────────────────────────────────────────────────┤
│  [Mes: ▾ Mayo 2026] [Plan: ▾ Todos]                              │
├──────────────────────────────────────────────────────────────────┤
│  ┌─────────┬──────┬──────────┬─────────┬─────────┬──────────┐   │
│  │ Org     │ Plan │ Deliv./  │ Uso %   │ Cobrar  │ Costo IA │   │
│  │         │      │  Mes     │         │  (MXN)  │  (MXN)   │   │
│  ├─────────┼──────┼──────────┼─────────┼─────────┼──────────┤   │
│  │ Acme Co │ pro  │ 84 / 200 │ 42%     │$71,400  │ $740     │   │
│  │ Beta SA │basic │ 31 / 50  │ 62%     │$26,350  │ $248     │   │
│  └─────────┴──────┴──────────┴─────────┴─────────┴──────────┘   │
│  Total a cobrar este mes: $97,750 MXN · Costo IA: $988 MXN       │
└──────────────────────────────────────────────────────────────────┘
```

**Componente clave:**

```tsx
"use client";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useState } from "react";
import Link from "next/link";

type PlanFilter = "" | "basic" | "pro" | "enterprise";

export default function BillingPage() {
  const data = useQuery(api.functions.superAdmin.billing.getUsage, {});
  const [planFilter, setPlanFilter] = useState<PlanFilter>("");

  if (!data) return <Spinner />;

  const filtered = planFilter ? data.rows.filter((r) => r.plan === planFilter) : data.rows;
  const totalBillable = filtered.reduce((acc, r) => acc + r.billableMxn, 0);
  const totalAiCostMxn = filtered.reduce((acc, r) => acc + r.aiCostMxn, 0);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-foreground">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Uso por org. Info-only — no procesa pagos. Mes corriente.
        </p>
      </header>

      <div className="flex items-center gap-3">
        <label className="text-sm text-muted-foreground">Plan:</label>
        <select
          value={planFilter}
          onChange={(e) => setPlanFilter(e.target.value as PlanFilter)}
          className="rounded-md border border-border bg-secondary px-3 py-1.5 text-sm"
        >
          <option value="">Todos</option>
          <option value="basic">Basic</option>
          <option value="pro">Pro</option>
          <option value="enterprise">Enterprise</option>
        </select>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <th className="px-6 py-3">Organización</th>
              <th className="px-6 py-3">Plan</th>
              <th className="px-6 py-3">Deliverables / Mes</th>
              <th className="px-6 py-3">Uso %</th>
              <th className="px-6 py-3">A cobrar (MXN)</th>
              <th className="px-6 py-3">Costo IA</th>
              <th className="px-6 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((row) => (
              <tr key={row.orgId} className="hover:bg-secondary/50">
                <td className="px-6 py-4 text-sm font-medium">
                  <Link href={`/platform/orgs/${row.orgId}?tab=billing`} className="hover:text-accent">
                    {row.orgName}
                  </Link>
                </td>
                <td className="px-6 py-4 text-sm capitalize">{row.plan}</td>
                <td className="px-6 py-4 text-sm">{row.deliverablesMonth} / {row.deliverablesCap}</td>
                <td className="px-6 py-4 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary">
                      <div
                        className={`h-full ${row.deliverablesPct > 90 ? "bg-red-500" : row.deliverablesPct > 70 ? "bg-amber-500" : "bg-accent"}`}
                        style={{ width: `${row.deliverablesPct}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground">{row.deliverablesPct}%</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm">${row.billableMxn.toLocaleString("es-MX")}</td>
                <td className="px-6 py-4 text-sm text-muted-foreground">
                  ${row.aiCostMxn.toFixed(0)} MXN · ${row.aiCostUsd.toFixed(2)} USD
                </td>
                <td className="px-6 py-4">
                  <StatusBadge status={row.status} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-secondary/30 font-semibold">
              <td className="px-6 py-3 text-sm" colSpan={4}>Total</td>
              <td className="px-6 py-3 text-sm">${totalBillable.toLocaleString("es-MX")}</td>
              <td className="px-6 py-3 text-sm">${totalAiCostMxn.toFixed(0)} MXN</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    al_dia: "bg-green-500/10 text-green-500",
    por_cobrar: "bg-amber-500/10 text-amber-500",
    sobre_limite: "bg-red-500/10 text-red-500",
  };
  const labels: Record<string, string> = {
    al_dia: "Al día",
    por_cobrar: "Por cobrar",
    sobre_limite: "Sobre límite",
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}
```

### 4.3 `/platform/audit`

Ruta: `src/app/platform/audit/page.tsx`. Consume `documentEvents.queries.list`
de A3 directamente (paginación cursor-based, pageSize 50).

```
┌─────────────────────────────────────────────────────────────────┐
│  Audit log                                                      │
│  Eventos cross-org. Solo super-admin.                           │
├─────────────────────────────────────────────────────────────────┤
│  [Org: Acme Co ▾] [Cliente: ▾] [Entidad: ▾] [Sev: ●●●] [Desde:] │
├─────────────────────────────────────────────────────────────────┤
│  Fecha          Sev    Entidad     Mensaje                      │
│  2026-05-29 14:22  ●info  invoice    Factura mayo-2026 subida   │
│                                       Org: acme · Actor: chris   │
│  2026-05-29 14:22  ●info  deliverable Entregable generado...    │
│  ...                                                            │
│              [Cargar más ▾]                                     │
└─────────────────────────────────────────────────────────────────┘
```

**Componente:**

```tsx
"use client";
import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useState } from "react";

type EntityType = "invoice" | "deliverable" | "quotation" | "contract" | "template" | "subservice" | "questionnaire";
type Severity = "info" | "warning" | "error";

export default function AuditPage() {
  const orgs = useQuery(api.functions.superAdmin.audit.listOrgsForAuditFilter);
  const [orgFilter, setOrgFilter] = useState<string>("");      // Decisión Q7 A3: default vacío hasta que super-admin elija
  const [entityType, setEntityType] = useState<EntityType | "">("");
  const [severity, setSeverity] = useState<Severity | "">("");
  const [clientId, setClientId] = useState<string>("");
  const [sinceMs, setSinceMs] = useState<number | undefined>(undefined);

  const clients = useQuery(
    api.functions.superAdmin.audit.listClientsForOrg,
    orgFilter ? { orgId: orgFilter } : "skip"
  );

  // Default UX: requerir org seleccionada para evitar query cross-org pesada.
  const shouldQuery = orgFilter !== "";
  const { results, status, loadMore } = usePaginatedQuery(
    api.functions.documentEvents.queries.list,
    shouldQuery
      ? {
          orgId: orgFilter,
          clientId: clientId ? (clientId as Id<"clients">) : undefined,
          entityType: entityType || undefined,
          severity: severity || undefined,
          sinceMs,
        }
      : "skip",
    { initialNumItems: 50 }
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-foreground">Audit log</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Eventos cross-org. Selecciona una organización para empezar.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4">
        <FilterSelect
          label="Org"
          value={orgFilter}
          onChange={(v) => { setOrgFilter(v); setClientId(""); }}
          options={[
            { value: "", label: "— Selecciona org —" },
            ...(orgs ?? []).map((o) => ({ value: o.clerkOrgId, label: o.name })),
          ]}
        />
        <FilterSelect
          label="Cliente"
          value={clientId}
          onChange={setClientId}
          disabled={!orgFilter}
          options={[
            { value: "", label: "Todos" },
            ...(clients ?? []).map((c) => ({ value: c.id as string, label: `${c.name} (${c.rfc})` })),
          ]}
        />
        <FilterSelect
          label="Entidad"
          value={entityType}
          onChange={(v) => setEntityType(v as EntityType | "")}
          options={[
            { value: "", label: "Todas" },
            { value: "invoice", label: "Factura" },
            { value: "deliverable", label: "Entregable" },
            { value: "quotation", label: "Cotización" },
            { value: "contract", label: "Contrato" },
            { value: "template", label: "Plantilla" },
            { value: "subservice", label: "Subservicio" },
            { value: "questionnaire", label: "Cuestionario" },
          ]}
        />
        <FilterSelect
          label="Severidad"
          value={severity}
          onChange={(v) => setSeverity(v as Severity | "")}
          options={[
            { value: "", label: "Todas" },
            { value: "info", label: "Info" },
            { value: "warning", label: "Warning" },
            { value: "error", label: "Error" },
          ]}
        />
        <DatePicker label="Desde" value={sinceMs} onChange={setSinceMs} />
      </div>

      {!shouldQuery ? (
        <EmptyState message="Selecciona una organización en el filtro para ver eventos." />
      ) : (
        <div className="rounded-lg border border-border bg-card">
          {results.length === 0 && status === "Exhausted" ? (
            <EmptyState message="Sin eventos para estos filtros." />
          ) : (
            <>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <th className="px-6 py-3">Fecha</th>
                    <th className="px-6 py-3">Sev</th>
                    <th className="px-6 py-3">Entidad</th>
                    <th className="px-6 py-3">Mensaje</th>
                    <th className="px-6 py-3">Actor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {results.map((ev) => (
                    <tr key={ev._id as string} className="hover:bg-secondary/50">
                      <td className="px-6 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(ev.createdAt).toLocaleString("es-MX")}
                      </td>
                      <td className="px-6 py-3"><SeverityDot s={ev.severity} /></td>
                      <td className="px-6 py-3 text-xs text-muted-foreground capitalize">{ev.entityType}</td>
                      <td className="px-6 py-3 text-sm text-foreground">{ev.message}</td>
                      <td className="px-6 py-3 text-xs text-muted-foreground">
                        {ev.actorUserId ?? ev.actorType}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {status === "CanLoadMore" && (
                <button
                  onClick={() => loadMore(50)}
                  className="w-full border-t border-border py-3 text-sm text-accent hover:bg-secondary/50"
                >
                  Cargar más
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

**Decisión Q7 (A3 §9):** default = sin org seleccionada, empty state pide
elegir una. Evita query cross-org pesada accidentalmente. (Discrepa
ligeramente de la "Recomendación" de A3 que sugería default = primera org —
para D1 es más explícito pedir selección manual, simplifica la UI inicial.)

### 4.4 `/platform/subservices`

Ruta: `src/app/platform/subservices/page.tsx`. CRUD de catálogo global +
visualización de orgs con clones.

```
┌──────────────────────────────────────────────────────────────────┐
│  Subservicios globales                                           │
│  Catálogo base disponible a todas las orgs. Editable solo aquí.  │
├──────────────────────────────────────────────────────────────────┤
│  [+ Crear subservicio global]                                    │
├──────────────────────────────────────────────────────────────────┤
│  ▼ Legal                                                         │
│     Gobierno Corporativo     mensual    [3 orgs con clones] [✏]  │
│     Contratos Mercantiles    mensual    [0 clones]          [✏]  │
│     Compliance               trimestral [1 clon]            [✏]  │
│  ▼ Contable                                                      │
│     ...                                                          │
└──────────────────────────────────────────────────────────────────┘
```

**Comportamiento:**

- Reusa `api.functions.subservices.queries.listGlobalsForAdmin` (de A1).
- Agrupa client-side por `parentServiceId` (cruza con
  `services.queries.listAllForAdmin`).
- Modal de creación/edición usa `createGlobal` / `updateGlobal`.
- Botón "Ver orgs con clones" abre dialog con `listOrgsWithClones`.
- Botón "Eliminar" llama `deleteGlobal` (bloquea si clones existen sin
  `force: true`).

```tsx
"use client";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useState } from "react";
import { Plus, ChevronRight, ChevronDown, Edit, Trash2, Users } from "lucide-react";

type Frequency = "mensual" | "trimestral" | "semestral" | "anual" | "una_vez";

export default function GlobalSubservicesPage() {
  const subs = useQuery(api.functions.subservices.queries.listGlobalsForAdmin);
  const services = useQuery(api.functions.services.queries.listAllForAdmin);
  const createGlobal = useMutation(api.functions.subservices.globalMutations.createGlobal);
  const updateGlobal = useMutation(api.functions.subservices.globalMutations.updateGlobal);
  const deleteGlobal = useMutation(api.functions.subservices.globalMutations.deleteGlobal);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ id?: Id<"subservices">; parentServiceId?: Id<"services"> } | null>(null);
  const [clonesModalFor, setClonesModalFor] = useState<Id<"subservices"> | null>(null);

  if (!subs || !services) return <Spinner />;

  // Agrupar subservicios por servicio padre.
  const byParent = new Map<string, typeof subs>();
  for (const s of subs) {
    const key = s.parentServiceId as string;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(s);
  }

  const toggleExpand = (parentId: string) => {
    const next = new Set(expanded);
    if (next.has(parentId)) next.delete(parentId); else next.add(parentId);
    setExpanded(next);
  };

  const handleDelete = async (id: Id<"subservices">) => {
    try {
      await deleteGlobal({ id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("orgs tienen copias")) {
        if (confirm(`${msg}\n\n¿Eliminar solo el global, dejando los clones huérfanos?`)) {
          await deleteGlobal({ id, force: true });
        }
      } else {
        alert(msg);
      }
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Subservicios globales</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Catálogo base. Disponible a todas las orgs. Editable solo aquí.
          </p>
        </div>
        <button
          onClick={() => setEditing({})}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90"
        >
          <Plus size={16} /> Crear subservicio global
        </button>
      </header>

      <div className="space-y-3">
        {services.map((svc) => {
          const children = byParent.get(svc._id as string) ?? [];
          const isOpen = expanded.has(svc._id as string);
          return (
            <div key={svc._id as string} className="rounded-lg border border-border bg-card">
              <button
                onClick={() => toggleExpand(svc._id as string)}
                className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold hover:bg-secondary/50"
              >
                {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                {svc.name}
                <span className="text-xs text-muted-foreground">({children.length})</span>
              </button>
              {isOpen && (
                <div className="border-t border-border">
                  {children.length === 0 ? (
                    <div className="px-6 py-4 text-sm text-muted-foreground">
                      Sin subservicios globales.
                      <button
                        onClick={() => setEditing({ parentServiceId: svc._id as Id<"services"> })}
                        className="ml-2 text-accent hover:underline"
                      >
                        + Crear uno
                      </button>
                    </div>
                  ) : (
                    <table className="w-full">
                      <tbody className="divide-y divide-border">
                        {children.map((sub) => (
                          <tr key={sub._id as string} className="text-sm">
                            <td className="px-6 py-3">{sub.name}</td>
                            <td className="px-6 py-3 text-xs text-muted-foreground capitalize">{sub.defaultFrequency}</td>
                            <td className="px-6 py-3 text-xs">
                              <CloneCountChip subId={sub._id as Id<"subservices">} onClick={() => setClonesModalFor(sub._id as Id<"subservices">)} />
                            </td>
                            <td className="px-6 py-3 text-right">
                              <button onClick={() => setEditing({ id: sub._id as Id<"subservices"> })} className="rounded p-1.5 text-muted-foreground hover:bg-secondary"><Edit size={14} /></button>
                              <button onClick={() => handleDelete(sub._id as Id<"subservices">)} className="ml-1 rounded p-1.5 text-red-400 hover:bg-red-500/10"><Trash2 size={14} /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editing && <GlobalSubserviceFormModal data={editing} onClose={() => setEditing(null)} services={services} create={createGlobal} update={updateGlobal} />}
      {clonesModalFor && <ClonesModal globalSubserviceId={clonesModalFor} onClose={() => setClonesModalFor(null)} />}
    </div>
  );
}

function CloneCountChip({ subId, onClick }: { subId: Id<"subservices">; onClick: () => void }) {
  const clones = useQuery(api.functions.subservices.globalMutations.listOrgsWithClones, { globalSubserviceId: subId });
  if (!clones) return <span className="text-muted-foreground">…</span>;
  if (clones.length === 0) return <span className="text-muted-foreground">0 clones</span>;
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1 text-accent hover:underline">
      <Users size={12} /> {clones.length} {clones.length === 1 ? "clon" : "clones"}
    </button>
  );
}
```

`GlobalSubserviceFormModal` y `ClonesModal` son shadcn `Dialog`s con form
estándar; layout idéntico al de `/platform/templates` (campos: parent
service select, name, frequency, applicableMonths chip-input, cooldownMonths
number, defaultPricingHint number, sortOrder).

### 4.5 `/platform/orgs/[id]` con tabs

Diff sobre `src/app/platform/orgs/[id]/page.tsx`. La página actual es una
form única (~ 460 líneas). D1 la envuelve con un componente de tabs:

```
┌──────────────────────────────────────────────────────────────┐
│  ← Acme Co                                  [Branding]       │
│  org_2N4xY...                                                │
├──────────────────────────────────────────────────────────────┤
│  [Detalles] [Métricas] [Billing] [Audit]                     │
├──────────────────────────────────────────────────────────────┤
│  (contenido del tab activo)                                  │
└──────────────────────────────────────────────────────────────┘
```

**Tabs:**

- **Detalles** — el form existente entero (sin cambio). Default tab.
- **Métricas** — consume `getOrgDetails({ orgId: org.clerkOrgId })`. Muestra
  monthTotals + topClients + distribution chart pequeño.
- **Billing** — consume `getUsage({ orgId: org.clerkOrgId })` (filtrado a una
  sola org → rows.length === 1). Card detallado: deliverables/cap, billable,
  costo AI USD+MXN, margen.
- **Audit** — consume `documentEvents.queries.list` filtrado por este orgId
  (no requiere selección manual aquí, ya viene del contexto).

Tab routing: query param `?tab=metrics|billing|audit|details`. Links de
`/platform/metrics` y `/platform/billing` deep-linkean a esta página con el
tab correcto (ver §4.1 y §4.2).

```tsx
// Diff conceptual sobre el componente existente:
const searchParams = useSearchParams();
const activeTab = (searchParams.get("tab") as "details" | "metrics" | "billing" | "audit") ?? "details";

return (
  <div className="mx-auto max-w-4xl space-y-6">
    {/* header existente sin cambio */}

    <div className="border-b border-border">
      <nav className="flex gap-1">
        <TabLink href={`?tab=details`} active={activeTab === "details"}>Detalles</TabLink>
        <TabLink href={`?tab=metrics`} active={activeTab === "metrics"}>Métricas</TabLink>
        <TabLink href={`?tab=billing`} active={activeTab === "billing"}>Billing</TabLink>
        <TabLink href={`?tab=audit`} active={activeTab === "audit"}>Audit</TabLink>
      </nav>
    </div>

    {activeTab === "details" && <DetailsForm /* form existente */ />}
    {activeTab === "metrics" && org && <OrgMetricsTab orgId={org.clerkOrgId} />}
    {activeTab === "billing" && org && <OrgBillingTab orgId={org.clerkOrgId} />}
    {activeTab === "audit" && org && <OrgAuditTab orgId={org.clerkOrgId} />}
  </div>
);
```

### 4.6 Sidebar

Diff sobre `src/components/layout/sidebar.tsx:104-119`. El bloque
super-admin actual tiene un solo link "Panel de Plataforma". Reemplazar por
un grupo:

```tsx
{isSuperAdmin && (
  <>
    <div className="my-3 border-t border-border" />
    {!collapsed && (
      <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-purple-400/60">
        Plataforma
      </p>
    )}
    {[
      { href: "/platform", label: "Organizaciones", icon: Building2 },
      { href: "/platform/metrics", label: "Métricas", icon: Activity },
      { href: "/platform/billing", label: "Billing", icon: DollarSign },
      { href: "/platform/audit", label: "Audit log", icon: FileSearch },
      { href: "/platform/subservices", label: "Subservicios", icon: Layers },
      { href: "/platform/servicios", label: "Servicios (padre)", icon: Briefcase },
      { href: "/platform/templates", label: "Plantillas", icon: FileText },
    ].map((item) => (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          pathname === item.href
            ? "bg-purple-500/15 text-purple-300"
            : "text-purple-400/80 hover:bg-purple-500/10 hover:text-purple-300"
        )}
        title={collapsed ? item.label : undefined}
      >
        <item.icon size={18} />
        {!collapsed && <span>{item.label}</span>}
      </Link>
    ))}
  </>
)}
```

Iconos nuevos a importar de `lucide-react`: `Activity`, `DollarSign`,
`FileSearch`, `Layers`.

---

## 5. Tests

Mínimo 8 tests vitest + `convex-test` (mismo patrón que A1/A3). Archivos:

### 5.1 `convex/functions/superAdmin/metrics.test.ts` (3)

1. **`getOverviewAll` agrega correctamente cross-org.** Setup: 2 orgs, cada
   una con 3 deliverables del mes corriente con `aiLog[].costUsd` poblado.
   Assert: `totals.deliverablesMonth === 6`, `totals.aiCostUsdMonth === sum`,
   `perOrg.length === 2`, ordenado por `deliverablesMonth desc`.
2. **`getOverviewAll` requiere super-admin.** Auth como `org:admin` regular,
   assert: retorna estructura vacía (`totals.orgsActive === 0`,
   `perOrg.length === 0`). NO throw.
3. **`getOrgDetails` retorna topClients ordenados.** Setup: 1 org, 3 clientes
   con 5/3/1 deliverables. Assert: `topClients[0].deliverablesMonth === 5`,
   `topClients[2].deliverablesMonth === 1`. Multi-tenant: si caller pasa
   `orgId` de otra org sin ser super-admin → null.

### 5.2 `convex/functions/superAdmin/billing.test.ts` (1)

4. **`getUsage` calcula billable y margen.** Setup: 1 org plan=pro, 10
   deliverables del mes con `aiLog[0].costUsd = 0.5`. Assert:
   `row.billableMxn === 10 * 850`, `row.aiCostUsd === 5.0`,
   `row.aiCostMxn === 5.0 * 17.5`, `row.deliverablesPct === 5` (10/200),
   `row.status === "por_cobrar"`.

### 5.3 `convex/functions/superAdmin/audit.test.ts` (1)

5. **`listOrgsForAuditFilter` retorna nombre + clerkOrgId orden alfabético.**
   Setup: 3 orgs ("Charlie", "Alpha", "Beta"). Assert: orden = Alpha, Beta,
   Charlie. Multi-tenant: caller sin super-admin → `[]`.

### 5.4 `convex/functions/subservices/globalMutations.test.ts` (3)

6. **`createGlobal` inserta con `orgId: undefined`.** Auth super-admin.
   Llamar `createGlobal({ parentServiceId, name: "Test", defaultFrequency:
   "mensual" })`. Assert: row insertada con `orgId === undefined`,
   `isDefault === true`. Evento `documentEvents` insertado con
   `orgId: "__platform__"`, eventType `created`.
7. **`updateGlobal` advierte sobre clones.** Setup: 1 global + 2 clones
   org-scoped (mismo `parentServiceId`+`slug`). Llamar `updateGlobal({ id,
   patch: { name: "Renamed" } })`. Assert: retorna
   `{ clonesAffected: 2 }`. Evento `documentEvents` con severity `warning`.
8. **`deleteGlobal` bloquea si hay clones sin force.** Setup: global + 1
   clon. Llamar `deleteGlobal({ id })` sin `force`. Assert: throws con
   mensaje "orgs tienen copias". Llamar de nuevo con `force: true`. Assert:
   row eliminada, evento `deleted` warning insertado con
   `metadata.clonesLeftOrphan === 1`.

### 5.5 Multi-tenant guard (todos)

Cada query super-admin tiene en sí misma una prueba que verifica el guard
(test #2 y #3 ya lo cubren para metrics; test #6 lo cubre para mutations).
Total: 8 tests mínimos. Recomendados extra (no bloquean DoD):

- `getOverviewAll` con cero deliverables → totals todo en 0.
- `listOrgsWithClones` retorna solo clones org-scoped, ignora otros globales
  con mismo slug bajo otro parent.

---

## 6. Definition of Done

Booleanos, marcar todos antes de cerrar PR:

- [ ] `convex/functions/superAdmin/metrics.ts` con `getOverviewAll`,
      `getOrgDetails`. Ambas gated `requireSuperAdmin`.
- [ ] `convex/functions/superAdmin/billing.ts` con `getUsage`. Constantes
      `PLAN_CAPS`, `USD_TO_MXN`, `SUGGESTED_PRICE_MXN_PER_DELIVERABLE`
      documentadas con TODO post-beta.
- [ ] `convex/functions/superAdmin/audit.ts` con `listOrgsForAuditFilter`,
      `listClientsForOrg`.
- [ ] `convex/functions/subservices/globalMutations.ts` con `createGlobal`,
      `updateGlobal`, `deleteGlobal`, `listOrgsWithClones`. Helper
      `slugify` exportado desde A1's `mutations.ts` o duplicado.
- [ ] `convex/functions/subservices/queries.ts` expone `listGlobalsForAdmin`
      (A1 ya lo entregó — verificar import path).
- [ ] `src/app/platform/metrics/page.tsx` con KpiCards + LineChart + tabla
      sortable.
- [ ] `src/app/platform/billing/page.tsx` con tabla + filtro de plan +
      footer totales.
- [ ] `src/app/platform/audit/page.tsx` con filtros (org, cliente,
      entidad, severidad, fecha) + tabla paginada cursor-based.
- [ ] `src/app/platform/subservices/page.tsx` con árbol expandible + modal
      crear/editar + dialog "Ver clones".
- [ ] `src/app/platform/orgs/[id]/page.tsx` envuelto con tabs (details,
      metrics, billing, audit). Tab routing via `?tab=` query param.
- [ ] `src/components/layout/sidebar.tsx:104-119` reemplazado con grupo
      super-admin de 7 entries.
- [ ] Recharts ya está en `package.json` (verificar) — sino, `npm i recharts`.
- [ ] 8+ tests vitest pasando (`npm test`).
- [ ] `npm run lint` clean.
- [ ] `npx tsc --noEmit` clean.
- [ ] `gitnexus_impact` corrido sobre `sidebar.tsx` (cambio en gate
      super-admin afecta navegación de todos los super-admins) y sobre
      `orgs/[id]/page.tsx` (cambio estructural con tabs).
- [ ] `gitnexus_detect_changes` confirma scope: solo
      `convex/functions/superAdmin/*`, `convex/functions/subservices/globalMutations.ts`,
      `src/app/platform/{metrics,billing,audit,subservices}/page.tsx`,
      `src/app/platform/orgs/[id]/page.tsx`, `src/components/layout/sidebar.tsx`.
- [ ] Test E2E manual: como super-admin, recorrer las 4 páginas nuevas;
      como `org:admin` regular, confirmar que el sidebar NO muestra el
      bloque super-admin y que `/platform/*` rutas dan 404 o redirect.

---

## 7. Riesgos específicos de D1

| # | Riesgo | Mitigación |
|---|---|---|
| RD1 | `getOverviewAll` hace `collect()` sobre 4 tablas completas (deliverables, quotations, clients, subservices). Con 100 orgs y 10K deliverables totales, la query puede tomar 1-3 s. | R1 §11 O9: hoy < 10K rows totales en beta. Si crece, agregar tabla materializada `metricsDaily` actualizada por cron. Documentado como TODO. |
| RD2 | Reactivity → cada insert de deliverable hace re-render de `/platform/metrics`. Costoso si super-admin tiene la página abierta y hay 50 deliverables/min. | Convex throttles re-renders. Aceptable hoy. Si emerge, mover a query polled cada 30 s o agregar materialización. |
| RD3 | `PLAN_CAPS` y `SUGGESTED_PRICE_MXN_PER_DELIVERABLE` hardcoded → cualquier cambio de plan requiere deploy. | Beta: aceptable (3 orgs, mismos caps). Post-beta: mover a tabla `plans` editable desde `/platform`. |
| RD4 | `documentEvents` lookup cross-org sin orgId puede retornar miles de rows si super-admin no filtra. | UI fuerza selección de org como prerequisito (§4.3). Backend query A3 ya pagina (pageSize ≤ 100). |
| RD5 | `deleteGlobal({ force: true })` deja clones huérfanos sin parent global. El selector A3 (`selectDeliverableForMonth`) los seguiría usando porque consulta por `parentServiceId` + `slug` — pero el subservicio org-scoped sigue siendo válido en sí mismo. | Aceptable. El "huerfanato" es contable solo; no rompe la operación. Documentado en mensaje del confirm dialog. |
| RD6 | Tabs en `/platform/orgs/[id]` requieren `useSearchParams` → cliente. La página actual ya es `"use client"`, sin problema, pero validar SSR si en futuro se migra a server component. | Sin acción. |
| RD7 | `updateGlobal` advierte sobre clones via `documentEvents` con severity warning, pero la org clonada no recibe notificación. Drift silencioso (R1 §10 R2). | A2 ya documentó el banner en `/configuracion/plantillas` para plantillas. Para subservicios, post-beta: agregar columna en `/configuracion/subservicios` de A1 mostrando "v2 base disponible". D1 NO lo implementa. |

---

## 8. Open questions

**Q1.** ¿Métricas con refresh manual o auto-poll?
**Recomendación:** Auto-poll vía reactividad Convex (sin acción explícita).
Cada `useQuery` se invalida cuando el backend cambia. Si performance se
vuelve issue (RD2), agregar `useQuery` con polling 30 s usando un trigger
manual de `setInterval` que invalide cache.

**Q2.** ¿`/platform/billing` permite generar invoice de plataforma (a cobrar
al despacho) o es info-only?
**Recomendación (decisión O10 R1):** Info-only en beta. El super-admin lee
los números, cobra fuera del sistema (Stripe manual o factura emitida por
fuera). Post-beta: integración Stripe + emisión automática.

**Q3.** ¿`deleteGlobal` con clones existentes debe bloquear duro o permitir
force?
**Recomendación:** Bloquear por default con mensaje claro. Permitir `force:
true` (UI lo pide vía confirm dialog secundario). Esto preserva el principio
"safety por default, escape hatch documentado" del resto del proyecto
(`subservices.remove` en A1 usa el mismo patrón).

**Q4.** ¿`documentEvents` retención TTL en `/platform/audit`?
**Recomendación (decisión O15 R1 + Q4 A3):** No TTL en beta. Cleanup CLI
manual post-junio si bloat. Estimación: ~15K-150K eventos/org/año →
manejable.

**Q5.** ¿La tabla `/platform/metrics` debe permitir export CSV?
**Recomendación:** No en beta (R1 §9.3 mitigation orden 1). El super-admin
abre la página y screenshotea, o accede al Convex dashboard. Post-beta:
endpoint Convex action que devuelve CSV blob → descarga.

**Q6.** ¿El bloque super-admin del sidebar reemplaza el link único actual
o lo expande?
**Recomendación:** Lo reemplaza (§4.6). El link `/platform` solitario actual
queda redundante una vez que hay 7 entries con icons distintos. UX más
clara con menú vertical en lugar de un solo botón morado.

---

## 9. Referencias

### 9.1 Archivos del codebase

**Backend reusado:**
- `convex/lib/authHelpers.ts:40-50` — `requireSuperAdmin`. Todas las queries
  D1 lo invocan.
- `convex/functions/organizations/queries.ts:5-15` — `list` (super-admin
  only). Patrón base para las queries nuevas.
- `convex/functions/subservices/queries.ts:listGlobalsForAdmin` — entregado
  por A1 §3.1 (líneas 242-256 del spec A1).
- `convex/functions/documentEvents/queries.ts:list` — entregado por A3
  §3.6. D1 lo consume directamente desde el frontend de `/platform/audit`.
- `convex/functions/documentEvents/internal.ts:logEventMutation` — wrapper
  de A3 §3.5. Las mutations `createGlobal/updateGlobal/deleteGlobal` lo
  invocan con `orgId: "__platform__"`.

**Schema referenciado:**
- `convex/schema.ts:5-22` — `organizations` (plan, status, clerkOrgId,
  assignedServiceIds).
- `convex/schema.ts:24-44` — `clients` (orgId, isArchived).
- `convex/schema.ts:328-367` — `deliverables` (aiLog[].costUsd, createdAt,
  index by_orgId).
- `convex/schema.ts:369-391` — `orgConfigs`.
- `convex/schema.ts (post-A1)` — `subservices` con `orgId: v.optional`,
  índices `by_orgId`, `by_parent_slug`.
- `convex/schema.ts (post-A3)` — `documentEvents` con índices
  `by_orgId_createdAt`, `by_orgId_severity_createdAt`.

**Frontend base UI:**
- `src/app/platform/page.tsx:43-127` — tabla de orgs, patrón visual base
  (Badge, columnas, hover state) reutilizado en `/platform/metrics` y
  `/platform/billing`.
- `src/app/platform/templates/page.tsx:1-771` — modal form completo (header,
  filtros, tabla, edit form, preview modal) — patrón reutilizado en
  `/platform/subservices`.
- `src/app/platform/orgs/[id]/page.tsx:1-463` — form existente que D1
  envuelve con tabs (§4.5).
- `src/components/layout/sidebar.tsx:24-35` — array `navigation` operadora.
- `src/components/layout/sidebar.tsx:41` — `isSuperAdmin` derivado de
  `user.publicMetadata.role === "super_admin"`.
- `src/components/layout/sidebar.tsx:104-119` — bloque super-admin actual
  que D1 reemplaza (§4.6).

### 9.2 Sub-specs relacionados

- `docs/superpowers/specs/2026-05-20-prod-readiness-revision.md` — maestro
  R1. §7.1, §11 O9-O10, §12.11 fijan las decisiones canónicas de D1.
- `docs/superpowers/specs/2026-05-21-subservices-model-design.md` — A1.
  Provee `subservices` table + `listGlobalsForAdmin` query. D1 consume.
- `docs/superpowers/specs/2026-05-23-document-lifecycle-design.md` — A3.
  Provee `documentEvents` table + `queries.list` + `logEventMutation`
  wrapper. D1 consume tanto el query (audit UI) como el wrapper (mutations
  globales).
- `docs/superpowers/specs/2026-05-22-templates-operator-access-design.md` —
  A2. NO impacta directamente D1; `/platform/templates` ya está estable.

### 9.3 Memorias del proyecto

- `project_sprint_v2_timeline` — D1 cae sábado 30-may en el cronograma R1
  §9.2. Si A3 se retrasa, D1.audit es la primera víctima (R1 §9.3 orden 5).
- `project_blob_storage` — Railway bucket; D1 NO toca blobs (las queries de
  métricas operan solo sobre Convex rows).

---

**Fin del sub-spec D1.** Con D1 mergeado, el super-admin tiene visibilidad
end-to-end del beta (métricas + billing + audit + catálogo global) sin
abrir el Convex dashboard. Las 4 páginas nuevas comparten patrón UI
(`/platform/templates`) para no introducir dependencias visuales nuevas.
