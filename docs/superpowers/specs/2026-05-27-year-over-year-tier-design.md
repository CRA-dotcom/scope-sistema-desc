# Sub-spec 6 — Year-over-year update tier

**Fecha:** 2026-05-27
**Estado:** Diseño (autopilot)
**Origen:** `docs/superpowers/specs/2026-05-22-papa-call-scale-pending-detailed-spec.md` §3 Sub-spec 6
**Estimado impl:** 2 días
**Bloquea:** nada

---

## 1. Resumen ejecutivo

Cada subservicio puede declarar un `yearOverYearDiscount` (% 0-100). Cuando admin crea una proyección nueva para un cliente, el wizard detecta si ese cliente tuvo el mismo subservicio en proyecciones de años anteriores; si sí, muestra un hint "Año 2+: -X% disponible" con botón "Aplicar" que reduce el `annualAmount`. Admin opt-in (sin auto-apply). Engine y pricing models NO cambian — la reducción es solo sobre el `annualAmount` de entrada.

Caso de uso típico: cliente X firmó "Constitución de empresa" en 2026 ($30k). En 2027 ese mismo cliente quiere "Renovación anual de obligaciones" del mismo subservicio — tier año 2+ con -50% → $15k. Admin aplica con un click en el wizard.

## 2. Requirements

- R1. Schema: `subservices.yearOverYearDiscount: v.optional(v.number())` — número entre 0 y 100 (porcentaje); undefined = no descuento configurado.
- R2. Mutation `subservices.setYearOverYearDiscount({ subserviceId, discount })`: admin global (super_admin para subservicios globales) o admin del org para subservicios org-scoped. Validar 0-100 o undefined (clear).
- R3. Query `subservices.getYearOverYearHint({ clientId, subserviceId })`: returns `{ available: boolean, priorProjectionYear?: number, discount?: number }`. Wizard la consume.
- R4. Detección "año 2+": el cliente tiene al menos UNA proyección previa (status="active" o "completed" o cualquier que no sea "draft") con un `projectionServices` row con el mismo `subserviceId`. La diferencia de año debe ser `>= 1` respecto a la proyección que se está creando.
- R5. Aplicación: admin clickea "Aplicar -X%". El wizard reduce `annualAmount` del row local; al guardar, la mutation de creación/edición de projectionServices recibe el `annualAmount` ya reducido. NO hay flag persistente "este row aplica descuento" — se queda como `annualAmount` reducido.
- R6. Audit trail: log en `documentEvents` con `eventType='updated'`, `entityType='projection'`, mensaje "Año 2+ aplicado: -X% en subservicio Y" para reproducibilidad.
- R7. UI `/configuracion/servicios`: nueva columna o sección "Descuento año 2+" con input por subservicio.
- R8. UI Wizard / `/proyecciones/[id]`: chip "Año 2+: -X% disponible" en filas elegibles, con botón "Aplicar".

## 3. Arquitectura

```
┌────────────────────────────────────────────────────────────┐
│  SETUP (config admin)                                       │
│  /configuracion/servicios → setYearOverYearDiscount         │
│   (subservicios globales o org)                             │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│  CREACIÓN PROYECCIÓN (wizard)                               │
│  Por cada subservicio que admin agrega:                     │
│    getYearOverYearHint(clientId, subserviceId)              │
│       → busca proyecciones previas del cliente              │
│       → returns { available, priorProjectionYear, discount }│
│    Si available → render chip + button "Aplicar"            │
└────────────────────────┬───────────────────────────────────┘
                         │ admin clica Aplicar
                         ▼
┌────────────────────────────────────────────────────────────┐
│  UI local: reduce annualAmount in row state                │
│  (row.annualAmount *= (1 - discount/100))                  │
│  Persist on save via existing projectionServices mutation  │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│  AUDIT                                                      │
│  Insert documentEvents row:                                 │
│    entityType='projection', entityId=projectionId,         │
│    eventType='updated', message='Año 2+ aplicado -X% en S' │
└────────────────────────────────────────────────────────────┘
```

## 4. Schema changes

`subservices` — agregar field:

```ts
{
  // ...existing fields
  // SS6: % discount for "year 2+" tier when client renews same subservicio.
  // 0-100; undefined = no discount configured.
  yearOverYearDiscount: v.optional(v.number()),
}
```

Sin nuevos índices.

## 5. Detección de "año 2+"

Lógica del query `getYearOverYearHint`:

```ts
async function getYearOverYearHint(ctx, { clientId, subserviceId }) {
  const orgId = await getOrgId(ctx);
  if (!orgId) return { available: false };

  // 1. Get the subservice to check if it has a discount configured
  const sub = await ctx.db.get(subserviceId);
  if (!sub) return { available: false };
  if (!sub.yearOverYearDiscount || sub.yearOverYearDiscount === 0) {
    return { available: false };
  }

  // 2. Find any prior projection for this client that included this subservice
  const projections = await ctx.db
    .query("projections")
    .withIndex("by_orgId_clientId", q => q.eq("orgId", orgId).eq("clientId", clientId))
    .collect();

  // Filter non-draft projections (active/completed/etc)
  const activeProjections = projections.filter(p => p.status !== "draft");

  for (const proj of activeProjections) {
    const projServices = await ctx.db
      .query("projectionServices")
      .withIndex("by_projectionId", q => q.eq("projectionId", proj._id))
      .collect();

    const hasMatch = projServices.some(ps => ps.subserviceId === subserviceId);
    if (hasMatch) {
      return {
        available: true,
        priorProjectionYear: proj.year,
        discount: sub.yearOverYearDiscount,
      };
    }
  }

  return { available: false };
}
```

If `projections` doesn't have `by_orgId_clientId` index, use existing index and filter, OR add the index.

## 6. Mutation `setYearOverYearDiscount`

```ts
export const setYearOverYearDiscount = mutation({
  args: {
    subserviceId: v.id("subservices"),
    discount: v.optional(v.number()), // 0-100, undefined to clear
  },
  handler: async (ctx, args) => {
    const sub = await ctx.db.get(args.subserviceId);
    if (!sub) throw new Error("Subservicio no encontrado");

    // Auth: global subservices (orgId=undefined) require super_admin;
    //   org-scoped require requireAdmin (org admin).
    if (sub.orgId === undefined) {
      await requireSuperAdmin(ctx);
    } else {
      await requireAdmin(ctx);
      const orgId = await getOrgId(ctx);
      if (sub.orgId !== orgId) {
        throw new Error("Subservicio no pertenece al org");
      }
    }

    if (args.discount !== undefined) {
      if (args.discount < 0 || args.discount > 100) {
        throw new Error("discount debe estar entre 0 y 100");
      }
    }

    await ctx.db.patch(args.subserviceId, {
      yearOverYearDiscount: args.discount,
      updatedAt: Date.now(),
    });

    return { ok: true };
  },
});
```

## 7. UI changes

### 7.1 `/configuracion/servicios`

Add input column "Descuento año 2+" per subservicio row. Render numeric input bound to `setYearOverYearDiscount` mutation. Empty input = clear (undefined).

### 7.2 Wizard / `/proyecciones/[id]` matrix

For each `projectionService` row, call `getYearOverYearHint({ clientId, subserviceId })`. If `available`:

```tsx
<span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-800">
  Año 2+: -{discount}% disponible
  <button
    onClick={() => applyYearOverYear(row, discount)}
    className="ml-2 text-blue-600 underline"
  >
    Aplicar
  </button>
</span>
```

`applyYearOverYear` reduces `annualAmount` by `discount%`, calls the existing update mutation, and logs the documentEvents row.

## 8. Audit (documentEvents)

When admin applies the discount, insert:
```ts
{
  orgId,
  clientId,
  entityType: "projection",
  entityId: projectionId,
  eventType: "updated",
  severity: "info",
  actorType: "user",
  message: `Tier año 2+ aplicado: -${discount}% en subservicio ${subName}.`,
  metadata: { subserviceId, discount, priorAmount, newAmount },
}
```

## 9. Testing

**Unit (~8 tests):**
- `setYearOverYearDiscount`: admin sets/clears, validates 0-100, rejects 101 and -1, super_admin for globals, cross-org reject
- `getYearOverYearHint`: returns available when match found, not available when no prior, not available when subservice has no discount, ignores draft projections
- Mutation/query auth (admin only)

**Integration (~3 tests):**
- Admin flow: configure discount → create projection for returning client → hint shows → apply → annualAmount reduces

**UI smoke (manual):**
- Config UI shows + persists discount
- Wizard shows hint + applies discount visibly

**Target:** +11 tests (941 → ~952).

## 10. Decisiones diferidas

- Aplicación automática (sin opt-in) — defer; admin opt-in es más seguro para MVP
- Discount escalonado año 2 / año 3 / año 4 — defer; un único % por subservicio
- Discount global (cross-subservice) — defer
- UI: ranking de "clientes elegibles para tier año 2+" en dashboard — defer

## 11. Próximo paso

Plan + ejecución subagent-driven autopilot.
