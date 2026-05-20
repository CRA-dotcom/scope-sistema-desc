# B1 — Client Services Overview + Mid-Year Add-on

**Fecha:** 2026-05-26
**Sub-spec del maestro:** `docs/superpowers/specs/2026-05-20-prod-readiness-revision.md`
**Estado:** propuesto
**Días estimados:** 1
**Dependencias:** R1 aprobado, A1 mergeado (schema `subservices` + `subserviceId` opcional en 6 tablas + seed). A2 conviene pero NO bloquea (B1 no toca plantillas). A3 NO bloquea (selector consume `startMonth`/`endMonth` que B1 introduce; coordinar PR order A1 → A3 → B1, ver §7).
**Owner:** Christian

---

## 1. Objetivo

R1 §6 fija el caso de uso: el operador entra a `/clientes/[id]`, ve un panel
"Servicios contratados" con cada subservicio activo (frecuencia, ventana de
meses, monto, estado) agrupado por servicio padre, y puede agregar un
subservicio nuevo a mitad de año desde un modal — sin reabrir la proyección
original ni mezclar facturación. El add-on dispara una cotización
suplementaria (ligada al `parentQuotationId` original) que se cobra prorrateada
calendario julio→diciembre, y la renovación anual queda unificada el 1-ene.

B1 entrega ese panel y ese modal. Backend: una query agregada
(`clients.getServicesOverview`), una mutation que crea fila en
`projectionServices` con ventana mensual (`startMonth`/`endMonth`) más una
cotización suplementaria (`projections.addSubserviceMidYear`), y un helper
`quotations.createSupplementary` que reutiliza el flujo accept/decline
existente con un nuevo campo `parentQuotationId` para audit trail. Frontend:
nueva sección en `/clientes/[id]/page.tsx` después del bloque "Proyecciones",
modal shadcn `Dialog`, y un banner discreto en la vista de cotización
suplementaria. B1 NO reemplaza `/clientes/[id]/ciclo` (vista paralela
workflow-centric); convive.

A3 `selectDeliverableForMonth` debe respetar la ventana
`[startMonth, endMonth]` de `projectionServices` cuando esté presente — eso lo
documenta B1 §4.2 (deuda hacia A3) pero el patch concreto vive en A3 PR.

---

## 2. Backend

Nuevo módulo `convex/functions/clients/queries.ts` (extender el existente con
`getServicesOverview`), patches a `convex/functions/projections/mutations.ts`
y a `convex/functions/quotations/mutations.ts`. Schema patch acotado a
`projectionServices` y `quotations`.

### 2.1 Schema

Diff sobre `convex/schema.ts:168-180` (`projectionServices`) — añadir 3
campos opcionales **después de** `subserviceId` (insertado por A1):

```ts
projectionServices: defineTable({
  orgId: v.string(),
  projectionId: v.id("projections"),
  serviceId: v.id("services"),
  serviceName: v.string(),
  subserviceId: v.optional(v.id("subservices")),   // A1
  chosenPct: v.number(),
  isActive: v.boolean(),
  annualAmount: v.number(),
  normalizedWeight: v.number(),

  // B1 — ventana contractual del row.
  // null/undefined = año completo (legacy y proyecciones normales);
  //   set = mid-year add-on con ventana específica julio→dic, etc.
  startMonth: v.optional(v.number()),       // 1-12
  endMonth: v.optional(v.number()),         // 1-12
  addOnOfProjectionServiceId: v.optional(v.id("projectionServices")), // audit trail; null si es contrato base
  supplementaryQuotationId: v.optional(v.id("quotations")),           // referencia inversa a la cotización suplementaria que originó el row
})
  .index("by_projectionId", ["projectionId"])
  .index("by_orgId", ["orgId"])
  .index("by_projectionId_active", ["projectionId", "isActive"]),
```

Diff sobre `convex/schema.ts:276-304` (`quotations`) — añadir
`parentQuotationId` y `lineItems` opcional para el caso suplementario:

```ts
quotations: defineTable({
  orgId: v.string(),
  projServiceId: v.id("projectionServices"),
  clientId: v.id("clients"),
  serviceName: v.string(),
  subserviceId: v.optional(v.id("subservices")),  // A1
  content: v.string(),
  pdfStorageId: v.optional(v.id("_storage")),
  status: v.union(
    v.literal("draft"),
    v.literal("sent"),
    v.literal("approved"),
    v.literal("rejected")
  ),
  createdAt: v.number(),

  // 3B token fields (existente, omitido por brevedad).

  // B1 — cotización suplementaria.
  parentQuotationId: v.optional(v.id("quotations")),   // null = principal; set = supplementary
  isSupplementary: v.optional(v.boolean()),            // helper boolean para queries rápidas
  lineItems: v.optional(v.array(v.object({             // breakdown explícito mes × monto (mid-year)
    month: v.number(),                                  // 1-12
    label: v.string(),                                  // "Julio 2026"
    amount: v.number(),                                 // MXN
  }))),
  totalAmount: v.optional(v.number()),                 // sum(lineItems[].amount); para cotizaciones con prorrateo calendario
})
  .index("by_orgId", ["orgId"])
  .index("by_projServiceId", ["projServiceId"])
  .index("by_clientId", ["clientId"])
  .index("by_orgId_status", ["orgId", "status"])
  .index("by_accessTokenHash", ["accessTokenHash"])
  .index("by_parentQuotationId", ["parentQuotationId"]),
```

**Notas:**

- `startMonth`/`endMonth` son `v.optional(v.number())`. Default semántico
  cuando ambos son `undefined`: `startMonth=1, endMonth=12` (ventana anual).
  La lectura helper (§2.4) lo normaliza.
- `addOnOfProjectionServiceId` enlaza el add-on al row "padre" cuando
  representa otro subservicio del mismo servicio padre que ya existía. Es
  optional porque el add-on típico es un subservicio *nuevo* bajo el padre,
  no una segunda fila del mismo. Se setea solo cuando el operador
  explícitamente clona/extiende un row existente (caso raro, no UI primaria).
- `supplementaryQuotationId` es la referencia inversa: dado un row en
  `projectionServices`, ¿qué cotización suplementaria lo originó? Útil para
  el panel UI ("Ver cotización" link directo).
- `parentQuotationId` se indexa para queries del estilo "lista las
  cotizaciones suplementarias de esta cotización principal" (banner UI §3.3).

### 2.2 Query nueva: `clients.getServicesOverview`

Archivo: `convex/functions/clients/queries.ts` (extender, ya existe `getById`).

```ts
export const getServicesOverview = query({
  args: { clientId: v.id("clients") },
  returns: v.union(
    v.null(),
    v.object({
      activeProjection: v.union(
        v.null(),
        v.object({
          _id: v.id("projections"),
          year: v.number(),
          status: v.string(),
        })
      ),
      groups: v.array(v.object({
        parentService: v.object({
          _id: v.id("services"),
          name: v.string(),
        }),
        rows: v.array(v.object({
          projectionServiceId: v.id("projectionServices"),
          subservice: v.union(
            v.null(),
            v.object({
              _id: v.id("subservices"),
              name: v.string(),
              slug: v.string(),
              defaultFrequency: v.string(),
            })
          ),
          serviceName: v.string(),               // fallback label si no hay subservice (legacy)
          monthlyAmount: v.number(),             // annualAmount / monthsInWindow
          annualAmount: v.number(),
          startMonth: v.number(),                // normalizado 1
          endMonth: v.number(),                  // normalizado 12
          status: v.union(                       // derivado, no campo en DB
            v.literal("active"),
            v.literal("upcoming"),               // startMonth > currentMonth del año
            v.literal("ended")                   // endMonth < currentMonth
          ),
          isAddOn: v.boolean(),                  // addOnOfProjectionServiceId set OR supplementaryQuotationId set
          supplementaryQuotationId: v.union(v.null(), v.id("quotations")),
          nextDueMonth: v.union(v.null(), v.number()),  // próximo mes que toca generar entregable (basado en defaultFrequency + ventana)
        })),
      })),
    })
  ),
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;

    // 1. Multi-tenant guard.
    const client = await ctx.db.get(args.clientId);
    if (!client || client.orgId !== orgId) return null;

    // 2. Resolver proyección activa más reciente (heurística: status=active, year max).
    //    Si no hay activa, usa la más reciente draft. Si no hay nada, retorna vacío.
    const projections = await ctx.db
      .query("projections")
      .withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
      .collect();
    const active = projections
      .filter((p) => p.status === "active")
      .sort((a, b) => b.year - a.year)[0]
      ?? projections.sort((a, b) => b.createdAt - a.createdAt)[0];

    if (!active) {
      return { activeProjection: null, groups: [] };
    }

    // 3. Cargar projectionServices activos de esa proyección.
    const projServices = await ctx.db
      .query("projectionServices")
      .withIndex("by_projectionId_active", (q) =>
        q.eq("projectionId", active._id).eq("isActive", true)
      )
      .collect();

    // 4. Resolver subservices (batch).
    const subserviceIds = projServices
      .map((ps) => ps.subserviceId)
      .filter((id): id is Id<"subservices"> => Boolean(id));
    const subservices = await Promise.all(subserviceIds.map((id) => ctx.db.get(id)));
    const subById = new Map(
      subservices.filter((s): s is NonNullable<typeof s> => s !== null).map((s) => [s._id, s])
    );

    // 5. Resolver servicios padre (batch).
    const serviceIds = Array.from(new Set(projServices.map((ps) => ps.serviceId)));
    const services = await Promise.all(serviceIds.map((id) => ctx.db.get(id)));
    const svcById = new Map(
      services.filter((s): s is NonNullable<typeof s> => s !== null).map((s) => [s._id, s])
    );

    // 6. Helper de fecha (TZ org-aware delegado a A3 §3.4; aquí calendario UTC).
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth() + 1;

    // 7. Agrupar por parentServiceId.
    type Row = NonNullable<ReturnType<typeof buildRow>>;
    const groupsMap = new Map<string, { parent: typeof services[number]; rows: Row[] }>();

    for (const ps of projServices) {
      const parent = svcById.get(ps.serviceId);
      if (!parent) continue;
      const sub = ps.subserviceId ? subById.get(ps.subserviceId) ?? null : null;
      const row = buildRow(ps, sub, active.year, currentYear, currentMonth);
      if (!row) continue;
      const key = ps.serviceId as string;
      if (!groupsMap.has(key)) groupsMap.set(key, { parent, rows: [] });
      groupsMap.get(key)!.rows.push(row);
    }

    const groups = Array.from(groupsMap.values())
      .map(({ parent, rows }) => ({
        parentService: { _id: parent!._id, name: parent!.name },
        rows: rows.sort((a, b) => a.serviceName.localeCompare(b.serviceName)),
      }))
      .sort((a, b) => a.parentService.name.localeCompare(b.parentService.name));

    return {
      activeProjection: {
        _id: active._id,
        year: active.year,
        status: active.status,
      },
      groups,
    };
  },
});

function buildRow(
  ps: Doc<"projectionServices">,
  sub: Doc<"subservices"> | null,
  projectionYear: number,
  currentYear: number,
  currentMonth: number,
) {
  const startMonth = ps.startMonth ?? 1;
  const endMonth = ps.endMonth ?? 12;
  if (endMonth < startMonth) return null;  // dato inválido; skip silencioso
  const monthsInWindow = endMonth - startMonth + 1;
  const monthlyAmount = ps.annualAmount / monthsInWindow;

  // status derivado relativo al año de la proyección.
  let status: "active" | "upcoming" | "ended";
  if (projectionYear < currentYear) status = "ended";
  else if (projectionYear > currentYear) status = "upcoming";
  else if (currentMonth < startMonth) status = "upcoming";
  else if (currentMonth > endMonth) status = "ended";
  else status = "active";

  // próxima fecha de generación según frecuencia (heurística simple para UI;
  // A3 selectDeliverableForMonth es la fuente de verdad real al momento de generar).
  const nextDueMonth = computeNextDueMonth(
    sub?.defaultFrequency,
    sub?.applicableMonths,
    startMonth,
    endMonth,
    currentMonth,
    projectionYear,
    currentYear,
  );

  return {
    projectionServiceId: ps._id,
    subservice: sub ? {
      _id: sub._id,
      name: sub.name,
      slug: sub.slug,
      defaultFrequency: sub.defaultFrequency,
    } : null,
    serviceName: ps.serviceName,
    monthlyAmount,
    annualAmount: ps.annualAmount,
    startMonth,
    endMonth,
    status,
    isAddOn: Boolean(ps.addOnOfProjectionServiceId || ps.supplementaryQuotationId),
    supplementaryQuotationId: ps.supplementaryQuotationId ?? null,
    nextDueMonth,
  };
}

function computeNextDueMonth(
  freq: string | undefined,
  applicable: number[] | undefined,
  startMonth: number,
  endMonth: number,
  currentMonth: number,
  projectionYear: number,
  currentYear: number,
): number | null {
  if (projectionYear !== currentYear) return null;
  if (currentMonth > endMonth) return null;
  const eligible = (() => {
    if (applicable && applicable.length > 0) return applicable;
    switch (freq) {
      case "mensual": return Array.from({ length: 12 }, (_, i) => i + 1);
      case "trimestral": return [3, 6, 9, 12];
      case "semestral": return [6, 12];
      case "anual": return [12];
      case "una_vez": return [startMonth];
      default: return Array.from({ length: 12 }, (_, i) => i + 1);
    }
  })();
  const candidates = eligible
    .filter((m) => m >= startMonth && m <= endMonth && m >= currentMonth)
    .sort((a, b) => a - b);
  return candidates[0] ?? null;
}
```

**Notas:**

- La query es read-only y batchea los `db.get` por id. Para 1 cliente con
  ~9 servicios padre × ~3 subservicios típicos = ~27 rows → ~30 reads. OK
  para Convex.
- `nextDueMonth` es una heurística para mostrar UX-friendly ("Próximo: Jul").
  La fuente de verdad cuando se genera de verdad es A3
  `selectDeliverableForMonth`. Documentado para evitar reclamos si difiere
  en edge cases (cooldown, override post-junio).
- TZ: aquí UTC. A3 introduce `orgConfigs.timezone`; en post-beta migrar
  `currentMonth` a TZ org-aware (deuda menor, no bloqueante).

### 2.3 Mutation nueva: `projections.addSubserviceMidYear`

Archivo: extender `convex/functions/projections/mutations.ts`.

```ts
export const addSubserviceMidYear = mutation({
  args: {
    projectionId: v.id("projections"),
    subserviceId: v.id("subservices"),
    startMonth: v.number(),            // 1-12; default UI = mes actual + 1
    endMonth: v.optional(v.number()),  // default = 12 (renovación 1-ene)
    monthlyAmount: v.number(),         // MXN
    notes: v.optional(v.string()),     // pasado a la cotización
  },
  returns: v.object({
    projectionServiceId: v.id("projectionServices"),
    quotationId: v.id("quotations"),
    alreadyExisted: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const orgId = await getOrgId(ctx);

    // 1. Multi-tenant guards.
    const projection = await ctx.db.get(args.projectionId);
    if (!projection || projection.orgId !== orgId) {
      throw new Error("Proyección no encontrada.");
    }
    const subservice = await ctx.db.get(args.subserviceId);
    if (!subservice) throw new Error("Subservicio no encontrado.");
    if (subservice.orgId && subservice.orgId !== orgId) {
      throw new Error("Subservicio no pertenece a tu org.");
    }
    const parentService = await ctx.db.get(subservice.parentServiceId);
    if (!parentService) throw new Error("Servicio padre no encontrado.");

    // 2. Validar ventana.
    const endMonth = args.endMonth ?? 12;
    if (args.startMonth < 1 || args.startMonth > 12) {
      throw new Error("startMonth debe estar entre 1 y 12.");
    }
    if (endMonth < args.startMonth || endMonth > 12) {
      throw new Error("endMonth debe ser >= startMonth y <= 12.");
    }
    if (!Number.isFinite(args.monthlyAmount) || args.monthlyAmount <= 0) {
      throw new Error("monthlyAmount debe ser un número positivo.");
    }

    // 3. Validar startMonth no es retroactivo en beta.
    //    (Año corriente: bloquea meses pasados; año futuro: permite todo.)
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth() + 1;
    if (projection.year === currentYear && args.startMonth < currentMonth) {
      throw new Error(
        `No se permiten add-ons retroactivos en beta. startMonth=${args.startMonth} < mes actual=${currentMonth}.`
      );
    }
    if (projection.year < currentYear) {
      throw new Error("No se permite agregar subservicios a proyecciones de años pasados.");
    }

    // 4. Idempotencia: si ya hay row activo (projectionId, parentServiceId,
    //    subserviceId, startMonth) coincidente, retornar el existente.
    const existing = await ctx.db
      .query("projectionServices")
      .withIndex("by_projectionId_active", (q) =>
        q.eq("projectionId", args.projectionId).eq("isActive", true)
      )
      .collect();
    const dupe = existing.find(
      (ps) =>
        ps.serviceId === subservice.parentServiceId &&
        ps.subserviceId === args.subserviceId &&
        (ps.startMonth ?? 1) === args.startMonth
    );
    if (dupe && dupe.supplementaryQuotationId) {
      return {
        projectionServiceId: dupe._id,
        quotationId: dupe.supplementaryQuotationId,
        alreadyExisted: true,
      };
    }

    // 5. Calcular annualAmount basado en ventana.
    const monthsInWindow = endMonth - args.startMonth + 1;
    const annualAmount = args.monthlyAmount * monthsInWindow;

    // 6. Insertar projectionServices.
    const projServiceId = await ctx.db.insert("projectionServices", {
      orgId,
      projectionId: args.projectionId,
      serviceId: subservice.parentServiceId,
      serviceName: parentService.name,
      subserviceId: args.subserviceId,
      chosenPct: 0,             // add-on no respeta % de catálogo (es extra contratado)
      isActive: true,
      annualAmount,
      normalizedWeight: 0,       // no entra al pool de balanceo del engine
      startMonth: args.startMonth,
      endMonth,
      addOnOfProjectionServiceId: undefined,  // add-on de subservicio nuevo, no clon de row existente
      supplementaryQuotationId: undefined,    // se patcha después de crear la cotización
    });

    // 7. Insertar monthlyAssignments para los meses de la ventana.
    //    Mantener 12 filas/año NO aplica aquí: el add-on solo cubre su ventana
    //    (R1 §12.10 dice "12 filas siempre" pero hablaba de servicios base;
    //    el add-on es por definición ventana parcial).
    for (let m = args.startMonth; m <= endMonth; m++) {
      await ctx.db.insert("monthlyAssignments", {
        orgId,
        projServiceId,
        projectionId: args.projectionId,
        clientId: projection.clientId,
        serviceName: parentService.name,
        month: m,
        year: projection.year,
        amount: args.monthlyAmount,
        feFactor: 1,    // add-on no aplica seasonality (es monto fijo prorrateado calendario)
        status: "pending",
        invoiceStatus: "not_invoiced",
      });
    }

    // 8. Resolver parentQuotationId.
    //    Heurística: cotización del primer projectionServices del padre, si existe.
    const parentRowExisting = existing.find((ps) => ps.serviceId === subservice.parentServiceId);
    let parentQuotationId: Id<"quotations"> | undefined;
    if (parentRowExisting) {
      const q = await ctx.db
        .query("quotations")
        .withIndex("by_projServiceId", (qb) => qb.eq("projServiceId", parentRowExisting._id))
        .filter((qb) => qb.eq(qb.field("status"), "approved"))
        .first();
      parentQuotationId = q?._id;
    }

    // 9. Crear cotización suplementaria.
    const quotationId = await ctx.runMutation(
      // declarado en §2.4
      internal.functions.quotations.mutations.createSupplementary,
      {
        projServiceId,
        parentQuotationId,
        startMonth: args.startMonth,
        endMonth,
        monthlyAmount: args.monthlyAmount,
        notes: args.notes,
      }
    );

    // 10. Patch projectionServices con referencia inversa.
    await ctx.db.patch(projServiceId, { supplementaryQuotationId: quotationId });

    return {
      projectionServiceId: projServiceId,
      quotationId,
      alreadyExisted: false,
    };
  },
});
```

**Notas:**

- `chosenPct: 0` + `normalizedWeight: 0` aísla el add-on del engine de
  balanceo. El engine actual (`convex/lib/projectionEngine.ts`) recalcula
  rows con `normalizedWeight > 0`; el add-on queda intacto cuando el
  operador hace `recalculate` sobre la proyección base.
- Idempotencia matchea por `(projectionId, parentServiceId, subserviceId,
  startMonth)`. Si el operador da doble-click al botón "Crear cotización"
  del modal, la segunda llamada retorna `alreadyExisted: true` con los ids
  ya creados. La UI muestra toast "Esta cotización ya existe".
- `parentQuotationId` se busca por status `approved` deliberadamente
  (heurística): solo cotizaciones cerradas valen como "padre". Si no hay
  ninguna aprobada del padre, `parentQuotationId` queda undefined y la
  cotización suplementaria se trata como standalone (sin banner UI). Ver
  §8 open question Q3.
- `recalculate` (`mutations.ts:219+`) NO toca add-ons porque itera sobre
  `existingProjServices` y los recrea desde `result.services` del engine.
  Add-ons con `normalizedWeight=0` se filtran del engine pero quedan
  preservados en DB. **Confirmar con tests** que el patch loop no los borra
  (DoD §6).

### 2.4 Mutation nueva: `quotations.createSupplementary`

Archivo: extender `convex/functions/quotations/mutations.ts`.

```ts
export const createSupplementary = internalMutation({
  args: {
    projServiceId: v.id("projectionServices"),
    parentQuotationId: v.optional(v.id("quotations")),
    startMonth: v.number(),
    endMonth: v.number(),
    monthlyAmount: v.number(),
    notes: v.optional(v.string()),
  },
  returns: v.id("quotations"),
  handler: async (ctx, args) => {
    const projService = await ctx.db.get(args.projServiceId);
    if (!projService) throw new Error("projectionServices no encontrado.");
    const orgId = projService.orgId;
    const projection = await ctx.db.get(projService.projectionId);
    if (!projection) throw new Error("projection no encontrada.");
    const client = await ctx.db.get(projection.clientId);
    if (!client) throw new Error("client no encontrado.");

    // Validar parentQuotationId si presente.
    if (args.parentQuotationId) {
      const parent = await ctx.db.get(args.parentQuotationId);
      if (!parent || parent.orgId !== orgId) {
        throw new Error("parentQuotationId inválido (otro org o no existe).");
      }
    }

    // Build lineItems.
    const lineItems = [];
    for (let m = args.startMonth; m <= args.endMonth; m++) {
      lineItems.push({
        month: m,
        label: MONTH_LABELS_ES[m - 1] + " " + projection.year,
        amount: args.monthlyAmount,
      });
    }
    const totalAmount = lineItems.reduce((s, li) => s + li.amount, 0);

    // HTML content: bloque conciso con líneas. UI rica del PDF se renderiza
    // luego con el mismo `templateResolver` que usan las cotizaciones normales.
    const content = renderSupplementaryHtml({
      client,
      projection,
      projService,
      lineItems,
      totalAmount,
      parentQuotationId: args.parentQuotationId,
      notes: args.notes,
    });

    const now = Date.now();
    return await ctx.db.insert("quotations", {
      orgId,
      projServiceId: args.projServiceId,
      clientId: projection.clientId,
      serviceName: projService.serviceName,
      subserviceId: projService.subserviceId,
      content,
      status: "draft",
      createdAt: now,
      parentQuotationId: args.parentQuotationId,
      isSupplementary: true,
      lineItems,
      totalAmount,
    });
  },
});

const MONTH_LABELS_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function renderSupplementaryHtml(args: {
  client: Doc<"clients">;
  projection: Doc<"projections">;
  projService: Doc<"projectionServices">;
  lineItems: Array<{ month: number; label: string; amount: number }>;
  totalAmount: number;
  parentQuotationId?: Id<"quotations">;
  notes?: string;
}): string {
  const rows = args.lineItems
    .map((li) => `<tr><td>${li.label}</td><td style="text-align:right">$${li.amount.toLocaleString("es-MX")}</td></tr>`)
    .join("");
  const supplementaryNote = args.parentQuotationId
    ? `<p style="font-size:12px;color:#666">Cotización suplementaria del contrato principal vigente.</p>`
    : "";
  return `
<div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px;">
  <h1 style="font-size:20px;color:#1a1a2e">Cotización suplementaria</h1>
  ${supplementaryNote}
  <p><strong>Cliente:</strong> ${args.client.name}</p>
  <p><strong>Servicio:</strong> ${args.projService.serviceName}</p>
  <table style="width:100%;margin-top:24px;border-collapse:collapse">
    <thead><tr><th align="left">Mes</th><th align="right">Monto MXN</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><th align="left">Total</th><th align="right">$${args.totalAmount.toLocaleString("es-MX")}</th></tr></tfoot>
  </table>
  ${args.notes ? `<p style="margin-top:24px;font-size:13px;color:#444"><strong>Notas:</strong> ${args.notes}</p>` : ""}
</div>`;
}
```

**Notas:**

- `createSupplementary` es `internalMutation` porque solo se invoca desde
  `projections.addSubserviceMidYear`. Si en el futuro se necesita exponer
  como público, exportar también una versión `mutation({...})` que envuelve.
- Reusa el flujo accept/decline existente (`quotations.publicActions` ya
  resuelve `accessTokenHash`). La sección 3B previa funciona idéntico para
  cotizaciones suplementarias — el cliente recibe un link, acepta o
  rechaza, y `respondedAt`/`declineReason` se setean igual. **No requiere
  cambios en publicActions.**
- `content` aquí es HTML mínimo; el PDF render (`generate-pdf/route.ts`)
  lo procesa igual que cualquier otra cotización. El `lineItems` array
  duplica info que vive en el HTML, pero permite queries y UI sin parsear
  HTML — es la fuente de verdad estructurada.

### 2.5 Multi-tenant guards (resumen)

| Función | Guard | Origen |
|---|---|---|
| `clients.getServicesOverview` | `getOrgIdSafe` + `client.orgId === orgId` | retorna `null` si fail |
| `projections.addSubserviceMidYear` | `requireAuth` + `getOrgId` + 4 guards explícitos (projection, subservice, parentService, parentQuotation) | throws |
| `quotations.createSupplementary` | internal-only; valida via `orgId === projService.orgId` y `parentQuotation.orgId === orgId` | throws |

---

## 3. Frontend

### 3.1 Panel "Servicios contratados" en `/clientes/[id]`

Edit en `src/app/(dashboard)/clientes/[id]/page.tsx`. Insertar la nueva
sección **después** del bloque "Projections Section" (líneas 162-200) y
**antes** del `<ClientDocumentsSection />` (línea 203). El orden visual queda:

```
Header + breadcrumb
Info cards (3 columnas)
Proyecciones (existente, no se toca)
→ Servicios contratados (NUEVO B1)
Documentos (existente, no se toca)
```

**ASCII mockup del panel:**

```
┌─ Servicios contratados ─────────────────────────────────────┐
│ Año 2026 · Proyección Activa             [+ Agregar subservicio]│
│                                                             │
│ Legal                                                       │
│   • Gobierno Corporativo · trimestral · Ene-Dic · $12,000/mes │
│     [Activo] [Próximo: Sep]                                 │
│   • Compliance LFPDPP    · trimestral · Ene-Dic · $8,000/mes  │
│     [Activo] [Próximo: Sep]                                 │
│                                                             │
│ Marketing                                                   │
│   • Plan Anual           · anual      · Ene-Dic · $5,000/mes  │
│     [Activo] [Próximo: Dic]                                 │
│   • Redes Sociales       · mensual    · Jul-Dic · $4,500/mes  │
│     [Activo · add-on] [Próximo: Jul] [Ver cotización]       │
│                                                             │
│ Contable                                                    │
│   • EE.FF. Mensuales     · mensual    · Ene-Dic · $10,000/mes │
│     [Activo] [Próximo: Jun]                                 │
└─────────────────────────────────────────────────────────────┘
```

**Estructura JSX (snippet completo, mismo estilo que el bloque Proyecciones
existente):**

```tsx
import { useState } from "react";
import { Plus, Layers, ExternalLink } from "lucide-react";
import { AddSubserviceModal } from "@/components/clients/AddSubserviceModal";

// ... dentro del componente, después del bloque Projections:

const overview = useQuery(api.functions.clients.queries.getServicesOverview, {
  clientId,
});
const [addModalOpen, setAddModalOpen] = useState(false);

// ... en el JSX, después de </div> del bloque Projections:

<div className="rounded-lg border border-border bg-card p-6">
  <div className="flex items-center justify-between">
    <h2 className="text-lg font-semibold">Servicios contratados</h2>
    {overview?.activeProjection && (
      <button
        onClick={() => setAddModalOpen(true)}
        className="flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-primary hover:bg-accent/90 transition-colors cursor-pointer"
      >
        <Plus size={14} />
        Agregar subservicio
      </button>
    )}
  </div>

  {overview === undefined && (
    <div className="mt-4 h-24 animate-pulse rounded bg-secondary" />
  )}

  {overview && !overview.activeProjection && (
    <div className="mt-4 text-center py-8">
      <Layers className="mx-auto mb-3 text-muted-foreground" size={36} />
      <p className="text-sm text-muted-foreground">
        Crea una proyección para empezar a contratar subservicios.
      </p>
    </div>
  )}

  {overview && overview.activeProjection && overview.groups.length === 0 && (
    <div className="mt-4 text-center py-8">
      <p className="text-sm text-muted-foreground">
        La proyección {overview.activeProjection.year} no tiene servicios activos.
      </p>
    </div>
  )}

  {overview && overview.groups.length > 0 && (
    <div className="mt-4 space-y-5">
      <p className="text-xs text-muted-foreground">
        Año {overview.activeProjection!.year} ·{" "}
        {overview.activeProjection!.status === "active" ? "Activa" : "Borrador"}
      </p>
      {overview.groups.map((group) => (
        <div key={group.parentService._id} className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">
            {group.parentService.name}
          </h3>
          <div className="space-y-1.5">
            {group.rows.map((row) => (
              <div
                key={row.projectionServiceId}
                className="flex items-center justify-between rounded-md border border-border p-3 hover:border-accent/30 transition-colors"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">
                      {row.subservice?.name ?? row.serviceName}
                    </p>
                    {row.isAddOn && (
                      <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent">
                        add-on
                      </span>
                    )}
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        row.status === "active"
                          ? "bg-success/10 text-success"
                          : row.status === "upcoming"
                            ? "bg-warning/10 text-warning"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {row.status === "active"
                        ? "Activo"
                        : row.status === "upcoming"
                          ? "Por iniciar"
                          : "Finalizado"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>
                      {row.subservice?.defaultFrequency ?? "mensual"}
                    </span>
                    <span>·</span>
                    <span>
                      {MONTH_SHORT[row.startMonth - 1]}-
                      {MONTH_SHORT[row.endMonth - 1]}
                    </span>
                    <span>·</span>
                    <span>{formatCurrency(row.monthlyAmount)}/mes</span>
                    {row.nextDueMonth && (
                      <>
                        <span>·</span>
                        <span>Próximo: {MONTH_SHORT[row.nextDueMonth - 1]}</span>
                      </>
                    )}
                  </div>
                </div>
                {row.supplementaryQuotationId && (
                  <Link
                    href={`/cotizaciones/${row.supplementaryQuotationId}`}
                    className="flex items-center gap-1 text-xs text-accent hover:underline"
                  >
                    <ExternalLink size={12} />
                    Ver cotización
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )}
</div>

{overview?.activeProjection && (
  <AddSubserviceModal
    open={addModalOpen}
    onClose={() => setAddModalOpen(false)}
    clientId={clientId}
    projectionId={overview.activeProjection._id}
    projectionYear={overview.activeProjection.year}
  />
)}
```

`MONTH_SHORT` se reutiliza del array en `clientes/[id]/ciclo/page.tsx:19-32`
(extraerlo a `src/lib/utils.ts` como `MONTH_LABELS_SHORT_ES` para no
duplicar; deuda menor, opcional para B1).

### 3.2 Modal "Agregar subservicio mid-year"

Archivo nuevo: `src/components/clients/AddSubserviceModal.tsx`. Usa shadcn
`Dialog`, `Select` (radix), `Input`, `Button`.

**ASCII mockup:**

```
┌─ Agregar subservicio ────────────────────────────────────────┐
│ Cliente: ACME S.A. de C.V.   Proyección: 2026                │
│                                                              │
│ Servicio padre        [Marketing                ▾]           │
│ Subservicio           [Redes Sociales · mensual ▾]           │
│ Mes de inicio         [Julio 2026               ▾]           │
│ Mes de fin            [Diciembre 2026           ▾]           │
│ Monto mensual (MXN)   [$ 4500                    ]           │
│ Notas (opcional)      [textarea                  ]           │
│                                                              │
│ ─────────────────────────────────────────────────            │
│ Cotización suplementaria: 6 meses × $4,500 = $27,000        │
│ Se enviará al cliente para firma. El servicio quedará vigente│
│ hasta el 31 de diciembre y se renovará con el contrato anual.│
│                                                              │
│                              [Cancelar]  [Crear cotización]  │
└──────────────────────────────────────────────────────────────┘
```

**Snippet del componente:**

```tsx
"use client";

import { useState, useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/utils";

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

interface Props {
  open: boolean;
  onClose: () => void;
  clientId: Id<"clients">;
  projectionId: Id<"projections">;
  projectionYear: number;
}

export function AddSubserviceModal({
  open, onClose, clientId, projectionId, projectionYear,
}: Props) {
  const router = useRouter();
  const services = useQuery(api.functions.services.queries.listByOrg);
  const [parentServiceId, setParentServiceId] = useState<Id<"services"> | "">("");
  const subservices = useQuery(
    api.functions.subservices.queries.listByParent,
    parentServiceId ? { parentServiceId } : "skip"
  );
  const [subserviceId, setSubserviceId] = useState<Id<"subservices"> | "">("");

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const defaultStartMonth = projectionYear === currentYear
    ? Math.min(now.getUTCMonth() + 2, 12)   // mes siguiente al actual
    : 1;
  const [startMonth, setStartMonth] = useState<number>(defaultStartMonth);
  const [endMonth, setEndMonth] = useState<number>(12);
  const [monthlyAmount, setMonthlyAmount] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addMidYear = useMutation(api.functions.projections.mutations.addSubserviceMidYear);

  const totalAmount = useMemo(() => {
    const amt = parseFloat(monthlyAmount);
    if (!Number.isFinite(amt) || amt <= 0) return 0;
    return amt * (endMonth - startMonth + 1);
  }, [monthlyAmount, startMonth, endMonth]);

  // Pre-fill monthlyAmount con defaultPricingHint si el subservicio lo tiene.
  const selectedSub = subservices?.find((s) => s._id === subserviceId);
  useMemo(() => {
    if (selectedSub?.defaultPricingHint && !monthlyAmount) {
      setMonthlyAmount(String(selectedSub.defaultPricingHint));
    }
  }, [selectedSub]);  // eslint-disable-line

  async function handleSubmit() {
    setError(null);
    const amt = parseFloat(monthlyAmount);
    if (!subserviceId) return setError("Selecciona un subservicio.");
    if (!Number.isFinite(amt) || amt <= 0) return setError("Monto mensual inválido.");
    if (endMonth < startMonth) return setError("Mes de fin debe ser >= mes de inicio.");

    setSubmitting(true);
    try {
      const result = await addMidYear({
        projectionId,
        subserviceId,
        startMonth,
        endMonth,
        monthlyAmount: amt,
        notes: notes || undefined,
      });
      onClose();
      router.push(`/cotizaciones/${result.quotationId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Agregar subservicio</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Servicio padre</Label>
            <select
              value={parentServiceId}
              onChange={(e) => {
                setParentServiceId(e.target.value as Id<"services">);
                setSubserviceId("");
              }}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="">— Selecciona —</option>
              {services?.filter((s) => s.isActive).map((s) => (
                <option key={s._id} value={s._id}>{s.name}</option>
              ))}
            </select>
          </div>

          {parentServiceId && (
            <div>
              <Label>Subservicio</Label>
              <select
                value={subserviceId}
                onChange={(e) => setSubserviceId(e.target.value as Id<"subservices">)}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="">— Selecciona —</option>
                {subservices?.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.name} · {s.defaultFrequency}
                  </option>
                ))}
              </select>
              {subservices?.length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  No hay subservicios bajo este padre. Crea uno en /configuracion/subservicios.
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Mes de inicio</Label>
              <select
                value={startMonth}
                onChange={(e) => setStartMonth(parseInt(e.target.value, 10))}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                {MONTHS.map((m, i) => (
                  <option key={i} value={i + 1}>{m} {projectionYear}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Mes de fin</Label>
              <select
                value={endMonth}
                onChange={(e) => setEndMonth(parseInt(e.target.value, 10))}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                {MONTHS.map((m, i) => (
                  <option key={i} value={i + 1} disabled={i + 1 < startMonth}>
                    {m} {projectionYear}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <Label>Monto mensual (MXN)</Label>
            <Input
              type="number"
              value={monthlyAmount}
              onChange={(e) => setMonthlyAmount(e.target.value)}
              placeholder="4500"
            />
          </div>

          <div>
            <Label>Notas (opcional)</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder="Visible en el PDF de la cotización."
            />
          </div>

          {totalAmount > 0 && (
            <div className="rounded-md border border-accent/30 bg-accent/5 p-3 text-sm">
              <p className="font-medium">
                Cotización suplementaria:{" "}
                {endMonth - startMonth + 1} meses × {formatCurrency(parseFloat(monthlyAmount))} ={" "}
                <span className="text-accent">{formatCurrency(totalAmount)}</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Se enviará al cliente para firma. El servicio quedará vigente
                hasta el 31 de diciembre y se renovará junto con el contrato anual el 1 de enero.
              </p>
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !subserviceId || totalAmount === 0}
          >
            {submitting ? "Creando..." : "Crear cotización"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### 3.3 Banner en cotización suplementaria

Edit en `src/app/(dashboard)/cotizaciones/[id]/page.tsx` (la página existente
de detalle). Al cargar la cotización, si tiene `parentQuotationId`,
renderizar un banner discreto arriba del PDF preview:

```tsx
{quotation.parentQuotationId && parent && (
  <div className="rounded-md border border-accent/30 bg-accent/5 p-3 mb-4 flex items-center gap-2 text-sm">
    <Layers size={14} className="text-accent" />
    <span>
      Cotización suplementaria del contrato principal:{" "}
      <Link
        href={`/cotizaciones/${quotation.parentQuotationId}`}
        className="text-accent hover:underline"
      >
        {parent.serviceName} · {new Date(parent.createdAt).toLocaleDateString("es-MX")}
      </Link>
    </span>
  </div>
)}
```

Si el detalle ya muestra `lineItems`, mostrarlos en tabla. Si la página de
detalle actual solo renderiza el HTML del `content`, no requiere cambio
adicional (el HTML ya incluye la tabla via `renderSupplementaryHtml`).
**Decisión:** ir con el HTML embebido. Si la UI quiere tabla nativa, deuda
post-beta.

`parent` se obtiene con un nuevo query opcional `quotations.getById` (si no
existe, usar `quotations.queries.getById`).

---

## 4. Migración / Compatibilidad

### 4.1 Rows legacy de `projectionServices`

Decisión: **NO se backfilla**. Rows existentes quedan con `startMonth`,
`endMonth`, `addOnOfProjectionServiceId`, `supplementaryQuotationId` todos
`undefined`. La query `getServicesOverview` normaliza:

```ts
const startMonth = ps.startMonth ?? 1;
const endMonth = ps.endMonth ?? 12;
```

Y la rama `isAddOn` es `false` cuando ambos `addOnOfProjectionServiceId` y
`supplementaryQuotationId` son `undefined`. Proyecciones pre-B1 se
visualizan idénticamente a una nueva sin add-ons — sin badges, ventana
Ene-Dic completa.

### 4.2 Deuda hacia A3 `selectDeliverableForMonth`

A3 §3.3 implementa el selector. Su lógica de gates de frecuencia
(`applicableMonths`, `cooldownMonths`) no considera hoy
`projectionServices.startMonth`/`endMonth` porque esos campos no existen
hasta B1.

**Patch que A3 debe absorber:** entre el gate de `applicableMonths` y el
gate de frecuencia, leer `projectionServices` y aplicar:

```ts
// pseudo-patch en A3 selectDeliverableForMonth
// Asumiendo que el caller pasa projServiceId o lo resuelve:
const ps = await ctx.db.get(projServiceId);
const startMonth = ps?.startMonth ?? 1;
const endMonth = ps?.endMonth ?? 12;
if (args.month < startMonth || args.month > endMonth) return null;
```

Coordinar **PR order:** A1 → A3 → B1. Si A3 mergea antes que B1, los
campos en schema no existen y el patch debe esperar. Si B1 mergea antes
que A3, los campos existen pero A3 los ignora — entregables se podrían
generar fuera de la ventana del add-on (bug operativo). **B1 documenta el
patch, A3 lo implementa con un test específico** (referenciado en A3 §6
test "selector respeta ventana de projectionServices" — añadir a A3 si
falta).

Mientras tanto, mitigación temporal (si B1 mergea solo): el operador
manualmente NO sube facturas fuera de la ventana → no se dispara
`generateFromInvoice` para meses no contratados. El gate humano (R1 §12.9)
sirve de safety net.

### 4.3 Compatibilidad con `recalculate`

Test crítico (DoD §6): después de `addSubserviceMidYear` + `recalculate`
sobre la proyección base, el row add-on debe sobrevivir intacto. El loop
de `recalculate` itera `result.services` (servicios que el engine devuelve)
y patcha existentes; el add-on tiene `normalizedWeight: 0` y no aparece
en `result.services` porque el engine lo ignora. **Verificar que NO se
borra al iterar `existingMAs` de su monthlyAssignments** — el código
actual borra MAs por `projServiceId`, así que los del add-on (con su
propio `projServiceId`) están safe.

### 4.4 Engine `projectionEngine.ts`

NO se toca. El engine ignora rows con `normalizedWeight: 0` o `chosenPct:
0`. Add-ons no entran al pool de balanceo. La proyección "base"
(suma de chosenPct = 100%) sigue calculándose igual.

---

## 5. Tests

Archivo nuevo `convex/functions/clients/__tests__/getServicesOverview.test.ts`,
`convex/functions/projections/__tests__/addSubserviceMidYear.test.ts`,
`convex/functions/quotations/__tests__/createSupplementary.test.ts`.
Patrón vitest + `convex-test`. Mínimo 10 tests.

### `getServicesOverview` (3 tests)

1. **Happy path con subservicios y add-on.** Setup: cliente + proyección
   2026 active + 3 projectionServices (2 base ene-dic, 1 add-on jul-dic con
   `supplementaryQuotationId`). Assert: retorna `groups` agrupado por
   parent, el add-on tiene `isAddOn: true` y `supplementaryQuotationId !==
   null`, `monthlyAmount = annualAmount / 6` para el add-on (no `/12`).
2. **Cliente sin proyección activa.** Setup: cliente sin proyecciones.
   Assert: retorna `{ activeProjection: null, groups: [] }`.
3. **Multi-tenant guard.** Setup: cliente de orgA. Auth como orgB. Assert:
   retorna `null`.

### `addSubserviceMidYear` (4 tests)

4. **Happy path crea projectionServices + monthlyAssignments + cotización.**
   Setup: proyección 2026, subservice "Redes Sociales" bajo Marketing.
   Llamar con `startMonth=7, endMonth=12, monthlyAmount=4500`. Assert:
   1 row nuevo en `projectionServices` con `startMonth=7, endMonth=12,
   annualAmount=27000, supplementaryQuotationId !== undefined`. 6 rows en
   `monthlyAssignments` (meses 7-12). 1 cotización con
   `isSupplementary: true, totalAmount=27000, lineItems.length=6,
   parentQuotationId === undefined` (no había padre approved).
5. **Idempotente: doble llamada retorna mismo id.** Setup: como #4. Llamar
   dos veces. Assert: segunda llamada retorna `alreadyExisted: true` con
   los mismos `projectionServiceId` y `quotationId` de la primera. NO se
   duplican rows.
6. **Rechaza startMonth retroactivo en año corriente.** Setup: año
   corriente = 2026. Llamar con `startMonth=1` (pasado). Assert: throws
   con "retroactivos en beta".
7. **Rechaza subservice de otro padre / no del org.** Setup: subservice
   con `orgId="orgX"`, auth como `orgY`. Assert: throws con "no pertenece
   a tu org".

### `createSupplementary` (2 tests)

8. **Crea con parentQuotationId válido.** Setup: cotización principal
   approved + projectionServices nueva. Llamar
   `createSupplementary({projServiceId, parentQuotationId, ...})`. Assert:
   row nueva en `quotations` con `parentQuotationId` set, `isSupplementary:
   true`, `lineItems.length === endMonth - startMonth + 1`, `totalAmount`
   matchea suma.
9. **Multi-tenant guard parentQuotationId.** Setup: parentQuotation de
   orgX, projectionServices de orgY. Assert: throws con "otro org o no
   existe".

### A3 integration (1 test — añadir en A3 PR; documentado aquí)

10. **`selectDeliverableForMonth` respeta startMonth/endMonth window.**
    Setup: projectionServices con `startMonth=7, endMonth=12` + subservice
    "mensual". Llamar selector con `month=6, year=2026`. Assert: retorna
    `null` (fuera de ventana). Llamar con `month=8`: retorna `{ template,
    reason: "monthly" }`.

**Tests opcionales (no bloquean DoD, recomendados):**

- Pre-fill del modal: subservice con `defaultPricingHint=4500` → el
  `monthlyAmount` se autopopula en el state. Vitest sobre el componente
  React (jsdom).
- `recalculate` no toca add-ons: después de `addSubserviceMidYear`,
  llamar `recalculate` sobre la proyección base. Assert: el row add-on
  sigue existiendo con sus MAs intactos.

---

## 6. Definition of Done

Cada item booleano. Marcar todos antes de pasar a D1.

- [ ] `convex/schema.ts`: añade `startMonth`, `endMonth`, `addOnOfProjectionServiceId`, `supplementaryQuotationId` (opcionales) a `projectionServices`.
- [ ] `convex/schema.ts`: añade `parentQuotationId`, `isSupplementary`, `lineItems`, `totalAmount` (opcionales) + índice `by_parentQuotationId` a `quotations`.
- [ ] `npx convex dev` corre sin errores de codegen.
- [ ] `convex/functions/clients/queries.ts`: añade `getServicesOverview` con multi-tenant guard.
- [ ] `convex/functions/projections/mutations.ts`: añade `addSubserviceMidYear` con validaciones (multi-tenant, ventana, retroactividad, idempotencia).
- [ ] `convex/functions/quotations/mutations.ts`: añade `createSupplementary` internal mutation con `renderSupplementaryHtml` helper.
- [ ] `src/app/(dashboard)/clientes/[id]/page.tsx`: nueva sección "Servicios contratados" insertada entre Proyecciones y Documentos.
- [ ] `src/components/clients/AddSubserviceModal.tsx`: modal funcional con dropdowns padre + subservicio, ventana mes inicio/fin, monto, preview total, validaciones.
- [ ] Después de submit del modal: redirige a `/cotizaciones/{quotationId}` (la página de detalle existente la muestra como cualquier otra).
- [ ] `src/app/(dashboard)/cotizaciones/[id]/page.tsx`: banner si `parentQuotationId` está set, linkea al padre.
- [ ] `recalculate` no rompe add-ons (test #11 opcional o verificación manual).
- [ ] 10+ tests vitest pasando (`npm test`).
- [ ] `npm run lint` clean.
- [ ] `npx tsc --noEmit` clean.
- [ ] `gitnexus_impact` corrido sobre `projections.create`, `quotations.generate`, `recalculate`; HIGH/CRITICAL reportados.
- [ ] `gitnexus_detect_changes` pre-commit; scope confirma solo `convex/schema.ts`, `convex/functions/clients/queries.ts`, `convex/functions/projections/mutations.ts`, `convex/functions/quotations/mutations.ts`, `src/app/(dashboard)/clientes/[id]/page.tsx`, `src/app/(dashboard)/cotizaciones/[id]/page.tsx`, `src/components/clients/AddSubserviceModal.tsx`, y los tests.
- [ ] Documentar en A3 PR (o issue) que `selectDeliverableForMonth` debe respetar `startMonth`/`endMonth` de `projectionServices` antes de evaluar frecuencia. Test #10 añadido a A3.

---

## 7. Riesgos

**R12 (R1 §10) — Subservicio borrado con `projectionServices` activos.**
Mitigado en A1 §3.2 `subservices.remove`: la mutation rechaza si hay refs.
B1 hereda esa protección sin acción adicional.

**Conflicto A1 ↔ A3 ↔ B1 (PR order).**
- A1 mergea primero: schema `subservices` + `subserviceId` opcional en 6 tablas.
- A3 mergea segundo: `selectDeliverableForMonth` con dual-matching contra subservices. **A3 debe incorporar el chequeo de `startMonth`/`endMonth` (B1 §4.2)** aunque los campos no existan aún en su PR base — el chequeo es backward-compat (`?? 1` y `?? 12`). Si A3 mergea antes que B1 sin el chequeo, el bug solo manifiesta cuando B1 crea add-ons; mitigación temporal: gate humano (operador no sube facturas fuera de ventana).
- B1 mergea tercero: añade campos schema, panel UI, modal. Test de integración (test #10) confirma que A3 respeta la ventana. Si test falla, B1 envía PR follow-up a A3.

**R-cotización-orphan.** Si `addSubserviceMidYear` falla DESPUÉS de insertar
`projectionServices` pero ANTES de `createSupplementary` (race rara,
network blip), queda un row huérfano sin cotización. Mitigación: la
mutation Convex es transaccional para inserts internos (mismo
`runMutation` context), así que en práctica esto no ocurre. Si llegara a
pasar: `getServicesOverview` lo muestra con `isAddOn: false` (sin badge)
y `supplementaryQuotationId: null`. Operador puede borrarlo manualmente
desde Convex dashboard.

**R-engine-recalculate.** Cubierto en §4.3. Test #11 (opcional) cierra el
loop.

**R-prorateo-confusión.** Cliente puede malinterpretar que el add-on se
prorratea "proporcional 12 meses" en lugar de "calendario julio→dic".
Mitigación: copy explícito en el modal ("6 meses × $4,500 = $27,000") +
copy en el banner del PDF ("vigente hasta el 31 de diciembre, renovación
1-ene"). R1 §12.3 dejó la decisión cerrada; B1 la comunica
visualmente.

**R-pre-fill double-set.** El `useMemo` para pre-llenar `monthlyAmount`
desde `defaultPricingHint` corre cada vez que `selectedSub` cambia, pero
solo setea si `monthlyAmount` está vacío. Si el operador limpia
manualmente el input y luego re-selecciona el mismo subservice, NO se
re-pre-fill (porque `selectedSub` no cambió). Edge case aceptable; UX
secundaria.

---

## 8. Open questions

**Q1.** ¿Pausar subservicio sin eliminar (toggle status `active|paused`)?
**Recomendación:** Fuera de B1. En beta el operador desactiva el row
poniendo `isActive=false` vía un patch directo o, mejor, vía `recalculate`
con `serviceUpdates`. La UI dedicada para pause queda para V3 cuando
exista el modelo de status granular (R1 fuera de scope).

**Q2.** ¿El modal pre-llena el monto desde el `parentQuotation` o desde
`subservice.defaultPricingHint`?
**Recomendación:** desde `defaultPricingHint`. Razón: el padre puede ser
una cotización de otro servicio (Legal), y el add-on es de otro
subservicio (Marketing Redes Sociales) con pricing distinto. El hint del
subservicio es la mejor referencia. Si en el futuro el operador quiere
pricing histórico del cliente, agregar query post-beta.

**Q3.** ¿Cotización suplementaria se firma con el mismo signer del padre
o se redefine?
**Recomendación:** mismo flujo accept/decline (`publicActions` actual). Si
el cliente firmó la principal con email X, la suplementaria llega al
mismo email X (resolución de destinatario via
`2026-05-19-notification-recipient-resolution-design.md`, sin cambio).
Cuando entre Firmame, el signer se redefine por cotización
(provider-level, no por parentQuotationId). B1 no toca eso.

**Q4.** ¿Eliminar add-on una vez creado pero antes de firmar = soft
delete + cancelar cotización?
**Recomendación:** Fuera de B1. En beta, si el operador se equivoca y
necesita rollback: (a) marca la cotización suplementaria como `rejected`
manualmente, (b) patch directo en Convex dashboard a
`projectionServices.isActive=false` para el add-on. Si esto se vuelve
frecuente, agregar mutation `projections.removeAddOn` post-beta con
cascade soft-delete sobre MAs + status void en quotation. R1 §10 R12 ya
cubre el patrón.

**Q5.** ¿Mostrar add-ons inactivos / finalizados en el panel?
**Recomendación:** Sí, con badge "Finalizado" gris. El operador necesita
audit visual ("¿qué se contrató este año?"). Filtrar solo via `isActive`
sería destructivo de información. Implementado en §2.2 `status` derivado.

---

## 9. Referencias

### 9.1 Archivos del codebase

- `convex/schema.ts:168-180` — `projectionServices`; B1 añade 4 campos opcionales.
- `convex/schema.ts:276-304` — `quotations`; B1 añade `parentQuotationId`, `isSupplementary`, `lineItems`, `totalAmount` + índice `by_parentQuotationId`.
- `convex/functions/clients/queries.ts` — extender con `getServicesOverview`.
- `convex/functions/projections/mutations.ts:15-217` — `create` (referencia de estilo, multi-tenant guards); B1 añade `addSubserviceMidYear` al mismo archivo.
- `convex/functions/projections/mutations.ts:219-382` — `recalculate`; verificar que no rompe add-ons (test #11 opcional).
- `convex/functions/quotations/mutations.ts:5-183` — `generate` (referencia para `renderSupplementaryHtml`); B1 añade `createSupplementary` al mismo archivo.
- `convex/functions/quotations/publicActions.ts` — accept/decline flow; **no requiere cambios** (suplementaria usa el mismo).
- `convex/functions/subservices/queries.ts` — `listByParent` (A1); modal lo consume.
- `convex/functions/services/queries.ts` — `listByOrg`; modal lo consume.
- `convex/lib/authHelpers.ts:11-50` — `getOrgId`, `getOrgIdSafe`, `requireAuth`.
- `src/app/(dashboard)/clientes/[id]/page.tsx:162-200` — bloque "Proyecciones" actual; B1 inserta nueva sección después.
- `src/app/(dashboard)/clientes/[id]/page.tsx:203` — `<ClientDocumentsSection />`; B1 inserta antes.
- `src/app/(dashboard)/clientes/[id]/ciclo/page.tsx:19-32` — `MONTH_NAMES` array reusable.
- `src/app/(dashboard)/cotizaciones/[id]/page.tsx` — página detalle cotización; B1 añade banner si `parentQuotationId`.
- `src/components/clients/ClientDocumentsSection.tsx` — referencia de estilo para component del cliente.
- `src/components/ui/dialog.tsx`, `input.tsx`, `button.tsx`, `label.tsx` — shadcn primitives existentes.

### 9.2 Sub-specs relacionados

- `docs/superpowers/specs/2026-05-20-prod-readiness-revision.md` — maestro R1, §6 (este sub-spec), §12.3 (prorrateo calendario), §11 O8/O14 (decisiones cotización suplementaria).
- `docs/superpowers/specs/2026-05-21-subservices-model-design.md` — A1, define `subservices` + `subserviceId` en `projectionServices`/`quotations` consumido aquí.
- `docs/superpowers/specs/2026-05-22-templates-operator-access-design.md` — A2, NO bloquea B1 (no se tocan plantillas).
- `docs/superpowers/specs/2026-05-23-document-lifecycle-design.md` — A3, debe absorber chequeo `startMonth`/`endMonth` (§4.2 deuda); test #10 cierra el loop.
- `docs/superpowers/specs/2026-04-24-section-3b-quotation-accept-decline-design.md` — flujo accept/decline base; cotizaciones suplementarias lo heredan sin cambio.
- `docs/superpowers/specs/2026-05-19-notification-recipient-resolution-design.md` — destinatario del email de cotización suplementaria (mismo `contactEmail` del cliente).

### 9.3 Memorias del proyecto

- `project_sprint_v2_timeline` — confirma 31-may deadline; B1 termina 2026-05-30 noche.
- `project_firma_provider` — Firmame (no MiFiel); no afecta B1 directamente, pero la cotización suplementaria sigue el mismo provider que la principal.

---

**Fin del sub-spec B1.** D1 arranca con el panel cliente cerrado y la
mutation add-on disponible para que el catálogo super-admin (`/platform`)
pueda referenciar add-ons agregados desde cualquier org en su tabla de
métricas.
