# Selección de subservicio por mes en la matriz de proyección

**Fecha:** 2026-05-22
**Sub-spec relacionado:** `docs/superpowers/specs/2026-05-21-subservices-model-design.md` (A1)
**Estado:** propuesto
**Días estimados:** 1 (schema 0, backend ~1h, frontend ~3h, tests ~1h)
**Owner:** Christian
**Dependencias:** A1 mergeado (subservices model + seed), `monthlyAssignments.subserviceId` ya optional, `subservices.listAllForOrg` cacheado en la página de proyección.
**ClickUp:** `86ahfh6g2`

---

## 1. Objetivo

Permitir que el operador planifique mes a mes qué subservicio se entregará en cada celda de la matriz de proyección, en lugar de heredar uno fijo del nivel `projectionService`. Cierra la pieza de planificación de la 2nd review call BiHive (2026-05-13).

Hoy, todas las 12 monthlyAssignments de un servicio comparten un único `subserviceId` heredado del `projectionService`. El selector A3 usa ese id para resolver la plantilla en el momento de generar. Eso obliga a que un servicio "Legal" solo entregue una sola línea de trabajo (ej. solo "Contratos Mercantiles") durante todo el año, cuando la realidad de una consultoría multi-servicio es: Enero = Contratos, Marzo = Compliance, Junio = Gobierno Corporativo, etc.

Esta tarea desacopla el subservicio del nivel mensual, hace explícita la decisión del operador, y bloquea la generación si una celda no tiene subservicio asignado.

## 2. Alcance

### 2.1 Lo que toca

1. **Wizard de crear proyección** (`convex/functions/projections/mutations.ts`): al insertar las 12 monthlyAssignments, dejar `subserviceId: undefined` en lugar de heredar de `serviceConfig.subserviceId`. Solo proyecciones nuevas.
2. **Schema:** sin cambios. `monthlyAssignments.subserviceId` ya es `v.optional(v.id("subservices"))`. Cambia la semántica, no el tipo.
3. **Mutation nueva:** `monthlyAssignments.setSubservice` (admin gated), patch + log a `documentEvents`.
4. **Matriz UI** (`src/app/(dashboard)/proyecciones/[id]/page.tsx`): cada celda mensual obtiene un dropdown inline para elegir subservicio. Solo visible/editable si `isAdmin`. Filtrado a subservicios del `parentServiceId` del servicio de la fila.
5. **Guards de generación:** `generateDeliverable` (action) y `generateFromInvoice` (internal action) lanzan error claro si `assignment.subserviceId` es null.
6. **Tests:** 6 source-level (4 backend, 2 frontend).

### 2.2 Lo que NO toca

- `projectionService.subserviceId`: se queda intacto como "subservicio principal del servicio". Lo muestra la columna sticky izquierda como hint general (mergeado 2026-05-21).
- Wizard Step 2: sigue pidiendo subservicio a nivel proyección. Esa decisión informa la columna izquierda; los meses pueden coincidir o diferir.
- Proyecciones existentes (Katimi, ACME): sus monthlyAssignments conservan su `subserviceId` actual. No hay migración. Cualquier proyección creada antes de este merge sigue funcionando.
- Templates y selector A3: el selector ya usa `assignment.subserviceId`. No cambia su lógica.
- Cuestionario, facturación, contratos: no se tocan.

## 3. Diseño

### 3.1 Mutation `setSubservice`

`convex/functions/monthlyAssignments/mutations.ts`, nueva mutation:

```ts
export const setSubservice = mutation({
  args: {
    id: v.id("monthlyAssignments"),
    subserviceId: v.union(v.id("subservices"), v.null()),
  },
  handler: async (ctx, args) => {
    const identity = await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    const assignment = await ctx.db.get(args.id);
    if (!assignment || assignment.orgId !== orgId) {
      throw new Error("Asignacion no encontrada.");
    }

    // Validate the subservice belongs to the parent service of this assignment.
    if (args.subserviceId !== null) {
      const subservice = await ctx.db.get(args.subserviceId);
      if (!subservice) throw new Error("Subservicio no encontrado.");
      // Subservicios pueden ser org-scoped o globales; ambos son válidos siempre que pertenezcan al mismo parentService.
      const projService = await ctx.db.get(assignment.projServiceId);
      if (!projService || subservice.parentServiceId !== projService.serviceId) {
        throw new Error(
          "El subservicio no pertenece al servicio padre de esta celda."
        );
      }
    }

    await ctx.db.patch(args.id, {
      subserviceId: args.subserviceId ?? undefined,
    });

    await ctx.runMutation(
      internal.functions.documentEvents.internal.logEventMutation,
      {
        orgId,
        clientId: assignment.clientId,
        entityType: "monthlyAssignment" as const,
        entityId: args.id,
        eventType: "updated" as const,
        severity: "info" as const,
        actorUserId: identity.subject,
        actorType: "user" as const,
        message: args.subserviceId
          ? `Subservicio asignado para ${MONTH_NAMES[assignment.month - 1]} ${assignment.year}.`
          : `Subservicio limpiado para ${MONTH_NAMES[assignment.month - 1]} ${assignment.year}.`,
        metadata: { subserviceId: args.subserviceId },
      }
    );

    return { ok: true };
  },
});
```

Si `documentEvents.entityType` no acepta `"monthlyAssignment"` como literal todavía, la mutation puede skip el log (TODO en un sub-spec separado de eventos para assignments).

### 3.2 Wizard — dejar el field vacío al crear

`convex/functions/projections/mutations.ts`, en el insert de monthlyAssignments por servicio activo (buscar `insert("monthlyAssignments"`):

```diff
 await ctx.db.insert("monthlyAssignments", {
   orgId,
   projectionId: newProjectionId,
   projServiceId,
   clientId: args.clientId,
   serviceName: serviceConfig.serviceName,
-  subserviceId: serviceConfig.subserviceId,
+  // subserviceId: omitted intentionally — operator picks per-cell from the matrix (spec 2026-05-22).
   month,
   year: args.year,
   amount,
   feFactor,
   status: "pending",
   invoiceStatus: "not_invoiced",
 });
```

El field se queda undefined (Convex elide undefined optionals automáticamente).

### 3.3 Guards de generación

`convex/functions/deliverables/actions.ts` en `generateDeliverable` handler, después de cargar `assignment`:

```ts
if (!assignment.subserviceId) {
  throw new Error(
    "Selecciona el subservicio del mes antes de generar el entregable. La planificación se hace desde la matriz de la proyección."
  );
}
```

`convex/functions/deliverables/invoiceFlow.ts` en `generateFromInvoice`, después de resolver `projection` y antes del selector:

```ts
const assignment = await ctx.runQuery(
  internal.functions.deliverables.internalQueries.getAssignmentData,
  { assignmentId: monthlyAssignmentId }
);
if (!assignment?.subserviceId) {
  await ctx.runMutation(
    internal.functions.documentEvents.internal.logEventMutation,
    { /* error event */ }
  );
  return { ok: false, reason: "missing_subservice" };
}
```

(El monthlyAssignmentId ya está disponible en el flow porque se resuelve antes del selector.)

### 3.4 Matriz UI — dropdown por celda

`src/app/(dashboard)/proyecciones/[id]/page.tsx`, modificación del bloque que renderiza cada `<td>` (líneas ~310-336 aprox):

```tsx
{months.map((monthNum) => {
  const ma = svcAssignments.find((a) => a.month === monthNum);
  if (!ma) return <td key={...}><span>—</span></td>;

  const cellSubservice = ma.subserviceId
    ? subservicesById.get(ma.subserviceId)
    : null;

  // Filter dropdown options to subservicios of this row's parent service.
  const optionsForRow = (subservices ?? []).filter(
    (s) => s.parentServiceId === svc.serviceId && s.isActive
  );

  return (
    <td
      key={...}
      className={cn(
        "px-2 py-2 text-center",
        !cellSubservice && "border border-destructive/40 bg-destructive/5"
      )}
    >
      <div className="space-y-1">
        <p className="text-xs">{formatCurrency(ma.amount)}</p>
        {isAdmin ? (
          <SubserviceCellPicker
            current={cellSubservice}
            options={optionsForRow}
            onPick={(subId) =>
              setSubservice({ id: ma._id, subserviceId: subId })
            }
          />
        ) : (
          <span className="text-[10px] text-muted-foreground">
            {cellSubservice?.name ?? "Sin asignar"}
          </span>
        )}
      </div>
    </td>
  );
})}
```

`SubserviceCellPicker` es un nuevo componente compacto en `src/components/projections/subservice-cell-picker.tsx`:
- Botón con el nombre del subservicio actual (truncado ~16 chars) o "Selecciona" en placeholder rojo.
- Click abre un popover/select con la lista de `options` ordenada por `sortOrder`.
- Item adicional al final: "— Sin subservicio —" (set null).

Reuso del Map `subservicesById` ya cacheado del feature de ayer.

### 3.5 Lectura del estado (admin gate)

`isAdmin` ya se computa en `proyecciones/[id]/page.tsx` (heredo el mismo patrón que en `matrix-cell-detail.tsx`):

```ts
const { membership, isLoaded: orgLoaded } = useOrganization();
const isAdmin = membership?.role === "org:admin";
```

Si no es admin: el dropdown se vuelve display-only `<span>` (texto del subservicio o "Sin asignar"). Backend rechaza el call si llega un non-admin (per `requireAdmin` en la mutation).

### 3.6 Cell empty visual feedback

- Celda con `subserviceId === null/undefined`: border rojo `border-destructive/40`, fondo `bg-destructive/5`, dropdown muestra "Selecciona" en rojo.
- Celda con valor: visualmente normal, dropdown muestra el nombre.
- El drawer existente (`MatrixCellDetail`) muestra el subservicio actual en el header (Servicio › Subservicio); si está vacío, muestra solo "Legal" sin el divisor.

## 4. Tests

Source-level tests, siguiendo el patrón del repo.

### 4.1 `convex/functions/monthlyAssignments/__tests__/setSubservice.test.ts` (nuevo)

```ts
const SOURCE = readFileSync(resolve(__dirname, "../mutations.ts"), "utf-8");

describe("monthlyAssignments.setSubservice", () => {
  it("exports setSubservice mutation", () => {
    expect(SOURCE).toMatch(/export const setSubservice = mutation/);
  });

  it("requires admin role", () => {
    expect(SOURCE).toContain("requireAdmin(ctx)");
  });

  it("validates subservice parentServiceId matches assignment service", () => {
    expect(SOURCE).toMatch(/subservice\.parentServiceId !== projService\.serviceId/);
  });

  it("accepts null to clear the field", () => {
    expect(SOURCE).toMatch(/v\.union\(v\.id\("subservices"\), v\.null\(\)\)/);
  });
});
```

### 4.2 `convex/functions/deliverables/__tests__/generateGuards.test.ts` (nuevo o extender existente)

```ts
const ACTIONS = readFileSync(resolve(__dirname, "../actions.ts"), "utf-8");
const INVOICE_FLOW = readFileSync(resolve(__dirname, "../invoiceFlow.ts"), "utf-8");

describe("generation guards on missing subservice", () => {
  it("generateDeliverable throws when assignment.subserviceId is missing", () => {
    expect(ACTIONS).toContain("Selecciona el subservicio del mes");
    expect(ACTIONS).toMatch(/!assignment\.subserviceId/);
  });

  it("generateFromInvoice returns missing_subservice reason and logs", () => {
    expect(INVOICE_FLOW).toContain("missing_subservice");
    expect(INVOICE_FLOW).toMatch(/!assignment\??\.subserviceId/);
  });
});
```

### 4.3 `convex/functions/projections/__tests__/wizard-no-monthly-inherit.test.ts` (nuevo o extender)

```ts
const SOURCE = readFileSync(resolve(__dirname, "../mutations.ts"), "utf-8");

describe("projections.create — monthlyAssignments do not inherit subserviceId", () => {
  it("does not pass subserviceId in the monthlyAssignments insert", () => {
    // The insert block for monthlyAssignments should NOT have subserviceId: serviceConfig.subserviceId.
    const insertBlock = SOURCE.match(/insert\(\s*"monthlyAssignments"[\s\S]*?\}\s*\)/);
    expect(insertBlock).toBeTruthy();
    expect(insertBlock![0]).not.toMatch(/subserviceId:\s*serviceConfig\.subserviceId/);
  });
});
```

### 4.4 `src/app/(dashboard)/proyecciones/__tests__/page-monthly-subservice.test.tsx` (nuevo)

```ts
const SOURCE = readFileSync(resolve(__dirname, "../[id]/page.tsx"), "utf-8");

describe("/proyecciones/[id] — monthly subservice picker", () => {
  it("derives isAdmin from useOrganization membership role", () => {
    expect(SOURCE).toContain('membership?.role === "org:admin"');
  });

  it("renders SubserviceCellPicker for admins on each cell", () => {
    expect(SOURCE).toContain("SubserviceCellPicker");
    expect(SOURCE).toMatch(/isAdmin\s*\?/);
  });

  it("filters options by parentServiceId of the row", () => {
    expect(SOURCE).toMatch(/parentServiceId\s*===\s*svc\.serviceId/);
  });

  it("highlights empty cells with destructive border", () => {
    expect(SOURCE).toContain("border-destructive");
  });
});
```

### 4.5 Smoke E2E manual

1. Crear nueva proyección de prueba en `/proyecciones/nueva` con servicio Legal + subservicio "Contratos" → confirmar que la matriz aparece con CELDAS VACÍAS (border rojo).
2. Como admin, click en una celda → dropdown → elegir "Gobierno Corporativo" → confirmar que la celda muestra el nombre y pierde el border rojo.
3. Click en otro mes → elegir "Compliance LFPDPP" → confirmar que los meses pueden tener distintos.
4. Subir factura para Junio (con subservicio asignado) y markPaid → confirmar que el entregable se genera con la plantilla del subservicio elegido.
5. Subir factura para Julio (sin subservicio asignado) y markPaid → confirmar que falla con error claro y un documentEvent queda registrado.
6. Sign-out, sign-in como `org:member` → matriz muestra dropdowns como texto plano (no editable).

## 5. Riesgos

- **Riesgo medio:** existing proyecciones (Katimi/ACME) tienen `subserviceId` heredado del wizard viejo. La matriz las muestra correctamente y el generador no rompe — pero si un admin "edita" una celda existente puede romper la coherencia con el `projectionService.subserviceId`. Aceptable: los nuevos picks override la herencia legacy.
- **Riesgo bajo:** doble click en el dropdown abre el drawer también (el `<td>` tiene `onClick={() => setSelectedAssignmentId(ma._id)}`). Mitigación: el dropdown debe llamar `e.stopPropagation()` en su click.
- **Riesgo bajo:** UI densidad — 8-12 dropdowns × 5 servicios = 40-60 elementos. Mitigación: usar shadcn `Select` compacto con trigger de ~120px ancho. Si la matriz no cabe, aplicar overflow-x-scroll al wrapper.
- **Riesgo bajo:** si `documentEvents.entityType` no acepta `"monthlyAssignment"`, el log no se escribe pero la mutation completa. Sub-spec separado para extender el enum.

## 6. Plan de implementación (alto nivel)

1. Branch `feature/monthly-subservice-selection`.
2. TDD red: escribir los 4 tests (~12 assertions totales) → todos fallan.
3. Backend: mutation `setSubservice` + guard en `generateDeliverable` + guard en `generateFromInvoice` → tests backend pasan.
4. Wizard: quitar herencia de `subserviceId` al insert de monthlyAssignments → test wizard pasa.
5. Frontend: componente `SubserviceCellPicker` + integración en `proyecciones/[id]/page.tsx` con admin gate → test frontend pasa.
6. `npm test` full suite verde, `npx tsc --noEmit` clean.
7. Smoke E2E manual (sección 4.5).
8. Merge a main.
9. Cerrar ClickUp 86ahfh6g2.

## 7. Out of scope

- "Skip mes" como acción explícita (un toggle "no entregar nada este mes"). Solo eliminamos la herencia automática; el user puede elegir "— Sin subservicio —" y eso lo bloquea de generar (no es "skip", es "no asignado todavía").
- Multi-template por subservicio (corto/largo/etc.) — el override manual ya hardcodea `deliverable_long`; el selector A3 maneja el resto.
- Bulk editor anual ("planear año en modal"). Si se vuelve dolor real con uso, sub-spec aparte.
- Migración de proyecciones existentes (las preservamos como están).
- Extensión de `documentEvents.entityType` con `"monthlyAssignment"` literal. Si no existe, la mutation skip el log y se hace en sub-spec aparte.
