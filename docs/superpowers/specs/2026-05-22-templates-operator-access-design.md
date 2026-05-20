# A2 — Templates Operator Access

**Fecha:** 2026-05-22
**Sub-spec del maestro:** `docs/superpowers/specs/2026-05-20-prod-readiness-revision.md`
**Estado:** propuesto
**Días estimados:** 2 (1 d schema + permisos + queries/mutations, 0.5 d página `/configuracion/plantillas` + editor, 0.5 d snapshot en deliverables + tests)
**Dependencias:** R1 aprobado, A1 (`subservices` tabla + `subserviceId` en `deliverableTemplates`)
**Owner:** Christian

---

## 1. Objetivo

Hoy `deliverableTemplates` está blindado contra el operador: las queries y
mutations llaman `requireSuperAdmin`, la página vive en `/platform/templates`
detrás del badge morado del sidebar, y cualquier intento de edición desde la
org devuelve `[]` o lanza error. Eso obliga al dueño a meterse a la consola
para crear cada plantilla manualmente — bloqueante operativo para el beta del
31-may.

A2 abre el módulo al operador (`org:admin`) con dos garantías:
**multi-tenancy** (org A jamás edita plantillas de org B) y **reproducibilidad
auditable** (un entregable generado en marzo sigue renderizando idéntico
aunque la plantilla se modifique en agosto). El acceso es de tipo *copy-on-
write explícito*: la org ve por defecto la plantilla global, y solo cuando
aprieta "Personalizar para mi org" se crea una copia divergente que ya no
recibe updates del global. La copia muestra banner cuando hay versión nueva
del global disponible, sin pisar la copia.

A2 entrega: refactor de permisos (`requireSuperAdmin` → `requireAdmin` con
guards), schema delta (`subserviceId`, `parentTemplateId`,
`originalVersionAtClone`, enum `"invoice"`, snapshot en `deliverables`),
queries para resolver dual-matching, mutations
`create` / `update` / `personalizeGlobal` / `restoreToGlobal` / `delete`,
página `/configuracion/plantillas` con árbol Servicio→Subservicio→Plantilla,
editor con vista previa y control optimista de concurrencia, snapshot por
valor en cada `deliverable` generado.

A3 consumirá `templates.getResolved` desde `selectDeliverableForMonth` con
dual-matching (subserviceId preferido, fallback a `serviceId`+`serviceName`).
A2 deja todo eso listo en queries pero NO toca `convex/functions/deliverables/`
más allá del snapshot al final del flujo de generación.

---

## 2. Schema

### 2.1 Cambios a `deliverableTemplates`

Diff sobre `convex/schema.ts:407-441`. Tres campos nuevos opcionales + enum
expandido + dos índices nuevos. Nada se elimina.

```ts
deliverableTemplates: defineTable({
  orgId: v.optional(v.string()),                 // EXISTE: null = global, string = org-scoped
  serviceId: v.optional(v.id("services")),       // EXISTE
  serviceName: v.string(),                       // EXISTE (mantener — fallback dual-matching A3)
  subserviceId: v.optional(v.id("subservices")), // AÑADIDO POR A1 (§2.2 de A1); A2 lo consume en resolver
  type: v.union(
    v.literal("quotation"),
    v.literal("contract"),
    v.literal("deliverable_short"),
    v.literal("deliverable_long"),
    v.literal("questionnaire"),
    v.literal("invoice"),                        // NUEVO — R1 decisión #4 (V2-ready, UI lo oculta en beta)
  ),
  name: v.string(),
  htmlTemplate: v.string(),
  variables: v.array(/* sin cambios */),
  version: v.number(),                            // EXISTE — A2 usa para optimistic concurrency (R15)
  isActive: v.boolean(),

  // ─── nuevos en A2 ───────────────────────────────────────────────────────
  parentTemplateId: v.optional(v.id("deliverableTemplates")), // global del que se clonó (null = global o nueva-org)
  originalVersionAtClone: v.optional(v.number()),             // version del global al momento del clone
  // ────────────────────────────────────────────────────────────────────────

  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_orgId", ["orgId"])                                     // EXISTE
  .index("by_serviceId", ["serviceId"])                             // EXISTE
  .index("by_type", ["type"])                                       // EXISTE
  .index("by_orgId_subserviceId", ["orgId", "subserviceId"])        // NUEVO — A2 resolver
  .index("by_parentTemplateId", ["parentTemplateId"]),              // NUEVO — banner "hay v5 global"
```

**Notas de diseño:**

- `parentTemplateId === undefined` invariante para `orgId === undefined` (la
  global no apunta a nada). Para org-scoped clones apunta al global fuente.
  Para org-scoped **creados from-scratch** (operador eligió "+ Nueva plantilla")
  también es `undefined` — el banner "v3 personalizada · v5 global disponible"
  solo aparece cuando hay `parentTemplateId` set.
- `originalVersionAtClone` se setea junto a `parentTemplateId`. Sirve solo
  para el banner: si `globalActual.version > originalVersionAtClone`,
  mostrar aviso.
- `version` se incrementa **solo en `update`** (no en `personalizeGlobal`,
  donde la copia arranca en `version: 1` reset — el linaje vive en
  `parentTemplateId`, no en el contador).
- `serviceName` se mantiene aunque ahora `subserviceId` sea la referencia
  preferida. Razón: dual-matching para plantillas legacy + facilita debug
  en Convex dashboard.

### 2.2 Snapshot en `deliverables`

Diff sobre `convex/schema.ts:328-367`. Tres campos opcionales nuevos.
Backfill `null` para legacy.

```ts
deliverables: defineTable({
  orgId: v.string(),
  assignmentId: v.id("monthlyAssignments"),
  projServiceId: v.id("projectionServices"),
  clientId: v.id("clients"),
  serviceName: v.string(),
  subserviceId: v.optional(v.id("subservices")),  // AÑADIDO POR A1
  month: v.number(),
  year: v.number(),
  shortContent: v.string(),
  longContent: v.string(),
  shortPdfStorageId: v.optional(v.id("_storage")),
  longPdfStorageId: v.optional(v.id("_storage")),

  // ─── snapshot por valor (A2) ────────────────────────────────────────────
  templateId: v.optional(v.id("deliverableTemplates")),  // referencia al row usado (mutable)
  templateVersion: v.optional(v.number()),                // snapshot numérico
  templateHtmlSnapshot: v.optional(v.string()),           // HTML congelado al momento de generación
  // ────────────────────────────────────────────────────────────────────────

  auditStatus: /* sin cambios */,
  auditFeedback: v.optional(v.string()),
  retryCount: v.number(),
  aiLog: /* sin cambios */,
  deliveredAt: v.optional(v.number()),
  createdAt: v.number(),
})
  // índices existentes intactos; nuevo opcional:
  .index("by_templateId", ["templateId"]),  // para "qué deliverables usan esta plantilla" en banner
```

**¿Snapshotear también las variables?** No. Las `variables[]` definen
metadata para el editor (qué placeholder existe, de qué fuente sale, si es
required). Lo que el deliverable necesita reproducir es el HTML resuelto en
ese momento — y el HTML snapshot ya contiene los `{{placeholder}}` originales.
Re-renderizar el deliverable significa pasar el `templateHtmlSnapshot` por el
mismo `templateResolver` con el contexto histórico (cliente, proyección,
respuestas). El array `variables` actual de la plantilla puede divergir sin
romper el deliverable histórico.

**Tamaño esperado:** R1 §10 R10 acepta hasta ~10K deliverables × ~50KB HTML
≈ 500MB. Convex maneja eso sin problema. Dedup por hash se difiere a junio
(`deliverableTemplateSnapshots` separada, fuera de alcance).

### 2.3 Backfill / migración

Todos los campos nuevos son `v.optional(...)`. Codegen pasa sin breakage.
Filas legacy:

| Tabla | Campos nuevos | Valor backfill |
|---|---|---|
| `deliverableTemplates` | `subserviceId` (de A1), `parentTemplateId`, `originalVersionAtClone` | `undefined` |
| `deliverables` | `subserviceId` (de A1), `templateId`, `templateVersion`, `templateHtmlSnapshot` | `undefined` |

Deliverables generados antes de A2 NO se pueden re-renderizar 1:1 (no hay
snapshot). Se aceptan tal cual están — el PDF físico ya fue subido a Railway
y eso es el record de verdad. Solo los generados desde A2 en adelante son
reproducibles desde Convex puro.

### 2.4 Convex no tiene constraints únicos

Misma situación que A1 §2.3. Invariantes a preservar a nivel mutation:

| Invariante | Estrategia |
|---|---|
| Un org no debería tener dos clones del mismo global | `personalizeGlobal` busca por `by_parentTemplateId` filtrando `orgId === caller` antes de insertar; si existe, devuelve el existente. |
| `parentTemplateId` apunta a un row con `orgId === undefined` | Validar en `personalizeGlobal` antes del insert. Si el "fuente" no es global, throw. |
| `version` monotónica creciente por row | Garantizado por `update` que siempre patch `version: existing.version + 1`. |
| `expectedVersion === currentVersion` en update | Pre-check en `update` antes del patch (R15). |

---

## 3. Backend

### 3.1 Refactor de permisos

**Estado actual** (`convex/functions/deliverableTemplates/mutations.ts:38,68,93,113`
y `queries.ts:21,67`):

| Función | Guard actual | Resultado para operador |
|---|---|---|
| `queries.list` | `requireSuperAdmin` (try/catch → `[]`) | Página queda vacía. |
| `queries.getById` | `requireSuperAdmin` (try/catch → `null`) | No puede leer. |
| `mutations.create` | `requireSuperAdmin` | Throws "Acceso denegado". |
| `mutations.update` | `requireSuperAdmin` | Throws. |
| `mutations.toggleActive` | `requireSuperAdmin` | Throws. |
| `mutations.duplicate` | `requireSuperAdmin` | Throws. |

**Estado nuevo (A2):**

| Función | Guard nuevo | Comportamiento |
|---|---|---|
| `queries.list` | `requireAuth` + filtra por orgId | Globales activos + org-scoped del caller. Sigue existiendo modo super-admin (sin filtro) si caller es super admin. |
| `queries.listForOrg` | NUEVA — `requireAuth` | Lo que el árbol de `/configuracion/plantillas` consume. Agrupado conceptualmente, ordenado por orgId-precedence. |
| `queries.getResolved` | NUEVA — `requireAuth` | Dual-matching para A3 `selectDeliverableForMonth`. |
| `queries.getByIdWithBanner` | NUEVA — `requireAuth` + guard org | Devuelve template + flag `hasNewerGlobal`. |
| `queries.getById` | `requireAuth` + guard org | Para edit. Rechaza si `template.orgId && template.orgId !== caller.orgId`. |
| `mutations.create` | `requireAdmin` (operador) | Fuerza `orgId = caller.orgId`. Super-admin con role `super_admin` puede pasar `orgId: undefined` para crear global. |
| `mutations.update` | `requireAdmin` + guard org-scope | Rechaza si `template.orgId === undefined` y caller no es super-admin. Verifica `expectedVersion`. Verifica placeholders. |
| `mutations.personalizeGlobal` | NUEVA — `requireAdmin` | Clona global a org-scoped. Idempotente. |
| `mutations.restoreToGlobal` | NUEVA — `requireAdmin` | Borra el clon org-scoped; el resolver vuelve a apuntar al global. |
| `mutations.toggleActive` | `requireAdmin` + guard org-scope | Solo permite toggle sobre rows del propio org. Rechaza globales. |
| `mutations.delete` (rename de `remove`) | `requireAdmin` + guard org-scope | Hard delete solo de org-scoped. Si hay deliverables con `templateId` apuntando, soft-delete (`isActive = false`) en lugar de hard. |
| `mutations.duplicate` | `requireSuperAdmin` | Se mantiene solo para super-admin (caso "duplicar global como otro global"). El operador usa `personalizeGlobal`. |

Helper nuevo `convex/lib/templateAccess.ts`:

```ts
import { QueryCtx, MutationCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import { getOrgId, requireAdmin, requireSuperAdmin } from "./authHelpers";

/**
 * Verifica que el caller pueda editar el template.
 * - Global (orgId=undefined): solo super_admin.
 * - Org-scoped: solo si caller.orgId === template.orgId.
 */
export async function requireTemplateEditAccess(
  ctx: MutationCtx,
  template: Doc<"deliverableTemplates">,
): Promise<void> {
  if (template.orgId === undefined) {
    await requireSuperAdmin(ctx);
    return;
  }
  await requireAdmin(ctx);
  const callerOrg = await getOrgId(ctx);
  if (template.orgId !== callerOrg) {
    throw new Error("No puedes editar plantillas de otra organización.");
  }
}

/** Lectura: caller puede ver template si es global o pertenece a su org. */
export async function canReadTemplate(
  ctx: QueryCtx,
  template: Doc<"deliverableTemplates">,
  callerOrgId: string | null,
): Promise<boolean> {
  if (template.orgId === undefined) return true; // global readable a todos los autenticados
  return template.orgId === callerOrgId;
}
```

### 3.2 Queries

Archivo modificado `convex/functions/deliverableTemplates/queries.ts`.

**`list` (refactor):** abre a operadores con filtro por orgId.

```ts
export const list = query({
  args: {
    type: v.optional(typeValidator),
    serviceId: v.optional(v.id("services")),
    subserviceId: v.optional(v.id("subservices")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const orgId = await getOrgIdSafe(ctx);
    const isSuper =
      ((identity.publicMetadata as Record<string, unknown> | undefined)?.role) ===
      "super_admin";

    // Pick narrowest index available
    let base;
    if (args.type) {
      base = ctx.db
        .query("deliverableTemplates")
        .withIndex("by_type", (q) => q.eq("type", args.type!));
    } else if (args.serviceId) {
      base = ctx.db
        .query("deliverableTemplates")
        .withIndex("by_serviceId", (q) => q.eq("serviceId", args.serviceId!));
    } else {
      base = ctx.db.query("deliverableTemplates");
    }

    const all = await base.collect();

    return all.filter((t) => {
      if (args.subserviceId && t.subserviceId !== args.subserviceId) return false;
      if (isSuper) return true;                  // super-admin ve todo
      if (t.orgId === undefined) return true;    // globales
      return t.orgId === orgId;                  // o de su org
    });
  },
});
```

**`listForOrg` (nueva):** lo que la página `/configuracion/plantillas`
renderiza. Devuelve globales activos + org-scoped del org, **dedupeados por
`parentTemplateId`** (si hay clon, no muestres el global original).

```ts
export const listForOrg = query({
  args: { subserviceId: v.optional(v.id("subservices")) },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    const orgScoped = await ctx.db
      .query("deliverableTemplates")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    const globals = await ctx.db
      .query("deliverableTemplates")
      .withIndex("by_orgId", (q) => q.eq("orgId", undefined))
      .collect();

    // 1. set de globalIds que YA fueron personalizados por este org
    const personalizedGlobalIds = new Set(
      orgScoped
        .filter((t) => t.parentTemplateId)
        .map((t) => t.parentTemplateId as Id<"deliverableTemplates">),
    );

    // 2. globales que sobreviven = no personalizados + activos
    const survivingGlobals = globals.filter(
      (g) => g.isActive && !personalizedGlobalIds.has(g._id),
    );

    // 3. merge
    let merged = [...orgScoped.filter((t) => t.isActive), ...survivingGlobals];

    if (args.subserviceId) {
      merged = merged.filter((t) => t.subserviceId === args.subserviceId);
    }

    return merged;
  },
});
```

**`getResolved` (nueva):** consumidor primario A3. Dual-matching.

```ts
export const getResolved = query({
  args: {
    type: v.union(
      v.literal("deliverable_short"),
      v.literal("deliverable_long"),
      v.literal("quotation"),
      v.literal("contract"),
    ),
    subserviceId: v.optional(v.id("subservices")),
    serviceId: v.optional(v.id("services")),
    serviceName: v.optional(v.string()), // fallback dual-matching para legacy
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const orgId = await getOrgIdSafe(ctx);

    const candidates = await ctx.db
      .query("deliverableTemplates")
      .withIndex("by_type", (q) => q.eq("type", args.type))
      .collect();

    const active = candidates.filter((t) => t.isActive);

    // 1. preferir match por subserviceId + orgId (operador personalizó)
    if (args.subserviceId) {
      const orgSub = active.find(
        (t) => t.subserviceId === args.subserviceId && t.orgId === orgId,
      );
      if (orgSub) return orgSub;

      // 2. fallback: subserviceId + global
      const globalSub = active.find(
        (t) => t.subserviceId === args.subserviceId && t.orgId === undefined,
      );
      if (globalSub) return globalSub;
    }

    // 3. fallback legacy: serviceId + orgId
    if (args.serviceId) {
      const orgSvc = active.find(
        (t) =>
          t.serviceId === args.serviceId &&
          t.orgId === orgId &&
          !t.subserviceId,
      );
      if (orgSvc) return orgSvc;

      const globalSvc = active.find(
        (t) =>
          t.serviceId === args.serviceId &&
          t.orgId === undefined &&
          !t.subserviceId,
      );
      if (globalSvc) return globalSvc;
    }

    // 4. fallback puro por serviceName (legacy)
    if (args.serviceName) {
      const orgName = active.find(
        (t) => t.serviceName === args.serviceName && t.orgId === orgId,
      );
      if (orgName) return orgName;

      const globalName = active.find(
        (t) => t.serviceName === args.serviceName && t.orgId === undefined,
      );
      if (globalName) return globalName;
    }

    return null;
  },
});
```

**`getByIdWithBanner` (nueva):** el editor llama esta y obtiene la metadata
del banner.

```ts
export const getByIdWithBanner = query({
  args: { id: v.id("deliverableTemplates") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const tpl = await ctx.db.get(args.id);
    if (!tpl) return null;

    const orgId = await getOrgIdSafe(ctx);
    if (tpl.orgId && tpl.orgId !== orgId) return null;

    let hasNewerGlobal = false;
    let globalVersion: number | null = null;
    let globalName: string | null = null;

    if (tpl.parentTemplateId && tpl.originalVersionAtClone !== undefined) {
      const parent = await ctx.db.get(tpl.parentTemplateId);
      if (parent && parent.version > tpl.originalVersionAtClone) {
        hasNewerGlobal = true;
        globalVersion = parent.version;
        globalName = parent.name;
      }
    }

    return { template: tpl, hasNewerGlobal, globalVersion, globalName };
  },
});
```

### 3.3 Mutations

Archivo `convex/functions/deliverableTemplates/mutations.ts`.

**`create` (refactor):**

```ts
export const create = mutation({
  args: {
    serviceId: v.optional(v.id("services")),
    serviceName: v.string(),
    subserviceId: v.optional(v.id("subservices")),
    type: typeValidator,                              // ahora incluye "invoice"
    name: v.string(),
    htmlTemplate: v.string(),
    variables: v.array(variableValidator),
    isActive: v.boolean(),
    // SOLO super-admin puede pasar orgId explícito (incluyendo undefined = global)
    orgId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireAuth(ctx);
    const isSuper =
      ((identity.publicMetadata as Record<string, unknown> | undefined)?.role) ===
      "super_admin";

    let resolvedOrgId: string | undefined;
    if (isSuper) {
      resolvedOrgId = args.orgId; // super puede crear global (undefined) o forzar otra org
    } else {
      await requireAdmin(ctx);
      resolvedOrgId = await getOrgId(ctx); // operador SIEMPRE org-scoped al suyo
      if (args.orgId !== undefined && args.orgId !== resolvedOrgId) {
        throw new Error("No puedes crear plantillas para otra organización.");
      }
    }

    validatePlaceholdersDeclared(args.htmlTemplate, args.variables);

    const now = Date.now();
    return await ctx.db.insert("deliverableTemplates", {
      orgId: resolvedOrgId,
      serviceId: args.serviceId,
      serviceName: args.serviceName,
      subserviceId: args.subserviceId,
      type: args.type,
      name: args.name,
      htmlTemplate: args.htmlTemplate,
      variables: args.variables,
      version: 1,
      isActive: args.isActive,
      parentTemplateId: undefined,
      originalVersionAtClone: undefined,
      createdAt: now,
      updatedAt: now,
    });
  },
});
```

**`update` (refactor) — concurrencia R15 + validación R6:**

```ts
export const update = mutation({
  args: {
    id: v.id("deliverableTemplates"),
    expectedVersion: v.number(),                       // R15
    patch: v.object({
      name: v.optional(v.string()),
      htmlTemplate: v.optional(v.string()),
      variables: v.optional(v.array(variableValidator)),
      serviceName: v.optional(v.string()),
      serviceId: v.optional(v.id("services")),
      subserviceId: v.optional(v.id("subservices")),
      type: v.optional(typeValidator),
      isActive: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    const tpl = await ctx.db.get(args.id);
    if (!tpl) throw new Error("Plantilla no encontrada.");

    await requireTemplateEditAccess(ctx, tpl);

    // concurrencia optimista
    if (tpl.version !== args.expectedVersion) {
      throw new Error(
        `Versión obsoleta: la plantilla cambió a v${tpl.version} mientras editabas (esperabas v${args.expectedVersion}). Recargá los cambios.`,
      );
    }

    // validación de placeholders si htmlTemplate o variables cambian
    const nextHtml = args.patch.htmlTemplate ?? tpl.htmlTemplate;
    const nextVars = args.patch.variables ?? tpl.variables;
    validatePlaceholdersDeclared(nextHtml, nextVars);

    await ctx.db.patch(args.id, {
      ...args.patch,
      version: tpl.version + 1,
      updatedAt: Date.now(),
    });
    return args.id;
  },
});
```

**`personalizeGlobal` (nueva):** clona global a org-scoped.

```ts
export const personalizeGlobal = mutation({
  args: { globalTemplateId: v.id("deliverableTemplates") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);

    const source = await ctx.db.get(args.globalTemplateId);
    if (!source) throw new Error("Plantilla fuente no encontrada.");
    if (source.orgId !== undefined) {
      throw new Error("Solo se pueden personalizar plantillas globales.");
    }

    // idempotencia: si ya existe clon del mismo global para este org, devuélvelo
    const existing = await ctx.db
      .query("deliverableTemplates")
      .withIndex("by_parentTemplateId", (q) =>
        q.eq("parentTemplateId", args.globalTemplateId),
      )
      .filter((q) => q.eq(q.field("orgId"), orgId))
      .first();
    if (existing) return existing._id;

    const now = Date.now();
    return await ctx.db.insert("deliverableTemplates", {
      orgId,
      serviceId: source.serviceId,
      serviceName: source.serviceName,
      subserviceId: source.subserviceId,
      type: source.type,
      name: source.name,
      htmlTemplate: source.htmlTemplate,
      variables: source.variables,
      version: 1,                              // reset — linaje vive en parentTemplateId
      isActive: source.isActive,
      parentTemplateId: source._id,
      originalVersionAtClone: source.version,
      createdAt: now,
      updatedAt: now,
    });
  },
});
```

**`restoreToGlobal` (nueva):** borra el clon org-scoped. El resolver vuelve
a apuntar al global automáticamente porque `listForOrg` deduplica por
`parentTemplateId`.

```ts
export const restoreToGlobal = mutation({
  args: { orgTemplateId: v.id("deliverableTemplates") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);

    const tpl = await ctx.db.get(args.orgTemplateId);
    if (!tpl) throw new Error("Plantilla no encontrada.");
    if (tpl.orgId !== orgId) {
      throw new Error("No puedes restaurar una plantilla de otra organización.");
    }
    if (!tpl.parentTemplateId) {
      throw new Error(
        "Esta plantilla no se basa en una global. No hay default al cual restaurar.",
      );
    }

    // bloquea si hay deliverables generados (snapshot ya cubre el histórico,
    // pero el operador puede preferir soft-delete para no perder referencias).
    const deliv = await ctx.db
      .query("deliverables")
      .withIndex("by_templateId", (q) => q.eq("templateId", args.orgTemplateId))
      .first();
    if (deliv) {
      // soft-delete: deja la fila pero inactiva, así el resolver la ignora
      // y `listForOrg` deja de mostrarla (deduplicación se reactiva).
      await ctx.db.patch(args.orgTemplateId, {
        isActive: false,
        updatedAt: Date.now(),
      });
      return { mode: "soft" as const, id: args.orgTemplateId };
    }

    await ctx.db.delete(args.orgTemplateId);
    return { mode: "hard" as const, id: args.orgTemplateId };
  },
});
```

**`toggleActive` (refactor):**

```ts
export const toggleActive = mutation({
  args: { id: v.id("deliverableTemplates") },
  handler: async (ctx, args) => {
    const tpl = await ctx.db.get(args.id);
    if (!tpl) throw new Error("Plantilla no encontrada.");
    await requireTemplateEditAccess(ctx, tpl);
    await ctx.db.patch(args.id, {
      isActive: !tpl.isActive,
      updatedAt: Date.now(),
    });
    return args.id;
  },
});
```

**`delete` (rename + refactor — usa `remove` por convención A1):**

```ts
export const remove = mutation({
  args: { id: v.id("deliverableTemplates") },
  handler: async (ctx, args) => {
    const tpl = await ctx.db.get(args.id);
    if (!tpl) throw new Error("Plantilla no encontrada.");
    await requireTemplateEditAccess(ctx, tpl);

    // operador NO puede hard-delete globales (ya bloqueado por requireTemplateEditAccess
    // que llama requireSuperAdmin si orgId=undefined; pero defensivo extra):
    if (tpl.orgId === undefined) {
      throw new Error(
        "No se pueden eliminar plantillas globales. Soft-delete vía toggleActive.",
      );
    }

    // si hay deliverables apuntando, soft-delete obligatorio
    const deliv = await ctx.db
      .query("deliverables")
      .withIndex("by_templateId", (q) => q.eq("templateId", args.id))
      .first();
    if (deliv) {
      await ctx.db.patch(args.id, { isActive: false, updatedAt: Date.now() });
      return { mode: "soft" as const, id: args.id };
    }

    await ctx.db.delete(args.id);
    return { mode: "hard" as const, id: args.id };
  },
});
```

**Helper `validatePlaceholdersDeclared` (interno):**

```ts
function validatePlaceholdersDeclared(
  html: string,
  vars: Array<{ key: string }>,
): void {
  const declared = new Set(vars.map((v) => v.key));
  const found = extractPlaceholders(html); // reutilizar helper existente de templateResolver
  const undeclared = found.filter((k) => !declared.has(k));
  if (undeclared.length > 0) {
    throw new Error(
      `Placeholders no declarados en variables[]: ${undeclared.join(", ")}. ` +
        `Agregalos a la lista de variables o quítalos del HTML.`,
    );
  }
}
```

> El helper `extractPlaceholders` ya existe en `src/lib/templateResolver.ts`
> (lo usa la página actual `/platform/templates`). A2 lo extrae a un módulo
> compartible bajo `convex/lib/templatePlaceholders.ts` para que la mutation
> también lo use sin depender de `src/`. Implementación idéntica: regex
> `/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g`.

### 3.4 Validación pre-save (R6 explícito)

Tres reglas que `update` enforce:

1. **Concurrencia (R15):** `expectedVersion === currentVersion`. Si no,
   error con texto que el banner UI mapea a "alguien más editó, recargá".
2. **Placeholders declarados (R6):** cada `{{key}}` del HTML debe existir en
   `variables[].key`. La regex es estricta: sin espacios extras adentro,
   match insensible a whitespace alrededor del nombre.
3. **Tipo `"invoice"`:** se acepta a nivel schema pero la UI lo oculta en
   `/configuracion/plantillas` y solo aparece para super-admin en
   `/platform/templates`. No bloquea creación si se hace por mutation directa
   (V2-ready).

---

## 4. Frontend

### 4.1 Página `/configuracion/plantillas`

Ruta nueva: `src/app/(dashboard)/configuracion/plantillas/page.tsx`.

**Layout (ASCII):**

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Plantillas                                            [Tipo ▾] [Buscar]│
│  Edita las plantillas que tu org usa para generar documentos.           │
├─────────────────────────────────────────────────────────────────────────┤
│ ▼ Legal                                                                 │
│   ▶ Gobierno Corporativo                                                │
│       ├ Cotización · v3 · [Global]       [Personalizar para mi org]    │
│       ├ Entregable Corto · v5 · [Personalizada]   [Editar] [↺ default] │
│       │   ⚠ v3 personalizada · v8 global disponible. [Ver cambios]     │
│       └ + Nueva plantilla                                               │
│   ▶ Compliance LFPDPP                                                   │
│       └ Cotización · v1 · [Global]       [Personalizar para mi org]    │
│                                                                         │
│ ▶ Contable                                                              │
│ ▶ Marketing                                                             │
│ ▶ RH                                                                    │
└─────────────────────────────────────────────────────────────────────────┘
```

**Componentes (shadcn/ui):**

- `Card` exterior (uno por servicio padre) con `Accordion` colapsable.
- Dentro de cada padre, lista de subservicios (sub-`Accordion`).
- Bajo cada subservicio, lista de plantillas con:
  - `Badge` "Global" (variant `outline`, color neutro) o "Personalizada"
    (variant `default`, color accent).
  - `Badge` chip por tipo: `Cotización`, `Contrato`, `Entregable Corto`,
    `Entregable Largo`, `Cuestionario`. Tipo `Factura` se oculta en operador
    en beta (UI flag, no schema).
  - Texto `v{version}` al lado del nombre.
  - Si `template.orgId === undefined` (global): botón primario "Personalizar
    para mi org" (icon `Copy`) → llama `personalizeGlobal` → router push a
    `/configuracion/plantillas/{nuevoId}`. Toast "Plantilla personalizada.
    Tus cambios ya no afectarán a otras organizaciones."
  - Si `template.orgId === callerOrgId` (personalizada): botón "Editar" →
    push a `/configuracion/plantillas/{id}`. Botón ghost destructive
    "↺ Restaurar default" con confirm dialog.
- Si la plantilla personalizada tiene `hasNewerGlobal: true`, banner inline
  amarillo: "v3 personalizada · v8 global disponible." + botón link "Ver
  cambios" (en beta: abre modal con HTML del global; merge real diferido).
- Botón "+ Nueva plantilla" por subservicio → modal con form de create
  (precarga `serviceId`, `subserviceId`, `serviceName`).

**Data fetching:**

```tsx
const services = useQuery(api.functions.services.queries.listByOrg);
const subservices = useQuery(api.functions.subservices.queries.listAllForOrg);
const templates = useQuery(api.functions.deliverableTemplates.queries.listForOrg, {});

// build árbol en memoria
const tree = useMemo(() => {
  if (!services || !subservices || !templates) return null;
  return services.map((svc) => ({
    service: svc,
    subservices: subservices
      .filter((sub) => sub.parentServiceId === svc._id)
      .map((sub) => ({
        subservice: sub,
        templates: templates.filter((t) => t.subserviceId === sub._id),
      })),
  }));
}, [services, subservices, templates]);
```

**Manejo de "Personalizar para mi org":**

```tsx
const personalize = useMutation(api.functions.deliverableTemplates.mutations.personalizeGlobal);

async function onPersonalize(globalId: Id<"deliverableTemplates">) {
  try {
    const newId = await personalize({ globalTemplateId: globalId });
    toast.success("Plantilla personalizada para tu organización.");
    router.push(`/configuracion/plantillas/${newId}`);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Error al personalizar");
  }
}
```

**Estilo base:** matchear `src/app/platform/templates/page.tsx` (cards
border-border, bg-card, accent en primary actions) + accordion patrón de
`src/app/(dashboard)/configuracion/empresas-emitentes/page.tsx`.

### 4.2 Editor de plantilla

Ruta nueva: `src/app/(dashboard)/configuracion/plantillas/[id]/page.tsx`.

**Layout (ASCII):**

```
┌─ Editar plantilla · Marketing → Plan Anual · Entregable Corto ─────────┐
│ ⚠ v5 personalizada · v8 global disponible. [Ver diff con global]       │
├────────────────────────────────────────────────────┬────────────────────┤
│ HTML                                               │ Variables (5)      │
│ ┌───────────────────────────────────────────────┐  │ ┌────────────────┐ │
│ │ <h1>Plan Anual para {{client_name}}</h1>     │  │ client_name    │ │
│ │ <p>Industria: {{industry}}</p>                │  │ industry       │ │
│ │ <p>Período: {{period}}</p>                    │  │ period         │ │
│ │ <p>Inversión: ${{annual_amount}}</p>          │  │ annual_amount  │ │
│ │ ... {{ai_strategy}}                            │  │ ai_strategy    │ │
│ │                                                │  │                │ │
│ │ (textarea simple, monospace)                  │  │ [+ Variable]   │ │
│ └───────────────────────────────────────────────┘  │                │ │
│                                                    │ ⚠ {{unknown_x}} │ │
│                                                    │   no declarado  │ │
│ [Vista previa]              [Cancelar] [Guardar]   │                │ │
└────────────────────────────────────────────────────┴────────────────────┘
```

**Decisiones de implementación:**

- **Editor:** `<textarea>` simple con `font-mono` y `rows={20}`. Razón:
  Monaco agrega ~500KB al bundle, beta no lo necesita. Open question Q1 — si
  el dueño insiste en syntax highlight, usar `react-simple-code-editor` +
  `prismjs` (~50KB). Decisión post-beta.
- **Auto-extract de placeholders:** efecto que parsea `htmlTemplate` con
  `extractPlaceholders` y compara contra `variables[].key`. Muestra warning
  inline para cualquier `{{key}}` no declarado.
- **Vista previa:** botón "Vista previa" abre modal con HTML resuelto vía
  `resolveTemplate` (función existente en `src/lib/templateResolver.ts`).
  Render dentro de `<iframe sandbox="allow-same-origin">` para aislar
  estilos. NO usa puppeteer en el editor — la previa es de fidelidad media,
  la fidelidad alta es el PDF generado en producción.
- **Guardar:** llama `update` con `expectedVersion` leído del estado inicial.
  Si la mutation throws con mensaje "Versión obsoleta", muestra banner rojo
  "Alguien más editó esta plantilla. Recargá los cambios." + botón "Recargar"
  que re-hace el `getByIdWithBanner` y descarta cambios locales.
- **Cancelar:** confirm si hay cambios sin guardar. Vuelve a
  `/configuracion/plantillas`.

**Esqueleto del componente:**

```tsx
"use client";
import { useQuery, useMutation } from "convex/react";
import { useState, useEffect } from "react";
import { api } from "@/convex/_generated/api";
import { extractPlaceholders, resolveTemplate, generateSampleContext } from "@/lib/templateResolver";

export default function EditorPage({ params }: { params: { id: string } }) {
  const data = useQuery(api.functions.deliverableTemplates.queries.getByIdWithBanner, {
    id: params.id as Id<"deliverableTemplates">,
  });
  const update = useMutation(api.functions.deliverableTemplates.mutations.update);

  const [form, setForm] = useState<FormState | null>(null);
  const [savedVersion, setSavedVersion] = useState<number | null>(null);
  const [staleError, setStaleError] = useState(false);

  useEffect(() => {
    if (data?.template && !form) {
      setForm({
        name: data.template.name,
        htmlTemplate: data.template.htmlTemplate,
        variables: data.template.variables,
        serviceName: data.template.serviceName,
        type: data.template.type,
      });
      setSavedVersion(data.template.version);
    }
  }, [data?.template, form]);

  if (!data) return <Loading />;
  if (data === null) return <NotFound />;

  // detectar placeholders no declarados (warning, no bloquea typing)
  const declared = new Set(form?.variables.map((v) => v.key) ?? []);
  const found = form ? extractPlaceholders(form.htmlTemplate) : [];
  const undeclared = found.filter((k) => !declared.has(k));

  async function handleSave() {
    if (!form || savedVersion === null) return;
    try {
      await update({
        id: params.id as Id<"deliverableTemplates">,
        expectedVersion: savedVersion,
        patch: {
          name: form.name,
          htmlTemplate: form.htmlTemplate,
          variables: form.variables,
          serviceName: form.serviceName,
          type: form.type,
        },
      });
      toast.success("Cambios guardados.");
      router.push("/configuracion/plantillas");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error";
      if (msg.includes("Versión obsoleta")) {
        setStaleError(true);
      } else {
        toast.error(msg);
      }
    }
  }

  return (
    <div className="space-y-4">
      {data.hasNewerGlobal && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 text-sm">
          v{savedVersion} personalizada · v{data.globalVersion} global disponible.
          <button className="ml-2 underline">Ver cambios</button>
        </div>
      )}
      {staleError && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm">
          Otro usuario editó esta plantilla mientras trabajabas. Recargá los
          cambios para continuar.
          <button onClick={() => location.reload()} className="ml-2 underline">
            Recargar
          </button>
        </div>
      )}
      {/* ... editor grid ... */}
    </div>
  );
}
```

### 4.3 Integración con sidebar y hub `/configuracion`

**Sidebar:** NO se agrega entrada directa a `/configuracion/plantillas`. La
entrada "Configuración" actual (`src/components/layout/sidebar.tsx:34`) sigue
siendo el hub. Plantillas queda como card dentro del hub.

**Hub `/configuracion` (`src/app/(dashboard)/configuracion/page.tsx`):**
añadir card nueva.

```tsx
const sections = [
  // ... existentes
  {
    href: "/configuracion/plantillas",
    icon: FileText, // de lucide-react
    title: "Plantillas",
    description:
      "Edita las plantillas que tu org usa para entregables, cotizaciones y contratos.",
  },
];
```

> D2 (`2026-05-28-org-admin-panels-design.md`) expandirá el hub a 9 cards.
> A2 solo añade esta una.

### 4.4 Wizard / paginación NO se modifica

A2 NO toca el wizard de proyección ni la página `/platform/templates`. La
super-admin page sigue existiendo intacta (super_admin necesita poder editar
los globales). El wizard ya tiene `subserviceId` integrado por A1, A2 solo
consume `templates.getResolved` desde A3.

---

## 5. Snapshot en `deliverables`

Lógica en `convex/functions/deliverables/actions.ts` después del callsite
existente (`findTemplate` línea 215). El refactor es mínimo: una vez resuelta
la plantilla, copiar 3 campos al row de `deliverables` al insertar.

**Cambio en `actions.ts` (pseudo-diff sobre línea ~215 y línea ~310 donde se
inserta el deliverable):**

```ts
// ANTES (línea ~215):
ctx.runQuery(internal.functions.deliverables.internalQueries.findTemplate, {
  serviceName: projService.serviceName,
  type: args.templateType,
  orgId: assignment.orgId,
}),

// DESPUÉS:
ctx.runQuery(api.functions.deliverableTemplates.queries.getResolved, {
  type: args.templateType,
  subserviceId: projService.subserviceId,          // A1 lo agregó al schema
  serviceId: projService.serviceId,
  serviceName: projService.serviceName,            // fallback dual-matching
}),
```

> Como `getResolved` es una query pública (no internal), o bien se mueve a
> `internalQueries` o se llama vía `ctx.runQuery(api...)`. Recomendación:
> exponer `internalQueries.getResolvedForGeneration` que envuelve la lógica
> sin guard de auth (el action ya está autenticado en el callsite).

**Al insertar el deliverable** (después del PDF upload, donde hoy se hace
`ctx.runMutation(...deliverables...insert)`):

```ts
await ctx.runMutation(internal.functions.deliverables.internalMutations.create, {
  // ... campos existentes
  templateId: template?._id,
  templateVersion: template?.version,
  templateHtmlSnapshot: template?.htmlTemplate,
  subserviceId: projService.subserviceId,
});
```

**Por qué esto basta:**

- El HTML que se snapshoteó tiene los `{{placeholder}}` originales. Para
  re-renderizar el deliverable en el futuro (UI de audit en junio), basta
  pasar `templateHtmlSnapshot` por `resolveTemplate` con el contexto
  histórico (cliente, proyección, respuestas — datos que ya viven en sus
  tablas respectivas).
- Si la plantilla se renombra, se borra, o cambia de servicio, el
  deliverable sigue siendo reproducible idéntico.
- Si el cliente pide "regenérame el deliverable de marzo con la plantilla
  actualizada", el operador lo hace explícitamente desde la UI manual
  (R1 §4.4 "Generar ahora sin factura" override) — no hay re-render
  automático.

**Backfill:** registros previos a A2 quedan con `templateId: undefined`. La
UI de audit (junio) los muestra como "no reproducible — PDF original en
storage".

---

## 6. Tests

Archivos nuevos:

- `convex/functions/deliverableTemplates/queries.test.ts`
- `convex/functions/deliverableTemplates/mutations.test.ts`
- `convex/functions/deliverableTemplates/snapshot.test.ts`

Patrón vitest + `convex-test`. Mínimo **15 tests**, todos con asserts
concretos.

**Permisos refactor (5):**

1. **`mutations.create` como org-admin inserta org-scoped.** Setup: auth como
   orgA, role `org:admin`. Llama `create({ name, type: "quotation",
   serviceName: "Marketing", subserviceId, htmlTemplate, variables, isActive })`
   sin pasar orgId. Assert: row resultante tiene `orgId === orgA`,
   `parentTemplateId === undefined`, `version === 1`.
2. **`mutations.create` como org-admin con `orgId: undefined` lanza.** Auth
   orgA, role `org:admin`. Llama `create({ ..., orgId: undefined })`. Assert:
   throws con "No puedes crear plantillas para otra organización."
3. **`mutations.update` rechaza editar global desde org-admin.** Setup:
   crear plantilla global (super-admin), luego switch auth a orgA admin,
   llamar `update({ id: globalId, expectedVersion: 1, patch: { name: "x" }})`.
   Assert: throws — `requireTemplateEditAccess` llama `requireSuperAdmin`.
4. **`personalizeGlobal` como org-admin clona correctamente.** Setup: plantilla
   global v3 con htmlTemplate `"H"` y variables `[{key: "x", ...}]`. Auth como
   orgA. Llamar `personalizeGlobal({ globalTemplateId })`. Assert: nuevo row
   con `orgId === orgA`, `parentTemplateId === globalId`,
   `originalVersionAtClone === 3`, `version === 1`, `htmlTemplate === "H"`,
   `variables.length === 1`.
5. **`remove` rechaza global desde org-admin.** Setup: plantilla global. Auth
   orgA admin. Llamar `remove({ id: globalId })`. Assert: throws.

**Copy-on-write (3):**

6. **`personalizeGlobal` copia HTML + variables + type + subserviceId.** Setup:
   global con todos los campos. Llamar. Assert: clon tiene los mismos
   `htmlTemplate`, `variables` (deep equal), `type`, `subserviceId`,
   `serviceId`, `serviceName`.
7. **`personalizeGlobal` idempotente.** Llamar dos veces consecutivas desde
   mismo orgA sobre mismo globalId. Assert: segunda llamada retorna el `_id`
   de la primera, no inserta duplicado. `db.query("deliverableTemplates")
   .withIndex("by_parentTemplateId", q => q.eq("parentTemplateId", globalId))
   .filter(q => q.eq(q.field("orgId"), orgA)).collect()` retorna exactamente
   1 row.
8. **Banner `hasNewerGlobal` aparece cuando global sube de versión.** Setup:
   global v3, orgA personaliza → clon v1 con originalVersionAtClone=3. Super-
   admin actualiza global → v4. Auth orgA, llamar `getByIdWithBanner({ id:
   clonId })`. Assert: response tiene `hasNewerGlobal === true`,
   `globalVersion === 4`.

**Resolver (3):**

9. **`getResolved` prefiere org-scoped sobre global con mismo subserviceId.**
   Setup: global con subserviceId=S, orgA personaliza → clon. Auth orgA,
   `getResolved({ type: "deliverable_short", subserviceId: S })`. Assert:
   devuelve el clon (orgId=orgA), no el global.
10. **`getResolved` fallback a global si no hay clon.** Setup: solo global
    con subserviceId=S, orgA sin personalizar. Auth orgA, `getResolved({ type,
    subserviceId: S })`. Assert: devuelve global (orgId=undefined).
11. **`getResolved` dual-matching: subserviceId ausente, usa serviceId.**
    Setup: plantilla legacy con `subserviceId: undefined`, `serviceId: SID`,
    `serviceName: "Marketing"`. Llamar `getResolved({ type, subserviceId:
    undefined, serviceId: SID, serviceName: "Marketing" })`. Assert: devuelve
    la legacy.

**Snapshot (2):**

12. **`deliverables` guarda `templateVersion` + `templateHtmlSnapshot`.**
    Setup: plantilla v5 con htmlTemplate `"<h1>X</h1>"`. Disparar
    generación (mock action `generateDeliverable`). Assert: row de
    `deliverables` resultante tiene `templateId` set, `templateVersion === 5`,
    `templateHtmlSnapshot === "<h1>X</h1>"`.
13. **Audit re-render funciona con snapshot aunque plantilla cambie.** Setup:
    deliverable generado con snapshot `"<h1>A</h1>"`. Plantilla luego se
    edita a `"<h1>B</h1>"` (v6). Reproducción local: pasar
    `templateHtmlSnapshot` por `resolveTemplate` con contexto histórico.
    Assert: HTML resuelto contiene `<h1>A</h1>`, no `<h1>B</h1>`.

**Concurrencia (1):**

14. **`update` con `expectedVersion` stale rechaza.** Setup: plantilla v3,
    cliente A lee. Cliente B updatea → v4. Cliente A intenta `update({
    expectedVersion: 3, patch: {...} })`. Assert: throws con mensaje
    "Versión obsoleta". `db.get(id)` confirma version sigue siendo 4 sin
    los cambios de A.

**Validación (1):**

15. **`update` con placeholder no declarado rechaza.** Setup: plantilla con
    `variables: [{key: "name", ...}]`. Llamar `update({ expectedVersion, patch:
    { htmlTemplate: "<p>{{name}} {{unknown}}</p>" }})`. Assert: throws con
    mensaje conteniendo "unknown".

**Extras opcionales:**

16. **`restoreToGlobal` con deliverables existentes soft-deletes (no hard).**
17. **`listForOrg` deduplica: global + clon → solo aparece el clon.**

---

## 7. Definition of Done

Boolean checkable. Marcar todos antes de pasar a A3.

- [ ] `convex/schema.ts`: `deliverableTemplates` con `subserviceId` (vía A1),
      `parentTemplateId`, `originalVersionAtClone`, enum `"invoice"`.
- [ ] `convex/schema.ts`: índices `by_orgId_subserviceId` y
      `by_parentTemplateId` añadidos.
- [ ] `convex/schema.ts`: `deliverables` con `templateId`, `templateVersion`,
      `templateHtmlSnapshot` + índice `by_templateId`.
- [ ] `npx convex dev` corre sin errores de codegen.
- [ ] `convex/lib/templateAccess.ts` con `requireTemplateEditAccess` +
      `canReadTemplate`.
- [ ] `convex/lib/templatePlaceholders.ts` con `extractPlaceholders` +
      `validatePlaceholdersDeclared` (extraídos de `src/lib/templateResolver.ts`).
- [ ] `convex/functions/deliverableTemplates/queries.ts` refactor: `list`
      abierto a operador, `listForOrg`, `getResolved`, `getByIdWithBanner`,
      `getById` con guard org.
- [ ] `convex/functions/deliverableTemplates/mutations.ts` refactor: `create`
      con dual-path super/operador, `update` con `expectedVersion` +
      validación placeholders, `personalizeGlobal`, `restoreToGlobal`,
      `toggleActive` con guard, `remove` con soft-delete cuando hay
      deliverables.
- [ ] `convex/functions/deliverables/internalQueries.ts`:
      `getResolvedForGeneration` envoltorio sin guard.
- [ ] `convex/functions/deliverables/actions.ts`: callsite de `findTemplate`
      reemplazado por `getResolvedForGeneration`; snapshot insertado en
      `deliverables` row.
- [ ] `src/app/(dashboard)/configuracion/plantillas/page.tsx` funcional
      (árbol + cards + personalizar + nueva + restaurar).
- [ ] `src/app/(dashboard)/configuracion/plantillas/[id]/page.tsx` funcional
      (textarea + variables + vista previa + guardar con `expectedVersion` +
      banner stale).
- [ ] `src/app/(dashboard)/configuracion/page.tsx` con card "Plantillas".
- [ ] 15+ tests vitest pasando (`npm test`).
- [ ] `npm run lint` clean.
- [ ] `npx tsc --noEmit` clean.
- [ ] `gitnexus_impact` corrido sobre `findTemplate`, `requireSuperAdmin`
      usages en `deliverableTemplates/*`, y callsite `actions.ts:215`.
      HIGH/CRITICAL risk reportado en PR.
- [ ] `gitnexus_detect_changes` pre-commit: scope confirma solo
      `convex/schema.ts`, `convex/functions/deliverableTemplates/*`,
      `convex/functions/deliverables/{actions,internalQueries,internalMutations}.ts`,
      `convex/lib/{templateAccess,templatePlaceholders}.ts`,
      `src/app/(dashboard)/configuracion/plantillas/**`,
      `src/app/(dashboard)/configuracion/page.tsx`.

---

## 8. Riesgos específicos de A2

Aterrizando los riesgos del maestro R1 §10 aplicables a A2:

**R2 — Drift entre orgs.** Org A personaliza, org B no. Super-admin updatea
global. Mitigación A2:
- Banner inline `hasNewerGlobal: true` en `getByIdWithBanner` + UI muestra
  "v3 personalizada · v8 global disponible".
- "Ver cambios" abre modal con diff (en beta: dos paneles side-by-side de
  HTML del clon vs HTML actual del global; merge real diferido a junio).
- Org B sin personalizar sigue recibiendo updates automáticamente porque
  `listForOrg` la lleva al global vigente.

**R6 — Plantilla con variables inválidas.** Mitigación A2:
- `validatePlaceholdersDeclared` en `mutations.update` y `mutations.create`
  rechaza pre-save si hay `{{key}}` sin declarar.
- Editor UI muestra warning inline en panel de variables mientras tipea
  (no bloquea typing, solo el save).
- Pre-flight en A3 generación: si `getResolved` devuelve plantilla con
  variables inconsistentes (situación imposible post-A2 pero defensiva),
  log a `documentEvents` con severity error y skip.

**R13 — Operador edita plantilla con deliverables ya generados.**
Mitigación A2:
- **Snapshot por valor** garantiza que deliverables pasados NO se afecten.
  `templateHtmlSnapshot` preserva el HTML exacto.
- UI editor muestra banner informativo: "Esta plantilla tiene N deliverables
  generados. Tus cambios solo aplican a generaciones futuras."
- `remove` con deliverables apuntando hace soft-delete (`isActive: false`),
  preservando referencia para audit.

**R15 — Concurrencia (dos operadores editando).** Mitigación A2:
- `expectedVersion` requerido en `update`. Mismatch → throw.
- UI editor convierte el error en banner rojo + botón "Recargar". Pierde
  cambios locales (UX deliberada: simpler que merge en beta).
- Convex es serializable, así que el throw es determinístico aunque dos
  updates lleguen en el mismo tick.

**R17 (nuevo, A2-específico) — Linaje roto si global borrado.** Si super-admin
borra una global que tiene clones org-scoped activos, `parentTemplateId`
queda colgado. Mitigación:
- `mutations.remove` para globales (super-admin only via
  `requireTemplateEditAccess`) podría chequear `by_parentTemplateId` y
  bloquear si hay clones — **NO se implementa en A2** (super-admin se asume
  consciente del impacto, y los globales no se borran en práctica).
- Si pasa, `getByIdWithBanner` hace `ctx.db.get(parentId)` que retorna `null`
  → `hasNewerGlobal: false`. El clon sigue funcional; solo pierde el banner.
- Documentado como deuda menor. Si llega a importar, agregar guard en
  `remove` post-beta.

**R18 (nuevo) — UI lee global v3 pero al hacer `personalizeGlobal` ya es v5.**
Race window entre read y mutation. Mitigación:
- `personalizeGlobal` no toma `expectedVersion` del source — copia la versión
  actual del global al insert. El clon arranca con el HTML más reciente del
  global aunque el operador haya estado mirando una versión anterior. Toast
  post-clone advierte: "Plantilla copiada desde la versión más reciente del
  global (vN)."
- Aceptable: el operador siempre arranca su trabajo desde lo último, que es
  el comportamiento esperado.

---

## 9. Open questions (a resolver en implementación)

**Q1. ¿Editor Monaco o textarea?**
**Recomendación:** Textarea simple para beta. Monaco agrega ~500KB y se
puede sumar post-beta como mejora si el dueño lo pide. Si urge syntax
highlight ligero, `react-simple-code-editor` + `prismjs` (~50KB) es el
puente intermedio.

**Q2. ¿Vista previa real con puppeteer o solo HTML interno?**
**Recomendación:** Solo HTML interno + `<iframe sandbox>`. La fidelidad PDF
solo se garantiza en producción (puppeteer en `src/app/api/generate-pdf/`).
Mostrar nota en el modal "La vista previa es aproximada — el PDF final
puede diferir en márgenes y fuentes."

**Q3. ¿Si super-admin actualiza global mientras org tiene clon, notificar?**
**Recomendación:** Banner UI siempre (ya en `getByIdWithBanner`). Email
**no** en beta — añade carga sobre Resend y duplica notificaciones
operativas. Diferido a junio junto con el merge UI.

**Q4. ¿Operador puede crear plantilla "global" para promover a otras orgs?**
**Recomendación:** NO en beta. Solo super-admin crea globales. Si el dueño
quiere promover una plantilla de orgA como global para todas las orgs, el
flujo es manual: super-admin copia el HTML desde Convex dashboard al editor
de `/platform/templates`. Mutation dedicada `promoteToGlobal` queda en
backlog post-beta.

**Q5. ¿Templates type="invoice" en V2 FacturAPI necesita campos diferentes?**
**Recomendación:** Sí (CFDI uso, regimen, etc.), pero out-of-scope. En A2
solo se reserva el literal en el enum. Cuando V2 FacturAPI se prenda, se
añadirá un campo opcional `invoiceMetadata: v.optional(v.object({...}))` al
schema. Es aditivo, no breaking.

**Q6. ¿Cómo se llama el clon recién hecho? Mismo nombre que el global, sufijo
"(personalizada)", o pedir al operador?**
**Recomendación:** Mismo nombre que el global. En la página
`/configuracion/plantillas`, el badge "Personalizada" ya distingue
visualmente. Forzar sufijo crea ruido innecesario y rompe nombres
descriptivos. El operador puede renombrar libremente después.

---

## 10. Referencias

### 10.1 Archivos del codebase

- `convex/schema.ts:328-367` — `deliverables`; A2 añade `templateId`,
  `templateVersion`, `templateHtmlSnapshot`, `subserviceId` (A1) e índice
  `by_templateId` después de línea 367.
- `convex/schema.ts:407-441` — `deliverableTemplates`; A2 añade
  `subserviceId` (A1), `parentTemplateId`, `originalVersionAtClone`, enum
  `"invoice"`, índices `by_orgId_subserviceId` y `by_parentTemplateId`.
- `convex/functions/deliverableTemplates/queries.ts:1-73` — refactor
  completo de permisos + queries nuevos `listForOrg`, `getResolved`,
  `getByIdWithBanner`.
- `convex/functions/deliverableTemplates/mutations.ts:1-132` — refactor:
  `create` con dual-path, `update` con expectedVersion + validación,
  `personalizeGlobal`, `restoreToGlobal`, `toggleActive` con guard, `remove`
  con soft-delete.
- `convex/functions/deliverables/internalQueries.ts:48-74` — `findTemplate`
  legacy; A2 reemplaza callsite por `getResolvedForGeneration` envoltorio.
- `convex/functions/deliverables/actions.ts:215-220` — invocación actual de
  `findTemplate` que A2 sustituye.
- `convex/functions/deliverables/actions.ts` (~línea 310 donde se inserta
  el deliverable) — A2 añade snapshot fields al payload de
  `internalMutations.create` (o equivalente).
- `convex/lib/authHelpers.ts:11-50` — `getOrgId`, `getOrgIdSafe`,
  `requireAdmin`, `requireSuperAdmin`; A2 los usa todos.
- `src/lib/templateResolver.ts:44-50` — `resolveTemplate` y
  `extractPlaceholders` (existente, vive en cliente); A2 lo replica a
  `convex/lib/templatePlaceholders.ts` para validación server-side sin
  cross-bundle imports.
- `src/app/platform/templates/page.tsx:1-771` — UI super-admin actual;
  patrón de cards / form / preview reutilizable para
  `/configuracion/plantillas`. A2 NO modifica esta página.
- `src/app/(dashboard)/configuracion/page.tsx:1-58` — hub de config; A2
  añade card "Plantillas". D2 lo expande más a 9 cards.
- `src/components/layout/sidebar.tsx:24-35` — navegación operadora; A2 NO
  toca sidebar (plantillas vive dentro del hub `/configuracion`).
- `src/components/templates/test-deliverable-modal.tsx` — modal de test
  existente para super-admin. A2 NO lo migra a `/configuracion/plantillas`
  en beta (operador no necesita el flujo "test con datos reales" hasta junio).

### 10.2 Sub-specs relacionados

- `docs/superpowers/specs/2026-05-20-prod-readiness-revision.md` — maestro
  R1, §3 fija permisos + copy-on-write, §12 fija decisiones canónicas (#1,
  #2, #4, #6, #7), §10 R2/R6/R13/R15 son los riesgos que A2 mitiga.
- `docs/superpowers/specs/2026-05-21-subservices-model-design.md` — A1, ya
  agregó `subserviceId` opcional en `deliverableTemplates`. A2 lo consume
  en resolver y en árbol de UI.
- `docs/superpowers/specs/2026-05-23-document-lifecycle-design.md` — A3,
  consumirá `getResolved` desde `selectDeliverableForMonth` + escribirá
  snapshot en `deliverables`. A2 deja la query lista; A3 ajusta el callsite
  exacto del cron y `generateFromInvoice`.
- `docs/superpowers/specs/2026-05-14-deliverable-engine-refactor-design.md`
  — engine ya en main; el snapshot HTML lo lee tal cual está, sin
  modificaciones al engine.

### 10.3 Memorias del proyecto

- `project_sprint_v2_timeline` — A2 termina 2026-05-26 noche para liberar
  slot a A3.
- `project_blob_storage` — A2 no toca blob storage (los snapshots viven en
  Convex doc storage, no en Railway).

---

**Fin del sub-spec A2.** A3 arranca con `templates.getResolved` disponible,
`subserviceId` dual-matching listo, snapshot pattern documentado, y los
permisos del operador cerrados para que el flujo `markPaid →
generateFromInvoice` pueda apoyarse en la plantilla correcta sin re-hacer
guards.
