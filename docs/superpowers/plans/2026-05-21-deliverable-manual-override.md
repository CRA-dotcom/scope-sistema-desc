# Override Manual de Entregable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un botón "Generar entregable ahora" en el drawer `matrix-cell-detail.tsx` que invoca `deliverables.generateDeliverable` con `triggerSource: "manual"`, gated por `isAdmin && manualOverrideAllowed`, bloqueado si ya existe entregable o si el cliente no ha respondido el cuestionario.

**Architecture:** UI-only. Backend (`generateDeliverable` action) ya soporta `triggerSource: "manual"` sin `triggerInvoiceId`. La detección de admin reusa el patrón `useOrganization().membership?.role === "org:admin"` que ya usan `/configuracion/branding`, `/configuracion/notificaciones`, etc. Feedback de errores via banners inline (el repo no tiene toast library). Tests son source-level (regex sobre el archivo fuente) siguiendo la convención de `branding/__tests__/page.test.tsx`.

**Tech Stack:** Next.js 15 App Router (cliente), React 19, Convex (`useAction`, `useQuery`), Clerk (`useOrganization`), Tailwind, Lucide icons. Tests: Vitest source-level.

**Spec:** `docs/superpowers/specs/2026-05-21-deliverable-manual-override-design.md`

---

## File Structure

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `src/components/projections/matrix-cell-detail.tsx` | Modificar | Wiring del botón override + admin gate + banner inline |
| `src/components/projections/__tests__/matrix-cell-detail.test.tsx` | Crear | 9 source-level tests verificando contrato |
| `docs/superpowers/specs/2026-05-21-deliverable-manual-override-design.md` | (sin cambios) | Spec ya commiteado en `90a5758` |

Las funciones helpers `deriveLifecycle`, `PrimaryAction`, `StepRow` y los constants (`MONTH_NAMES`, `STATUS_OPTIONS`, `INVOICE_OPTIONS`) no se tocan. Solo cambia el cuerpo del componente principal `MatrixCellDetail` entre las líneas que renderizan el bloque "Avanzado".

---

## Task 0: Baseline uncommitted del 20-may noche

**Pre-work crítico.** Los cambios uncommitted del 20-may noche (drawer redesign + facturacion deep-link + Handoff) son el baseline sobre el que este feature construye. Sin commiteari estos primero, el feature mezcla 2 unidades de trabajo en un solo commit.

**ASK USER FIRST**: "Antes de empezar el feature, ¿commiteamos los 3 archivos uncommitted del 20-may como baseline?"

Si el usuario aprueba:

**Files:**
- Modify (commit existing): `src/app/(dashboard)/facturacion/page.tsx`
- Modify (commit existing): `src/components/projections/matrix-cell-detail.tsx`
- Modify (commit existing): `Handoff.md`

- [ ] **Step 1: Confirmar status del working tree**

Run: `git status -s`
Expected: 3 archivos modificados (M).

- [ ] **Step 2: Diff sanity check**

Run: `git diff --stat HEAD`
Expected: cambios contenidos a esos 3 archivos.

- [ ] **Step 3: Commit baseline**

```bash
git add src/app/\(dashboard\)/facturacion/page.tsx src/components/projections/matrix-cell-detail.tsx Handoff.md
git commit -m "$(cat <<'EOF'
feat(drawer+facturacion): redesign matrix-cell drawer + deep-link /facturacion

Drawer matrix-cell rewrite (~330 LOC): stepper visual del ciclo entregable,
CTA primaria contextual al stage, bloque 'Avanzado' colapsado para chips
legacy con warning explicito de que no generan entregable.

/facturacion ahora respeta ?year=&month= como deep-link desde el drawer.

Handoff actualizado con notas de la sesion 20-may noche.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verificar baseline**

Run: `npm test 2>&1 | tail -3`
Expected: `Tests  781 passed | 1 skipped` (baseline pre-feature).

Run: `npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -5`
Expected: sin output (sin errores TypeScript).

---

## Task 1: Crear branch + archivo de tests con los 9 tests fallando

**Files:**
- Create branch: `feature/deliverable-manual-override`
- Create: `src/components/projections/__tests__/matrix-cell-detail.test.tsx`

- [ ] **Step 1: Branch desde main**

Run: `git checkout -b feature/deliverable-manual-override`
Expected: `Switched to a new branch 'feature/deliverable-manual-override'`

- [ ] **Step 2: Verificar el dir de tests existe**

Run: `ls src/components/projections/__tests__/ 2>/dev/null || mkdir -p src/components/projections/__tests__`
Expected: directorio existe o se crea.

- [ ] **Step 3: Crear el archivo de tests completo**

Crear `src/components/projections/__tests__/matrix-cell-detail.test.tsx` con este contenido exacto:

```ts
/**
 * Source-level tests for MatrixCellDetail drawer — override manual block.
 *
 * Verifica el contrato del bloque "Avanzado · override manual" agregado
 * por el sub-spec docs/superpowers/specs/2026-05-21-deliverable-manual-override-design.md
 *
 * Convención del repo: source-level tests (lee el archivo como texto y
 * verifica estructura). Patrón visible en
 * src/app/(dashboard)/configuracion/branding/__tests__/page.test.tsx.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(
  resolve(__dirname, "../matrix-cell-detail.tsx"),
  "utf-8"
);

describe("MatrixCellDetail — override manual block", () => {
  it("imports useOrganization from Clerk for admin detection", () => {
    expect(SOURCE).toMatch(
      /import\s*\{[^}]*useOrganization[^}]*\}\s*from\s*"@clerk\/nextjs"/
    );
  });

  it("derives canOverride from admin role AND manualOverrideAllowed flag", () => {
    expect(SOURCE).toContain('membership?.role === "org:admin"');
    expect(SOURCE).toContain("flags.manualOverrideAllowed");
    expect(SOURCE).toMatch(/canOverride\s*=/);
  });

  it("renders the Avanzado block only when canOverride is true", () => {
    expect(SOURCE).toMatch(/\{canOverride\s*&&\s*\(/);
  });

  it("invokes generateDeliverable action with triggerSource manual and short template", () => {
    expect(SOURCE).toMatch(
      /useAction\(\s*api\.functions\.deliverables\.actions\.generateDeliverable/
    );
    expect(SOURCE).toContain('triggerSource: "manual"');
    expect(SOURCE).toContain('templateType: "deliverable_short"');
  });

  it("confirms before generating with a window.confirm prompt", () => {
    expect(SOURCE).toMatch(/window\.confirm\(/);
    expect(SOURCE).toContain("triggerSource=manual");
  });

  it("disables the button when deliverable already exists", () => {
    expect(SOURCE).toMatch(/Ya existe entregable/);
    expect(SOURCE).toMatch(/\/entregables\/\$\{deliverable\._id\}/);
  });

  it("disables the button when assignment.status is pending", () => {
    expect(SOURCE).toMatch(/assignment\.status\s*===\s*"pending"/);
    expect(SOURCE).toContain("Cliente no ha respondido");
  });

  it("renders inline banner with link to plantillas when template is missing", () => {
    expect(SOURCE).toContain('"missing-template"');
    expect(SOURCE).toMatch(/\/configuracion\/plantillas/);
  });

  it("does not import any toast library (repo convention)", () => {
    expect(SOURCE).not.toMatch(/from\s*"sonner"/);
    expect(SOURCE).not.toMatch(/react-hot-toast/);
  });
});
```

- [ ] **Step 4: Correr el test file aislado y confirmar que falla**

Run: `npx vitest run src/components/projections/__tests__/matrix-cell-detail.test.tsx`
Expected: 9 tests fallan (en su mayoría — el test 9 "does not import toast" puede pasar desde el inicio si el archivo nunca importó sonner). Confirma que al menos los tests 1-8 fallan con assertions específicas.

- [ ] **Step 5: Commit el test file (red)**

```bash
git add src/components/projections/__tests__/matrix-cell-detail.test.tsx
git commit -m "$(cat <<'EOF'
test(matrix-cell-detail): add 9 source-level tests for override manual (red)

Tests del contrato del bloque "Avanzado · override manual" que se
implementara en commits siguientes. 8/9 fallan ahora; ultimo pasa
porque el archivo no importaba ninguna toast lib antes.

Spec: docs/superpowers/specs/2026-05-21-deliverable-manual-override-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Imports + admin gate (tests 1, 2, 9 verdes)

**Files:**
- Modify: `src/components/projections/matrix-cell-detail.tsx` (líneas 1-72)

- [ ] **Step 1: Agregar imports de Clerk y Convex `useAction`**

Editar el bloque de imports al inicio del archivo. Cambio exacto:

```diff
 "use client";

 import Link from "next/link";
-import { useMutation, useQuery } from "convex/react";
+import { useMutation, useQuery, useAction } from "convex/react";
+import { useOrganization } from "@clerk/nextjs";
 import { api } from "../../../convex/_generated/api";
 import { Doc } from "../../../convex/_generated/dataModel";
 import {
   X,
   Upload,
   FileText,
   CheckCircle2,
   Clock,
   ExternalLink,
   AlertCircle,
   ChevronDown,
   ChevronUp,
 } from "lucide-react";
 import { formatCurrency } from "@/lib/utils";
 import { useState } from "react";
 import { useOrgConfig } from "@/lib/useOrgConfig";
```

- [ ] **Step 2: Agregar `useOrganization` + `canOverride` dentro del componente**

Encontrar la línea `const { flags } = useOrgConfig();` (~línea 56). Inmediatamente después, agregar:

```ts
const { membership, isLoaded: orgLoaded } = useOrganization();
const isAdmin = membership?.role === "org:admin";
const canOverride = orgLoaded && isAdmin && flags.manualOverrideAllowed;
```

- [ ] **Step 3: Correr tests 1, 2, 9**

Run: `npx vitest run src/components/projections/__tests__/matrix-cell-detail.test.tsx -t "useOrganization|canOverride|toast"`
Expected: 3 tests pasan (`imports useOrganization`, `derives canOverride`, `does not import any toast library`).

- [ ] **Step 4: Type check**

Run: `npx tsc --noEmit 2>&1 | grep "matrix-cell-detail" | head -5`
Expected: sin output.

- [ ] **Step 5: Commit**

```bash
git add src/components/projections/matrix-cell-detail.tsx
git commit -m "$(cat <<'EOF'
feat(matrix-cell-detail): import useOrganization + derive canOverride

Step 1/5 del override manual: agrega detection de admin via
useOrganization().membership.role (patron del repo) y combina con
flags.manualOverrideAllowed para derivar canOverride.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Gate del bloque "Avanzado" detrás de `canOverride` (test 3 verde)

**Files:**
- Modify: `src/components/projections/matrix-cell-detail.tsx` (línea ~179)

- [ ] **Step 1: Wrap del bloque "Avanzado" con `canOverride &&`**

Encontrar la línea `<div className="border-t border-border pt-4">` (~línea 179). Cambiar:

```diff
-        <div className="border-t border-border pt-4">
-          <button
-            onClick={() => setShowAdvanced((v) => !v)}
+        {canOverride && (
+          <div className="border-t border-border pt-4">
+            <button
+              onClick={() => setShowAdvanced((v) => !v)}
```

Y el cierre correspondiente — encontrar el `</div>` de cierre del bloque (justo antes de `</div>` final del wrapper interior, ~línea 238):

```diff
-          )}
-        </div>
+            )}
+          </div>
+        )}
       </div>
     </div>
   );
```

Re-indenta el contenido del bloque por +2 espacios (todo lo que estaba dentro del `<div className="border-t...">`).

- [ ] **Step 2: Correr test 3**

Run: `npx vitest run src/components/projections/__tests__/matrix-cell-detail.test.tsx -t "Avanzado block only when canOverride"`
Expected: pasa.

- [ ] **Step 3: Type check + tests previos siguen verdes**

Run: `npx tsc --noEmit 2>&1 | grep "matrix-cell-detail" | head -5`
Expected: sin output.

Run: `npx vitest run src/components/projections/__tests__/matrix-cell-detail.test.tsx -t "useOrganization|canOverride|toast|Avanzado"`
Expected: 4 tests pasan.

- [ ] **Step 4: Commit**

```bash
git add src/components/projections/matrix-cell-detail.tsx
git commit -m "$(cat <<'EOF'
feat(matrix-cell-detail): gate Avanzado block behind canOverride

Step 2/5: el bloque Avanzado (override manual + chips legacy) ahora
es invisible para members no-admin y para orgs sin manualOverrideAllowed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Reemplazar warning + agregar botón "Generar entregable ahora" (tests 4, 5 verdes)

**Files:**
- Modify: `src/components/projections/matrix-cell-detail.tsx`

- [ ] **Step 1: Agregar state + action + handler dentro del componente**

Cerca de los otros `useState` (~línea 70-72), agregar:

```ts
const generateNow = useAction(
  api.functions.deliverables.actions.generateDeliverable
);
const [generating, setGenerating] = useState(false);
const [errorBanner, setErrorBanner] = useState<
  | { kind: "missing-template" }
  | { kind: "generic"; message: string }
  | null
>(null);

async function handleManualGenerate() {
  const ok = window.confirm(
    `Generar entregable ahora sin factura pagada para ${assignment.serviceName} de ${MONTH_NAMES[assignment.month - 1]} ${assignment.year}? Esto queda auditado en triggerSource=manual.`
  );
  if (!ok) return;
  setErrorBanner(null);
  setGenerating(true);
  try {
    await generateNow({
      assignmentId: assignment._id,
      projServiceId: assignment.projServiceId,
      clientId: assignment.clientId,
      templateType: "deliverable_short",
      triggerSource: "manual",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    if (msg.toLowerCase().includes("plantilla") || msg.toLowerCase().includes("template")) {
      setErrorBanner({ kind: "missing-template" });
    } else {
      setErrorBanner({ kind: "generic", message: msg });
    }
  } finally {
    setGenerating(false);
  }
}
```

- [ ] **Step 2: Reemplazar el contenido viejo del bloque Avanzado**

Encontrar el bloque entre `{showAdvanced && (` y su cierre `)}` (~líneas 187-237). Reemplazarlo COMPLETO por:

```tsx
{showAdvanced && (
  <div className="mt-4 space-y-5">
    <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
      <p className="flex items-start gap-2 text-xs text-warning leading-relaxed">
        <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
        <span>
          Esta acción genera un entregable <strong>AHORA</strong>, sin
          esperar a que la factura se marque como pagada. Úsala solo para
          casos puntuales (anticipo, error en pipeline). Queda registrada
          en el audit log como <code>triggerSource=manual</code>.
        </span>
      </p>
    </div>

    <ManualGenerateButton
      deliverable={deliverable}
      assignment={assignment}
      generating={generating}
      onGenerate={handleManualGenerate}
    />

    {errorBanner?.kind === "missing-template" && (
      <p className="text-xs text-warning flex items-start gap-2">
        <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
        <span>
          No hay plantilla aplicable para este subservicio.{" "}
          <Link href="/configuracion/plantillas" className="underline">
            Configurar plantilla
          </Link>
          .
        </span>
      </p>
    )}
    {errorBanner?.kind === "generic" && (
      <p className="text-xs text-destructive flex items-start gap-2">
        <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
        <span>{errorBanner.message}</span>
      </p>
    )}

    <div className="border-t border-border pt-4 space-y-5">
      <div>
        <p className="text-xs text-muted-foreground mb-2">Status de Entrega (legacy)</p>
        <div className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => updateStatus({ id: assignment._id, status: opt.value })}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
                assignment.status === opt.value
                  ? opt.color
                  : "bg-secondary text-muted-foreground hover:bg-secondary/80"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs text-muted-foreground mb-2">Status de Facturación (legacy)</p>
        <div className="flex flex-wrap gap-2">
          {INVOICE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => updateInvoice({ id: assignment._id, invoiceStatus: opt.value })}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
                assignment.invoiceStatus === opt.value
                  ? "bg-accent/20 text-accent"
                  : "bg-secondary text-muted-foreground hover:bg-secondary/80"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 3: Agregar componente helper `ManualGenerateButton` al final del archivo**

Al final del archivo, después de `function StepRow(...)`, antes del `type LifecycleStage`, agregar:

```tsx
function ManualGenerateButton({
  deliverable,
  assignment,
  generating,
  onGenerate,
}: {
  deliverable: Doc<"deliverables"> | null | undefined;
  assignment: Doc<"monthlyAssignments">;
  generating: boolean;
  onGenerate: () => void;
}) {
  if (deliverable) {
    return (
      <Link
        href={`/entregables/${deliverable._id}`}
        className="flex w-full items-center justify-between rounded-md border border-border bg-secondary/50 px-4 py-3 text-sm font-medium text-muted-foreground hover:bg-secondary transition-colors"
      >
        <span className="flex items-center gap-2">
          <CheckCircle2 size={16} />
          Ya existe entregable — ver
        </span>
        <ExternalLink size={14} />
      </Link>
    );
  }
  if (assignment.status === "pending") {
    return (
      <button
        disabled
        title="Cliente no ha respondido el cuestionario"
        className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-muted px-4 py-3 text-sm font-medium text-muted-foreground cursor-not-allowed"
      >
        <Clock size={16} />
        Cliente no ha respondido el cuestionario
      </button>
    );
  }
  return (
    <button
      onClick={onGenerate}
      disabled={generating}
      className="flex w-full items-center justify-center gap-2 rounded-md bg-warning px-4 py-3 text-sm font-medium text-primary hover:bg-warning/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {generating ? (
        <>
          <Clock size={16} className="animate-pulse" />
          Generando…
        </>
      ) : (
        <>
          <AlertCircle size={16} />
          Generar entregable ahora
        </>
      )}
    </button>
  );
}
```

- [ ] **Step 4: Correr tests 4, 5**

Run: `npx vitest run src/components/projections/__tests__/matrix-cell-detail.test.tsx -t "generateDeliverable action|window.confirm"`
Expected: 2 tests pasan.

- [ ] **Step 5: Type check**

Run: `npx tsc --noEmit 2>&1 | grep "matrix-cell-detail" | head -5`
Expected: sin output.

- [ ] **Step 6: Commit**

```bash
git add src/components/projections/matrix-cell-detail.tsx
git commit -m "$(cat <<'EOF'
feat(matrix-cell-detail): add Generar entregable ahora button + handler

Step 3/5: el boton invoca deliverables.generateDeliverable con
triggerSource manual y templateType deliverable_short. Confirma via
window.confirm. Estados de loading/error manejados con state local.
ManualGenerateButton extraido como componente helper.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Verificar estados disabled (tests 6, 7 verdes)

Los tests 6 y 7 verifican estructura del `ManualGenerateButton` introducido en Task 4. Como Task 4 ya pasa `assignment` entero (no solo el status), la comparación `assignment.status === "pending"` aparece literal en el source. Esta task es solo verificación.

**Files:**
- (sin cambios — solo verificación)

- [ ] **Step 1: Correr tests 6, 7**

Run: `npx vitest run src/components/projections/__tests__/matrix-cell-detail.test.tsx -t "deliverable already exists|status is pending"`
Expected: 2 tests pasan.

- [ ] **Step 2: Si test 6 falla**

El regex busca `/\/entregables\/\$\{deliverable\._id\}/`. Verifica que el `<Link href>` en `ManualGenerateButton` use template literal con `deliverable._id`, no string concat (`"/entregables/" + deliverable._id`).

- [ ] **Step 3: Si test 7 falla**

El regex busca `assignment.status === "pending"` literal y la string `"Cliente no ha respondido"`. Verifica:
- El helper compare `assignment.status === "pending"` (no un alias renombrado).
- El texto en el `<button>` contiene "Cliente no ha respondido" (case-sensitive).

---

## Task 6: Banner inline para plantilla faltante (test 8 verde)

El test 8 verifica que `"missing-template"` y `/configuracion/plantillas` aparezcan en el source. Ambos ya están en el código agregado en Task 4. Esta task es verificación.

**Files:**
- (sin cambios — solo verificación)

- [ ] **Step 1: Correr test 8**

Run: `npx vitest run src/components/projections/__tests__/matrix-cell-detail.test.tsx -t "missing"`
Expected: pasa.

- [ ] **Step 2: Si falla, verificar**

El test busca:
- `'"missing-template"'` literal — debe aparecer en el discriminated union de `errorBanner` y en el conditional render. Verifica ambos.
- `/configuracion/plantillas` — debe aparecer en el `href` del Link dentro del banner.

Si alguno falta, agregarlo según el código de Task 4 Step 2.

---

## Task 7: Verificar test 9 + full test pass + tsc clean

**Files:**
- (sin cambios — solo verificación)

- [ ] **Step 1: Correr el suite completo del archivo**

Run: `npx vitest run src/components/projections/__tests__/matrix-cell-detail.test.tsx`
Expected: `9 passed`.

- [ ] **Step 2: Full test suite del repo**

Run: `npm test 2>&1 | tail -5`
Expected: `Tests  790 passed | 1 skipped` (baseline 781 + 9 nuevos del archivo).

Si algún test pre-existente falla, debuggear — el feature no debería romper nada.

- [ ] **Step 3: TypeScript clean**

Run: `npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -10`
Expected: sin output.

- [ ] **Step 4: GitNexus refresh + impact check**

Run: `npx gitnexus analyze 2>&1 | tail -5`
Expected: "Analysis complete" o similar.

Run: `gitnexus_impact({target: "MatrixCellDetail", direction: "upstream"})` via MCP.
Expected: solo `/proyecciones/[id]/page.tsx` lo usa. Risk LOW. Si MEDIUM o HIGH, revisar antes de mergear.

---

## Task 8: Smoke E2E manual + merge + close ClickUp

**Files:**
- (sin cambios de código)

- [ ] **Step 1: Levantar dev servers**

En terminales separadas:
- `npx convex dev` (espera "Convex functions ready")
- `npm run dev` (espera Next.js en :3000 o :3002)

- [ ] **Step 2: Preparar org-admin permissions**

Sign-in con un user que tenga rol `org:admin` en `org_3Bc04Ld76zZeepkBpOLRSK9XLOg` (Org1 Katimi/ACME).

Verificar que `orgConfigs.featureFlags.manualOverrideAllowed = true` para este org. Si no, setearlo:

```bash
# Via convex dashboard (https://dashboard.convex.dev) o:
npx convex run functions/orgConfigs:updateFeatureFlag --orgId "org_3Bc04Ld76zZeepkBpOLRSK9XLOg" --flag manualOverrideAllowed --value true
```

(Si el helper no existe, hacerlo manualmente desde el Convex dashboard editando la row de `orgConfigs`.)

- [ ] **Step 3: Smoke test — happy path**

1. Abrir cualquier proyección activa de Katimi.
2. Click en una celda mensual SIN factura pagada.
3. Drawer abre con stepper.
4. Click "Avanzado · override manual" → expande.
5. Verificar warning visible.
6. Click "Generar entregable ahora" → modal de confirmación aparece.
7. Confirmar → botón muestra "Generando…".
8. En 5-15 segundos, el botón cambia a "Ya existe entregable — ver".
9. Click → navega a `/entregables/{id}`.
10. En la página del entregable, verificar metadata: `triggerSource: "manual"`, `triggerInvoiceId: undefined`.

- [ ] **Step 4: Smoke test — bloqueado por status pending**

1. Repetir Step 3.1-3.4 para una celda con `status: "pending"`.
2. Verificar botón disabled con texto "Cliente no ha respondido el cuestionario".

- [ ] **Step 5: Smoke test — bloqueado por entregable existente**

1. Repetir Step 3.1-3.4 sobre la celda donde ya se generó en Step 3.
2. Verificar que muestra "Ya existe entregable — ver" en lugar del botón.

- [ ] **Step 6: Smoke test — gate por rol**

1. Sign-out, sign-in como `org:member` (no admin) del mismo org.
2. Abrir el mismo drawer.
3. Verificar que el header "Avanzado · override manual" NO aparece.

- [ ] **Step 7: Merge a main**

```bash
git checkout main
git merge --no-ff feature/deliverable-manual-override -m "$(cat <<'EOF'
Merge feature/deliverable-manual-override

Override manual de generacion de entregable. Cierra ClickUp 86ahfh6f5
(sub-decision de la 2nd review call BiHive sobre boton "Generar
entregable ahora").

Sub-spec: docs/superpowers/specs/2026-05-21-deliverable-manual-override-design.md
Plan:     docs/superpowers/plans/2026-05-21-deliverable-manual-override.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: GitNexus refresh post-merge**

Run: `npx gitnexus analyze`
Expected: index actualizado al merge commit.

- [ ] **Step 9: Cerrar ClickUp 86ahfh6f5**

Via MCP tool `clickup_update_task`:

```ts
clickup_update_task({
  taskId: "86ahfh6f5",
  status: "complete",
  comment: "Implementado: override manual del trigger en matrix-cell-detail (admin + manualOverrideAllowed flag). Spec + plan + tests. Merge commit en main."
})
```

- [ ] **Step 10: Reporte final al user**

Texto al user: "Override manual mergeado a main. ClickUp 86ahfh6f5 cerrado. Branch local `feature/deliverable-manual-override` puede borrarse. Próxima tarea pendiente de hoy: la de WhatsApp (que dijiste dejar para después)."

---

## Notas de implementación

- **Sin cambios de schema ni backend.** Si algún task sugiere tocar `convex/`, es un bug del plan — escalar.
- **No agregar dependencias.** `useOrganization` ya está en `@clerk/nextjs`. Si vitest/typescript tiran error de import, verificar versión existente en `package.json`, no instalar nada nuevo.
- **`ManualGenerateButton` recibe el `assignment` entero**, no solo el status. Esto mantiene `assignment.status === "pending"` literal en el source, que es lo que el test 7 verifica con regex.
- **`window.confirm` está bien.** No reemplazar por shadcn Dialog — es decisión del spec, simplifica el alcance.
- **Si `generateDeliverable` falla con un mensaje en español que no contiene "plantilla" o "template"**, cae al banner genérico. Eso está bien — el error message viaja literal del backend.
