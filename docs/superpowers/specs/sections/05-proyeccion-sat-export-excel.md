---
section: 5
title: Proyección con concepto SAT y export Excel
created: 2026-04-22
status: draft
sprint: projex-v2-15may
---

# Sección 5 — Proyección con concepto SAT y export Excel

## 5.0 Resumen

Esta sección define cómo la matriz de proyección anual (servicios × 12 meses) muestra el concepto SAT asociado a cada servicio, cómo se edita ese concepto, y cómo se exporta el plan anual a un archivo `.xlsx` listo para enviar al contador del cliente. Se apoya en la tabla `satConcepts` ya definida en el schema v2 y depende de `issuingCompanies` + `servicesIssuingCompanyMap` (sección 4) para la hoja de facturación.

**No objetivos del sprint 15-may:** emitir CFDI, timbrar con PAC, calcular retenciones o descargar XML SAT. Esto queda fuera de alcance (ver 5.10).

---

## 5.1 Asignación del concepto SAT a un servicio

**Decisión:** combinar **Opción A (default en `services`) + Opción B (override en `projectionServices`)**. Se descarta la Opción C (override por mes) para el 15-may.

### Justificación

- **A (default por servicio):** 90% de los casos un servicio siempre usa la misma clave SAT (Contabilidad → `84111500`). Guardarlo en `services` evita forzar al operador a pickear la clave cada vez que crea una proyección.
- **B (override por proyectionService):** cubre el 10% de casos donde un cliente específico requiere una clave distinta (ej. un cliente constructora que su servicio "Admin" lo factura bajo `72141000` en vez de `80161500`).
- **C (override por mes) se descarta:** agrega complejidad de UI (pickers en cada celda) y rara vez se necesita. En el MVP, si un mes puntual requiere clave distinta, el operador puede emitir el CFDI manualmente (recordar: la facturación real sigue fuera de Projex — ver 5.10).

### Resolución en runtime

Al generar la matriz o exportar Excel, el concepto SAT de un servicio en una proyección se resuelve así:

```
projectionService.satConceptId ?? service.defaultSatConceptId ?? null
```

Si ambos son `null`, la UI muestra badge rojo "Sin clave SAT" y el export Excel deja la celda vacía + lo reporta en la pestaña resumen (no bloquea el export — se prefiere entregar el archivo a que falle).

### Diffs al schema

```diff
# convex/schema.ts

services: defineTable({
  orgId: v.string(),
  name: v.string(),
  // ...campos existentes
+ defaultSatConceptId: v.optional(v.id("satConcepts")),
})
  .index("by_orgId", ["orgId"])
+ .index("by_defaultSatConceptId", ["defaultSatConceptId"]),

projectionServices: defineTable({
  orgId: v.string(),
  projectionId: v.id("projections"),
  serviceId: v.id("services"),
  // ...campos existentes
+ satConceptId: v.optional(v.id("satConcepts")),
})
  .index("by_projectionId", ["projectionId"])
+ .index("by_satConceptId", ["satConceptId"]),
```

No se agrega nada a `monthlyAssignments` (Opción C descartada).

---

## 5.2 UI del concepto SAT en la matriz de proyección

**Decisión:** **columna extra a la izquierda** (congelada) con `claveProdServ` como chip compacto + `description` truncada. Click abre popover de edición.

### Layout mínimo viable

Archivo probable: `src/app/projections/[id]/page.tsx` (o el componente que hoy renderiza la matriz, p.ej. `src/components/projections/ProjectionMatrix.tsx`).

Estructura de columnas (izquierda a derecha):

| Servicio | Clave SAT | Ene | Feb | ... | Dic | Total |
|----------|-----------|-----|-----|-----|-----|-------|

- **Col "Clave SAT":** width ~180px, celda = `<Badge>{claveProdServ}</Badge>` + texto truncado (`description` con `line-clamp-1`). Tooltip al hover muestra `description` completa + `claveUnidad`.
- **Click en la celda:** abre `Popover` con el picker (ver 5.3). Confirmar cambio dispara mutation `updateProjectionServiceSatConcept`.
- **Estado vacío:** si no hay concepto resuelto (ni default ni override), badge `destructive` con texto "Asignar" e ícono alerta.
- **Indicador de override:** si `projectionService.satConceptId != null && service.defaultSatConceptId`, mostrar pequeño ícono `↻` al lado del badge indicando "override" (tooltip: "Override del default del servicio").

### Se descartan para 15-may

- **Dropdown inline editable por celda mes:** alcance C, descartado.
- **Solo tooltip al hover sobre el nombre:** se descartó porque oculta información crítica (contadores escanean la matriz).

---

## 5.3 Picker de concepto SAT

**Componente:** `shadcn/ui` `Command` dentro de un `Popover` (patrón combobox estándar).

### UX

El picker tiene tres secciones visibles al abrir (sin escribir nada todavía):

1. **Sugeridos para este servicio** — conceptos cuyo `serviceIds` contiene el `serviceId` actual, o cuyos `tags` matchean tags del servicio.
2. **Más usados en tu org** — los 5 `satConcepts` con mayor uso histórico en `services.defaultSatConceptId` y `projectionServices.satConceptId` (orgId del usuario).
3. **Catálogo default** — el resto del seed con `orgId=null, isDefault=true`.

Al escribir en el input:

- Si el input matchea regex `/^\d{6,8}$/` → búsqueda exacta por `claveProdServ` (índice `by_claveProdServ`).
- Si no → búsqueda fuzzy por `description` (ilike/contains, case-insensitive). El seed es chico (~20 items) y el override por org rara vez supera 50, así que fuzzy client-side es suficiente en v2.

### Query Convex

```ts
// convex/functions/satConcepts.ts
export const searchSatConcepts = query({
  args: {
    serviceId: v.optional(v.id("services")),
    search: v.optional(v.string()),
    limit: v.optional(v.number()), // default 25
  },
  handler: async (ctx, { serviceId, search, limit = 25 }) => {
    const orgId = await requireOrgId(ctx);
    // Trae seed global (orgId=null) + catálogo de la org
    const global = await ctx.db.query("satConcepts")
      .withIndex("by_orgId", q => q.eq("orgId", undefined))
      .filter(q => q.eq(q.field("isActive"), true))
      .collect();
    const orgScoped = await ctx.db.query("satConcepts")
      .withIndex("by_orgId_active", q => q.eq("orgId", orgId).eq("isActive", true))
      .collect();
    let results = [...orgScoped, ...global];
    if (serviceId) {
      results.sort((a, b) => {
        const aMatch = a.serviceIds?.includes(serviceId) ? 1 : 0;
        const bMatch = b.serviceIds?.includes(serviceId) ? 1 : 0;
        return bMatch - aMatch;
      });
    }
    if (search) {
      const s = search.toLowerCase();
      results = results.filter(r =>
        r.claveProdServ.startsWith(search) ||
        r.description.toLowerCase().includes(s)
      );
    }
    return results.slice(0, limit);
  },
});
```

**Paginación:** no se requiere en v2 (catálogo <200 elementos por org). Si el catálogo custom crece >500, agregar cursor-based pagination.

---

## 5.4 IVA y `objetoImp` en la matriz

**Decisión para 15-may:** la matriz muestra **solo el subtotal** (monto sin IVA). NO se calcula ni se muestra IVA desglosado por celda.

### Justificación

- Los montos en `monthlyAssignments.amount` hoy ya son subtotales (sin IVA). Agregar una segunda fila "con IVA" duplica la tabla y complica el export.
- El IVA efectivo se calcula al facturar (responsabilidad del contador o del PAC), no al proyectar.
- El campo `objetoImp` del concepto SAT se guarda y **solo se muestra en el export Excel** (columna auxiliar en la hoja "Facturación"), no en la matriz UI.

### Lo único que muestra la UI sobre IVA

- En el popover del picker, junto al concepto seleccionado, mostrar badge "IVA 16%" si `objetoImp == "02"`, "Sin IVA" si `"01"`, o "Sin desglose" si `"04"`. Informativo, no edita montos.
- En el resumen anual (una card arriba de la matriz) mostrar: "Subtotal anual: $X". **No** "Total con IVA" todavía.

**Fuera de alcance 15-may:** retención ISR, retención IVA, tasas distintas a 16%, exento vs tasa 0. La sección 5.10 lo declara explícito.

---

## 5.5 Seed del catálogo SAT inicial

**Ubicación:** `convex/functions/migrations/seedSatConcepts.ts` (mutation idempotente, corrida una sola vez por `npx convex run migrations/seedSatConcepts`).

### Estructura

```ts
// convex/functions/migrations/seedSatConcepts.ts
export const seedSatConcepts = internalMutation({
  handler: async (ctx) => {
    const SEED = [
      { claveProdServ: "84111500", description: "Servicios contables",
        claveUnidad: "E48", unidadLabel: "Servicio", objetoImp: "02",
        tags: ["contable", "contabilidad"] },
      { claveProdServ: "84111501", description: "Servicios de teneduría de libros",
        claveUnidad: "E48", unidadLabel: "Servicio", objetoImp: "02",
        tags: ["contable"] },
      { claveProdServ: "80121600", description: "Servicios jurídicos",
        claveUnidad: "E48", unidadLabel: "Servicio", objetoImp: "02",
        tags: ["legal"] },
      { claveProdServ: "80121700", description: "Servicios de asesoría jurídica",
        claveUnidad: "E48", unidadLabel: "Servicio", objetoImp: "02",
        tags: ["legal"] },
      { claveProdServ: "81112200", description: "Servicios de mantenimiento y soporte de software",
        claveUnidad: "E48", unidadLabel: "Servicio", objetoImp: "02",
        tags: ["ti", "software"] },
      { claveProdServ: "81111800", description: "Servicios de sistemas informáticos",
        claveUnidad: "E48", unidadLabel: "Servicio", objetoImp: "02",
        tags: ["ti"] },
      { claveProdServ: "82101600", description: "Servicios de mercadotecnia",
        claveUnidad: "E48", unidadLabel: "Servicio", objetoImp: "02",
        tags: ["marketing"] },
      { claveProdServ: "82101500", description: "Servicios de publicidad",
        claveUnidad: "E48", unidadLabel: "Servicio", objetoImp: "02",
        tags: ["marketing"] },
      { claveProdServ: "80111600", description: "Servicios de personal temporal",
        claveUnidad: "E48", unidadLabel: "Servicio", objetoImp: "02",
        tags: ["rh", "recursos humanos"] },
      { claveProdServ: "80111500", description: "Servicios de recursos humanos",
        claveUnidad: "E48", unidadLabel: "Servicio", objetoImp: "02",
        tags: ["rh"] },
      { claveProdServ: "80161500", description: "Servicios de apoyo administrativo",
        claveUnidad: "E48", unidadLabel: "Servicio", objetoImp: "02",
        tags: ["admin", "administrativo"] },
      { claveProdServ: "80161501", description: "Servicios de gestión administrativa",
        claveUnidad: "E48", unidadLabel: "Servicio", objetoImp: "02",
        tags: ["admin"] },
      { claveProdServ: "78101800", description: "Servicios de transporte de carga",
        claveUnidad: "E48", unidadLabel: "Servicio", objetoImp: "02",
        tags: ["logistica"] },
      { claveProdServ: "78121600", description: "Servicios de almacenamiento",
        claveUnidad: "E48", unidadLabel: "Servicio", objetoImp: "02",
        tags: ["logistica"] },
      { claveProdServ: "72141000", description: "Servicios de construcción de edificaciones",
        claveUnidad: "E48", unidadLabel: "Servicio", objetoImp: "02",
        tags: ["construccion"] },
      { claveProdServ: "72151600", description: "Servicios de obra civil",
        claveUnidad: "E48", unidadLabel: "Servicio", objetoImp: "02",
        tags: ["construccion"] },
      { claveProdServ: "80141600", description: "Servicios de ventas y promoción",
        claveUnidad: "E48", unidadLabel: "Servicio", objetoImp: "02",
        tags: ["comisiones", "ventas"] },
      { claveProdServ: "84111600", description: "Servicios de consultoría en contabilidad",
        claveUnidad: "E48", unidadLabel: "Servicio", objetoImp: "02",
        tags: ["contable", "consultoria"] },
      { claveProdServ: "80101500", description: "Servicios de consultoría de negocios",
        claveUnidad: "E48", unidadLabel: "Servicio", objetoImp: "02",
        tags: ["admin", "consultoria"] },
    ];
    for (const row of SEED) {
      const exists = await ctx.db.query("satConcepts")
        .withIndex("by_claveProdServ", q => q.eq("claveProdServ", row.claveProdServ))
        .filter(q => q.eq(q.field("orgId"), undefined))
        .first();
      if (exists) continue;
      await ctx.db.insert("satConcepts", {
        orgId: undefined,
        isDefault: true,
        isActive: true,
        ...row,
      });
    }
  },
});
```

### Advertencia importante

Las claves `80141600` (Comisiones), `72141000` (Construcción) y `78101800` (Logística) deben **revisarse con contador antes de producción**. El seed las marca como `isDefault: true` pero el README del seed (o un TODO comment en el archivo) debe indicar:

> TODO: validar con contador las claves de Comisiones, Construcción y Logística. El catálogo SAT tiene granularidad alta y el operador debe confirmar que la clave elegida cuadra con el servicio real facturado.

---

## 5.6 Export a Excel

### 5.6.1 Librería: `exceljs`

**Decisión:** **`exceljs`**.

- `xlsx` (SheetJS) es más ligera pero el fork gratuito quedó estancado y soporta estilos sólo en la versión paga (`xlsx-style` no está mantenida).
- `exceljs` soporta nativamente: formato numérico (`$#,##0.00`), fills, fonts bold, merged cells, column widths, freeze panes, y genera buffers para streaming. Tamaño aceptable (~1 MB bundled).
- **No agregar ambas.** Solo `exceljs` en `package.json`.

### 5.6.2 Arquitectura: Next route handler

**Decisión:** **Next.js route handler** en `src/app/api/projections/[id]/export/route.ts`, no una action de Convex.

Razones:

- Archivos binarios grandes (xlsx puede ir de 50 KB a 2 MB) viajan mejor por Response streaming de Next que serializados por Convex.
- El handler llama internamente a queries Convex (`ctx.runQuery`) con `@convex-dev/server` para obtener los datos, arma el workbook con `exceljs`, y devuelve el buffer con headers `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` + `Content-Disposition: attachment; filename=...`.
- Auth: el route handler valida Clerk session + membresía del org dueño de la proyección antes de fetch.

### 5.6.3 Estructura del workbook

Cuatro hojas:

**Hoja 1 — "Resumen anual"**

| Servicio | Clave SAT | Descripción SAT | Monto anual | % del total |
|----------|-----------|-----------------|-------------|-------------|
| Contable | 84111500  | Servicios contables | $480,000.00 | 20.0% |
| ...      | ...       | ... | ... | ... |
| **TOTAL** |           |   | **$2,400,000.00** | **100%** |

- Row header bold + fill `FFE8E8E8`.
- Fila TOTAL bold con `top border`.
- Columna "Monto anual" formato `$#,##0.00`.
- Columna "% del total" formato `0.0%`.

**Hoja 2 — "Matriz mensual"**

| Servicio | Clave SAT | Ene | Feb | Mar | ... | Dic | Total |
|----------|-----------|-----|-----|-----|-----|-----|-------|

- 12 columnas de meses + columna total por fila.
- Última fila "Total mensual" (bold) con suma de cada columna.
- Celda bottom-right: total general (debe cuadrar con hoja 1).
- Freeze pane en A3 (headers + primera fila servicio).
- Column widths: Servicio 28, Clave SAT 14, meses 14, total 16.
- Formato moneda en todas las celdas numéricas.

**Hoja 3 — "Facturación"**

Una fila por `(month, service, issuingCompany)`. Depende de sección 4.

| Mes | Año | Empresa facturadora | RFC emisor | Cliente | RFC receptor | Servicio | Clave SAT | Unidad | Objeto imp. | Subtotal | Tipo CFDI |
|-----|-----|---------------------|------------|---------|--------------|----------|-----------|--------|-------------|----------|-----------|

- Se arma iterando `monthlyAssignments` y joinando con `servicesIssuingCompanyMap` para resolver qué `issuingCompany` factura ese servicio para ese cliente.
- Si no hay mapping, fallback a `issuingCompanies.isDefault=true` del org.
- "Tipo CFDI" = `"I"` (Ingreso) hardcoded para v2. Complementos fuera de alcance (ver 5.10).
- Ordenado por `month ASC, issuingCompany ASC, service ASC`.

**Hoja 4 — "Datos de cliente"**

Tabla vertical key/value:

| Campo | Valor |
|-------|-------|
| Razón social | Acme Corp SA de CV |
| RFC | ACM850101ABC |
| Régimen fiscal | 601 |
| Uso CFDI preferido | G03 |
| CP fiscal | 06600 |
| Año de proyección | 2026 |
| Ventas anuales proyectadas | $2,400,000.00 |
| Budget anual | $480,000.00 |

### 5.6.4 Formato de celdas

- **Moneda MXN:** `numFmt = '$#,##0.00'`.
- **Porcentaje:** `numFmt = '0.0%'`.
- **Mes header:** fuente bold, fill gris claro `FFE8E8E8`, alineación center.
- **Row servicio:** altura 22px, alineación vertical middle.
- **Totales:** bold + top border.
- **Hoja Facturación:** filter habilitado en headers (`worksheet.autoFilter`).

### 5.6.5 Nombre del archivo

```
Proyeccion_<clientNameSlug>_<year>_<YYYYMMDDHHmm>.xlsx
```

Ejemplo: `Proyeccion_Acme-Corp_2026_202604221430.xlsx`. Slug: ASCII, lowercase, guiones, sin acentos (función `slugify`).

### 5.6.6 Pseudocódigo del route handler

```ts
// src/app/api/projections/[id]/export/route.ts
export async function GET(req, { params }) {
  const { userId, orgId } = auth();
  if (!orgId) return new Response("Unauthorized", { status: 401 });

  const data = await convex.query(api.projections.getForExport, {
    projectionId: params.id,
  });
  if (data.orgId !== orgId) return new Response("Forbidden", { status: 403 });

  const workbook = new ExcelJS.Workbook();
  buildSummarySheet(workbook, data);       // Hoja 1
  buildMatrixSheet(workbook, data);        // Hoja 2
  buildInvoicingSheet(workbook, data);     // Hoja 3
  buildClientSheet(workbook, data);        // Hoja 4

  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName(data)}"`,
    },
  });
}
```

La query `projections.getForExport` debe devolver: proyección + cliente + servicios + monthlyAssignments + satConcepts resueltos + issuingCompanies mapeadas. Una sola query que haga todos los joins (evita N+1 en el handler).

---

## 5.7 Multi-empresa en la matriz

**Decisión:** **badge/color por empresa facturadora** en cada fila de la matriz UI. En Excel, la hoja "Matriz mensual" NO se separa por empresa (se mantiene por servicio), pero la hoja "Facturación" sí rompe por `issuingCompany`.

### UI

- En la columna "Servicio" de la matriz, al lado del nombre, chip con color + nombre corto de la empresa facturadora (ej. `DESK Legal SA`).
- Si un servicio tiene múltiples empresas según mes/override, chip = "Mixto" (gris) + tooltip con detalle.
- Colores: definidos en `issuingCompanies.brandColor` (si sección 4 lo expone) o paleta fija por índice.

### Excel

- Hoja "Matriz mensual" → una fila por servicio (agregado, sin distinguir empresa). La suma total del servicio se mantiene.
- Hoja "Facturación" → granularidad `(mes × servicio × empresa)`. Si un servicio se factura por 2 empresas distintas dentro del mismo mes (caso raro), genera 2 filas.

**Dependencia explícita con sección 4:** el handler no puede armar la hoja "Facturación" si `issuingCompanies` + `servicesIssuingCompanyMap` no existen. En caso de que sección 4 no termine a tiempo, la hoja 3 se degrada a mostrar sólo datos genéricos (sin empresa facturadora) y loguea warning.

---

## 5.8 Data dummy para validar end-to-end

Fixtures que el track Christian siembra (script: `scripts/seed-projex-v2-demo.ts` o mutation `demo.seedProjexV2`):

- **1 cliente:** "Acme Corp SA de CV", RFC `ACM850101ABC`, régimen 601, frecuencia mensual.
- **1 proyección 2026:** `annualSales = $2,400,000`, `totalBudget = $480,000`, `commissionRate = 5%`, `seasonalityData` poblado con FE realista (picos en marzo y octubre).
- **5 servicios activos en la proyección:**
  - Contable (default `84111500`, sin override)
  - Legal (default `80121600`, override a `80121700` en projectionService)
  - TI (default `81112200`)
  - Marketing (sin default, asignado en projectionService `82101600`)
  - Comisiones (default `80141600`)
- **2 empresas facturadoras:**
  - "DESK Admin SA de CV" (RFC `DAD950101ABC`) — factura Contable, Legal, Marketing, Comisiones.
  - "DESK Tech SA de CV" (RFC `DTE950101XYZ`) — factura TI.
- **`servicesIssuingCompanyMap` poblado** para las 5 asignaciones.
- **`monthlyAssignments`:** 5 servicios × 12 meses = 60 registros, montos calculados con FE y weights.

Este fixture permite: ver la matriz con chips de empresa, editar el concepto SAT de TI, ejecutar el export Excel y verificar las 4 hojas.

---

## 5.9 Testing

Casos manuales + tests E2E ligeros (no escribir suite completa para 15-may):

1. **Estructura del export:** archivo xlsx generado contiene exactamente 4 hojas con los nombres exactos `"Resumen anual"`, `"Matriz mensual"`, `"Facturación"`, `"Datos de cliente"`.
2. **Conteo de filas:** hoja "Resumen anual" tiene `N servicios + 2` filas (header + N + total). Hoja "Matriz mensual" tiene `N + 2` filas.
3. **Integridad de totales:** total general de hoja "Resumen anual" == total bottom-right de hoja "Matriz mensual" == suma de subtotales de hoja "Facturación" (tolerancia $0.01 por redondeo).
4. **Concepto SAT correcto por fila:** para cada servicio, la clave SAT impresa coincide con `projectionService.satConceptId ?? service.defaultSatConceptId`.
5. **Multi-empresa:** un servicio facturado por 2 empresas aparece 2 veces en hoja "Facturación" (filas distintas, mismo mes y servicio, issuingCompany distinto), pero solo 1 vez en hoja "Matriz mensual".
6. **Servicio sin concepto SAT:** la celda Clave SAT queda vacía, la fila aparece en hoja "Resumen anual" con warning flag (se puede marcar con fill amarillo `FFFFF3CD`), y el export no falla.
7. **Apertura sin errores:** abrir el archivo en Excel (Mac + Windows) y Numbers (Mac) sin warnings de recuperación.
8. **Formato moneda intacto:** las celdas numéricas muestran `$1,234.56` y no `1234.56` al abrir en Excel.
9. **Nombre del archivo:** `Content-Disposition` trae el filename slugificado correctamente (sin acentos, sin espacios).
10. **Auth:** usuario de org B no puede descargar export de proyección de org A (403).

### Smoke test automatizado (opcional, si queda tiempo)

Un test en `__tests__/export.test.ts` que:
- Llama al route handler con fixture.
- Parsea el buffer con `exceljs` readBuffer.
- Verifica número de hojas, filas y total general.

---

## 5.10 Riesgos y out-of-scope

### Explícitamente fuera de alcance del 15-may

- **Integración con PAC** (Facturama, SW Sapien, Solución Factible) para timbrar CFDI. NO.
- **Emisión real de CFDI 4.0.** NO — Projex solo arma el plan, no factura.
- **Retenciones ISR / IVA.** NO — los montos mostrados son subtotales sin retención.
- **CFDI de complementos** (pagos, nómina, carta porte, comercio exterior). NO.
- **Descarga de XML SAT** o PDF CFDI. NO.
- **Catálogo SAT completo** (50,000+ claves). NO — solo el seed de ~19 claves (5.5). El operador puede crear custom con `orgId` si le falta alguna.
- **Edición de clave SAT por mes puntual** (Opción C de 5.1). NO.
- **Multi-moneda** (USD, EUR). NO — solo MXN.
- **Impuestos locales** (IEPS, ISAN). NO.

### Riesgos conocidos

1. **Claves SAT incorrectas en el seed:** si un contador objeta una clave (ej. comisiones debería ser otra), el operador puede crear concepto custom para su org. Riesgo mitigado por la flag "revisar con contador" (5.5) y el permitir override en `projectionServices`.
2. **Tamaño del xlsx:** con 9 servicios × 12 meses + hoja facturación con 100+ filas, el archivo queda <200 KB. Sin riesgo de timeout.
3. **`issuingCompanies` no listo a tiempo (sección 4):** degradación de hoja "Facturación" documentada en 5.7. No bloquea el demo del 15-may.
4. **Cambios SAT 2026:** el catálogo SAT se actualiza periódicamente. El seed refleja lo vigente al 2026-04-22. Si SAT publica cambios antes de mayo, seed se reemisa.
5. **Encoding de acentos en Excel:** `exceljs` maneja UTF-8 por default. Testear en Excel Windows para confirmar (algunas versiones viejas de Excel muestran mojibake si el XML no está bien declarado).

---

## 5.11 Dependencias con otras secciones

- **Sección 1 (schema global v2):** ya agrega `satConcepts`. Esta sección extiende `services` y `projectionServices`.
- **Sección 4 (empresas facturadoras):** hoja "Facturación" del Excel depende de `issuingCompanies` y `servicesIssuingCompanyMap`. Si sección 4 se retrasa, la hoja 3 se degrada pero no bloquea el export.
- **Sección 6 (cuestionario unificado):** independiente. El cuestionario puede recolectar régimen fiscal/RFC que aparece en hoja 4, pero si no está listo, se usa lo que hay en `clients`.

## 5.12 Checklist de implementación (ordenada por prioridad)

1. Diffs al schema (5.1) + `npx convex dev` para regenerar types.
2. Seed de `satConcepts` (5.5) + ejecutar mutation una vez.
3. Query `searchSatConcepts` (5.3).
4. Picker UI con `Command` + `Popover` (5.3).
5. Columna "Clave SAT" en la matriz (5.2) + mutation para persistir override.
6. Route handler + `exceljs` workbook (5.6) — hojas 1, 2 y 4 primero.
7. Hoja 3 "Facturación" (requiere sección 4 lista).
8. Chips de empresa en la matriz (5.7).
9. Fixture demo (5.8).
10. QA manual con el checklist de testing (5.9).
