---
section: 3B
title: Quotation send + accept/decline
created: 2026-04-24
status: draft
sprint: projex-v2-15may
depends_on: [2, 3A]
blocks: [3C, reminders]
---

# Sección 3B — Quotation send + accept/decline

Segunda sub-sección de Section 3 del sprint v2. Construye el pipeline
de "enviar cotización por email + cliente acepta o rechaza desde un
link público". Al aceptar, el sistema dispara generación del contrato
en background (AI-heavy); el contrato queda como `draft` listo para
que Section 3C (Firmame) lo envíe a firmar.

3B consume `sendEmail` de 3A y `resolveIssuingCompany` de Section 2.
No envía contratos (eso es 3C). No maneja recordatorios automáticos
(futuro).

## 3B.1 Scope

### Incluido

- **Action `sendQuotation`** — en `convex/functions/quotations/actions.ts`.
  Valida auth + orgId + permisos (Admin o Ejecutivo dueño del cliente).
  Pre-checks: PDF existe (`quotation.pdfStorageId`), cliente tiene
  `contactEmail`, status es `draft` o `sent` (permite re-envío).
  Resuelve empresa emitente via `resolveIssuingCompany`. Genera token
  HMAC nuevo, rota el anterior. Escribe `lastSentAt`, `sendCount++`,
  `tokenIssuedAt`, `tokenExpiresAt`, `accessTokenHash`. Transiciona a
  `sent`. Llama `sendEmail` (3A) con body HTML renderizado + PDF
  attachment. Si `sendEmail` falla, throws — el token ya quedó rotado
  (trade-off documentado en §3B.9).

- **Public actions `acceptQuotation` + `declineQuotation`** — en
  `convex/functions/quotations/publicActions.ts`. Sin auth. Reciben
  `{token}` (y opcional `{declineReason}` para decline). Hashean token
  con HMAC-SHA256 via `QUOTATION_TOKEN_SECRET`. Delegan a internal
  mutations `applyAcceptance` / `applyDecline` que validan y
  transicionan atómicamente. Si accept: agenda
  `generateContractFromQuotationInternal` via `ctx.scheduler.runAfter(0, ...)`.
  Limpian `accessTokenHash` (single-use).

- **Public query `getByToken`** — en
  `convex/functions/quotations/publicQueries.ts`. Sin auth. Retorna un
  shape discriminado por `kind`: `ready` | `expired` |
  `already_responded` | `invalid`. En `ready` incluye `quotation.content`,
  `serviceName`, `client.name` + `contactName`, `issuingCompany`
  (name, logo, colors, signatoryName, address).

- **Helpers `tokenHelpers.ts`** — `generateToken()` (32 bytes random,
  base64url), `hashToken(token)` (HMAC-SHA256 con
  `QUOTATION_TOKEN_SECRET`), constante `TOKEN_TTL_MS = 30 días`.

- **Refactor en `contracts/actions.ts`** — extraer `doGenerate(ctx, orgId, quotationId)`
  como helper TS puro. `generateContract` (action público actual) sigue
  siendo el wrapper con `ctx.auth`. Nuevo `generateContractFromQuotationInternal`
  (`internalAction`) que acepta `orgId` explícito y llama al mismo
  helper — usado por el scheduler de `acceptQuotation`. Empieza
  chequeando `contracts.getByQuotation({quotationId})`: si ya existe,
  no-op (idempotencia si el ejecutivo también lo generó manual).

- **UI dashboard** — modificaciones a `/cotizaciones/[id]`:
  - Botón "Enviar por email" reemplaza el "Enviar" actual (que solo
    cambiaba status). Abre `<SendQuotationDialog>`.
  - Deshabilitado con tooltip si falta PDF / contactEmail / status
    terminal. Si status=sent, label cambia a "Reenviar" y el dialog
    advierte sobre invalidación de links anteriores.
  - Botones "Aprobar"/"Rechazar" manuales se mueven a menú overflow
    como escape hatch admin (ya no flujo principal).
  - Nuevo panel `<SendStatusPanel>` arriba del content: card con
    último envío, count, expiración, link copiable (solo inmediatamente
    post-envío). Banner verde/rojo si approved/rejected con fecha y
    declineReason.

- **UI pública** — `src/app/q/cotizacion/[token]/`:
  - Layout minimalista sin dashboard chrome.
  - Landing muestra HTML de la cotización con branding de empresa
    emitente (logo, colores).
  - Bottom bar sticky con "Aceptar cotización" (primary) y "Rechazar"
    (ghost).
  - Modal de decline opcional con textarea de motivo (max 500 chars).
  - Estados terminales: confirmación post-accept/decline, expired,
    invalid, already_responded.
  - `<meta name="robots" content="noindex,nofollow">` en layout.

### Explícitamente fuera de scope

- Recordatorios automáticos ("cliente no respondió en 7 días → email").
  Cron futuro sobre los mismos campos `lastSentAt`, `respondedAt`.
- Revivir quotations `rejected` → `draft` (ejecutivo debe crear nueva).
- Edición del body HTML del email — template fijo; solo subject editable.
- Preview del email en ventana aparte (dialog muestra lo esencial).
- Firmame — scope de 3C. 3B solo dispara generación del contract draft.
- Notificación interna al ejecutivo cuando cliente acepta/rechaza
  (documentado en §3B.10 como post-sprint).
- Analytics de conversion rate / tasa de aceptación / tiempo promedio
  de respuesta. Futuro.
- Envío a múltiples destinatarios (`cc`/`bcc`) en la cotización. Solo
  `to` singular en v2.
- Mobile app nativa — solo web pública.
- Export de los datos de respuesta (CSV). Post-sprint.

### Dependencias

- **Section 2 completa** — usa `resolveIssuingCompany` para determinar
  emitente (branding del email + landing, y `issuingCompanyId` que va
  al emailLog).
- **Section 3A completa** — usa `sendEmail`, `emailLog`, webhook
  Resend. 3B solo consume; no modifica.
- Schema changes (§3B.2) deben desplegarse antes del feature.
- Envs nuevas:
  - `QUOTATION_TOKEN_SECRET` — 32+ bytes random (`openssl rand -base64 48`).
  - `APP_URL` — verificar existente (dev: `http://localhost:3000`).
- Sin nuevas dep npm. `crypto` es builtin de Node.

### Desbloquea

- **Section 3C** — contract + Firmame. 3C detecta contratos draft con
  `quotation.status === "approved"` y dispara el send + sign flow.
- Recordatorios automáticos (cron futuro).
- §3B.10 (pipeline visibility + notificaciones internas) — los
  `TODO(pipeline-visibility)` en `applyAcceptance`/`applyDecline` son
  hooks pre-planeados.
- Analytics post-launch.

## 3B.2 Data model

Dos tablas afectadas, cero tablas nuevas.

### `quotations` — agregar 7 campos

```ts
quotations: defineTable({
  // ...existentes...
  orgId: v.string(),
  projServiceId: v.id("projectionServices"),
  clientId: v.id("clients"),
  serviceName: v.string(),
  content: v.string(),
  pdfStorageId: v.optional(v.id("_storage")),
  status: v.union(
    v.literal("draft"),
    v.literal("sent"),
    v.literal("approved"),
    v.literal("rejected")
  ),
  createdAt: v.number(),

  // NUEVOS en 3B
  lastSentAt: v.optional(v.number()),           // timestamp último envío
  sendCount: v.optional(v.number()),            // default 0, ++ cada send
  accessTokenHash: v.optional(v.string()),      // HMAC-SHA256 del token
  tokenIssuedAt: v.optional(v.number()),
  tokenExpiresAt: v.optional(v.number()),       // lastSentAt + 30d
  respondedAt: v.optional(v.number()),          // accept o decline
  declineReason: v.optional(v.string()),        // texto libre opcional
})
  // ...índices existentes...
  .index("by_accessTokenHash", ["accessTokenHash"])  // NUEVO
```

**Notas:**
- `sendCount` y `lastSentAt` son redundantes con aggregation sobre
  `emailLog` (filtrable por `relatedType="quotation"` + `relatedId`).
  Se duplican en `quotations` para evitar joins en la UI de detalle.
- `accessTokenHash` guarda solo el hash HMAC — el plaintext vive
  únicamente en el email enviado. Si la DB se filtra, tokens no son
  recuperables.
- `by_accessTokenHash` es global (sin `orgId` prefix) porque el
  endpoint público no conoce la org de antemano. Unicidad probabilística
  (HMAC-SHA256 de 32 bytes random ≈ 2^256) elimina colisión cross-org.
- `declineReason` opcional, texto libre. Si vacío/undefined, queda
  undefined.

### `clients` — agregar 2 campos opcionales

```ts
clients: defineTable({
  // ...existentes...
  orgId: v.string(),
  name: v.string(),
  rfc: v.string(),
  industry: v.string(),
  annualRevenue: v.number(),
  billingFrequency: v.union(...),
  isArchived: v.boolean(),
  assignedTo: v.optional(v.string()),
  createdAt: v.number(),

  // NUEVOS en 3B
  contactEmail: v.optional(v.string()),
  contactName: v.optional(v.string()),
})
  // índices sin cambio
```

### Validaciones de negocio

- `sendQuotation` throws si `client.contactEmail` undefined → UI muestra
  "Agrega el email de contacto" con link a `/clientes/[id]/editar`.
- Email format regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` en `sendQuotation` y
  también en `clients.mutations.updateClient` al guardar (nunca se
  guarda mal).
- `contactEmail` normalizado a lowercase al guardar.
- `declineReason` truncado a 500 chars si excede (no throws, solo
  `.slice(0, 500)` + warn log).

### Transiciones de status

```
draft ─────sendQuotation───────→ sent
sent  ─────sendQuotation───────→ sent (re-envío, rota token)
sent  ─────acceptQuotation─────→ approved
                                  └─→ scheduler.runAfter(0, generateContractFromQuotationInternal)
sent  ─────declineQuotation────→ rejected
(terminal: approved, rejected)
```

Las transiciones manuales del dashboard vía `updateStatus` (líneas
203-234 de `quotations/mutations.ts`) quedan como escape hatch admin.
Ya validan transiciones (`draft → sent`, `sent → approved|rejected`),
no permiten revivir rejected. OK.

### Backfill / migration

- Clientes existentes: `contactEmail`/`contactName` quedan undefined.
  Se completan on-demand la primera vez que se intenta enviar.
- Quotations existentes: `sendCount` queda undefined — código trata
  undefined como 0.
- Sin migration script necesario.

## 3B.3 Backend

### Estructura del módulo

```
convex/functions/quotations/
  queries.ts             (existente — agrega getSendPreviewContext)
  mutations.ts           (existente — sin cambios; updateStatus queda como escape hatch)
  actions.ts             (existente — agrega sendQuotation)
  internalQueries.ts     (existente — agrega getSendContext, getByTokenHash)
  internalMutations.ts   (NUEVO — rotateTokenAndMarkSent, applyAcceptance, applyDecline)
  tokenHelpers.ts        (NUEVO — generate/hash puros, node-only)
  publicActions.ts       (NUEVO — acceptQuotation, declineQuotation)
  publicQueries.ts       (NUEVO — getByToken)
```

### `tokenHelpers.ts`

```ts
"use node";
import crypto from "crypto";

export const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function generateToken(): string {
  return crypto.randomBytes(32).toString("base64url"); // 43 chars
}

export function hashToken(token: string): string {
  const secret = process.env.QUOTATION_TOKEN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("QUOTATION_TOKEN_SECRET no configurado o < 32 chars.");
  }
  return crypto.createHmac("sha256", secret).update(token).digest("base64url");
}
```

### `actions.ts` — agrega `sendQuotation`

```ts
export const sendQuotation = action({
  args: {
    quotationId: v.id("quotations"),
    toOverride: v.optional(v.string()),
    subjectOverride: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // 1. Auth + orgId + role check (Admin o Ejecutivo dueño del cliente).
    // 2. ctx.runQuery getSendContext → {quotation, client, projService,
    //    service, issuingCompany, orgBranding}.
    // 3. Validaciones pre-envío:
    //    - quotation.status in ["draft", "sent"]
    //    - quotation.pdfStorageId existe
    //    - effectiveTo = args.toOverride ?? client.contactEmail; si
    //      undefined → throw
    //    - emailRegex(effectiveTo)
    //    - si ejecutivo, client.assignedTo === identity.subject
    // 4. Generar token: plaintext = generateToken(); hash = hashToken(plaintext).
    //    tokenIssuedAt = now; tokenExpiresAt = now + TOKEN_TTL_MS.
    // 5. ctx.runMutation rotateTokenAndMarkSent → patch quotation.
    // 6. Construir email:
    //    subject = args.subjectOverride ?? `Cotización ${serviceName} — ${issuingCompany.name}`
    //    bodyHtml = buildQuotationEmailHtml({client, serviceName,
    //               issuingCompany, token: plaintext,
    //               appUrl: process.env.APP_URL})
    //    attachments = [{storageId: quotation.pdfStorageId,
    //                    filename: `cotizacion-${slug(serviceName)}-${slug(client.name)}.pdf`}]
    // 7. ctx.runAction internal.functions.email.send.sendEmail({
    //      to: effectiveTo, subject, bodyHtml,
    //      type: "quotation", relatedType: "quotation",
    //      relatedId: quotationId, clientId, issuingCompanyId,
    //      attachmentStorageIds: [...],
    //    })
    //    Si result.ok === false → throw new Error(result.errorMessage).
    // 8. return {ok: true, emailLogId, plaintextToken, appUrl, sendCount}.
    //    (plaintextToken se retorna solo para el botón "Copiar link"
    //     del dashboard — en la UI, se mantiene en React state y se
    //     pierde al refresh. No se persiste.)
  },
});
```

Helper puro en el mismo archivo (o en `lib/emailTemplates.ts` si crece):

```ts
function buildQuotationEmailHtml(input: {
  client: { name: string; contactName?: string };
  serviceName: string;
  issuingCompany: { name: string; primaryColor?: string };
  token: string;
  appUrl: string;
}): string {
  const greeting = input.client.contactName
    ? `Estimado/a ${input.client.contactName}`
    : `Estimado/a cliente`;
  const link = `${input.appUrl}/q/cotizacion/${input.token}`;
  const primary = input.issuingCompany.primaryColor ?? "#1a1a2e";
  return `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px;">
  <p>${greeting},</p>
  <p>Te compartimos la cotización de <strong>${input.serviceName}</strong>
  por parte de <strong>${input.issuingCompany.name}</strong>.</p>
  <p>Puedes revisarla y responder directamente desde el siguiente enlace:</p>
  <p style="margin: 32px 0; text-align: center;">
    <a href="${link}" style="display: inline-block; background: ${primary};
       color: white; padding: 14px 28px; border-radius: 6px;
       text-decoration: none; font-weight: 600;">Ver cotización</a>
  </p>
  <p style="color: #666; font-size: 13px;">También adjuntamos el PDF.
  La cotización es válida por 30 días naturales.</p>
  <p style="color: #666; font-size: 13px;">Si el botón no funciona,
  copia este link en tu navegador:<br/>
  <span style="color: ${primary}; word-break: break-all;">${link}</span></p>
</div>`.trim();
}
```

### `internalMutations.ts` (nuevo)

```ts
rotateTokenAndMarkSent(args: {
  quotationId: v.id("quotations"),
  tokenHash: v.string(),
  tokenIssuedAt: v.number(),
  tokenExpiresAt: v.number(),
})
  // Confía que el caller (action) validó orgId.
  // Patch quotation:
  //   status: "sent"
  //   lastSentAt: now
  //   sendCount: (prev ?? 0) + 1
  //   accessTokenHash, tokenIssuedAt, tokenExpiresAt
  // Retorna { sendCount, tokenExpiresAt }.

applyAcceptance(args: { tokenHash: v.string() })
  // 1. Busca quotation by_accessTokenHash.
  // 2. Si null → throw new Error("invalid_token").
  // 3. Si quotation.status !== "sent" → throw new Error("already_responded").
  //    (landing parsea error.message para distinguir de "invalid_token")
  // 4. Si !tokenExpiresAt || tokenExpiresAt < now → throw new Error("expired").
  // 5. Patch:
  //    status: "approved"
  //    respondedAt: now
  //    accessTokenHash: undefined  (single-use)
  // 6. TODO(pipeline-visibility): emitir notification interna cuando
  //    §3B.10 se implemente.
  // 7. Retorna {quotationId, orgId, clientId, projServiceId}.

applyDecline(args: { tokenHash: v.string(), declineReason?: v.string() })
  // Idéntico a applyAcceptance pero:
  //   status: "rejected"
  //   declineReason: args.declineReason?.slice(0, 500) || undefined
  //                  (si empty string, undefined)
  // TODO(pipeline-visibility): emitir notification.
  // Retorna {quotationId, orgId}.
```

### `internalQueries.ts` (extender)

```ts
getSendContext(args: { quotationId: v.id("quotations") })
  // Consolida todas las lecturas necesarias para construir el email:
  //   quotation, client (con contactEmail, contactName), projService,
  //   service, issuingCompany (via resolveIssuingCompany), orgBranding.
  // Evita N-queries desde la action. La action hace validaciones.

getByTokenHash(args: { tokenHash: v.string() })
  // Simple lookup by_accessTokenHash; retorna doc o null.
```

### `queries.ts` (extender) — nueva query para dialog preview

```ts
getSendPreviewContext(args: { quotationId: v.id("quotations") })
  // Public query con auth (requireOrgMember). Valida orgId match.
  // Si ejecutivo, valida client.assignedTo === identity.subject.
  // Retorna subset seguro del send context:
  //   {
  //     client: { name, contactEmail, contactName },
  //     issuingCompany: { _id, name, logoStorageUrl, primaryColor } | null,
  //     issuingCompanyError: string | null,  // si resolveIssuingCompany throws
  //     pdfFilename: string,                  // precomputado
  //     defaultSubject: string,               // "Cotización X — Empresa Y"
  //     tokenTtlDays: 30,
  //   }
  // Se usa en SendQuotationDialog para prellenar campos + mostrar preview
  // del emitente sin ejecutar la action.
```

### `publicQueries.ts` (nuevo)

```ts
getByToken(args: { token: v.string() })
  // Query pública sin auth.
  // Hashea el token con Convex runtime crypto.subtle (WebCrypto):
  //   const encoder = new TextEncoder();
  //   const key = await crypto.subtle.importKey(
  //     "raw", encoder.encode(secret),
  //     { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  //   const sig = await crypto.subtle.sign("HMAC", key,
  //     encoder.encode(args.token));
  //   const hash = base64urlEncode(new Uint8Array(sig));
  // Busca by_accessTokenHash.
  // Retorna shape discriminado por kind:
  //   { kind: "invalid" }
  //   { kind: "expired" }
  //   { kind: "already_responded", status, respondedAt }
  //   { kind: "ready",
  //     quotation: {content, serviceName, tokenExpiresAt},
  //     client: {name, contactName?},
  //     issuingCompany: {name, logoStorageUrl, signatoryName,
  //                      primaryColor, secondaryColor, address} }
  // Nunca retorna el quotation completo con campos internos — solo lo
  // que la landing necesita.
```

**Fallback si `crypto.subtle` en Convex runtime da guerra durante
implementación:** mover `getByToken` a un action en `publicActions.ts`.
Pierde reactividad de `useQuery` (el landing no necesita reactividad
real — carga una vez, actúa una vez). Decisión de implementación.

### `publicActions.ts` (nuevo)

```ts
"use node";

export const acceptQuotation = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const hash = hashToken(args.token);
    const result = await ctx.runMutation(
      internal.functions.quotations.internalMutations.applyAcceptance,
      { tokenHash: hash }
    );
    // result = { quotationId, orgId, clientId, projServiceId }
    await ctx.scheduler.runAfter(0,
      internal.functions.contracts.actions.generateContractFromQuotationInternal,
      { quotationId: result.quotationId, orgId: result.orgId }
    );
    return { status: "approved" as const, quotationId: result.quotationId };
  },
});

export const declineQuotation = action({
  args: { token: v.string(), declineReason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const hash = hashToken(args.token);
    const result = await ctx.runMutation(
      internal.functions.quotations.internalMutations.applyDecline,
      { tokenHash: hash, declineReason: args.declineReason }
    );
    return { status: "rejected" as const, quotationId: result.quotationId };
  },
});
```

### Refactor en `contracts/actions.ts`

```ts
// Helper TS puro, reusable:
async function doGenerate(ctx: ActionCtx, orgId: string,
                          quotationId: Id<"quotations">): Promise<Id<"contracts">> {
  // 1. Check idempotencia: contracts.getByQuotation. Si existe, return ese id.
  // 2. Fetch quotation, client, projService, service, orgBranding, issuingCompany.
  //    (Todos via internal queries con orgId explícito — sin ctx.auth.)
  // 3. Ejecutar AI pipeline existente (variable resolution + Claude calls
  //    + fallback HTML) — mismo código que generateContract actual tiene
  //    inline, extraído aquí.
  // 4. Guardar via internal mutation.
  // 5. Return contractId.
}

// Action público existente — lee orgId de ctx.auth y delega.
export const generateContract = action({
  args: { quotationId: v.id("quotations") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("No autenticado");
    const orgId = ...;
    return doGenerate(ctx, orgId, args.quotationId);
  },
});

// Internal action para scheduler — orgId explícito.
export const generateContractFromQuotationInternal = internalAction({
  args: {
    quotationId: v.id("quotations"),
    orgId: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      await doGenerate(ctx, args.orgId, args.quotationId);
    } catch (err) {
      console.error(`[Contract auto-gen] Failed for quotation ${args.quotationId}:`, err);
      // No re-throw — scheduler no reintenta. Ejecutivo puede regenerar manual
      // desde el dashboard si falta.
    }
  },
});
```

### Envs nuevas

- `QUOTATION_TOKEN_SECRET` — generar con `openssl rand -base64 48`.
  Guardar en `.env.local` + Convex dashboard production.
- `APP_URL` — verificar existente. Dev: `http://localhost:3000`.
  Prod: URL de deploy.

### Permisos en `sendQuotation`

- Admin (`org:admin`) puede enviar cualquier quotation del org.
- Ejecutivo (`org:member`) solo si `client.assignedTo === identity.subject`.
- Super Admin no aplica — flujo de usuarios del org.

## 3B.4 UI

Dos superficies: dashboard (ejecutivo/admin) y landing pública (cliente).

### Ubicación de archivos

```
src/app/(dashboard)/cotizaciones/[id]/page.tsx        (existente — se modifica)
src/components/cotizaciones/SendQuotationDialog.tsx   (NUEVO)
src/components/cotizaciones/SendStatusPanel.tsx       (NUEVO)

src/app/q/cotizacion/[token]/page.tsx                 (NUEVO)
src/app/q/cotizacion/[token]/layout.tsx               (NUEVO — sin dashboard chrome)
src/components/public/QuotationLandingContent.tsx     (NUEVO)
src/components/public/QuotationRespondedState.tsx     (NUEVO)
src/components/public/DeclineReasonDialog.tsx         (NUEVO)
src/components/public/ExpiredState.tsx                (NUEVO)
src/components/public/InvalidTokenState.tsx           (NUEVO)
```

### Dashboard — cambios en `/cotizaciones/[id]/page.tsx`

Reemplazar el botón "Enviar" actual (línea 287 del archivo) por
**"Enviar por email"** que abre `<SendQuotationDialog>`. Estados:

- `!quotation.pdfStorageId` → deshabilitado, tooltip "Genera el PDF
  antes de enviar".
- `!client?.contactEmail` → deshabilitado, tooltip "Agrega email de
  contacto del cliente" + link inline a `/clientes/[id]/editar`.
- `status in ["approved", "rejected"]` → botón no se renderea.
- `status === "sent"` → label cambia a **"Reenviar"**, el dialog
  advierte: "Este es el reenvío #{sendCount+1}. Los links
  anteriores serán invalidados."

Agregar `<SendStatusPanel>` arriba del contenido HTML:
- `sendCount >= 1`: card con "Último envío: hace N a email@..." +
  "Reenvíos: N" + "Expira: fecha" + botón "Copiar link" (solo visible
  inmediatamente post-envío con plaintext en React state).
- `status === "approved"`: banner verde con fecha de respondedAt.
- `status === "rejected"`: banner rojo con fecha + declineReason
  (truncado si largo).
- Link "Ver emails enviados" → `/configuracion/email-log?relatedId={quotationId}`.

Los botones "Aprobar"/"Rechazar" manuales (líneas 300-315) se mueven
a menú overflow (`...`) como escape hatch admin con labels
"Marcar como aprobada (sin email)" / "Marcar como rechazada (sin email)".

### `SendQuotationDialog.tsx`

Patrón shadcn `<Dialog>` + form controlado. Estado:

```ts
{
  to: client.contactEmail,
  subject: defaultSubject,
  sending: boolean,
  error?: string,
  successMeta?: { plaintextToken, appUrl, sendCount },
}
```

Campos:
- **Destinatario** (input email). Prellenado. Validación regex inline.
- **Asunto** (input text). Default: `Cotización ${serviceName} — ${issuingCompany.name}`.
  Valor poblado al abrir dialog desde `getSendPreviewContext`.
- **Adjunto** (card read-only). Muestra filename del PDF.
- **Empresa emitente** (card read-only). Logo + nombre. Si
  `resolveIssuingCompany` throws en preview → banner rojo con link a
  `/configuracion/empresas-emitentes`.
- **Aviso** — "Los links expirarán el {date}".

Post-envío exitoso, el dialog cambia a vista "Enviado":
- Check verde grande.
- "Cotización enviada a {email}."
- Bloque con link copiable: `{appUrl}/q/cotizacion/{plaintextToken}`
  + botón "Copiar".
- Botón "Cerrar".

Error en envío: banner rojo dentro del dialog con `err.message`. No
cierra. Usuario puede reintentar.

### `SendStatusPanel.tsx`

Card compacta arriba del content. Condicional según `quotation.status`
y `sendCount`:

```tsx
// status=draft → NO render
// status=sent (sendCount=1) → card azul claro:
//   "Enviada hace 2 días a cliente@ejemplo.com. Expira el 24 de mayo."
// status=sent (sendCount>=2) → "Reenviada 2 veces. Último: hace 5 min. Expira: ..."
// status=approved → banner verde:
//   "Aprobada por el cliente el 12 de abril 14:32."
// status=rejected → banner rojo:
//   "Rechazada el 12 de abril 14:32." + si declineReason, quote block.
```

Link secundario "Ver emails enviados" → filtra email-log.

### Landing pública — `src/app/q/cotizacion/[token]/page.tsx`

Sin dashboard chrome. Layout propio minimalista. Client component.

Flujo:

```tsx
const result = useQuery(api.functions.quotations.publicQueries.getByToken, {token});

if (result === undefined) → <LoadingState />          // spinner fullscreen
if (result.kind === "invalid") → <InvalidTokenState />
if (result.kind === "expired") → <ExpiredState />
if (result.kind === "already_responded") → <QuotationRespondedState status={...} respondedAt={...} />
if (result.kind === "ready") → <QuotationLandingContent {...result} />
```

### `QuotationLandingContent.tsx`

Layout:

```
┌────────────────────────────────────────────────────┐
│  [Logo emitente]   Empresa Emitente                │  ← header con branding
│                    signatoryName · address          │
├────────────────────────────────────────────────────┤
│                                                    │
│   [HTML de quotation.content — dangerouslySet]     │  ← render inline
│                                                    │
├────────────────────────────────────────────────────┤
│  Vigencia: hasta el {tokenExpiresAt en es-MX}      │
│                                                    │
│   ┌────────────────────┐  ┌──────────────────┐    │
│   │  Aceptar cotización│  │  Rechazar        │    │  ← sticky bottom
│   └────────────────────┘  └──────────────────┘    │
└────────────────────────────────────────────────────┘
```

- Header: logo vía `ctx.storage.getUrl(logoStorageId)` (resuelto en el
  query, vuelve como `logoStorageUrl`). Branding colors como CSS vars.
- Body: `<div dangerouslySetInnerHTML={{__html: quotation.content}}/>`
  dentro de container con max-width.
- Bottom bar sticky. "Aceptar" es primary (color primary de emitente),
  "Rechazar" es ghost/outlined.

Handlers:

```tsx
const acceptAction = useAction(api.functions.quotations.publicActions.acceptQuotation);
const declineAction = useAction(api.functions.quotations.publicActions.declineQuotation);
const [justResponded, setJustResponded] = useState<"approved" | "rejected" | null>(null);

const onAccept = async () => {
  setSubmitting(true);
  try {
    await acceptAction({ token });
    setJustResponded("approved");
  } catch (e) { setError(mapErrorMessage(e)); }
  setSubmitting(false);
};
```

Si éxito, re-renderea a `<QuotationRespondedState status={justResponded} justNow/>`.

Race / doble-click errors:
- `invalid_token` → refresh muestra InvalidTokenState.
- `expired` → refresh muestra ExpiredState.
- `already_responded` → refresh muestra QuotationRespondedState.
- Otros → toast "Hubo un problema. Intenta de nuevo o contacta a tu
  ejecutivo."

### `DeclineReasonDialog.tsx`

Modal simple:
- Título: "¿Por qué rechazas la cotización?"
- Texto: "Tu respuesta es opcional. Nos ayuda a mejorar."
- Textarea max 500 chars, contador visible.
- Botones: "Rechazar sin comentario" / "Enviar rechazo" / "Cancelar".

### `QuotationRespondedState.tsx`

Estado terminal. Variantes:
- `approved`: check verde + "¡Gracias! Hemos registrado tu aceptación.
  En breve recibirás el contrato para firmar en tu correo."
- `rejected`: X neutro + "Hemos registrado tu respuesta. Si cambias
  de opinión, contacta a tu ejecutivo."

Si `justNow`, copia en presente. Si el cliente vuelve después, copia
formal: "Esta cotización fue {aprobada|rechazada} el {fecha}."

Footer: "powered by Projex" (link a projex.app, small, gray).

### `ExpiredState` / `InvalidTokenState`

Pantallas fullscreen centradas con ícono + mensaje + CTA.

- **Invalid:** "Link no válido. Verifica que copiaste el link correcto
  o contacta a tu ejecutivo."
- **Expired:** "Esta cotización expiró. Por favor contacta a tu
  ejecutivo para solicitar una nueva."

Mismo footer "powered by Projex".

### Hub de configuración

Sin cambios. 3B no agrega cards al hub. Todo el flujo se engancha
desde `/cotizaciones/[id]`. `/configuracion/email-log` existente lista
los envíos con filtro `relatedType=quotation`.

### Estado y queries

- Dashboard:
  - `getById` (existente) — datos base de la quotation.
  - `getSendPreviewContext({quotationId})` nueva query — issuingCompany
    resuelto para el dialog sin ejecutar la action.
  - `useAction(sendQuotation)` — envío.
- Landing:
  - `getByToken({token})` — datos para renderear.
  - `useAction(acceptQuotation)` / `useAction(declineQuotation)`.

### Permisos UI

- Botón "Enviar" / "Reenviar" — admin + ejecutivo dueño.
- Botones "Aprobar"/"Rechazar" manuales — admin + ejecutivo dueño (ya
  existente).
- Landing pública — sin auth; acceso via token.

## 3B.5 Seed dummy

Impacto chico.

**1. Extender `convex/functions/seed/v2Fixtures.ts`** (creado en Section 2):
- A los clientes dummy, agregar `contactEmail: "test+{slug}@ejemplo.mx"`
  y `contactName: "Contacto {Nombre}"`.
- NO se seed-ean quotations con tokens pre-generados — el flujo real
  es crear quotation y disparar `sendQuotation` para ejercitar rotación
  genuina.

**2. Script manual documentado** en
`docs/superpowers/specs/sections/3b-testing.md`:
- Ejecutar `sendQuotation` desde Convex dashboard con `quotationId` válido.
- Tomar el `plaintextToken` del return value.
- Abrir `http://localhost:3000/q/cotizacion/{plaintextToken}` en
  otro browser/incognito para simular al cliente.
- Verificar: render HTML correcto, branding, click accept → confirmación
  + contrato aparece en `/contratos` en draft.

No hay otros cambios a `v2Fixtures`.

## 3B.6 Error handling

Tabla consolidada de fuentes nuevas. Los errores de 3A/Section 2 ya
están documentados en sus specs propios.

| Fuente | Condición | Comportamiento |
|---|---|---|
| `sendQuotation` | `contactEmail` missing | Throws antes de rotar token. UI: toast con link a editar cliente. |
| `sendQuotation` | `pdfStorageId` missing | Throws antes de rotar token. UI: "Genera el PDF primero". |
| `sendQuotation` | Status `approved`/`rejected` | Throws. UI: botón oculto; backend re-valida por defensa. |
| `sendQuotation` | Ejecutivo a cliente no asignado | Throws 403-equivalent. |
| `sendQuotation` | `resolveIssuingCompany` throws | Throws con mensaje claro. |
| `sendQuotation` | `sendEmail` retorna `{ok: false}` | Rethrows errorMessage. Token **ya fue rotado** — trade-off aceptado. emailLog queda en `failed`. |
| `sendQuotation` | Crash entre `rotateTokenAndMarkSent` y `sendEmail` | Quotation con token nuevo + `sent` + sendCount++ pero sin emailLog. Cliente no recibe link; ejecutivo reintenta. Aceptable v2. |
| `applyAcceptance`/`applyDecline` | Token hash inexistente | Throws `"invalid_token"`. Landing → InvalidTokenState. |
| `applyAcceptance`/`applyDecline` | Status ya `approved`/`rejected` | Throws `"already_responded"`. Landing → QuotationRespondedState. |
| `applyAcceptance`/`applyDecline` | `tokenExpiresAt < now` | Throws `"expired"`. Landing → ExpiredState. |
| `applyAcceptance`/`applyDecline` | Doble-click (race) | Primera gana (patch atómico). Segunda throws `"already_responded"`. React state local `justResponded` preserva UX correcta. |
| Scheduler → `generateContractFromQuotationInternal` | Falla (AI down, timeout, crash) | Quotation queda en `approved` sin contract draft. Scheduler no retry. Ejecutivo ve banner "Aprobada" pero sin "Ver Contrato" — usa botón manual "Generar contrato" existente como recovery. |
| Scheduler → `doGenerate` | Race: contract generado 2× (accept + manual) | `doGenerate` chequea `getByQuotation` al inicio: si existe, no-op. Idempotente. |
| `getByToken` query | `QUOTATION_TOKEN_SECRET` missing | Query throws. Landing muestra error genérico. Admin ve en Convex logs. |
| `getByToken` query | Token malformado | Hash computa basura que no matchea → `{kind: "invalid"}`. No throws. |
| Landing | Cliente sin JS (Gmail preview, crawler) | Page no renderea; accept/decline no se disparan por prefetch. Aceptable (buen comportamiento). |

### Race conditions y atomicidad

- **Doble-click en Aceptar:** patch atómico garantiza transición única.
  Segundo throws `"already_responded"`. React state local `justResponded`
  preserva confirmación correcta.
- **Ejecutivo envía 2× simultáneo:** ambas actions rotan token. La
  última gana; el primer link muere inmediatamente. Dos emails salen.
  Aceptable.
- **Cliente acepta + admin marca rejected manual simultáneo:** el
  escape hatch `updateStatus` valida transiciones (`sent → approved|rejected`).
  La primera gana; la segunda throws por transición inválida.
- **Token re-uso tras re-envío:** `accessTokenHash` nuevo sobrescribe
  el viejo. Links viejos → hash no matchea → `invalid_token`. Correcto.

### Idempotencia del scheduler

Convex `scheduler.runAfter(0, ...)` encola una única invocación por
call. Si `acceptQuotation` se llama 2× (race), la primera agenda y
transiciona, la segunda falla con `already_responded` antes del
scheduler. Sin double-schedule.

Si `doGenerate` falla a mitad, Convex no reintenta. Contract queda
pendiente. Recovery: botón manual "Generar Contrato" en dashboard.

### Timing attacks / enumeration

- Token es HMAC-SHA256 de 32 bytes random → espacio 2^256. No enumerable.
- Convex index lookup `by_accessTokenHash` es O(1); variación de
  latencia no perceptible para side-channel.
- No hay riesgo material de timing attack.

### Payload sizes

- Email body (HTML cotización + wrapper): ~55KB típico. OK.
- PDF attachment: 100-300KB típico. Dentro de 10MB/25MB de 3A.
- Content rendereado en landing: `dangerouslySetInnerHTML`; tamaños OK.

## 3B.7 Testing

Pirámide 70/25/5. Baseline post-3A: 124 tests. Target post-3B:
**+36 tests → ~160 tests**.

Ubicación: `convex/functions/quotations/__tests__/` (nuevo directorio).

### Unit + integration (convex-test)

**`tokenHelpers.test.ts`** — 4 casos:
- `generateToken` retorna string base64url ≥ 43 chars.
- `generateToken` produce outputs distintos en calls consecutivos.
- `hashToken` es determinístico.
- `hashToken` throws si `QUOTATION_TOKEN_SECRET` missing o <32 chars.

**`sendQuotation.test.ts`** — 10 casos (con `vi.mock("resend")` via
helper de 3A):
- Admin + draft + PDF + contactEmail → `status=sent`, `sendCount=1`,
  token generado, `sendEmail` llamado con attachment correcto.
- Re-envío sobre `sent` → `sendCount=2`, token rotado (hash distinto),
  `lastSentAt` actualizado.
- Sin PDF → throws; no toca quotation ni emailLog.
- Cliente sin contactEmail → throws; no toca nada.
- Status `approved` → throws; no rota token.
- Ejecutivo a cliente asignado → OK.
- Ejecutivo a cliente ajeno → throws; no rota token.
- `resolveIssuingCompany` throws → throws con mensaje; no toca token.
- `sendEmail` `{ok:false}` → rethrows; token ya rotado (documentado).
- Multi-tenant: Org A no puede enviar quotation de Org B.

**`applyAcceptance.test.ts`** — 6 casos:
- Token válido + sent + no expirado → approved, respondedAt,
  accessTokenHash limpiado.
- Token hash inexistente → throws `"invalid_token"`.
- Status ya approved → throws `"already_responded"`.
- Status rejected → throws `"already_responded"`.
- Expirado → throws `"expired"`.
- Race con `Promise.all` → primera gana, segunda throws `"already_responded"`.

**`applyDecline.test.ts`** — 4 casos:
- Token válido + reason corto → rejected, declineReason guardado.
- Token válido + reason >500 chars → truncado a 500.
- Token válido + reason undefined → rejected, declineReason undefined.
- Token válido + reason empty string → declineReason normaliza a undefined.

**`publicActions.test.ts`** — 4 casos:
- `acceptQuotation` llama `applyAcceptance` + `scheduler.runAfter` con
  el internal contract action.
- `acceptQuotation` con token inválido → throws, scheduler no invocado.
- `declineQuotation` con reason → `applyDecline` correcto.
- `declineQuotation` sin reason → `applyDecline` con undefined.

**`getByToken.test.ts`** — 5 casos:
- Token válido + sent → `{kind: "ready", quotation, client, issuingCompany}`.
- Token válido pero expirado → `{kind: "expired"}`.
- Status approved (hash limpiado) → `{kind: "invalid"}`.
- Edge: quotation rejected con hash (simulado, no reproducible en
  flujo real post-limpieza) → `{kind: "already_responded"}`.
- Token inexistente → `{kind: "invalid"}`.

**`permissions.test.ts`** — 3 casos:
- Ejecutivo puede `sendQuotation` a sus clientes, no a ajenos.
- `updateStatus` manual respeta transiciones válidas (regresión).
- Admin puede cualquier cosa.

### E2E (Playwright) — stretch goal

Un solo test golden path:
1. Admin en `/cotizaciones/[id]` con quotation draft + PDF + cliente
   con email.
2. Click "Enviar por email" → dialog → Enviar.
3. Interceptar email salido (mock Resend captura body HTML).
4. Extraer token del link.
5. Navegar a `/q/cotizacion/{token}` sin auth.
6. Ver contenido + botones.
7. Click "Aceptar" → confirmación.
8. Volver a `/cotizaciones/[id]` → status approved.
9. Polling hasta que `/contratos` liste el draft nuevo.

**Estimate:** 2-3 horas. Stretch goal de 3B; si no alcanza, defer a
Section 3C (flow natural incluye el mismo prefijo).

### Mocks y helpers

- `vi.mock("resend")` — reusa helper de 3A.
- Mock `crypto.randomBytes` para tests deterministas del token — opcional.
- Helper nuevo `createQuotationInStatus({status, sendCount?, tokenHash?,
  tokenExpiresAt?})` en `__tests__/helpers/quotations.ts`.
- Mock del scheduler: convex-test lo provee; verificar encolados con
  `t.finishInProgressScheduledFunctions()` o inspección directa.
- `process.env.QUOTATION_TOKEN_SECRET` mock en `beforeEach`.

### Cobertura esperada

Happy paths + todos los errores en §3B.6 + races + permisos +
integración con `sendEmail` (3A) y `resolveIssuingCompany` (2).

### Fuera de scope testing

- Load test del endpoint público.
- Browser compatibility (smoke manual pre-deploy).
- Lint de links HMAC en emails (smoke manual).

## 3B.8 Dependencias y qué desbloquea

### Depends on

- Section 2 (issuing companies) — `resolveIssuingCompany`.
- Section 3A (email infra) — `sendEmail`, `emailLog`, webhook.
- Schema changes de 3B — desplegar antes del feature.
- Envs: `QUOTATION_TOKEN_SECRET`, `APP_URL`.
- Sin nuevas dep npm.
- Refactor `contracts/actions.ts` (interno a 3B).

### Unblocks

- **Section 3C** — contract + Firmame. Consume contract draft generado
  por 3B al accept. 3C detecta contratos draft con
  `quotation.status === "approved"` y dispara send + Firmame.
- Recordatorios automáticos (cron futuro sobre `lastSentAt`,
  `respondedAt`).
- §3B.10 (pipeline visibility + notifications) — hooks
  `TODO(pipeline-visibility)` ya colocados.
- Analytics (conversion rate, tiempo de respuesta) sobre campos
  nuevos.

### Cadena del sprint v2

```
Section 2 (empresas emitentes) ─┐
                                ├─→ Section 3B ──→ Section 3C
Section 3A (email infra) ───────┘       │
                                        ├─→ Recordatorios (post-sprint)
                                        ├─→ §3B.10 pipeline (post-sprint)
                                        └─→ Analytics (post-sprint)
```

## 3B.9 Riesgos y tradeoffs

### Token rotation vs send failure

Action rota token ANTES de llamar `sendEmail`. Si Resend falla, token
nuevo queda guardado pero no hay email. Ejecutivo re-envía; rotación
vuelve a ocurrir. Riesgo residual: si Resend falla repetidamente, se
rotan tokens en loop — aceptable porque ningún cliente quedó con link
vivo ambiguo. **Alternativa descartada:** rotar después del send —
complica concurrencia (dos sends simultáneos producirían dos tokens
válidos).

### Link compartible / single-use

Token es single-use-ish (se limpia al primer accept/decline), pero
entre envío y respuesta cualquiera con acceso al email puede pulsar
el botón. Riesgo: cliente forwardea a su equipo, alguien da click
Aceptar sin autorización. **Mitigación v2:** ninguna formal —
consciente. Landing muestra montos antes de responder. **Futuro:**
OTP via SMS al cliente principal, o ir directo a Firmame (post-sprint).

### Contract async fallando

Cliente recibe "tu ejecutivo te contactará", pero si `doGenerate`
throws el contract draft nunca aparece. Ejecutivo puede no darse
cuenta hasta que el cliente pregunte. **Mitigación v2:** ejecutivo ve
`/cotizaciones/[id]` approved pero bloque de "Contrato" vacío —
señal visual. **Futuro:** alerta/notification §3B.10 cuando scheduler
falla 3 veces consecutivas.

### Email forwarding + token en URL

Link plaintext vive en email. Si se archiva, token persiste. Si alguien
obtiene acceso al buzón, puede responder. **Mitigación:** TTL 30 días.
Rotación en re-envío invalida anteriores. Aceptable para cotizaciones
B2B.

### Gmail/Outlook prefetchers

Landing es GET-idempotente (`getByToken` no muta). Accept/decline son
actions con POST desde React, no se disparan sin click. Prefetch solo
carga página. **Buen comportamiento.**

### HTML de quotation con `<script>`

`quotation.content` se renderea con `dangerouslySetInnerHTML`. Content
se genera server-side desde templates propios o AI con systemPrompt
controlado — no acepta input del cliente. Riesgo auto-XSS no es
material (mismo equipo). **Futuro si escalamos:** `DOMPurify.sanitize()`
server-side, o iframe sandbox como en email-log.

### Landing indexable por Google

Mitigación: `<meta name="robots" content="noindex,nofollow">` en
`layout.tsx` de `/q/cotizacion/[token]`. Implementación barata.

### Quotation rechazada sin recovery

Una vez `rejected`, flujo no vuelve a `draft`/`sent`. Renegociación
requiere crear nueva quotation que sobrescribe la anterior por unique
`projServiceId`. Audit trail del rechazo se pierde en la quotation
pero vive en `emailLog`. **Futuro:** versioning de quotations
(`version: 1, 2, 3`) — cambio grande, no v2.

### Performance de landing bajo carga

50 clientes × 9 servicios = 450 cotizaciones/año máximo. Convex escala.
Cuello potencial: `storage.getUrl` para logo emitente por request.
CDN de Convex cachea. Aceptable.

### Rate-limit de envíos espamosos

Ejecutivo distraído puede dar click Enviar 10×. UI deshabilita durante
loading. Resend free-tier 100/día. Fallos visibles en `emailLog`.
Aceptable v2.

### Token secret rotation

Si se rota `QUOTATION_TOKEN_SECRET`, todos los tokens activos quedan
inválidos. Clientes con links vivos ven "Link no válido". Ejecutivo
re-envía. **Comportamiento deseado ante compromiso.** Post-sprint:
`tokenSecretVersion` + grace period si se quiere rotación gradual.

## 3B.10 Futuro: pipeline visibility & notificaciones internas

No es scope de 3B. Se documenta para que al implementarlo post-15-may
tengamos el pensamiento base.

### Problema

Hoy el ejecutivo/admin navega a `/cotizaciones`, `/contratos`,
`/entregables` por separado para saber cómo va cada cliente × servicio.
No hay vistazo que diga "cliente X, servicio Y: cotización aceptada,
contrato pendiente de firma, deliverable de abril 60% listo". Tampoco
se enteran en tiempo real cuando un cliente acepta o firma.

### Feature conceptual

Pipeline view + notificaciones internas.

#### Pipeline view (visibilidad)

Ruta: `/pipeline` o `/clientes/[id]/pipeline`.

Matriz cliente × servicio. Cada celda muestra estado del ciclo
documental de ese par (projection → quotation → contract →
deliverables).

```
Cliente \ Servicio    Legal         Contable       TI
────────────────────────────────────────────────────────────
Acme Corp            [📄 sent]      [✅ signed]    [─ no service]
                     hace 5 días    firmado 12-abr
                     +0/12 delivs   3/12 delivs
                     ⚠ recordatorio

Beta SA              [✅ signed]    [📄 draft]     [📄 approved]
                     firmado 20-mar no enviada     gen contrato
                     4/12 delivs    ─              ─
```

Cada celda: **status chip** del documento más avanzado + sub-info
mensual. Click → drawer con timeline completo.

Estados:
- `sin_proyeccion`
- `proyeccion_activa`
- `cotizacion_draft`/`cotizacion_sent`/`cotizacion_rejected`/`cotizacion_expired`
- `contrato_draft`/`contrato_pending_sign`/`contrato_signed`/`contrato_cancelled`
- `activo` (delivering, `N/12`)
- `completado`

Filtros: status, ejecutivo asignado, industria, mes con atraso.

#### Notificaciones internas

Modelo nuevo:

```ts
notifications: defineTable({
  orgId: v.string(),
  userId: v.optional(v.string()),  // undefined = broadcast al org
  type: v.union(
    v.literal("quotation_accepted"),
    v.literal("quotation_rejected"),
    v.literal("contract_signed"),
    v.literal("contract_bounced"),
    v.literal("deliverable_overdue"),
    v.literal("email_bounced"),
  ),
  relatedType: v.string(),
  relatedId: v.string(),
  title: v.string(),
  body: v.string(),
  readAt: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_orgId_unread", ["orgId", "readAt"])
  .index("by_userId_unread", ["userId", "readAt"]);
```

Se insertan desde puntos de transición (en `applyAcceptance`,
`applyDecline`, webhook de Firmame en 3C, deliverable state changes).
UI: bell icon en topbar + drawer cronológico + click marca leída.

### Gancho desde 3B

En `applyAcceptance` y `applyDecline` se colocan
`// TODO(pipeline-visibility)` comments en la sección post-transición
marcando dónde se insertará `notifications.insert` futuro. Así cuando
se implemente no hay que re-leer toda la lógica.

### Orden sugerido (post-sprint 15-may)

1. Notifications table + inserts en transiciones existentes (quotation
   accept/decline, contract sign webhook, deliverable delivered).
   1-2 días.
2. Bell icon UI + query + mark-as-read mutation. 1 día.
3. Pipeline view (matriz + filtros + drawer). 3-5 días.

**Total:** ~1 semana post-launch.
