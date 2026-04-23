---
section: 3A
title: Email infrastructure (Resend send + log + webhook)
created: 2026-04-23
status: draft
sprint: projex-v2-15may
depends_on: [2]
blocks: [3B, 3C, reminders]
---

# Sección 3A — Email infrastructure

Primera de tres sub-secciones de Section 3 del sprint v2. Construye la capa
de plomería de email que el resto del sprint consume: `sendEmail` action
con logging, handler de webhooks de Resend, resolver per-org de credenciales,
y UI de inbox administrativo.

No envía correos específicos (cotización, contrato, reminder) — eso es scope
de 3B/3C. Provee el contrato, observabilidad y aislamiento multi-tenant.

## 3A.1 Scope

### Incluido

- **Action `sendEmail`** — reemplaza `convex/functions/email/send.ts` actual.
  Resuelve credenciales per-org (fallback a platform env), inserta `emailLog`
  pending, construye attachments desde `_storage`, llama Resend, actualiza
  `emailLog` con `providerMessageId` o `errorMessage`.
- **Resolver `resolveResendCredentials`** — TS puro + `internalQuery`
  wrapper. Busca en `orgIntegrations` per-org activo, fallback a
  `process.env.RESEND_API_KEY`. Lanza `ResendNotConfiguredError` si ninguno.
- **HTTP webhook `/webhooks/resend`** — via `convex/http.ts`. Verifica HMAC
  con `svix`, resuelve signing secret de la org dueña del email, inserta
  `emailEvents`, actualiza `emailLog.status` idempotentemente.
- **Queries `list` / `getById` / `getEvents` / `getAttachmentUrls`** — con
  role-based filtering: Admin ve todo del org, Ejecutivo solo emails con
  `clientId` ∈ sus clientes asignados.
- **Mutation `resendFromLog`** — re-envía un email fallido. Crea un nuevo
  `emailLog` (no muta el viejo); no trackea link de retries en 3A.
- **UI principal: `/configuracion/email-log`** — tabla cronológica con
  filtros, detail expandible inline con body HTML en iframe sandbox,
  timeline de events, attachments descargables.
- **UI secundaria: `/configuracion/integraciones/resend`** — form para
  configurar API key, from address, from name, webhook secret. Botón
  "Probar conexión". Guía embedded de setup.
- **Hub update:** agregar card "Email Log" y "Integraciones > Resend" al
  hub `/configuracion/page.tsx`.

### Explícitamente fuera de scope

- Envío tipado (sendQuotationEmail, etc.) — scope 3B/3C.
- Templates HTML reutilizables — callers pasan `bodyHtml` ya renderizado.
- `.eml` persistence — defer; el campo `emlStorageId` queda `undefined`.
- Inbound email receiving (MX records, reply handling) — sprint propio futuro.
- Setup automatizado de dominio via Resend API (wizard DNS) — post-sprint.
- Retry automático en background (cron con backoff) — "Reenviar" manual
  desde UI es suficiente para v2.
- Notificaciones push al ejecutivo en bounce — post-sprint.
- Email composer en la UI — el sprint no requiere envíos custom.
- Export CSV del log — post-sprint.
- Link del reintento (`retryOf`) — trata retries como emails independientes.
- Unsubscribe management — futuro.
- Scheduling de envíos ("enviar el lunes 8am") — no sprint.

### Dependencias

- **Section 2 completa** — no bloqueo duro, pero el resolver sigue el patrón
  establecido por `resolveIssuingCompany`.
- Schema actual: `emailLog`, `emailEvents`, `orgIntegrations` ya existen en
  `convex/schema.ts` con los campos necesarios. **No hay cambios de schema.**
- Nueva dep npm: `svix` (HMAC verification para webhooks). `resend` SDK ya
  instalado.
- Nuevas env vars: `RESEND_API_KEY` (ya existía), `RESEND_WEBHOOK_SECRET`,
  `RESEND_FROM_EMAIL` (opcional, default `noreply@projex-platform.com`),
  `RESEND_FROM_NAME` (opcional).
- Setup manual en Resend dashboard: crear webhook endpoint apuntando a
  `<convex-deployment-url>/webhooks/resend` y guardar el signing secret.

### Desbloquea

- **Section 3B** — quotation send + accept/decline pipeline consume `sendEmail`.
- **Section 3C** — contract + Firmame consume `sendEmail`.
- Reminders y notificaciones automáticas futuras.
- Debugging operacional inmediato del admin/ejecutivo.

## 3A.2 Data model

No hay cambios al schema. Todo lo necesario ya existe.

### `emailLog` (convex/schema.ts líneas 377-447)

Campos requeridos en 3A al insertar:
- `orgId`, `type`, `direction` (siempre `"outbound"` en 3A)
- `fromEmail`, `toEmail` (singular — ver §3A.9 riesgo de multi-to)
- `subject`, `status`, `createdAt`, `updatedAt`

Campos opcionales que el action popula según args del caller:
- `relatedType`, `relatedId`, `clientId`, `issuingCompanyId`
- `fromName`, `toName`, `cc`, `bcc`, `replyTo`
- `bodyHtml`, `bodyText`, `attachments[]`
- `provider` (`"resend"`), `providerMessageId` (post-send)
- `errorMessage` (si falla)

Transiciones de `status`:

```
queued → sent → delivered → opened → clicked
          ↓
     bounced | complained | failed
```

Las transiciones son monotónicas forward-only (excepto `queued → failed`
si Resend rechaza sincrónicamente). `clicked` implica `opened`; `opened`
implica `delivered`. Si webhook trae evento de estado "anterior" al
actual (ej. `delivered` llega después de `opened`), se ignora el
downgrade pero se inserta el `emailEvents` row igual para timeline.

Índices relevantes:
- `by_orgId` — list general.
- `by_orgId_status` — filtro por status.
- `by_orgId_type` — filtro por type.
- `by_clientId` — ejecutivo filtrado.
- `by_providerMessageId` — crítico para webhook lookups.

### `emailEvents` (líneas 449-480)

Una row por webhook event. Relación 1:N con `emailLog`.

Campos: `orgId`, `emailLogId`, `providerMessageId`, `provider`,
`eventType`, `metadata` (userAgent, ipAddress, link, bounceType,
bounceReason), `occurredAt`, `createdAt`.

Índices: `by_emailLogId` (timeline), `by_orgId_eventType` (agregados
futuros), `by_providerMessageId` (dedup/correlación opcional).

### `orgIntegrations` (líneas 482-514)

Ya contempla `provider: "resend"` con `config: {apiKeySecretRef,
apiKeyMasked, webhookSecretRef, fromEmail, fromName, sandboxMode, extra}`.

**Decisión sobre storage del API key:** guardamos el key completo en
`apiKeySecretRef` como string directo (sin secret manager externo).
Aceptable para v2: Convex DB no es accesible al cliente, y las queries
que leen la config son internal o admin-only. `apiKeyMasked` se deriva
al guardar: `re_live_****abc1`, para mostrar en la UI sin exponer el
key completo.

`webhookSecretRef` guarda el signing secret que Resend provee al crear
un webhook endpoint.

### Validaciones de negocio

- RFC de email format: `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` para `to`, `from`,
  cada `cc`, cada `bcc`, `replyTo`.
- Attachment size: max 10 MB por archivo, 25 MB total. Pre-check antes
  de leer de storage.
- Multi-tenant: siempre match `orgId` del JWT contra el doc que se lee
  o escribe.
- Ejecutivo bloqueado: `sendEmail` validación — si `args.clientId` está
  presente y no pertenece a los clientes asignados al ejecutivo, throws.

### Referencias a agregar eventualmente (out of scope 3A)

Ninguna tabla necesita nuevos campos para 3A. Si después 3B agrega
`quotations.emailLogIds: v.array(v.id("emailLog"))` o similar, es
cambio local a ese módulo.

## 3A.3 Backend

Directorio: `convex/functions/email/` + `convex/http.ts`.

### `convex/functions/email/resolveConfig.ts`

```ts
import { internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import type { GenericQueryCtx } from "convex/server";
import type { DataModel } from "../../_generated/dataModel";

export class ResendNotConfiguredError extends Error {
  constructor(orgId: string) {
    super(`No hay configuración de Resend activa para la org ${orgId}. Configura el API key en /configuracion/integraciones/resend o establece RESEND_API_KEY en environment.`);
    this.name = "ResendNotConfiguredError";
  }
}

export type ResendConfig = {
  apiKey: string;
  fromEmail: string;
  fromName?: string;
  webhookSigningSecret?: string;
  source: "org_integration" | "platform_env";
};

export async function resolveResendCredentials(
  ctx: GenericQueryCtx<DataModel>,
  args: { orgId: string }
): Promise<ResendConfig> {
  const orgConfig = await ctx.db
    .query("orgIntegrations")
    .withIndex("by_orgId_provider", (q) =>
      q.eq("orgId", args.orgId).eq("provider", "resend")
    )
    .first();

  if (orgConfig && orgConfig.status === "active" && orgConfig.config.apiKeySecretRef) {
    return {
      apiKey: orgConfig.config.apiKeySecretRef,
      fromEmail: orgConfig.config.fromEmail ?? "noreply@projex-platform.com",
      fromName: orgConfig.config.fromName,
      webhookSigningSecret: orgConfig.config.webhookSecretRef,
      source: "org_integration",
    };
  }

  const platformKey = process.env.RESEND_API_KEY;
  if (!platformKey || platformKey === "placeholder") {
    throw new ResendNotConfiguredError(args.orgId);
  }

  return {
    apiKey: platformKey,
    fromEmail: process.env.RESEND_FROM_EMAIL ?? "noreply@projex-platform.com",
    fromName: process.env.RESEND_FROM_NAME,
    webhookSigningSecret: process.env.RESEND_WEBHOOK_SECRET,
    source: "platform_env",
  };
}

export const resolveResendCredentialsQuery = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, args) => resolveResendCredentials(ctx, args),
});

// For webhook: find org + signing secret by providerMessageId
export const resolveWebhookSecretByMessageId = internalQuery({
  args: { providerMessageId: v.string() },
  handler: async (ctx, args) => {
    const log = await ctx.db
      .query("emailLog")
      .withIndex("by_providerMessageId", (q) =>
        q.eq("providerMessageId", args.providerMessageId)
      )
      .first();
    if (!log) return null;
    const config = await resolveResendCredentials(ctx, { orgId: log.orgId });
    return { orgId: log.orgId, emailLogId: log._id, webhookSigningSecret: config.webhookSigningSecret ?? null };
  },
});
```

### `convex/functions/email/send.ts` (reemplaza el archivo actual de 61 líneas)

```ts
"use node";

import { action } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";
import { Resend } from "resend";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENTS_BYTES = 25 * 1024 * 1024;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const sendEmail = action({
  args: {
    to: v.string(),
    subject: v.string(),
    bodyHtml: v.string(),
    bodyText: v.optional(v.string()),
    cc: v.optional(v.array(v.string())),
    bcc: v.optional(v.array(v.string())),
    replyTo: v.optional(v.string()),
    type: v.union(
      v.literal("quotation"), v.literal("quotation_reminder"),
      v.literal("contract"), v.literal("contract_reminder"),
      v.literal("deliverable"), v.literal("questionnaire"),
      v.literal("reminder"), v.literal("custom")
    ),
    relatedType: v.optional(v.union(
      v.literal("quotation"), v.literal("contract"),
      v.literal("deliverable"), v.literal("questionnaire"),
      v.literal("assignment")
    )),
    relatedId: v.optional(v.string()),
    clientId: v.optional(v.id("clients")),
    issuingCompanyId: v.optional(v.id("issuingCompanies")),
    attachmentStorageIds: v.optional(v.array(v.object({
      storageId: v.id("_storage"),
      filename: v.string(),
      contentType: v.optional(v.string()),
    }))),
  },
  handler: async (ctx, args) => {
    // Auth + orgId
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("No autenticado");
    const orgId = (identity.orgId ?? (identity as Record<string, unknown>).org_id) as string;
    if (!orgId) throw new Error("Sin organización");

    // Validar email formats
    if (!EMAIL_REGEX.test(args.to)) throw new Error(`Email inválido: ${args.to}`);
    for (const addr of args.cc ?? []) if (!EMAIL_REGEX.test(addr)) throw new Error(`CC inválido: ${addr}`);
    for (const addr of args.bcc ?? []) if (!EMAIL_REGEX.test(addr)) throw new Error(`BCC inválido: ${addr}`);
    if (args.replyTo && !EMAIL_REGEX.test(args.replyTo)) throw new Error(`Reply-To inválido`);

    // Validar ejecutivo puede enviar a este cliente (si role=member)
    const role = (identity.orgRole as string) ?? "org:member";
    if (role === "org:member" && args.clientId) {
      const isAssigned = await ctx.runQuery(
        internal.functions.email.internalQueries.isClientAssignedToUser,
        { clientId: args.clientId, userId: identity.subject }
      );
      if (!isAssigned) throw new Error("Cliente no asignado a este ejecutivo");
    }

    // Resolve Resend config
    const config = await ctx.runQuery(
      internal.functions.email.resolveConfig.resolveResendCredentialsQuery,
      { orgId }
    );

    // Insert queued emailLog
    const emailLogId = await ctx.runMutation(
      internal.functions.email.internalMutations.insertQueued,
      {
        orgId,
        type: args.type,
        fromEmail: config.fromEmail,
        fromName: config.fromName,
        toEmail: args.to,
        cc: args.cc, bcc: args.bcc, replyTo: args.replyTo,
        subject: args.subject, bodyHtml: args.bodyHtml, bodyText: args.bodyText,
        relatedType: args.relatedType, relatedId: args.relatedId,
        clientId: args.clientId, issuingCompanyId: args.issuingCompanyId,
        attachments: (args.attachmentStorageIds ?? []).map(a => ({
          storageId: a.storageId, filename: a.filename, contentType: a.contentType,
        })),
      }
    );

    try {
      // Build attachments from storage
      const attachments: Array<{ filename: string; content: string }> = [];
      let totalSize = 0;
      for (const att of args.attachmentStorageIds ?? []) {
        const blob = await ctx.storage.get(att.storageId);
        if (!blob) throw new Error(`Attachment ${att.filename} no encontrado en storage`);
        if (blob.size > MAX_ATTACHMENT_BYTES) throw new Error(`Attachment ${att.filename} excede 10MB`);
        totalSize += blob.size;
        if (totalSize > MAX_TOTAL_ATTACHMENTS_BYTES) throw new Error(`Attachments totales exceden 25MB`);
        const buffer = await blob.arrayBuffer();
        attachments.push({
          filename: att.filename,
          content: Buffer.from(buffer).toString("base64"),
        });
      }

      // Call Resend
      const resend = new Resend(config.apiKey);
      const { data, error } = await resend.emails.send({
        from: config.fromName ? `${config.fromName} <${config.fromEmail}>` : config.fromEmail,
        to: args.to,
        subject: args.subject,
        html: args.bodyHtml,
        text: args.bodyText,
        cc: args.cc,
        bcc: args.bcc,
        replyTo: args.replyTo,
        attachments: attachments.length ? attachments : undefined,
        tags: [{ name: "orgId", value: orgId }],
      });

      if (error) {
        await ctx.runMutation(
          internal.functions.email.internalMutations.markFailed,
          { emailLogId, errorMessage: error.message }
        );
        return { ok: false as const, emailLogId, errorMessage: error.message };
      }

      await ctx.runMutation(
        internal.functions.email.internalMutations.markSent,
        { emailLogId, providerMessageId: data!.id }
      );
      return { ok: true as const, emailLogId, providerMessageId: data!.id };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(
        internal.functions.email.internalMutations.markFailed,
        { emailLogId, errorMessage }
      );
      return { ok: false as const, emailLogId, errorMessage };
    }
  },
});
```

### `convex/functions/email/internalMutations.ts`

```ts
insertQueued(args: { orgId, type, fromEmail, fromName?, toEmail, cc?, bcc?, replyTo?, subject, bodyHtml, bodyText?, relatedType?, relatedId?, clientId?, issuingCompanyId?, attachments[] })
  // Inserta emailLog con direction="outbound", status="queued", provider="resend", timestamps.
  // Retorna Id<"emailLog">.

markSent(args: { emailLogId, providerMessageId })
  // Patch emailLog: status="sent", providerMessageId, sentAt=Date.now(), updatedAt.

markFailed(args: { emailLogId, errorMessage })
  // Patch emailLog: status="failed", errorMessage, updatedAt.

handleWebhookEvent(args: { providerMessageId, event: {type, occurredAt, metadata} })
  // 1. Busca emailLog by_providerMessageId. Si no existe, log warning y retorna (idempotencia).
  // 2. Inserta emailEvents row con el event type + metadata.
  // 3. Update emailLog.status si corresponde:
  //      delivered → status="delivered", deliveredAt=occurredAt (solo si status actual es "sent").
  //      opened → status="opened", openedAt=occurredAt (solo si status actual es "delivered" o "sent").
  //      clicked → status="clicked", clickedAt=occurredAt (solo si status actual permite avanzar).
  //      bounced → status="bounced" (siempre, terminal).
  //      complained → status="complained" (siempre, terminal).
  //      failed → status="failed" (siempre, terminal).
  //    Monotonic: no revierte estados más avanzados.
```

### `convex/functions/email/internalQueries.ts`

```ts
isClientAssignedToUser(args: { clientId, userId })
  // Busca client; retorna true si client.assignedTo === userId, false otherwise.

getByIdForResend(args: { id: Id<"emailLog"> })
  // Para resendFromLog action. Valida orgId match con el admin que lo llama.
  // Retorna emailLog completo (incluyendo bodyHtml y attachments array).
```

### `convex/functions/email/queries.ts`

```ts
list(args: { status?, type?, clientId?, search?, limit? }) 
  // Admin: retorna emailLogs del org con filtros aplicados, sort createdAt DESC, limit 50 default.
  // Ejecutivo: retorna emailLogs WHERE clientId IN (sus clientes asignados) + filtros.
  //            Si ejecutivo no tiene clientes, retorna [].
  // search: filtra en toEmail + subject con LIKE case-insensitive in-memory.
  // Retorna Array<emailLog>.

getById(args: { id })
  // Admin: retorna emailLog si orgId match, sino null.
  // Ejecutivo: retorna emailLog solo si orgId match Y clientId es suyo.

getEvents(args: { emailLogId })
  // Mismas validaciones que getById. Retorna Array<emailEvents> sorted by occurredAt ASC.

getAttachmentUrls(args: { emailLogId })
  // Mismas validaciones. Para cada attachment en emailLog.attachments,
  // retorna { filename, url } usando ctx.storage.getUrl(storageId).

getResendConfig(args: {})
  // Admin-only. Retorna el orgIntegrations (provider="resend") con el apiKey enmascarado.
  // Shape: { configured: boolean, fromEmail?, fromName?, apiKeyMasked?, hasWebhookSecret: boolean, status? } | null.
  // El apiKey completo NUNCA se retorna al cliente — solo el masked.
  // Se usa en ResendConfigForm para prellenar valores excepto el API key.
```

### `convex/functions/email/mutations.ts`

```ts
upsertResendConfig(args: { apiKey, fromEmail, fromName?, webhookSigningSecret? })
  // requireAdmin. Guarda en orgIntegrations con provider="resend", status="active".
  // Deriva apiKeyMasked (últimos 4 chars: "re_live_****abc1").
  // Usa ctx.db.query para encontrar el doc existente y patch, o insert si no.
```

### Acciones adicionales en `convex/functions/email/send.ts`

`testResendConnection` y `resendFromLog` son actions (no mutations)
porque requieren llamar APIs externas o orquestar el action de envío.
Viven en el mismo archivo `send.ts` para mantener el módulo cohesivo
("todo lo que toca Resend en runtime").

```ts
testResendConnection = action({
  args: { apiKey: v.string() },
  handler: async (ctx, args) => {
    // requireAuth + requireAdmin role check (via ctx.auth, no internal query needed).
    // Crea Resend client con args.apiKey, llama resend.domains.list().
    // Si 200 → return { ok: true }.
    // Si 401/403/5xx → return { ok: false, error: error.message }.
    // No muta DB.
  },
});

resendFromLog = action({
  args: { id: v.id("emailLog") },
  handler: async (ctx, args) => {
    // requireAdmin.
    // 1. Fetch emailLog via internal query getByIdForResend({id}) que valida orgId.
    // 2. Construye args equivalentes a un sendEmail fresh (to, subject, bodyHtml, type, etc.).
    //    Si attachments originales tenían storageIds, se reusan (si ya no existen,
    //    el nuevo send fallará con mensaje claro — no se previene porque attachments
    //    deberían persistir).
    // 3. Invoca la misma lógica de sendEmail inline (o refactoriza sendEmail a un helper TS reusable).
    // 4. Retorna { ok, emailLogId (nuevo), providerMessageId? }.
  },
});
```

**Nota de refactor:** si se repite mucho código entre `sendEmail` y
`resendFromLog`, extraer la lógica común a una función TS pura
`doSend(ctx, orgId, args): Promise<Result>` en `send.ts`, y ambas
actions la invocan con sus argumentos ya normalizados. Decisión de
implementación, no del spec.

### `convex/http.ts` (nuevo)

```ts
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Webhook } from "svix";

const http = httpRouter();

http.route({
  path: "/webhooks/resend",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await req.text();
    const svixId = req.headers.get("svix-id") ?? "";
    const svixTimestamp = req.headers.get("svix-timestamp") ?? "";
    const svixSignature = req.headers.get("svix-signature") ?? "";
    if (!svixId || !svixTimestamp || !svixSignature) {
      return new Response("Missing svix headers", { status: 400 });
    }

    let payloadUnverified: { type: string; created_at: string; data: { email_id?: string; [k: string]: unknown } };
    try {
      payloadUnverified = JSON.parse(body);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const providerMessageId = payloadUnverified?.data?.email_id;
    if (!providerMessageId) return new Response("Bad payload", { status: 400 });

    const resolved = await ctx.runQuery(
      internal.functions.email.resolveConfig.resolveWebhookSecretByMessageId,
      { providerMessageId }
    );
    if (!resolved) {
      // providerMessageId desconocido — idempotencia: 200 y log.
      console.warn(`[Resend webhook] unknown providerMessageId: ${providerMessageId}`);
      return new Response(null, { status: 200 });
    }
    if (!resolved.webhookSigningSecret) {
      console.warn(`[Resend webhook] no signing secret configured for org ${resolved.orgId}`);
      return new Response("No webhook secret configured", { status: 500 });
    }

    try {
      const wh = new Webhook(resolved.webhookSigningSecret);
      wh.verify(body, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      });
    } catch {
      return new Response("Invalid signature", { status: 401 });
    }

    await ctx.runMutation(
      internal.functions.email.internalMutations.handleWebhookEvent,
      {
        providerMessageId,
        event: {
          type: payloadUnverified.type,  // "email.sent" | "email.delivered" | etc.
          occurredAt: Date.parse(payloadUnverified.created_at),
          metadata: payloadUnverified.data,
        },
      }
    );

    return new Response(null, { status: 200 });
  }),
});

export default http;
```

## 3A.4 UI

Ubicación: `src/app/(dashboard)/configuracion/email-log/` +
`src/app/(dashboard)/configuracion/integraciones/resend/` +
`src/components/email-log/` + `src/components/integraciones/resend/`.

### Rutas

```
/configuracion/                          → page.tsx (hub — agregar cards)
/configuracion/email-log                 → page.tsx (lista + detail inline)
/configuracion/integraciones/resend      → page.tsx (form config)
```

### Update al hub `/configuracion/page.tsx`

Agregar dos entries al array `sections`:

```tsx
{
  href: "/configuracion/email-log",
  icon: Mail,
  title: "Email Log",
  description: "Historial de emails enviados por la plataforma.",
},
{
  href: "/configuracion/integraciones/resend",
  icon: Plug,
  title: "Integración Resend",
  description: "Configura tu API key y dominio para enviar correos.",
},
```

### Componentes email-log

En `src/components/email-log/`:

- **`EmailLogList.tsx`** — tabla con columnas: Fecha (relative "hace 2h"),
  De, Para, Asunto (truncado con ellipsis), Tipo (badge coloreado),
  Status (badge coloreado por estado). Click en row expande
  `<EmailLogDetail>` inline.
  Filtros arriba de la tabla:
  - Search input (busca toEmail + subject).
  - Select por status (todos, queued, sent, delivered, opened, clicked, bounced, complained, failed).
  - Select por type (todos + 8 tipos).
  - Select por cliente (dropdown con clientes del org; para ejecutivo ya filtrado).
  - Paginación: botón "Cargar más" (50 en 50).
  Empty states:
  - Ejecutivo sin clientes: banner "No tienes clientes asignados. El
    email log aparecerá vacío hasta que te asignen clientes."
  - Org sin emails aún: card "No hay emails aún" + hint "Los emails
    enviados desde cotizaciones, contratos o entregables aparecerán aquí."
  - Filtros vacían lista: "No se encontraron emails con estos filtros"
    + botón "Limpiar filtros".

- **`EmailLogDetail.tsx`** — card expandible dentro del row. Muestra:
  - Metadata block: From, To, CC/BCC si hay, Reply-To, Client (link a
    `/clientes/[id]`), Related (link al quotation/contract/deliverable
    vía relatedType + relatedId).
  - Subject como header.
  - Body HTML dentro de `<iframe sandbox="allow-same-origin">` para
    isolation. Height dinámico (se ajusta al content).
  - Timeline de events: lista vertical con íconos y timestamps relative
    + absolute on hover.
  - Attachments: cards con nombre, tamaño (derivado de blob.size — se
    puede leer cuando se genera la URL), botón "Descargar" que abre la
    signed URL.
  - Si `status=failed`: banner rojo con `errorMessage` + botón "Reenviar".
  - Si `status=bounced`: banner amarillo con `bounceReason` (del último
    event).

- **`EmailStatusBadge.tsx`** — componente reusable que renderea un badge
  según status. Mapping:
  - queued: gris.
  - sent: azul.
  - delivered: verde claro.
  - opened: verde.
  - clicked: verde oscuro.
  - bounced: rojo.
  - complained: rojo oscuro con ícono de warning.
  - failed: rojo con ícono de X.

- **`EmailTypeBadge.tsx`** — badge con color según type:
  - quotation/contract: accent.
  - deliverable: morado suave.
  - questionnaire: celeste.
  - reminder: naranja.
  - custom: gris.

### Componentes integraciones/resend

En `src/components/integraciones/resend/`:

- **`ResendConfigForm.tsx`** — form con los campos descritos en §3A.1.
  Estado local + errores inline (patrón de client-form.tsx).
  Tiene botón secundario "Probar conexión" que invoca
  `testResendConnection` y muestra result inline (check verde "Conexión
  OK" o X rojo con el error literal).
  Botón primario "Guardar" guarda via `upsertResendConfig`.
  Si ya existe config, carga valores prellenados excepto el API key
  (queda placeholder con el masked value para no exponer).

- **`ResendSetupGuide.tsx`** — componente estático con 5 pasos:
  1. Crea cuenta en [resend.com](https://resend.com).
  2. Agrega tu dominio en Resend.
  3. Configura los DNS records que Resend te indica.
  4. Verifica el dominio (puede tardar algunas horas).
  5. Crea un API key en Resend y pégalo aquí.
  Cada paso tiene un número + descripción + link relevante al dashboard
  de Resend. Sin screenshots por ahora.

- **`EmailLogPage.tsx`** — wrapper con breadcrumb `Configuración > Email Log`,
  título, render del list.

- **`ResendConfigPage.tsx`** — wrapper con breadcrumb
  `Configuración > Integración Resend`, título, guide + form.

### Estado y queries

- List: `useQuery(api.functions.email.queries.list, { status, type, clientId, search, limit })`.
- Detail events: cuando se expande un row, `useQuery(api.functions.email.queries.getEvents, { emailLogId })`.
- Attachment URLs: `useQuery(api.functions.email.queries.getAttachmentUrls, { emailLogId })` cuando el detail se expande.
- Resend config read: `useQuery(api.functions.email.queries.getResendConfig, {})` — retorna el masked config actual para prellenar el form.
- Mutations: `upsertResendConfig`, `resendFromLog`.
- Action: `testResendConnection` (via `useAction`).

### Permisos en la UI

- Email log list/detail: admin + ejecutivo (filtrado a sus clientes).
- Resend config page: admin-only. Ejecutivo redirige a `/configuracion/email-log` con mensaje "Solo admins pueden configurar integraciones".
- Botón "Reenviar" en email fallido: admin-only (aunque ejecutivo vea el email fallido, no puede reenviar).

## 3A.5 Seed dummy (opcional)

No hay seed nuevo. `v2Fixtures` de Section 2 no toca `emailLog`. Para
probar 3A manualmente:
1. Configura Resend en `/configuracion/integraciones/resend` (con key de
   prueba o sandbox mode).
2. Llama `sendEmail` desde la Convex dashboard o desde un test manual:
   `npx convex run email/send:sendEmail '{"to":"test@ejemplo.com","subject":"Hola","bodyHtml":"<p>Test</p>","type":"custom"}'`.
3. Ver el email aparecer en `/configuracion/email-log`.

Si se quiere seed programático futuro, un comando
`seedEmailLog({ count: N })` que inserta N rows con datos fake. Out of
scope para 3A.

## 3A.6 Error handling (consolidado)

| Fuente | Error | Comportamiento |
|---|---|---|
| `sendEmail` | No autenticado | Throws; UI redirige a login. |
| `sendEmail` | Sin Resend configurado | Throws `ResendNotConfiguredError` antes de insertar emailLog. Caller maneja: toast/banner "Configura Resend en integraciones" con link. |
| `sendEmail` | Ejecutivo envía a cliente no suyo | Throws en internal query; UI esconde botón pero backend bloquea. |
| `sendEmail` | Email format inválido | Throws sincronicamente; nada en DB. |
| `sendEmail` | Attachment > 10 MB | Throws en pre-check, emailLog queda en `queued` momentáneamente, luego `failed` con errorMessage. |
| `sendEmail` | Total attachments > 25 MB | Igual que anterior. |
| `sendEmail` | Resend 4xx/5xx/timeout | emailLog → `failed` con errorMessage del provider. Retorna `{ok: false}` al caller. |
| `sendEmail` | Storage lookup fallido | emailLog → `failed` con mensaje "Attachment X no encontrado". |
| Webhook | HMAC inválido | Response 401. Nada en DB. Warning log. |
| Webhook | providerMessageId desconocido | Response 200 (idempotencia). Warning log. Nada en DB. |
| Webhook | Event duplicado | Se inserta emailEvents igual (pocos duplicados, no vale dedup). Status update monotónico. |
| Webhook | Missing signing secret para la org | Response 500 con warning log. Admin debe configurarlo en orgIntegrations. |
| `list` query | Ejecutivo sin clientes | Retorna `[]`; UI banner informativo. |
| `resendFromLog` | Email no existe | Throws; UI toast "Email no encontrado". |
| `testResendConnection` | Key inválido | Retorna `{ok: false, error}`; UI muestra error literal de Resend. |
| Auth | Ejecutivo intenta mutation admin | `requireAdmin` throws 403; UI esconde el botón previamente. |

### Race conditions y idempotencia

- **Doble webhook:** `emailEvents` acepta duplicados; `emailLog.status`
  update es monotónico (delivered → opened OK, opened → delivered ignorado).
- **insertQueued + markSent crash entre ambos:** emailLog queda en `queued`
  para siempre. Aceptable v2; post-launch: cron que barre `queued` >5min
  y los marca `failed` con reason="orphaned".
- **Dos admins guardando Resend config:** Convex mutation atomic; último
  gana. Aceptable.

### Tamaño de payloads

- Convex action args ~tiene límite grande (10MB+). HTML body de 50KB +
  25MB attachments base64-encoded (~33MB) — puede acercarse al límite.
  Pre-check de 25MB total protege.
- Webhook body de Resend: JSON de <10KB típico. No hay riesgo.

## 3A.7 Testing

Alineado con la pirámide 70/25/5.

### Unit + integration (convex-test)

`convex/functions/email/__tests__/`:

- **`resolveConfig.test.ts`** — 5 casos:
  - Org con Resend activo + key → `source="org_integration"`.
  - Org con Resend `status="inactive"` → fallback platform.
  - Sin orgIntegrations + env presente → `source="platform_env"`.
  - Sin orgIntegrations + sin env → throws `ResendNotConfiguredError`.
  - Org A config no interfiere con Org B.

- **`sendEmail.test.ts`** — 8 casos (con `vi.mock("resend")`):
  - Admin + org configurada → emailLog `sent` con `providerMessageId`.
  - Resend 4xx → emailLog `failed` con errorMessage; return `{ok: false}`.
  - Resend timeout → `failed`.
  - Ejecutivo a cliente propio → OK.
  - Ejecutivo a cliente ajeno → throws.
  - Attachment > 10MB → pre-check error, emailLog `failed`.
  - Sin Resend configurada → throws antes de insertar.
  - Multi-tenant: org A send, org B `list` no ve.

- **`httpWebhook.test.ts`** — 8 casos:
  - Payload + signature válidos + event `delivered` → emailLog `delivered`,
    emailEvents inserted.
  - Signature inválida → 401, nada en DB.
  - providerMessageId desconocido → 200 idempotencia.
  - Event `opened` → status `opened`, openedAt set.
  - Event `clicked` → status `clicked`, metadata.link stored.
  - Event `bounced` → status `bounced`, bounceType stored.
  - Event `complained` → status `complained`.
  - Evento backwards (ya en `opened`, llega `delivered`) → emailEvents
    inserted, status `opened` queda.

- **`queries.test.ts`** — 6 casos:
  - `list` Admin retorna todos de su org.
  - `list` Ejecutivo retorna solo sus clientes.
  - `list` con filtros (status, type, search) funciona.
  - `list` cross-org returns [].
  - `getById` id de otra org → null.
  - `getEvents` retorna timeline ordenado.

- **`permissions.test.ts`** — 4 casos:
  - Ejecutivo puede list/getById/getEvents de sus emails.
  - Ejecutivo NO puede `upsertResendConfig`, `testResendConnection`, `resendFromLog`.
  - Admin ejecuta todo OK.
  - Auth faltante en action → throws.

### E2E (Playwright)

Deferido. 3A no tiene golden path propio; se cubre desde 3B al enviar
una cotización real.

### Target

+~31 tests sobre baseline actual (89 → ~120). Cobertura sólida de todos
los paths críticos del webhook y del send.

### Mocks y helpers

- `vi.mock("resend")` con stub de `emails.send()`.
- `svix.Webhook.sign()` para generar signatures válidas en tests.
- Harness `setupTest()` ya existe desde Section 2.
- Helper nuevo opcional `mockResendSend({ ok: true })` y `mockResendSend({ ok: false, error })` en `__tests__/helpers/resend.ts`.

## 3A.8 Dependencias y qué desbloquea

### Depends on

- Section 2 completada (patrón de resolver como referencia; no bloqueo duro).
- Schema actual (sin cambios).
- `convex-test` + `@edge-runtime/vm` (ya instalados).
- Nueva dep: `svix` (transitiva en `resend` pero hacer explícita).
- Setup manual en Resend dashboard + env vars.

### Unblocks

- Section 3B — quotation send + accept/decline (consume sendEmail).
- Section 3C — contract + Firmame (consume sendEmail).
- Reminders y notificaciones automáticas futuras.
- Debugging operacional por admin/ejecutivo desde el inbox.

## 3A.9 Riesgos y tradeoffs

### Webhook HMAC secret rotation

Si Resend rota el signing secret o el admin lo cambia sin actualizar en
Projex, los webhooks empiezan a fallar silenciosamente (401 sin
feedback al usuario). **Mitigación v2:** el log de fallos de HMAC
verification escribe a consola. El admin detecta por ausencia de
updates de status en emails recientes (se quedan en `sent` sin avanzar
a `delivered`). **Post-sprint:** métrica de observabilidad con alerta.

### Platform-level key como default

Hasta que la org configure su Resend, los emails salen del dominio de
Projex. Si el dominio se quema por abuso/spam de una org, afecta a
todas las orgs que usen el fallback. **Mitigación:** monitorear bounce
rate del platform; forzar migración a per-org cuando dolor aparezca.

### Attachments grandes

25MB total post-base64 es ~33MB cruzando Convex action boundary. Convex
tiene límites ~de 20MB para request body. Pre-check previene problema
antes de procesar. Si falla, reason es claro. **Futuro:** para
attachments muy grandes, usar flujo de "send with link to download" en
vez de inline attachment.

### Rate limits de Resend

Free tier: 3000/mes, 100/día. Platform-level compartido se satura
rápido si múltiples orgs envían sin config propia. **Mitigación para
staging/dev:** suficiente. **Para producción con ~50 clientes reales:**
pagar tier de Resend o forzar per-org.

### Multi-to deferido

`emailLog.toEmail` es singular. 3A `sendEmail` acepta solo un destinatario.
Si 3B/3C requieren enviar a varios, hacen múltiples calls (uno por
destinatario, cada uno con su emailLog propio). Más simple pero menos
eficiente. Cambio schema futuro: `toEmails?: v.array(v.string())` +
update action args.

### .eml deferido

Sin `.eml` en `_storage`, si alguien pide "dame el archivo .eml del
email que le mandé a X" para legal/audit, no se puede servir inmediato.
El admin tiene toda la info en el detail (HTML + metadata + events),
solo no en formato `.eml` nativo. Reconstruirlo en otro sprint si
aparece el requerimiento.

### Single-recipient webhooks vía Svix

Si Resend cambia su mecanismo de firma de webhooks (ej. de svix a algo
propietario), hay que refactorizar el handler. **Mitigación:**
abstraer la verificación a un helper `verifyResendWebhook()` en
`resolveConfig.ts` para que el refactor toque un solo archivo.
