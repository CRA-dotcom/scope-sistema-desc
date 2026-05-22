# Selección de subservicio por mes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir el subservicio mensual de hereda-fijo a editable-per-celda. Wizard deja `monthlyAssignments.subserviceId` undefined al crear; admin lo elige inline en la matriz; generación bloquea si está vacío.

**Architecture:** UI-only en la matriz de `/proyecciones/[id]` + 1 mutation backend nueva + guards en 2 actions de generación + cambio chico en el wizard. Schema sin tocar (el field ya es optional). Reusa el Map `subservicesById` ya cacheado del feature de 2026-05-21.

**Tech Stack:** Next.js 15 App Router (cliente), React 19, Convex (`useMutation`, `useQuery`), Clerk (`useOrganization`), Tailwind, Lucide. Tests: Vitest source-level (convención del repo).

**Spec:** `docs/superpowers/specs/2026-05-22-monthly-subservice-selection-design.md` (commit `b3787b2`)

---

## File Structure

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `convex/functions/monthlyAssignments/mutations.ts` | Modificar | Agregar mutation `setSubservice` |
| `convex/functions/monthlyAssignments/__tests__/setSubservice.test.ts` | Crear | 4 source-level tests del contrato |
| `convex/functions/projections/mutations.ts` | Modificar | Quitar `subserviceId` del insert de monthlyAssignments (3 sitios potenciales) |
| `convex/functions/projections/__tests__/wizard-no-monthly-inherit.test.ts` | Crear | 1 source-level test del no-inherit |
| `convex/functions/deliverables/actions.ts` | Modificar | Guard en `generateDeliverable`: throw si subserviceId null |
| `convex/functions/deliverables/invoiceFlow.ts` | Modificar | Guard en `generateFromInvoice`: return error + log |
| `convex/functions/deliverables/__tests__/generateGuards.test.ts` | Crear | 2 source-level tests de los guards |
| `src/components/projections/subservice-cell-picker.tsx` | Crear | Componente compacto: trigger + popover/select de subservicios |
| `src/app/(dashboard)/proyecciones/[id]/page.tsx` | Modificar | Wire `<SubserviceCellPicker />` en cada `<td>` mensual, admin gate, empty-cell visual |
| `src/app/(dashboard)/proyecciones/__tests__/page-monthly-subservice.test.tsx` | Crear | 4 source-level tests de la matriz |

**Nota documentEvents:** `documentEvents.entityType` NO incluye `"monthlyAssignment"` (verificado en schema). La mutation `setSubservice` skip el log de audit. Si se necesita después, extender enum en sub-spec separado.

---

## Task 0: Branch + baseline check

**Files:** ninguno

- [ ] **Step 1: Verificar working tree clean**

Run: `git status -s`
Expected: clean OR solo `AGENTS.md`/`CLAUDE.md` (GitNexus auto-refresh, ignorable).

Si hay otros archivos modificados, STOP y reporta `BLOCKED`.

- [ ] **Step 2: Branch**

Run: `git checkout -b feature/monthly-subservice-selection`
Expected: `Switched to a new branch 'feature/monthly-subservice-selection'`

- [ ] **Step 3: Baseline test count + tsc**

Run: `npm test 2>&1 | tail -3`
Expected: `Tests  796 passed | 1 skipped` (o más, no menos). Anotar el número exacto para comparar al final.

Run: `npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -5`
Expected: sin output.

---

## Task 1: Tests rojos (4 archivos, ~12 assertions)

**Files:**
- Create: `convex/functions/monthlyAssignments/__tests__/setSubservice.test.ts`
- Create: `convex/functions/projections/__tests__/wizard-no-monthly-inherit.test.ts`
- Create: `convex/functions/deliverables/__tests__/generateGuards.test.ts`
- Create: `src/app/(dashboard)/proyecciones/__tests__/page-monthly-subservice.test.tsx`

- [ ] **Step 1: Verificar que existen los dirs de tests**

Run:
```bash
ls convex/functions/monthlyAssignments/__tests__/ 2>/dev/null
ls convex/functions/projections/__tests__/ 2>/dev/null
ls convex/functions/deliverables/__tests__/ 2>/dev/null
ls src/app/\(dashboard\)/proyecciones/__tests__/ 2>/dev/null
```

Si alguno no existe, crear con `mkdir -p`.

- [ ] **Step 2: Crear `setSubservice.test.ts`**

Contenido exacto:

```ts
/**
 * Source-level tests for monthlyAssignments.setSubservice mutation.
 * Spec: docs/superpowers/specs/2026-05-22-monthly-subservice-selection-design.md §3.1
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(
  resolve(__dirname, "../mutations.ts"),
  "utf-8"
);

describe("monthlyAssignments.setSubservice", () => {
  it("exports setSubservice mutation", () => {
    expect(SOURCE).toMatch(/export const setSubservice\s*=\s*mutation/);
  });

  it("requires admin role", () => {
    expect(SOURCE).toContain("requireAdmin(ctx)");
  });

  it("validates subservice parentServiceId matches assignment's parent service", () => {
    expect(SOURCE).toMatch(
      /subservice\.parentServiceId\s*!==\s*projService\.serviceId/
    );
  });

  it("accepts null to clear the field", () => {
    expect(SOURCE).toMatch(
      /v\.union\(\s*v\.id\(\s*"subservices"\s*\)\s*,\s*v\.null\(\)\s*\)/
    );
  });
});
```

- [ ] **Step 3: Crear `wizard-no-monthly-inherit.test.ts`**

Contenido exacto:

```ts
/**
 * Regression test: projections.create no longer auto-inherits
 * serviceConfig.subserviceId into monthlyAssignments. The operator
 * picks per-cell from the matrix.
 * Spec: docs/superpowers/specs/2026-05-22-monthly-subservice-selection-design.md §3.2
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(
  resolve(__dirname, "../mutations.ts"),
  "utf-8"
);

describe("projections create — monthlyAssignments no longer inherits subserviceId", () => {
  it("does not pass subserviceId: serviceConfig.subserviceId in any monthlyAssignments insert", () => {
    // The string serviceConfig.subserviceId must never appear adjacent to a
    // monthlyAssignments insert. We verify a tighter signal: no occurrence at all
    // in the file (since that field is only meaningful here).
    expect(SOURCE).not.toMatch(/subserviceId:\s*serviceConfig\.subserviceId/);
  });
});
```

- [ ] **Step 4: Crear `generateGuards.test.ts`**

Contenido exacto:

```ts
/**
 * Source-level tests for missing-subservice guards in generation paths.
 * Spec: docs/superpowers/specs/2026-05-22-monthly-subservice-selection-design.md §3.3
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ACTIONS = readFileSync(
  resolve(__dirname, "../actions.ts"),
  "utf-8"
);
const INVOICE_FLOW = readFileSync(
  resolve(__dirname, "../invoiceFlow.ts"),
  "utf-8"
);

describe("generation guards on missing subservice", () => {
  it("generateDeliverable throws when assignment.subserviceId is missing", () => {
    expect(ACTIONS).toContain("Selecciona el subservicio del mes");
    expect(ACTIONS).toMatch(/!assignment\.subserviceId/);
  });

  it("generateFromInvoice returns missing_subservice and logs an error event", () => {
    expect(INVOICE_FLOW).toContain("missing_subservice");
    expect(INVOICE_FLOW).toMatch(/!assignment\??\.subserviceId/);
  });
});
```

- [ ] **Step 5: Crear `page-monthly-subservice.test.tsx`**

Contenido exacto:

```ts
/**
 * Source-level tests for the monthly subservice picker integrated
 * into the projection matrix.
 * Spec: docs/superpowers/specs/2026-05-22-monthly-subservice-selection-design.md §3.4
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PAGE = readFileSync(
  resolve(__dirname, "../[id]/page.tsx"),
  "utf-8"
);
const PICKER = readFileSync(
  resolve(
    __dirname,
    "../../../../components/projections/subservice-cell-picker.tsx"
  ),
  "utf-8"
);

describe("/proyecciones/[id] — monthly subservice picker integration", () => {
  it("derives isAdmin from useOrganization membership role", () => {
    expect(PAGE).toContain('membership?.role === "org:admin"');
  });

  it("imports SubserviceCellPicker", () => {
    expect(PAGE).toContain("SubserviceCellPicker");
  });

  it("filters dropdown options by parentServiceId of the row", () => {
    expect(PAGE).toMatch(/parentServiceId\s*===\s*svc\.serviceId/);
  });

  it("renders destructive border when cell has no subservice", () => {
    expect(PAGE).toContain("border-destructive");
  });
});

describe("SubserviceCellPicker component contract", () => {
  it("exports the component", () => {
    expect(PICKER).toMatch(/export function SubserviceCellPicker/);
  });

  it("stops click propagation on its trigger (to prevent drawer open)", () => {
    expect(PICKER).toContain("stopPropagation");
  });

  it("offers a 'Sin subservicio' option for clearing the field", () => {
    expect(PICKER).toMatch(/Sin subservicio/i);
  });
});
```

- [ ] **Step 6: Correr los 4 tests y verificar que TODOS fallan**

Run:
```bash
npx vitest run \
  convex/functions/monthlyAssignments/__tests__/setSubservice.test.ts \
  convex/functions/projections/__tests__/wizard-no-monthly-inherit.test.ts \
  convex/functions/deliverables/__tests__/generateGuards.test.ts \
  src/app/\(dashboard\)/proyecciones/__tests__/page-monthly-subservice.test.tsx
```

Expected: la mayoría falla con assertion errors. UN test pasa potencialmente: `wizard-no-monthly-inherit` (`not.toMatch`) — pasa si la línea `subserviceId: serviceConfig.subserviceId` no existe; pero hoy SÍ existe (línea ~257), entonces el test ALSO debería fallar. Verifica.

`page-monthly-subservice.test.tsx` puede dar error de "module not found" para `subservice-cell-picker.tsx` — eso es OK, el archivo se crea en Task 5. Marca ese test como pending si no se puede importar.

Si un test pasa que no debería, revisa el regex.

- [ ] **Step 7: Commit red**

Si `page-monthly-subservice.test.tsx` tira error de import al correr, eso significa el regex de readFileSync falla en runtime — está bien para commit "red" pero anota que ese archivo necesita el componente creado primero (Task 5).

```bash
git add convex/functions/monthlyAssignments/__tests__/setSubservice.test.ts \
        convex/functions/projections/__tests__/wizard-no-monthly-inherit.test.ts \
        convex/functions/deliverables/__tests__/generateGuards.test.ts \
        'src/app/(dashboard)/proyecciones/__tests__/page-monthly-subservice.test.tsx'

git commit -m "$(cat <<'EOF'
test(monthly-subservice): add source-level tests for monthly picker (red)

12 nuevos source-level tests cubriendo:
- setSubservice mutation contract (4)
- wizard no-inherit regression (1)
- generation guards (2)
- matrix UI + SubserviceCellPicker contract (5)

11 de 12 fallan ahora; page-monthly-subservice.test.tsx puede tirar
import error hasta que Task 5 cree el componente.

Spec: docs/superpowers/specs/2026-05-22-monthly-subservice-selection-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Backend — `setSubservice` mutation

**Files:**
- Modify: `convex/functions/monthlyAssignments/mutations.ts`

- [ ] **Step 1: Leer imports actuales del archivo**

Run: `head -20 convex/functions/monthlyAssignments/mutations.ts`

Anotar qué helpers de auth ya están importados (`requireAdmin`, `requireAuth`, `getOrgId`). Probable: `requireAuth` y `getOrgId`. Si `requireAdmin` no está, hay que agregarlo.

- [ ] **Step 2: Asegurar imports**

Si falta `requireAdmin`, agregarlo al import de `authHelpers`:

```diff
-import { getOrgId, requireAuth } from "../../lib/authHelpers";
+import { getOrgId, requireAdmin } from "../../lib/authHelpers";
```

(O combinar: `requireAuth, requireAdmin` si ambos se usan en el archivo.)

Verifica que `internal` esté importado:
```bash
grep -n 'from "../../_generated/api"' convex/functions/monthlyAssignments/mutations.ts
```

Si no está: agregar `import { internal } from "../../_generated/api";`.

- [ ] **Step 3: Agregar la mutation al final del archivo**

Append al final de `convex/functions/monthlyAssignments/mutations.ts`:

```ts

/**
 * Set the subservice for a specific monthly cell. Admin-only.
 * Validates that the chosen subservice belongs to the parent service
 * of the assignment's projectionService. Pass null to clear.
 * Spec: docs/superpowers/specs/2026-05-22-monthly-subservice-selection-design.md §3.1
 */
export const setSubservice = mutation({
  args: {
    id: v.id("monthlyAssignments"),
    subserviceId: v.union(v.id("subservices"), v.null()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);

    const assignment = await ctx.db.get(args.id);
    if (!assignment || assignment.orgId !== orgId) {
      throw new Error("Asignacion no encontrada.");
    }

    if (args.subserviceId !== null) {
      const subservice = await ctx.db.get(args.subserviceId);
      if (!subservice) throw new Error("Subservicio no encontrado.");

      const projService = await ctx.db.get(assignment.projServiceId);
      if (!projService) {
        throw new Error("Servicio de proyeccion no encontrado.");
      }
      if (subservice.parentServiceId !== projService.serviceId) {
        throw new Error(
          "El subservicio no pertenece al servicio padre de esta celda."
        );
      }
    }

    await ctx.db.patch(args.id, {
      subserviceId: args.subserviceId ?? undefined,
    });

    return { ok: true };
  },
});
```

- [ ] **Step 4: Correr tests específicos del mutation**

Run: `npx vitest run convex/functions/monthlyAssignments/__tests__/setSubservice.test.ts`
Expected: 4/4 tests pass.

- [ ] **Step 5: TypeScript check**

Run: `npx tsc --noEmit 2>&1 | grep "monthlyAssignments/mutations" | head -5`
Expected: sin output.

Si hay error tipo "Cannot find name 'requireAdmin'", verifica el import. Si dice "Property does not exist", verifica la firma de `requireAdmin` en `convex/lib/authHelpers.ts`.

- [ ] **Step 6: Commit**

```bash
git add convex/functions/monthlyAssignments/mutations.ts
git commit -m "$(cat <<'EOF'
feat(monthlyAssignments): add setSubservice mutation (admin-only)

Patch monthlyAssignments.subserviceId con validacion de que el
subservice pertenezca al parent service del projectionService. Acepta
null para limpiar el field.

Spec: docs/superpowers/specs/2026-05-22-monthly-subservice-selection-design.md §3.1

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wizard — quitar herencia de subserviceId al crear

**Files:**
- Modify: `convex/functions/projections/mutations.ts`

- [ ] **Step 1: Identificar TODOS los inserts de monthlyAssignments con subserviceId heredado**

Run:
```bash
grep -n "subserviceId: serviceConfig.subserviceId" convex/functions/projections/mutations.ts
```

Anotar las líneas (probable: ~257, posiblemente otra en `addServicesToProjection` o similar). El insert de `addSubserviceAtMidYear` (línea ~605 del file) NO tiene este patrón porque opera con un parentService directo — no tocar ese.

- [ ] **Step 2: Reemplazar cada ocurrencia con comentario explicativo**

Por cada ocurrencia encontrada en Step 1, usar Edit con `replace_all: false` y suficiente contexto para unicidad:

Patrón:
```diff
            serviceName: svc.serviceName,
-           subserviceId: serviceConfig.subserviceId,
+           // subserviceId: undefined — operator picks per-cell from matrix.
+           // Spec: docs/superpowers/specs/2026-05-22-monthly-subservice-selection-design.md
            month: ma.month,
```

Si hay 2 ocurrencias idénticas, hacer Edit con `replace_all: true` (siempre y cuando ambas sean genuinamente iguales).

- [ ] **Step 3: Correr el test de regresión**

Run: `npx vitest run convex/functions/projections/__tests__/wizard-no-monthly-inherit.test.ts`
Expected: 1/1 pass.

- [ ] **Step 4: Correr toda la suite de projections para confirmar que no se rompió nada**

Run: `npx vitest run convex/functions/projections/__tests__/ 2>&1 | tail -5`
Expected: 0 failures. Cualquier test que esperaba `subserviceId: serviceConfig.subserviceId` literal va a fallar — pero el único conocido es `wizard-subservices.test.tsx` línea 103 (`persists subserviceId on the monthlyAssignments insert`).

- [ ] **Step 5: Si `wizard-subservices.test.tsx` falla**

Ese test verifica el comportamiento VIEJO. Hay que actualizarlo. Abrir `src/app/(dashboard)/proyecciones/__tests__/wizard-subservices.test.tsx` y encontrar:

```ts
it("persists subserviceId on the monthlyAssignments insert", () => {
  expect(MUTATIONS_SOURCE).toMatch(
    /insert\(\s*"monthlyAssignments"[\s\S]+?subserviceId:\s*serviceConfig\.subserviceId/
  );
});
```

Cambiar a:

```ts
it("does NOT persist subserviceId on monthlyAssignments insert (per spec 2026-05-22 — operator picks per-cell)", () => {
  expect(MUTATIONS_SOURCE).not.toMatch(
    /insert\(\s*"monthlyAssignments"[\s\S]+?subserviceId:\s*serviceConfig\.subserviceId/
  );
});
```

Re-run `npx vitest run src/app/\(dashboard\)/proyecciones/__tests__/wizard-subservices.test.tsx` — esperado: pasa.

- [ ] **Step 6: TypeScript check**

Run: `npx tsc --noEmit 2>&1 | grep "projections/mutations" | head -5`
Expected: sin output.

- [ ] **Step 7: Commit**

```bash
git add convex/functions/projections/mutations.ts
# Si actualizaste wizard-subservices.test.tsx:
git add 'src/app/(dashboard)/proyecciones/__tests__/wizard-subservices.test.tsx'

git commit -m "$(cat <<'EOF'
feat(projections): wizard no longer inherits subserviceId on monthlyAssignments

Nuevas proyecciones crean monthlyAssignments sin subserviceId. El
operator elige per-cell en la matriz. projectionService.subserviceId
sigue intacto como subservicio principal del servicio (lo muestra la
columna sticky izquierda de la matriz).

Existing projections no se tocan — sus assignments mantienen el
subserviceId heredado del wizard viejo.

Test wizard-subservices.test.tsx invertido para validar el nuevo
comportamiento.

Spec: docs/superpowers/specs/2026-05-22-monthly-subservice-selection-design.md §3.2

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Guards en generación

**Files:**
- Modify: `convex/functions/deliverables/actions.ts`
- Modify: `convex/functions/deliverables/invoiceFlow.ts`

- [ ] **Step 1: Localizar el handler de `generateDeliverable`**

Run:
```bash
grep -n "export const generateDeliverable = action\|if (!assignment)" convex/functions/deliverables/actions.ts
```

Espera dos líneas: el `export` (cerca de línea 176 per spec) y el guard ya existente (`if (!assignment) throw...`) cerca de línea 222 según el spec.

- [ ] **Step 2: Agregar guard de subserviceId en `generateDeliverable`**

Abrir `convex/functions/deliverables/actions.ts`. Localizar la línea:

```ts
if (!assignment) throw new Error("Asignacion no encontrada.");
```

Inmediatamente después de esa línea, insertar:

```ts
if (!assignment.subserviceId) {
  throw new Error(
    "Selecciona el subservicio del mes antes de generar el entregable. La planificación se hace desde la matriz de la proyección."
  );
}
```

- [ ] **Step 3: Localizar el flow de `generateFromInvoice`**

Run:
```bash
grep -n "assignmentId\|monthlyAssignment\|getAssignmentData" convex/functions/deliverables/invoiceFlow.ts | head -15
```

Identificar dónde se carga el `assignment`. Si NO se carga directamente con `assignmentId` antes del selector, hay que hacerlo. Lee la sección 5 ("Resolve `monthlyAssignment`") del flow.

- [ ] **Step 4: Inspeccionar el flow para entender el orden de carga**

Run: `sed -n '150,220p' convex/functions/deliverables/invoiceFlow.ts`

Tomar nota: el `assignmentId` se resuelve en líneas ~157-189. Hay un `if (!assignmentId)` que crea una asignación si no existe. Después del resolve, antes de invocar `generateDeliverable` via `templateOverride`, hay que cargar el assignment y validar subservice.

- [ ] **Step 5: Agregar guard de subserviceId en `generateFromInvoice`**

Después de la resolución de `assignmentId` (cuando ya tienes un id válido), insertar la carga + guard. El bloque exacto a agregar (justo antes del `selectDeliverableForMonth` o del `generateDeliverable` call):

```ts
// Guard: monthly cell must have a subservice picked. Per spec 2026-05-22.
const assignmentDoc = await ctx.runQuery(
  internal.functions.deliverables.internalQueries.getAssignmentData,
  { assignmentId }
);
if (!assignmentDoc?.subserviceId) {
  await ctx.runMutation(
    internal.functions.documentEvents.internal.logEventMutation,
    {
      orgId: invoice.orgId,
      clientId: invoice.clientId,
      entityType: "invoice" as const,
      entityId: invoiceId,
      eventType: "error" as const,
      severity: "warning" as const,
      actorType: "system" as const,
      message: `Generacion abortada: la celda ${invoice.month}/${invoice.year} no tiene subservicio asignado. Pide al operador planificar en la matriz.`,
      metadata: { reason: "missing_subservice", assignmentId },
    }
  );
  return { ok: false, reason: "missing_subservice" };
}
```

Nota: si `getAssignmentData` no existe con esa firma exacta, usa el query interno equivalente — `grep -n "internalQueries.*get\|getAssignment" convex/functions/deliverables/internalQueries.ts` para encontrar el correcto. Probable: `getAssignmentData({ assignmentId })`.

- [ ] **Step 6: Correr los tests de guards**

Run: `npx vitest run convex/functions/deliverables/__tests__/generateGuards.test.ts`
Expected: 2/2 pass.

- [ ] **Step 7: TypeScript check**

Run: `npx tsc --noEmit 2>&1 | grep -E "(actions|invoiceFlow)" | head -10`
Expected: sin output.

Si hay errores: revisar el import de `internal`, verificar la firma de `getAssignmentData`, y que `entityType: "invoice"` esté en el enum.

- [ ] **Step 8: Correr la suite de deliverables para verificar que no se rompió nada existente**

Run: `npx vitest run convex/functions/deliverables/__tests__/ 2>&1 | tail -5`
Expected: 0 failures.

Si algún test de `generateFromInvoice.test.ts` empieza a fallar porque ahora exige `subserviceId`, hay que actualizar el fixture del test para que el mock incluya `subserviceId`. Encuentra el setup del test y agrega.

- [ ] **Step 9: Commit**

```bash
git add convex/functions/deliverables/actions.ts convex/functions/deliverables/invoiceFlow.ts
# Si actualizaste fixtures de tests existentes:
git add convex/functions/deliverables/__tests__/

git commit -m "$(cat <<'EOF'
feat(deliverables): guards on missing subserviceId in generation paths

generateDeliverable lanza error claro si assignment.subserviceId es
null/undefined. generateFromInvoice retorna missing_subservice + log
de documentEvents (entityType invoice, severity warning) en lugar de
generar un entregable sin contexto.

Mensaje para el operador: "Selecciona el subservicio del mes antes de
generar el entregable. La planificación se hace desde la matriz de la
proyección."

Spec: docs/superpowers/specs/2026-05-22-monthly-subservice-selection-design.md §3.3

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Frontend — componente `SubserviceCellPicker`

**Files:**
- Create: `src/components/projections/subservice-cell-picker.tsx`

- [ ] **Step 1: Verificar lo que ya está disponible en lucide-react**

Los íconos usados: `ChevronDown`, `Check`, `AlertCircle`. Ya se usan en otros componentes del repo. Disponibles.

- [ ] **Step 2: Crear el archivo**

Crear `src/components/projections/subservice-cell-picker.tsx` con este contenido EXACTO:

```tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Doc } from "../../../convex/_generated/dataModel";

type Subservice = Pick<Doc<"subservices">, "_id" | "name" | "sortOrder">;

export function SubserviceCellPicker({
  current,
  options,
  onPick,
}: {
  current: Subservice | null;
  options: Subservice[];
  onPick: (id: Subservice["_id"] | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const triggerLabel = current
    ? truncate(current.name, 18)
    : "Selecciona";

  return (
    <div
      ref={ref}
      className="relative inline-block w-full"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center justify-between gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] transition-colors",
          current
            ? "border-border bg-secondary/50 text-foreground hover:bg-secondary"
            : "border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20"
        )}
        title={current?.name ?? "Subservicio sin asignar"}
      >
        {!current && <AlertCircle size={10} className="flex-shrink-0" />}
        <span className="truncate">{triggerLabel}</span>
        <ChevronDown size={10} className="flex-shrink-0 opacity-70" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-lg">
          {options
            .slice()
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((opt) => (
              <button
                key={opt._id}
                type="button"
                onClick={() => {
                  onPick(opt._id);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs hover:bg-secondary"
              >
                <span className="truncate">{opt.name}</span>
                {current?._id === opt._id && (
                  <Check size={12} className="flex-shrink-0 text-accent" />
                )}
              </button>
            ))}

          <div className="my-1 border-t border-border" />
          <button
            type="button"
            onClick={() => {
              onPick(null);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-secondary"
          >
            <AlertCircle size={12} className="flex-shrink-0" />
            Sin subservicio
          </button>
        </div>
      )}
    </div>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
```

- [ ] **Step 3: TypeScript check del nuevo archivo**

Run: `npx tsc --noEmit 2>&1 | grep "subservice-cell-picker" | head -5`
Expected: sin output.

Si hay error tipo "Cannot find module '@/lib/utils'": verifica el alias en `tsconfig.json`. Si dice "Cannot find name 'Doc'": verifica la importación de `_generated/dataModel`.

- [ ] **Step 4: Commit**

```bash
git add src/components/projections/subservice-cell-picker.tsx
git commit -m "$(cat <<'EOF'
feat(projections): add SubserviceCellPicker compact dropdown

Componente para celdas mensuales de la matriz de proyeccion: trigger
de ~120px que muestra el subservicio actual (truncado a 18 chars) o
"Selecciona" en placeholder rojo cuando no hay valor asignado.

- Click outside cierra
- stopPropagation evita abrir el drawer padre
- Listado de opciones ordenado por sortOrder
- Opcion final "Sin subservicio" para limpiar (null)

Spec: docs/superpowers/specs/2026-05-22-monthly-subservice-selection-design.md §3.4

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Frontend — integrar picker en la matriz

**Files:**
- Modify: `src/app/(dashboard)/proyecciones/[id]/page.tsx`

- [ ] **Step 1: Agregar imports**

Editar `src/app/(dashboard)/proyecciones/[id]/page.tsx`. Agregar al bloque de imports superior:

```diff
 import { MatrixCellDetail } from "@/components/projections/matrix-cell-detail";
+import { SubserviceCellPicker } from "@/components/projections/subservice-cell-picker";
+import { useOrganization } from "@clerk/nextjs";
```

Si `useMutation` no está aún en el import de convex/react (probable que sí esté), confirmar; si no, agregar.

- [ ] **Step 2: Agregar admin gate + mutation hook al inicio del componente**

Encontrar el bloque donde está `useQuery(matrix...)` o `subservicesById` (del feature de ayer). Inmediatamente después, agregar:

```ts
  const { membership } = useOrganization();
  const isAdmin = membership?.role === "org:admin";

  const setMonthSubservice = useMutation(
    api.functions.monthlyAssignments.mutations.setSubservice
  );
```

- [ ] **Step 3: Modificar el render de cada celda mensual**

Localizar el bloque que itera `months.map((monthNum, i) => {` dentro de la fila de cada servicio (aprox líneas 302-338 del page).

ANTES (estructura aproximada):
```tsx
{months.map((monthNum, i) => {
  const ma = svcAssignments.find((a) => a.month === monthNum);
  return (
    <td
      key={`${monthNum}-${i}`}
      className={cn(
        "px-2 py-2 text-center",
        ma && "cursor-pointer hover:bg-accent/5 transition-colors"
      )}
      onClick={() => ma && setSelectedAssignmentId(ma._id)}
    >
      {ma ? (
        <div className="space-y-1">
          <p className="text-xs">
            {formatCurrency(ma.amount)}
          </p>
          {/* status chip — removido por sub-spec 2026-05-21 */}
        </div>
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
    </td>
  );
})}
```

DESPUÉS — reemplazar el bloque por:

```tsx
{months.map((monthNum, i) => {
  const ma = svcAssignments.find((a) => a.month === monthNum);
  if (!ma) {
    return (
      <td key={`${monthNum}-${i}`} className="px-2 py-2 text-center">
        <span className="text-muted-foreground">—</span>
      </td>
    );
  }

  const cellSubservice = ma.subserviceId
    ? subservicesById.get(ma.subserviceId)
    : null;

  const optionsForRow = (subservices ?? []).filter(
    (s) => s.parentServiceId === svc.serviceId && s.isActive
  );

  return (
    <td
      key={`${monthNum}-${i}`}
      className={cn(
        "px-2 py-2 text-center cursor-pointer hover:bg-accent/5 transition-colors",
        !cellSubservice && "border border-destructive/40 bg-destructive/5"
      )}
      onClick={() => setSelectedAssignmentId(ma._id)}
    >
      <div className="space-y-1">
        <p className="text-xs">{formatCurrency(ma.amount)}</p>
        {isAdmin ? (
          <SubserviceCellPicker
            current={cellSubservice ?? null}
            options={optionsForRow}
            onPick={(subId) =>
              setMonthSubservice({ id: ma._id, subserviceId: subId })
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

Nota: si `subservices` (la lista, no el Map) no está disponible como variable en el scope, derivarla del Map: `const subservicesList = Array.from(subservicesById.values());`. Ajusta según el código existente.

Nota crítica: el query `subservicesById.get()` retorna `Doc<"subservices"> | undefined`. El picker espera el tipo `Subservice | null`. Coerce con `?? null` (ya está en el snippet).

- [ ] **Step 4: Correr el test específico de la página**

Run: `npx vitest run src/app/\(dashboard\)/proyecciones/__tests__/page-monthly-subservice.test.tsx`
Expected: 7/7 pass (4 del describe de la página + 3 del describe del componente).

- [ ] **Step 5: TypeScript check**

Run: `npx tsc --noEmit 2>&1 | grep -E "(proyecciones/\[id\]|subservice-cell-picker)" | head -10`
Expected: sin output.

Si hay error de tipo: posibles culpables son `cellSubservice ?? null` no quedando como `Subservice` (cast con `as Subservice | null` si necesario), o `optionsForRow` con tipo más amplio.

- [ ] **Step 6: Verificar la matriz cargue en browser**

Asume que los dev servers están corriendo (`npx convex dev` y `npm run dev`). Abre `http://localhost:3000/proyecciones/<algun-id>`. Verifica:
- Cada celda mensual tiene un dropdown abajo del monto
- Celdas sin subservicio: border rojo
- Click no abre el drawer (gracias a stopPropagation)
- Picker abre lista; eligir actualiza el estado

Si no se renderiza nada, verifica la consola del browser. Errores comunes: missing import, type mismatch, dropdown invisible por z-index — ajustar.

- [ ] **Step 7: Commit**

```bash
git add 'src/app/(dashboard)/proyecciones/[id]/page.tsx'
git commit -m "$(cat <<'EOF'
feat(proyecciones): integrate SubserviceCellPicker per cell in matrix

Cada celda mensual ahora muestra un dropdown compacto para seleccionar
el subservicio del mes (solo admins). Non-admin ven el texto del
subservicio (read-only). Celdas sin subservicio se marcan con border
rojo destructive para guiar el ojo del operator.

Spec: docs/superpowers/specs/2026-05-22-monthly-subservice-selection-design.md §3.4 + §3.5 + §3.6

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Full test sweep + tsc + GitNexus impact

**Files:** ninguno (verificación)

- [ ] **Step 1: Full test suite**

Run: `npm test 2>&1 | tail -5`
Expected: el total debe SUBIR vs baseline de Task 0. Si baseline era 796, ahora 805+ (12 tests nuevos + posiblemente 1 invertido de `wizard-subservices.test.tsx`).

Si hay failures, identificarlos:
- Tests de `generateFromInvoice.test.ts` fallando: probablemente faltan mocks con `subserviceId` — actualizar fixtures.
- Tests legacy: revisar línea por línea.

- [ ] **Step 2: TypeScript clean**

Run: `npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -10`
Expected: sin output.

- [ ] **Step 3: GitNexus refresh + impact**

Run: `npx gitnexus analyze 2>&1 | tail -3`
Expected: "Analysis complete" o similar.

Después:
```
gitnexus_impact({ target: "setSubservice", direction: "upstream" })
gitnexus_impact({ target: "generateFromInvoice", direction: "upstream" })
gitnexus_impact({ target: "SubserviceCellPicker", direction: "upstream" })
```

Risk esperado: LOW para todos. Si algo viene MEDIUM o HIGH, revisar el call site para ver si rompemos algo.

- [ ] **Step 4: detect_changes scope**

```
gitnexus_detect_changes({ scope: "compare", base_ref: "main" })
```

Verificar que los cambios solo afecten los archivos del File Structure de este plan.

---

## Task 8: Smoke E2E + merge + close ClickUp

**Files:** ninguno (verificación + merge)

- [ ] **Step 1: Verificar dev servers**

```bash
lsof -i :3000 2>&1 | head -3
```

Si no corren, arrancar:
- Terminal 1: `npx convex dev`
- Terminal 2: `npm run dev`

- [ ] **Step 2: Smoke happy path**

1. Sign-in como admin del org `org_3Bc04Ld76zZeepkBpOLRSK9XLOg` (Katimi/Org1).
2. Crear proyección nueva en `/proyecciones/nueva` — Cliente: Katimi, servicio: Legal, subservicio Step 2: "Contratos Mercantiles", año 2027 (futuro para no chocar con datos viejos).
3. Confirmar en `/proyecciones/[nuevo-id]`:
   - Columna izquierda muestra "Legal" + "Contratos Mercantiles" (del wizard) — eso es el `projectionService.subserviceId`.
   - Cada celda mensual tiene un dropdown VACÍO con border rojo (porque el monthly NO heredó).
4. Click en una celda → elegir "Gobierno Corporativo" → confirmar que la celda pierde el rojo y muestra "Gobierno Corporat…".
5. Click en otro mes → elegir "Compliance LFPDPP" → confirmar que conviven distintos.

- [ ] **Step 3: Smoke bloqueo por subservicio vacío**

1. En la proyección nueva del Step 2, dejar un mes con subservicio vacío.
2. Subir factura para ese mes y markPaid → confirmar que el deliverable NO se genera y aparece un `documentEvent` con `reason: missing_subservice`.
3. Click "Generar entregable ahora" en ese mes vacío vía override manual → confirmar que aparece el error "Selecciona el subservicio del mes antes de generar el entregable."

- [ ] **Step 4: Smoke gate por rol**

1. Sign-out, sign-in como `org:member` (no admin).
2. Abrir la misma proyección.
3. Confirmar que las celdas mensuales muestran el subservicio como TEXTO (no dropdown).

- [ ] **Step 5: Verificar proyecciones existentes (no rompemos lo viejo)**

1. Abrir una proyección de Katimi creada antes de este merge.
2. Confirmar que las celdas existentes muestran el subservicio heredado del wizard viejo (sin border rojo) y se pueden cambiar normalmente.
3. Generar entregable manual → debe funcionar (porque `subserviceId` ya está set).

- [ ] **Step 6: Merge a main**

```bash
git checkout main
git merge --no-ff feature/monthly-subservice-selection -m "$(cat <<'EOF'
Merge feature/monthly-subservice-selection

Selección de subservicio por mes en la matriz de proyección. Cierra
ClickUp 86ahfh6g2 (pieza de planificación de la 2nd review call BiHive).

Cambios:
- Wizard no hereda subserviceId al crear monthlyAssignments
- Mutation setSubservice (admin-only) con validacion parent service
- Guards en generateDeliverable y generateFromInvoice (block + log)
- Componente SubserviceCellPicker compacto en cada celda
- Visual feedback: border rojo si vacio
- 12 source-level tests nuevos

Existing proyecciones (Katimi, ACME) intactas.

Spec: docs/superpowers/specs/2026-05-22-monthly-subservice-selection-design.md
Plan: docs/superpowers/plans/2026-05-22-monthly-subservice-selection.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: GitNexus refresh post-merge**

Run: `npx gitnexus analyze`

- [ ] **Step 8: Cerrar ClickUp 86ahfh6g2**

Vía MCP:
```
clickup_update_task({ taskId: "86ahfh6g2", status: "complete" })
clickup_create_task_comment({
  taskId: "86ahfh6g2",
  comment_text: "Implementado y mergeado a main. Subservicio editable per-cell en la matriz, gated a admin, con validacion + guards en generacion. Spec + plan + tests source-level. Existing proyecciones intactas."
})
```

- [ ] **Step 9: Reporte final al user**

Texto: "feature/monthly-subservice-selection mergeada. ClickUp 86ahfh6g2 cerrado. Branch local puede borrarse con `git branch -D feature/monthly-subservice-selection`. Smoke verificado en happy path + bloqueo + gate por rol + proyecciones legacy."

---

## Notas de implementación

- **Tests en convex-test:** este repo usa source-level tests (lectura del archivo + regex). No hay convex-test real. Si el implementer escribe tests con harness convex-test, probablemente fallará la build — usar EXCLUSIVAMENTE source-level.
- **El field `subserviceId` en `monthlyAssignments` ya es optional.** No cambia el schema. Cualquier sugerencia de tocar `convex/schema.ts` es un bug del plan — escalar.
- **`documentEvents.entityType` NO incluye `"monthlyAssignment"`.** La mutation `setSubservice` NO loggea. El guard en `generateFromInvoice` SÍ loggea con `entityType: "invoice"` (que sí existe), porque el evento es a la invoice que originó el intento de generación.
- **Existing proyecciones se quedan con su `subserviceId` heredado.** Nada de migración. El operator puede pasarlos al modelo nuevo eligiendo subservicios manualmente desde la matriz si quiere.
- **El `projectionService.subserviceId` se queda intacto.** Visible en la columna sticky izquierda como hint del subservicio "principal" del servicio (feature de 2026-05-21). Los meses pueden coincidir o diferir.
- **Si el dropdown se ve mal en pantallas chicas** (8-12 columnas, 5 servicios = mucho ancho), aplicar `overflow-x-auto` al wrapper de la tabla. Pero confirmar con el user antes — quizá se prefiere reducir el ancho del trigger.
