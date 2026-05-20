# A3 — Document Lifecycle

**Fecha:** 2026-05-23
**Sub-spec del maestro:** `docs/superpowers/specs/2026-05-20-prod-readiness-revision.md`
**Estado:** propuesto
**Días estimados:** 3 (1 d schema+mutations invoices+documentEvents, 1 d action `generateFromInvoice`+selector+cron, 1 d UI `/facturacion` refactor + `/platform/audit` + tests)
**Owner:** Christian
**Dependencias:** R1 aprobado, A1 mergeado (schema `subservices` + `subserviceId` opcional en 6 tablas), A2 mergeado (`templateVersion` snapshot + permisos org-scope).

---

## 1. Objetivo

A3 cierra el flujo crítico que convierte a Projex en un producto operable para
el beta del 31-may: el operador sube manualmente un PDF de factura V1, la marca
como pagada, y el sistema dispara la generación del entregable correcto para
ese cliente, mes y subservicio — usando la plantilla snapshot (A2) y el
selector frecuencia-aware nuevo. Toda generación queda auditada y referenciable
desde la factura origen.

Cambios concretos:

1. **Tabla nueva `invoices`** que persiste el ciclo factura V1 manual (upload
   → uploaded → paid o void). Acoplada a Railway blob storage para el PDF.
2. **Mutation `invoices.markPaid`** como **único gate humano** que dispara
   generación de entregable. El cron diario de eligibility NO genera (R1
   §12.9): solo manda recordatorios al operador "toca subir factura de
   cliente Y para mes M". Eso preserva el operador en el loop.
3. **Action `deliverables.generateFromInvoice`** que coordina:
   selector frecuencia-aware → engine existente (sin tocar Claude pipeline) →
   PDF puppeteer → upload Railway → insert deliverable con `triggerSource =
   "invoice_paid"`, `triggerInvoiceId`, y el snapshot de plantilla introducido
   en A2.
4. **Refactor `findTemplate` → `selectDeliverableForMonth`** que reemplaza el
   match por `serviceName` exacto por un selector que entiende
   `subserviceId`, `defaultFrequency`, `applicableMonths`, `cooldownMonths`,
   y deja hook `getOverride()` listo para junio (R1 §12.8).
5. **Cron daily `deliverable-eligibility-scan`** que recorre orgs activos en
   la timezone de cada uno (R1 §12.13), evalúa qué subservicios tocan hoy
   sin invoice pagada, y notifica al operador (1 email/cliente/día cap).
6. **Tabla `documentEvents` + wrapper `logEvent`** invocado desde las
   mutations de invoices, de `generateFromInvoice`, del cron, y de las
   futuras de plantillas (A2 ya dejó el `TODO` listo).
7. **UI `/facturacion`** refactorizada para soportar upload PDF y marcar
   pagada. Tab "Documentos" del cliente (rama `feature/client-documents-tab`)
   empieza a poblar la columna "Facturas" automáticamente sin modificación.
8. **Página `/platform/audit`** minimalista (tabla + filtros) para super-admin
   ver `documentEvents` cross-org.

Lo que A3 NO toca (heredado intacto):

- Engine Claude (`convex/functions/deliverables/actions.ts:215+`). Se invoca
  con un context de plantilla snapshot ya resuelto; el batch fill, retries,
  cost cap siguen idénticos a hoy.
- `monthlyAssignments` schema (R1 §12.10): se mantiene con 12 filas siempre,
  con `invoiceStatus` enum existente. La nueva tabla `invoices` corre en
  paralelo. A3 sincroniza `monthlyAssignments.invoiceStatus = "paid"` al
  markPaid para no romper UI legacy, pero la fuente de verdad para el trigger
  es `invoices.status`.
- `questionnaireResponses`: no se modifica.
- Tab Documentos del cliente: solo se garantiza que su filtro "Facturas"
  empiece a recibir rows; no se cambia el componente.

---

## 2. Schema

Diff sobre `convex/schema.ts`. Una sola migración añade los tres bloques.

### 2.1 Tabla nueva `invoices`

```ts
invoices: defineTable({
  orgId: v.string(),
  clientId: v.id("clients"),
  projectionId: v.id("projections"),
  projServiceId: v.optional(v.id("projectionServices")),
  subserviceId: v.optional(v.id("subservices")),
  serviceName: v.string(),               // snapshot textual para auditoría/lecturas legacy
  monthlyAssignmentId: v.optional(v.id("monthlyAssignments")),
  // Mes calendario (no mes fiscal) al que aplica la factura.
  month: v.number(),                     // 1-12
  year: v.number(),
  amount: v.number(),                    // MXN
  // Blob storage (Railway)
  bucketKey: v.string(),                 // p.ej. "{orgId}/{clientId}/invoices/{slug}.pdf"
  contentType: v.string(),               // "application/pdf"
  sizeBytes: v.number(),
  filename: v.string(),                  // original que subió el operador, audit-friendly
  // Lifecycle
  status: v.union(
    v.literal("uploaded"),    // PDF subido, falta cobro
    v.literal("paid"),        // operador clickeó "marcar pagada" — triggea entregable
    v.literal("void")         // cancelada (admin only)
  ),
  uploadedAt: v.number(),
  uploadedBy: v.string(),                // identity.subject del operador
  paidAt: v.optional(v.number()),
  paidBy: v.optional(v.string()),
  voidedAt: v.optional(v.number()),
  voidedBy: v.optional(v.string()),
  voidReason: v.optional(v.string()),
  notes: v.optional(v.string()),
  // V2 hooks (no se usan en beta; presentes para evitar migración futura)
  facturapiInvoiceId: v.optional(v.string()),
  cfdiUuid: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_orgId", ["orgId"])
  .index("by_orgId_clientId", ["orgId", "clientId"])
  .index("by_orgId_clientId_year_month", ["orgId", "clientId", "year", "month"])
  .index("by_orgId_status", ["orgId", "status"])
  .index("by_projServiceId", ["projServiceId"])
  .index("by_monthlyAssignmentId", ["monthlyAssignmentId"]),
```

**Notas de diseño:**

- `projServiceId` y `subserviceId` opcionales. En beta el operador siempre
  los pasa desde la UI (tiene contexto), pero el schema los marca opcionales
  para tolerar facturas legacy (V2 emisión automática puede recibir webhook
  sin `projServiceId` mapeable en primera pasada).
- `serviceName` se duplica como snapshot por la misma razón que en
  `deliverables.serviceName`: si el subservicio se renombra o desactiva, la
  factura preserva el label original.
- `bucketKey` usa el helper `buildKey` de `convex/lib/blobStorage.ts:45-53`
  con kind `"invoices"` (ya existe en el union, línea 16).
- **No hay constraint único en Convex** para `(clientId, year, month,
  subserviceId)`. Patrón query-then-insert detecta duplicados en
  `invoices.upload`: si ya existe row para misma tupla con status ≠ "void",
  se inserta de todos modos y se devuelve un flag `duplicateOf: <id>` al
  cliente. El operador decide manualmente si markPaid en una u otra. V1
  manual puede tener facturas legítimas duplicadas (correcciones, pagos
  parciales); rechazar duro sería demasiado.
- `monthlyAssignmentId` opcional crea el join 1-1 cuando aplica. Hace de
  cursor para que `markPaid` patch'ee `monthlyAssignments.invoiceStatus =
  "paid"` sin re-buscar.

### 2.2 Campos nuevos en `deliverables`

Diff sobre `convex/schema.ts:328-367`:

```ts
deliverables: defineTable({
  orgId: v.string(),
  assignmentId: v.id("monthlyAssignments"),
  projServiceId: v.id("projectionServices"),
  clientId: v.id("clients"),
  serviceName: v.string(),
  subserviceId: v.optional(v.id("subservices")),         // A1
  month: v.number(),
  year: v.number(),
  shortContent: v.string(),
  longContent: v.string(),
  shortPdfStorageId: v.optional(v.id("_storage")),
  longPdfStorageId: v.optional(v.id("_storage")),
  // A2 — snapshot de plantilla
  templateId: v.optional(v.id("deliverableTemplates")),
  templateVersion: v.optional(v.number()),
  templateHtmlSnapshot: v.optional(v.string()),
  // A3 — origen del trigger (decisión R1 §12.5)
  triggerSource: v.optional(v.union(
    v.literal("manual"),
    v.literal("cron"),
    v.literal("invoice_paid"),
    v.literal("api")
  )),
  triggerInvoiceId: v.optional(v.id("invoices")),        // setear si triggerSource === "invoice_paid"
  auditStatus: v.union(
    v.literal("pending"),
    v.literal("approved"),
    v.literal("rejected"),
    v.literal("corrected")
  ),
  auditFeedback: v.optional(v.string()),
  retryCount: v.number(),
  aiLog: v.optional(/* ... existente ... */),
  deliveredAt: v.optional(v.number()),
  createdAt: v.number(),
})
  // Índices existentes preservados.
  .index("by_orgId", ["orgId"])
  .index("by_assignmentId", ["assignmentId"])
  .index("by_clientId", ["clientId"])
  .index("by_orgId_auditStatus", ["orgId", "auditStatus"])
  .index("by_orgId_year_month", ["orgId", "year", "month"])
  // Nuevo: para idempotencia en generateFromInvoice
  .index("by_triggerInvoiceId", ["triggerInvoiceId"]),
```

Backfill (R1 §12.5): todo registro legacy queda `triggerSource: null,
triggerInvoiceId: null`. UI / audit filtran por presencia.

### 2.3 Tabla nueva `documentEvents`

```ts
documentEvents: defineTable({
  orgId: v.string(),
  clientId: v.optional(v.id("clients")),
  entityType: v.union(
    v.literal("deliverable"),
    v.literal("invoice"),
    v.literal("quotation"),
    v.literal("contract"),
    v.literal("template"),
    v.literal("subservice"),     // hook para A1 que dejó TODO
    v.literal("questionnaire")
  ),
  entityId: v.string(),          // string libre (id del row); permite poly-ref sin v.union de v.id
  eventType: v.union(
    v.literal("created"),
    v.literal("updated"),
    v.literal("sent"),
    v.literal("signed"),
    v.literal("paid"),
    v.literal("generated"),
    v.literal("audited"),
    v.literal("deleted"),
    v.literal("personalized"),    // copy-on-write A2
    v.literal("restored"),        // futuro: rollback
    v.literal("reminder_sent"),
    v.literal("uploaded"),
    v.literal("voided"),
    v.literal("error")
  ),
  severity: v.union(
    v.literal("info"),
    v.literal("warning"),
    v.literal("error")
  ),
  actorUserId: v.optional(v.string()),   // null = cron/system
  actorType: v.union(
    v.literal("user"),
    v.literal("cron"),
    v.literal("system"),
    v.literal("client_link")  // futuro: cliente vía signed URL
  ),
  message: v.string(),
  metadata: v.optional(v.any()),         // contexto extra (templateVersion, errorStack, etc.)
  createdAt: v.number(),
})
  .index("by_orgId_createdAt", ["orgId", "createdAt"])
  .index("by_orgId_clientId_createdAt", ["orgId", "clientId", "createdAt"])
  .index("by_orgId_entityType_entityId", ["orgId", "entityType", "entityId"])
  .index("by_orgId_severity_createdAt", ["orgId", "severity", "createdAt"])
  .index("by_orgId_eventType_createdAt", ["orgId", "eventType", "createdAt"]),
```

**Diseño append-only:** no se expone mutation `update` ni `delete`. El TTL /
retención queda para post-beta (R1 §11 O15). Si bloat se vuelve problema, se
hace cleanup vía script CLI manual (no cron).

`entityId` es `v.string()` y no `v.union(v.id(...), ...)` deliberadamente:
mantener el tipo unificado simplifica el wrapper `logEvent` (un solo
`{entityType, entityId}` siempre) y la query `by_orgId_entityType_entityId`.
La pérdida de type-safety es aceptable: el log es write-mostly, las pocas
lecturas que dereferencian el id usan `ctx.db.get(id as Id<...>)` validado
por `entityType`.

### 2.4 Campos nuevos en `orgConfigs`

Diff sobre `convex/schema.ts:369-391`:

```ts
orgConfigs: defineTable({
  orgId: v.string(),
  calculationMode: v.union(/* ... */),
  commissionMode: v.union(/* ... */),
  seasonalityEnabled: v.boolean(),
  featureFlags: v.object({/* ... */}),
  currency: v.optional(v.string()),
  fiscalYearStartMonth: v.optional(v.number()),
  notificationEmail: v.optional(v.string()),    // ya existe (línea 388)
  timezone: v.optional(v.string()),             // NUEVO — IANA, ej. "America/Mexico_City"
  updatedAt: v.number(),
}).index("by_orgId", ["orgId"]),
```

Decisión R1 §12.13: default UTC si el campo es `null`/`undefined`. A3 lo lee
en el cron eligibility para evaluar qué generar HOY en zona local de cada
org. Si una org tiene timezone seteada, los recordatorios consideran sáb-dom
de su zona, no UTC.

UI para editar `timezone` queda en D2 (página `/configuracion/general` o
similar). A3 solo agrega el campo al schema y a la mutation de update de
`orgConfigs`. Si falta D2 al deadline, super-admin lo setea vía Convex
dashboard por org (1-3 orgs en beta).

---

## 3. Backend

### 3.1 Módulo nuevo `convex/functions/invoices/`

Archivos: `queries.ts`, `mutations.ts`, `actions.ts` (para upload Node-side),
`internalQueries.ts`, `internalActions.ts`.

#### 3.1.1 `actions.ts` — `upload`

`upload` es un `action` (no mutation) porque toca Railway S3 vía blobStorage
helper, que requiere `"use node"`. Recibe el buffer del PDF y orquesta:

```ts
"use node";

import { action } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";
import { buildKey, uploadBlob } from "../../lib/blobStorage";

export const upload = action({
  args: {
    clientId: v.id("clients"),
    projectionId: v.id("projections"),
    projServiceId: v.optional(v.id("projectionServices")),
    subserviceId: v.optional(v.id("subservices")),
    serviceName: v.string(),
    monthlyAssignmentId: v.optional(v.id("monthlyAssignments")),
    month: v.number(),       // 1-12
    year: v.number(),
    amount: v.number(),
    filename: v.string(),
    contentType: v.string(),
    fileBuffer: v.bytes(),   // ArrayBuffer en wire format
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ invoiceId: Id<"invoices">; duplicateOf?: Id<"invoices"> }> => {
    const { userId, orgId } = await ctx.runQuery(internal.functions.invoices.internalQueries.requireAuthCtx, {});

    // 1. Validar pertenencia del cliente al org.
    const client = await ctx.runQuery(internal.functions.invoices.internalQueries.getClientForOrg, {
      clientId: args.clientId,
      orgId,
    });
    if (!client) throw new Error("Cliente no encontrado o no pertenece al org.");

    if (args.month < 1 || args.month > 12) throw new Error("Mes inválido.");
    if (!Number.isFinite(args.amount) || args.amount < 0) throw new Error("Monto inválido.");
    if (args.contentType !== "application/pdf") throw new Error("Solo PDFs aceptados en V1.");

    // 2. Detectar duplicado (mismo cliente+año+mes+subservicio) NO void.
    const duplicate = await ctx.runQuery(
      internal.functions.invoices.internalQueries.findDuplicate,
      {
        orgId,
        clientId: args.clientId,
        year: args.year,
        month: args.month,
        subserviceId: args.subserviceId,
      }
    );

    // 3. Subir blob — primero a Railway, luego insertar row (R1 §10 R7).
    const safeFilename = args.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
    const suffix = `${args.year}-${String(args.month).padStart(2, "0")}-${Date.now()}-${safeFilename}`;
    const bucketKey = buildKey({
      orgId,
      clientId: args.clientId,
      kind: "invoices",
      suffix,
    });

    await uploadBlob({
      buffer: Buffer.from(args.fileBuffer),
      key: bucketKey,
      contentType: args.contentType,
    });
    // Si falla, el throw propaga y NO se inserta row. Sin huérfano en DB.

    // 4. Insertar row + log evento via internal mutation atómica.
    const invoiceId = await ctx.runMutation(
      internal.functions.invoices.internalActions.insertInvoiceRow,
      {
        orgId,
        clientId: args.clientId,
        projectionId: args.projectionId,
        projServiceId: args.projServiceId,
        subserviceId: args.subserviceId,
        serviceName: args.serviceName,
        monthlyAssignmentId: args.monthlyAssignmentId,
        month: args.month,
        year: args.year,
        amount: args.amount,
        bucketKey,
        contentType: args.contentType,
        sizeBytes: args.fileBuffer.byteLength,
        filename: safeFilename,
        notes: args.notes,
        uploadedBy: userId,
        duplicateOfId: duplicate?._id,
      }
    );

    // 5. Notificar cliente via Resend con signed URL.
    await ctx.scheduler.runAfter(0, internal.functions.invoices.internalActions.notifyClientUploaded, {
      invoiceId,
    });

    return { invoiceId, duplicateOf: duplicate?._id };
  },
});
```

`internalActions.insertInvoiceRow` es una `internalMutation` (no
`internalAction` pese al nombre) que dentro de una sola transacción Convex:

1. `db.insert("invoices", { ..., status: "uploaded", createdAt: now, uploadedAt: now })`.
2. Si `monthlyAssignmentId` presente: `db.patch(monthlyAssignmentId, { invoiceStatus: "invoiced" })`.
3. `logEvent(ctx, { entityType: "invoice", entityId: newId, eventType: "uploaded", actorUserId: uploadedBy, actorType: "user", message: "Factura subida: $X de cliente Y para mes M" })`.
4. Si `duplicateOfId` presente: `logEvent` con severity="warning" y metadata={duplicateOf}.

`internalActions.notifyClientUploaded` (real action, "use node"): resuelve
destinatario via `clients.contactEmail` (consistente con notification
recipient spec `2026-05-19`), genera signed URL via `signedDownloadUrl`
helper, llama `internal.functions.email.send.sendEmailInternal` con
asunto+body+link. Si `contactEmail` ausente, skip + log severity="info".

#### 3.1.2 `mutations.ts`

```ts
import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgId, requireAdmin, requireAuth } from "../../lib/authHelpers";
import { internal } from "../../_generated/api";

export const markSent = mutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    // En beta, markSent es opcional (operador puede saltarlo y solo markPaid).
    // Lo dejamos por simetría: notifica al cliente que la factura fue enviada
    // por fuera de banda (correo manual) sin tocar el bucket.
    await requireAuth(ctx);
    const orgId = await getOrgId(ctx);
    const inv = await ctx.db.get(args.invoiceId);
    if (!inv || inv.orgId !== orgId) throw new Error("Factura no encontrada.");
    if (inv.status !== "uploaded") throw new Error("Solo facturas en estado 'uploaded' pueden marcarse enviadas.");
    // NO hay status "sent" en el enum (decisión: lo simulamos vía logEvent solo).
    // Razón: en V1 el operador siempre envía por fuera y solo marca paid.
    await ctx.runMutation(internal.functions.documentEvents.internal.logEventMutation, {
      orgId,
      clientId: inv.clientId,
      entityType: "invoice",
      entityId: args.invoiceId,
      eventType: "sent",
      severity: "info",
      actorType: "user",
      message: `Factura ${inv.filename} marcada como enviada.`,
    });
    return { ok: true };
  },
});

export const markPaid = mutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const orgId = await getOrgId(ctx);
    const userId = (await ctx.auth.getUserIdentity())!.subject;

    const inv = await ctx.db.get(args.invoiceId);
    if (!inv || inv.orgId !== orgId) throw new Error("Factura no encontrada.");
    if (inv.status === "void") throw new Error("Factura cancelada no puede marcarse pagada.");
    if (inv.status === "paid") {
      // Idempotencia (R1 §10 R4): no re-encolar, no re-emitir evento crítico.
      // Re-llamada legítima del operador (doble click) o reintento de UI.
      return { ok: true, alreadyPaid: true };
    }

    const now = Date.now();
    await ctx.db.patch(args.invoiceId, {
      status: "paid",
      paidAt: now,
      paidBy: userId,
    });

    // Sync monthlyAssignments.invoiceStatus si existe link (compatibilidad UI legacy).
    if (inv.monthlyAssignmentId) {
      const ma = await ctx.db.get(inv.monthlyAssignmentId);
      if (ma && ma.orgId === orgId && ma.invoiceStatus !== "paid") {
        await ctx.db.patch(inv.monthlyAssignmentId, { invoiceStatus: "paid" });
      }
    }

    // Log evento (severity="info", éste es el trigger crítico — visible en audit).
    await ctx.runMutation(internal.functions.documentEvents.internal.logEventMutation, {
      orgId,
      clientId: inv.clientId,
      entityType: "invoice",
      entityId: args.invoiceId,
      eventType: "paid",
      severity: "info",
      actorUserId: userId,
      actorType: "user",
      message: `Factura ${inv.filename} marcada pagada. Encolando generación de entregable.`,
      metadata: { amount: inv.amount, year: inv.year, month: inv.month },
    });

    // Encolar generación. NO await aquí — schedule.runAfter(0) es fire-and-forget.
    await ctx.scheduler.runAfter(
      0,
      internal.functions.deliverables.actions.generateFromInvoice,
      { invoiceId: args.invoiceId }
    );

    return { ok: true, alreadyPaid: false };
  },
});

export const markVoid = mutation({
  args: {
    invoiceId: v.id("invoices"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);   // admin only — destructivo
    const orgId = await getOrgId(ctx);
    const userId = (await ctx.auth.getUserIdentity())!.subject;
    const inv = await ctx.db.get(args.invoiceId);
    if (!inv || inv.orgId !== orgId) throw new Error("Factura no encontrada.");
    if (inv.status === "void") return { ok: true, alreadyVoid: true };

    const now = Date.now();
    await ctx.db.patch(args.invoiceId, {
      status: "void",
      voidedAt: now,
      voidedBy: userId,
      voidReason: args.reason,
    });

    // Si había monthly assignment marcado paid por esta factura, no se revierte
    // automáticamente (puede haber otra factura legítima cubriendo el mes).
    // El operador hace markInvoiceStatus="not_invoiced" manualmente si aplica.

    // Si ya había deliverable generado por esta factura, NO se borra (audit trail).
    // Solo se loggea como "facturada void post-generación" — visible en audit.

    await ctx.runMutation(internal.functions.documentEvents.internal.logEventMutation, {
      orgId,
      clientId: inv.clientId,
      entityType: "invoice",
      entityId: args.invoiceId,
      eventType: "voided",
      severity: "warning",
      actorUserId: userId,
      actorType: "user",
      message: `Factura ${inv.filename} cancelada. Razón: ${args.reason}`,
      metadata: { reason: args.reason, previousStatus: inv.status },
    });

    return { ok: true, alreadyVoid: false };
  },
});
```

#### 3.1.3 `queries.ts`

```ts
import { query } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgIdSafe, requireAuth } from "../../lib/authHelpers";

export const listByClient = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];
    return await ctx.db
      .query("invoices")
      .withIndex("by_orgId_clientId", (q) =>
        q.eq("orgId", orgId).eq("clientId", args.clientId)
      )
      .order("desc")
      .collect();
  },
});

export const listForBilling = query({
  args: {
    year: v.number(),
    month: v.optional(v.number()),
    status: v.optional(v.union(
      v.literal("uploaded"),
      v.literal("paid"),
      v.literal("void")
    )),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];
    let q = ctx.db
      .query("invoices")
      .withIndex("by_orgId", (qb) => qb.eq("orgId", orgId));
    let rows = await q.collect();
    rows = rows.filter((r) => r.year === args.year);
    if (args.month !== undefined) rows = rows.filter((r) => r.month === args.month);
    if (args.status) rows = rows.filter((r) => r.status === args.status);
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const getById = query({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;
    const inv = await ctx.db.get(args.invoiceId);
    if (!inv || inv.orgId !== orgId) return null;
    return inv;
  },
});
```

Query separado para obtener signed URL del blob (action, no query, porque
toca Node):

```ts
// invoices/actions.ts — extra export
export const getDownloadUrl = action({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const inv = await ctx.runQuery(internal.functions.invoices.internalQueries.getInvoiceForOrg, {
      invoiceId: args.invoiceId,
    });
    if (!inv) throw new Error("Factura no encontrada.");
    return await signedDownloadUrl({ bucketKey: inv.bucketKey, expiresSec: 60 * 60 });
  },
});
```

### 3.2 Action nueva: `deliverables.generateFromInvoice`

Archivo: `convex/functions/deliverables/actions.ts` (extender, no crear
nuevo). Es un `internalAction` — no expuesto a Clerk-auth public, solo
invocable vía `ctx.scheduler`.

```ts
export const generateFromInvoice = internalAction({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => {
    // 1. Cargar invoice + verificar status.
    const invoice = await ctx.runQuery(
      internal.functions.invoices.internalQueries.getInvoiceForGeneration,
      { invoiceId }
    );
    if (!invoice) {
      console.warn(`[generateFromInvoice] invoice ${invoiceId} no encontrada — race con void?`);
      return { ok: false, reason: "invoice_not_found" };
    }
    if (invoice.status !== "paid") {
      console.warn(`[generateFromInvoice] invoice ${invoiceId} status=${invoice.status} — abort`);
      return { ok: false, reason: "invoice_not_paid" };
    }

    // 2. Idempotencia (R1 §10 R4): si ya existe deliverable con triggerInvoiceId=this, skip.
    const existing = await ctx.runQuery(
      internal.functions.deliverables.internalQueries.findByTriggerInvoiceId,
      { invoiceId }
    );
    if (existing) {
      await ctx.runMutation(internal.functions.documentEvents.internal.logEventMutation, {
        orgId: invoice.orgId,
        clientId: invoice.clientId,
        entityType: "invoice",
        entityId: invoiceId,
        eventType: "generated",
        severity: "warning",
        actorType: "system",
        message: `Idempotencia: deliverable ${existing._id} ya existe para invoice ${invoiceId}; skip.`,
        metadata: { existingDeliverableId: existing._id },
      });
      return { ok: true, reason: "idempotent_skip", deliverableId: existing._id };
    }

    // 3. Resolver projection y mode (rolling vs fiscal) para mapear mes correcto.
    const projection = await ctx.runQuery(
      internal.functions.deliverables.internalQueries.getProjectionByProjService,
      { projectionId: invoice.projectionId }
    );
    if (!projection) {
      await ctx.runMutation(internal.functions.documentEvents.internal.logEventMutation, {
        orgId: invoice.orgId,
        clientId: invoice.clientId,
        entityType: "invoice",
        entityId: invoiceId,
        eventType: "error",
        severity: "error",
        actorType: "system",
        message: `Proyección ${invoice.projectionId} no encontrada.`,
      });
      return { ok: false, reason: "projection_missing" };
    }

    // 4. Selector nuevo: selectDeliverableForMonth.
    const selected = await ctx.runQuery(
      internal.functions.deliverables.internalQueries.selectDeliverableForMonth,
      {
        orgId: invoice.orgId,
        clientId: invoice.clientId,
        subserviceId: invoice.subserviceId,
        serviceId: undefined,                    // dual-matching, ver §3.3
        serviceName: invoice.serviceName,
        month: invoice.month,
        year: invoice.year,
        projectionMode: projection.projectionMode ?? "rolling",
        templateType: "deliverable_short",       // beta default; UI puede pasar long
      }
    );

    if (!selected) {
      await ctx.runMutation(internal.functions.documentEvents.internal.logEventMutation, {
        orgId: invoice.orgId,
        clientId: invoice.clientId,
        entityType: "invoice",
        entityId: invoiceId,
        eventType: "error",
        severity: "warning",
        actorType: "system",
        message: `No hay plantilla aplicable para subservicio ${invoice.serviceName} en mes ${invoice.month}/${invoice.year}. Operador puede generar manualmente.`,
        metadata: { subserviceId: invoice.subserviceId, month: invoice.month, year: invoice.year },
      });
      // Notificar al operador que falta plantilla — usa orgConfigs.notificationEmail.
      await ctx.scheduler.runAfter(0, internal.functions.invoices.internalActions.notifyOperatorNoTemplate, {
        invoiceId,
      });
      return { ok: false, reason: "no_template" };
    }

    // 5. Resolver el monthlyAssignment correcto si no viene en la factura.
    let assignmentId = invoice.monthlyAssignmentId;
    if (!assignmentId) {
      const ma = await ctx.runQuery(
        internal.functions.deliverables.internalQueries.findAssignmentForInvoice,
        {
          orgId: invoice.orgId,
          clientId: invoice.clientId,
          projServiceId: invoice.projServiceId,
          month: invoice.month,
          year: invoice.year,
        }
      );
      if (!ma) {
        await ctx.runMutation(internal.functions.documentEvents.internal.logEventMutation, {
          orgId: invoice.orgId,
          clientId: invoice.clientId,
          entityType: "invoice",
          entityId: invoiceId,
          eventType: "error",
          severity: "error",
          actorType: "system",
          message: "No se encontró monthlyAssignment compatible para la factura.",
        });
        return { ok: false, reason: "no_assignment" };
      }
      assignmentId = ma._id;
    }

    // 6. Reusar lógica existente de `deliverables.generate` con un payload que
    //    fuerza el template snapshot (sustituye el findTemplate interno).
    //    La función `generate` (líneas 180-360 de actions.ts hoy) recibe args
    //    expandidos para aceptar templateOverride. A3 patch: añade optional
    //    `templateOverride: { id, version, htmlSnapshot, type, variables }`.
    //    Si presente, generate salta el findTemplate y usa el override.

    const result = await ctx.runAction(
      internal.functions.deliverables.actions.generate,
      {
        assignmentId,
        clientId: invoice.clientId,
        templateType: "deliverable_short",
        triggerSource: "invoice_paid",
        triggerInvoiceId: invoiceId,
        templateOverride: {
          templateId: selected.template._id,
          templateVersion: selected.template.version ?? 1,
          templateHtmlSnapshot: selected.template.htmlTemplate,
          variables: selected.template.variables ?? [],
        },
      }
    );

    if (!result.ok) {
      await ctx.runMutation(internal.functions.documentEvents.internal.logEventMutation, {
        orgId: invoice.orgId,
        clientId: invoice.clientId,
        entityType: "invoice",
        entityId: invoiceId,
        eventType: "error",
        severity: "error",
        actorType: "system",
        message: `Generación falló: ${result.error ?? "unknown"}`,
        metadata: { error: result.error, deliverableId: result.deliverableId },
      });
      return { ok: false, reason: "generation_failed", error: result.error };
    }

    // 7. Log éxito + notify ejecutivo via notification recipient spec.
    await ctx.runMutation(internal.functions.documentEvents.internal.logEventMutation, {
      orgId: invoice.orgId,
      clientId: invoice.clientId,
      entityType: "deliverable",
      entityId: result.deliverableId,
      eventType: "generated",
      severity: "info",
      actorType: "system",
      message: `Entregable generado desde factura ${invoice.filename}.`,
      metadata: {
        triggerInvoiceId: invoiceId,
        templateId: selected.template._id,
        templateVersion: selected.template.version,
      },
    });

    await ctx.scheduler.runAfter(0, internal.functions.deliverables.internalActions.notifyExecutiveGenerated, {
      deliverableId: result.deliverableId,
    });

    return { ok: true, deliverableId: result.deliverableId };
  },
});
```

**Cambios mínimos a `deliverables.generate` para soportar override:** ver
§3.3.5. La intención es que `generate` siga sirviendo el flujo manual sin
cambios de signature público (UI sigue llamando igual); el `templateOverride`
es campo opcional nuevo.

### 3.3 Refactor `findTemplate` → `selectDeliverableForMonth`

Archivo: `convex/functions/deliverables/internalQueries.ts`. El nuevo
`selectDeliverableForMonth` reemplaza el `findTemplate` actual (línea 48-74).
**`findTemplate` se mantiene exportado** durante una ventana de
backward-compat — `deliverables.actions.ts:215` migra a llamar al nuevo. Otros
callsites (si aparecen post-merge) tienen una semana para migrar; luego se
elimina.

#### 3.3.1 Signature

```ts
export const selectDeliverableForMonth = internalQuery({
  args: {
    orgId: v.string(),
    clientId: v.id("clients"),
    subserviceId: v.optional(v.id("subservices")),
    serviceId: v.optional(v.id("services")),       // fallback legacy
    serviceName: v.optional(v.string()),           // fallback legacy
    month: v.number(),                             // 1-12 calendario
    year: v.number(),
    projectionMode: v.union(
      v.literal("rolling"),
      v.literal("fiscal")
    ),
    templateType: v.union(
      v.literal("deliverable_short"),
      v.literal("deliverable_long")
    ),
  },
  returns: v.union(
    v.null(),
    v.object({
      template: v.any(),     // el row de deliverableTemplates
      reason: v.string(),    // "monthly" | "quarterly_match" | "annual" | etc., audit-friendly
    })
  ),
  handler: async (ctx, args) => {
    // 1. Resolver subservicio (dual-matching).
    let subservice = null;
    if (args.subserviceId) {
      subservice = await ctx.db.get(args.subserviceId);
    } else if (args.serviceId && args.serviceName) {
      // Path legacy: proyecciones pre-A1 no tienen subserviceId.
      // Heurística: si existe UN único subservicio org-scoped o global bajo
      // serviceId, úsalo. Si hay múltiples, fallback a serviceName solo.
      const subs = await ctx.db
        .query("subservices")
        .withIndex("by_parentServiceId", (q) => q.eq("parentServiceId", args.serviceId!))
        .filter((q) => q.eq(q.field("isActive"), true))
        .collect();
      const orgScoped = subs.filter((s) => s.orgId === args.orgId);
      const globals = subs.filter((s) => s.orgId === undefined);
      const candidates = orgScoped.length > 0 ? orgScoped : globals;
      if (candidates.length === 1) subservice = candidates[0];
      // si >1, dejamos subservice=null y caemos al match por serviceName puro.
    }

    // 2. Hook getOverride (R1 §12.8) — beta SIEMPRE retorna null.
    const override = getOverride(args.clientId, args.subserviceId);
    // override === null en beta. En junio: lee clientSubserviceOverrides.

    // 3. Determinar frecuencia efectiva.
    const frequency = override?.frequencyOverride
      ?? subservice?.defaultFrequency
      ?? "mensual";              // fallback duro: legacy serviceName puro = mensual (compat actual).

    const applicableMonths = override?.applicableMonthsOverride
      ?? subservice?.applicableMonths
      ?? null;
    const cooldownMonths = override?.cooldownMonthsOverride
      ?? subservice?.cooldownMonths
      ?? 0;

    // 4. Mapear month al "mes contractual" según projectionMode.
    //    rolling: usamos calendario directo (month).
    //    fiscal: leemos fiscalYearStartMonth de orgConfigs y ajustamos.
    //    En beta: simplificación — usamos calendario para ambos modos (R3 mitig).
    //    El fiscal mode afecta la UI de proyecciones pero el lifecycle de factura
    //    siempre vive en calendario (factura es del mes calendario X).
    const contractMonth = args.month;

    // 5. Aplicar gate de applicableMonths.
    if (applicableMonths && applicableMonths.length > 0
        && !applicableMonths.includes(contractMonth)) {
      return null;
    }

    // 6. Aplicar gate de frecuencia.
    let frequencyOk = false;
    let reason = "";
    switch (frequency) {
      case "mensual":
        frequencyOk = true; reason = "monthly"; break;
      case "trimestral": {
        // Si applicableMonths está set, ya pasó §5 — confiamos.
        // Si no, default a {3,6,9,12}.
        const defaults = [3, 6, 9, 12];
        frequencyOk = applicableMonths
          ? applicableMonths.includes(contractMonth)
          : defaults.includes(contractMonth);
        reason = "quarterly_match"; break;
      }
      case "semestral": {
        const defaults = [6, 12];
        frequencyOk = applicableMonths
          ? applicableMonths.includes(contractMonth)
          : defaults.includes(contractMonth);
        reason = "semiannual_match"; break;
      }
      case "anual": {
        // applicableMonths típicamente [12]; si vacío, default a 12.
        const targets = applicableMonths && applicableMonths.length > 0
          ? applicableMonths
          : [12];
        frequencyOk = targets.includes(contractMonth);
        reason = "annual_match"; break;
      }
      case "una_vez": {
        // Elegible solo si NO hay deliverable previo para (clientId, subserviceId).
        // Si subservice es null (path legacy), usamos (clientId, serviceName).
        const prevs = await ctx.db
          .query("deliverables")
          .withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
          .collect();
        const alreadyGenerated = subservice
          ? prevs.some((d) => d.subserviceId === subservice!._id)
          : prevs.some((d) => d.serviceName === args.serviceName);
        frequencyOk = !alreadyGenerated;
        reason = "one_time_first"; break;
      }
    }
    if (!frequencyOk) return null;

    // 7. Cooldown (solo aplica a mensual+trimestral). Si último deliverable está
    //    dentro de cooldownMonths del contractMonth, skip.
    if (cooldownMonths > 0) {
      const prevs = await ctx.db
        .query("deliverables")
        .withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
        .collect();
      const sameSub = subservice
        ? prevs.filter((d) => d.subserviceId === subservice!._id)
        : prevs.filter((d) => d.serviceName === args.serviceName);
      const mostRecent = sameSub.sort((a, b) => b.createdAt - a.createdAt)[0];
      if (mostRecent) {
        const monthsDelta = (args.year - mostRecent.year) * 12 + (contractMonth - mostRecent.month);
        if (monthsDelta >= 0 && monthsDelta < cooldownMonths) return null;
      }
    }

    // 8. Lookup de plantilla.
    //    Prioridad: org-scoped + subserviceId → global + subserviceId → org-scoped + serviceName → global + serviceName.
    const allTemplates = await ctx.db
      .query("deliverableTemplates")
      .withIndex("by_type", (q) => q.eq("type", args.templateType))
      .collect();

    const activeTemplates = allTemplates.filter((t) => t.isActive);

    const candidates = [
      (t: typeof allTemplates[number]) => subservice && t.orgId === args.orgId && t.subserviceId === subservice._id,
      (t: typeof allTemplates[number]) => subservice && !t.orgId && t.subserviceId === subservice._id,
      (t: typeof allTemplates[number]) => args.serviceName && t.orgId === args.orgId && t.serviceName === args.serviceName,
      (t: typeof allTemplates[number]) => args.serviceName && !t.orgId && t.serviceName === args.serviceName,
    ];

    for (const predicate of candidates) {
      const match = activeTemplates.find((t) => predicate(t));
      if (match) return { template: match, reason };
    }

    return null;
  },
});
```

#### 3.3.2 Helper `getOverride` placeholder (beta)

```ts
// convex/functions/deliverables/overrides.ts
import type { Id } from "../../_generated/dataModel";

export type FrequencyOverride = {
  frequencyOverride?: "mensual" | "trimestral" | "semestral" | "anual" | "una_vez";
  applicableMonthsOverride?: number[];
  cooldownMonthsOverride?: number;
} | null;

/**
 * Beta: siempre null. Junio: lee clientSubserviceOverrides.
 * Mantener la signature estable para swap in-place.
 */
export function getOverride(
  _clientId: Id<"clients">,
  _subserviceId: Id<"subservices"> | undefined
): FrequencyOverride {
  return null;
}
```

#### 3.3.3 Internal queries auxiliares

`findByTriggerInvoiceId`, `findAssignmentForInvoice` viven en
`internalQueries.ts`:

```ts
export const findByTriggerInvoiceId = internalQuery({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("deliverables")
      .withIndex("by_triggerInvoiceId", (q) => q.eq("triggerInvoiceId", args.invoiceId))
      .first();
  },
});

export const findAssignmentForInvoice = internalQuery({
  args: {
    orgId: v.string(),
    clientId: v.id("clients"),
    projServiceId: v.optional(v.id("projectionServices")),
    month: v.number(),
    year: v.number(),
  },
  handler: async (ctx, args) => {
    let q = ctx.db
      .query("monthlyAssignments")
      .withIndex("by_clientId_month", (qb) =>
        qb.eq("clientId", args.clientId).eq("month", args.month)
      );
    const rows = await q.collect();
    return rows.find(
      (r) =>
        r.orgId === args.orgId &&
        r.year === args.year &&
        (args.projServiceId ? r.projServiceId === args.projServiceId : true)
    ) ?? null;
  },
});
```

#### 3.3.4 Tests obligatorios sobre selector

Ver §6 (tests `selectDeliverableForMonth.test.ts`).

#### 3.3.5 Cambio mínimo a `deliverables.generate`

`generate` (`convex/functions/deliverables/actions.ts`, ~línea 180) hoy hace
internamente:

```ts
const template = await ctx.runQuery(internal.functions.deliverables.internalQueries.findTemplate, {
  serviceName: projService.serviceName,
  type: args.templateType,
  orgId: assignment.orgId,
});
```

Patch:

```ts
let template;
if (args.templateOverride) {
  // Path A3: el caller (generateFromInvoice) ya resolvió y nos pasa snapshot.
  template = {
    _id: args.templateOverride.templateId,
    version: args.templateOverride.templateVersion,
    htmlTemplate: args.templateOverride.templateHtmlSnapshot,
    variables: args.templateOverride.variables,
    type: args.templateType,
    // Compat fields para que el resto del código no se quiebre.
    serviceName: projService.serviceName,
    isActive: true,
    orgId: assignment.orgId,
  };
} else {
  template = await ctx.runQuery(internal.functions.deliverables.internalQueries.findTemplate, {
    serviceName: projService.serviceName,
    type: args.templateType,
    orgId: assignment.orgId,
  });
}
```

Y al `db.insert("deliverables", {...})` se le añaden los campos del snapshot
+ triggerSource:

```ts
await ctx.db.insert("deliverables", {
  ...existingFields,
  subserviceId: projService.subserviceId,                       // A1
  templateId: template._id,                                     // A2
  templateVersion: template.version,                            // A2
  templateHtmlSnapshot: template.htmlTemplate,                  // A2
  triggerSource: args.triggerSource ?? "manual",                // A3
  triggerInvoiceId: args.triggerInvoiceId,                      // A3
});
```

Si A2 ya hizo el snapshot via su propio patch, A3 solo añade `triggerSource`
y `triggerInvoiceId`. Coordinar PR order: A2 antes que A3.

### 3.4 Cron eligibility daily

Archivo: `convex/crons.ts` + nuevo `convex/functions/cron/deliverableEligibility.ts`.

```ts
// convex/crons.ts (diff)
crons.daily(
  "deliverable-eligibility-scan",
  { hourUTC: 13, minuteUTC: 0 },  // 7am CDMX en UTC-6; cron se ejecuta SIEMPRE 7am UTC pero el handler filtra por TZ local de org
  internal.functions.cron.deliverableEligibility.run,
  {}
);
```

```ts
// convex/functions/cron/deliverableEligibility.ts
"use node";

import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";

const DAYS_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getLocalToday(timezoneIANA: string | undefined): {
  year: number;
  month: number;       // 1-12
  day: number;
  weekday: string;     // "Mon", ...
} {
  const tz = timezoneIANA ?? "UTC";
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = fmt.formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  return { year, month, day, weekday };
}

export const run = internalAction({
  args: {},
  handler: async (ctx) => {
    // 1. Listar orgs activas.
    const orgs = await ctx.runQuery(internal.functions.cron.eligibilityHelpers.listActiveOrgs, {});

    let totalReminders = 0;
    let totalSkipped = 0;

    for (const org of orgs) {
      const orgConfig = await ctx.runQuery(internal.functions.cron.eligibilityHelpers.getOrgConfig, {
        orgId: org.orgId,
      });
      const tz = orgConfig?.timezone;
      const today = getLocalToday(tz);

      // 2. Skip sáb-dom en zona local (beta — R1 §12 hard-coded).
      if (today.weekday === "Sat" || today.weekday === "Sun") {
        continue;
      }

      // 3. Listar clientes activos del org.
      const clients = await ctx.runQuery(internal.functions.cron.eligibilityHelpers.listActiveClients, {
        orgId: org.orgId,
      });

      for (const client of clients) {
        // 4. Listar projectionServices activos del año corriente.
        const projServices = await ctx.runQuery(
          internal.functions.cron.eligibilityHelpers.listProjServicesForClient,
          { orgId: org.orgId, clientId: client._id, year: today.year }
        );

        for (const ps of projServices) {
          // 5. Lookup projection mode.
          const projection = await ctx.runQuery(
            internal.functions.deliverables.internalQueries.getProjectionByProjService,
            { projectionId: ps.projectionId }
          );
          if (!projection) continue;

          // 6. Evaluar elegibilidad via selectDeliverableForMonth.
          const selected = await ctx.runQuery(
            internal.functions.deliverables.internalQueries.selectDeliverableForMonth,
            {
              orgId: org.orgId,
              clientId: client._id,
              subserviceId: ps.subserviceId,
              serviceId: ps.serviceId,
              serviceName: ps.serviceName,
              month: today.month,
              year: today.year,
              projectionMode: projection.projectionMode ?? "rolling",
              templateType: "deliverable_short",
            }
          );
          if (!selected) continue;

          // 7. ¿Ya existe deliverable para (clientId, subserviceId, year, month)?
          const existingDeliverable = await ctx.runQuery(
            internal.functions.cron.eligibilityHelpers.findDeliverableForMonth,
            {
              clientId: client._id,
              subserviceId: ps.subserviceId,
              serviceName: ps.serviceName,
              year: today.year,
              month: today.month,
            }
          );
          if (existingDeliverable) continue;

          // 8. ¿Ya existe invoice paid? (significa que markPaid YA disparó generación,
          //    posiblemente todavía en flight, o falló sin template. No spam al operador.)
          const existingPaidInvoice = await ctx.runQuery(
            internal.functions.cron.eligibilityHelpers.findPaidInvoiceForMonth,
            {
              orgId: org.orgId,
              clientId: client._id,
              subserviceId: ps.subserviceId,
              year: today.year,
              month: today.month,
            }
          );
          if (existingPaidInvoice) continue;

          // 9. Cap 1 email/cliente/día (R1 §10 R11): lookback documentEvents 24h.
          const recentReminder = await ctx.runQuery(
            internal.functions.cron.eligibilityHelpers.findRecentReminder,
            {
              orgId: org.orgId,
              clientId: client._id,
              sinceMs: Date.now() - 24 * 60 * 60 * 1000,
            }
          );
          if (recentReminder) {
            totalSkipped += 1;
            continue;
          }

          // 10. Enviar email al operador (orgConfigs.notificationEmail via resolveRecipients spec).
          await ctx.scheduler.runAfter(
            0,
            internal.functions.cron.eligibilityHelpers.sendReminderEmail,
            {
              orgId: org.orgId,
              clientId: client._id,
              subserviceName: ps.serviceName,
              month: today.month,
              year: today.year,
            }
          );

          // 11. Log evento.
          await ctx.runMutation(internal.functions.documentEvents.internal.logEventMutation, {
            orgId: org.orgId,
            clientId: client._id,
            entityType: "deliverable",
            entityId: `eligibility:${ps._id}:${today.year}-${today.month}`,
            eventType: "reminder_sent",
            severity: "info",
            actorType: "cron",
            message: `Recordatorio: toca subir factura de ${ps.serviceName} para ${client.name}, mes ${today.month}/${today.year}.`,
            metadata: { projServiceId: ps._id, subserviceId: ps.subserviceId, month: today.month, year: today.year },
          });
          totalReminders += 1;
        }
      }
    }

    return { totalReminders, totalSkipped, orgsScanned: orgs.length };
  },
});
```

**Decisión #9 hard-coded:** este cron NUNCA llama `deliverables.generate` ni
`generateFromInvoice`. Solo notifica.

**Convex cron limitation:** Convex no soporta cron per-timezone nativo. La
solución pragmática (beta): el cron corre 1x al día a 13:00 UTC (= 7am CDMX);
para orgs con timezones lejanos (ej. Tokio +9) el "hoy" estará desfasado pero
los avisos siguen siendo accionables en ventana 24h. Si beta sirve solo
orgs MX, el desfase es 0. Post-beta puede dividirse en varios crons por
buckets de timezone (Americas 13:00 UTC, EMEA 06:00 UTC, APAC 22:00 UTC).

### 3.5 Wrapper `documentEvents.logEvent`

Archivo: `convex/functions/documentEvents/internal.ts`.

```ts
import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";

const eventTypeUnion = v.union(
  v.literal("created"),
  v.literal("updated"),
  v.literal("sent"),
  v.literal("signed"),
  v.literal("paid"),
  v.literal("generated"),
  v.literal("audited"),
  v.literal("deleted"),
  v.literal("personalized"),
  v.literal("restored"),
  v.literal("reminder_sent"),
  v.literal("uploaded"),
  v.literal("voided"),
  v.literal("error")
);

const severityUnion = v.union(
  v.literal("info"),
  v.literal("warning"),
  v.literal("error")
);

const entityTypeUnion = v.union(
  v.literal("deliverable"),
  v.literal("invoice"),
  v.literal("quotation"),
  v.literal("contract"),
  v.literal("template"),
  v.literal("subservice"),
  v.literal("questionnaire")
);

export const logEventMutation = internalMutation({
  args: {
    orgId: v.string(),
    clientId: v.optional(v.id("clients")),
    entityType: entityTypeUnion,
    entityId: v.string(),
    eventType: eventTypeUnion,
    severity: v.optional(severityUnion),
    actorUserId: v.optional(v.string()),
    actorType: v.union(
      v.literal("user"),
      v.literal("cron"),
      v.literal("system"),
      v.literal("client_link")
    ),
    message: v.string(),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("documentEvents", {
      orgId: args.orgId,
      clientId: args.clientId,
      entityType: args.entityType,
      entityId: args.entityId,
      eventType: args.eventType,
      severity: args.severity ?? "info",
      actorUserId: args.actorUserId,
      actorType: args.actorType,
      message: args.message,
      metadata: args.metadata,
      createdAt: Date.now(),
    });
  },
});
```

**Callsites obligatorios (todos en este sprint):**

| Lugar | Evento |
|---|---|
| `invoices.upload` (internal mutation insertInvoiceRow) | `uploaded`, severity info |
| `invoices.upload` con duplicado | `created`, severity warning, metadata.duplicateOf |
| `invoices.markSent` | `sent`, severity info |
| `invoices.markPaid` | `paid`, severity info |
| `invoices.markVoid` | `voided`, severity warning |
| `deliverables.generateFromInvoice` éxito | `generated`, severity info |
| `deliverables.generateFromInvoice` idempotent skip | `generated`, severity warning |
| `deliverables.generateFromInvoice` no template | `error`, severity warning |
| `deliverables.generateFromInvoice` error de engine | `error`, severity error |
| `deliverables.generate` (manual) éxito | `generated`, severity info |
| `cron.deliverableEligibility` enviar recordatorio | `reminder_sent`, severity info |
| `cron.deliverableEligibility` cap aplicado | (no log — skip silencioso) |
| `templates.mutations.update` (A2) | `updated` o `personalized`, severity info |

A1 dejó TODO en `subservices.create/update/remove` para emitir
`subservice/created|updated|deleted`. A3 conecta esos hooks ahora que el
wrapper existe (cambio trivial, sin re-revisar A1).

### 3.6 Queries para audit UI

Archivo: `convex/functions/documentEvents/queries.ts`.

```ts
import { query } from "../../_generated/server";
import { v } from "convex/values";
import { requireAuth, requireSuperAdmin, getOrgIdSafe } from "../../lib/authHelpers";

export const list = query({
  args: {
    // super-admin puede pasar orgId arbitrario; operador solo el suyo.
    orgId: v.optional(v.string()),
    clientId: v.optional(v.id("clients")),
    entityType: v.optional(v.union(
      v.literal("deliverable"),
      v.literal("invoice"),
      v.literal("quotation"),
      v.literal("contract"),
      v.literal("template"),
      v.literal("subservice"),
      v.literal("questionnaire")
    )),
    severity: v.optional(v.union(
      v.literal("info"),
      v.literal("warning"),
      v.literal("error")
    )),
    sinceMs: v.optional(v.number()),
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    let targetOrgId = args.orgId;

    // multi-tenant: si caller no es super-admin, fuerza orgId al suyo.
    let isSuperAdmin = false;
    try {
      await requireSuperAdmin(ctx);
      isSuperAdmin = true;
    } catch { /* not super admin */ }

    if (!isSuperAdmin) {
      const ownOrgId = await getOrgIdSafe(ctx);
      if (!ownOrgId) return { rows: [], cursor: null };
      targetOrgId = ownOrgId;     // override aun si caller pasó otro
    }
    if (!targetOrgId) return { rows: [], cursor: null };

    const pageSize = Math.min(args.pageSize ?? 50, 100);

    // Index selection: si severity está, usa by_orgId_severity_createdAt; si entityType, by_orgId_entityType_entityId; si clientId, by_orgId_clientId_createdAt; default by_orgId_createdAt.
    let q;
    if (args.severity) {
      q = ctx.db
        .query("documentEvents")
        .withIndex("by_orgId_severity_createdAt", (qb) =>
          qb.eq("orgId", targetOrgId!).eq("severity", args.severity!)
        );
    } else if (args.clientId) {
      q = ctx.db
        .query("documentEvents")
        .withIndex("by_orgId_clientId_createdAt", (qb) =>
          qb.eq("orgId", targetOrgId!).eq("clientId", args.clientId!)
        );
    } else {
      q = ctx.db
        .query("documentEvents")
        .withIndex("by_orgId_createdAt", (qb) => qb.eq("orgId", targetOrgId!));
    }

    const result = await q.order("desc").paginate({
      cursor: args.cursor ?? null,
      numItems: pageSize,
    });

    // Post-filter por entityType si está set (no es first key del índice
    // disponible). Costo aceptable: pageSize ≤ 100.
    const filtered = args.entityType
      ? result.page.filter((r) => r.entityType === args.entityType)
      : result.page;

    return {
      rows: filtered,
      cursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const listForClient = query({
  args: { clientId: v.id("clients"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];
    return await ctx.db
      .query("documentEvents")
      .withIndex("by_orgId_clientId_createdAt", (q) =>
        q.eq("orgId", orgId).eq("clientId", args.clientId)
      )
      .order("desc")
      .take(args.limit ?? 30);
  },
});
```

### 3.7 Extensión de mutations existentes

#### 3.7.1 `orgConfigs.mutations.update` — añadir `timezone`

```ts
// convex/functions/orgConfigs/mutations.ts (diff)
export const update = mutation({
  args: {
    // ... campos existentes ...
    notificationEmail: v.optional(v.string()),
    timezone: v.optional(v.string()),       // NUEVO
  },
  handler: async (ctx, args) => {
    // ... lógica existente ...
    const patch = { ...args, updatedAt: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("orgConfigs", { orgId, ...patch });
    }
  },
});
```

Validación mínima: `timezone` debe ser string IANA si presente
(`Intl.supportedValuesOf("timeZone").includes(args.timezone)` si Node 18+).
Si la org pasa string inválido, throw amigable.

#### 3.7.2 `monthlyAssignments.mutations.updateInvoiceStatus`

**NO se elimina** (decisión R1 §12.10). Se mantiene para compat con UI
legacy `/facturacion` que sigue mostrando el dropdown. Cuando A3 patch'ea
`monthlyAssignments.invoiceStatus = "paid"` desde `markPaid`, el dropdown
del UI legacy refleja el cambio. A3 NO marca este path como deprecated en
el sprint — eso lo hace post-beta cuando el upload PDF sea el path único.

---

## 4. Frontend

### 4.1 Refactor `/facturacion` para upload PDF

Diff sobre `src/app/(dashboard)/facturacion/page.tsx`.

**Conserva:** layout, filtros (year/month/service/status), summary cards,
agrupación por mes.

**Elimina (decisión 2026-05-20):** la columna "Estado Factura" con dropdown
legacy de `monthlyAssignments.invoiceStatus`. Reemplazada por la nueva
columna "Factura PDF" abajo descrita. El backend `updateInvoiceStatus` sigue
existiendo (sync interno via `markPaid`), solo no se renderiza en UI.

**Añade:**

1. **Columna nueva "Factura PDF"** entre "Monto" y "Estado Entrega":
   - Si no existe row de `invoices` para ese `monthlyAssignmentId`: botón
     `Subir factura` (variant ghost, icono `UploadCloud`).
   - Si existe row con `status="uploaded"`: badge `Subida` + link `Ver` + botón `Marcar pagada`.
   - Si existe row con `status="paid"`: badge `Pagada` + link `Ver` + (admin only) botón `Anular`.
   - Si existe row con `status="void"`: badge `Anulada` + link `Ver` (deshabilitado).

2. **Query nueva:** `useQuery(api.functions.invoices.queries.listForBilling, { year, month, status })`.
   Cruce client-side por `monthlyAssignmentId` para emparejar con el row de
   `listForInvoiceTracking` actual.

3. **Modal `UploadInvoiceDialog`** (shadcn Dialog):
   ```
   ┌─ Subir factura — Cliente X, Servicio Y, mayo 2026 ──┐
   │  Archivo PDF      [Seleccionar archivo o arrastrar] │
   │                   [factura-mayo.pdf · 124 KB · ✓]   │
   │  Monto            [$8,500.00] (prefilled del MA)    │
   │  Notas (opcional) [textarea]                        │
   │  ☑ Notificar cliente con signed URL                 │
   │                                                     │
   │  [Cancelar]                          [Subir]        │
   └─────────────────────────────────────────────────────┘
   ```
   - Usa `<input type="file" accept="application/pdf" />`.
   - On submit: lee file como `ArrayBuffer`, llama
     `useAction(api.functions.invoices.actions.upload)` con
     `{ clientId, projectionId, projServiceId, subserviceId, serviceName, monthlyAssignmentId, month, year, amount, filename, contentType, fileBuffer, notes }`.
   - Si retorna `{ duplicateOf }`: toast warning "Ya existe factura previa
     para este mes-servicio. Verifica antes de marcar pagada."
   - Cierra modal + invalida queries.

4. **`MarkPaidConfirm` (popover o dialog corto):**
   ```
   ¿Marcar la factura como pagada?
   Esto generará automáticamente el entregable.
   [Cancelar] [Sí, marcar pagada]
   ```
   - Click → `useMutation(api.functions.invoices.mutations.markPaid)`.
   - Optimistic UI: badge cambia a `Pagada · generando…` con spinner por 30s
     o hasta que el entregable aparezca en `useQuery(deliverables.listByClient)`.

5. **`VoidInvoiceDialog`** (admin only):
   ```
   Anular factura — requiere razón
   Razón [______]
   ☐ Advertencia: si esta factura ya generó entregable, el entregable NO se borra.
   [Cancelar] [Anular]
   ```

**Cuándo `monthlyAssignmentId` no está disponible:** edge case si el cliente
no tiene proyección activa para ese mes (improbable en flow normal pero
posible si la proyección se archivó). En ese caso, el upload pide
`projectionId` + `projServiceId` adicionales en el modal vía dropdown.

**`monthlyAssignments.invoiceStatus` dropdown legacy — ELIMINADO de la UI
(decisión 2026-05-20):** el dropdown viejo se quita por completo de
`/facturacion`. Reemplazo total por el flow PDF nuevo. El campo
`monthlyAssignments.invoiceStatus` permanece en el schema (sigue siendo
sincronizado desde `invoices.markPaid` para preservar compatibilidad con
queries existentes que lo leen — ej. cron mensual de recordatorios), pero
NO se muestra al operador. Si en el futuro algún flow CLI o seed necesita
patchearlo, sigue siendo mutable vía `monthlyAssignments.mutations.updateInvoiceStatus`
(no removida, solo escondida del UI).

### 4.2 Tab Documentos del cliente — placeholder

A3 **NO modifica** la rama `feature/client-documents-tab`. Esa rama agrega
una query `listByClient` en el módulo de documentos que ya intenta
`try { db.query("invoices") } catch { return [] }` para tolerar la tabla
faltante.

**Lo que A3 garantiza para esa rama:**

1. Cuando A3 mergee a main, la tabla `invoices` existe y la query
   `listByClient` empieza a devolver rows reales sin cambio de código en el
   tab.
2. El filtro "Facturas" del tab se popula con rows que tienen `entityType:
   "invoice"` (vía join client-side con `invoices.listByClient`).
3. La rama del Tab Documentos depende de A1 mergeado para tener filtro por
   subservicio; A3 NO toca eso. Solo A1 lo habilita.

Si A3 mergee antes que `feature/client-documents-tab`, ningún cambio
necesario: el branch ya está defensivo.

### 4.3 Página `/platform/audit`

Ruta nueva: `src/app/platform/audit/page.tsx`. Sólo super-admin (gate vía
`requireSuperAdmin` en query).

**Layout:**

```
┌─────────────────────────────────────────────────────────────────┐
│  Audit log                                                      │
│  Eventos cross-org de Projex. Solo super-admin.                 │
├─────────────────────────────────────────────────────────────────┤
│  [Org: ▾ Todas] [Cliente: ▾] [Entidad: ▾] [Sev: ●●●] [Desde: …] │
├─────────────────────────────────────────────────────────────────┤
│  2026-05-29 14:22  ● info     invoice    Factura mayo-2026...   │
│                                          subida.                │
│                                          Org: acme-co · Actor: …│
│                                                                 │
│  2026-05-29 14:22  ● info     deliverable Entregable generado…  │
│  ...                                                            │
│                                                                 │
│              [Cargar más ▾]    Page cursor: abc123              │
└─────────────────────────────────────────────────────────────────┘
```

**Componentes:**

- `Card` exterior.
- Filtros como `Select` shadcn + `DatePicker` (existe `react-day-picker` ya en
  el repo según `package.json`).
- Tabla scrolleable, `pageSize=50`. Cursor cargado en state.
- `severity` badges: info gris, warning ámbar, error rojo.
- `entityType` badge neutro.
- Click en row expande detalle con `metadata` JSON formatted.
- Sin export CSV en beta (out of scope D1 §9.3 mitigation).
- Sin gráficas.

**Data fetching:**

```tsx
const { data: events, cursor, isDone } = usePaginatedQuery(
  api.functions.documentEvents.queries.list,
  { orgId: filters.orgId, clientId: filters.clientId, entityType: filters.entityType, severity: filters.severity },
  { initialNumItems: 50 }
);
```

Si Convex `usePaginatedQuery` no está disponible (verificar Convex react
version), usar cursor manual + `useState`.

**Sidebar entry:** añadir a `src/components/layout/sidebar.tsx:104-119`
(gate super admin existente) un link nuevo `Audit log` con icon `FileSearch`.

### 4.4 Helper UI — formatear timestamp en zona local del operador

`src/lib/datetime.ts` (nuevo o extender existente):

```ts
export function formatLocalDateTime(ms: number, tz?: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}
```

Usado por la tabla de audit y por la sección "Facturas" del tab Documentos.

---

## 5. Flujo end-to-end (diagrama beta)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  OPERADOR                  SISTEMA                             CLIENTE  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Sube PDF factura          ┌──────────────────────┐                     │
│  (modal /facturacion)──────▶│ invoices.upload      │                    │
│                            │  - validar org       │                     │
│                            │  - detectar duplicado│                     │
│                            │  - uploadBlob(Railway│                     │
│                            │  - insert row uploaded│                    │
│                            │  - logEvent uploaded │                     │
│                            │  - schedule notify   │──────► email signed │
│                            └──────────────────────┘        URL al cliente│
│                                                                         │
│  ........... ventana operacional (días) ............                    │
│                                                                         │
│  Click "Marcar pagada"     ┌──────────────────────┐                     │
│  ───────────────────────────▶│ invoices.markPaid   │                    │
│                            │  - patch status=paid │                     │
│                            │  - sync MA invoiceStat│                    │
│                            │  - logEvent paid     │                     │
│                            │  - scheduler.runAfter│                     │
│                            │     generateFromInv. │                     │
│                            └──────┬───────────────┘                     │
│                                   │                                     │
│                                   ▼                                     │
│                            ┌──────────────────────┐                     │
│                            │ generateFromInvoice  │                     │
│                            │  - load invoice      │                     │
│                            │  - check idempotente │                     │
│                            │  - selectDeliverable │                     │
│                            │    ForMonth          │                     │
│                            │    ├── no template?  │── logEvent warn ───►│
│                            │    │   notify operad │   email operador    │
│                            │    └── template OK   │                     │
│                            │  - call generate(    │                     │
│                            │     templateOverride)│                     │
│                            │     ├── engine Claude│                     │
│                            │     ├── puppeteer PDF│                     │
│                            │     ├── uploadBlob   │                     │
│                            │     └── insert deliv │                     │
│                            │        triggerSource=│                     │
│                            │        "invoice_paid"│                     │
│                            │  - logEvent generated│                     │
│                            │  - notify ejecutivo  │                     │
│                            └──────────────────────┘                     │
│                                                                         │
│  Ve entregable en          (tab Documentos del cliente muestra:         │
│  /clientes/[id]            - factura mayo (link Railway)                │
│                            - entregable mayo (link Railway))            │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  CRON 13:00 UTC diario     ┌──────────────────────┐                     │
│  (separado, no entra al    │ deliverableEligibility│                    │
│   flow del operador)       │  por cada org:       │                     │
│                            │   - obtener TZ local │                     │
│                            │   - skip si sáb/dom  │                     │
│                            │   - por cada cliente:│                     │
│                            │     por cada projSv: │                     │
│                            │      selectForMonth? │                     │
│                            │      ¿hay deliv?     │                     │
│                            │      ¿hay invoice    │                     │
│                            │        paid?         │                     │
│                            │      ¿ya envié hoy?  │                     │
│                            │      → notify ─────  │──────► email        │
│                            │         operador     │        operador     │
│                            │      logEvent        │        (notification│
│                            │      reminder_sent   │         Email)      │
│                            └──────────────────────┘                     │
│                                                                         │
│  El cron NUNCA genera deliverables. Solo recordatorios.                 │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Tests

Mínimo 20 tests vitest + `convex-test` (patrón ya usado en A1). Archivos
nuevos:

### 6.1 `convex/functions/invoices/invoices.test.ts` (8 tests)

1. **`upload` happy path.** Mock `uploadBlob`. Llama upload con PDF buffer.
   Assert: invoice row insertada con status="uploaded", `bucketKey` matches
   `buildKey` pattern, evento `uploaded` insertado en `documentEvents`,
   scheduler ran (notify client).
2. **`upload` rechaza non-PDF.** Pasa `contentType: "image/jpeg"`. Assert:
   throws con mensaje "Solo PDFs aceptados en V1.". Bucket NO se toca.
3. **`upload` detecta duplicado.** Setup: insert una invoice previa (mismo
   client+year+month+subservice, status=uploaded). Llama upload otra vez con
   mismas keys. Assert: retorna `{ invoiceId, duplicateOf }` con `duplicateOf
   === previo._id`. Evento `warning` con metadata.duplicateOf insertado.
4. **`upload` falla bucket → no inserta row.** Mock `uploadBlob` para
   throw. Assert: throw propaga, `db.query("invoices")` permanece vacío.
   (R1 §10 R7.)
5. **`markSent` emite evento sin tocar status.** Setup: invoice status=
   uploaded. Llama markSent. Assert: row sigue con status=uploaded,
   evento `sent` insertado con severity info.
6. **`markPaid` triggea schedule de generateFromInvoice.** Mock scheduler.
   Llama markPaid. Assert: invoice patched con status=paid, paidAt set,
   scheduler.runAfter llamado con `generateFromInvoice` y `invoiceId`.
7. **`markPaid` idempotente.** Llama markPaid dos veces. Assert: segunda
   call retorna `{ ok: true, alreadyPaid: true }`. Scheduler invocado solo
   1 vez (assert via call count).
8. **`markPaid` multi-tenant guard.** Auth como orgA, intenta markPaid de
   invoice de orgB. Assert: throws "Factura no encontrada.". (IDOR
   prevention.)

### 6.2 `convex/functions/deliverables/generateFromInvoice.test.ts` (4)

9. **Happy path con template.** Setup: invoice paid + subservice +
   deliverableTemplate org-scoped. Llama generateFromInvoice. Assert:
   deliverable insertado con triggerSource="invoice_paid",
   triggerInvoiceId=invoiceId, templateId/Version/HtmlSnapshot poblados.
   Evento `generated` info insertado.
10. **Sin template → log warning + notify operador.** Setup: invoice paid
    pero subservice sin templates. Assert: NO se inserta deliverable,
    evento `error` con severity warning, scheduler.runAfter llama
    `notifyOperatorNoTemplate`. Retorna `{ ok: false, reason: "no_template" }`.
11. **Invoice de otro org → skip.** Setup: invoice paid pero subservicio
    pertenece a orgB. (Edge case improbable pero test prevention de cross-org.)
    Auth-less context (internal action) — assert: skip silencioso o error
    explícito; assertion concreta sobre cuál es el comportamiento.
12. **Idempotencia.** Llama generateFromInvoice dos veces sobre la misma
    invoice paid. Assert: solo 1 deliverable insertado. Segunda call retorna
    `{ ok: true, reason: "idempotent_skip" }`. Evento warning con
    metadata.existingDeliverableId.

### 6.3 `convex/functions/deliverables/selectDeliverableForMonth.test.ts` (6)

13. **Mensual siempre elegible.** Subservice freq=mensual sin
    applicableMonths. Llama selector con mes=cualquiera. Assert: retorna
    template con `reason="monthly"`.
14. **Trimestral en [3,6,9,12] elegible, otros meses null.** Subservice
    freq=trimestral. Llama para mes=3 (elegible), mes=5 (null), mes=6
    (elegible). Assert: reasons correctos.
15. **Anual solo en mes 12 (default).** Subservice freq=anual sin
    applicableMonths. Mes=12 OK, mes=6 null.
16. **Una_vez skip si ya generado.** Subservice freq=una_vez. Insert
    deliverable previo con subserviceId match. Llama selector. Assert:
    retorna null. Sin previo → retorna template.
17. **Dual-matching subserviceId preferido.** Setup: 2 templates — uno con
    subserviceId set + serviceName="X", otro sin subserviceId + serviceName=
    "X". Llama con subserviceId presente. Assert: retorna el con
    subserviceId.
18. **Dual-matching fallback a serviceName.** Llama con `subserviceId=
    undefined` y solo serviceName="X". Assert: retorna el template
    serviceName-only.

### 6.4 `convex/functions/cron/deliverableEligibility.test.ts` (2)

19. **Notifica solo si elegible y sin invoice paid.** Setup: 2 clientes,
    cliente A con subservice mensual + sin deliverable + sin invoice paid
    para mes corriente; cliente B con invoice paid existente. Llama run.
    Assert: scheduler.runAfter llama `sendReminderEmail` solo para
    cliente A. Evento `reminder_sent` insertado solo para A.
20. **Cap 1 email/cliente/día.** Setup: cliente con un evento
    `reminder_sent` de hace 2h. Llama run. Assert: scheduler.runAfter
    NO se llama. totalSkipped == 1.

### 6.5 `convex/functions/documentEvents/internal.test.ts` (1)

21. **`logEventMutation` insert correcto.** Llama con todos los campos.
    Assert: row insertada con createdAt close to now, severity default
    "info" si omitido.

**Extra recomendados (no bloquean DoD):**

- `selectDeliverableForMonth` con `cooldownMonths > 0` y deliverable previo
  dentro de cooldown → null.
- `cron eligibility` skip sáb-dom respecta tz local de la org (mock
  Intl.DateTimeFormat con tz America/Mexico_City).

---

## 7. Definition of Done

Booleanos, marcar todos antes de cerrar PR:

- [ ] `convex/schema.ts`: añade tablas `invoices`, `documentEvents`; añade
      `triggerSource`, `triggerInvoiceId` en `deliverables`; añade índice
      `by_triggerInvoiceId` en `deliverables`; añade `timezone` opcional en
      `orgConfigs`.
- [ ] `npx convex dev` corre sin errores de codegen.
- [ ] `convex/functions/invoices/{actions,queries,mutations,internalQueries,internalActions}.ts`
      completos (upload, markSent, markPaid, markVoid, getDownloadUrl,
      listByClient, listForBilling, getById).
- [ ] `convex/functions/deliverables/actions.ts` extiende `generate` para
      aceptar `templateOverride`, `triggerSource`, `triggerInvoiceId`. Añade
      `generateFromInvoice` como internalAction.
- [ ] `convex/functions/deliverables/internalQueries.ts` añade
      `selectDeliverableForMonth`, `findByTriggerInvoiceId`,
      `findAssignmentForInvoice`. `findTemplate` se mantiene exportado
      pero deprecated en docstring.
- [ ] `convex/functions/deliverables/overrides.ts` con `getOverride`
      placeholder (retorna null en beta).
- [ ] `convex/functions/cron/deliverableEligibility.ts` + helpers (`listActiveOrgs`,
      `listActiveClients`, `listProjServicesForClient`, `findRecentReminder`,
      `findPaidInvoiceForMonth`, `findDeliverableForMonth`, `sendReminderEmail`).
- [ ] `convex/crons.ts` añade entry `deliverable-eligibility-scan` daily 13:00 UTC.
- [ ] `convex/functions/documentEvents/{internal,queries}.ts` completos.
- [ ] `convex/functions/orgConfigs/mutations.ts` acepta `timezone` opcional.
- [ ] `convex/functions/monthlyAssignments/mutations.ts:24` (`updateInvoiceStatus`)
      se mantiene sin cambios. Documentación en código aclara que el trigger
      vivo es `invoices.markPaid`, no este dropdown.
- [ ] `src/app/(dashboard)/facturacion/page.tsx` refactor con columna PDF
      + modal upload + markPaid confirm + (admin) markVoid dialog.
- [ ] `src/app/platform/audit/page.tsx` nueva, gated super-admin.
- [ ] `src/components/layout/sidebar.tsx` añade link `Audit log` en gate
      super-admin.
- [ ] 21+ tests vitest pasando (`npm test`).
- [ ] `npm run lint` clean.
- [ ] `npx tsc --noEmit` clean.
- [ ] `gitnexus_impact` corrido sobre `findTemplate`, `generate`,
      `updateInvoiceStatus`, `crons.ts` antes de PR; HIGH/CRITICAL risk
      reportado.
- [ ] `gitnexus_detect_changes` corrido pre-commit; scope confirma solo
      `convex/schema.ts`, `convex/functions/invoices/*`,
      `convex/functions/deliverables/*` (cambios mínimos a actions.ts +
      internalQueries.ts), `convex/functions/cron/deliverableEligibility.ts`,
      `convex/functions/documentEvents/*`, `convex/crons.ts`,
      `convex/functions/orgConfigs/mutations.ts`,
      `src/app/(dashboard)/facturacion/*`, `src/app/platform/audit/*`,
      `src/components/layout/sidebar.tsx`.
- [ ] Test E2E manual: subir PDF de prueba → markPaid → verificar
      deliverable generado con `templateHtmlSnapshot` poblado y email
      al ejecutivo recibido.

---

## 8. Riesgos específicos de A3

Aterrizando los riesgos del maestro R1 §10 aplicables a A3, con
mitigación concreta:

**R3 — `selectDeliverableForMonth` con frequency trimestral falla en mes
fiscal (no calendario).** Mitigación: el selector en A3 usa SIEMPRE mes
calendario para evaluar elegibilidad (la factura es del mes calendario X,
sin ambigüedad). El `projectionMode` se recibe en args pero solo se
referencia para logs y para futuras decisiones (junio). Tests #14 y #15
fuerzan los gates de quarter y annual sin tocar fiscal mode.

**R4 — `markPaid` ejecutado dos veces → dos generaciones.** Mitigación
doble: (1) `markPaid` mismo es idempotente (check `status === "paid"` →
retorna sin re-enqueue, test #7); (2) `generateFromInvoice` chequea
`findByTriggerInvoiceId` antes de generar (test #12). Race entre dos
operadores haciendo click simultáneo en distintos browsers: la primera
mutation patches el row, la segunda lee `status="paid"` y skip. Convex
serializa mutations por document, no hay race real.

**R5 — Cron eligibility + markPaid simultáneos → entregable duplicado.**
Mitigación: el cron NUNCA llama `generate*`. Solo `sendReminderEmail`. La
única vía de generación es `markPaid → generateFromInvoice`. Test #19
verifica que cron skip si hay invoice paid existente.

**R6 — Plantilla con variables inválidas → entregable corrupto en
runtime.** Mitigación: A2 introdujo validación pre-save en
`templates.mutations.update`. A3 usa `templateHtmlSnapshot` que ya pasó
esa validación. Si plantilla viaja con `unfilledKeys` (engine actual
soporta), el deliverable se inserta con marker pero no crashea.

**R7 — Bucket Railway falla en upload.** Mitigación: en `invoices.upload`
el orden es bucket-first, db-second. Si bucket throws, NO se inserta row
(test #4). Si bucket OK y db fails (improbable pero posible), queda blob
huérfano — cleanup script semanal lo barre (R8).

**R8 — Blobs huérfanos cuando cliente/proyección se borra.** Mitigación:
todos los blobs viven bajo `{orgId}/{clientId}/invoices/...`. Cleanup
job manual semanal (script CLI separado, no cron — R1 §13) que para cada
client soft-deleted, sweepea `invoices.bucketKey` y llama `deleteBlob`.
A3 NO implementa el cleanup, solo asegura la convención de paths.

**R9 — Costo Claude explota con generación masiva.** Mitigación: el cron
no genera, así que el único path de generación es operador-driven
(markPaid) o manual (`generate`). El cap diario de 50 generaciones/org
queda hardcoded en `generate` (R1 §10.9, ya implementado en engine
refactor). `generateFromInvoice` hereda ese cap automáticamente.

**R11 — Cron eligibility envía notificaciones spam.** Mitigación: cap
1 email/cliente/día via lookback de `documentEvents.eventType="reminder_sent"`
en últimas 24h. Test #20 verifica el cap. Sáb-dom skip en TZ local elimina
ruido de findes.

**R14 — Notificaciones a destinatarios mal resueltos (Clerk userId en
lugar de email).** Mitigación: A3 invoca SIEMPRE el spec
`2026-05-19-notification-recipient-resolution-design.md`:
- Cliente → `clients.contactEmail`.
- Ejecutivo / operador → `orgConfigs.notificationEmail` (con fallback a
  env var `OPS_NOTIFICATION_EMAIL`).
- Si `null` → skip + warn (no crashea).
`internalActions.notifyClientUploaded` y `notifyOperatorNoTemplate` y
`sendReminderEmail` los tres usan `resolveOrgNotificationEmail` /
`client.contactEmail` patterns.

**R-fiscal-month-mismatch (nuevo, A3-específico).** Si una org usa
projectionMode="fiscal" con fiscalYearStartMonth=7, una factura del mes
calendario 7 corresponde al mes contractual 1. ¿El selector lo entiende?
**Decisión:** No en beta. El selector usa SIEMPRE calendario. La factura
del operador siempre viene con `month=7, year=2026` calendario, y el
matching templates usa esa key. Si la plantilla define `applicableMonths`
en términos fiscales, el operador debe traducir manualmente
(`applicableMonths: [1] → ` en términos calendario sería `[7]` para esa
org). Documentado en `/configuracion/plantillas` como tooltip explícito en A2.

**R-blob-cleanup-on-void (nuevo).** Cuando `markVoid` se llama, ¿qué pasa
con el PDF en Railway? **Decisión:** queda en el bucket. Audit-friendly,
sin borrar. Cleanup post-90-días manual via script CLI.

---

## 9. Open questions

Preguntas que pueden requerir input del implementador o de papá durante el
ejecutar:

**Q1.** ¿`markPaid` puede revertirse a `uploaded`?
**Recomendación:** No directamente. La forma de "revertir" es `markVoid` con
razón (admin only), lo que preserva audit trail. Si la org necesita el flujo
"oops, no estaba pagada", se puede agregar `markPaid({ revert: true })` en
post-beta, pero NO en A3.

**Q2.** Si `uploadBlob` falla a mitad del flow (bucket put OK pero row
insert falla), ¿qué pasa con el blob huérfano?
**Recomendación:** Queda en el bucket. Cleanup script semanal lo barre.
Alternativa: try/finally con `deleteBlob` en el catch del insert — añade
complejidad sin justificar en beta. NO se hace en A3.

**Q3.** ¿El cron skipea sáb-dom para todas las orgs sin excepción?
**Recomendación:** Sí en beta. Si una org cliente del despacho cierra
financialmente los días 30 que caen en sáb-dom, el operador puede generar
manualmente. Post-beta: feature flag `orgConfigs.weekendReminders`.

**Q4.** ¿`documentEvents` tiene retención TTL?
**Recomendación:** No en beta. R1 §11 O15 lo difiere. Cleanup CLI manual
post-junio si bloat. Estimación: ~10-50 eventos/org/día → ~15K-150K/org/año.
Manejable.

**Q5.** Cuando una invoice se markVoid, ¿el deliverable generado
previamente queda marcado como "from voided invoice"?
**Recomendación:** Sí, vía `documentEvents.metadata.previousStatus` del
evento `voided` + el `triggerInvoiceId` en el deliverable apuntando a la
factura void. No se modifica el row del deliverable. Esto preserva audit
sin destructivo. Si la org pide que el deliverable se marque como
"invalidated", post-beta se añade campo `deliverables.invalidatedReason`.

**Q6.** ¿Una org puede ver `documentEvents` de otras orgs vía
`documentEvents.queries.list`?
**Recomendación:** No. Multi-tenant filter en `list` (§3.6) verifica
`requireSuperAdmin` antes de honrar el arg `orgId`. Si no es super-admin,
fuerza `orgId = ownOrgId`. Test #11 lo verifica.

**Q7.** ¿`/platform/audit` muestra eventos de todas las orgs por default?
**Recomendación:** Default = vacío o "Todas (puede ser lento)". Mejor:
default = la primera org del workspace del super-admin (por
`organizations.createdAt asc`); dropdown obligatorio para cambiar. Esto
evita queries cross-org accidentalmente pesadas.

**Q8.** ¿La columna "Factura PDF" del `/facturacion` se prende
automáticamente para proyecciones legacy (sin `monthlyAssignmentId`
poblado en `invoices`)?
**Recomendación:** Sí. Si el operador sube factura para una proyección
legacy, el modal pide los IDs faltantes (`projectionId`, `projServiceId`)
vía dropdowns. La columna existe siempre, solo el UX cambia.

---

## 10. Referencias

### 10.1 Archivos del codebase

**Schema:**
- `convex/schema.ts:153-166` — `services` (los 9 padre).
- `convex/schema.ts:168-180` — `projectionServices` (recibe `subserviceId` en A1).
- `convex/schema.ts:182-210` — `monthlyAssignments` con `invoiceStatus` enum existente (A3 mantiene, no elimina; sincroniza desde `markPaid`).
- `convex/schema.ts:212-274` — `questionnaireResponses` (A3 no toca).
- `convex/schema.ts:328-367` — `deliverables` (A3 añade `triggerSource`, `triggerInvoiceId`, índice `by_triggerInvoiceId`; A1+A2 ya añadieron `subserviceId`, `templateId`, `templateVersion`, `templateHtmlSnapshot`).
- `convex/schema.ts:369-391` — `orgConfigs` (A3 añade `timezone` opcional; `notificationEmail` ya existe línea 388).

**Backend existente reusado:**
- `convex/functions/deliverables/actions.ts:180-360` — `generate` action; A3 lo extiende para aceptar `templateOverride`, `triggerSource`, `triggerInvoiceId`.
- `convex/functions/deliverables/actions.ts:215` — callsite actual de `findTemplate`; A3 lo refactoriza a `selectDeliverableForMonth`.
- `convex/functions/deliverables/internalQueries.ts:48-74` — `findTemplate` actual; A3 lo deprecia y añade `selectDeliverableForMonth`.
- `convex/functions/monthlyAssignments/mutations.ts:24-40` — `updateInvoiceStatus` actual; NO se elimina (decisión R1 §12.10).
- `convex/functions/email/resolveRecipients.ts` — helper de notification recipient resolution; A3 lo invoca desde `notifyClientUploaded`, `notifyOperatorNoTemplate`, `sendReminderEmail`.
- `convex/functions/email/send.ts` (`sendEmailInternal`) — transporte Resend; A3 lo invoca igual que call sites existentes.
- `convex/lib/blobStorage.ts:12-141` — helper Railway (`buildKey`, `uploadBlob`, `signedDownloadUrl`, `deleteBlob`); A3 lo usa para invoices.
- `convex/lib/authHelpers.ts:11-50` — `getOrgId`, `getOrgIdSafe`, `requireAuth`, `requireAdmin`, `requireSuperAdmin`; A3 usa los 5.
- `convex/crons.ts:1-30` — registro actual de crons; A3 añade `deliverable-eligibility-scan`.
- `src/app/api/generate-pdf/route.ts` — puppeteer existente; A3 lo invoca via `generate` action heredado.

**Frontend existente:**
- `src/app/(dashboard)/facturacion/page.tsx:1-300` — UI actual; A3 añade columna PDF + modal upload + markPaid confirm.
- `src/components/layout/sidebar.tsx:104-119` — gate super-admin; A3 añade link `Audit log`.
- `src/app/platform/page.tsx` — pattern para nueva `/platform/audit`.

### 10.2 Sub-specs relacionados

- `docs/superpowers/specs/2026-05-20-prod-readiness-revision.md` — maestro R1; §4, §5, §8, §12 fijan decisiones canónicas que A3 implementa.
- `docs/superpowers/specs/2026-05-21-subservices-model-design.md` — A1; provee `subservices` table + `subserviceId` en 6 tablas; A3 consume.
- `docs/superpowers/specs/2026-05-22-templates-operator-access-design.md` — A2; provee `templateId/Version/HtmlSnapshot` en `deliverables` + permisos org-scope; A3 consume el snapshot al insertar deliverable.
- `docs/superpowers/specs/2026-05-19-notification-recipient-resolution-design.md` — destinatarios de notificaciones; A3 invoca `resolveOrgNotificationEmail` y `clients.contactEmail` patterns directamente.
- `docs/superpowers/specs/2026-05-20-client-documents-tab-design.md` — Tab Documentos; A3 garantiza que `invoices` table + queries existan para que el tab se popule. A3 NO modifica el tab.
- `docs/superpowers/specs/2026-05-14-deliverable-engine-refactor-design.md` — engine refactor ya mergeado; A3 lo reusa sin modificar (extension via `templateOverride` arg).

### 10.3 Memorias del proyecto

- `project_blob_storage` — Railway bucket = source of truth para PDFs de facturas; A3 lo concreta para invoices con kind="invoices".
- `project_sprint_v2_timeline` — deadline 31-may; A3 termina noche 2026-05-29 para liberar slot a B1.
- `reference_anthropic_api_key` — engine Claude consume `ANTHROPIC_API_KEY` (ya en Keychain); A3 no cambia esa dependencia.
- `project_cuestionario_unificado` — cuestionario unificado por proyección; A3 no toca pero el engine sigue leyendo `questionnaireResponses` como context.

---

**Fin del sub-spec A3.** Con A1, A2, A3 mergeados el operador puede subir
factura PDF, marcarla pagada, y el sistema genera el entregable correcto
con plantilla snapshot y trigger trazable. El flujo crítico del beta del
31-may queda cubierto end-to-end. B1, D1, D2 ya pueden arrancar leyendo
`subservices`, `invoices`, `documentEvents` como fuente de verdad sin
revisitar decisiones de fondo.
