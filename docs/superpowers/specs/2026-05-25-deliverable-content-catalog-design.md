# Deliverable Content Catalog — Sub-spec 1

**Fecha:** 2026-05-25
**Autor:** Christian (via brainstorming)
**Estado:** 🟢 Spec aprobado — listo para writing-plans
**Origen:** [stub maestro § 3 Sub-spec 1](./2026-05-22-papa-call-scale-pending-detailed-spec.md)
**Bloquea:** Sub-spec 4 (parcialmente — sus entregables consumirán plantillas con contenido real)
**Estimado:** 3 días impl (incluye bulk-import CLI) + N días contenido humano (papá / Claude Code)

---

## 1. Overview

Sistema para distinguir plantillas con **contenido real** vs plantillas **seed/placeholder**, visual warning cuando una proyección tiene subservicios activos sin contenido real, y un CLI para bulk-import de HTML desde el filesystem (workflow Claude Code-friendly).

### 1.1 Cambios estructurales

- 1 field nuevo: `deliverableTemplates.contentStatus: 'placeholder' | 'ready'`.
- Detección automática on-save vía marker `<div class="placeholder">`.
- Migration one-shot para los 33 seeded.
- Query nueva: `projections.queries.subservicesMissingContent`.
- UI: banner en `/proyecciones/[id]`, badge + counter en `/configuracion/plantillas`, chip en `/[id]` editor.
- Bulk-import: internal mutation `bulkImport.upsertFromFile` + CLI script `scripts/import-templates.ts`.

### 1.2 No-goals (explícitos)

- ❌ Bloquear generación cuando solo hay placeholder (non-blocking warning).
- ❌ AI-assist / duplicate-from / markdown editor.
- ❌ Workflow multi-step de aprobación (2-state simple).
- ❌ Cambio funcional en `generateDeliverable` action.
- ❌ Sync bidireccional repo ↔ DB (bulk-import = una vía, repo → DB).

### 1.3 Compatibilidad

Field nuevo `v.optional` en PR1, migration backfill, PR2 tighten a required. Mismo patrón de Sub-spec 0.

---

## 2. Schema changes

### 2.1 `deliverableTemplates.contentStatus`

```typescript
contentStatus: v.optional(
  v.union(
    v.literal("placeholder"),
    v.literal("ready")
  )
),
```

- `optional` en PR1; PR2 lo vuelve required.
- Default semántico: ausencia = `"placeholder"` durante PR1.

### 2.2 Indexes nuevos

```typescript
.index("by_subservice_contentStatus", ["subserviceId", "contentStatus"])
```

Permite query rápido "¿existe template para este subservicio con contentStatus=ready?" sin scan.

---

## 3. Detección de placeholder vs ready

### 3.1 Helper puro

**Path:** `convex/lib/templateContent.ts`

```typescript
/**
 * Marker que el seed del 2026-05-22 dejó en los 33 templates placeholder.
 * Si el HTML aún lo contiene, el template no tiene contenido real.
 *
 * Reservado: no usar esta clase CSS en plantillas con contenido real, o quedan
 * flagged como placeholder. Documentar en CLAUDE.md.
 */
const PLACEHOLDER_MARKER = '<div class="placeholder">';

export type ContentStatus = "placeholder" | "ready";

export function detectContentStatus(htmlTemplate: string): ContentStatus {
  return htmlTemplate.includes(PLACEHOLDER_MARKER) ? "placeholder" : "ready";
}
```

### 3.2 Hook en mutations existentes

`convex/functions/deliverableTemplates/mutations.ts`:

- `create`: persiste `contentStatus = detectContentStatus(args.htmlTemplate)`.
- `update`: recomputa post-merge del htmlTemplate, persiste.
- `personalizeGlobal`: el clone hereda contentStatus del source (mismo HTML).

### 3.3 Reglas de derivación

| HTML contiene marker | Resultado |
|---|---|
| Sí | `"placeholder"` |
| No | `"ready"` |

Empty/blank HTML → `"ready"` (per `detectContentStatus`). El editor ya bloquea save de HTML vacío via existente `form.htmlTemplate.trim()` check.

---

## 4. Validation query

### 4.1 `projections.queries.subservicesMissingContent`

```typescript
export const subservicesMissingContent = query({
  args: { projectionId: v.id("projections") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const orgId = await getOrgId(ctx);

    const projection = await ctx.db.get(args.projectionId);
    if (!projection || projection.orgId !== orgId) return [];

    const activeRows = await ctx.db
      .query("projectionServices")
      .withIndex("by_projectionId_active", (q) =>
        q.eq("projectionId", args.projectionId).eq("isActive", true)
      )
      .collect();

    const missing: Array<{
      subserviceId: Id<"subservices">;
      subserviceName: string;
      serviceName: string;
    }> = [];

    for (const ps of activeRows) {
      if (!ps.subserviceId) continue;
      const readyTemplate = await ctx.db
        .query("deliverableTemplates")
        .withIndex("by_subservice_contentStatus", (q) =>
          q.eq("subserviceId", ps.subserviceId).eq("contentStatus", "ready")
        )
        .first();

      if (!readyTemplate) {
        const sub = await ctx.db.get(ps.subserviceId);
        if (sub) {
          missing.push({
            subserviceId: ps.subserviceId,
            subserviceName: sub.name,
            serviceName: ps.serviceName,
          });
        }
      }
    }

    return missing;
  },
});
```

**Notas:**
- Visible a todos los miembros autenticados.
- Performance: N queries en proyección típica (<20 services). Aceptable MVP. Refactor a batch cuando volumen lo amerite (Sub-spec 7).
- Cross-org safe (filtra por orgId del projection).

### 4.2 Tree query — agregar contentStatus al payload

`deliverableTemplates/queries.ts:listForOrg` ya retorna `TemplateRowData`. Agregar `contentStatus: tpl.contentStatus ?? "placeholder"` al template object. Cero queries extra.

---

## 5. UI changes

### 5.1 `MissingContentBanner` (componente nuevo)

**Path:** `src/components/projections/missing-content-banner.tsx`

- Llama `subservicesMissingContent(projectionId)`.
- Si `missing.length === 0` → return null (no flash).
- Banner amarillo (`border-amber-500/30 bg-amber-500/10`) con `AlertTriangle`.
- Lista subservicios afectados: `<servicio> · <subservicio>`.
- Pluralización ES: "1 subservicio activo sin contenido real" vs "N subservicios activos...".

Mount en `src/app/(dashboard)/proyecciones/[id]/page.tsx`, antes del grid de la matriz.

### 5.2 Badge "Sin contenido" en tree

`src/app/(dashboard)/configuracion/plantillas/page.tsx` (existente, 822 líneas). En cada template card, junto a los chips de type/version, agregar conditional:

```tsx
{template.contentStatus === "placeholder" && (
  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30">
    <AlertTriangle className="h-3 w-3" />
    Sin contenido
  </span>
)}
```

### 5.3 Header counter en tree

Mismo archivo. Computar `placeholderCount` con `useMemo` sobre el tree. En el header:

```tsx
{placeholderCount > 0 && (
  <span className="ml-3 text-sm text-amber-300">
    {placeholderCount} sin contenido
  </span>
)}
```

### 5.4 Chip de estado en editor

`src/app/(dashboard)/configuracion/plantillas/[id]/page.tsx`. Al lado del título del template:

```tsx
{template.contentStatus === "placeholder" ? (
  <span className="text-xs text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30">
    Placeholder · borrar el bloque <code>{'<div class="placeholder">'}</code> y guardar lo marca como Ready
  </span>
) : (
  <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
    Ready
  </span>
)}
```

---

## 6. Migration

### 6.1 Mutation interna

**Path:** `convex/functions/migrations/templateContentStatus.ts`

```typescript
import { internalMutation, internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { detectContentStatus } from "../../lib/templateContent";

export const migrate = internalMutation({
  args: { dryRun: v.boolean() },
  handler: async (ctx, { dryRun }) => {
    let count = 0;
    for await (const tpl of ctx.db.query("deliverableTemplates")) {
      if (tpl.contentStatus) continue;
      const status = detectContentStatus(tpl.htmlTemplate);
      if (!dryRun) await ctx.db.patch(tpl._id, { contentStatus: status });
      count++;
    }
    return { templates: count, dryRun };
  },
});

export const verifyComplete = internalQuery({
  args: {},
  handler: async (ctx) => {
    let pending = 0;
    for await (const tpl of ctx.db.query("deliverableTemplates")) {
      if (!tpl.contentStatus) pending++;
    }
    return { templatesPending: pending };
  },
});
```

### 6.2 Procedimiento

```bash
npx convex run functions/migrations/templateContentStatus:migrate '{"dryRun": true}'
# Espera count ~33+ (todos los templates sin contentStatus)

npx convex run functions/migrations/templateContentStatus:migrate '{"dryRun": false}'

npx convex run functions/migrations/templateContentStatus:verifyComplete '{}'
# → { templatesPending: 0 }
```

PR2 (tras OK explícito de Christian y backfill en prod): schema tighten + remover migration module.

---

## 7. Bulk-import CLI

### 7.1 Estructura

```
convex/seeds/templates/
  README.md
  legal__asesoria-legal.html
  legal__sociedades.html
  contable__estados-financieros.html
  contable__estados-financieros-quotation.html  # type override
  marketing__contenido-redes.html
  ...
```

**Convención filename:** `<parent-svc-slug>__<subservice-slug>[-<type>].html`

- Default type si no hay suffix: `deliverable_long`
- Suffix válidos: `-quotation`, `-contract`, `-short`, `-long`, `-questionnaire`

### 7.2 Internal mutation

**Path:** `convex/functions/deliverableTemplates/bulkImport.ts`

```typescript
import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import { detectContentStatus } from "../../lib/templateContent";

const STANDARD_VARIABLES = [
  { key: "cliente.nombre", label: "Nombre del cliente", source: "client", required: true },
  { key: "cliente.rfc", label: "RFC del cliente", source: "client", required: false },
  { key: "proyeccion.mes", label: "Mes de la proyección", source: "projection", required: true },
  { key: "proyeccion.año", label: "Año de la proyección", source: "projection", required: true },
  { key: "ai.diagnostico", label: "Diagnóstico ejecutivo (AI)", source: "ai", required: true },
] as const;

export const upsertFromFile = internalMutation({
  args: {
    parentServiceName: v.string(),
    subserviceSlug: v.string(),
    type: v.union(
      v.literal("quotation"),
      v.literal("contract"),
      v.literal("deliverable_short"),
      v.literal("deliverable_long"),
      v.literal("questionnaire")
    ),
    name: v.string(),
    htmlTemplate: v.string(),
  },
  handler: async (ctx, args) => {
    const parentSvc = await ctx.db
      .query("services")
      .withIndex("by_name", (q) => q.eq("name", args.parentServiceName))
      .first();
    if (!parentSvc) {
      throw new Error(`Service "${args.parentServiceName}" not found.`);
    }

    const subsvc = await ctx.db
      .query("subservices")
      .withIndex("by_parent_slug", (q) =>
        q.eq("parentServiceId", parentSvc._id).eq("slug", args.subserviceSlug)
      )
      .first();
    if (!subsvc) {
      throw new Error(
        `Subservice "${args.subserviceSlug}" under "${args.parentServiceName}" not found.`
      );
    }

    const existing = await ctx.db
      .query("deliverableTemplates")
      .withIndex("by_orgId", (q) => q.eq("orgId", undefined as any))
      .filter((q) =>
        q.and(
          q.eq(q.field("subserviceId"), subsvc._id),
          q.eq(q.field("type"), args.type)
        )
      )
      .first();

    const contentStatus = detectContentStatus(args.htmlTemplate);

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        htmlTemplate: args.htmlTemplate,
        version: existing.version + 1,
        contentStatus,
        updatedAt: Date.now(),
      });
      return { action: "updated" as const, templateId: existing._id, contentStatus };
    }

    const newId = await ctx.db.insert("deliverableTemplates", {
      orgId: undefined,
      serviceId: parentSvc._id,
      serviceName: parentSvc.name,
      subserviceId: subsvc._id,
      type: args.type,
      name: args.name,
      htmlTemplate: args.htmlTemplate,
      variables: [...STANDARD_VARIABLES],
      version: 1,
      isActive: true,
      contentStatus,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { action: "created" as const, templateId: newId, contentStatus };
  },
});
```

### 7.3 CLI script

**Path:** `scripts/import-templates.ts`

- Lee `*.html` files de `convex/seeds/templates/`.
- Parsea filename: `<parentSvcSlug>__<subserviceSlug>[-<type>].html`.
- Resuelve `parentSvcName` desde lookup map en el script (`{ legal: "Legal", contable: "Contable", ti: "TI", ... }`).
- Para cada file: `client.mutation(internal.functions.deliverableTemplates.bulkImport.upsertFromFile, {...})`.
- Auth via `ConvexHttpClient` + `CONVEX_DEPLOY_KEY` env.
- Console output: `✓ created` / `↻ updated` / `✗ error` per file + summary.

```bash
DEPLOY_KEY=$(npx convex deploy-key) npx tsx scripts/import-templates.ts
```

### 7.4 README en seeds dir

`convex/seeds/templates/README.md` documenta:
- Convención de naming
- Lista de slugs válidos (mapeo a names)
- Comando para correr el script
- Que `detectContentStatus` corre automático (solo deja el marker si quieres mantener placeholder)

---

## 8. Testing strategy

### 8.1 Unit tests del detector

**Path:** `convex/lib/__tests__/templateContent.test.ts`

| Test | Setup | Expectation |
|---|---|---|
| Returns "placeholder" con marker presente | HTML con `<div class="placeholder">` | "placeholder" |
| Returns "ready" sin marker | `<h1>Real</h1>` | "ready" |
| Empty HTML → "ready" | `""` | "ready" |
| Marker nested deep → "placeholder" | `<body><section><div class="placeholder">x</div></section></body>` | "placeholder" |

### 8.2 Integration tests de mutations

**Path:** `convex/functions/deliverableTemplates/__tests__/contentStatus.test.ts`

- `create` con marker → `contentStatus = "placeholder"` en DB.
- `create` sin marker → `"ready"`.
- `update` flip "placeholder" → "ready" al borrar marker.
- `update` flip "ready" → "placeholder" al re-introducir marker (edge case).
- `personalizeGlobal` hereda contentStatus del source.

### 8.3 Migration test

**Path:** `convex/functions/migrations/__tests__/templateContentStatus.test.ts`

- Dry run reporta count sin patches.
- Apply asigna correctamente.
- Idempotent (2da corrida = 0).
- verifyComplete returns 0 pending post-apply.

### 8.4 Query test

**Path:** `convex/functions/projections/__tests__/subservicesMissingContent.test.ts`

- Subservice con template `"ready"` → no aparece.
- Subservice solo con templates `"placeholder"` → sí aparece.
- ProjectionService sin subserviceId → no aplica.
- Cross-org → returns `[]`.

### 8.5 Bulk-import test

**Path:** `convex/functions/deliverableTemplates/__tests__/bulkImport.test.ts`

- `upsertFromFile` crea template global cuando no existe.
- `upsertFromFile` actualiza + bump version cuando existe.
- Throws con error claro si subservice slug no existe.

### 8.6 UI tests

**Path:** `src/components/projections/__tests__/missing-content-banner.test.tsx`

- `missing = []` → null render.
- `missing = [1]` → singular.
- `missing = [3]` → plural + 3 items.

### 8.7 Coverage meta

- Baseline post-Sub-spec-0: 831 passed | 1 skipped.
- Sub-spec 1 agrega: ~23 nuevos.
- Meta post: ~854 passing.

### 8.8 Manual smoke (Christian, browser)

1. `/configuracion/plantillas` → counter "33 sin contenido" + badge en cada card.
2. Click una plantilla → chip "Placeholder · borrar el bloque...".
3. Borrar `<div class="placeholder">` block + guardar → chip cambia a "Ready" verde.
4. Volver al tree → counter baja a 32; ese card sin badge.
5. `/proyecciones/[id]` con subservicios afectados → banner amarillo listando.
6. Bulk-import de prueba: crear 2-3 `.html` files dummy, correr script, verificar console + DB.

---

## 9. Out of scope + risks

### 9.1 Fuera de scope

| Tema | Vive en | Razón |
|---|---|---|
| Bloquear generación | Post-MVP | Non-blocking warning suficiente para MVP |
| AI-assist / duplicate / markdown | Post-MVP | YAGNI |
| Workflow multi-step (review queue) | Post-MVP | 2-state suficiente |
| Sync bidireccional repo ↔ DB | Post-MVP | Bulk-import one-way (repo → DB) |
| Versioning/diff de contentStatus changes | Post-MVP | documentEvents audit lo cubre cuando se mergee |

### 9.2 Riesgos

1. **Marker fragile:** alguien pega accidentalmente `<div class="placeholder">` en una plantilla real → flagged placeholder. *Mitigación:* chip del editor explica cómo flipparlo. CLAUDE.md documenta el marker reservado.
2. **Multi-tenant content:** `personalizeGlobal` clone hereda contentStatus del source. Si global está `ready`, todos los clones empiezan `ready`. *Decisión:* correcto — el contenido sigue siendo real. Edit del clone re-evalúa.
3. **Query performance:** N queries en proyección con >50 services activos. *Mitigación:* aceptable MVP (proy típicas <20). Batch refactor cuando volumen.
4. **Bulk-import vs in-app edits:** si papá usa AMBOS, último-en-escribir gana. *Mitigación:* script bump version en update — operador ve "v3 importado" en el editor y sabe que hubo overwrite. CLAUDE.md documenta convención: prefer bulk para iniciales, in-app para hotfix puntuales.
5. **CONVEX_DEPLOY_KEY exposure:** script requiere admin key. *Mitigación:* env var, nunca commiteado. README incluye warning.

### 9.3 Checklist de implementación (preview)

```
PR1 (Sub-spec 1 main):
  [ ] convex/lib/templateContent.ts + tests
  [ ] convex/schema.ts → contentStatus optional + index by_subservice_contentStatus
  [ ] convex/functions/deliverableTemplates/mutations.ts → hook create/update/personalizeGlobal
  [ ] convex/functions/deliverableTemplates/queries.ts → listForOrg incluye contentStatus
  [ ] convex/functions/projections/queries.ts → subservicesMissingContent query
  [ ] convex/functions/migrations/templateContentStatus.ts → migrate + verifyComplete
  [ ] convex/functions/deliverableTemplates/bulkImport.ts → upsertFromFile internalMutation
  [ ] scripts/import-templates.ts → CLI script
  [ ] convex/seeds/templates/README.md
  [ ] src/components/projections/missing-content-banner.tsx
  [ ] src/app/(dashboard)/proyecciones/[id]/page.tsx → wire banner
  [ ] src/app/(dashboard)/configuracion/plantillas/page.tsx → badge + header counter
  [ ] src/app/(dashboard)/configuracion/plantillas/[id]/page.tsx → chip de estado
  [ ] Tests (~23 nuevos)
  [ ] Manual smoke (Christian, browser)
  [ ] Verify dev → OK explícito → deploy prod

PR2 (schema tightening, ~24h después):
  [ ] convex/schema.ts → contentStatus required
  [ ] Remover internal:migrations/templateContentStatus
```

### 9.4 Decisiones congeladas

- 2-state `contentStatus: 'placeholder' | 'ready'`.
- Marker detection via substring `<div class="placeholder">`.
- Auto-flip on save (no manual checkbox).
- Banner + badge + chip (no email/Slack/async notifs).
- Non-blocking warning.
- Migration 2-phase, idempotente.
- Bulk-import opt-in via CLI (no auto-sync).
- AI-assist / duplicate / markdown editor → out of scope.

---

## 10. Próximo paso

writing-plans con este spec como contexto. Plan formal por tareas TDD.
