# D2 — Org Admin Panel Completion

**Fecha:** 2026-05-28
**Sub-spec del maestro:** `docs/superpowers/specs/2026-05-20-prod-readiness-revision.md`
**Estado:** propuesto
**Días estimados:** 2 (0.5 d hub + branding · 0.5 d usuarios · 0.5 d integraciones · 0.5 d notificaciones + frecuencias read-only)
**Dependencias:** R1, A1 (`subservices`), A2 (`/configuracion/plantillas`)
**Owner:** Christian

---

## 1. Objetivo

`/configuracion` hoy es un hub minimalista de **3 cards** (Empresas Emitentes,
Email Log, Integración Resend). El operador no tiene UI para administrar el
resto del estado de su org: ejecutivos asignados a clientes, branding visual
de documentos, credenciales de proveedores (Resend ya cubierto, Firmame y
Railway faltan), preferencias de notificación, ni vista read-only de las
frecuencias por subservicio. Sin esas pantallas el dueño tiene que pedirle
a Christian que entre a la consola de Convex/Clerk a hacer cada cambio —
bloqueante operativo del beta del 31-may.

D2 cierra ese gap: expande el hub a **9 cards** (3 existentes + 1 de A2
plantillas + 1 de A1 subservicios + 4 nuevas que entrega este sub-spec) y
construye las 4 páginas nuevas con backend + frontend.

R1 §7.2 enumera literalmente lo que falta. Decisión bloqueante O12 (R1 §12):
**branding override en beta = per-org** (per-issuingCompany queda para V2).
A2 ya entrega `/configuracion/plantillas` con tree Servicio→Subservicio y
copy-on-write; D2 NO duplica esa página, solo la enlaza desde el hub. A1
ya entrega `/configuracion/subservicios`; D2 NO duplica, solo la enlaza.

D2 entrega:

- Hub `/configuracion` expandido a 9 cards con íconos consistentes.
- `/configuracion/usuarios` — lista miembros Clerk + asignación a clientes
  + email del ejecutivo destinatario.
- `/configuracion/branding` — wrapper org-admin del editor que hoy vive en
  `/platform/orgs/[id]/branding`. Mismo backend `orgBranding`, mismas
  mutations pero con `requireAdmin` (no `requireSuperAdmin`) cuando el
  caller edita su propia org.
- `/configuracion/integraciones` — hub de proveedores: Resend (link al
  existente), Firmame (form de credenciales sin integración funcional —
  Firmame queda backlog post-beta), Railway (read-only info de env vars).
- `/configuracion/notificaciones` — form de `notificationEmail` +
  preferencias + test send. Cierra el loop con
  `2026-05-19-notification-recipient-resolution-design.md`.
- `/configuracion/frecuencias` — read-only redirect a `/configuracion/subservicios`
  con vista tabular de defaults; UI de override por cliente diferida a junio.

D2 NO entrega:

- Funcionalidad real de Firmame (queda backlog, solo persiste credenciales).
- Encriptación at-rest de API keys (asume entorno trusted en beta; masking en
  UI; rotación manual; ver §7).
- Override per-issuingCompany de branding (V2; spec separado).
- Override per-cliente de frecuencias (`clientSubserviceOverrides` table
  diferida a junio, R1 §5.2).
- Sincronización con Clerk webhook para usuarios (en beta lecturas via
  `useOrganization()` cliente-side bastan; ver §3.1 Q3).

---

## 2. Gap analysis

### 2.1 Páginas existentes en `/configuracion`

| Página | Archivo | Estado | D2 toca |
|---|---|---|---|
| `/configuracion` | `src/app/(dashboard)/configuracion/page.tsx` | Hub básico, 3 cards | **SÍ** — expande a 9 cards |
| `/configuracion/empresas-emitentes` | `.../empresas-emitentes/page.tsx` | Funcional (CRUD issuingCompanies) | NO |
| `/configuracion/empresas-emitentes/nueva` | `.../nueva/page.tsx` | Funcional | NO |
| `/configuracion/empresas-emitentes/[id]` | `.../[id]/page.tsx` | Funcional | NO |
| `/configuracion/email-log` | `.../email-log/page.tsx` | Funcional (historial Resend) | NO |
| `/configuracion/integraciones/resend` | `.../resend/page.tsx` | Funcional (API key Resend) | NO directamente — D2 lo enlaza desde nuevo hub `/configuracion/integraciones` |
| `/configuracion/subservicios` | (lo crea A1) | Pendiente A1 entrega | NO — D2 solo enlaza |
| `/configuracion/plantillas` | (lo crea A2) | Pendiente A2 entrega | NO — D2 solo enlaza |

### 2.2 Páginas que D2 crea

| Página | Sub-tarea | Días | Responsable de uso |
|---|---|---|---|
| `/configuracion/usuarios` | D2.users | 0.5 | Operador agrega/lista ejecutivos via Clerk + asigna clientes |
| `/configuracion/branding` | D2.branding | 0.5 | Operador edita logo + colores + footer de su propia org |
| `/configuracion/integraciones` | D2.integrations | 0.5 | Operador ve estado de Resend/Firmame/Railway en una sola vista |
| `/configuracion/notificaciones` | D2.notifications | 0.25 | Operador setea email destino + test send |
| `/configuracion/frecuencias` | D2.frecuencias-readonly | 0.25 | Vista read-only redirect a subservicios (placeholder hasta junio) |

**Total: 2 días.** Estimación conservadora: cada página es CRUD simple sobre
schema existente; el único trabajo realmente nuevo es `users.assignToClient`
(actualizar `clients.assignedTo` con UI) y wiring de Resend test connection.

### 2.3 Hub `/configuracion` expandido — mockup

```
┌──────────────────────────────────────────────────────────────────────┐
│  Configuración                                                      │
├──────────────────────────────────────────────────────────────────────┤
│  Catálogo                                                            │
│  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────┐  │
│  │ Empresas Emitentes │  │ Subservicios       │  │ Plantillas     │  │
│  └────────────────────┘  └────────────────────┘  └────────────────┘  │
│                                                                      │
│  Equipo                                                              │
│  ┌────────────────────┐  ┌────────────────────┐                      │
│  │ Usuarios           │  │ Frecuencias        │                      │
│  └────────────────────┘  └────────────────────┘                      │
│                                                                      │
│  Comunicación                                                        │
│  ┌────────────────────┐  ┌────────────────────┐                      │
│  │ Notificaciones     │  │ Email Log          │                      │
│  └────────────────────┘  └────────────────────┘                      │
│                                                                      │
│  Identidad                                                           │
│  ┌────────────────────┐                                              │
│  │ Branding           │                                              │
│  └────────────────────┘                                              │
│                                                                      │
│  Proveedores                                                         │
│  ┌────────────────────┐                                              │
│  │ Integraciones      │  ← agrupa Resend + Firmame + Railway         │
│  └────────────────────┘                                              │
└──────────────────────────────────────────────────────────────────────┘
```

Patrón visual reutilizado: cards apiladas verticalmente como hoy (mismo
componente `Link` con `border-border bg-card hover:border-accent/30`).
La única diferencia es agrupación por sección (heading muted-foreground)
para separar visualmente los 9 items.

---

## 3. Backend

Módulos nuevos / extendidos:

- `convex/functions/users/` (NUEVO) — wrappers sobre Clerk + asignación.
- `convex/functions/orgBranding/{queries,mutations}.ts` — añadir versiones
  org-admin (hoy solo super-admin).
- `convex/functions/orgIntegrations/{queries,mutations}.ts` (NUEVO) —
  Firmame y Railway. Resend ya existe en `convex/functions/email/mutations.ts`.
- `convex/functions/orgConfigs/mutations.ts` — añadir
  `updateNotificationPreferences` con `requireAdmin` (hoy solo super-admin).

### 3.1 `users` module

Archivo nuevo `convex/functions/users/queries.ts`. Convex NO tiene acceso
directo al Clerk Backend SDK desde queries — sería una `action`. La estrategia
A1: usar `useOrganization()` client-side para leer memberships (ya hay
precedente en sidebar) + Convex para guardar la asignación cliente↔usuario.

**`listAssignmentsForOrg`** — devuelve cuántos clientes tiene asignado cada
usuario. La página la combina con la lista de memberships de Clerk.

```ts
import { query } from "../../_generated/server";
import { getOrgIdSafe } from "../../lib/authHelpers";

export const listAssignmentsForOrg = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    const clients = await ctx.db
      .query("clients")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();

    // group by assignedTo (clerkUserId) → count
    const counts = new Map<string, number>();
    for (const c of clients) {
      if (!c.assignedTo) continue;
      counts.set(c.assignedTo, (counts.get(c.assignedTo) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([userId, count]) => ({
      userId,
      assignedClientCount: count,
    }));
  },
});
```

**`listAssignedClients`** — para el detalle de usuario.

```ts
export const listAssignedClients = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    return await ctx.db
      .query("clients")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .filter((q) =>
        q.and(
          q.eq(q.field("assignedTo"), args.userId),
          q.eq(q.field("isArchived"), false),
        ),
      )
      .collect();
  },
});
```

Archivo nuevo `convex/functions/users/mutations.ts`.

**`assignToClient`** — operador asigna un usuario a un cliente.

```ts
import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { requireAdmin, getOrgId } from "../../lib/authHelpers";

export const assignToClient = mutation({
  args: {
    clientId: v.id("clients"),
    userId: v.string(), // clerk userId
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);

    const client = await ctx.db.get(args.clientId);
    if (!client) throw new Error("Cliente no encontrado.");
    if (client.orgId !== orgId) {
      throw new Error("No puedes asignar clientes de otra organización.");
    }

    await ctx.db.patch(args.clientId, { assignedTo: args.userId });
    return { ok: true, clientId: args.clientId, userId: args.userId };
  },
});
```

**`unassign`** — clear `assignedTo`.

```ts
export const unassign = mutation({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);

    const client = await ctx.db.get(args.clientId);
    if (!client || client.orgId !== orgId) {
      throw new Error("Cliente no encontrado.");
    }
    await ctx.db.patch(args.clientId, { assignedTo: undefined });
    return { ok: true, clientId: args.clientId };
  },
});
```

**`invite`** — NO se implementa como mutation Convex. Razón: invitar requiere
el Clerk Backend SDK (`organizations.createInvitation`) que necesita
`CLERK_SECRET_KEY` y vive mejor en una Next.js Route Handler (acceso directo
al SDK + sesión cookies). D2 entrega `src/app/api/clerk/invite-user/route.ts`
(handler POST que llama `clerkClient.organizations.createInvitation`) y la UI
de `/configuracion/usuarios` hace `fetch("/api/clerk/invite-user", ...)`.

> Pattern reference: ya hay precedente en `src/app/api/` para acciones server-
> only (ver `src/app/api/generate-pdf/route.ts`). Mantener el handler simple:
> 30 LOC máximo, valida sesión `auth()`, valida `org:admin` role, llama SDK,
> retorna `{ ok, invitationId }` o error.

```ts
// src/app/api/clerk/invite-user/route.ts (esbozo)
import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { userId, orgId, orgRole } = await auth();
  if (!userId || !orgId) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  if (orgRole !== "org:admin") {
    return NextResponse.json({ error: "Requiere rol admin" }, { status: 403 });
  }
  const { emailAddress, role } = await req.json();
  if (!emailAddress || !role) {
    return NextResponse.json({ error: "Faltan campos" }, { status: 400 });
  }
  if (role !== "org:admin" && role !== "org:member") {
    return NextResponse.json({ error: "Rol inválido" }, { status: 400 });
  }
  try {
    const client = await clerkClient();
    const invitation = await client.organizations.createOrganizationInvitation({
      organizationId: orgId,
      inviterUserId: userId,
      emailAddress,
      role,
    });
    return NextResponse.json({ ok: true, invitationId: invitation.id });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error" },
      { status: 500 },
    );
  }
}
```

**Rol `"operator"` (R1 §7.3 decisión #7):** R1 fija que `"operator"` se mapea
a `org:admin` en beta. En consecuencia D2 acepta solo `"org:admin"` y
`"org:member"` en el handler. Si en junio se split el role, este handler
agrega `"org:operator"` como literal extra; cero migración de datos.

> **Q3 — sync de memberships:** la UI lee memberships via `useOrganization()`
> client-side; NO se replican en una tabla Convex. Suficiente para el beta
> (un solo despacho, ~3 ejecutivos). Si en julio papá agrega 20+ y
> necesita queries reactivas Convex sobre membership, se introduce
> Clerk webhook `organizationMembership.created/.deleted` que upserts a
> `orgMembers`. Fuera de D2.

### 3.2 `orgBranding` — abrir a operador

Modificar `convex/functions/orgBranding/queries.ts` y `mutations.ts`. Hoy
ambas requieren `requireSuperAdmin`. Añadir el path operador.

**Patrón:** la query `getByOrgId` actual ya funciona para el operador (sin
guard de super-admin). Solo falta:

1. **`getLogoUrl` abrir a operador para su propio logo:**

```ts
// convex/functions/orgBranding/queries.ts — refactor
export const getLogoUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    // super-admin OR org-member del org dueño del logo
    const isSuper =
      ((identity.publicMetadata as Record<string, unknown> | undefined)?.role) ===
      "super_admin";
    if (isSuper) return await ctx.storage.getUrl(args.storageId);

    // operador: confirmar que el storageId corresponde al branding de su org
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;
    const branding = await ctx.db
      .query("orgBranding")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .unique();
    if (!branding || branding.logoStorageId !== args.storageId) return null;
    return await ctx.storage.getUrl(args.storageId);
  },
});
```

2. **`upsert` y `generateUploadUrl` aceptar caller `requireAdmin` cuando se
   modifica el propio org. Mantener `requireSuperAdmin` cuando se pasa un
   `orgId` distinto al del caller.**

```ts
// convex/functions/orgBranding/mutations.ts — refactor de upsert
export const upsert = mutation({
  args: {
    orgId: v.optional(v.string()), // si se omite, usa el del caller
    companyName: v.string(),
    logoStorageId: v.optional(v.id("_storage")),
    primaryColor: v.string(),
    secondaryColor: v.string(),
    accentColor: v.optional(v.string()),
    fontFamily: v.string(),
    headerText: v.optional(v.string()),
    footerText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireAuth(ctx);
    const isSuper =
      ((identity.publicMetadata as Record<string, unknown> | undefined)?.role) ===
      "super_admin";

    let targetOrgId: string;
    if (isSuper && args.orgId) {
      targetOrgId = args.orgId;
    } else {
      await requireAdmin(ctx);
      targetOrgId = await getOrgId(ctx);
      if (args.orgId !== undefined && args.orgId !== targetOrgId) {
        throw new Error("No puedes editar branding de otra organización.");
      }
    }

    const existing = await ctx.db
      .query("orgBranding")
      .withIndex("by_orgId", (q) => q.eq("orgId", targetOrgId))
      .unique();

    const data = {
      orgId: targetOrgId,
      companyName: args.companyName,
      logoStorageId: args.logoStorageId,
      primaryColor: args.primaryColor,
      secondaryColor: args.secondaryColor,
      accentColor: args.accentColor,
      fontFamily: args.fontFamily,
      headerText: args.headerText,
      footerText: args.footerText,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, data);
      return existing._id;
    }
    return await ctx.db.insert("orgBranding", data);
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await requireAuth(ctx);
    const isSuper =
      ((identity.publicMetadata as Record<string, unknown> | undefined)?.role) ===
      "super_admin";
    if (!isSuper) await requireAdmin(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});
```

> **Nota schema:** `orgBranding` ya existe (`convex/schema.ts:393-405`), con
> índice `by_orgId`. D2 NO toca schema. Tamaño de logo: el editor super-admin
> actual capea a 2MB; D2 mantiene el mismo cap para operador (consistencia +
> evita bucket bloat).

### 3.3 `orgIntegrations` — Firmame + Railway

Módulo nuevo `convex/functions/orgIntegrations/`. Resend ya tiene su propio
módulo en `convex/functions/email/`; D2 NO lo toca.

**Schema:** `orgIntegrations` ya existe (`convex/schema.ts:611-643`) con union
`"resend" | "mifiel" | "anthropic" | "other"`. Decisión D2: usar `"other"` con
`providerLabel: "firmame"` para Firmame (no añadir literal nuevo — evita
migración schema para algo que es backlog). Cuando Firmame pase de credenciales
a integración real (post-beta), se agrega el literal y se migran los rows.
Para Railway se usa `"other"` con `providerLabel: "railway"`.

```ts
// convex/functions/orgIntegrations/mutations.ts
import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { requireAdmin, getOrgId } from "../../lib/authHelpers";

function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 4) return "****";
  return `${apiKey.slice(0, 7)}****${apiKey.slice(-4)}`;
}

export const upsertFirmameConfig = mutation({
  args: {
    apiKey: v.string(),
    apiSecret: v.optional(v.string()),
    sandboxMode: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);

    if (args.apiKey.trim().length < 8) {
      throw new Error("API key inválido (muy corto).");
    }

    const existing = await ctx.db
      .query("orgIntegrations")
      .withIndex("by_orgId_provider", (q) =>
        q.eq("orgId", orgId).eq("provider", "other"),
      )
      .filter((q) => q.eq(q.field("providerLabel"), "firmame"))
      .first();

    const now = Date.now();
    const configPayload = {
      apiKeySecretRef: args.apiKey,
      apiKeyMasked: maskApiKey(args.apiKey),
      webhookSecretRef: args.apiSecret,
      sandboxMode: args.sandboxMode ?? true,
    };

    if (existing) {
      await ctx.db.patch(existing._id, {
        config: configPayload,
        status: "pending_verification",
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("orgIntegrations", {
      orgId,
      provider: "other",
      providerLabel: "firmame",
      config: configPayload,
      status: "pending_verification",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const deleteFirmameConfig = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    const existing = await ctx.db
      .query("orgIntegrations")
      .withIndex("by_orgId_provider", (q) =>
        q.eq("orgId", orgId).eq("provider", "other"),
      )
      .filter((q) => q.eq(q.field("providerLabel"), "firmame"))
      .first();
    if (!existing) return { ok: true };
    await ctx.db.delete(existing._id);
    return { ok: true };
  },
});
```

Query `listForOrg`:

```ts
// convex/functions/orgIntegrations/queries.ts
import { query } from "../../_generated/server";
import { getOrgIdSafe } from "../../lib/authHelpers";

export const listForOrg = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    const rows = await ctx.db
      .query("orgIntegrations")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    // strip apiKeySecretRef before returning to client (never expose plain key)
    return rows.map((r) => ({
      _id: r._id,
      provider: r.provider,
      providerLabel: r.providerLabel,
      status: r.status,
      apiKeyMasked: r.config.apiKeyMasked,
      fromEmail: r.config.fromEmail,
      sandboxMode: r.config.sandboxMode,
      lastCheckedAt: r.lastCheckedAt,
      lastErrorMessage: r.lastErrorMessage,
      updatedAt: r.updatedAt,
    }));
  },
});
```

> **IMPORTANTE:** la query nunca devuelve `apiKeySecretRef` al cliente. Solo
> `apiKeyMasked`. El masked se calcula al guardar (mutation), no al leer.
> Mismo patrón que `convex/functions/email/queries.ts:160`.

**Railway:** NO se persiste nada en `orgIntegrations` para Railway en beta.
La UI muestra info read-only leída desde una query trivial que retorna
`{ bucketName, hasCredentials: boolean }` chequeando env vars. Implementación:

```ts
// convex/functions/orgIntegrations/queries.ts (continuación)
export const getRailwayInfo = query({
  args: {},
  handler: async (ctx) => {
    await requireAuth(ctx);
    // valores derivados de env vars al deploy-time (no expuestos secrets)
    return {
      bucketName: process.env.RAILWAY_BUCKET_NAME ?? null,
      endpoint: process.env.RAILWAY_BUCKET_ENDPOINT ?? null,
      hasCredentials:
        Boolean(process.env.RAILWAY_BUCKET_KEY) &&
        Boolean(process.env.RAILWAY_BUCKET_SECRET),
    };
  },
});
```

**Test connection** para Firmame: en beta se entrega un **stub** que solo
valida formato del API key sin pegarle al endpoint real (Firmame es backlog).
Para Resend, sí se hace ping real al endpoint:

```ts
// convex/functions/orgIntegrations/actions.ts
import { action } from "../../_generated/server";
import { v } from "convex/values";
import { requireAdmin, getOrgId } from "../../lib/authHelpers";

export const testFirmameConnection = action({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);

    const config = await ctx.runQuery(
      internal.functions.orgIntegrations.internalQueries.getFirmameConfig,
      { orgId },
    );
    if (!config?.apiKeySecretRef) {
      return { ok: false, message: "No hay credenciales configuradas." };
    }
    // stub beta: solo valida formato. Post-beta: ping a https://firmame.com/api/health
    if (config.apiKeySecretRef.length < 16) {
      return { ok: false, message: "API key con formato inválido." };
    }
    return {
      ok: true,
      message: "Formato válido. (Test real con endpoint Firmame post-beta.)",
    };
  },
});
```

### 3.4 `orgConfigs` — notification preferences

`convex/functions/orgConfigs/mutations.ts` actual: `upsert` requiere
`requireSuperAdmin`. D2 añade mutation dedicada para que el operador edite
solo el subset de campos que le importan (notificaciones y currency), sin
abrir `upsert` completo al operador (los feature flags siguen siendo super-
admin only).

```ts
// convex/functions/orgConfigs/mutations.ts — añadir
export const updateNotificationPreferences = mutation({
  args: {
    notificationEmail: v.optional(v.string()),
    // hooks para post-beta:
    reminderHourLocal: v.optional(v.number()), // 0-23, default 9
    notifyOnDeliverableGenerated: v.optional(v.boolean()),
    notifyOnInvoicePaid: v.optional(v.boolean()),
    notifyOnQuotationAccepted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);

    if (args.notificationEmail !== undefined && args.notificationEmail !== "") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.notificationEmail)) {
        throw new Error("Email inválido.");
      }
    }
    if (args.reminderHourLocal !== undefined) {
      if (args.reminderHourLocal < 0 || args.reminderHourLocal > 23) {
        throw new Error("Hora debe estar entre 0 y 23.");
      }
    }

    const existing = await ctx.db
      .query("orgConfigs")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .unique();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        notificationEmail: args.notificationEmail || undefined,
        // Los toggles nuevos se persisten solo si el schema los acepta.
        // R1 no aprobó schema delta aún — D2 deja la mutation lista pero
        // los args extra son no-op en beta hasta que `orgConfigs` añada
        // `notificationPreferences` object (V2-ready, ver §7).
        updatedAt: now,
      });
      return existing._id;
    }

    // si no existe orgConfigs row, crear uno con defaults (la mayoría de
    // featureFlags ya están seedeados por organizations.create — fallback
    // defensivo).
    return await ctx.db.insert("orgConfigs", {
      orgId,
      calculationMode: "weighted",
      commissionMode: "proportional",
      seasonalityEnabled: false,
      featureFlags: {
        advancedConfigVisible: false,
        customServicesVisible: false,
        seasonalityEditable: false,
        manualOverrideAllowed: false,
      },
      notificationEmail: args.notificationEmail || undefined,
      updatedAt: now,
    });
  },
});
```

**Schema delta opcional** (no bloqueante en D2 — `args` extra se ignoran si el
schema no los soporta): añadir `notificationPreferences` opcional a
`orgConfigs`:

```ts
// convex/schema.ts:369-391 — añadir antes de updatedAt
notificationPreferences: v.optional(
  v.object({
    reminderHourLocal: v.optional(v.number()),
    notifyOnDeliverableGenerated: v.optional(v.boolean()),
    notifyOnInvoicePaid: v.optional(v.boolean()),
    notifyOnQuotationAccepted: v.optional(v.boolean()),
  }),
),
```

Si el implementador decide entregar el toggle real en beta, agrega el campo y
ajusta la mutation. Si no, los toggles UI quedan como local state (no se
persisten) — ver §4.5.

**Test send** de notificaciones:

```ts
// convex/functions/orgConfigs/actions.ts (nuevo archivo)
import { action } from "../../_generated/server";
import { internal } from "../../_generated/api";

export const sendTestNotification = action({
  args: {},
  handler: async (ctx) => {
    // reutiliza el sender existente de notification routing
    // (2026-05-19-notification-recipient-resolution-design.md)
    return await ctx.runAction(
      internal.functions.email.actions.sendTestToOrgNotificationEmail,
      {},
    );
  },
});
```

> El `internal.functions.email.actions.sendTestToOrgNotificationEmail` puede
> NO existir todavía. Si A3 no lo entrega antes que D2, el implementador
> escribe el stub: lee `orgConfigs.notificationEmail`, llama `Resend.send()`
> con asunto "Projex · Test", body "Esto es un test de tu config de
> notificaciones." Si `notificationEmail` está vacío, throws "No hay email
> destino configurado."

---

## 4. Frontend

### 4.1 Hub `/configuracion` expandido

Refactor de `src/app/(dashboard)/configuracion/page.tsx`. Mantiene mismo
componente Link card actual, agrupa en secciones con heading:

```tsx
"use client";

import Link from "next/link";
import {
  Settings,
  Building2,
  Mail,
  Plug,
  ChevronRight,
  Layers,
  FileText,
  Users,
  CalendarClock,
  Bell,
  Palette,
} from "lucide-react";

const groups = [
  {
    label: "Catálogo",
    items: [
      {
        href: "/configuracion/empresas-emitentes",
        icon: Building2,
        title: "Empresas Emitentes",
        description:
          "Personas morales que emiten cotizaciones, contratos y facturas.",
      },
      {
        href: "/configuracion/subservicios",
        icon: Layers,
        title: "Subservicios",
        description:
          "Catálogo de subservicios contractuales de tu org (Legal → Compliance, etc.).",
      },
      {
        href: "/configuracion/plantillas",
        icon: FileText,
        title: "Plantillas",
        description:
          "Plantillas de entregables, cotizaciones y contratos editables por servicio.",
      },
    ],
  },
  {
    label: "Equipo",
    items: [
      {
        href: "/configuracion/usuarios",
        icon: Users,
        title: "Usuarios",
        description:
          "Ejecutivos de la org y a qué clientes están asignados.",
      },
      {
        href: "/configuracion/frecuencias",
        icon: CalendarClock,
        title: "Frecuencias",
        description:
          "Cadencia por defecto de cada subservicio (mensual, trimestral, etc.).",
      },
    ],
  },
  {
    label: "Comunicación",
    items: [
      {
        href: "/configuracion/notificaciones",
        icon: Bell,
        title: "Notificaciones",
        description:
          "Email destino, recordatorios diarios y preferencias por evento.",
      },
      {
        href: "/configuracion/email-log",
        icon: Mail,
        title: "Email Log",
        description: "Historial de emails enviados por la plataforma.",
      },
    ],
  },
  {
    label: "Identidad",
    items: [
      {
        href: "/configuracion/branding",
        icon: Palette,
        title: "Branding",
        description:
          "Logo, colores y footer aplicado a documentos generados.",
      },
    ],
  },
  {
    label: "Proveedores",
    items: [
      {
        href: "/configuracion/integraciones",
        icon: Plug,
        title: "Integraciones",
        description:
          "Resend (email), Firmame (firma digital), Railway (blob storage).",
      },
    ],
  },
] as const;

export default function ConfiguracionPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="text-accent" size={28} />
        <h1 className="text-2xl font-bold">Configuración</h1>
      </div>

      {groups.map((group) => (
        <section key={group.label} className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {group.label}
          </h2>
          {group.items.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="flex items-center justify-between rounded-lg border border-border bg-card p-4 transition-colors hover:border-accent/30 cursor-pointer"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10">
                  <s.icon className="text-accent" size={20} />
                </div>
                <div>
                  <p className="font-medium">{s.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.description}
                  </p>
                </div>
              </div>
              <ChevronRight className="text-muted-foreground" size={18} />
            </Link>
          ))}
        </section>
      ))}
    </div>
  );
}
```

> **Coordinación con A1 y A2:** A1 ya agrega la card "Subservicios" en el
> hub; A2 ya agrega "Plantillas". Si los tres sub-specs aterrizan en orden
> secuencial, el último que merge (D2) escribe la versión final del hub
> y los anteriores quedan superseded por este código. Si D2 merge antes,
> A1 y A2 reordenan solo las cards relevantes (ver §9 referencias). El
> implementador de D2 debe coordinar el merge para evitar conflictos en
> `page.tsx`. Recomendación: aplazar la edición del hub a D2 si A1 y A2
> aún no mergeron sus PRs.

### 4.2 `/configuracion/usuarios`

Ruta nueva: `src/app/(dashboard)/configuracion/usuarios/page.tsx`.

**Layout (ASCII):**

```
┌─────────────────────────────────────────────────────────────────────┐
│  ◀ Configuración                                                    │
│  Usuarios                                          [+ Invitar usuario]│
│  Ejecutivos de tu organización y los clientes que tienen asignados.  │
├─────────────────────────────────────────────────────────────────────┤
│  Nombre              │ Email                  │ Rol      │ Clientes │
├──────────────────────┼────────────────────────┼──────────┼──────────┤
│  Christian Cover     │ christian@pymercado…   │ admin    │   12     │
│  Luis García         │ luis@desk.mx           │ admin    │    4     │
│  Marina Pérez        │ marina@desk.mx         │ member   │    1     │
└─────────────────────────────────────────────────────────────────────┘

Click en fila → drawer derecho:
┌─ Marina Pérez ──────────────────────────────────────────────────────┐
│ Email: marina@desk.mx                                                │
│ Rol:   org:member                                                    │
│ Última actividad: hace 2 días  (de Clerk lastSignInAt)              │
├──────────────────────────────────────────────────────────────────────┤
│ Clientes asignados (1)                              [+ Asignar]      │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │  Acme Industrial S.A.                              [Desasignar] │ │
│ └─────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

**Data fetching:**

```tsx
"use client";

import { useOrganization } from "@clerk/nextjs";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { useState } from "react";

export default function UsuariosPage() {
  const { memberships, isLoaded } = useOrganization({
    memberships: { infinite: true, pageSize: 50 },
  });

  // Convex query: cuántos clientes tiene cada userId asignados
  const assignments = useQuery(api.functions.users.queries.listAssignmentsForOrg);

  // join Clerk memberships + Convex assignment counts
  const rows = (memberships?.data ?? []).map((m) => {
    const count = assignments?.find((a) => a.userId === m.publicUserData?.userId)
      ?.assignedClientCount ?? 0;
    return {
      userId: m.publicUserData?.userId,
      name: m.publicUserData
        ? `${m.publicUserData.firstName ?? ""} ${m.publicUserData.lastName ?? ""}`.trim()
        : "—",
      email: m.publicUserData?.identifier ?? "—",
      role: m.role,
      assignedClientCount: count,
    };
  });

  // ... render table, drawer for selected user, modal for invite
}
```

**Componentes:**

- Tabla principal: `<table>` simple con borders, hover row.
- Botón "+ Invitar usuario" → modal con `<input type="email">` + `<select role>`.
  El submit hace `fetch("/api/clerk/invite-user", { method: "POST", body: JSON.stringify({emailAddress, role}) })`.
- Drawer derecha: `<aside>` fixed con backdrop. Reusa pattern de
  `/configuracion/empresas-emitentes/[id]/page.tsx` si existe drawer
  similar; si no, `<dialog>` HTML nativo + Tailwind.
- "Asignar cliente" en drawer: combobox que lee
  `api.functions.clients.queries.listForOrg` y filtra los que NO tienen
  `assignedTo === selectedUser.userId`. Submit llama
  `api.functions.users.mutations.assignToClient`.
- "Desasignar": llama `api.functions.users.mutations.unassign`.

**Estado vacío:** si `memberships.data.length === 0` (no debería pasar; al
menos el caller es member), muestra "No hay usuarios. Invita al primero."

**Permisos:** la página solo se renderiza si `membership?.role === "org:admin"`.
Si `member`, redirect a `/configuracion`. Patrón ya usado en
`src/app/(dashboard)/configuracion/integraciones/resend/page.tsx:14-20`.

### 4.3 `/configuracion/branding`

Ruta nueva: `src/app/(dashboard)/configuracion/branding/page.tsx`.

**Estrategia:** clonar el componente `src/app/platform/orgs/[id]/branding/page.tsx`
(528 LOC, ya implementado) sustituyendo:

- Quitar el lookup de `org` por `clerkOrgId` (el operador ya está en su org).
- `useQuery(api.functions.orgBranding.queries.getByOrgId, {})` en lugar de
  `getByOrgIdForAdmin`.
- `useMutation(api.functions.orgBranding.mutations.upsert)` (refactoreada
  en §3.2 — sin pasar `orgId` cuando caller no es super-admin).
- Sin breadcrumb a `/platform/orgs/[id]`; en su lugar el patrón
  `<Link href="/configuracion">◀ Configuración</Link>` ya usado en
  `empresas-emitentes/page.tsx`.

**Reutilización:** extraer el form a un componente reutilizable
`src/components/branding/BrandingForm.tsx` que recibe props
`{ branding, logoUrl, onSave, onUpload, mode: "org" | "platform" }`. Tanto
`/configuracion/branding` como `/platform/orgs/[id]/branding` lo consumen.
Si el implementador prefiere no refactorizar `/platform/orgs/[id]/branding`
en este sub-spec (riesgo de tocar super-admin code path), entrega
`BrandingForm.tsx` y solo lo usa en `/configuracion/branding`; la página
super-admin queda intacta y se migra post-beta.

**Layout:** idéntico al super-admin existente — 2 columnas, left form
(Identidad, Colores, Tipografía+Texto), right preview con render dummy del
encabezado de documento. NO usa puppeteer (Q5).

**Validaciones:**

- `companyName` requerido (non-empty trim).
- Logo: PNG/JPG/SVG, max 1MB (decisión D2: cap más conservador que el actual
  super-admin 2MB para evitar bucket bloat con N orgs en producción; ver §7).
- Colores: hex válido (`/^#[0-9a-fA-F]{6}$/`), regex en client.

**Header con breadcrumb:**

```tsx
<Link
  href="/configuracion"
  className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
>
  <ChevronLeft size={16} /> Configuración
</Link>
<div className="flex items-center gap-3">
  <Palette className="text-accent" size={28} />
  <h1 className="text-2xl font-bold">Branding</h1>
</div>
```

### 4.4 `/configuracion/integraciones`

Ruta nueva: `src/app/(dashboard)/configuracion/integraciones/page.tsx`. Hub
de proveedores. Mantiene `/configuracion/integraciones/resend/page.tsx`
existente intacta — solo añade su entry al hub.

**Layout:**

```
┌─────────────────────────────────────────────────────────────────────┐
│  ◀ Configuración                                                    │
│  Integraciones                                                      │
│  API keys y credenciales de proveedores externos.                   │
├─────────────────────────────────────────────────────────────────────┤
│  Resend (email)                            ●  Conectado             │
│    re_abc1****wxyz · noreply@desk.mx                                │
│    [Editar configuración →]                                         │
│                                                                     │
│  Firmame (firma digital)                   ○  No configurado        │
│    Backlog — credenciales se guardan, integración real post-beta.   │
│    [Configurar →]                                                   │
│                                                                     │
│  Railway (blob storage)                    ●  Conectado (global)    │
│    efficient-thermos-jbwy9sb @ t3.storageapi.dev                    │
│    Read-only · override por org disponible en V2.                   │
└─────────────────────────────────────────────────────────────────────┘
```

**Data fetching:**

```tsx
const integrations = useQuery(api.functions.orgIntegrations.queries.listForOrg);
const railwayInfo = useQuery(api.functions.orgIntegrations.queries.getRailwayInfo);
const resend = integrations?.find((i) => i.provider === "resend");
const firmame = integrations?.find(
  (i) => i.provider === "other" && i.providerLabel === "firmame",
);
```

**Status chips:**

- Resend: `status === "active"` → verde "Conectado"; `error` → rojo "Error";
  ausente → gris "No configurado".
- Firmame: `pending_verification` → amarillo "Pendiente verificación";
  ausente → gris "No configurado".
- Railway: `railwayInfo.hasCredentials` → verde "Conectado (global)";
  no → rojo "Sin credenciales — contacta soporte".

**Action buttons:**

- Resend `[Editar configuración]` → `Link` a `/configuracion/integraciones/resend`.
- Firmame `[Configurar]` → abre drawer con form:
  ```
  ┌─ Firmame ───────────────────┐
  │ API Key      [____________] │
  │ API Secret   [____________] │  ← opcional
  │ Sandbox mode [✓]             │
  │ [Probar conexión] [Guardar] │
  └─────────────────────────────┘
  ```
  - `[Probar conexión]` llama `api.functions.orgIntegrations.actions.testFirmameConnection`. Muestra toast.
  - `[Guardar]` llama `upsertFirmameConfig`. Toast + refresh.
  - "Cambiar API key" si ya hay una guardada: input muestra masked + botón
    "Cambiar" que reabre el input limpio.
- Railway: sin acciones en beta (read-only).

**Permisos:** misma estrategia que `usuarios` — redirige si no es
`org:admin`.

### 4.5 `/configuracion/notificaciones`

Ruta nueva: `src/app/(dashboard)/configuracion/notificaciones/page.tsx`.

**Layout:**

```
┌─────────────────────────────────────────────────────────────────────┐
│  ◀ Configuración                                                    │
│  Notificaciones                                                     │
│  Configura el email destino y cuándo quieres recibir alertas.       │
├─────────────────────────────────────────────────────────────────────┤
│  Email destino *                                                    │
│  [christian@pymercadohost.com                                    ]  │
│  Reciben alertas operativas de la org. Default si no hay ejecutivo  │
│  asignado al cliente.                                               │
│                                                                     │
│  [Enviar email de prueba]                                           │
│                                                                     │
│  Recordatorios diarios                                              │
│  Hora preferida (zona horaria de la org)                            │
│  [09:00 ▾]                                                          │
│                                                                     │
│  Eventos                                                            │
│  [✓] Email cuando se genera un entregable                           │
│  [✓] Email cuando se marca una factura como pagada                  │
│  [✓] Email cuando un cliente acepta cotización                      │
│  [ ] Email cuando un cliente envía cuestionario completo            │
│                                                                     │
│                                       [Cancelar] [Guardar cambios]  │
└─────────────────────────────────────────────────────────────────────┘
```

**Data fetching:**

```tsx
const config = useQuery(api.functions.orgConfigs.queries.getByOrgId);
const update = useMutation(api.functions.orgConfigs.mutations.updateNotificationPreferences);
const sendTest = useAction(api.functions.orgConfigs.actions.sendTestNotification);

const [email, setEmail] = useState(config?.notificationEmail ?? "");
const [hour, setHour] = useState(config?.notificationPreferences?.reminderHourLocal ?? 9);
// ... toggles
```

**Validaciones:**

- Email regex (server-side ya valida; cliente da feedback inmediato).
- Hora 0-23.

**Test send:**

```tsx
async function onTestSend() {
  if (!email) {
    toast.error("Guarda un email destino antes de probar.");
    return;
  }
  try {
    const res = await sendTest({});
    toast.success(`Email enviado a ${email}.`);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Error enviando email.");
  }
}
```

**Persistencia parcial:** si `notificationPreferences` no existe en schema
(decisión deferida por el implementador), los toggles quedan como local
state y muestran banner amarillo "Las preferencias por evento se
persistirán cuando el schema soporte el campo `notificationPreferences`."
El email destino y hora sí se persisten siempre.

### 4.6 `/configuracion/frecuencias` (read-only placeholder)

Ruta nueva: `src/app/(dashboard)/configuracion/frecuencias/page.tsx`.

**Justificación:** R1 §7.2 lista esta página como needed. R1 §5.2 difiere el
override por cliente a junio. D2 entrega una vista read-only que:

1. Muestra tabla agrupada por servicio padre con `subservices` + su
   `defaultFrequency`.
2. Cada row tiene link "Editar en Subservicios →" que redirige a
   `/configuracion/subservicios?focus={subserviceId}`.
3. Banner informativo arriba: "Los overrides por cliente estarán disponibles
   post-beta. Mientras tanto, la frecuencia es por subservicio."

**Layout:**

```
┌─────────────────────────────────────────────────────────────────────┐
│  ◀ Configuración                                                    │
│  Frecuencias                                                        │
│  Cadencia con la que se generan entregables por subservicio.        │
│                                                                     │
│  ℹ Override por cliente estará disponible en una versión futura.    │
├─────────────────────────────────────────────────────────────────────┤
│  Legal                                                              │
│    Gobierno Corporativo      trimestral  [Editar en Subservicios]   │
│    Contratos Mercantiles     mensual     [Editar en Subservicios]   │
│  Contable                                                           │
│    Estados Financieros Mens. mensual     [Editar en Subservicios]   │
│  Marketing                                                          │
│    Plan Anual                anual       [Editar en Subservicios]   │
│  ...                                                                │
└─────────────────────────────────────────────────────────────────────┘
```

**Data fetching:**

```tsx
const services = useQuery(api.functions.services.queries.listByOrg);
const subservices = useQuery(api.functions.subservices.queries.listAllForOrg);
// agrupa subservices[] por parentServiceId, ordena por sortOrder
```

Componente trivial (~80 LOC). Si A1 no terminó el seed, la tabla queda
vacía con mensaje "Aún no hay subservicios configurados. Ve a [Subservicios]
para crearlos."

---

## 5. Tests

Mínimo **14 tests**. Archivos nuevos:

- `convex/functions/users/__tests__/queries.test.ts`
- `convex/functions/users/__tests__/mutations.test.ts`
- `convex/functions/orgBranding/__tests__/permissions.test.ts`
- `convex/functions/orgIntegrations/__tests__/mutations.test.ts`
- `convex/functions/orgConfigs/__tests__/notifications.test.ts`

**`users` (4):**

1. **`listAssignmentsForOrg` cuenta clientes asignados por userId.** Setup:
   3 clientes en orgA, 2 asignados a `user_x`, 1 a `user_y`. Auth orgA.
   Assert: retorna `[{userId: "user_x", assignedClientCount: 2}, {userId:
   "user_y", assignedClientCount: 1}]`.
2. **`listAssignmentsForOrg` ignora clientes archivados.** Setup: 2
   asignados, uno con `isArchived: true`. Assert: count del afectado baja
   en 1.
3. **`assignToClient` multi-tenant guard.** Setup: cliente de orgA, auth
   como orgB admin. Assert: throws con "No puedes asignar clientes de otra
   organización." `db.get(clientId)` confirma `assignedTo` sigue intacto.
4. **`unassign` clear field.** Setup: cliente con `assignedTo: "user_x"`.
   Auth orgA admin. Llama `unassign`. Assert: `db.get(clientId).assignedTo
   === undefined`.

**`orgBranding` (2):**

5. **`upsert` como org-admin sin pasar `orgId` usa el del caller.** Setup:
   auth orgA admin. Llama `upsert({ companyName: "Acme", ...})`. Assert:
   row resultante tiene `orgId === "orgA"`.
6. **`upsert` como org-admin con `orgId` distinto throws.** Setup: auth
   orgA admin. Llama `upsert({ orgId: "orgB", ...})`. Assert: throws con
   "No puedes editar branding de otra organización."

**`orgIntegrations` (4):**

7. **`upsertFirmameConfig` inserta con masking.** Setup: auth orgA admin.
   Llama `upsertFirmameConfig({ apiKey: "fm_secret_1234567890" })`. Assert:
   row tiene `apiKeyMasked === "fm_secr****7890"`, `apiKeySecretRef === "fm_secret_1234567890"`,
   `status === "pending_verification"`, `providerLabel === "firmame"`.
8. **`upsertFirmameConfig` patch en lugar de insert si ya existe.** Setup:
   row existente. Re-llama con apiKey distinto. Assert: existe UN solo row
   con la nueva key.
9. **`listForOrg` NO devuelve `apiKeySecretRef` al cliente.** Setup: row
   con secret. Auth orgA. Llama `listForOrg`. Assert: response no tiene
   campo `apiKeySecretRef` ni `webhookSecretRef`; sí tiene `apiKeyMasked`.
10. **`upsertFirmameConfig` valida apiKey length.** Setup: auth orgA admin.
    Llama con `apiKey: "abc"`. Assert: throws con "API key inválido (muy
    corto)."

**`orgConfigs` (3):**

11. **`updateNotificationPreferences` valida email format.** Setup: auth
    orgA admin. Llama con `notificationEmail: "not-an-email"`. Assert:
    throws con "Email inválido."
12. **`updateNotificationPreferences` crea row si no existe.** Setup:
    orgB sin row en `orgConfigs`. Llama con `notificationEmail:
    "admin@orgb.mx"`. Assert: row insertado con defaults para featureFlags +
    el email.
13. **`updateNotificationPreferences` multi-tenant.** Setup: orgA admin
    intenta editar via mutation con sesión orgA. Assert: row resultante
    tiene `orgId === "orgA"`. Switch a orgB y verificar que su row sigue
    intacto.

**Smoke / integration (1):**

14. **Hub `/configuracion` renderiza 9 cards.** Render-test (vitest +
    @testing-library/react si está disponible; si no, snapshot test).
    Assert: `getAllByRole("link")` retorna >= 9.

> Test #14 es opcional si el setup de RTL no existe en el proyecto. Los
> 13 tests de Convex sí son must-have.

---

## 6. Definition of Done

Boolean checkable. Marcar todos antes de aceptar Z1 (demo E2E).

- [ ] `src/app/(dashboard)/configuracion/page.tsx`: hub con 9 cards agrupadas
      en 5 secciones (Catálogo, Equipo, Comunicación, Identidad, Proveedores).
- [ ] `src/app/(dashboard)/configuracion/usuarios/page.tsx`: tabla
      memberships + drawer detalle + modal invitar.
- [ ] `src/app/api/clerk/invite-user/route.ts`: POST handler con guard
      `org:admin` que llama Clerk SDK.
- [ ] `convex/functions/users/queries.ts`: `listAssignmentsForOrg`,
      `listAssignedClients`.
- [ ] `convex/functions/users/mutations.ts`: `assignToClient`, `unassign`.
- [ ] `src/app/(dashboard)/configuracion/branding/page.tsx`: editor org-admin
      con preview, reusa `BrandingForm` component.
- [ ] `convex/functions/orgBranding/mutations.ts` refactor: `upsert` y
      `generateUploadUrl` aceptan caller `requireAdmin` para su propia org.
- [ ] `convex/functions/orgBranding/queries.ts` refactor: `getLogoUrl` con
      guard por orgId del logo (operador puede ver SOLO el suyo).
- [ ] `src/app/(dashboard)/configuracion/integraciones/page.tsx`: hub
      Resend + Firmame + Railway con status chips.
- [ ] `convex/functions/orgIntegrations/queries.ts`: `listForOrg` (sin
      exponer secrets), `getRailwayInfo`.
- [ ] `convex/functions/orgIntegrations/mutations.ts`: `upsertFirmameConfig`,
      `deleteFirmameConfig`.
- [ ] `convex/functions/orgIntegrations/actions.ts`: `testFirmameConnection`
      (stub beta).
- [ ] `src/app/(dashboard)/configuracion/notificaciones/page.tsx`: form
      email + hora + toggles + test send.
- [ ] `convex/functions/orgConfigs/mutations.ts` añade
      `updateNotificationPreferences` con `requireAdmin`.
- [ ] `convex/functions/orgConfigs/actions.ts`: `sendTestNotification`
      (puede stub si A3 no provee `sendTestToOrgNotificationEmail`).
- [ ] `src/app/(dashboard)/configuracion/frecuencias/page.tsx`: vista
      read-only agrupada por servicio padre con link a subservicios.
- [ ] `src/components/branding/BrandingForm.tsx`: componente compartido
      extraído.
- [ ] 13+ tests vitest pasando (`npm test`).
- [ ] `npm run lint` clean.
- [ ] `npx tsc --noEmit` clean.
- [ ] `gitnexus_impact` corrido sobre `orgBranding.upsert`, `orgConfigs.upsert`,
      `clients.assignedTo` writers. HIGH/CRITICAL risk reportado en PR.
- [ ] `gitnexus_detect_changes` pre-commit: scope confirma solo
      `convex/functions/{users,orgBranding,orgIntegrations,orgConfigs}/**`,
      `convex/schema.ts` (si se agrega `notificationPreferences`),
      `src/app/(dashboard)/configuracion/**`,
      `src/app/api/clerk/invite-user/route.ts`,
      `src/components/branding/BrandingForm.tsx`.

---

## 7. Riesgos específicos de D2

**Encriptación at-rest de API keys.** Convex no expone primitivas crypto
nativas. En beta los `apiKeySecretRef` se guardan en plaintext en la tabla
`orgIntegrations`. Mitigación:

- Misma postura que Resend ya usa (`convex/functions/email/mutations.ts:37`),
  precedente aceptado.
- Mask al exponer al cliente (la query `listForOrg` strip-ea el campo).
- Acceso a Convex dashboard restringido a Christian.
- Post-beta: envelope encryption con KMS key (AWS o GCP), retrofit las
  3 mutations existentes (Resend + Firmame + futuro Anthropic). Out of
  scope D2.

**Logo upload size bloat.** Cap a 1MB (más conservador que el 2MB super-admin
actual). Razón: con N orgs y promedio 2 ediciones/org/año, 1MB extra por
upload se acumula. Validación client-side primero, defensiva server-side
en `generateUploadUrl` (no implementable hoy, Convex storage upload URL no
soporta size cap server-side — añadir guard en el handler de upload o
auto-purgar logos > 1MB en cron de limpieza semanal post-beta).

**Clerk roles inconsistentes con el rol custom `"operator"`.** R1 §7.3
fija que `"operator"` se mapea a `"org:admin"` en beta. El handler
`/api/clerk/invite-user` solo acepta `"org:admin" | "org:member"`. Si en
junio se separan, agregar `"org:operator"` como literal y mapear según
necesidad. Sin migración de datos requerida.

**Clerk `useOrganization` data fetch latency.** El hook puede mostrar
`memberships === undefined` por ~200ms al render inicial; durante ese tiempo
la tabla de usuarios queda vacía. Mitigación: loading skeleton ya estándar
en `src/app/(dashboard)/configuracion/integraciones/resend/page.tsx:22`.

**`OrganizationSwitcher` permite cambiar de org mientras el usuario está en
`/configuracion/usuarios`.** Cambio de org dispara re-fetch automático de
queries Convex (basado en JWT). Asignaciones de orgA no se mezclan con
orgB. Riesgo: el modal de "Invitar" queda con state del org anterior si el
usuario cambia mid-modal. Mitigación: cerrar el modal al cambiar org
(efecto que escucha `organization?.id` y resetea estado).

**Firmame credenciales guardadas sin que exista integración funcional.**
Riesgo: papá pide "ya métele firma a contratos" pensando que con guardar el
key alcanza. UI debe explicitar "Backlog — credenciales se guardan, la
integración real se conecta post-beta." (texto literal en card §4.4).

**Test send de notificaciones podría no funcionar si Resend org-config no
está configurado.** Mitigación: el action `sendTestNotification` debe
fallar gracefully con mensaje "Configura primero Resend en
[Integraciones](/configuracion/integraciones/resend) para poder probar
notificaciones." UI muestra ese mensaje en toast.

---

## 8. Open questions

**Q1. ¿API keys encrypted at rest en beta o masked-UI suffices?**
**Recomendación:** masked-UI only, sin crypto at-rest. Precedente Resend
ya hace esto y el dueño aceptó. Post-beta: envelope encryption con KMS
(retrofit 3 providers).

**Q2. ¿Branding preview real con puppeteer (PDF tal cual saldrá) o solo
HTML/CSS inline?**
**Recomendación:** CSS preview inline (igual que el super-admin actual).
Puppeteer en el editor agrega latencia y carga del lambda. La fidelidad
PDF se valida en producción cuando se genera el primer entregable.

**Q3. ¿Cliente ve logo de su org en cotizaciones/contratos generados?**
**Recomendación:** SÍ, ya pasa hoy. `orgBranding.logoStorageId` se lee al
generar PDF (puppeteer flow en `src/app/api/generate-pdf/route.ts`). D2 no
cambia esa lógica; solo permite que el operador suba el logo en lugar de
pedírselo a super-admin.

**Q4. ¿`invite-user` handler debe forzar `org:member` para todas las
invitaciones nuevas (defensivo) o respetar el rol que pide el operador?**
**Recomendación:** respetar el rol que pide el operador (admin o member).
Validación: el handler solo acepta `"org:admin" | "org:member"` (rechaza
literales no esperados). Si el operador quiere promover a otro admin, está
en su derecho — el rol custom `"operator"` se mapea a `org:admin` (R1 §7.3)
así que técnicamente es el mismo rol en beta.

**Q5. ¿Schema delta `notificationPreferences` se introduce en D2 o se
difiere?**
**Recomendación:** introducir en D2 (campo opcional, sin migración). El
costo es mínimo y permite que los toggles sean persistidos desde el día 1
en lugar de quedar como UI sin efecto. Si el implementador prefiere
shippeable sobre completeness, puede diferir y los toggles quedan local
state hasta junio (con banner explicativo).

**Q6. ¿Test send de notificaciones reutiliza el sender de Resend org-scoped
o el global?**
**Recomendación:** org-scoped (lee `orgIntegrations` del caller). Si no
hay Resend configurado, fallback al global. Si tampoco hay global,
throws "Configura Resend para poder probar notificaciones."

**Q7. ¿"Editar en Subservicios" en frecuencias usa query param `?focus=` o
hash `#id`?**
**Recomendación:** query param. Más limpio para Next.js App Router.
`/configuracion/subservicios/page.tsx` (A1) debe escuchar
`searchParams.focus` y hacer scroll-into-view + highlight del row. Si A1
no implementa eso, el link aún funciona sin highlight (degrada graceful).

---

## 9. Referencias

### 9.1 Archivos del codebase

- `src/app/(dashboard)/configuracion/page.tsx:1-58` — hub actual (3 cards);
  D2 reemplaza con versión de 9 cards agrupadas.
- `src/app/(dashboard)/configuracion/empresas-emitentes/page.tsx:1-25` —
  patrón de breadcrumb + heading + lista que D2 replica en las 5 páginas
  nuevas.
- `src/app/(dashboard)/configuracion/integraciones/resend/page.tsx:1-49` —
  patrón de guard `org:admin` con redirect (D2 lo reusa).
- `src/app/platform/orgs/[id]/branding/page.tsx:1-528` — editor branding
  super-admin completo; D2 lo clona como `BrandingForm` reusable.
- `src/components/layout/sidebar.tsx:22-35` — navegación operadora; D2 NO
  toca sidebar.
- `src/components/layout/sidebar.tsx:104-119` — gate super-admin para
  `/platform`; D2 NO toca.
- `convex/schema.ts:369-391` — `orgConfigs`; D2 puede añadir
  `notificationPreferences` opcional (decisión §8 Q5).
- `convex/schema.ts:393-405` — `orgBranding`; D2 NO toca schema.
- `convex/schema.ts:611-643` — `orgIntegrations`; D2 NO toca schema (usa
  `provider: "other"` + `providerLabel: "firmame"` para evitar literal nuevo).
- `convex/functions/orgBranding/queries.ts:1-54` — `getByOrgId` ya operador-
  friendly; `getLogoUrl` requiere refactor (D2 §3.2).
- `convex/functions/orgBranding/mutations.ts:1-54` — `upsert` y
  `generateUploadUrl` requieren refactor para aceptar `requireAdmin` (D2 §3.2).
- `convex/functions/orgConfigs/queries.ts:1-30` — `getByOrgId` ya funcional;
  D2 lo consume tal cual.
- `convex/functions/orgConfigs/mutations.ts:1-60` — `upsert` se mantiene
  super-admin only; D2 añade `updateNotificationPreferences` con
  `requireAdmin`.
- `convex/functions/email/mutations.ts:1-62` — patrón
  `upsertResendConfig` con `maskApiKey`; D2 lo replica para Firmame.
- `convex/functions/email/queries.ts:160` — patrón de strip `apiKeySecretRef`
  al exponer al cliente; D2 lo replica.
- `convex/functions/clients/mutations.ts:42,62` — `assignedTo` field;
  D2 escribe vía `users.assignToClient`.
- `convex/lib/authHelpers.ts:11-50` — `getOrgId`, `getOrgIdSafe`,
  `requireAdmin`, `requireSuperAdmin`; D2 usa los 4.
- `.env.local:21-24` — `RAILWAY_BUCKET_*` vars; D2 los lee en
  `getRailwayInfo`.
- `src/app/api/generate-pdf/route.ts` — referencia de Next.js Route Handler
  con auth; D2 replica el patrón en `/api/clerk/invite-user`.

### 9.2 Sub-specs relacionados

- `docs/superpowers/specs/2026-05-20-prod-readiness-revision.md` — maestro
  R1, §7.2 lista exhaustivamente las páginas faltantes que D2 cubre, §12
  fija decisiones canónicas (#7 rol operator, O12 branding per-org).
- `docs/superpowers/specs/2026-05-21-subservices-model-design.md` — A1,
  ya entrega `/configuracion/subservicios` y la card en el hub. D2
  reescribe el hub completo incluyendo esa card. **Coordinar merge.**
- `docs/superpowers/specs/2026-05-22-templates-operator-access-design.md` —
  A2, ya entrega `/configuracion/plantillas` y la card en el hub. **Coordinar
  merge.**
- `docs/superpowers/specs/2026-05-23-document-lifecycle-design.md` — A3,
  entregará `sendTestToOrgNotificationEmail` action que D2
  `sendTestNotification` envuelve. Si A3 no lo entrega antes, D2 escribe
  el stub.
- `docs/superpowers/specs/2026-05-19-notification-recipient-resolution-design.md`
  — vigente; D2 `updateNotificationPreferences` cierra el loop UI que ese
  sub-spec dejó abierto en §4 ("UI de settings para capturar
  `notificationEmail` por org").

### 9.3 Memorias del proyecto

- `project_blob_storage` — Railway bucket = source of truth para blobs;
  el `getRailwayInfo` query lo confirma read-only.
- `project_firma_provider` — Firmame (NO MiFiel) es el provider activo;
  D2 persiste credenciales aunque la integración real quede backlog.
- `project_sprint_v2_timeline` — D2 entrega 2026-05-31 (día 10) liberando
  slot para Z1 demo. Si se desborda, R1 §9.3 lista qué se difiere primero
  (D2.branding es el primer descarte).

---

**Fin del sub-spec D2.** Con D2 entregado, `/configuracion` queda completo
para que el operador (papá + ejecutivos) maneje su org sin necesidad de
acceso a Convex dashboard ni a Clerk org settings directamente. Las únicas
gestiones que siguen requiriendo super-admin son: editar plantillas
globales (A2 lo deja claro), editar catálogo global de subservicios
(A1 lo deja claro), y ver métricas cross-org (D1 lo cubre).
