# Spec — Client Documents Tab (archive view)

**Fecha:** 2026-05-20
**Autor:** Christian + Claude
**Estado:** propuesto
**Implementación:** post-bucket setup (branch `feature/blob-storage-railway` ya tiene helper listo)
**Origen:** decisión 2026-05-20 — el operador necesita encontrar rápido cualquier documento generado para un cliente (entregable, cotización, contrato, factura) con filtros de fecha/año, tipo y servicio.

---

## 1. Contexto

Hoy el operador para encontrar un PDF de un cliente tiene tres opciones, todas malas:

1. `/clientes/[id]/ciclo` — muestra **agrupado por servicio en flujo workflow** (qué está pendiente, qué está aprobado). No sirve para buscar "el entregable de marzo 2026 de marketing".
2. `/entregables` (top-level) — vista global de todos los entregables de toda la org, sin filtro por cliente.
3. `/cotizaciones`, `/contratos` — separadas por tipo, separadas del cliente.

Falta una **vista flat archive-centric por cliente** que conteste rápido "¿dónde está este documento?".

Este spec NO reemplaza `/ciclo` ni los listados globales — los complementa con una pestaña archive dentro del client detail.

---

## 2. Alcance

### In-scope (esta entrega)

- Nueva sección **"Documentos"** en `src/app/(dashboard)/clientes/[id]/page.tsx`, debajo de "Proyecciones".
- Tabla unificada con columnas: fecha, tipo, descripción, servicio, estado, acciones.
- Filtros:
  - **Tipo:** Todos / Entregables / Cotizaciones / Contratos / Facturas.
  - **Año:** dropdown autopobluado de años con docs existentes (descendente).
  - **Mes:** dropdown (solo si hay año seleccionado).
  - **Servicio:** dropdown de los `serviceName` que aparecen en docs del cliente.
- Acción **Ver/Descargar** por fila → genera signed URL on-demand y abre.
- Pagination si > 50 docs (sin sort por columna en v1).
- Conteo total visible: "Mostrando X de Y documentos".

### Out-of-scope (post-launch / v2)

- Bulk actions (selección múltiple + descarga en zip).
- Búsqueda full-text por contenido del PDF.
- Re-envío masivo por email.
- Vista de Drive integrada (entra en v2 del bucket).
- Edición inline (los docs son inmutables una vez generados).

### Dependencias

| Dep | Estado | Acción |
|---|---|---|
| Helper `convex/lib/blobStorage.ts` | ✅ Mergeable en `feature/blob-storage-railway` | Merge a main antes de empezar este sub-proyecto |
| Tabla `invoices` | ⏸ Se crea en sub-spec de Deliverable Lifecycle (`§3` del master 2026-05-14) | Diseñar este tab para ser tolerante a `invoices` ausente — query la lee solo si existe |
| Campo `bucketKey` en `deliverables / quotations / contracts` | ⏸ Backfill durante migración a Railway storage | Tab debe servir tanto `pdfStorageId` (Convex) como `bucketKey` (Railway) durante transición |

---

## 3. UX

### 3.1 Layout en el client detail page

La página actual es vertical-sections (header → 3 info cards → Proyecciones). Agregamos una sección más al final:

```
┌─ Header ────────────────────────────────────┐
│ ← Volver a Clientes                          │
│ [icon] Catimi SA          [Ciclo] [Editar]  │
│        RFC: ... · Industria: ...             │
└──────────────────────────────────────────────┘

┌─ Info Cards (3 columnas) ────────────────────┐
└──────────────────────────────────────────────┘

┌─ Proyecciones ───────────────────────────────┐
└──────────────────────────────────────────────┘

┌─ Documentos ─────────────────  ← NUEVA ─────┐
│                                              │
│ Filtros: [Tipo ▾] [Año ▾] [Mes ▾] [Svc ▾]  │
│                              Mostrando 23/47 │
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │ Fecha       Tipo        Servicio    ...  │ │
│ │ 2026-05-18  Entregable  Marketing   [👁]│ │
│ │ 2026-05-15  Factura     Marketing   [👁]│ │
│ │ 2026-05-12  Cotización  —           [👁]│ │
│ │ 2026-05-01  Contrato    Marketing   [👁]│ │
│ │ ...                                       │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ ← Anterior · Página 1 de 2 · Siguiente →    │
└──────────────────────────────────────────────┘
```

**Decisión de diseño:** sección stack-down vez de tabs reales. Razón: el resto de la página ya usa secciones; introducir tabs solo para esto rompe consistencia. Si en futuro la página crece > 4 secciones, reabrir decisión.

### 3.2 Columnas de la tabla

| Columna | Contenido | Notas |
|---|---|---|
| **Fecha** | `createdAt` o `deliveredAt`/`signedAt`/`uploadedAt` según kind | YYYY-MM-DD, ordenado descendente |
| **Tipo** | Chip de color: 🟦 Entregable / 🟨 Cotización / 🟪 Contrato / 🟧 Factura | |
| **Servicio** | `serviceName` (de la tabla) | "—" para cotizaciones top-level que no son de un solo servicio |
| **Mes/Año** | `month`/`year` del documento (para deliverables, invoices), o "Anual" para contratos/cotizaciones | |
| **Estado** | Status del doc (`approved`, `signed`, `sent`, `paid`, etc.) traducido a español | |
| **Acciones** | 👁 Ver (PDF en pestaña) / ⬇ Descargar | Para contratos pendientes de firma, también muestra link al cliente |

### 3.3 Estados vacíos

- **Sin documentos del cliente:** "Este cliente no tiene documentos generados todavía." + CTA "Ver ciclo documental" → `/clientes/[id]/ciclo`.
- **Filtros restringen a 0:** "Ningún documento coincide con los filtros." + botón "Limpiar filtros".

---

## 4. Schema — qué leemos, qué NO tocamos

### 4.1 Tablas existentes (ya en schema, NO se modifican)

| Tabla | Campos relevantes para la tabla |
|---|---|
| `deliverables` | `clientId`, `serviceName`, `month`, `year`, `auditStatus`, `deliveredAt`, `createdAt`, `shortPdfStorageId`, `longPdfStorageId` |
| `quotations` | `clientId`, `serviceName`, `status`, `createdAt`, `lastSentAt`, `pdfStorageId` |
| `contracts` | `clientId`, `serviceName`, `status`, `signedAt`, `createdAt`, `pdfStorageId` |

### 4.2 Tabla futura (sub-spec de lifecycle, NO en este spec)

| Tabla | Campos relevantes |
|---|---|
| `invoices` | `clientId`, `serviceName`, `month`, `year`, `uploadStatus`, `uploadedAt`, `bucketKey` |

### 4.3 Campos a agregar — opcional, no-bloqueante

Cada tabla doc puede recibir un `bucketKey: v.optional(v.string())` cuando se migre al bucket. **Este spec no agrega esos campos**; los agrega el sub-spec del lifecycle. La query de este tab debe leer ambos transparentemente:

```ts
const sourceUrl = doc.bucketKey
  ? await signedDownloadUrl({ bucketKey: doc.bucketKey })
  : doc.pdfStorageId
    ? await ctx.storage.getUrl(doc.pdfStorageId)
    : null;
```

---

## 5. Backend

### 5.1 Query — `documents.listByClient`

**Path:** `convex/functions/documents/queries.ts` (archivo nuevo)

**Signature:**

```ts
export const listByClient = query({
  args: {
    clientId: v.id("clients"),
    kinds: v.optional(v.array(v.union(
      v.literal("deliverable"),
      v.literal("quotation"),
      v.literal("contract"),
      v.literal("invoice"),
    ))),
    year: v.optional(v.number()),
    month: v.optional(v.number()),
    serviceName: v.optional(v.string()),
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()), // default 50, max 100
  },
  returns: v.object({
    items: v.array(DocumentListItem),
    cursor: v.union(v.string(), v.null()),
    totalCount: v.number(),
    yearOptions: v.array(v.number()),
    serviceOptions: v.array(v.string()),
  }),
  handler: async (ctx, args) => { /* see logic below */ },
});
```

`DocumentListItem` shape unificada:

```ts
{
  _id: v.string(),          // doc id, prefixed: "del:..." | "quot:..." | "ctr:..." | "inv:..."
  kind: "deliverable" | "quotation" | "contract" | "invoice",
  createdAt: v.number(),
  effectiveAt: v.number(), // deliveredAt || signedAt || lastSentAt || uploadedAt || createdAt
  serviceName: v.union(v.string(), v.null()),
  month: v.union(v.number(), v.null()),
  year: v.union(v.number(), v.null()),
  status: v.string(),       // translated status string
  title: v.string(),        // "Entregable mensual — Marketing — Marzo 2026"
  hasPdf: v.boolean(),
  storageRef: v.union(
    v.object({ type: v.literal("convex"), id: v.id("_storage") }),
    v.object({ type: v.literal("bucket"), key: v.string() }),
    v.null(),
  ),
}
```

### 5.2 Lógica de la query

1. **Auth + tenant guard:** valida que `clientId` pertenece al `orgId` del usuario (Clerk JWT). Si no, retorna empty.
2. **Lee las 3-4 tablas en paralelo:**
   - `deliverables.by_clientId` → mapea a `DocumentListItem` con `kind: "deliverable"`.
   - `quotations.by_clientId` → `kind: "quotation"`.
   - `contracts.by_clientId` → `kind: "contract"`.
   - `invoices.by_clientId` si la tabla existe (si no, salta silenciosamente — feature flag o try-catch).
3. **Aplica filtros:**
   - `kinds`: filtra por tipo.
   - `year`/`month`: filtra docs cuyo `year`/`month` (cuando existe) matchee. Docs sin year/month (contratos anuales) pasan filtro solo si el filtro NO está activo o si `effectiveAt` cae en el año.
   - `serviceName`: filtra por match exacto. "—" (cotizaciones agregadas) se incluye solo cuando filtro no está activo.
4. **Ordena por `effectiveAt` descendente.**
5. **Pagina con cursor:** Convex no tiene cursor nativo para queries multi-tabla, usar offset-based con `pageSize`. Trade-off documentado.
6. **Computa `yearOptions` y `serviceOptions`** del conjunto completo (pre-filtros que NO son year/service) para que los dropdowns se autopobluen.

### 5.3 Action — `documents.getDownloadUrl`

**Path:** `convex/functions/documents/actions.ts` (archivo nuevo, `"use node"`)

**Signature:**

```ts
export const getDownloadUrl = action({
  args: {
    docId: v.string(),              // prefixed id from listByClient
    kind: v.union(
      v.literal("deliverable"),
      v.literal("quotation"),
      v.literal("contract"),
      v.literal("invoice"),
    ),
    variant: v.optional(v.union(    // for deliverables: short vs long PDF
      v.literal("short"),
      v.literal("long"),
    )),
  },
  returns: v.object({
    url: v.string(),
    expiresAt: v.number(),
  }),
  handler: async (ctx, args) => {
    // 1. Strip prefix → real id
    // 2. ctx.runQuery to fetch doc, verify orgId
    // 3. If storageRef.type === "bucket": call signedDownloadUrl({key, expiresSec: 300})
    //    If storageRef.type === "convex": ctx.storage.getUrl(id) (no expiration control)
    // 4. Return { url, expiresAt: Date.now() + 5 * 60 * 1000 }
  },
});
```

**Permission check obligatorio:** la action DEBE verificar `orgId` del doc contra el JWT del caller. Sin esto, un usuario de org A podría descargar docs de org B mandando un docId arbitrario (IDOR).

### 5.4 Multi-tenant isolation tests

Tests obligatorios (`convex/functions/documents/__tests__/queries.test.ts`):

1. Usuario de org A llama `listByClient(clientB.id)` donde clientB pertenece a org B → retorna `items: []`, no leak.
2. Usuario de org A llama `getDownloadUrl(docFromOrgB.id)` → throws `Unauthorized` o retorna empty/error.
3. Filtro `year=2025` con docs en 2025 y 2026 → solo 2025.
4. Filtro `kinds=["deliverable"]` con mezcla → solo deliverables.
5. Filtro `serviceName="Marketing"` con docs de Marketing y Contable → solo Marketing.
6. Combinación de filtros funciona AND.
7. Pagination: pageSize=2 con 5 docs → 3 páginas correctas.

---

## 6. Frontend

### 6.1 Componente principal — `ClientDocumentsSection.tsx`

**Path:** `src/components/clients/ClientDocumentsSection.tsx` (archivo nuevo)

Props:

```ts
{ clientId: Id<"clients"> }
```

Estado local:

```ts
{
  kinds: Set<"deliverable" | "quotation" | "contract" | "invoice">,
  year: number | null,
  month: number | null,
  serviceName: string | null,
  page: number,
}
```

Queries:

```ts
const data = useQuery(api.functions.documents.queries.listByClient, {
  clientId,
  kinds: kinds.size > 0 ? [...kinds] : undefined,
  year: year ?? undefined,
  month: month ?? undefined,
  serviceName: serviceName ?? undefined,
  cursor: pageCursor,
  pageSize: 50,
});
```

### 6.2 Sub-componentes

- `<DocumentFilters>` — barra de chips/dropdowns. Hidrata opciones de `data.yearOptions` y `data.serviceOptions`.
- `<DocumentTable>` — `<table>` semántica con thead/tbody. Una fila por `DocumentListItem`.
- `<DocumentRow>` — usa `useAction(api.functions.documents.actions.getDownloadUrl)` en el handler de click.
- `<DocumentPagination>` — botones prev/next + indicador "Página X de Y".
- `<DocumentEmpty>` — estado vacío con CTA contextual.

### 6.3 Integración en `clientes/[id]/page.tsx`

Cambio mínimo:

```diff
+ import { ClientDocumentsSection } from "@/components/clients/ClientDocumentsSection";

  return (
    <div className="space-y-6">
      {/* ...header + info cards + projections... */}
+     <ClientDocumentsSection clientId={clientId} />
    </div>
  );
```

### 6.4 Click → descarga flow

```
User click 👁 en fila
  ↓
DocumentRow llama getDownloadUrl action con { docId, kind, variant?: "short" }
  ↓
Action verifica orgId, genera signed URL (Railway 5min) o Convex storage URL
  ↓
Frontend recibe { url, expiresAt }
  ↓
window.open(url, "_blank") o <a href={url} download>
```

**UX nota:** mostrar loading state mientras la action corre (puede tardar 200-500ms por el sign de URL).

---

## 7. Performance

### 7.1 Estimación de volumen (worst case post-launch)

- 1 cliente activo × 12 meses × 9 áreas × 1-2 entregables = ~200 deliverables/año.
- 1 cliente × 4 cotizaciones/año = 4.
- 1 cliente × 1 contrato/año = 1.
- 1 cliente × 12 meses × 9 áreas = 108 facturas/año.
- **Total por cliente/año: ~300 documentos.**

A 3 años de operación = ~1000 docs por cliente. Aún manageable con paginación.

### 7.2 Decisiones

- **Cliente con < 500 docs:** carga todos en una query, ordena y pagina client-side. Convex maneja bien colecciones medianas.
- **Cliente con > 500 docs:** pagina server-side con cursor (implementación v2 cuando sea problema).
- **Índices:** las tablas ya tienen `by_clientId` — suficiente. No agregar nuevos índices.

---

## 8. Tests

### 8.1 Backend (vitest + convex-test)

`convex/functions/documents/__tests__/queries.test.ts`:

1. Happy path: cliente con 1 deliverable + 1 cotización + 1 contrato → listByClient retorna 3 items en orden desc.
2. Filtro kinds: solo "deliverable" → solo deliverables.
3. Filtro year: 2025 vs 2026 → segregación correcta.
4. Filtro month: combinado con year.
5. Filtro serviceName: exact match.
6. Combinación de 3 filtros: AND lógico.
7. Multi-tenant: org A no ve docs de org B.
8. yearOptions: docs en 2024 + 2025 + 2026 → retorna [2026, 2025, 2024] (desc).
9. serviceOptions: docs con "Marketing" + "Contable" → retorna unique ordenado.
10. Estado vacío: cliente sin docs → items=[], pero yearOptions=[] y serviceOptions=[].

`convex/functions/documents/__tests__/actions.test.ts`:

1. getDownloadUrl con doc en Convex storage → retorna URL Convex.
2. getDownloadUrl con doc en bucket (mocked) → llama `signedDownloadUrl` del helper.
3. getDownloadUrl cross-org → throws.
4. getDownloadUrl con docId inexistente → throws NotFound.
5. variant "short" vs "long" para deliverable.

### 8.2 Frontend (vitest + @testing-library/react)

`src/components/clients/__tests__/ClientDocumentsSection.test.tsx`:

1. Renderiza loading skeleton mientras query corre.
2. Renderiza tabla cuando data llega.
3. Click en filtro de tipo → re-query con kinds filtrado.
4. Click en filtro de año → dropdown opciones de yearOptions.
5. Click en 👁 → llama action + abre window.
6. Estado vacío sin docs.
7. Estado vacío con filtros restringentes → muestra "Limpiar filtros".

---

## 9. Definition of Done

- [ ] `convex/functions/documents/queries.ts` con `listByClient` implementado y testeado (10+ tests).
- [ ] `convex/functions/documents/actions.ts` con `getDownloadUrl` implementado y testeado (5+ tests).
- [ ] `src/components/clients/ClientDocumentsSection.tsx` integrado en `clientes/[id]/page.tsx`.
- [ ] Tests frontend (7+ tests).
- [ ] `npm test` verde, sin regresiones del suite existente (≥ 426 baseline).
- [ ] `npx tsc --noEmit` clean.
- [ ] Smoke manual: ver entregable de cliente real, ver cotización, ver contrato. Download funciona, signed URL expira a los 5min.
- [ ] Multi-tenant isolation verificada manualmente (login con otra org, verificar que no se ve nada).

---

## 10. Open questions (resolver durante implementación)

1. **¿Necesitamos sort por columna en v1?** Defecto sugerido: ordenar por `effectiveAt` desc. Si operador pide otro orden, agregar en v2.
2. **¿Cómo manejar cotizaciones con múltiples line-items (post-quotation-module spec)?** Hoy `quotations` tiene un `serviceName` único. Cuando cambie a multi-line, decidir si la columna "Servicio" muestra primero / "Multi" / lista.
3. **¿Vista de detalle inline o modal?** v1: abrir PDF en pestaña nueva. v2: modal con metadata + PDF embed + acciones.
4. **¿Auditoría de descargas?** ¿Trackear quién descargó qué cuándo? Útil para clientes corporate. v2.

---

## 11. Estimación

- Backend (queries + action + 15 tests): ~6h
- Frontend (componente + sub-componentes + 7 tests): ~8h
- Integración + smoke manual: ~2h
- **Total: ~2 días de trabajo enfocado.**

Encaja en sprint v2 entre 21-may y 25-may, antes del go-live del 31-may.

---

## 12. Referencias

- Spec maestro de prod-readiness: `2026-05-14-bihive-prod-readiness-design.md`
- Helper bucket: `convex/lib/blobStorage.ts` (branch `feature/blob-storage-railway`)
- Página cliente actual: `src/app/(dashboard)/clientes/[id]/page.tsx` (202 líneas)
- Vista workflow paralela: `src/app/(dashboard)/clientes/[id]/ciclo/page.tsx` (414 líneas)
- ClickUp parent task: `86ahfh6fj` (bucket setup, ya en progreso)
