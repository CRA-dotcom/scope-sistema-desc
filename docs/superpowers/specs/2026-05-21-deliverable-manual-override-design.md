# Override manual de generación de entregable

**Fecha:** 2026-05-21
**Sub-spec de:** `docs/superpowers/specs/2026-05-23-document-lifecycle-design.md` (A3)
**Estado:** propuesto
**Días estimados:** 0.5 (solo UI wiring + 2 tests)
**Owner:** Christian
**Dependencias:** A3 mergeado (commit `4844a41`), `matrix-cell-detail.tsx` rewrite del 2026-05-20 noche (uncommitted, debe commitearse antes o al mismo tiempo)

---

## 1. Objetivo

Cerrar la sub-decisión de la 2nd review call BiHive (2026-05-13) sobre el
**override manual** del trigger de entregable, que la implementación A3
mergeada el 2026-05-20 dejó parcialmente abierta:

- A3 implementó el trigger principal (factura pagada → entregable).
- A3 NO implementó el botón "Generar entregable ahora" para el operador.
- El drawer `matrix-cell-detail.tsx` actual tiene un bloque "Avanzado"
  cuyos botones cambian chips legacy de `monthlyAssignments` pero
  **NO disparan generación real** (warning explícito línea 193).

Este spec agrega el botón real que invoca
`deliverables.actions.generateDeliverable` con `triggerSource = "manual"`,
sin requerir factura, gated a admin, y bloqueado si ya existe entregable
para la asignación.

Cierra la tarea ClickUp `86ahfh6f5`
("[Entregables] Trigger: carga de factura → genera entregable automático"),
sección "Override manual" de la decisión de la call.

## 2. Alcance

### 2.1 Lo que toca este spec

1. `src/components/projections/matrix-cell-detail.tsx`:
   - Detectar rol admin vía `useUser` de Clerk + check
     `organizationMemberships[0].role === "org:admin"`.
   - Renderizar el bloque "Avanzado · override manual" SOLO si admin.
   - Reemplazar el warning actual del bloque (que dice "estos botones
     NO generan entregable") por: (a) warning sobre acción excepcional,
     (b) botón primario "Generar entregable ahora", (c) chips legacy
     debajo (status / facturación) que se conservan para edición rápida.
2. `src/components/projections/__tests__/matrix-cell-detail.test.tsx`:
   - Render con admin vs sin admin (visibilidad del bloque).
   - Click del botón invoca `generateDeliverable` con args correctos.
   - Botón deshabilitado cuando `deliverable` ya existe.
   - Botón deshabilitado cuando `assignment.status === "pending"`.

### 2.2 Lo que NO toca este spec

- Backend (`deliverables.actions.generateDeliverable` ya soporta el flow).
- Schema (sin cambios).
- `/facturacion` page (drawer es el único punto de entrada elegido).
- Cron de eligibility (ya mergeado y wired).
- Otros drawers o páginas.

## 3. Diseño

### 3.1 Gate de visibilidad

El bloque "Avanzado · override manual" se renderiza solo si:
`isAdmin && flags.manualOverrideAllowed`.

Esto preserva consistencia con el flag `manualOverrideAllowed` que ya
gating el "Editar monto" del mismo componente (líneas 114, 146 del archivo
actual).

```ts
const { flags } = useOrgConfig();  // ya está importado
const { user } = useUser();        // nuevo
const { organization } = useOrganization();  // ya está importado
const isAdmin = user?.organizationMemberships.some(
  (m) => m.organization.id === organization?.id && m.role === "org:admin"
) ?? false;
const canOverride = isAdmin && flags.manualOverrideAllowed;
```

No requiere cambios de backend porque `generateDeliverable` ya valida
`orgId` a través de `requireOrgMembership` heredado de los queries internos
que invoca. El gate en UI es de UX, no de seguridad.

**Si `canOverride === false`:** el bloque entero (header colapsable y
contenido) NO se renderiza. Esto difiere del comportamiento actual donde
los chips legacy están siempre visibles bajo "Avanzado". Aceptamos esa
regresión porque los chips legacy son un workaround pre-A3 y no deberían
estar al alcance de operadores sin rol admin.

### 3.2 Estructura del bloque "Avanzado"

```
┌─ ▾ Avanzado · override manual  (visible solo si isAdmin && manualOverrideAllowed)
│
│  ⚠️  Esta acción genera un entregable AHORA, sin esperar a que la
│      factura se marque como pagada. Úsala solo para casos puntuales
│      (cliente que pidió anticipo, error en pipeline, etc.).
│      Quedará registrada en el audit log como triggerSource=manual.
│
│  [ Generar entregable ahora ]    ← botón primario, ancho completo
│
│  ────────────────────────────────────────
│
│  Status de Entrega (legacy chips)
│  Status de Facturación (legacy chips)
└─
```

El header (chevron + label) ya existe; cambia el contenido interno.

### 3.3 Estados del botón

| Condición | Visual | Acción al click |
|---|---|---|
| Default (puede generar) | Botón primario activo | Confirmación → call action |
| `deliverable` existe | Disabled + `Link` "Ya existe entregable · ver" | Navega a `/entregables/{id}` |
| `assignment.status === "pending"` | Disabled gris | Tooltip "Cliente no ha respondido el cuestionario" |
| Mid-call | Disabled + spinner | — |
| Error: "no plantilla" | Toast + botón vuelve activo | Toast con link `/configuracion/plantillas` |
| Error genérico | Toast rojo + botón vuelve activo | Mensaje del error del action |

### 3.4 Click handler

```ts
const generate = useAction(api.functions.deliverables.actions.generateDeliverable);
const [loading, setLoading] = useState(false);

async function handleManualGenerate() {
  const ok = window.confirm(
    `Generar entregable ahora sin factura pagada para ${assignment.serviceName} de ${MONTH_NAMES[assignment.month - 1]} ${assignment.year}? Esto queda auditado en triggerSource=manual.`
  );
  if (!ok) return;
  setLoading(true);
  try {
    await generate({
      assignmentId: assignment._id,
      projServiceId: assignment.projServiceId,
      clientId: assignment.clientId,
      templateType: "deliverable_short",
      triggerSource: "manual",
    });
    toast.success("Entregable generado. Refrescando…");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    if (msg.includes("plantilla") || msg.includes("template")) {
      toast.error("No hay plantilla aplicable. Configura una en Plantillas.", {
        action: { label: "Abrir", onClick: () => router.push("/configuracion/plantillas") },
      });
    } else {
      toast.error(`No se pudo generar: ${msg}`);
    }
  } finally {
    setLoading(false);
  }
}
```

**Decisiones tomadas:**

- `templateType: "deliverable_short"` hardcoded. Razón: short es el formato
  default V1 según el spec A3 y el seed (1 plantilla global short). Si el
  user necesita long, regenera desde `/entregables/{id}` (que ya soporta
  ambos via dropdown).
- `window.confirm()` en lugar de dialog shadcn. Razón: acción excepcional,
  no justifica fricción de un dialog completo; el warning visible arriba
  del botón ya da contexto.
- Si no hay plantilla aplicable, toast con link en vez de redirect:
  preserva el contexto del drawer.

### 3.5 Idempotencia

El query `getByAssignment` ya retorna el deliverable existente si lo hay.
El UI bloquea click cuando `deliverable != null`. No hacemos llamada al
backend en ese caso. (El backend de todos modos no tiene idempotencia
explícita por `assignmentId` solo; la idempotencia por `triggerInvoiceId`
no aplica al path manual. Si llegara a colarse un click — race condition
muy improbable — el resultado sería un duplicado, aceptable porque admin
puede borrar el viejo desde `/entregables`.)

## 4. Tests

`src/components/projections/__tests__/matrix-cell-detail.test.tsx`:

1. `renders advanced block only when canOverride` — 4 casos: (a) admin + flag
   on → block visible; (b) admin + flag off → no block; (c) member + flag on
   → no block; (d) member + flag off → no block. Mock `useUser` y `useOrgConfig`
   acordemente.
2. `manual generate button invokes action with correct args` — click → assert
   mock action recibió `{ triggerSource: "manual", templateType: "deliverable_short", ... }`.
3. `button disabled when deliverable already exists` — mock query
   `getByAssignment` retorna deliverable, assert `disabled` attribute.
4. `button disabled when assignment status is pending` — mock assignment con
   `status: "pending"`, assert `disabled`.

E2E manual: con cliente Katimi, abrir drawer de un mes sin factura pagada,
expandir Avanzado, clickear "Generar entregable ahora", confirmar modal,
verificar que aparece en `/entregables` con `triggerSource = "manual"` y
sin `triggerInvoiceId`.

## 5. Riesgos

- **Riesgo bajo:** doble click → duplicado. Mitigación: `loading` state
  deshabilita el botón. Race a sub-100ms ignorable.
- **Riesgo bajo:** admin genera sin factura, después sube factura → 2do
  deliverable por trigger automático. Mitigación: `generateFromInvoice`
  ya tiene idempotencia por `triggerInvoiceId`, pero no chequea
  `assignmentId`. Si esto pasa, son 2 entregables del mismo mes — admin
  decide cuál mantener. No bloqueamos en este spec; documentar en
  CLAUDE.md `## Known limitations` post-merge.

## 6. Plan de implementación

1. Commit los uncommitted del 20-may noche (`matrix-cell-detail.tsx` +
   `facturacion/page.tsx` deep-link + `Handoff.md`) como baseline.
2. Branch `feature/deliverable-manual-override` desde main.
3. Edit `matrix-cell-detail.tsx` con los cambios §3.
4. Write tests §4.
5. `npm test` debe pasar (baseline 781 → 785).
6. `npx tsc --noEmit` clean.
7. Smoke E2E manual con Katimi.
8. Merge a main.
9. Cerrar ClickUp `86ahfh6f5`.

## 7. Out of scope (post-beta)

- Dropdown short/long en el override.
- Botón en `/facturacion` por fila.
- Pantalla dedicada `/entregables/generar`.
- `templateOverride` manual desde UI (override de plantilla).
