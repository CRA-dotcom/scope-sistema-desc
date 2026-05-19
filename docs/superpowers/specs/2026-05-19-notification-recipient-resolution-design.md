# Resolución de destinatarios de notificaciones (NO Clerk)

> ClickUp: `86ahjaqzc` — Follow-up de feature, NO bloquea cutover.
> Fecha: 2026-05-19

## Problema

Tres notificaciones se omiten o van a `OPS_NOTIFICATION_EMAIL` porque no hay
resolución de destinatario real. El ticket exige sacar el email de **datos de la
app, no de Clerk**. Cada call site tiene un marcador `TODO(feature)`.

Estado actual (post-cutover hardening):

| Call site | Hoy manda a | Marcador |
|---|---|---|
| `convex/functions/cron/overdueCheck.ts:116` | `OPS_NOTIFICATION_EMAIL` o skip | `TODO(feature)` |
| `convex/functions/cron/monthlyCheck.ts:157` | `OPS_NOTIFICATION_EMAIL` (único) o skip | `TODO(feature)` |
| `convex/functions/questionnaires/mutations.ts:214` | `OPS_NOTIFICATION_EMAIL` o skip | `TODO(feature)` |

Restricción de datos descubierta: `clients.assignedTo` guarda el **Clerk userId**
(`identity.subject`, ver `convex/functions/clients/mutations.ts:42`), no un email.
No existe tabla `users`/`executives` ni store de emails de ejecutivos en la app.
`clients` ya tiene `contactEmail`/`contactName` opcionales. `orgConfigs` existe
pero no tiene campo de email de notificación.

## Decisión de diseño

- **Cliente** → `clients.contactEmail` (ya existe en schema).
- **Admin/responsable de la org** → nuevo campo `orgConfigs.notificationEmail`.
- **Ejecutivo asignado (cuestionario completado)** → se enruta al
  `notificationEmail` de la org (el responsable triagea). Decisión explícita del
  usuario: sin nuevo data model para emails de ejecutivos (YAGNI). La tabla
  `notifications` queda disponible para un aviso in-app futuro, fuera de alcance.

`OPS_NOTIFICATION_EMAIL` se conserva como **fallback de último recurso**, no como
destino primario. El comportamiento degrada de forma segura (skip + warn) cuando
no hay ningún destinatario — nunca se manda a un dominio placeholder ajeno.

## Cambios

### 1. Schema

`convex/schema.ts` → `orgConfigs`: agregar
`notificationEmail: v.optional(v.string())`. Campo opcional, sin migración (los
docs existentes simplemente no lo tienen → cae al fallback).

### 2. Helper compartido

Nuevo `convex/functions/email/resolveRecipients.ts`:

- `resolveOrgNotificationEmail` — internal query. Args: `{ orgId: string }`.
  Lógica: busca `orgConfigs` por `by_orgId`; devuelve
  `orgConfig?.notificationEmail ?? process.env.OPS_NOTIFICATION_EMAIL ?? null`.
- Un único lugar para la cadena de fallback, así los tres call sites comparten
  semántica idéntica.

### 3. Mutation de orgConfigs

Extender la mutation de update de `orgConfigs`
(`convex/functions/orgConfigs/mutations.ts`) para aceptar y persistir
`notificationEmail` opcional. Sin esto el campo no es seteable.

### 4. Call sites

- **`overdueCheck.ts`** (internalAction): por cada `orgId` en `overdueByOrg`,
  resolver vía `runQuery(resolveOrgNotificationEmail, { orgId })` en lugar de
  leer `process.env.OPS_NOTIFICATION_EMAIL` directo. Si `null` → skip + warn
  (mismo patrón actual, mismo texto de warn adaptado).

- **`monthlyCheck.ts`** (internalAction): extender la internal query
  `listPendingQuestionnaires` para incluir `contactEmail` del cliente en cada
  resultado. Resolver el destinatario **por cuestionario pendiente** usando
  `pq.contactEmail`; si falta, skipear ese recordatorio puntual y acumular para
  un único warn con conteo (en vez del único `clientReminderTo` global actual).

- **`questionnaires/mutations.ts`** (mutation `submit`, tiene `ctx.db`): mantener
  el gate `if (assignedTo)`. Resolver el destinatario vía la misma lógica de
  `resolveOrgNotificationEmail` para `questionnaire.orgId`. Como es una mutation
  con `ctx.db`, puede leer `orgConfigs` directo (o reusar el helper si se expone
  como función pura compartida). Si `null` → skip + warn (patrón actual).

### 5. Transporte

Sin cambios. `internal.functions.email.send.sendEmailInternal` (Resend) sigue
siendo el transporte en los tres casos. Esta feature solo define el "a quién".

## Fuera de alcance

- UI de settings para capturar `notificationEmail` por org (el ticket pide la
  resolución; campo + mutation listos es suficiente).
- Directorio de emails de ejecutivos / aviso in-app vía tabla `notifications`.
- Tabla `users`/`executives`.

## Testing

- Unit del helper: con `notificationEmail` seteado, sin él pero con env, sin
  ninguno (→ `null`).
- `monthlyCheck`: pendientes con/ sin `contactEmail` (skip parcial + conteo).
- `overdueCheck` / `submit`: con destinatario resuelto vs. skip+warn.
- Multi-tenant: cada org resuelve su propio `notificationEmail` (no cruce).
