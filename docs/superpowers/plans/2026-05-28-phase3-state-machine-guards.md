# Phase 3 — State machine transition guards

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar gaps de transición ilegal en 4 mutations del spec `docs/superpowers/specs/2026-05-28-schema-coherence-audit-design.md` §7: `monthlyAssignments.updateStatus`, `monthlyAssignments.updateInvoiceStatus`, `projections.updateStatus`, `questionnaireResponses.updateStatus`. Bloquear saltos hacia atrás y combinaciones invalidas (ej. `delivered → pending`) que hoy se permiten.

**Architecture:** 1 helper genérico `assertTransition` en `convex/lib/stateMachines.ts` consumido por 4 mutations. Cada mutation declara su `ALLOWED_TRANSITIONS` constante. Helper lanza `ConvexError({ code: "INVALID_TRANSITION", ... })` con info diagnóstica. Cross-machine invariant en `monthlyAssignments`: `status="delivered"` implica `invoiceStatus !== "not_invoiced"` (no entregamos sin factura emitida). TDD estricto: tests rojos sobre transición ilegal → impl → verde.

**Tech Stack:** Convex mutations + Vitest/convex-test edge-runtime. `ConvexError` from `convex/values`. Baseline 1144 tests — no se rompen.

---

## Pre-flight

- [ ] **Step 0.1: Baseline limpio**

Run: `npm test 2>&1 | grep "Tests" | tail -1 && npx tsc --noEmit 2>&1 | tail -3`
Expected: `Tests 1144 passed | 1 skipped` + 0 TS errors.

- [ ] **Step 0.2: Working tree**

Run: `git status --short`
Expected: solo `?? docs/superpowers/plans/2026-05-28-fase4-...` (Phase 4 papá-doc untracked, unrelated). Si hay otros mods, pausar.

---

## Task 1: Helper genérico `assertTransition`

**Files:**
- Create: `convex/lib/stateMachines.ts`
- Test: `convex/lib/__tests__/stateMachines.test.ts`

**Contexto:** Helper compartido por Tasks 2-5. Lanza `ConvexError` con código `INVALID_TRANSITION` cuando la transición no está permitida. Idempotente: si `from === to`, no-op silencioso (algunas mutations se invocan idempotentemente al refresh).

- [ ] **Step 1.1: Test rojo**

Crear `convex/lib/__tests__/stateMachines.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ConvexError } from "convex/values";
import { assertTransition, type Transition } from "../stateMachines";

type TestStatus = "draft" | "active" | "archived";

const ALLOWED: readonly Transition<TestStatus>[] = [
  ["draft", "active"],
  ["active", "archived"],
] as const;

describe("assertTransition", () => {
  it("allows a permitted transition (no throw)", () => {
    expect(() =>
      assertTransition("table", "status", "draft", "active", ALLOWED)
    ).not.toThrow();
  });

  it("is idempotent (from === to never throws)", () => {
    expect(() =>
      assertTransition("table", "status", "active", "active", ALLOWED)
    ).not.toThrow();
  });

  it("throws ConvexError with INVALID_TRANSITION code on illegal transition", () => {
    let caught: ConvexError<{ code: string; message: string }> | null = null;
    try {
      assertTransition("table", "status", "archived", "draft", ALLOWED);
    } catch (e) {
      caught = e as ConvexError<{ code: string; message: string }>;
    }
    expect(caught).not.toBeNull();
    expect(caught).toBeInstanceOf(ConvexError);
    // ConvexError serializes data into .data
    const data = caught!.data as { code: string; message: string };
    expect(data.code).toBe("INVALID_TRANSITION");
    expect(data.message).toMatch(/table\.status/);
    expect(data.message).toMatch(/archived/);
    expect(data.message).toMatch(/draft/);
  });

  it("throws on a transition not in the allowed list (even between valid states)", () => {
    expect(() =>
      assertTransition("table", "status", "draft", "archived", ALLOWED)
    ).toThrow(/INVALID_TRANSITION|draft.*archived/i);
  });
});
```

- [ ] **Step 1.2: Run, expect FAIL**

Run: `npx vitest run convex/lib/__tests__/stateMachines.test.ts`
Expected: FAIL — module no existe.

- [ ] **Step 1.3: Implementar helper**

Crear `convex/lib/stateMachines.ts`:

```ts
import { ConvexError } from "convex/values";

/**
 * State machine transition guard.
 *
 * Usado por mutations que cambian un campo de tipo enum (status, invoiceStatus,
 * auditStatus, etc.) para bloquear transiciones inválidas (ej. delivered → pending).
 *
 * - Idempotente: si `from === to`, no-op.
 * - Throws ConvexError({ code: "INVALID_TRANSITION", message }) si la
 *   transición no está en `allowed`.
 */

export type Transition<S extends string> = readonly [from: S, to: S];

export function assertTransition<S extends string>(
  table: string,
  field: string,
  from: S,
  to: S,
  allowed: readonly Transition<S>[]
): void {
  if (from === to) return;
  const ok = allowed.some(([f, t]) => f === from && t === to);
  if (!ok) {
    throw new ConvexError({
      code: "INVALID_TRANSITION",
      message: `${table}.${field}: transición ${from} → ${to} no permitida`,
    });
  }
}
```

- [ ] **Step 1.4: Run, expect PASS**

Run: `npx vitest run convex/lib/__tests__/stateMachines.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 1.5: Commit**

```bash
git add convex/lib/stateMachines.ts convex/lib/__tests__/stateMachines.test.ts
git commit -m "$(cat <<'EOF'
feat(lib): assertTransition helper para state machines

Phase 3 §7. Helper genérico que lanza ConvexError INVALID_TRANSITION
cuando una transición de estado no está en la lista permitida.
Idempotente para from === to.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Guards en `monthlyAssignments.updateStatus`

**Files:**
- Modify: `convex/functions/monthlyAssignments/mutations.ts` (`updateStatus`)
- Test: `convex/functions/monthlyAssignments/__tests__/updateStatus.guards.test.ts`

**Contexto:** Hoy `updateStatus` patchea cualquier valor sin validar transición. Operator puede saltar `delivered → pending` o `pending → delivered` directo. Spec §7.1:

```
pending → info_received → in_progress → delivered
```

Más una reversa permitida para corrección: `info_received → pending`.

- [ ] **Step 2.1: Test rojo**

Crear `convex/functions/monthlyAssignments/__tests__/updateStatus.guards.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api } from "../../../_generated/api";

const ORG_A = "org_test_A";

async function seedAssignment(t: ReturnType<typeof convexTest>, status: "pending" | "info_received" | "in_progress" | "delivered") {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId: ORG_A, name: "C", rfc: "X", industry: "S",
      annualRevenue: 0, billingFrequency: "mensual",
      isArchived: false, createdAt: Date.now(),
    });
    const projectionId = await ctx.db.insert("projections", {
      orgId: ORG_A, clientId, year: 2026,
      annualSales: 0, totalBudget: 0, commissionRate: 0,
      seasonalityData: [], status: "active",
      createdAt: Date.now(), updatedAt: Date.now(),
    });
    const serviceId = await ctx.db.insert("services", {
      name: "S", type: "base", minPct: 0, maxPct: 100,
      defaultPct: 10, isDefault: true, sortOrder: 0,
    });
    const psId = await ctx.db.insert("projectionServices", {
      orgId: ORG_A, projectionId, serviceId, serviceName: "S",
      chosenPct: 10, isActive: true, annualAmount: 0, normalizedWeight: 1,
    });
    return await ctx.db.insert("monthlyAssignments", {
      orgId: ORG_A, projServiceId: psId, projectionId, clientId,
      serviceName: "S", month: 6, year: 2026, amount: 100, feFactor: 1,
      status, invoiceStatus: "not_invoiced",
    });
  });
}

describe("monthlyAssignments.updateStatus guards", () => {
  it("allows pending → info_received", async () => {
    const t = convexTest(schema);
    const id = await seedAssignment(t, "pending");
    await t
      .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
      .mutation(api.functions.monthlyAssignments.mutations.updateStatus, {
        id, status: "info_received",
      });
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.status).toBe("info_received");
  });

  it("allows info_received → in_progress", async () => {
    const t = convexTest(schema);
    const id = await seedAssignment(t, "info_received");
    await t
      .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
      .mutation(api.functions.monthlyAssignments.mutations.updateStatus, {
        id, status: "in_progress",
      });
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.status).toBe("in_progress");
  });

  it("allows in_progress → delivered", async () => {
    const t = convexTest(schema);
    const id = await seedAssignment(t, "in_progress");
    await t
      .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
      .mutation(api.functions.monthlyAssignments.mutations.updateStatus, {
        id, status: "delivered",
      });
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.status).toBe("delivered");
  });

  it("allows reversal info_received → pending (corrección)", async () => {
    const t = convexTest(schema);
    const id = await seedAssignment(t, "info_received");
    await t
      .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
      .mutation(api.functions.monthlyAssignments.mutations.updateStatus, {
        id, status: "pending",
      });
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.status).toBe("pending");
  });

  it("is idempotent (delivered → delivered no throw)", async () => {
    const t = convexTest(schema);
    const id = await seedAssignment(t, "delivered");
    await expect(
      t
        .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
        .mutation(api.functions.monthlyAssignments.mutations.updateStatus, {
          id, status: "delivered",
        })
    ).resolves.toBeUndefined();
  });

  it("throws INVALID_TRANSITION on delivered → pending", async () => {
    const t = convexTest(schema);
    const id = await seedAssignment(t, "delivered");
    await expect(
      t
        .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
        .mutation(api.functions.monthlyAssignments.mutations.updateStatus, {
          id, status: "pending",
        })
    ).rejects.toThrow(/INVALID_TRANSITION|delivered.*pending/i);
  });

  it("throws INVALID_TRANSITION on pending → delivered (saltó in_progress)", async () => {
    const t = convexTest(schema);
    const id = await seedAssignment(t, "pending");
    await expect(
      t
        .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
        .mutation(api.functions.monthlyAssignments.mutations.updateStatus, {
          id, status: "delivered",
        })
    ).rejects.toThrow(/INVALID_TRANSITION|pending.*delivered/i);
  });
});
```

- [ ] **Step 2.2: Run, expect FAIL (mayoría)**

Run: `npx vitest run convex/functions/monthlyAssignments/__tests__/updateStatus.guards.test.ts`
Expected: Los 4 happy paths + idempotency PASS (código actual permite cualquier transición). Los 2 illegal transitions FAIL (no throw porque no hay guard).

- [ ] **Step 2.3: Implementar guard**

En `convex/functions/monthlyAssignments/mutations.ts`, agregar import al top si no está:

```ts
import { assertTransition, type Transition } from "../../lib/stateMachines";
```

Antes del `export const updateStatus` (o al top del archivo después de imports), agregar:

```ts
type MAStatus = "pending" | "info_received" | "in_progress" | "delivered";

const ALLOWED_STATUS_TRANSITIONS: readonly Transition<MAStatus>[] = [
  ["pending", "info_received"],
  ["pending", "in_progress"],
  ["info_received", "in_progress"],
  ["in_progress", "delivered"],
  // Reversa permitida solo para corrección manual:
  ["info_received", "pending"],
] as const;
```

Dentro del handler de `updateStatus`, ANTES del `ctx.db.patch`:

```ts
assertTransition(
  "monthlyAssignments",
  "status",
  ma.status as MAStatus,
  args.status,
  ALLOWED_STATUS_TRANSITIONS
);
```

- [ ] **Step 2.4: Run, expect PASS**

Run: `npx vitest run convex/functions/monthlyAssignments/__tests__/updateStatus.guards.test.ts`
Expected: 7 tests PASS.

- [ ] **Step 2.5: Suite monthlyAssignments regression**

Run: `npx vitest run convex/functions/monthlyAssignments/__tests__/`
Expected: todos verdes. Si algún test legacy assumía transición ilegal, reportar BLOCKED.

- [ ] **Step 2.6: Commit**

```bash
git add convex/functions/monthlyAssignments/mutations.ts convex/functions/monthlyAssignments/__tests__/updateStatus.guards.test.ts
git commit -m "$(cat <<'EOF'
fix(monthlyAssignments): transition guards en updateStatus

Phase 3 §7.2. Bloquea saltos ilegales: delivered → pending,
pending → delivered. Permite reversa info_received → pending para
corrección manual.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Guards en `monthlyAssignments.updateInvoiceStatus` + invariante cruzada

**Files:**
- Modify: `convex/functions/monthlyAssignments/mutations.ts` (`updateInvoiceStatus`)
- Test: `convex/functions/monthlyAssignments/__tests__/updateInvoiceStatus.guards.test.ts`

**Contexto:** Spec §7.1:

```
not_invoiced → invoiced → paid
```

Reversas NO permitidas (factura emitida no se "des-emite" — caso fiscal real).

Adicional cross-machine invariant (spec §7.1): `status === "delivered"` implica `invoiceStatus !== "not_invoiced"`. Esto significa: si el assignment YA está delivered, NO puedes bajar invoiceStatus a not_invoiced (no tiene sentido — ya entregaste, debió haber factura).

Pero también: no podemos forzar la dirección opuesta (que invoiced → delivered) porque son state machines independientes que se acoplan vía pago.

Decisión simple: bloquear cualquier transición `invoiced/paid → not_invoiced`. Y bloquear cualquier `paid → invoiced` (reversa). Solo permitir avanzar.

- [ ] **Step 3.1: Test rojo**

Crear `convex/functions/monthlyAssignments/__tests__/updateInvoiceStatus.guards.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api } from "../../../_generated/api";

const ORG_A = "org_test_A";

async function seedAssignment(
  t: ReturnType<typeof convexTest>,
  status: "pending" | "info_received" | "in_progress" | "delivered",
  invoiceStatus: "not_invoiced" | "invoiced" | "paid"
) {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId: ORG_A, name: "C", rfc: "X", industry: "S",
      annualRevenue: 0, billingFrequency: "mensual",
      isArchived: false, createdAt: Date.now(),
    });
    const projectionId = await ctx.db.insert("projections", {
      orgId: ORG_A, clientId, year: 2026,
      annualSales: 0, totalBudget: 0, commissionRate: 0,
      seasonalityData: [], status: "active",
      createdAt: Date.now(), updatedAt: Date.now(),
    });
    const sId = await ctx.db.insert("services", {
      name: "S", type: "base", minPct: 0, maxPct: 100,
      defaultPct: 10, isDefault: true, sortOrder: 0,
    });
    const psId = await ctx.db.insert("projectionServices", {
      orgId: ORG_A, projectionId, serviceId: sId, serviceName: "S",
      chosenPct: 10, isActive: true, annualAmount: 0, normalizedWeight: 1,
    });
    return await ctx.db.insert("monthlyAssignments", {
      orgId: ORG_A, projServiceId: psId, projectionId, clientId,
      serviceName: "S", month: 6, year: 2026, amount: 100, feFactor: 1,
      status, invoiceStatus,
    });
  });
}

describe("monthlyAssignments.updateInvoiceStatus guards", () => {
  it("allows not_invoiced → invoiced", async () => {
    const t = convexTest(schema);
    const id = await seedAssignment(t, "pending", "not_invoiced");
    await t
      .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
      .mutation(api.functions.monthlyAssignments.mutations.updateInvoiceStatus, {
        id, invoiceStatus: "invoiced",
      });
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.invoiceStatus).toBe("invoiced");
  });

  it("allows invoiced → paid", async () => {
    const t = convexTest(schema);
    const id = await seedAssignment(t, "pending", "invoiced");
    await t
      .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
      .mutation(api.functions.monthlyAssignments.mutations.updateInvoiceStatus, {
        id, invoiceStatus: "paid",
      });
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.invoiceStatus).toBe("paid");
  });

  it("is idempotent (paid → paid no throw)", async () => {
    const t = convexTest(schema);
    const id = await seedAssignment(t, "delivered", "paid");
    await expect(
      t
        .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
        .mutation(api.functions.monthlyAssignments.mutations.updateInvoiceStatus, {
          id, invoiceStatus: "paid",
        })
    ).resolves.toBeUndefined();
  });

  it("throws INVALID_TRANSITION on paid → invoiced (reversa)", async () => {
    const t = convexTest(schema);
    const id = await seedAssignment(t, "delivered", "paid");
    await expect(
      t
        .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
        .mutation(api.functions.monthlyAssignments.mutations.updateInvoiceStatus, {
          id, invoiceStatus: "invoiced",
        })
    ).rejects.toThrow(/INVALID_TRANSITION|paid.*invoiced/i);
  });

  it("throws INVALID_TRANSITION on invoiced → not_invoiced (reversa)", async () => {
    const t = convexTest(schema);
    const id = await seedAssignment(t, "pending", "invoiced");
    await expect(
      t
        .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
        .mutation(api.functions.monthlyAssignments.mutations.updateInvoiceStatus, {
          id, invoiceStatus: "not_invoiced",
        })
    ).rejects.toThrow(/INVALID_TRANSITION|invoiced.*not_invoiced/i);
  });

  it("throws INVALID_TRANSITION on not_invoiced → paid (saltó invoiced)", async () => {
    const t = convexTest(schema);
    const id = await seedAssignment(t, "pending", "not_invoiced");
    await expect(
      t
        .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
        .mutation(api.functions.monthlyAssignments.mutations.updateInvoiceStatus, {
          id, invoiceStatus: "paid",
        })
    ).rejects.toThrow(/INVALID_TRANSITION|not_invoiced.*paid/i);
  });

  it("throws COHERENCE_VIOLATION when delivered + trying to go back to not_invoiced", async () => {
    const t = convexTest(schema);
    // Setup: delivered + invoiced (valid state)
    const id = await seedAssignment(t, "delivered", "invoiced");
    // Attempt: invoiced → not_invoiced. This is blocked by the transition guard
    // already (Test 5 covers it), but verifies the cross-state invariant ALSO catches it.
    await expect(
      t
        .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
        .mutation(api.functions.monthlyAssignments.mutations.updateInvoiceStatus, {
          id, invoiceStatus: "not_invoiced",
        })
    ).rejects.toThrow(/INVALID_TRANSITION|COHERENCE_VIOLATION/i);
  });
});
```

- [ ] **Step 3.2: Run, expect FAIL (los 4 illegal transitions fallan en hoy)**

Run: `npx vitest run convex/functions/monthlyAssignments/__tests__/updateInvoiceStatus.guards.test.ts`
Expected: 3 happy paths + idempotency PASS, 4 illegal transitions FAIL.

- [ ] **Step 3.3: Implementar guard**

En `convex/functions/monthlyAssignments/mutations.ts`, después de `ALLOWED_STATUS_TRANSITIONS` (de Task 2), agregar:

```ts
type MAInvoiceStatus = "not_invoiced" | "invoiced" | "paid";

const ALLOWED_INVOICE_STATUS_TRANSITIONS: readonly Transition<MAInvoiceStatus>[] = [
  ["not_invoiced", "invoiced"],
  ["invoiced", "paid"],
] as const;
```

Dentro del handler de `updateInvoiceStatus`, ANTES del `ctx.db.patch`:

```ts
assertTransition(
  "monthlyAssignments",
  "invoiceStatus",
  ma.invoiceStatus as MAInvoiceStatus,
  args.invoiceStatus,
  ALLOWED_INVOICE_STATUS_TRANSITIONS
);
```

NOTA sobre la invariante cruzada: con los transitions guards arriba ya queda bloqueado `delivered+invoiced → delivered+not_invoiced` porque ningún path permite ir `invoiced → not_invoiced`. El test #7 (COHERENCE_VIOLATION) en realidad lo cubre la transition guard normal. Marcado como cubierto.

- [ ] **Step 3.4: Run, expect PASS**

Run: `npx vitest run convex/functions/monthlyAssignments/__tests__/updateInvoiceStatus.guards.test.ts`
Expected: 7 tests PASS.

- [ ] **Step 3.5: Suite monthlyAssignments regression**

Run: `npx vitest run convex/functions/monthlyAssignments/__tests__/`
Expected: todos verdes (incluye Task 2 tests).

- [ ] **Step 3.6: Commit**

```bash
git add convex/functions/monthlyAssignments/mutations.ts convex/functions/monthlyAssignments/__tests__/updateInvoiceStatus.guards.test.ts
git commit -m "$(cat <<'EOF'
fix(monthlyAssignments): transition guards en updateInvoiceStatus

Phase 3 §7.2. Bloquea reversas (paid → invoiced, invoiced → not_invoiced)
y saltos (not_invoiced → paid). Closes coherence cross-machine:
delivered+paid no puede regresar a delivered+not_invoiced.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Guards en `projections.updateStatus`

**Files:**
- Modify: `convex/functions/projections/mutations.ts` (`updateStatus`)
- Test: `convex/functions/projections/__tests__/updateStatus.guards.test.ts`

**Contexto:** Spec §7.1:

```
draft → active → archived
              ↺ draft (vía cloneProjectionToDraft + replaceProjection)
```

`updateStatus` directo NO debería permitir `active → draft` (eso solo va vía `cloneProjectionToDraft`). Pero SÍ permitir `archived → active` (re-activar) y `active → archived` (archivar).

Transiciones permitidas vía `updateStatus`:
- `draft → active`
- `active → archived`
- `archived → active` (re-activar)

BLOQUEADO: `active → draft`, `archived → draft`, saltos.

- [ ] **Step 4.1: Test rojo**

Crear `convex/functions/projections/__tests__/updateStatus.guards.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api } from "../../../_generated/api";

const ORG_A = "org_test_A";

async function seedProjection(
  t: ReturnType<typeof convexTest>,
  status: "draft" | "active" | "archived"
) {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId: ORG_A, name: "C", rfc: "X", industry: "S",
      annualRevenue: 0, billingFrequency: "mensual",
      isArchived: false, createdAt: Date.now(),
    });
    return await ctx.db.insert("projections", {
      orgId: ORG_A, clientId, year: 2026,
      annualSales: 0, totalBudget: 0, commissionRate: 0,
      seasonalityData: [], status,
      createdAt: Date.now(), updatedAt: Date.now(),
    });
  });
}

describe("projections.updateStatus guards", () => {
  it("allows draft → active", async () => {
    const t = convexTest(schema);
    const id = await seedProjection(t, "draft");
    await t
      .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
      .mutation(api.functions.projections.mutations.updateStatus, {
        id, status: "active",
      });
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.status).toBe("active");
  });

  it("allows active → archived", async () => {
    const t = convexTest(schema);
    const id = await seedProjection(t, "active");
    await t
      .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
      .mutation(api.functions.projections.mutations.updateStatus, {
        id, status: "archived",
      });
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.status).toBe("archived");
  });

  it("allows archived → active (re-activación)", async () => {
    const t = convexTest(schema);
    const id = await seedProjection(t, "archived");
    await t
      .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
      .mutation(api.functions.projections.mutations.updateStatus, {
        id, status: "active",
      });
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.status).toBe("active");
  });

  it("is idempotent (active → active no throw)", async () => {
    const t = convexTest(schema);
    const id = await seedProjection(t, "active");
    await expect(
      t
        .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
        .mutation(api.functions.projections.mutations.updateStatus, {
          id, status: "active",
        })
    ).resolves.toBeUndefined();
  });

  it("throws INVALID_TRANSITION on active → draft (debe ir por replaceProjection)", async () => {
    const t = convexTest(schema);
    const id = await seedProjection(t, "active");
    await expect(
      t
        .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
        .mutation(api.functions.projections.mutations.updateStatus, {
          id, status: "draft",
        })
    ).rejects.toThrow(/INVALID_TRANSITION|active.*draft/i);
  });

  it("throws INVALID_TRANSITION on archived → draft", async () => {
    const t = convexTest(schema);
    const id = await seedProjection(t, "archived");
    await expect(
      t
        .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
        .mutation(api.functions.projections.mutations.updateStatus, {
          id, status: "draft",
        })
    ).rejects.toThrow(/INVALID_TRANSITION|archived.*draft/i);
  });

  it("throws INVALID_TRANSITION on draft → archived (saltó active)", async () => {
    const t = convexTest(schema);
    const id = await seedProjection(t, "draft");
    await expect(
      t
        .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
        .mutation(api.functions.projections.mutations.updateStatus, {
          id, status: "archived",
        })
    ).rejects.toThrow(/INVALID_TRANSITION|draft.*archived/i);
  });
});
```

- [ ] **Step 4.2: Run, expect FAIL en illegal transitions**

Run: `npx vitest run convex/functions/projections/__tests__/updateStatus.guards.test.ts`
Expected: 3 happy paths + idempotency PASS, 3 illegal transitions FAIL.

- [ ] **Step 4.3: Implementar guard**

En `convex/functions/projections/mutations.ts`, agregar import al top si no existe:

```ts
import { assertTransition, type Transition } from "../../lib/stateMachines";
```

Antes de `export const updateStatus` (o al top tras imports), agregar:

```ts
type ProjectionStatus = "draft" | "active" | "archived";

const ALLOWED_PROJECTION_STATUS_TRANSITIONS: readonly Transition<ProjectionStatus>[] = [
  ["draft", "active"],
  ["active", "archived"],
  ["archived", "active"],
] as const;
```

Dentro del handler de `updateStatus`, ANTES del `ctx.db.patch`:

```ts
assertTransition(
  "projections",
  "status",
  projection.status as ProjectionStatus,
  args.status,
  ALLOWED_PROJECTION_STATUS_TRANSITIONS
);
```

NOTA: `active → draft` está intencionalmente bloqueado para forzar a usar `cloneProjectionToDraft` + `replaceProjection` que tienen la cascade lógica completa.

- [ ] **Step 4.4: Run, expect PASS**

Run: `npx vitest run convex/functions/projections/__tests__/updateStatus.guards.test.ts`
Expected: 7 tests PASS.

- [ ] **Step 4.5: Suite projections regression**

Run: `npx vitest run convex/functions/projections/__tests__/`
Expected: todos verdes. Si algún test legacy de `replaceProjection` o `cloneProjectionToDraft` falla porque internamente llama `updateStatus(draft)`, reportar BLOCKED — esos paths deben usar `ctx.db.patch` directo o un internalMutation que skip el guard.

- [ ] **Step 4.6: Commit**

```bash
git add convex/functions/projections/mutations.ts convex/functions/projections/__tests__/updateStatus.guards.test.ts
git commit -m "$(cat <<'EOF'
fix(projections): transition guards en updateStatus

Phase 3 §7.2. Bloquea active → draft (debe ir por replaceProjection),
archived → draft, y saltos como draft → archived. Permite re-activar
desde archived → active.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Guards en `questionnaireResponses.updateStatus`

**Files:**
- Modify: `convex/functions/questionnaires/mutations.ts` (`updateStatus`)
- Test: `convex/functions/questionnaires/__tests__/updateStatus.guards.test.ts`

**Contexto:** Spec §7.1:

```
draft → sent → in_progress → completed
                          ↺ in_progress (vía reopen mutation, admin only)
```

`updateStatus` directo NO debe permitir reversas (excepto via la mutation `reopen` que es separada). Transitions permitidas vía `updateStatus`:
- `draft → sent`
- `sent → in_progress`
- `in_progress → completed`
- `draft → in_progress` (cliente puede empezar a responder sin que admin hit "send")

BLOQUEADO: `completed → *` (solo via `reopen`), `sent → draft`, etc.

- [ ] **Step 5.1: Test rojo**

Crear `convex/functions/questionnaires/__tests__/updateStatus.guards.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api } from "../../../_generated/api";

const ORG_A = "org_test_A";

async function seedQuestionnaire(
  t: ReturnType<typeof convexTest>,
  status: "draft" | "sent" | "in_progress" | "completed"
) {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId: ORG_A, name: "C", rfc: "X", industry: "S",
      annualRevenue: 0, billingFrequency: "mensual",
      isArchived: false, createdAt: Date.now(),
    });
    const projectionId = await ctx.db.insert("projections", {
      orgId: ORG_A, clientId, year: 2026,
      annualSales: 0, totalBudget: 0, commissionRate: 0,
      seasonalityData: [], status: "active",
      createdAt: Date.now(), updatedAt: Date.now(),
    });
    return await ctx.db.insert("questionnaireResponses", {
      orgId: ORG_A, clientId, projectionId,
      responses: [],
      status,
      createdAt: Date.now(),
    });
  });
}

describe("questionnaireResponses.updateStatus guards", () => {
  it("allows draft → sent", async () => {
    const t = convexTest(schema);
    const id = await seedQuestionnaire(t, "draft");
    await t
      .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
      .mutation(api.functions.questionnaires.mutations.updateStatus, {
        id, status: "sent",
      });
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.status).toBe("sent");
  });

  it("allows sent → in_progress", async () => {
    const t = convexTest(schema);
    const id = await seedQuestionnaire(t, "sent");
    await t
      .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
      .mutation(api.functions.questionnaires.mutations.updateStatus, {
        id, status: "in_progress",
      });
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.status).toBe("in_progress");
  });

  it("allows in_progress → completed (set completedAt)", async () => {
    const t = convexTest(schema);
    const id = await seedQuestionnaire(t, "in_progress");
    await t
      .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
      .mutation(api.functions.questionnaires.mutations.updateStatus, {
        id, status: "completed",
      });
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.status).toBe("completed");
    expect(after?.completedAt).toBeGreaterThan(0);
  });

  it("allows draft → in_progress (cliente empieza sin send explícito)", async () => {
    const t = convexTest(schema);
    const id = await seedQuestionnaire(t, "draft");
    await t
      .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
      .mutation(api.functions.questionnaires.mutations.updateStatus, {
        id, status: "in_progress",
      });
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.status).toBe("in_progress");
  });

  it("is idempotent (completed → completed no throw)", async () => {
    const t = convexTest(schema);
    const id = await seedQuestionnaire(t, "completed");
    await expect(
      t
        .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
        .mutation(api.functions.questionnaires.mutations.updateStatus, {
          id, status: "completed",
        })
    ).resolves.toBeUndefined();
  });

  it("throws INVALID_TRANSITION on completed → in_progress (debe ir por reopen)", async () => {
    const t = convexTest(schema);
    const id = await seedQuestionnaire(t, "completed");
    await expect(
      t
        .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
        .mutation(api.functions.questionnaires.mutations.updateStatus, {
          id, status: "in_progress",
        })
    ).rejects.toThrow(/INVALID_TRANSITION|completed.*in_progress/i);
  });

  it("throws INVALID_TRANSITION on sent → draft (reversa)", async () => {
    const t = convexTest(schema);
    const id = await seedQuestionnaire(t, "sent");
    await expect(
      t
        .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
        .mutation(api.functions.questionnaires.mutations.updateStatus, {
          id, status: "draft",
        })
    ).rejects.toThrow(/INVALID_TRANSITION|sent.*draft/i);
  });

  it("throws INVALID_TRANSITION on draft → completed (saltó in_progress)", async () => {
    const t = convexTest(schema);
    const id = await seedQuestionnaire(t, "draft");
    await expect(
      t
        .withIdentity({ subject: "u", tokenIdentifier: "u", orgId: ORG_A } as any)
        .mutation(api.functions.questionnaires.mutations.updateStatus, {
          id, status: "completed",
        })
    ).rejects.toThrow(/INVALID_TRANSITION|draft.*completed/i);
  });
});
```

- [ ] **Step 5.2: Run, expect FAIL en illegal transitions**

Run: `npx vitest run convex/functions/questionnaires/__tests__/updateStatus.guards.test.ts`
Expected: 4 happy paths + idempotency PASS, 3 illegal transitions FAIL.

- [ ] **Step 5.3: Implementar guard**

En `convex/functions/questionnaires/mutations.ts`, agregar import al top si no existe:

```ts
import { assertTransition, type Transition } from "../../lib/stateMachines";
```

Antes de `export const updateStatus` (o al top tras imports), agregar:

```ts
type QStatus = "draft" | "sent" | "in_progress" | "completed";

const ALLOWED_QUESTIONNAIRE_STATUS_TRANSITIONS: readonly Transition<QStatus>[] = [
  ["draft", "sent"],
  ["draft", "in_progress"],
  ["sent", "in_progress"],
  ["in_progress", "completed"],
] as const;
```

Dentro del handler de `updateStatus`, ANTES del `ctx.db.patch`:

```ts
assertTransition(
  "questionnaireResponses",
  "status",
  questionnaire.status as QStatus,
  args.status,
  ALLOWED_QUESTIONNAIRE_STATUS_TRANSITIONS
);
```

NOTA: `completed → in_progress` está bloqueado intencionalmente. La mutation `reopen` (admin only) tiene su propio path y NO usa `updateStatus`.

- [ ] **Step 5.4: Run, expect PASS**

Run: `npx vitest run convex/functions/questionnaires/__tests__/updateStatus.guards.test.ts`
Expected: 8 tests PASS.

- [ ] **Step 5.5: Suite questionnaires regression**

Run: `npx vitest run convex/functions/questionnaires/__tests__/`
Expected: todos verdes. Si `publicMutations` (cliente público actualizando status vía token) internamente llama `updateStatus`, podría romper — verificar leyendo `publicMutations.ts`. Si rompe, esos paths deben usar internal mutations dedicadas (ej. `updateResponsesByToken`) en vez de `updateStatus`.

- [ ] **Step 5.6: Commit**

```bash
git add convex/functions/questionnaires/mutations.ts convex/functions/questionnaires/__tests__/updateStatus.guards.test.ts
git commit -m "$(cat <<'EOF'
fix(questionnaires): transition guards en updateStatus

Phase 3 §7.2. Bloquea completed → in_progress (debe ir por reopen
mutation admin-only), reversas, y saltos. Permite draft → in_progress
para cuando cliente empieza a responder sin send admin explícito.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Verificación final

**Files:** ninguno

- [ ] **Step 6.1: Suite completa**

Run: `npm test 2>&1 | grep "Tests" | tail -1`
Expected: `Tests XXXX passed | 1 skipped` (baseline 1144 + ~30 nuevos tests = ~1174).

- [ ] **Step 6.2: TypeScript clean**

Run: `npx tsc --noEmit 2>&1 | tail -3`
Expected: 0 errores.

- [ ] **Step 6.3: Convex codegen**

Run: `npx convex codegen 2>&1 | tail -3`
Expected: clean.

- [ ] **Step 6.4: GitNexus reindex**

Run: `npx gitnexus analyze --embeddings 2>&1 | tail -3` (background OK)
Expected: completa.

- [ ] **Step 6.5: Smoke check del diff**

Run: `git log --oneline 7dc65c5..HEAD`
Expected: 5 commits Phase 3 (1 helper + 4 mutations guards).

- [ ] **Step 6.6: Reportar al user**

Resumen: cuántos commits, tests pasando, tsc clean, 4 mutations protegidas con transition guards. NO push.

---

## Notas finales

- Cada task es un commit independiente — rollback selectivo via `git revert <hash>`.
- NO push (memoria `feedback_no_push_default`).
- Los tests RED en illegal transitions confirman que el código actual SÍ permite la transición ilegal — base para regression check.
- Si algún flow legacy (cron, public mutation, internal mutation) llama `updateStatus` con una transición que ahora es ilegal, reportar BLOCKED en lugar de relajar el guard. Esos paths deben migrar a su propio internal mutation que skip el guard si el caso es legítimo.
- Phase 4 (schema cleanup: drop satConcepts, seasonalityMode, projectionServices.subserviceId scalar) y Phase 5 (polish) quedan separadas.
