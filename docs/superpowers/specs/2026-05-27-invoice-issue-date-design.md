# Sub-spec 5 — Invoice issue date vs payment date

**Fecha:** 2026-05-27
**Estado:** Diseño — pendiente approval Christian
**Origen:** `docs/superpowers/specs/2026-05-22-papa-call-scale-pending-detailed-spec.md` §3 Sub-spec 5
**Estimado impl:** 1-2 días (+1 día por parser CFDI mixto)
**Bloquea:** nada

---

## 1. Resumen ejecutivo

Separar fecha fiscal de emisión (`issueDate`) de fecha operativa de upload (`uploadedAt`) en la tabla `invoices`. Captura mixta: auto-extracción del atributo `Fecha` del CFDI XML si se sube junto al PDF, fallback manual si admin lo provee, `undefined` si ninguno. Migración backfill `issueDate = uploadedAt` para rows existentes. Filtro por rango de período fiscal en `/facturacion`. Generación de entregables NO cambia (sigue por `paidAt`).

Requirement raw (D1): "Fecha emisión ≠ fecha pago — factura emitida enero, cobrada diciembre (separar campos)".

## 2. Requirements

- R1. Schema `invoices` agrega `issueDate: v.optional(v.number())` (Unix ms).
- R2. Resolución de `issueDate` en orden: (a) CFDI XML parse, (b) admin manual arg, (c) `undefined`.
- R3. CFDI parser extrae el atributo `Fecha` del elemento root `<cfdi:Comprobante>` (formato ISO `YYYY-MM-DDTHH:MM:SS`).
- R4. Si CFDI parsing falla → log warning, caer a manual arg, NO abortar upload.
- R5. Migración cursor-paginated backfillea rows existentes con `issueDate = uploadedAt`.
- R6. Mutation `updateIssueDate` permite admin editar la fecha post-upload. Rejected si row `status='void'`.
- R7. UI `/facturacion` muestra columna "Emisión" y agrega filtro de rango fecha por `issueDate`.
- R8. Generación de entregables NO cambia — sigue triggered por `paidAt` en `markPaid`.
- R9. Reports filter por issueDate range vive en `/facturacion` (no nueva vista).

## 3. Arquitectura

```
┌────────────────────────────────────────────────────────┐
│  UPLOAD FLOW                                            │
│                                                          │
│   Admin sube PDF [+ CFDI XML opcional] [+ issueDate]    │
│                  │                                       │
│                  ▼                                       │
│   invoices.actions.upload                                │
│    ├─ resolveIssueDate(xmlBuffer, issueDate):           │
│    │    1. if xmlBuffer → parseCfdiIssueDate()          │
│    │    2. else if issueDate arg → use arg              │
│    │    3. else → undefined                             │
│    ├─ uploadBlob(PDF) → Railway S3                      │
│    └─ insertInvoiceRow({ ..., issueDate })              │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│  EDIT FLOW (post-upload)                                 │
│                                                          │
│   Admin clickea "Editar fecha emisión" en una fila      │
│      → updateIssueDate({ invoiceId, issueDate })        │
│      → patch + documentEvents 'updated'                 │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│  REPORTS                                                 │
│                                                          │
│   /facturacion filters:                                  │
│      [Período fiscal: desde] [hasta] → issueDate range  │
│      [Status: all|uploaded|paid|void]                   │
│      [Cliente]                                          │
│   → listForBilling(args) filtra post-query              │
└────────────────────────────────────────────────────────┘
```

## 4. Schema changes

### 4.1 `invoices` — agregar campo

```ts
invoices: defineTable({
  // ...existing fields
  issueDate: v.optional(v.number()), // Unix ms — fecha fiscal de emisión
})
```

Sin nuevos índices. Los filtros aplican post-query en memoria (volumen actual chico; cuando crezca a 2000/mes/org reconsiderar — Sub-spec 7).

## 5. CFDI parser

Nuevo archivo `convex/lib/cfdiParser.ts`:

```ts
export type CfdiParseResult =
  | { ok: true; issueDate: number }
  | { ok: false; reason: string };

export function parseCfdiIssueDate(xmlBuffer: ArrayBuffer): CfdiParseResult;
```

Extrae el atributo `Fecha` del root `<cfdi:Comprobante>`. Convierte ISO datetime → Unix ms. Maneja:
- Namespaces variantes (`cfdi:Comprobante`, sólo `Comprobante`, prefijos diferentes)
- Atributo missing → `{ ok: false, reason: "missing Fecha attribute" }`
- XML malformado → `{ ok: false, reason: "malformed XML" }`
- Fecha inválida → `{ ok: false, reason: "invalid date format" }`

Implementación: regex-based parsing inicial (no full XML DOM — el atributo `Fecha` es siempre en el root y patrón es estable). Si CFDI 4.0 vs 3.3 difieren en el atributo, el parser intenta ambos.

## 6. Flow detallado — upload

`invoices.actions.upload` (modificado):

```ts
args: {
  // ...existing args
  xmlBuffer: v.optional(v.bytes()),
  issueDate: v.optional(v.number()),
}
```

Pseudo-flow después del upload del PDF a Railway S3:

```ts
let resolvedIssueDate: number | undefined;

if (args.xmlBuffer) {
  const result = parseCfdiIssueDate(args.xmlBuffer);
  if (result.ok) {
    resolvedIssueDate = result.issueDate;
  } else {
    console.warn(`[invoice upload] CFDI parse failed: ${result.reason}`);
    resolvedIssueDate = args.issueDate; // fall back to manual
  }
} else {
  resolvedIssueDate = args.issueDate;
}

// Insert row with resolvedIssueDate (may be undefined)
await ctx.runMutation(insertInvoiceRow, { ..., issueDate: resolvedIssueDate });
```

Si el XML provisto pero parse falló Y `issueDate` manual también provisto: usa manual y loguea warning. Si ambos faltan: row queda con `issueDate=undefined` (admin lo puede editar después).

## 7. Mutation `updateIssueDate`

```ts
export const updateIssueDate = mutation({
  args: {
    invoiceId: v.id("invoices"),
    issueDate: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    const inv = await ctx.db.get(args.invoiceId);
    if (!inv || inv.orgId !== orgId) throw new Error("Factura no encontrada");
    if (inv.status === "void") throw new Error("No se puede editar factura cancelada");

    await ctx.db.patch(args.invoiceId, { issueDate: args.issueDate });

    await ctx.runMutation(internal.functions.documentEvents.internal.logEventMutation, {
      orgId,
      clientId: inv.clientId,
      entityType: "invoice",
      entityId: args.invoiceId,
      eventType: "updated",
      severity: "info",
      actorType: "user",
      message: `Fecha de emisión actualizada a ${new Date(args.issueDate).toISOString().slice(0, 10)}`,
    });
  },
});
```

## 8. Migración

`convex/functions/migrations/invoiceIssueDate.ts`:
- Cursor-paginated (patrón firmameProvider de SS2).
- Scan `invoices` con `issueDate === undefined`.
- Patch `issueDate = uploadedAt`.
- Return `{ migrated, done, nextCursor }`.

Idempotente: re-correr no toca rows que ya tienen `issueDate`.

## 9. UI `/facturacion`

### 9.1 Tabla — columna nueva

| Cliente | Servicio | Mes/Año | Monto | **Emisión** | Subido | Status | Pagada | Acciones |

`Emisión` muestra `issueDate ?? uploadedAt` formateado. Si `issueDate === undefined && uploadedAt` se usa, mostrar tooltip "Estimada — falta fecha fiscal" (estilo amber).

### 9.2 Filtros

Agregar arriba de la tabla:

```
Período fiscal: [Desde] - [Hasta]   (filtra por issueDate)
```

State local en la página; pasa args opcionales `issueDateFrom`, `issueDateTo` a `listForBilling`.

### 9.3 Upload modal/form

Campos nuevos:
- File picker "CFDI XML (opcional)" — acepta `.xml`
- Date picker "Fecha de emisión (opcional)" — disabled si XML está cargado y se extrajo fecha; muestra preview

### 9.4 Editar issueDate inline

Botón "Editar fecha emisión" en cada fila (drop-down menu de acciones). Abre modal con date picker. Llama `updateIssueDate`. Sólo visible si user es admin.

## 10. Queries — `listForBilling`

Agregar args opcionales:
```ts
issueDateFrom: v.optional(v.number()),
issueDateTo: v.optional(v.number()),
```

Filter post-query:
```ts
if (args.issueDateFrom !== undefined) {
  rows = rows.filter(r => (r.issueDate ?? r.uploadedAt) >= args.issueDateFrom!);
}
if (args.issueDateTo !== undefined) {
  rows = rows.filter(r => (r.issueDate ?? r.uploadedAt) <= args.issueDateTo!);
}
```

Fallback a `uploadedAt` para rows sin `issueDate` (cubre rows pre-migración o casos edge).

## 11. Error handling

| Caso | Comportamiento |
|---|---|
| CFDI XML malformado | log warning, fall back a manual arg, upload procede |
| CFDI Fecha attribute missing | log warning, fall back a manual arg, upload procede |
| Fecha format inválido en CFDI | log warning, fall back, upload procede |
| Manual arg + XML válido | XML gana (más confiable que dato manual) |
| updateIssueDate en void | throw "No se puede editar factura cancelada" |
| listForBilling con range invertido (`from > to`) | UI valida; backend ignora si pasa |

## 12. Testing

**Unit (~10 tests):**
- `parseCfdiIssueDate`:
  - CFDI 4.0 válido → fecha extraída correctamente
  - CFDI 3.3 válido (sin prefijo) → fecha extraída
  - XML sin atributo Fecha → `{ ok: false, reason: "missing Fecha attribute" }`
  - XML malformado → `{ ok: false }`
  - Atributo Fecha con formato inválido → `{ ok: false }`
- `updateIssueDate`:
  - Admin actualiza row uploaded → OK
  - No-admin → reject (requireAdmin)
  - Cross-org → reject
  - Row void → throw

**Integration (~5 tests):**
- Upload con XML válido → invoice.issueDate matches parseado
- Upload con XML inválido + manual issueDate → invoice.issueDate matches manual
- Upload sin XML, sin manual → invoice.issueDate undefined
- Upload con ambos (XML válido + manual) → XML gana
- Migration backfillea undefined → uploadedAt, idempotente

**Target:** ~905 + 15 = ~920 tests.

## 13. Decisiones diferidas

1. Reporte dedicado `/facturacion/reportes` con export Excel — sub-spec separado.
2. Status "fecha estimada vs fiscal" visible explícitamente en UI — defer; tooltip simple por ahora.
3. Si CFDI marca factura cancelada en SAT (status='C') → detectar y warn. V2 con `facturapiInvoiceId` integration.
4. Soporte para múltiples comprobantes (XML con varios CFDIs) — defer, V1 es 1 PDF = 1 row.
5. UX para "factura emitida pero NO uploaded aún" — V2 cuando integremos generación CFDI desde Projex.

## 14. Migración / rollout

1. Apply schema change → `npx convex dev --once`.
2. Implement parser + tests.
3. Implement migration internal mutation + test.
4. Run migration en dev (probablemente 0 rows hoy, validar idempotent).
5. Implement upload action changes + tests.
6. Implement updateIssueDate mutation + tests.
7. Implement query filter args + tests.
8. UI changes en `/facturacion` (tabla + filtros + upload form + edit modal).
9. Manual smoke: subir factura con XML, verificar fecha extraída; subir solo PDF + manual, verificar; filtrar por rango.
10. Cuando merge a main: correr migración en prod via `npx convex run internal:functions:migrations:invoiceIssueDate:migrate '{}'`.

## 15. Métricas de éxito

- Tests ≥ ~920 passing.
- TypeScript clean.
- Smoke: subir 2 facturas (1 con XML, 1 sin) → ambas appear en tabla; filtro por rango funciona.
- Migración idempotente verificable.

## 16. Próximo paso

Después de approval → invocar `superpowers:writing-plans` para plan detallado (estimado ~10 tareas TDD, 1-2 días impl).
