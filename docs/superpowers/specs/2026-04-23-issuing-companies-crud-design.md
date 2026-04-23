---
section: 2
title: CRUD Empresas Emitentes + resolver + seed
created: 2026-04-23
status: draft
sprint: projex-v2-15may
depends_on: []
blocks: [3, 4]
---

# Sección 2 — CRUD Empresas Emitentes

Esta sección construye la capa base de multi-entity facturadora del sprint v2:
el CRUD administrativo de las personas morales que emiten facturas, su
asignación a servicios, y el resolver que decide qué empresa factura un
servicio para un cliente específico. Es prerequisito de secciones 3 (pipeline
cotización→contrato con branding correcto) y 4 (templates por empresa).

"Empresas emitentes" es el término UI en español; el schema usa
`issuingCompanies` en inglés. No hay rename de schema en este spec.

## 2.1 Scope

### Incluido

- CRUD de `issuingCompanies` — backend (queries + mutations + action de
  upload de logo) y UI (`/configuracion/empresas-emitentes/`).
- CRUD de `servicesIssuingCompanyMap` — editable únicamente desde el detalle
  de una empresa (UI en tab "Servicios que emite"); no tiene ruta propia.
- `resolveIssuingCompany(ctx, { orgId, clientId, serviceId })` — función TS
  pura en `convex/functions/issuingCompanies/resolve.ts`, consume las 3
  fuentes per 4.3 y lanza `NoIssuingCompanyError` si ninguna matchea.
- Seed dummy en `convex/functions/seed/v2Fixtures.ts` — 2 empresas + service
  map + 1 `clientIssuingCompanyOverride` de prueba, idempotente, sólo en
  `NODE_ENV !== "production"`.
- Upload de logo al `_storage` de Convex reusando el patrón de
  `orgBranding/actions.ts`.
- Permisos: Admin CRUD completo; Ejecutivo read-only sobre list/detalle;
  Super Admin equivalente a Admin pero cross-org.

### Explícitamente fuera de scope

- CRUD de `clientIssuingCompanyOverride` — la tabla existe y el resolver la
  consulta, pero no se construye UI/mutations públicas en este spec. Se
  considera una feature futura.
- Branding cromático por empresa (primaryColor, fontFamily, etc.) — se
  defiere per sección 4.5. Branding sigue viniendo de `orgBranding`.
- Banner/link UI cuando `NoIssuingCompanyError` se dispara al enviar una
  cotización — el error se define aquí, el UI que lo captura vive en
  sección 3.
- Cambios al schema — todo lo necesario ya está en `convex/schema.ts`
  líneas 314-375.
- Migración de `deliverableTemplates` con `issuingCompanyId` — es scope de
  sección 4.
- Catálogo SAT completo para `regimenFiscalCode` — se valida contra una
  lista corta hardcoded (regímenes más comunes: 601, 603, 612, 626). El
  catálogo completo es scope futuro.

## 2.2 Data model

No hay cambios al schema. Todo lo necesario ya está en
`convex/schema.ts`.

### `issuingCompanies` (líneas 314-350)

Campos requeridos (validados en `create`): `orgId`, `name`, `legalName`,
`rfc`, `regimenFiscalCode`, `codigoPostal`, `address.{street, city, state,
country}`, `email`, `isDefault`, `isActive`, `createdAt`, `updatedAt`.

Opcionales: `regimenFiscalLabel`, `address.{exteriorNumber, interiorNumber,
colonia}`, `phone`, `website`, `bankName`, `bankAccount`, `clabe`,
`currency`, `invoiceSerie`, `logoStorageId`, `signatoryName`,
`signatoryTitle`.

Índices que ya existen y cubren los reads del spec: `by_orgId`,
`by_orgId_rfc`, `by_orgId_isDefault`, `by_orgId_isActive`.

### `servicesIssuingCompanyMap` (líneas 352-361)

Mapping many-to-one: un servicio se asigna a una empresa emitente a nivel
org. Editado como conjunto desde el detalle de la empresa (reescritura
completa del set, no edición incremental).

Índices: `by_orgId_serviceId` para consulta de default del servicio,
`by_issuingCompanyId` para cascada al borrar una empresa.

### `clientIssuingCompanyOverride` (líneas 363-375)

Override por cliente. Sólo consumido por el resolver en este spec. No hay
mutations públicas; la tabla sólo recibe writes vía seed dummy.

### Validaciones de negocio

- **RFC único por org.** Validado en `create` y `update` con query
  indexada `by_orgId_rfc`. Formato mexicano: persona moral
  `/^[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}$/`, persona física `/^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/`.
  Se normaliza a upper-case antes de guardar.
- **Exactamente una `isDefault=true && isActive=true` por org.** Enforced
  en `setDefault` (atómica: pone ésta true, todas las demás false) y en
  `update` si se toca `isActive` sobre la default.
- **Auto-default en la primera empresa.** Al crear la primera empresa
  activa de una org, `isDefault=true` automáticamente. Las siguientes
  entran con `isDefault=false`.
- **No se puede desactivar ni borrar la default.** Las mutations `update`
  (con `isActive=false`) y `remove` sobre la default throws con mensaje
  "Marca otra empresa como default primero".
- **Email obligatorio.** Valida formato estándar.
- **Código postal válido.** 5 dígitos.

### Referencias al borrar (hard-delete)

Hard-delete de una empresa valida 0 referencias en:

| Tabla | Campo | Estado en schema actual |
|---|---|---|
| `emailLog` | `issuingCompanyId` | ✅ existe (línea 401) |
| `servicesIssuingCompanyMap` | `issuingCompanyId` | ✅ existe |
| `clientIssuingCompanyOverride` | `issuingCompanyId` | ✅ existe |
| `quotations` | `issuingCompanyId` | ⏳ pendiente (sección 3) |
| `contracts` | `issuingCompanyId` | ⏳ pendiente (sección 3) |
| `deliverables` | `issuingCompanyId` | ⏳ pendiente (sección 3) |
| `deliverableTemplates` | `issuingCompanyId` | ⏳ pendiente (sección 4) |

Los checks sobre campos pendientes se escriben con un flag `if
(schemaSupports(table, field))` que se comentará como TODO y se habilitará
cuando esas secciones agreguen los campos. La alternativa de fallar hasta
que las secciones 3/4 completen no es aceptable — Section 2 debe ser
deployable sola.

## 2.3 Backend

Directorio: `convex/functions/issuingCompanies/`.

### `queries.ts`

Todas filtradas por `orgId` del JWT.

```ts
list(args: { includeInactive?: boolean }) 
  // Admin + Ejecutivo. 
  // Retorna: Array<IssuingCompany & { serviceCount: number; clientOverrideCount: number }>

getById(args: { id })
  // Admin + Ejecutivo. Valida orgId match, retorna null si mismatch.

listServiceMap(args: { issuingCompanyId })
  // Admin + Ejecutivo. 
  // Retorna: Array<{ serviceId, serviceName }> — servicios asignados a esta empresa.

listAvailableServices(args: { issuingCompanyId? })
  // Admin-only. Retorna servicios de la org que no están asignados a ninguna empresa.
  // Si issuingCompanyId presente: incluye también los asignados a esa empresa como preselected.
  // Shape: Array<{ serviceId, serviceName, assignedTo?: { issuingCompanyId, name } }>

getDefault()
  // Admin + Ejecutivo. Retorna la empresa con isDefault=true && isActive=true, o null.

countReferences(args: { id })
  // Admin-only. Retorna { emailLog: N, serviceMap: N, clientOverride: N, 
  //   quotations?: N, contracts?: N, deliverables?: N, templates?: N, total: N }
  // Usada por DeleteConfirmDialog para mostrar breakdown antes de borrar.
  // Campos opcionales corresponden a tablas cuyo issuingCompanyId aún no existe en schema.
```

### `mutations.ts` (todas `requireAdmin`)

```ts
create(args: FullIssuingCompanyFields)
  // Valida RFC formato + unicidad por org.
  // Si es la primera empresa activa de la org (query indexada), isDefault=true.
  // Sino, isDefault=false.
  // Inserta. Retorna el Id.

update(args: { id, ...optionalFields })
  // Valida ownership (orgId). Rechaza si se incluye isDefault (usar setDefault).
  // Si args.isActive === false y doc.isDefault === true → throws.
  // Normaliza RFC a upper si viene.
  // Patch con updatedAt = Date.now().

setDefault(args: { id })
  // Valida ownership + isActive=true.
  // Query by_orgId_isDefault para encontrar la actual default, patch a false.
  // Patch la nueva a true.
  // (Atómico vía Convex mutation semantics.)

remove(args: { id })
  // Valida ownership + !isDefault.
  // Cuenta referencias en las tablas listadas en 2.2 (sólo las que existen hoy).
  // Si count > 0 → throws con el detalle ("Tiene N emails, M asignaciones; desactívala en lugar de borrar").
  // Si count = 0 → db.delete.

assignServicesToCompany(args: { issuingCompanyId: Id<"issuingCompanies">; serviceIds: Array<Id<"services">> })
  // Valida ownership + que todos los serviceIds pertenecen a la org.
  // Borra todos los mappings existentes con este issuingCompanyId.
  // Si algún serviceId ya está asignado a OTRA empresa, borra ese mapping también (single-assignment).
  // Inserta uno nuevo por cada serviceId con este issuingCompanyId.

setLogoFromStorage(args: { id, storageId: Id<"_storage"> })
  // requireAdmin + ownership. Si doc ya tiene logoStorageId anterior, 
  // lo borra via ctx.storage.delete() antes de patch con el nuevo.
  // Patch con nuevo logoStorageId + updatedAt.
  // Se expone como mutation (no action) porque ctx.storage.delete() 
  // está disponible en mutation context.

removeLogo(args: { id })
  // ctx.storage.delete(logoStorageId), patch doc con logoStorageId: undefined.
```

### `actions.ts`

```ts
generateUploadUrl()
  // requireAdmin. Retorna signed URL via ctx.storage.generateUploadUrl().
  // Es action porque generateUploadUrl solo existe en action context.
```

Flow de upload: cliente llama `generateUploadUrl` (action) → POST directo
al signed URL con el archivo → recibe un `storageId` → llama
`setLogoFromStorage` (mutation) para persistirlo. Patrón equivalente al
de `orgBranding`.

### `resolve.ts`

```ts
export class NoIssuingCompanyError extends Error {
  constructor(orgId: string) {
    super(`No hay empresa emitente disponible para org ${orgId}`);
    this.name = "NoIssuingCompanyError";
  }
}

// Pure TS helper: consumible directamente desde queries/mutations
export async function resolveIssuingCompany(
  ctx: GenericQueryCtx<DataModel>,  // también acepta MutationCtx (extiende QueryCtx)
  args: { orgId: string; clientId: Id<"clients">; serviceId: Id<"services"> }
): Promise<{ 
  issuingCompany: Doc<"issuingCompanies">;
  source: "client_override" | "service_map" | "org_default";
}> {
  // 1. clientIssuingCompanyOverride
  //    query by_orgId_client_service → si hit, get issuingCompany → 
  //    si isActive=true, retornar {..., source: "client_override"}. Si isActive=false, degradar.
  // 2. servicesIssuingCompanyMap
  //    query by_orgId_serviceId → si hit, get issuingCompany → idem.
  // 3. issuingCompanies con isDefault=true
  //    query by_orgId_isDefault → filter isActive=true in memory (Convex no combina
  //    boolean con otro campo en el mismo índice compuesto) → si hit, retornar.
  // 4. throw new NoIssuingCompanyError(args.orgId)
}

// Wrapper para consumo desde actions (section 3 lo necesitará)
export const resolveIssuingCompanyQuery = internalQuery({
  args: { orgId: v.string(), clientId: v.id("clients"), serviceId: v.id("services") },
  handler: async (ctx, args) => resolveIssuingCompany(ctx, args),
});
```

**Dos formas de consumo:**
- Desde queries/mutations: `import { resolveIssuingCompany } from "./resolve"` y llamar directo.
- Desde actions (section 3): `await ctx.runQuery(internal.issuingCompanies.resolve.resolveIssuingCompanyQuery, args)`.

## 2.4 UI

Ubicación: `src/app/(dashboard)/configuracion/empresas-emitentes/`.

### Rutas

```
/configuracion/                               → page.tsx (hub con cards; link a empresas-emitentes)
/configuracion/empresas-emitentes/            → page.tsx (listado)
/configuracion/empresas-emitentes/nueva       → nueva/page.tsx
/configuracion/empresas-emitentes/[id]        → [id]/page.tsx (detalle con tabs)
```

La página `/configuracion/page.tsx` actual se convierte en hub. Por ahora
sólo muestra card "Empresas Emitentes"; queda espacio para Branding,
Integraciones, SAT concepts, etc.

### Componentes

En `src/components/configuracion/empresas-emitentes/`:

- **`IssuingCompanyList.tsx`** — tabla con columnas: Nombre, RFC, Régimen,
  Default (badge), Activa (badge), Servicios asignados (count).
  Admin ve acciones "Editar", "Marcar default", "Desactivar", "Borrar".
  Ejecutivo sólo ve "Ver detalle".
  Búsqueda por nombre/RFC, toggle mostrar inactivas.
  **Empty state** (0 empresas en la org): card con mensaje "No hay
  empresas emitentes configuradas" + CTA "Crear primera empresa" (sólo
  Admin; Ejecutivo ve el mensaje pero no el botón).

- **`IssuingCompanyForm.tsx`** — form compartido entre `/nueva` y
  `/[id]`. Sigue el patrón existente de `src/components/clients/client-form.tsx`:
  estado local con `useState<{...form}>()`, errores como
  `useState<Record<string, string>>()`, validación manual en `handleSubmit`,
  errores inline (`<p className="text-xs text-destructive">`), banner de
  error de submit arriba del form. Secciones agrupadas visualmente (no
  colapsables por simplicidad):
  1. Datos fiscales (name, legalName, rfc, regimenFiscal*, codigoPostal) — todos requeridos.
  2. Dirección (address.*) — street/city/state/country requeridos; ext/int/colonia opcionales.
  3. Contacto — email requerido; phone, website opcionales.
  4. Datos bancarios — bankName, bankAccount, clabe, currency (todos opcionales).
  5. Emisión y firma — invoiceSerie, signatoryName, signatoryTitle (todos opcionales).
  6. Logo — con `LogoUploader`.

- **`IssuingCompanyDetailTabs.tsx`** — tabs en `/[id]`:
  "Información" (form) | "Servicios que emite" | "Zona de peligro".

- **`ServicesAssignmentEditor.tsx`** — tab "Servicios que emite".
  Lista de servicios con checkboxes. Para servicios ya asignados a otra
  empresa, muestra etiqueta "Actualmente en DESC Holding — se moverá aquí
  si marcas". Botón "Guardar" llama `assignServicesToCompany`.
  Read-only para Ejecutivo.

- **`DangerZone.tsx`** — tab "Zona de peligro" (sólo Admin).
  - Toggle isActive (con guard de isDefault — botón deshabilitado con tooltip si default).
  - Botón "Borrar permanentemente" → abre `DeleteConfirmDialog`.

- **`DeleteConfirmDialog.tsx`** — modal de confirmación. Al abrir, llama
  una query que cuenta referencias. Si >0, muestra breakdown ("Esta
  empresa tiene 3 mapings de servicio, 2 overrides por cliente, 12 emails
  enviados. No puede borrarse; desactívala en su lugar.") y deshabilita el
  botón de confirmar. Si =0, pide escribir el nombre de la empresa para
  confirmar.

- **`SetDefaultDialog.tsx`** — modal de confirmación al marcar default.
  Muestra "Esto reemplaza '<empresa actual>' como default. Las nuevas
  cotizaciones sin asignación explícita se emitirán desde '<nueva>' en
  adelante."

- **`LogoUploader.tsx`** — dropzone + preview. Copia del patrón de
  `orgBranding`. Validaciones cliente: tamaño máx 2 MB, tipos
  image/png, image/jpeg, image/svg+xml.

### Navegación

- Sidebar: agregar link "Configuración" si no existe. Ícono `Settings`
  (lucide). Sublinks sólo en la página de configuración, no en el
  sidebar principal.
- Breadcrumb: `Configuración > Empresas Emitentes > <nombre>`.

### Feedback de UI y errores

- No hay librería de toasts instalada. Feedback se da vía:
  - **Errores de validación:** inline bajo el campo (`text-destructive`), como en `client-form.tsx`.
  - **Errores de submit (backend):** banner rojo arriba del form con el
    mensaje devuelto por la mutation.
  - **Éxito:** redirect con `router.push()` a la página de detalle o listado.
  - **Acciones destructivas (borrar, marcar default):** confirmación en
    modal antes de ejecutar.
- Errores de campo específico devueltos por la mutation (ej. RFC
  duplicado) se parsean del mensaje y se pintan bajo el campo
  correspondiente.

## 2.5 Seed dummy

Archivo: `convex/functions/seed/v2Fixtures.ts`.

```ts
export const v2Fixtures = internalMutation({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    // Guard 1: solo dev/staging. En production bail inmediato.
    if (process.env.NODE_ENV === "production") {
      throw new Error("v2Fixtures no corre en producción");
    }
    // Prerequisitos: existen servicios "Contable" y "Legal" y cliente "ACME" en esta org.
    // Si no, throws con mensaje "Ejecuta seedClients y seedServices primero".
    
    // Idempotencia: borrar issuingCompanies de esta org + sus service maps + overrides antes de insertar.
    
    // Crear empresas A (DESC Holding, isDefault=true) y B (DESC Contable) per 4.8.
    // Crear service map: Contable → B, Legal → B.
    // Crear override: (ACME, Contable) → A.
    // Si hay archivos seed de logo en algún path conocido, subirlos a _storage y asignar.
    //   Si no, dejar logoStorageId undefined.
  }
});
```

**Protección de ejecución:** se define como `internalMutation` — no es
invocable desde el cliente ni vía `useMutation` (Convex la excluye del
`api` público). La única forma de correrla es:

- `npx convex run seed:v2Fixtures '{"orgId":"..."}'` desde CLI (requiere
  credenciales de deployment, equivalente a acceso admin del proyecto).
- Desde otra mutation/action interna del mismo deployment.

No se puede llamar "por accidente" desde UI. El check `NODE_ENV` es la
segunda barrera (por si alguien corre CLI contra producción). El `orgId`
se pasa como argumento explícito — si se pasa una org real por error,
el check de prerequisitos falla (no hay cliente "ACME" en orgs reales)
antes de mutar nada.

### Prerequisitos explícitos

El seed hace bail temprano si no encuentra:
- Org con `orgId` pasado.
- Servicios con `name` "Contable" y "Legal" en la org.
- Cliente con `name` "ACME" en la org.

Estos deben existir antes. Si no, el error es claro ("Falta cliente ACME;
ejecuta seedClients primero").

## 2.6 Error handling (consolidado)

| Fuente | Error | Dónde | UI behavior |
|---|---|---|---|
| `create` | RFC duplicado | mutation | Error bajo campo RFC. |
| `create`/`update` | RFC formato inválido | Zod cliente + mutation (defense in depth) | Error bajo campo RFC. |
| `update` | Intento de tocar `isDefault` | mutation | 400. UI no expone (botón separado). |
| `update` | Desactivar la default | mutation | Banner de error arriba del form: "Marca otra como default primero." |
| `remove` | Borrar la default | mutation | Botón deshabilitado con tooltip. |
| `remove` | Borrar con referencias >0 | mutation + query de count | Dialog muestra breakdown y bloquea confirmar. |
| `setDefault` | Marcar inactiva como default | mutation | Banner de error en el modal de confirmación: "Reactívala primero." |
| `assignServicesToCompany` | serviceId de otra org | mutation | 403 (no debería ocurrir desde UI). |
| Upload logo | >2MB o tipo no imagen | cliente + action | Mensaje inline bajo el uploader: "Archivo inválido." |
| `resolveIssuingCompany` | Ninguna fuente matchea | resolver | Throws `NoIssuingCompanyError` — consumers (secciones 3/4) lo capturan. |
| Auth | Ejecutivo intenta mutation | `requireAdmin` | 403. UI esconde el botón previamente. |

## 2.7 Testing

Alineado con la pirámide 70/25/5 de sección 7 del sprint.

### Unit (Vitest)

`convex/functions/issuingCompanies/__tests__/`:

- **`rfcValidator.test.ts`** — helper puro.
  - Persona moral válido, persona física válido, normalización a upper,
    caracteres inválidos, longitud equivocada.

- **`resolveIssuingCompany.test.ts`** — resolver con DB in-memory
  (convex-test).
  - a. Override presente → `source="client_override"`.
  - b. Sin override, con service map → `source="service_map"`.
  - c. Sin override ni map → `source="org_default"`.
  - d. Sin ninguna empresa activa → throws `NoIssuingCompanyError`.
  - e. Override apunta a inactiva → degrada a service_map.
  - f. Service map apunta a inactiva → degrada a default.
  - g. Default inactiva sin otras opciones → throws.

### Integration (convex-test)

`convex/functions/issuingCompanies/__tests__/`:

- **`mutations.test.ts`**
  - Primera empresa activa → `isDefault=true` automático.
  - Segunda empresa → `isDefault=false`.
  - RFC duplicado misma org → throws; OTRA org → OK.
  - `setDefault` atómico: nueva true, anterior false.
  - `setDefault` sobre inactiva → throws.
  - `update({isActive: false})` sobre default → throws.
  - `remove` sobre default → throws.
  - `remove` con referencias → throws con count.
  - `remove` sin referencias → elimina.
  - `assignServicesToCompany` mueve un servicio de empresa A a B (single-assignment).

- **`queries.test.ts`**
  - `list` no cruza orgs.
  - `list({includeInactive: false})` filtra inactivas.
  - `getById` retorna null para id de otra org.
  - `listAvailableServices` respeta el parámetro opcional.

- **`permissions.test.ts`**
  - `org:member` ejecuta `list`/`getById`/`listServiceMap`/`getDefault` → OK.
  - `org:member` ejecuta `listAvailableServices` → 403 (admin-only).
  - `org:member` ejecuta cualquier mutation o action → 403.
  - `org:admin` ejecuta cualquier operación en su org → OK.
  - `org:admin` ejecuta operación con id de OTRA org → 403/null per op.

### E2E (Playwright)

No hay smoke test dedicado en este spec. El flujo E2E que ejercita
empresas emitentes (crear empresa → enviar cotización con branding
correcto) se cubre desde sección 3.

### Target

+15 tests sobre la baseline actual de 61. Cierra parcialmente el gap al
target de sección 7 (90 tests).

## 2.8 Out of scope (explícito)

1. CRUD de `clientIssuingCompanyOverride` — tabla consultada por el
   resolver; no se expone UI/mutations públicas en este spec. Feature
   futura.
2. Branding cromático por empresa — campos `primaryColor`, `fontFamily`,
   etc. se defieren per 4.5. El render mezcla `orgBranding` + datos
   fiscales de la empresa.
3. Banner/link de onboarding cuando `NoIssuingCompanyError` dispara — el
   error vive aquí; su UI vive en sección 3.
4. Catálogo SAT completo para `regimenFiscalCode` — se valida contra una
   lista corta (601, 603, 612, 626). Catálogo completo es sprint futuro.
5. Editor WYSIWYG de cualquier tipo — los forms son React Hook Form
   estándar.
6. Historial de cambios de empresas (audit log) — el único campo
   trackeado es `updatedAt`.
7. Import/export bulk (CSV de empresas) — se defiere.
8. Permisos granulares por campo (ej. "solo el CFO puede editar datos
   bancarios") — cualquier Admin edita cualquier campo.

## 2.9 Riesgos y tradeoffs

### Guard de hard-delete con campos pendientes

El check de referencias sobre `quotations.issuingCompanyId`,
`contracts.issuingCompanyId`, `deliverables.issuingCompanyId`,
`deliverableTemplates.issuingCompanyId` depende de que secciones 3 y 4
agreguen esos campos. Hoy no existen. La mitigación es:

- El guard se escribe con un flag TODO explícito que comenta esos
  checks.
- Cuando secciones 3/4 agreguen los campos, descomentar es un one-line
  change.
- El riesgo es: si alguien borra una empresa durante el periodo entre el
  deploy de sección 2 y el de sección 3, y ya hubo cotizaciones
  creadas, se pierde la trazabilidad.
- Mitigación adicional: durante el sprint sólo el super admin / desarrollo
  tocan este panel, y no hay cotizaciones reales aún.

### Single-assignment de servicios a empresas

`assignServicesToCompany` asume que cada servicio pertenece a una sola
empresa emisora. Si una org quiere que un servicio pueda ser emitido por
varias empresas (con override por cliente eligiendo cuál), el modelo
debería ser many-to-many. Decisión del sprint: single-assignment es
suficiente (el caso de "varias emitoras para el mismo servicio" se
resuelve con `clientIssuingCompanyOverride`). No se descarta cambiar a
many-to-many post-sprint si aparece un caso de uso.

### Performance

3 queries por resolución (`clientOverride`, `serviceMap`, `default`).
Llamada una vez por cada cotización/contrato/entregable generado (no en
cada render). Con ~50 clientes × ~10 entregables/mes = 500
resoluciones/mes. Negligible. No se agrega cache.

### Drift entre dummy seed y producción

El seed es idempotente (borra antes de insertar). Si alguien corre el
seed contra una org real por accidente (bypass del NODE_ENV check),
borra sus empresas reales. Mitigaciones (defense in depth):

- `internalMutation` — no invocable desde cliente ni UI.
- Check explícito `process.env.NODE_ENV !== "production"` al inicio.
- Check de prerequisitos: si no existe cliente "ACME" ni servicios
  "Contable"/"Legal" en la org, bail antes de mutar nada. En orgs reales
  esto falla naturalmente.
- El seed toma `orgId` como arg (no lo hardcodea) para que pase explícito
  cuando se ejecute.

## 2.10 Dependencias y qué desbloquea

### Depends on

- Nada. Section 2 se construye sobre el schema actual sin cambios.

### Unblocks

- **Sección 3** — pipeline cotización→contrato necesita
  `resolveIssuingCompany()` para materializar qué empresa factura
  cada cotización.
- **Sección 4** — templates por empresa necesita el selector de
  `issuingCompany` en `/settings/templates` (dependencia explícita
  mencionada en 4.10).
- Eventual CRUD de `clientIssuingCompanyOverride` — reusa el pattern
  de este spec.
