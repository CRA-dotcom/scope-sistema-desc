# Subservicios visibles en matrix + drawer

**Fecha:** 2026-05-21
**Sub-spec relacionado:** `docs/superpowers/specs/2026-05-21-subservices-model-design.md` (A1)
**Estado:** propuesto
**Días estimados:** 0.5 (UI-only, sin backend, ~50 LOC + tests)
**Owner:** Christian
**Dependencias:** A1 mergeado (schema + wizard), 33 subservicios globales seeded.

---

## 1. Objetivo

El operador, al ver la matriz `/proyecciones/[id]`, debe saber **qué subservicio** corresponde a cada servicio activo — porque el subservicio determina qué plantilla resolverá el selector A3 (`selectDeliverableForMonth`) y por tanto qué entregable saldrá generado.

Hoy la matriz solo muestra `serviceName` (el servicio padre). Si dos clientes tienen el mismo servicio padre "Legal" con subservicios distintos ("Demanda mercantil" vs "Asesoría contractual"), no hay forma de distinguirlos visualmente.

## 2. Alcance

### 2.1 Lo que toca

1. **`src/app/(dashboard)/proyecciones/[id]/page.tsx`:**
   - Agregar `useQuery(api.functions.subservices.queries.listAllForOrg)` (mismo patrón que el wizard ya usa).
   - Construir `subservicesById = new Map(...)` para lookup O(1).
   - En la columna sticky izquierda, debajo del `serviceName`, agregar línea pequeña con el `subservice.name` cuando exista.
   - Pasar `subserviceName` como prop al `<MatrixCellDetail />`.

2. **`src/components/projections/matrix-cell-detail.tsx`:**
   - Aceptar `subserviceName?: string` como prop opcional.
   - En el header, renderizar `serviceName › subserviceName` cuando `subserviceName` esté presente.

3. **Tests:**
   - Extender `src/components/projections/__tests__/matrix-cell-detail.test.tsx` con 3 source-level tests para el header.
   - Crear `src/app/(dashboard)/proyecciones/__tests__/page-subservice-column.test.tsx` con 2 tests para la columna sticky.

### 2.2 Lo que NO toca

- Backend: ningún query, mutation o schema.
- El selector A3 (`selectDeliverableForMonth`) — ya usa `subserviceId` desde el assignment.
- El wizard de crear proyección — ya pide subservicio.
- Proyecciones legacy con `subserviceId === undefined` — el UI muestra solo el servicio padre, sin línea adicional (graceful degradation).

## 3. Diseño

### 3.1 Frontend join (no backend change)

Razón: `getMatrix` ya devuelve `projServices` con `subserviceId`. `subservices.listAllForOrg` ya es invocado en el wizard. Reusar evita backend roundtrip extra.

```ts
const subservices = useQuery(
  api.functions.subservices.queries.listAllForOrg,
  {}
);
const subservicesById = useMemo(
  () => new Map((subservices ?? []).map((s) => [s._id, s])),
  [subservices]
);
```

Tipo de lookup: `Map<Id<"subservices">, Doc<"subservices">>`.

### 3.2 Columna sticky izquierda

```tsx
<td className="sticky left-0 bg-card px-4 py-2.5 font-medium">
  <div>
    <div>{svc.serviceName}</div>
    {svc.subserviceId && subservicesById.get(svc.subserviceId) && (
      <div className="text-[10px] text-muted-foreground font-normal mt-0.5">
        {subservicesById.get(svc.subserviceId)!.name}
      </div>
    )}
  </div>
</td>
```

Si `subserviceId` es undefined (proyecciones legacy pre-A1) o si el lookup no encuentra (subservicio borrado): solo se muestra el `serviceName`. No hay banner de error — es graceful degradation.

### 3.3 Drawer header

```tsx
// MatrixCellDetail signature:
export function MatrixCellDetail({
  assignment,
  subserviceName,
  onClose,
}: {
  assignment: Doc<"monthlyAssignments">;
  subserviceName?: string;
  onClose: () => void;
}) {
  // ...
  <h3 className="text-lg font-semibold">
    {assignment.serviceName}
    {subserviceName && (
      <span className="text-muted-foreground font-normal">
        {" "}
        › {subserviceName}
      </span>
    )}
  </h3>
}
```

`subserviceName` se resuelve en la página padre antes de pasarse al drawer:

```tsx
<MatrixCellDetail
  assignment={selectedAssignment}
  subserviceName={
    selectedAssignment.subserviceId
      ? subservicesById.get(selectedAssignment.subserviceId)?.name
      : undefined
  }
  onClose={() => setSelectedAssignmentId(null)}
/>
```

## 4. Tests

### 4.1 Extensión de `matrix-cell-detail.test.tsx`

Agregar al final del `describe` existente:

```ts
it("accepts an optional subserviceName prop in the signature", () => {
  expect(SOURCE).toMatch(/subserviceName\?\s*:\s*string/);
});

it("renders ' › subserviceName' in the header when provided", () => {
  expect(SOURCE).toContain("› {subserviceName}");
});

it("does not require subserviceName (optional with falsy guard)", () => {
  // Conditional render guard: only renders the divider span if truthy.
  expect(SOURCE).toMatch(/\{subserviceName\s*&&\s*\(/);
});
```

### 4.2 Nuevo archivo `page-subservice-column.test.tsx`

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(
  resolve(__dirname, "../[id]/page.tsx"),
  "utf-8"
);

describe("/proyecciones/[id] — subservice in matrix left column", () => {
  it("prefetches subservices via listAllForOrg", () => {
    expect(SOURCE).toMatch(
      /useQuery\(\s*api\.functions\.subservices\.queries\.listAllForOrg/
    );
  });

  it("builds a Map keyed by subservice _id for lookup", () => {
    expect(SOURCE).toContain("subservicesById");
    expect(SOURCE).toMatch(/new Map\([^)]*\.map\(/);
  });

  it("renders the subservice name under serviceName conditionally", () => {
    expect(SOURCE).toMatch(/svc\.subserviceId\s*&&/);
    expect(SOURCE).toMatch(/subservicesById\.get\(svc\.subserviceId\)/);
  });

  it("passes subserviceName to MatrixCellDetail when an assignment is selected", () => {
    expect(SOURCE).toContain("subserviceName=");
    expect(SOURCE).toMatch(/selectedAssignment\.subserviceId/);
  });
});
```

## 5. Riesgos

- **Riesgo bajo:** Si `listAllForOrg` retorna [] (org sin subservicios), el Map estará vacío y todo queda en graceful degradation.
- **Riesgo bajo:** Si Convex schedula la query y aún no ha resuelto (`subservices === undefined`), `subservicesById` será un Map vacío momentáneamente — la UI muestra solo `serviceName`. Render flicker mínimo aceptable.
- **No hay riesgo de N+1:** un solo `listAllForOrg` por mount.

## 6. Plan de implementación

1. Branch `feature/subservices-visible-in-matrix` (ya creada).
2. Escribir test file nuevo + extensiones del existente (red).
3. Editar page.tsx (add useQuery + Map + render + prop pass).
4. Editar matrix-cell-detail.tsx (add prop + header render).
5. `npm test` + `npx tsc --noEmit` clean.
6. Smoke E2E manual: abrir `/proyecciones/[id]` de Katimi, verificar subservicio bajo servicio en columna izquierda y `›` en header del drawer.
7. Merge a main.

## 7. Out of scope

- Cambiar el wizard.
- Cambiar el selector A3.
- Mostrar el subservicio por celda mensual (cada celda muestra el mismo subservicio que su servicio padre — sería redundante).
- Subservicios variables mes a mes (V2, requiere cambio de modelo).
- Cuestionario anual con KPIs comparativos (V2, confirmado por user 2026-05-21).
