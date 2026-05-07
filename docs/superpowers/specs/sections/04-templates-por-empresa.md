---
section: 4
title: Templates por empresa
created: 2026-04-22
status: draft
sprint: projex-v2-15may
---

# 4. Templates por empresa

Las secciones 1-3 definieron el schema multi-entity (`issuingCompanies`,
`servicesIssuingCompanyMap`, `clientIssuingCompanyOverride`), el CRUD de
empresas facturadoras y el pipeline cotizacion -> contrato end-to-end con
Resend + MiFiel. Esta seccion cierra el gap de **resolucion de templates**:
cuando una organizacion factura el mismo servicio desde N personas morales,
cada entrega (cotizacion, contrato, entregable, cuestionario) debe
renderearse con el HTML, branding y datos fiscales correctos para la
empresa que factura ese servicio a ese cliente en ese momento.

## 4.1 Modelo de datos

### Decision

Se agrega `issuingCompanyId?: Id<"issuingCompanies">` a
`deliverableTemplates`. El campo es **opcional** para preservar la capa de
templates seed globales (`orgId=null`, `issuingCompanyId=null`) y permitir
que una org use un template unico para todas sus empresas mientras no
necesite divergir.

Tambien se agrega `"issuing"` al union `variables[].source` para que el
pipeline de resolucion de variables (ver 4.4) sepa explicitamente que una
variable se resuelve desde `issuingCompanies`.

### Diff concreto sobre `convex/schema.ts` (lineas 278-312)

```diff
   deliverableTemplates: defineTable({
     orgId: v.optional(v.string()),
+    issuingCompanyId: v.optional(v.id("issuingCompanies")),
     serviceId: v.optional(v.id("services")),
     serviceName: v.string(),
     type: v.union(
       v.literal("quotation"),
       v.literal("contract"),
       v.literal("deliverable_short"),
       v.literal("deliverable_long"),
       v.literal("questionnaire")
     ),
     name: v.string(),
     htmlTemplate: v.string(),
     variables: v.array(
       v.object({
         key: v.string(),
         label: v.string(),
         source: v.union(
           v.literal("client"),
           v.literal("projection"),
           v.literal("service"),
           v.literal("ai"),
-          v.literal("manual")
+          v.literal("manual"),
+          v.literal("issuing")
         ),
         required: v.boolean(),
       })
     ),
     version: v.number(),
     isActive: v.boolean(),
     createdAt: v.number(),
     updatedAt: v.number(),
   })
     .index("by_orgId", ["orgId"])
     .index("by_serviceId", ["serviceId"])
-    .index("by_type", ["type"]),
+    .index("by_type", ["type"])
+    .index("by_orgId_issuing_service_type", [
+      "orgId",
+      "issuingCompanyId",
+      "serviceId",
+      "type",
+    ])
+    .index("by_orgId_issuing_type", ["orgId", "issuingCompanyId", "type"])
+    .index("by_orgId_service_type", ["orgId", "serviceId", "type"]),
```

Justificacion:

- `issuingCompanyId` opcional preserva backwards compatibility con los 20
  templates seed (ver 4.6) y con orgs single-entity.
- Los 3 indices nuevos soportan directamente la cadena de fallbacks de 4.2.
  Cada paso del lookup es una query indexada O(log n), no un scan.
- No se agrega `issuingCompanyName` denormalizado: la vista UI puede hacer
  join via `issuingCompanies.get(issuingCompanyId)`; denormalizar aqui
  genera drift si la empresa cambia de razon social.

## 4.2 Orden de resolucion del template

Dado un trigger `(orgId, clientId, serviceId, type)` (p.ej. generar una
cotizacion), la funcion `resolveTemplate()` ejecuta esta cadena, parando en
el primer hit activo:

| # | Scope                                                      | Query                                                                                             |
|---|------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1 | Override especifico empresa + servicio                     | `(orgId, issuingCompanyId, serviceId, type, isActive=true)` -> `by_orgId_issuing_service_type`    |
| 2 | Generico de la empresa (cualquier servicio)                | `(orgId, issuingCompanyId, type, isActive=true)` con `serviceId=undefined` -> `by_orgId_issuing_type` |
| 3 | Override de la org por servicio (sin empresa)              | `(orgId, serviceId, type, isActive=true)` con `issuingCompanyId=undefined` -> `by_orgId_service_type` |
| 4 | Override generico de la org                                | `(orgId, type, isActive=true)` sin service ni empresa                                             |
| 5 | Seed global por servicio                                   | `(orgId=null, serviceId, type, isActive=true)`                                                    |
| 6 | Seed global generico                                       | `(orgId=null, type, isActive=true)` sin service                                                   |

Criterio de desempate dentro de un mismo nivel: `version DESC`, luego
`updatedAt DESC`. Si ningun nivel matchea, la funcion lanza
`TemplateNotFoundError(orgId, issuingCompanyId, serviceId, type)` y el
caller degrada: cotizacion bloquea el send, entregable marca
`auditStatus="rejected"` con feedback "template ausente".

Todos los niveles tienen que filtrar `isActive=true` client-side tras el
lookup (Convex no permite compuesto con boolean en todos los indices
propuestos). Costo extra: in-memory filter sobre <=5 resultados por nivel.

### Firma

```ts
// convex/functions/deliverableTemplates/resolve.ts
export async function resolveTemplate(
  ctx: QueryCtx,
  args: {
    orgId: string;
    issuingCompanyId: Id<"issuingCompanies">;
    serviceId: Id<"services">;
    type: "quotation" | "contract" | "deliverable_short"
        | "deliverable_long" | "questionnaire";
  }
): Promise<Doc<"deliverableTemplates">>
```

## 4.3 Resolucion del `issuingCompanyId`

Vive en `convex/functions/issuingCompanies/resolve.ts`. Es la pieza que
decide **que empresa factura** antes de llamar a `resolveTemplate()`.

### Precedencia

1. `clientIssuingCompanyOverride` por `(orgId, clientId, serviceId)` -> si
   existe, manda siempre.
2. `servicesIssuingCompanyMap` por `(orgId, serviceId)` -> default del
   servicio a nivel org.
3. `issuingCompanies.isDefault=true` para esa `orgId` -> fallback global.
4. Si no hay ninguna empresa `isActive=true`, lanza
   `NoIssuingCompanyError(orgId)`.

### Firma

```ts
// convex/functions/issuingCompanies/resolve.ts
export async function resolveIssuingCompany(
  ctx: QueryCtx,
  args: {
    orgId: string;
    clientId: Id<"clients">;
    serviceId: Id<"services">;
  }
): Promise<{
  issuingCompany: Doc<"issuingCompanies">;
  source: "client_override" | "service_map" | "org_default";
}>
```

El campo `source` se loggea en `emailLog` (via el `issuingCompanyId` que
ya existe en esa tabla) y en `deliverables.aiLog` para trazabilidad
forense ("por que esta cotizacion salio con la razon social X").

### Invariante

`resolveIssuingCompany` se ejecuta **una sola vez** al momento de
materializar la entrega (crear `quotation`, `contract` o `deliverable`).
El `issuingCompanyId` se persiste en el documento resultante (propuesta:
agregar campo `issuingCompanyId` a `quotations`, `contracts`,
`deliverables` — ver 4.10, dependencia con Seccion 3). Esto evita que un
cambio en el override o en el map reescriba retroactivamente el
historial.

## 4.4 Variables de empresa facturadora

Todos los templates pueden consumir estas variables via el motor de
rendering existente (commits `dfec8cd` y `a80925d`). El pipeline agrega
un nuevo resolver `resolveIssuingVars(issuingCompany)` en paralelo a los
de `client`, `projection`, `service`, `ai`, `manual`.

| Variable                              | Source    | Campo en `issuingCompanies`                            | Notas                                                          |
|---------------------------------------|-----------|--------------------------------------------------------|----------------------------------------------------------------|
| `{{issuing.name}}`                    | issuing   | `name`                                                 | Nombre comercial                                               |
| `{{issuing.legalName}}`               | issuing   | `legalName`                                            | Razon social SAT                                               |
| `{{issuing.rfc}}`                     | issuing   | `rfc`                                                  |                                                                |
| `{{issuing.regimenFiscalCode}}`       | issuing   | `regimenFiscalCode`                                    |                                                                |
| `{{issuing.regimenFiscalLabel}}`      | issuing   | `regimenFiscalLabel`                                   | Opcional; fallback: lookup en tabla SAT                        |
| `{{issuing.codigoPostal}}`            | issuing   | `codigoPostal`                                         |                                                                |
| `{{issuing.address.street}}`          | issuing   | `address.street`                                       |                                                                |
| `{{issuing.address.exteriorNumber}}`  | issuing   | `address.exteriorNumber`                               | Opcional                                                       |
| `{{issuing.address.interiorNumber}}`  | issuing   | `address.interiorNumber`                               | Opcional                                                       |
| `{{issuing.address.colonia}}`         | issuing   | `address.colonia`                                      | Opcional                                                       |
| `{{issuing.address.city}}`            | issuing   | `address.city`                                         |                                                                |
| `{{issuing.address.state}}`           | issuing   | `address.state`                                        |                                                                |
| `{{issuing.address.country}}`         | issuing   | `address.country`                                      |                                                                |
| `{{issuing.addressFormatted}}`        | issuing   | derived                                                | Helper: concatena calle, num ext/int, colonia, CP, ciudad      |
| `{{issuing.email}}`                   | issuing   | `email`                                                |                                                                |
| `{{issuing.phone}}`                   | issuing   | `phone`                                                | Opcional                                                       |
| `{{issuing.website}}`                 | issuing   | `website`                                              | Opcional                                                       |
| `{{issuing.bankName}}`                | issuing   | `bankName`                                             | Opcional                                                       |
| `{{issuing.bankAccount}}`             | issuing   | `bankAccount`                                          | Opcional                                                       |
| `{{issuing.clabe}}`                   | issuing   | `clabe`                                                | Opcional                                                       |
| `{{issuing.currency}}`                | issuing   | `currency`                                             | Default MXN                                                    |
| `{{issuing.invoiceSerie}}`            | issuing   | `invoiceSerie`                                         | Opcional                                                       |
| `{{issuing.logoUrl}}`                 | issuing   | derived(`logoStorageId`)                               | Resuelto via `ctx.storage.getUrl(logoStorageId)`               |
| `{{issuing.signatoryName}}`           | issuing   | `signatoryName`                                        | Opcional                                                       |
| `{{issuing.signatoryTitle}}`          | issuing   | `signatoryTitle`                                       | Opcional                                                       |

### Reglas

- Campos opcionales ausentes renderean string vacio, **no** `undefined`
  ni `null`, para no contaminar el PDF.
- `logoUrl` se resuelve dentro de una action (no query) porque
  `ctx.storage.getUrl` solo existe en action/mutation. Los callers de
  rendering (quotation/contract/deliverable) ya son actions (Puppeteer).
- Variables declaradas como `required: true` en `variables[]` y con
  source `issuing` que esten ausentes hacen fallar el render con
  `MissingRequiredVariableError` antes de llamar a Puppeteer.

## 4.5 Branding hibrido

**Recomendacion: opcion (a)** — cada empresa facturadora define su propio
branding minimo (logo, razon social, datos fiscales), y la organizacion
conserva el branding corporativo (colores, tipografia) como default.

### Justificacion

Los ~50 clientes desk de mayo se reparten entre 2-3 personas morales del
mismo grupo consultor. Un contrato emitido por "DESC Contable SC" con
logo de "DESC Holding" confunde legalmente al cliente firmante. El
bloqueo es concreto y bajo; el costo de implementar (a) es 1 campo ya
existente (`logoStorageId` en `issuingCompanies`).

### Que ya existe

- `issuingCompanies.logoStorageId` (linea 339).
- `issuingCompanies.legalName`, `rfc`, `regimenFiscal*`, `address`,
  `email`, `phone`, `website`.
- `issuingCompanies.signatoryName`, `signatoryTitle` para footers de
  contratos.

### Que falta (propuesta)

Para sprint v2 no se agregan campos nuevos a `issuingCompanies`. El
branding cromatico (colores, fuentes, accentColor) sigue viniendo de
`orgBranding` porque ninguna de las empresas del grupo quiere divergir en
paleta. Post-sprint, si aparece el caso, se agregan:

- `issuingCompanies.primaryColor?` (override de `orgBranding.primaryColor`)
- `issuingCompanies.secondaryColor?`
- `issuingCompanies.accentColor?`
- `issuingCompanies.fontFamily?`
- `issuingCompanies.footerText?`

### Regla de merge en el renderer

```
final = {
  ...orgBranding,                // colores, tipografia, header/footer org
  companyName: issuing.name,     // sobrescribe
  logoUrl:    issuing.logoUrl ?? orgBranding.logoUrl,
  legalFooter: issuing.signatory ? buildSignatureBlock(issuing)
                                 : orgBranding.footerText,
}
```

Las CSS vars inyectadas (commit `c317b83`) siguen viniendo de
`orgBranding`. Solo el bloque `<header>` (logo + razon social) y el
bloque `<footer legal>` cambian por empresa.

## 4.6 Migracion de los 20 templates seed

Los 20 templates cargados en el commit `2b0c14c` se tratan como **Nivel
5/6** del fallback chain (seeds globales). No requieren cambio de
contenido; solo backfill del campo nuevo.

### Script

Ubicacion: `convex/functions/migrations/backfillTemplateIssuingCompany.ts`

```ts
// Pseudocodigo
export const backfillTemplateIssuingCompany = internalMutation({
  handler: async (ctx) => {
    const all = await ctx.db.query("deliverableTemplates").collect();
    let updated = 0;
    for (const t of all) {
      if (t.issuingCompanyId === undefined) {
        // Explicito: marcar como "ninguna empresa especifica"
        await ctx.db.patch(t._id, { issuingCompanyId: undefined });
        updated++;
      }
    }
    return { total: all.length, updated };
  },
});
```

Como el campo ya es `v.optional(...)`, tecnicamente no necesitamos hacer
el patch (Convex acepta docs sin el campo). El script es idempotente y
se ejecuta una sola vez:

1. Deploy del schema con el campo agregado (4.1).
2. Ejecucion manual via `npx convex run migrations:backfillTemplateIssuingCompany`.
3. Verificacion: `SELECT count(*) WHERE issuingCompanyId IS NULL` via
   dashboard Convex; debe = 20.

No se migra el union `source` de `variables[]`: los 20 templates
actuales no usan `issuing.*` vars. Se volveran a cargar en un segundo
pase (`seedIssuingVariablesInSeedTemplates.ts`) que agrega bloques
`<header>` y `<footer>` con `{{issuing.*}}` en los HTML de cotizacion y
contrato seed. Ese pase es reversible: el seed script es
source-of-truth.

## 4.7 Estrategia de override por org

### Flow UX minimo (sprint v2)

1. **Listado**: en `/settings/templates`, filtros `issuingCompany` (multi)
   + `service` (multi) + `type` (tabs). La tabla muestra para cada
   combinacion qual template esta resolviendose hoy (ejecutando
   `resolveTemplate` en query) con badge que indica el nivel (1-6).
2. **Boton "Personalizar"** sobre una fila cuyo template resuelto tiene
   `orgId=null` (= seed global). Al click:
   - Se clona el doc con `orgId=currentOrg`,
     `issuingCompanyId=<la de la fila>`, `serviceId=<la de la fila>`,
     `type=<el de la fila>`, `version=1`, `isActive=true`.
   - El seed original (`orgId=null`) queda intacto.
   - Se abre editor HTML con diff vs seed.
3. **Edicion**: guardar crea `version+1` del mismo `(orgId,
   issuingCompanyId, serviceId, type)`. La resolucion toma la
   `version DESC` mas reciente con `isActive=true`. Desactivar una
   version es reversible.
4. **Revertir a seed**: boton "Usar seed global" desactiva
   (`isActive=false`) todas las versiones override de esa combinacion;
   la cadena de fallback cae naturalmente al nivel 5/6.

### No hay en sprint v2

- Editor WYSIWYG (se usa textarea con preview HTML).
- Diff visual entre versiones (se muestra diff de texto plano con
  `diff-match-patch`).
- Permisos granulares: cualquier admin de la org puede editar.

## 4.8 Data dummy para track bottom-up

Fixtures seed para `convex/functions/seed/v2Fixtures.ts` (solo se
ejecuta en `NODE_ENV !== "production"`):

### `issuingCompanies` (2 registros)

```ts
// A: default de la org
{
  orgId: "org_dummy_1",
  name: "DESC Holding",
  legalName: "DESC Holding S.A. de C.V.",
  rfc: "DHO200101ABC",
  regimenFiscalCode: "601",
  regimenFiscalLabel: "General de Ley Personas Morales",
  codigoPostal: "11550",
  address: { street: "Av. Reforma", exteriorNumber: "100",
             colonia: "Juarez", city: "CDMX",
             state: "CDMX", country: "Mexico" },
  email: "facturacion@desc-holding.mx",
  invoiceSerie: "DESC-A",
  logoStorageId: <seed storage id del logo principal>,
  signatoryName: "Christian Cover",
  signatoryTitle: "Director General",
  isDefault: true,
  isActive: true,
}
// B: empresa override usada por servicios Contable y Legal
{
  orgId: "org_dummy_1",
  name: "DESC Contable",
  legalName: "DESC Contable y Asociados S.C.",
  rfc: "DCA210315XYZ",
  regimenFiscalCode: "603",
  regimenFiscalLabel: "Personas Morales con Fines No Lucrativos",
  codigoPostal: "11000",
  address: { street: "Palmas", exteriorNumber: "50",
             colonia: "Lomas", city: "CDMX",
             state: "CDMX", country: "Mexico" },
  email: "facturacion@desc-contable.mx",
  invoiceSerie: "DCA-B",
  logoStorageId: <seed storage id logo contable>,
  signatoryName: "Christian Cover",
  signatoryTitle: "Socio Director",
  isDefault: false,
  isActive: true,
}
```

### `servicesIssuingCompanyMap`

```
(serviceId: Contable)  -> issuingCompanyId: B
(serviceId: Legal)     -> issuingCompanyId: B
// el resto cae en A via isDefault
```

### `clientIssuingCompanyOverride` (1 registro)

```
(clientId: ACME, serviceId: Contable) -> issuingCompanyId: A
// caso: ACME pidio explicitamente que Contable lo facture Holding
```

### `deliverableTemplates`

- 1 seed global cotizacion (`orgId=null`, `serviceId=Contable`,
  `type=quotation`) — nivel 5 — con `{{issuing.*}}` ya inyectadas.
- 1 override empresa+servicio (`orgId=org_dummy_1`,
  `issuingCompanyId=B`, `serviceId=Contable`, `type=quotation`,
  `version=1`) — nivel 1 — con clausula custom "DESC Contable y
  Asociados aplica descuento del X%".

### Caso de prueba manual esperado

- Cotizacion para cliente ACME, servicio Contable -> resuelve empresa A
  (via override), template nivel 5 (seed).
- Cotizacion para cliente BCME, servicio Contable -> resuelve empresa B
  (via service map), template nivel 1 (override B).
- Cotizacion para cliente ACME, servicio Marketing -> resuelve empresa A
  (isDefault), template nivel 5 (seed generico marketing).

## 4.9 Testing

Casos a cubrir (enumeracion, no implementacion):

1. `resolveIssuingCompany`
   - a. Override de cliente presente -> retorna empresa del override,
     `source="client_override"`.
   - b. Sin override, service map poblado -> retorna empresa del map,
     `source="service_map"`.
   - c. Sin override, sin map, con default -> retorna default,
     `source="org_default"`.
   - d. Sin empresas activas -> lanza `NoIssuingCompanyError`.
   - e. Empresa en el override esta `isActive=false` -> degrada al
     siguiente nivel (NO falla silenciosamente).

2. `resolveTemplate` — full fallback chain
   - a. Hit nivel 1 (override empresa+servicio).
   - b. Hit nivel 2 (generico empresa).
   - c. Hit nivel 3 (override servicio, sin empresa).
   - d. Hit nivel 5 (seed global por servicio).
   - e. Ningun hit -> `TemplateNotFoundError`.
   - f. Dos versiones activas en el mismo nivel -> gana `version DESC`.
   - g. Version mas nueva con `isActive=false` -> gana la anterior
     activa.

3. Rendering
   - a. Template con 15 `{{issuing.*}}` vars + cliente A -> PDF
     contiene datos de empresa A.
   - b. Mismo template + cliente con override empresa B -> PDF contiene
     datos de empresa B.
   - c. `{{issuing.logoUrl}}` apunta a storage correcto.
   - d. Variables opcionales ausentes renderean string vacio sin
     romper layout.
   - e. Variable marcada `required: true` ausente -> error antes de
     Puppeteer.

4. Branding hibrido
   - a. Colores CSS vars vienen de `orgBranding`.
   - b. Logo y razon social vienen de `issuingCompany` resuelta.
   - c. Footer legal usa `signatoryName/Title` de la empresa.

5. Migracion
   - a. Post-backfill, los 20 seed templates siguen teniendo
     `issuingCompanyId=undefined` y resuelven en nivel 5/6.

6. Override UX
   - a. Click "Personalizar" sobre seed crea clone correcto.
   - b. "Revertir a seed" desactiva overrides sin borrarlos.
   - c. Editar template override crea `version+1`, la vieja queda
     disponible.

## 4.10 Riesgos y tradeoffs

### Dependencias cruzadas

- **Seccion 3 (pipeline cotizacion->contrato)**: para que la cotizacion
  persista que empresa facturo, hay que agregar
  `issuingCompanyId: v.id("issuingCompanies")` a las tablas
  `quotations`, `contracts`, `deliverables` (propuesta en 4.3). Esto
  NO esta en el schema actual (lineas 158-239). **Bloqueante para la
  seccion 3** si quiere trazabilidad. Accion: coordinar con quien
  escriba seccion 3 para que ese diff se consolide en un solo bloque.
- **Seccion 2 (CRUD empresas facturadoras)**: la UI de 4.7
  (`/settings/templates`) depende de un selector de `issuingCompany`
  que ya debe existir en seccion 2.

### Post-launch

Se deja fuera del sprint v2:

1. **Versionado semantico**: `version` hoy es `number` incremental. Se
   queda asi; no hay semver ni rollback UI.
2. **Diff visual entre versiones**: solo diff de texto plano.
3. **Editor WYSIWYG por cliente final**: no se toca.
4. **Branding cromatico por empresa**: campos `primaryColor`,
   `fontFamily`, etc. en `issuingCompanies` se defieren a v3.
5. **A/B testing de templates**: no hay forma de partir trafico; la
   resolucion es deterministica.
6. **Template packs por industria**: se queda con un solo seed por
   servicio x tipo.
7. **Permisos granulares**: cualquier admin puede editar cualquier
   template de la org. No hay roles "editor" vs "aprobador".

### Riesgos activos

- **Drift entre seeds y overrides**: si un seed global gana una mejora
  (por ejemplo nueva clausula anti-fraude), las orgs con override NO la
  reciben automaticamente. Mitigacion sprint v2: notificacion en el
  editor "existe una nueva version del seed" + boton para re-clonar.
  Implementacion minima: comparar `updatedAt` del seed vs
  `createdAt` del override.
- **Performance del fallback**: 6 queries por render. Con ~50 clientes
  desk y <=10 entregables/mes/cliente = ~500 resoluciones/mes.
  Negligible. No se agrega cache en v2.
- **Seeds con `{{issuing.*}}` en orgs que todavia no configuraron
  empresa**: el render falla. Mitigacion: el onboarding de org v2
  obliga a crear al menos 1 `issuingCompany` con `isDefault=true`
  antes de habilitar envio de cotizaciones. Este guard vive en la
  seccion 2.
