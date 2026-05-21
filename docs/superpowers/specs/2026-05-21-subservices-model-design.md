# A1 — Subservices Model

**Fecha:** 2026-05-21
**Sub-spec del maestro:** `docs/superpowers/specs/2026-05-20-prod-readiness-revision.md`
**Estado:** propuesto
**Días estimados:** 2 (1 d schema + migration + queries/mutations, 0.5 d catálogo papá + seed final, 0.5 d UI básica `/configuracion/subservicios` + dropdown wizard)
**Owner:** Christian
**Dependencias:** R1 aprobado

---

## 1. Objetivo

Introducir el modelo padre→hijo de servicios contractuales. Hoy `services` lista
los 9 padre globales (Legal, Contable, …) — Projex no puede expresar que un
cliente contrata "Legal → Gobierno Corporativo" como item distinto de "Legal →
Compliance LFPDPP". Cada padre se trata como una sola unidad facturable, lo que
rompe la realidad operativa del despacho de papá: ese cliente paga distinto por
distintos sub-conceptos, requiere entregables distintos, y el operador piensa
en jerarquía.

R1 §2 fija el modelo: `services` (los 9 padre, intactos) + nueva tabla
`subservices` con `parentServiceId`, frecuencia por defecto propia, ámbito
global o org-scoped. Migración aditiva: `subserviceId: v.optional(v.id("subservices"))`
en 6 tablas denormalizadas, con dual-matching (preferencia subservicio,
fallback `serviceId`/`serviceName`). Sin breakage de proyecciones legacy.

A1 entrega: schema, queries, mutations, seed (catálogo inicial), página
`/configuracion/subservicios`, integración mínima en wizard de proyección.
A3 (lifecycle) consumirá el campo `subserviceId` en `selectDeliverableForMonth`;
B1 lo consumirá en el panel "Servicios contratados". A1 deja todo eso listo
en datos pero no integra esos consumidores.

---

## 2. Schema

### 2.1 Tabla nueva `subservices`

Agregar a `convex/schema.ts` (después del bloque `services` actual, líneas
153-166). Definición Convex completa:

```ts
subservices: defineTable({
  orgId: v.optional(v.string()),         // null = subservicio global (catálogo base, isDefault=true)
  parentServiceId: v.id("services"),     // FK al servicio padre (uno de los 9)
  name: v.string(),                      // "Gobierno Corporativo"
  slug: v.string(),                      // "gobierno-corporativo" — estable, kebab-case
  description: v.optional(v.string()),
  defaultFrequency: v.union(
    v.literal("mensual"),
    v.literal("trimestral"),
    v.literal("semestral"),
    v.literal("anual"),
    v.literal("una_vez")
  ),
  applicableMonths: v.optional(v.array(v.number())), // null = sin restricción (1-12 permitido); usado por A3
  cooldownMonths: v.optional(v.number()),             // default 0; usado por A3
  defaultPricingHint: v.optional(v.number()),         // monto mensual sugerido MXN
  isCommission: v.optional(v.boolean()),              // heredado del padre al crear, override permitido
  isActive: v.boolean(),
  isDefault: v.boolean(),                // true = catálogo base (orgId=null), false = creado por org
  sortOrder: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_orgId", ["orgId"])
  .index("by_parentServiceId", ["parentServiceId"])
  .index("by_orgId_parentService", ["orgId", "parentServiceId"])
  .index("by_orgId_isActive", ["orgId", "isActive"])
  .index("by_parent_slug", ["parentServiceId", "slug"]),
```

**Notas de diseño:**

- `orgId` es `optional` igual que en `services` (mismo patrón): `null/undefined`
  = global, string = scope org. Permite seed con catálogo base universal.
- `parentServiceId` es `v.id("services")` no string. Convex valida la FK en
  runtime de la query. Borrado del padre no cascadea automáticamente — ver §2.3.
- `slug` es estable y único por `(parentServiceId, orgId)`. Renombrar `name`
  NO cambia el slug. Permite mapeo histórico cuando A3 hace dual-matching y
  cuando B1 muestra label.
- `isCommission` se hereda del padre al crear (helper en mutation, ver §3.2);
  el operador puede override para casos raros, pero la engine de Proyección
  solo lo lee del `services` padre, no del subservicio (decisión R1 §2.4).
- `isDefault=true` AND `orgId=null` es invariante: los globales son
  `isDefault: true, orgId: undefined`. Los org-scoped son `isDefault: false,
  orgId: "<clerkOrgId>"`. Asegurado por las mutations, no por constraint.

### 2.2 Campos opcionales en tablas existentes

Diff conceptual sobre `convex/schema.ts` — una sola migración añade
`subserviceId: v.optional(v.id("subservices"))` a las siguientes tablas:

| Tabla | Línea actual | Insertar campo después de | Consumidor futuro |
|---|---|---|---|
| `projectionServices` | 168-180 | `serviceName` (172) | Wizard guarda al crear; B1 lo lee para "Servicios contratados". |
| `monthlyAssignments` | 182-210 | `serviceName` (187) | A3 `selectDeliverableForMonth` lo lee; engine genera el row con valor del `projectionServices` matching. |
| `quotations` | 276-304 | `serviceName` (280) | A3/B1 cotización por subservicio (line items). |
| `contracts` | 306-326 | `serviceName` (311) | Heredado de quotation al firmar. |
| `deliverables` | 328-367 | `serviceName` (333) | A3 lo escribe al generar; B1 lo lee. |
| `deliverableTemplates` | 407-441 | `serviceName` (410) | A2 resolver prefiere match por `subserviceId`, fallback `serviceId`+`serviceName`. |

**Sintaxis exacta a insertar (idéntica en las 6 tablas):**

```ts
subserviceId: v.optional(v.id("subservices")),
```

**No** se añaden índices nuevos sobre `subserviceId` en ninguna de las 6 — los
índices existentes por `projectionId` / `clientId` / `orgId` siguen siendo el
acceso primario y dual-matching se hace en query layer. Si A3 mide que necesita
un índice específico (ej. `by_clientId_subserviceId` para `deliverables`), se
agrega entonces, no ahora.

**`questionnaireResponses.responses[].serviceNames`:** queda intacto en A1. R1
§2.2 propuso campo paralelo `subserviceIds`; ese cambio lo absorbe el sub-spec
del cuestionario unificado (no A1, no A2, no A3). A1 solo se limita a las 6
tablas listadas arriba.

### 2.3 Convex no permite constraints únicos cross-row

Convex no expone constraints únicos a nivel schema. Invariantes que importan
preservar y cómo se preservan:

| Invariante | Estrategia |
|---|---|
| No duplicar `(parentServiceId, slug, orgId)` | Patrón query-then-insert dentro de la mutation `subservices.create` / `subservices.update`. Lookup por índice `by_parent_slug` filtrando por `orgId`. Sin atomicidad real entre query e insert pero suficiente para uso single-operator (race casi imposible). Si llegara a fallar, el segundo insert queda con slug duplicado y el resolver de UI lo trata como dato inconsistente. |
| No borrar `services` padre si tiene `subservices` hijos | `services.delete*` (super admin only) hace query previa `subservices.by_parentServiceId` y rechaza si hay rows activos. A1 no añade esa mutation porque hoy nadie borra los 9 padre — se documenta como riesgo en §8 (R-cascade). |
| Soft delete preferido sobre hard delete | `subservices.toggleActive` set `isActive: false` en lugar de borrado. `subservices.delete` solo en hard delete y bloqueado si hay refs (ver §3.2). |

---

## 3. Backend (queries + mutations + actions)

Nuevo módulo `convex/functions/subservices/` con `queries.ts`, `mutations.ts`,
`seed.ts`. Estilo y guards copiados de `convex/functions/services/`.

### 3.1 Queries

Archivo `convex/functions/subservices/queries.ts`.

```ts
import { query } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgIdSafe, requireAuth } from "../../lib/authHelpers";
```

**`listByParent`** — usado por el wizard de proyección Step 2 y por la página
operadora.

```ts
export const listByParent = query({
  args: { parentServiceId: v.id("services") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    // org-scoped activos del padre
    const orgScoped = await ctx.db
      .query("subservices")
      .withIndex("by_orgId_parentService", (q) =>
        q.eq("orgId", orgId).eq("parentServiceId", args.parentServiceId)
      )
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    // globales activos del padre
    const globals = await ctx.db
      .query("subservices")
      .withIndex("by_orgId_parentService", (q) =>
        q.eq("orgId", undefined).eq("parentServiceId", args.parentServiceId)
      )
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    // merge con override: si org-scoped tiene mismo slug que global, gana org-scoped
    const orgSlugs = new Set(orgScoped.map((s) => s.slug));
    const merged = [
      ...orgScoped,
      ...globals.filter((g) => !orgSlugs.has(g.slug)),
    ];
    return merged.sort((a, b) => a.sortOrder - b.sortOrder);
  },
});
```

**`listAllForOrg`** — usado por la página `/configuracion/subservicios` para
construir el árbol completo.

```ts
export const listAllForOrg = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    const orgScoped = await ctx.db
      .query("subservices")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    const globals = await ctx.db
      .query("subservices")
      .withIndex("by_orgId", (q) => q.eq("orgId", undefined))
      .collect();

    // dedup por (parentServiceId, slug): org-scoped gana
    const key = (s: typeof orgScoped[number]) => `${s.parentServiceId}::${s.slug}`;
    const orgKeys = new Set(orgScoped.map(key));
    return [
      ...orgScoped,
      ...globals.filter((g) => !orgKeys.has(key(g))),
    ].sort((a, b) => a.sortOrder - b.sortOrder);
  },
});
```

**`getById`** — usado por A3 (`selectDeliverableForMonth`) y por el editor de
plantillas A2.

```ts
export const getById = query({
  args: { id: v.id("subservices") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const sub = await ctx.db.get(args.id);
    if (!sub) return null;
    // multi-tenant guard: solo retorna si el subservicio es global o pertenece al org del caller
    if (sub.orgId) {
      const orgId = await getOrgIdSafe(ctx);
      if (sub.orgId !== orgId) return null;
    }
    return sub;
  },
});
```

**`listGlobalsForAdmin`** — usado por `/platform/subservices` (D1). Solo super
admin.

```ts
export const listGlobalsForAdmin = query({
  args: {},
  handler: async (ctx) => {
    try {
      await requireSuperAdmin(ctx);
    } catch {
      return [];
    }
    return await ctx.db
      .query("subservices")
      .withIndex("by_orgId", (q) => q.eq("orgId", undefined))
      .collect();
  },
});
```

### 3.2 Mutations

Archivo `convex/functions/subservices/mutations.ts`. Guard usado: `requireAdmin`
(equivale a `org:admin`; ver `convex/lib/authHelpers.ts:31`). Para mutar
globales (orgId=null) se usa `requireSuperAdmin`.

**`create`** — operador crea subservicio scoped a su org.

```ts
export const create = mutation({
  args: {
    parentServiceId: v.id("services"),
    name: v.string(),
    slug: v.optional(v.string()),  // si se omite, derivado del name
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
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    const parent = await ctx.db.get(args.parentServiceId);
    if (!parent) throw new Error("Servicio padre no encontrado.");

    const slug = args.slug ?? slugify(args.name);

    // unicidad: no duplicar (parent, slug) en este org
    const existing = await ctx.db
      .query("subservices")
      .withIndex("by_parent_slug", (q) =>
        q.eq("parentServiceId", args.parentServiceId).eq("slug", slug)
      )
      .filter((q) => q.eq(q.field("orgId"), orgId))
      .first();
    if (existing) {
      throw new Error(`Ya existe un subservicio "${slug}" bajo ${parent.name} en este org.`);
    }

    const now = Date.now();
    return await ctx.db.insert("subservices", {
      orgId,
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
      isDefault: false,
      sortOrder: args.sortOrder ?? 100,
      createdAt: now,
      updatedAt: now,
    });
    // TODO Z1: emitir documentEvent { type: "created", documentType: "subservice" } cuando exista wrapper.
  },
});
```

**`update`** — patch parcial. Multi-tenant guard estricto.

```ts
export const update = mutation({
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
    }),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    const sub = await ctx.db.get(args.id);
    if (!sub) throw new Error("Subservicio no encontrado.");
    if (sub.orgId !== orgId) {
      // Editar un global desde un org NO se permite en A1.
      // Patrón copy-on-write para subservicios queda fuera de A1 (no es como plantillas, A2).
      // El operador debe primero "Personalizar para mi org" → crea copia org-scoped.
      throw new Error("No puedes editar el catálogo global directamente. Personaliza este subservicio para tu org primero.");
    }
    await ctx.db.patch(args.id, { ...args.patch, updatedAt: Date.now() });
    return args.id;
  },
});
```

**`personalizeGlobal`** — duplica un global en org-scoped (one-shot copy, no
copy-on-write automático al editar).

```ts
export const personalizeGlobal = mutation({
  args: { sourceId: v.id("subservices") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    const source = await ctx.db.get(args.sourceId);
    if (!source) throw new Error("Subservicio fuente no encontrado.");
    if (source.orgId !== undefined) {
      throw new Error("Solo se pueden personalizar subservicios globales.");
    }
    // si ya existe copia org-scoped con mismo slug+parent, devuelve esa
    const existing = await ctx.db
      .query("subservices")
      .withIndex("by_parent_slug", (q) =>
        q.eq("parentServiceId", source.parentServiceId).eq("slug", source.slug)
      )
      .filter((q) => q.eq(q.field("orgId"), orgId))
      .first();
    if (existing) return existing._id;

    const now = Date.now();
    return await ctx.db.insert("subservices", {
      orgId,
      parentServiceId: source.parentServiceId,
      name: source.name,
      slug: source.slug,
      description: source.description,
      defaultFrequency: source.defaultFrequency,
      applicableMonths: source.applicableMonths,
      cooldownMonths: source.cooldownMonths,
      defaultPricingHint: source.defaultPricingHint,
      isCommission: source.isCommission,
      isActive: true,
      isDefault: false,
      sortOrder: source.sortOrder,
      createdAt: now,
      updatedAt: now,
    });
  },
});
```

**`toggleActive`** — soft delete reversible.

```ts
export const toggleActive = mutation({
  args: { id: v.id("subservices") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    const sub = await ctx.db.get(args.id);
    if (!sub) throw new Error("Subservicio no encontrado.");
    if (sub.orgId !== orgId) {
      throw new Error("No puedes desactivar el catálogo global. Personaliza primero.");
    }
    await ctx.db.patch(args.id, {
      isActive: !sub.isActive,
      updatedAt: Date.now(),
    });
    return { id: args.id, isActive: !sub.isActive };
  },
});
```

**`delete`** — hard delete, bloqueado si hay refs activas (R1 §10 R12).

```ts
export const remove = mutation({
  args: { id: v.id("subservices") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    const sub = await ctx.db.get(args.id);
    if (!sub) throw new Error("Subservicio no encontrado.");
    if (sub.orgId !== orgId) {
      throw new Error("No puedes eliminar el catálogo global desde un org.");
    }

    // bloquear si hay refs activas en las 6 tablas
    const blockers: string[] = [];

    const projServices = await ctx.db
      .query("projectionServices")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .filter((q) => q.eq(q.field("subserviceId"), args.id))
      .first();
    if (projServices) blockers.push("una o más proyecciones activas");

    const monthly = await ctx.db
      .query("monthlyAssignments")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .filter((q) => q.eq(q.field("subserviceId"), args.id))
      .first();
    if (monthly) blockers.push("asignaciones mensuales");

    const quotes = await ctx.db
      .query("quotations")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .filter((q) => q.eq(q.field("subserviceId"), args.id))
      .first();
    if (quotes) blockers.push("cotizaciones");

    const contracts = await ctx.db
      .query("contracts")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .filter((q) => q.eq(q.field("subserviceId"), args.id))
      .first();
    if (contracts) blockers.push("contratos");

    const deliv = await ctx.db
      .query("deliverables")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .filter((q) => q.eq(q.field("subserviceId"), args.id))
      .first();
    if (deliv) blockers.push("entregables");

    const tpls = await ctx.db
      .query("deliverableTemplates")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .filter((q) => q.eq(q.field("subserviceId"), args.id))
      .first();
    if (tpls) blockers.push("plantillas");

    if (blockers.length > 0) {
      throw new Error(
        `No se puede eliminar este subservicio. Está referenciado por: ${blockers.join(", ")}. ` +
        `Considera desactivarlo en lugar de eliminarlo.`
      );
    }

    await ctx.db.delete(args.id);
    return { ok: true };
  },
});
```

**Helpers internos en `subservices/mutations.ts`:**

```ts
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")  // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
```

**Eventos:** A1 NO emite a `documentEvents` (esa tabla la introduce A3 §8).
Comentario `TODO Z1: logDocumentEvent` queda en `create`/`update`/`remove`
como hook para A3 cuando el wrapper exista.

### 3.3 Seed

Archivo nuevo `convex/functions/subservices/seed.ts`. Patrón idéntico a
`services/seed.ts:15-33`: `internalMutation`, idempotente, no falla si ya
existe el row global (lookup por `parentServiceId + slug`).

**Catálogo inicial — PENDIENTE VALIDACIÓN PAPÁ.** R1 §12 decisión #15 reserva
0.5 día para refinarlo con su input operativo real. La siguiente lista es la
propuesta de partida; A1 NO corre el seed en prod hasta que papá apruebe.

```ts
import { internalMutation } from "../../_generated/server";

// PENDIENTE VALIDACIÓN PAPÁ — refinar antes del seed final (R1 §12.15).
const DEFAULT_SUBSERVICES: Array<{
  parentName: string;  // matched contra services.name
  name: string;
  slug: string;
  defaultFrequency: "mensual" | "trimestral" | "semestral" | "anual" | "una_vez";
  description?: string;
  isCommission?: boolean;
  sortOrder: number;
}> = [
  // Legal
  { parentName: "Legal", name: "Gobierno Corporativo",   slug: "gobierno-corporativo",   defaultFrequency: "trimestral", sortOrder: 10 },
  { parentName: "Legal", name: "Contratos Mercantiles",  slug: "contratos-mercantiles",  defaultFrequency: "mensual",     sortOrder: 20 },
  { parentName: "Legal", name: "Compliance LFPDPP",      slug: "compliance-lfpdpp",      defaultFrequency: "trimestral", sortOrder: 30 },
  { parentName: "Legal", name: "Propiedad Intelectual",  slug: "propiedad-intelectual",  defaultFrequency: "anual",       sortOrder: 40 },
  { parentName: "Legal", name: "Litigios",                slug: "litigios",                defaultFrequency: "mensual",     sortOrder: 50 },

  // Contable
  { parentName: "Contable", name: "Estados Financieros Mensuales", slug: "estados-financieros-mensuales", defaultFrequency: "mensual",  sortOrder: 10 },
  { parentName: "Contable", name: "Conciliación Bancaria",          slug: "conciliacion-bancaria",          defaultFrequency: "mensual",  sortOrder: 20 },
  { parentName: "Contable", name: "Cierre Anual",                   slug: "cierre-anual",                   defaultFrequency: "anual",    sortOrder: 30 },
  { parentName: "Contable", name: "Reporte SAT",                    slug: "reporte-sat",                    defaultFrequency: "mensual",  sortOrder: 40 },

  // TI
  { parentName: "TI", name: "Diagnóstico",         slug: "diagnostico",         defaultFrequency: "una_vez",   sortOrder: 10 },
  { parentName: "TI", name: "Implementación ERP",  slug: "implementacion-erp",  defaultFrequency: "una_vez",   sortOrder: 20 },
  { parentName: "TI", name: "Soporte Mensual",     slug: "soporte-mensual",     defaultFrequency: "mensual",   sortOrder: 30 },
  { parentName: "TI", name: "Ciberseguridad",      slug: "ciberseguridad",      defaultFrequency: "trimestral", sortOrder: 40 },

  // Marketing
  { parentName: "Marketing", name: "Plan Anual",       slug: "plan-anual",        defaultFrequency: "anual",      sortOrder: 10 },
  { parentName: "Marketing", name: "Redes Sociales",    slug: "redes-sociales",    defaultFrequency: "mensual",    sortOrder: 20 },
  { parentName: "Marketing", name: "Contenido",         slug: "contenido",         defaultFrequency: "mensual",    sortOrder: 30 },
  { parentName: "Marketing", name: "Branding",          slug: "branding",          defaultFrequency: "una_vez",    sortOrder: 40 },
  { parentName: "Marketing", name: "Performance",       slug: "performance",       defaultFrequency: "mensual",    sortOrder: 50 },

  // RH
  { parentName: "RH", name: "Reclutamiento",   slug: "reclutamiento",   defaultFrequency: "mensual",    sortOrder: 10 },
  { parentName: "RH", name: "Nómina",           slug: "nomina",           defaultFrequency: "mensual",    sortOrder: 20 },
  { parentName: "RH", name: "Capacitación",     slug: "capacitacion",     defaultFrequency: "trimestral", sortOrder: 30 },
  { parentName: "RH", name: "Clima Laboral",    slug: "clima-laboral",    defaultFrequency: "semestral",  sortOrder: 40 },

  // Admin
  { parentName: "Admin", name: "Manual Operativo",  slug: "manual-operativo",  defaultFrequency: "una_vez",   sortOrder: 10 },
  { parentName: "Admin", name: "Procesos",          slug: "procesos",          defaultFrequency: "trimestral", sortOrder: 20 },
  { parentName: "Admin", name: "Control Interno",   slug: "control-interno",   defaultFrequency: "trimestral", sortOrder: 30 },

  // Comisiones (comodín, hereda isCommission del padre)
  { parentName: "Comisiones", name: "Cálculo Mensual",     slug: "calculo-mensual",     defaultFrequency: "mensual", isCommission: true, sortOrder: 10 },
  { parentName: "Comisiones", name: "Reporte Comisiones",   slug: "reporte-comisiones",   defaultFrequency: "mensual", isCommission: true, sortOrder: 20 },

  // Logística
  { parentName: "Logística", name: "Rutas",       slug: "rutas",       defaultFrequency: "mensual",    sortOrder: 10 },
  { parentName: "Logística", name: "Inventario",   slug: "inventario",   defaultFrequency: "mensual",    sortOrder: 20 },
  { parentName: "Logística", name: "Almacén",      slug: "almacen",      defaultFrequency: "trimestral", sortOrder: 30 },

  // Construcción
  { parentName: "Construcción", name: "Levantamiento",   slug: "levantamiento",   defaultFrequency: "una_vez", sortOrder: 10 },
  { parentName: "Construcción", name: "Avance de Obra",   slug: "avance-de-obra",   defaultFrequency: "mensual", sortOrder: 20 },
  { parentName: "Construcción", name: "Bitácora",         slug: "bitacora",         defaultFrequency: "mensual", sortOrder: 30 },
];

export const seedDefaultSubservices = internalMutation({
  args: {},
  handler: async (ctx) => {
    const services = await ctx.db
      .query("services")
      .filter((q) => q.eq(q.field("isDefault"), true))
      .collect();
    const byName = new Map(services.map((s) => [s.name, s]));

    let created = 0;
    let skipped = 0;
    const now = Date.now();

    for (const entry of DEFAULT_SUBSERVICES) {
      const parent = byName.get(entry.parentName);
      if (!parent) {
        // si algún padre falta, skip + log
        console.warn(`[seedDefaultSubservices] Padre "${entry.parentName}" no existe; corre seedDefaultServices primero.`);
        continue;
      }

      // idempotencia: skip si ya existe global con mismo (parent, slug)
      const existing = await ctx.db
        .query("subservices")
        .withIndex("by_parent_slug", (q) =>
          q.eq("parentServiceId", parent._id).eq("slug", entry.slug)
        )
        .filter((q) => q.eq(q.field("orgId"), undefined))
        .first();
      if (existing) {
        skipped += 1;
        continue;
      }

      await ctx.db.insert("subservices", {
        orgId: undefined,
        parentServiceId: parent._id,
        name: entry.name,
        slug: entry.slug,
        description: entry.description,
        defaultFrequency: entry.defaultFrequency,
        isCommission: entry.isCommission ?? parent.isCommission ?? false,
        isActive: true,
        isDefault: true,
        sortOrder: entry.sortOrder,
        createdAt: now,
        updatedAt: now,
      });
      created += 1;
    }

    return {
      seeded: created > 0,
      created,
      skipped,
      total: DEFAULT_SUBSERVICES.length,
    };
  },
});
```

**Comando para correr seed en dev:** `npx convex run subservices/seed:seedDefaultSubservices`.
En prod: corre una sola vez vía Convex dashboard una vez papá apruebe el
catálogo final.

---

## 4. Frontend

### 4.1 Página `/configuracion/subservicios`

Ruta nueva: `src/app/(dashboard)/configuracion/subservicios/page.tsx`.

**Layout (ASCII mockup):**

```
┌────────────────────────────────────────────────────────────────────┐
│  Subservicios                                          [+ Padre ▾] │
│  Configura el catálogo de subservicios contractuales de tu org.    │
├────────────────────────────────────────────────────────────────────┤
│ ▼ Legal                                                            │
│   ├ Gobierno Corporativo · trimestral · [global]      [edit][off] │
│   ├ Contratos Mercantiles · mensual    · [global]      [edit][off] │
│   ├ Compliance LFPDPP    · trimestral · [org]         [edit][del] │
│   └ + Agregar subservicio                                          │
│                                                                    │
│ ▼ Contable                                                         │
│   ├ EE.FF. Mensuales      · mensual    · [global]      [edit][off] │
│   ...                                                              │
│                                                                    │
│ ▼ Marketing                                                        │
│   ...                                                              │
└────────────────────────────────────────────────────────────────────┘
```

**Componentes (shadcn/ui):**

- `Card` exterior por cada servicio padre.
- `Accordion` (radix collapsible) — uno por padre.
- `Input` + `Select` (frecuencia) para edit inline. Edit abre un `Drawer` o
  expand inline; cualquiera funciona. Recomendación: `Drawer` desde la
  derecha (consistente con `/configuracion/empresas-emitentes` actual).
- `Button` "+ Agregar subservicio" con prefijo del padre ya seleccionado.
- Badge `global` (variant: outline) vs `org` (variant: default).
- Botón toggle activo/inactivo: `Switch` o `Button` ghost con icon `Eye/EyeOff`.
- Botón eliminar: `Button` ghost variant="destructive" con icon `Trash`. Si
  falla por blockers, el toast muestra el error completo de §3.2 `remove`.
- Botón "Personalizar para mi org" (solo aparece en rows `global`): llama
  `subservices.personalizeGlobal`, refresca; el row aparece ahora como `org`.

**Acciones por row:**

| Estado | Acciones visibles |
|---|---|
| global | "Personalizar para mi org" (icon copy) · expand-only (read) |
| org activo | Edit · Desactivar (toggleActive) · Eliminar (remove, con confirm) |
| org inactivo | Edit · Reactivar (toggleActive) · Eliminar |

**Data fetching:**

```tsx
const subservices = useQuery(api.functions.subservices.queries.listAllForOrg);
const services = useQuery(api.functions.services.queries.listByOrg);
// agrupa subservices[] por parentServiceId, ordena por sortOrder dentro del grupo
```

**Form de edit / create (drawer):**

```
┌─ Editar subservicio ──────────────────┐
│ Servicio padre  [Legal       ▾] (lock)│
│ Nombre          [Gobierno Corporativo]│
│ Slug            [gobierno-corporativo]│  // read-only en edit, editable en create
│ Descripción     [textarea           ] │
│ Frecuencia      [trimestral       ▾] │
│ Meses aplicables [☐1 ☐2 ☐3 ☑4 …]    │  // opcional, default todos
│ Cooldown (meses) [0                 ] │
│ Precio sugerido  [$ MXN              ]│
│ ¿Es comisión?    [ ] hereda del padre │
│ Orden            [10                 ]│
│ [Cancelar]                  [Guardar] │
└───────────────────────────────────────┘
```

Referencia de estilo: `src/app/(dashboard)/servicios/page.tsx` (table) +
`src/app/(dashboard)/configuracion/empresas-emitentes/page.tsx` (drawer
edit). Validación con `react-hook-form` + zod si está disponible; si no,
local state + onBlur validation. No bloquea entrega de A1.

### 4.2 Integración con wizard de proyección

Wizard actual: `src/app/(dashboard)/proyecciones/nueva/page.tsx`.
Step 2 (Servicios) está implementado en líneas 606-667. Renderiza
`serviceStates[]` con `<ServiceRow />` por cada servicio padre activo.

**Decisión 2026-05-20:** wizard dropdown subservicio es **obligatorio** en A1 (decisión confirmada por el dueño — evita deuda heredada a A3). Si un servicio padre tiene subservicios definidos, el operador DEBE elegir uno antes de poder activar el servicio en Step 2. Si el padre no tiene subservicios (caso transitorio durante seed), el sistema permite continuar sin subservicio con warning visible.

Debajo de cada `<ServiceRow />` activo, añadir un `<select>` (o `<Combobox>`
shadcn) con label "Subservicio". Opciones vienen de
`subservices.listByParent({ parentServiceId: svc.serviceId })`. La selección
se guarda en `serviceStates[i].subserviceId`. Validación: bloquea el botón
"Continuar" si algún servicio activo con subservicios disponibles tiene
`subserviceId === undefined`.

```tsx
// Pseudo-código, no es el diff final
const subservices = useQuery(
  api.functions.subservices.queries.listByParent,
  { parentServiceId: svc.serviceId as Id<"services"> }
);

<ServiceRow ... />
{svc.isActive && subservices && subservices.length > 0 && (
  <div className="ml-6 mt-2">
    <label className="text-xs text-muted-foreground">Subservicio (opcional)</label>
    <select
      value={svc.subserviceId ?? ""}
      onChange={(e) => updateServiceState(i, { subserviceId: e.target.value || undefined })}
      className="text-sm rounded border border-border bg-background px-2 py-1"
      required
    >
      <option value="" disabled>— Selecciona subservicio —</option>
      {subservices.map((s) => (
        <option key={s._id} value={s._id}>{s.name} · {s.defaultFrequency}</option>
      ))}
    </select>
  </div>
)}
```

Al submit del wizard (`createMutation` en línea ~265 + 322), pasar
`subserviceId` al payload. La mutation `projections.create` (o equivalente)
debe aceptar el campo opcional en cada service config y propagarlo a
`projectionServices` y a la generación de `monthlyAssignments`.

**Importante:** la selección es **obligatoria** para proyecciones nuevas. La
mutation `projections.create` valida que cada `projectionServices` activo
con subservicios disponibles tenga `subserviceId` set; rechaza si falta.
Proyecciones legacy (preexistentes) siguen operando con `subserviceId=null`
y A3 hace fallback a `serviceId`/`serviceName` solo para esas. El nuevo
camino (proyección nueva → A3 `selectDeliverableForMonth`) usa `subserviceId`
directo, sin fallback.

**N+1 query:** `listByParent` se llama por cada servicio activo (hasta 9 padres).
Convex maneja esto bien por reactive batching. Si causa flash de loading,
prefetch en bulk con `listAllForOrg` una vez en Step 1 y filtrar en memoria.

### 4.3 Visualización en cliente detail

A1 NO modifica `src/app/(dashboard)/clientes/[id]/page.tsx`. El panel
"Servicios contratados" (R1 §6.1) lo introduce B1. A1 solo asegura que el
schema y los queries estén listos para que B1 los consuma sin refactor de
modelo.

Lo que A1 sí garantiza para B1:
- `projectionServices.subserviceId` existe (opcional).
- `subservices.getById` funciona.
- `subservices.listByParent` funciona.
- Catálogo seeded (post papá review).

---

## 5. Migración

### 5.1 Plan de migración (un solo deploy)

1. **Schema PR** — añade tabla `subservices` + campo `subserviceId: v.optional(v.id("subservices"))`
   en las 6 tablas. PR aislado, sin lógica adicional. Convex codegen OK.
2. **Backend PR** — añade `convex/functions/subservices/{queries,mutations,seed}.ts`.
3. **Deploy a Convex dev** + corre tests vitest (mínimo §6).
4. **Validación catálogo con papá** (0.5 día reservado). Ajusta `DEFAULT_SUBSERVICES`
   en `seed.ts`.
5. **Run seed en dev:** `npx convex run subservices/seed:seedDefaultSubservices`.
6. **Verifica:** query `listAllForOrg` retorna ~30 globales; `listByParent({Legal})`
   retorna 5; `getById` con un id válido retorna el row.
7. **UI PR** — añade `src/app/(dashboard)/configuracion/subservicios/page.tsx`
   + (opcional) entry en hub `/configuracion`.
8. **Wizard PR** (obligatorio en A1) — dropdown subservicio en Step 2 con validación que bloquea continuar si falta selección en servicio con subservicios disponibles.
9. **Deploy a prod**. Corre seed en prod una sola vez post papá approval.
10. **Operador empieza a usar.**

### 5.2 Migración de datos existentes

**Decisión:** NO se backfilla `subserviceId` en filas existentes. Queda `null`
para toda fila preexistente en las 6 tablas (`projectionServices`,
`monthlyAssignments`, `quotations`, `contracts`, `deliverables`,
`deliverableTemplates`).

**Comportamiento dual-matching (lo implementa A3 `selectDeliverableForMonth`):**

```ts
// pseudo-código del fallback en A3
const sub = ps.subserviceId ? await ctx.db.get(ps.subserviceId) : null;
if (sub) {
  // path nuevo: usa subservicio
} else {
  // path legacy: usa serviceId + serviceName
}
```

Proyecciones legacy creadas pre-A1 siguen funcionando porque la engine
existente solo lee `serviceId`/`serviceName`. Solo proyecciones nuevas donde
el operador eligió subservicio activan el path nuevo.

**Excepción:** si papá pide explícitamente que ciertos clientes activos sean
"upgradeados" a un subservicio específico (ej. cliente XYZ contrata Legal hoy
de forma genérica, ahora quiere que se trate como "Legal → Gobierno
Corporativo"), se hace backfill manual vía script CLI post-beta. NO entra en
A1. Patrón sugerido:

```ts
// scripts/backfill-subservices.ts (NO entra en A1)
// 1. lista projectionServices del cliente X con subserviceId=null
// 2. para cada uno, lookup subservices.getByParentAndSlug
// 3. patch projectionServices con subserviceId
// 4. también patch monthlyAssignments por by_projServiceId
```

---

## 6. Tests

Archivo nuevo `convex/functions/subservices/queries.test.ts` y
`mutations.test.ts`. Patrón vitest + `convex-test`. Mínimo 12 tests, con
asserts concretos:

**`queries.test.ts` (5):**

1. **`listByParent` retorna globales activos del padre cuando no hay org-scoped.** Setup: seed 5 globales bajo Legal. Assert: `listByParent({Legal})` retorna 5, todos con `orgId === undefined`, ordenados por `sortOrder`.
2. **`listByParent` override: org-scoped reemplaza global con mismo slug.** Setup: 5 globales + 1 org-scoped con slug "compliance-lfpdpp" (mismo que global). Assert: lista retorna 5 items, el de `compliance-lfpdpp` es el org-scoped (`orgId === orgA`), no el global.
3. **`listByParent` filtra inactivos.** Setup: 1 org-scoped activo + 1 org-scoped inactivo. Assert: solo 1 row.
4. **`listAllForOrg` retorna unión global+org con dedup por slug.** Setup: 30 globales + 3 org-scoped (2 override de globales, 1 nuevo). Assert: retorna 31 (30 - 2 reemplazados + 3 org-scoped).
5. **`getById` multi-tenant guard.** Setup: subservice de orgA. Auth como orgB. Assert: retorna `null`. Re-auth como orgA: retorna el row.

**`mutations.test.ts` (5):**

6. **`create` inserta con `orgId` del caller, no del arg.** Setup: auth como orgA, llama `create` sin pasar orgId (la mutation no acepta orgId en args). Assert: row resultante tiene `orgId === orgA`, `isDefault === false`, `slug` derivado del name.
7. **`create` rechaza duplicado por `(parent, slug, orgId)`.** Setup: crea uno. Re-llama con mismo slug. Assert: throws con mensaje conteniendo "Ya existe".
8. **`update` patch parcial.** Setup: crea row con `defaultFrequency: "mensual"`. Patch `{ defaultFrequency: "trimestral" }`. Assert: row resultante tiene `trimestral`, otros campos intactos, `updatedAt > createdAt`.
9. **`remove` bloqueado con refs activas en `projectionServices`.** Setup: crea subservice + un `projectionServices` con `subserviceId` apuntando a él. Assert: `remove` throws con mensaje que incluye "proyecciones activas".
10. **`remove` OK sin refs.** Setup: crea subservice sin refs. Assert: `remove` retorna `{ ok: true }`, `db.get(id)` retorna `null`.

**`seed.test.ts` (2):**

11. **Seed idempotente.** Run `seedDefaultSubservices` dos veces. Assert: primera corrida retorna `created > 0, skipped: 0`; segunda retorna `created: 0, skipped: == created de la primera`.
12. **Seed crea conteo correcto.** Después de correr seed sobre los 9 services seeded de fábrica, assert: `db.query("subservices").collect()` retorna `DEFAULT_SUBSERVICES.length` (32 con catálogo propuesto; puede cambiar tras papá review — el test lee la constante exportada, no hardcodea).

**Extras opcionales (no bloquean DoD pero recomendados):**

13. **`personalizeGlobal` retorna copia existente si ya hay one.** Llamada dos veces sobre el mismo global → segunda retorna el mismo id de la primera, no inserta duplicado.
14. **`update` rechaza editar un global desde un org.** Setup: subservice global, auth org. Assert: throws con "No puedes editar el catálogo global".

---

## 7. Definition of Done

Cada item es booleano. Marcar todos antes de pasar a A2.

- [ ] `convex/schema.ts`: añade tabla `subservices` + índices listados en §2.1.
- [ ] `convex/schema.ts`: añade `subserviceId: v.optional(v.id("subservices"))` en las 6 tablas listadas en §2.2.
- [ ] `npx convex dev` corre sin errores de codegen.
- [ ] `convex/functions/subservices/queries.ts` con `listByParent`, `listAllForOrg`, `getById`, `listGlobalsForAdmin`.
- [ ] `convex/functions/subservices/mutations.ts` con `create`, `update`, `personalizeGlobal`, `toggleActive`, `remove`, helper `slugify`.
- [ ] Multi-tenant guard en todas las queries+mutations (verificado vía test #5).
- [ ] `convex/functions/subservices/seed.ts` con `seedDefaultSubservices` idempotente.
- [ ] Catálogo final validado con papá (0.5 d reservado).
- [ ] Seed corrido en Convex dev; query `listAllForOrg` retorna conteo esperado.
- [ ] `src/app/(dashboard)/configuracion/subservicios/page.tsx` funcional (CRUD básico, no requiere polish exhaustivo).
- [ ] Wizard de proyección Step 2: dropdown subservicio aparece debajo de cada servicio activo, **obligatorio** cuando el padre tiene subservicios. Mutation `projections.create` valida presencia.
- [ ] 12+ tests vitest pasando (`npm test`).
- [ ] `npm run lint` clean.
- [ ] `npx tsc --noEmit` clean.
- [ ] `gitnexus_impact` corrido sobre cada función modificada (engine `selectDeliverableForMonth`, wizard `createProjection`); HIGH/CRITICAL risk reportado en PR.
- [ ] `gitnexus_detect_changes` corrido pre-commit; scope confirma solo `convex/schema.ts`, `convex/functions/subservices/*`, `src/app/(dashboard)/configuracion/subservicios/*`, y opcionalmente wizard.

---

## 8. Riesgos específicos de A1

Aterrizando los riesgos del maestro R1 §10 aplicables a A1:

**R1 (R1.R1 — migración 6 tablas).** Mitigación específica en A1:
- Todos los campos nuevos son `v.optional(...)`. Sin breakage por construcción.
- Tests vitest del engine existente (`convex/lib/projectionEngine.test.ts` si existe) deben seguir verdes sin modificación.
- Queries existentes que filtran por `serviceName` (ej. `findTemplate:48`) NO se modifican en A1 — A3 las refactoriza con dual-matching. Hasta entonces, lecturas siguen funcionando como antes.

**R12 (subservicio borrado mientras tiene refs).** Mitigación en `remove`
(§3.2): query previa en las 6 tablas. UI muestra el error literal. Soft delete
(`toggleActive`) es la opción default en la página; `remove` solo aparece para
rows sin refs (la UI puede pre-validar llamando una hipotética query
`subservices.canDelete` — out of scope, ver §9 Q4).

**R-cascade (nuevo, A1-específico).** Si super admin borra un `services` padre
desde `/platform/servicios`, los `subservices` hijos quedan colgados con FK
inválido. Mitigación: A1 NO añade guard en `services` mutations (cambio invasivo
fuera de alcance). Documentado como deuda; en la práctica los 9 padre nunca se
borran. Si llega a pasar, los rows colgados retornan `null` de `db.get` y la UI
hace skip silencioso.

**R-slug-colisión.** Operador crea "Marketing → Performance" custom mientras
existe global con mismo slug. Mitigación: `create` rechaza duplicado dentro del
mismo `orgId`, pero NO rechaza si el slug existe en global (`orgId=undefined`).
Eso es intencional: es el caso de override esperado. El resolver de
`listByParent` prefiere org-scoped (§3.1), comportamiento correcto.

**R-seed-stale.** Si papá agrega un subservicio nuevo al catálogo después del
beta, el seed no se re-corre automáticamente. Mitigación: seed es idempotente,
se puede re-correr para añadir lo nuevo. Documentado en `seed.ts` como
docstring.

---

## 9. Open questions (a resolver en implementación)

Listadas con recomendación. El implementador puede aceptar la recomendación o
escalarla en el daily.

**Q1.** Si papá quiere renombrar "Marketing → Branding" a "Marketing → Identidad
de Marca", ¿el slug cambia?
**Recomendación:** NO. Slug `branding` se mantiene, solo `name` cambia. Esto
preserva dual-matching histórico y evita migración de filas legacy con
`serviceName: "Branding"`. Si el rename es semánticamente disruptivo (cambio
real de servicio), entonces sí: deprecate el viejo (`isActive: false`) + crea
nuevo con slug distinto.

**Q2.** Si una org borra (toggleActive false) todos los subservicios bajo un
padre, ¿el padre sigue siendo elegible en el wizard?
**Recomendación:** SÍ. El wizard sigue mostrando el padre (los 9 son globales).
El dropdown de subservicio simplemente queda sin opciones; la opción "— Sin
subservicio —" sigue disponible y produce `projectionServices.subserviceId =
undefined` (path legacy).

**Q3.** ¿`isDefault` debería renombrarse a `isGlobal`?
**Recomendación:** Mantener `isDefault` por consistencia con `services` (línea
160). `isDefault: true ↔ orgId === undefined` es invariante; el operador no
necesita distinguir los términos en UI (la UI muestra "global" como label,
nunca el campo crudo).

**Q4.** ¿Vale la pena una query `subservices.canDelete({ id })` para que la UI
pre-deshabilite el botón de eliminar?
**Recomendación:** En A1, NO. La UI muestra el botón siempre y el error de la
mutation cuando falla. Si el operador se frustra con clicks fallidos, agregar
en A2 (junto con copy-on-write de plantillas, mismo patrón). En A1 priorizar
shippeable sobre pulido.

**Q5.** ¿`subservices.create` debería aceptar pasar `parentServiceId` por slug
del padre en lugar de `Id<"services">`?
**Recomendación:** NO. La mutation acepta `Id<"services">` porque el UI ya
tiene el id en mano (viene de `services.listByOrg`). API por id es más
type-safe y consistente con `services` mutations existentes.

### Resoluciones post-Phase-2 (2026-05-20)

- **`applicableMonths` y `cooldownMonths` en drawer UI:** diferidos. El field existe en schema y se puede setear vía Convex dashboard durante beta. UI completa en V3 cuando la frecuencia "trimestral" lo necesite operacionalmente.
- **Version drift banner ("v3 personalizada · v5 global disponible"):** diferido. Hoy `originalVersionAtClone` se snapshea pero la UI no muestra el diff. V3 cuando super admin empiece a editar globales con frecuencia.

---

## 10. Referencias

### 10.1 Archivos del codebase

- `convex/schema.ts:153-166` — `services` padre actual; A1 NO toca.
- `convex/schema.ts:168-180` — `projectionServices`; A1 añade `subserviceId` después de línea 172.
- `convex/schema.ts:182-210` — `monthlyAssignments`; A1 añade `subserviceId` después de línea 187.
- `convex/schema.ts:276-304` — `quotations`; A1 añade `subserviceId` después de línea 280.
- `convex/schema.ts:306-326` — `contracts`; A1 añade `subserviceId` después de línea 311.
- `convex/schema.ts:328-367` — `deliverables`; A1 añade `subserviceId` después de línea 333.
- `convex/schema.ts:407-441` — `deliverableTemplates`; A1 añade `subserviceId` después de línea 410.
- `convex/functions/services/seed.ts:3-13` — `DEFAULT_SERVICES` constante; A1 referencia los 9 `name` para hacer matching en seed de subservicios.
- `convex/functions/services/seed.ts:15-33` — patrón de `seedDefaultServices` idempotente; A1 lo replica.
- `convex/functions/services/queries.ts:1-65` — patrón de queries con `getOrgIdSafe` + `listByOrg` fallback a globales; A1 lo adapta.
- `convex/functions/services/mutations.ts:1-117` — patrón de mutations con `requireAdmin` y `requireSuperAdmin`; A1 lo replica.
- `convex/lib/authHelpers.ts:11-50` — `getOrgId`, `getOrgIdSafe`, `requireAdmin`, `requireSuperAdmin`; A1 usa los 4.
- `src/app/(dashboard)/servicios/page.tsx:1-89` — referencia de estilo para tabla CRUD simple; A1 adapta el patrón.
- `src/app/(dashboard)/configuracion/page.tsx` — hub de config; D2 añade la card "Subservicios" apuntando a `/configuracion/subservicios`.
- `src/app/(dashboard)/proyecciones/nueva/page.tsx:606-667` — Step 2 del wizard; A1 inserta dropdown subservicio **obligatorio** aquí.

### 10.2 Sub-specs relacionados

- `docs/superpowers/specs/2026-05-20-prod-readiness-revision.md` — maestro R1, §2 fija el modelo, §12 fija decisiones.
- `docs/superpowers/specs/2026-05-22-templates-operator-access-design.md` — A2, consumirá `subserviceId` en `deliverableTemplates.serviceId` resolver.
- `docs/superpowers/specs/2026-05-23-document-lifecycle-design.md` — A3, consumirá `subserviceId` en `selectDeliverableForMonth` + dual-matching contra `serviceId/serviceName`.
- `docs/superpowers/specs/2026-05-26-client-services-overview-design.md` — B1, consumirá panel "Servicios contratados" leyendo `projectionServices.subserviceId` + join `subservices`.

### 10.3 Memorias del proyecto

- `project_sprint_v2_timeline` — confirmando 31-may como deadline; A1 termina 2026-05-22 noche para liberar slot a A2.
- `project_cuestionario_unificado` — relacionado pero independiente. A1 NO toca `questionnaireResponses`.

---

**Fin del sub-spec A1.** A2 arranca con plantillas operadora ya con
`deliverableTemplates.subserviceId` en schema y queries de subservicios
disponibles para construir el árbol de su propia página.
