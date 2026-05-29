# Fase 4 — Matrices Entregables + Filtros Facturación Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement three features: (1) client deliverable matrix tab in `/clientes/[id]`, (2) "Generar" buttons in empty cells of that matrix, (3) billing filters by cliente/servicio/proveedor (issuingCompany) with sidebar reorder.

**Architecture:** Each feature is a self-contained commit. #24 adds a Convex query + a new sub-route page under `/clientes/[id]/entregables`. #25 enhances that page with "Generar" action buttons that call the existing `generateDeliverable` action. #25-bis extends `invoices.queries.listForBilling` with `clientId` + `issuingCompanyId` filters and adds the corresponding UI dropdowns to `/facturacion`, plus reorders the sidebar nav.

**Tech Stack:** Next.js 15 App Router, Convex queries/actions, React hooks, Tailwind CSS, shadcn/ui patterns (no new deps).

---

## File Map

### Punto #24 — Client Deliverable Matrix (read-only)

| Op | File |
|----|------|
| Create | `convex/functions/deliverables/queries.ts` — add `listByClientMatrix` query |
| Create | `convex/functions/deliverables/__tests__/listByClientMatrix.test.ts` |
| Create | `src/app/(dashboard)/clientes/[id]/entregables/page.tsx` |

### Punto #25 — Generate Button Per Cell

| Op | File |
|----|------|
| Modify | `src/app/(dashboard)/clientes/[id]/entregables/page.tsx` — add generate flow |

### Punto #25-bis — Facturación Filters + Sidebar Reorder

| Op | File |
|----|------|
| Modify | `convex/functions/invoices/queries.ts` — add `clientId` + `issuingCompanyId` args to `listForBilling` |
| Create | `convex/functions/invoices/__tests__/listForBillingClientFilter.test.ts` |
| Modify | `src/app/(dashboard)/facturacion/page.tsx` — add client + proveedor filter dropdowns |
| Modify | `src/components/layout/sidebar.tsx` — swap Facturación before Entregables |

---

## Task 1: `listByClientMatrix` Convex query

**Files:**
- Modify: `convex/functions/deliverables/queries.ts`
- Create: `convex/functions/deliverables/__tests__/listByClientMatrix.test.ts`

### Context

The query takes a `clientId` and returns all deliverables for that client grouped by `projServiceId`. The UI needs to know which months are covered and what deliverable (if any) exists per (service, month) cell.

Return shape:
```ts
{
  services: Array<{
    projServiceId: Id<"projectionServices">;
    serviceName: string;
    deliverables: Array<{
      _id: Id<"deliverables">;
      assignmentId: Id<"monthlyAssignments">;
      month: number;
      year: number;
      auditStatus: "pending" | "approved" | "rejected" | "corrected";
      deliveredAt?: number;
      createdAt: number;
    }>;
  }>;
  months: number[];  // sorted unique month numbers (1-12) across all deliverables
}
```

- [ ] **Step 1: Write the failing test**

Create `/Users/christiandarrelcoverlozano/Desktop/Projects/DESC/convex/functions/deliverables/__tests__/listByClientMatrix.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { setupTest, ORG_A } from "../../../../tests/harness";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

async function seedDeliverable(
  t: ReturnType<typeof setupTest>,
  opts: {
    orgId: string;
    clientId: Id<"clients">;
    projServiceId: Id<"projectionServices">;
    serviceName: string;
    month: number;
    year: number;
  }
): Promise<Id<"deliverables">> {
  return await t.run(async (ctx) => {
    const projectionId = await ctx.db.insert("projections", {
      orgId: opts.orgId,
      clientId: opts.clientId,
      year: opts.year,
      annualSales: 0,
      totalBudget: 0,
      commissionRate: 0,
      seasonalityData: [],
      status: "active" as const,
      createdAt: 0,
      updatedAt: 0,
    });
    const assignmentId = await ctx.db.insert("monthlyAssignments", {
      orgId: opts.orgId,
      projServiceId: opts.projServiceId,
      projectionId,
      clientId: opts.clientId,
      serviceName: opts.serviceName,
      month: opts.month,
      year: opts.year,
      amount: 1000,
      feFactor: 1,
      status: "pending" as const,
      invoiceStatus: "not_invoiced" as const,
    });
    return await ctx.db.insert("deliverables", {
      orgId: opts.orgId,
      assignmentId,
      projServiceId: opts.projServiceId,
      clientId: opts.clientId,
      serviceName: opts.serviceName,
      month: opts.month,
      year: opts.year,
      shortContent: "",
      longContent: "",
      auditStatus: "pending" as const,
      retryCount: 0,
      createdAt: Date.now(),
    });
  });
}

describe("listByClientMatrix", () => {
  it("returns empty for client with no deliverables", async () => {
    const t = setupTest();
    const orgId = ORG_A;
    const clientId = await t.run(async (ctx) =>
      ctx.db.insert("clients", {
        orgId,
        name: "Test",
        rfc: "TEST010101AAA",
        industry: "Servicios",
        annualRevenue: 0,
        billingFrequency: "mensual" as const,
        isArchived: false,
        createdAt: 0,
      })
    );

    const auth = t.withIdentity({ orgId, orgRole: "org:member" });
    const result = await auth.query(
      api.functions.deliverables.queries.listByClientMatrix,
      { clientId }
    );
    expect(result.services).toEqual([]);
    expect(result.months).toEqual([]);
  });

  it("groups deliverables by projServiceId and collects months", async () => {
    const t = setupTest();
    const orgId = ORG_A;

    const clientId = await t.run(async (ctx) =>
      ctx.db.insert("clients", {
        orgId,
        name: "Acme",
        rfc: "ACM010101AAA",
        industry: "Servicios",
        annualRevenue: 0,
        billingFrequency: "mensual" as const,
        isArchived: false,
        createdAt: 0,
      })
    );
    const serviceId = await t.run(async (ctx) =>
      ctx.db.insert("services", {
        name: "Contabilidad",
        type: "base" as const,
        minPct: 0,
        maxPct: 1,
        defaultPct: 0.1,
        isDefault: true,
        sortOrder: 1,
      })
    );
    const projServiceId = await t.run(async (ctx) => {
      const projectionId = await ctx.db.insert("projections", {
        orgId,
        clientId,
        year: 2026,
        annualSales: 0,
        totalBudget: 0,
        commissionRate: 0,
        seasonalityData: [],
        status: "active" as const,
        createdAt: 0,
        updatedAt: 0,
      });
      return ctx.db.insert("projectionServices", {
        orgId,
        projectionId,
        serviceId,
        serviceName: "Contabilidad",
        chosenPct: 0.1,
        isActive: true,
        annualAmount: 120000,
        normalizedWeight: 0.1,
      });
    });

    await seedDeliverable(t, {
      orgId,
      clientId,
      projServiceId,
      serviceName: "Contabilidad",
      month: 1,
      year: 2026,
    });
    await seedDeliverable(t, {
      orgId,
      clientId,
      projServiceId,
      serviceName: "Contabilidad",
      month: 3,
      year: 2026,
    });

    const auth = t.withIdentity({ orgId, orgRole: "org:member" });
    const result = await auth.query(
      api.functions.deliverables.queries.listByClientMatrix,
      { clientId }
    );

    expect(result.services).toHaveLength(1);
    expect(result.services[0].projServiceId).toBe(projServiceId);
    expect(result.services[0].serviceName).toBe("Contabilidad");
    expect(result.services[0].deliverables).toHaveLength(2);
    expect(result.months).toEqual([1, 3]);
  });

  it("excludes deliverables from other orgs", async () => {
    const t = setupTest();
    const orgId = ORG_A;
    const otherOrg = "org_other";

    const clientId = await t.run(async (ctx) =>
      ctx.db.insert("clients", {
        orgId,
        name: "Mine",
        rfc: "MNE010101AAA",
        industry: "Servicios",
        annualRevenue: 0,
        billingFrequency: "mensual" as const,
        isArchived: false,
        createdAt: 0,
      })
    );

    const serviceId = await t.run(async (ctx) =>
      ctx.db.insert("services", {
        name: "S",
        type: "base" as const,
        minPct: 0,
        maxPct: 1,
        defaultPct: 0.1,
        isDefault: true,
        sortOrder: 1,
      })
    );
    const projServiceId = await t.run(async (ctx) => {
      const projectionId = await ctx.db.insert("projections", {
        orgId,
        clientId,
        year: 2026,
        annualSales: 0,
        totalBudget: 0,
        commissionRate: 0,
        seasonalityData: [],
        status: "active" as const,
        createdAt: 0,
        updatedAt: 0,
      });
      return ctx.db.insert("projectionServices", {
        orgId,
        projectionId,
        serviceId,
        serviceName: "S",
        chosenPct: 0.1,
        isActive: true,
        annualAmount: 0,
        normalizedWeight: 0.1,
      });
    });

    // Seed one for this org, one for a different org (same clientId structure)
    await seedDeliverable(t, {
      orgId,
      clientId,
      projServiceId,
      serviceName: "S",
      month: 2,
      year: 2026,
    });

    // Insert a "cross-org" deliverable directly
    await t.run(async (ctx) => {
      const assignmentId = await ctx.db.insert("monthlyAssignments", {
        orgId: otherOrg,
        projServiceId,
        projectionId: projServiceId as any, // doesn't matter for this test
        clientId,
        serviceName: "S",
        month: 5,
        year: 2026,
        amount: 0,
        feFactor: 1,
        status: "pending" as const,
        invoiceStatus: "not_invoiced" as const,
      });
      await ctx.db.insert("deliverables", {
        orgId: otherOrg,
        assignmentId,
        projServiceId,
        clientId,
        serviceName: "S",
        month: 5,
        year: 2026,
        shortContent: "",
        longContent: "",
        auditStatus: "pending" as const,
        retryCount: 0,
        createdAt: Date.now(),
      });
    });

    const auth = t.withIdentity({ orgId, orgRole: "org:member" });
    const result = await auth.query(
      api.functions.deliverables.queries.listByClientMatrix,
      { clientId }
    );

    // Only month 2 from orgId is visible
    expect(result.months).toEqual([2]);
    expect(result.services[0].deliverables).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/christiandarrelcoverlozano/Desktop/Projects/DESC && npm test -- convex/functions/deliverables/__tests__/listByClientMatrix.test.ts 2>&1 | tail -10
```

Expected: FAIL — `listByClientMatrix` not found on `api.functions.deliverables.queries`.

- [ ] **Step 3: Add `listByClientMatrix` to `convex/functions/deliverables/queries.ts`**

Append to end of the file (after `getById`):

```ts
export const listByClientMatrix = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return { services: [], months: [] };

    const rows = await ctx.db
      .query("deliverables")
      .withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
      .collect();

    const mine = rows.filter((d) => d.orgId === orgId);

    // Group by projServiceId
    const byService = new Map<
      string,
      {
        projServiceId: string;
        serviceName: string;
        deliverables: typeof mine;
      }
    >();

    for (const d of mine) {
      const key = d.projServiceId as unknown as string;
      if (!byService.has(key)) {
        byService.set(key, {
          projServiceId: key,
          serviceName: d.serviceName,
          deliverables: [],
        });
      }
      byService.get(key)!.deliverables.push(d);
    }

    const services = [...byService.values()].map((s) => ({
      ...s,
      deliverables: s.deliverables
        .map((d) => ({
          _id: d._id,
          assignmentId: d.assignmentId,
          month: d.month,
          year: d.year,
          auditStatus: d.auditStatus,
          deliveredAt: d.deliveredAt,
          createdAt: d.createdAt,
        }))
        .sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month)),
    }));

    const allMonths = [...new Set(mine.map((d) => d.month))].sort((a, b) => a - b);

    return { services, months: allMonths };
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/christiandarrelcoverlozano/Desktop/Projects/DESC && npm test -- convex/functions/deliverables/__tests__/listByClientMatrix.test.ts 2>&1 | tail -10
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Run full suite to confirm baseline**

```bash
cd /Users/christiandarrelcoverlozano/Desktop/Projects/DESC && npm test 2>&1 | tail -5
```

Expected: 1088 passed (3 new).

---

## Task 2: Client Entregables Matrix page (read-only, #24)

**Files:**
- Create: `src/app/(dashboard)/clientes/[id]/entregables/page.tsx`

### Context

- Route: `/clientes/[id]/entregables`
- Uses `listByClientMatrix` query.
- Renders a `<table>` with rows = services, columns = months. Each cell links to `/entregables/[deliverableId]` when a deliverable exists, or shows "—" when empty.
- Add a quick link from the client detail page (`/clientes/[id]`) using the existing header button pattern.

### Sub-task A: Create the matrix page

- [ ] **Step 1: Create `/Users/christiandarrelcoverlozano/Desktop/Projects/DESC/src/app/(dashboard)/clientes/[id]/entregables/page.tsx`**

```tsx
"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import { Id } from "../../../../../../convex/_generated/dataModel";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FileOutput } from "lucide-react";
import { cn } from "@/lib/utils";

const MONTH_SHORT = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

const AUDIT_COLORS: Record<string, string> = {
  pending: "bg-muted-foreground/20 text-muted-foreground",
  approved: "bg-emerald-500/20 text-emerald-400",
  rejected: "bg-red-500/20 text-red-400",
  corrected: "bg-blue-500/20 text-blue-400",
};

const AUDIT_LABELS: Record<string, string> = {
  pending: "Pend.",
  approved: "Aprob.",
  rejected: "Rech.",
  corrected: "Corr.",
};

export default function ClientEntregablesPage() {
  const params = useParams();
  const clientId = params.id as Id<"clients">;

  const client = useQuery(api.functions.clients.queries.getById, { id: clientId });
  const matrix = useQuery(
    api.functions.deliverables.queries.listByClientMatrix,
    { clientId }
  );

  if (client === undefined || matrix === undefined) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-secondary" />
        <div className="h-64 animate-pulse rounded-lg border border-border bg-card" />
      </div>
    );
  }

  if (client === null) {
    return (
      <div className="space-y-4">
        <Link
          href="/clientes"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <ArrowLeft size={14} /> Volver a Clientes
        </Link>
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <p className="text-muted-foreground">Cliente no encontrado.</p>
        </div>
      </div>
    );
  }

  const { services, months } = matrix;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/clientes/${clientId}`}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <ArrowLeft size={14} /> Volver a {client.name}
        </Link>
        <div className="mt-2 flex items-center gap-2">
          <FileOutput size={20} className="text-accent" />
          <h1 className="text-2xl font-semibold">
            Entregables — {client.name}
          </h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Matriz de entregables generados por servicio y mes.
        </p>
      </div>

      {services.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <FileOutput className="mx-auto mb-4 text-muted-foreground" size={48} />
          <p className="text-lg font-medium">Sin entregables</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Aún no se han generado entregables para este cliente.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground min-w-[160px]">
                  Servicio
                </th>
                {months.map((m) => (
                  <th
                    key={m}
                    className="px-3 py-2.5 text-center font-medium text-muted-foreground min-w-[80px]"
                  >
                    {MONTH_SHORT[m - 1]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {services.map((svc) => (
                <tr
                  key={svc.projServiceId}
                  className="border-b border-border/50 hover:bg-secondary/20"
                >
                  <td className="px-4 py-3 font-medium">{svc.serviceName}</td>
                  {months.map((m) => {
                    const d = svc.deliverables.find((x) => x.month === m);
                    return (
                      <td key={m} className="px-3 py-3 text-center">
                        {d ? (
                          <Link
                            href={`/entregables/${d._id}`}
                            className={cn(
                              "inline-block rounded-full px-2 py-0.5 text-xs font-medium hover:opacity-80 transition-opacity",
                              AUDIT_COLORS[d.auditStatus]
                            )}
                            title={d.auditStatus}
                          >
                            {AUDIT_LABELS[d.auditStatus]}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

### Sub-task B: Add nav link on the client detail page

- [ ] **Step 2: Add the "Ver Entregables" button to `/Users/christiandarrelcoverlozano/Desktop/Projects/DESC/src/app/(dashboard)/clientes/[id]/page.tsx`**

In the header button group (where "Ver Ciclo Documental" already exists), add after that link and before "Editar":

Find the existing block:
```tsx
          <Link
            href={`/clientes/${clientId}/ciclo`}
            className="flex items-center gap-2 rounded-md bg-accent/10 border border-accent/30 px-3 py-2 text-sm text-accent hover:bg-accent/20 transition-colors cursor-pointer"
          >
            <GitBranchPlus size={14} />
            Ver Ciclo Documental
          </Link>
```

Replace it with:
```tsx
          <Link
            href={`/clientes/${clientId}/ciclo`}
            className="flex items-center gap-2 rounded-md bg-accent/10 border border-accent/30 px-3 py-2 text-sm text-accent hover:bg-accent/20 transition-colors cursor-pointer"
          >
            <GitBranchPlus size={14} />
            Ver Ciclo Documental
          </Link>
          <Link
            href={`/clientes/${clientId}/entregables`}
            className="flex items-center gap-2 rounded-md bg-accent/10 border border-accent/30 px-3 py-2 text-sm text-accent hover:bg-accent/20 transition-colors cursor-pointer"
          >
            <FileOutput size={14} />
            Entregables
          </Link>
```

Also add `FileOutput` to the import at the top of the file (it's already imported from `lucide-react` in other pages but check the current import list for `clientes/[id]/page.tsx`):

The current import is:
```tsx
import {
  ArrowLeft,
  Building2,
  Edit,
  Archive,
  RotateCcw,
  TrendingUp,
  GitBranchPlus,
  Layers,
  Plus,
  ExternalLink,
} from "lucide-react";
```

Replace with:
```tsx
import {
  ArrowLeft,
  Building2,
  Edit,
  Archive,
  RotateCcw,
  TrendingUp,
  GitBranchPlus,
  Layers,
  Plus,
  ExternalLink,
  FileOutput,
} from "lucide-react";
```

- [ ] **Step 3: Run TypeScript check**

```bash
cd /Users/christiandarrelcoverlozano/Desktop/Projects/DESC && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit #24**

```bash
cd /Users/christiandarrelcoverlozano/Desktop/Projects/DESC && git add \
  convex/functions/deliverables/queries.ts \
  convex/functions/deliverables/__tests__/listByClientMatrix.test.ts \
  src/app/\(dashboard\)/clientes/\[id\]/entregables/page.tsx \
  src/app/\(dashboard\)/clientes/\[id\]/page.tsx

git commit -m "$(cat <<'EOF'
feat(papa-doc): client document matrix for deliverables (#24)

- Add `listByClientMatrix` Convex query: groups client deliverables by
  projServiceId, returns { services, months } for matrix rendering.
- New sub-route /clientes/[id]/entregables with a table matrix:
  rows = services, columns = months, cells = colored audit-status badge
  linking to /entregables/[id].
- Add "Entregables" shortcut button on client detail page header.
- 3 new tests for the query (empty, grouped, cross-org isolation).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Generate button per cell (#25)

**Files:**
- Modify: `src/app/(dashboard)/clientes/[id]/entregables/page.tsx`

### Context

For cells with no deliverable, if the monthly assignment exists for that service+month, show a "Generar" button. The `generateDeliverable` action already exists at `api.functions.deliverables.actions.generateDeliverable`.

To show "Generar" we need the list of monthly assignments for this client so we know which cells have an assignment but no deliverable. We'll add a query for that: use the existing `api.functions.monthlyAssignments.queries.listByProjection` is per-projection — we need by-client. We'll use `listByClientMonth` but that requires a month; instead fetch assignments for the active projection. 

**Pragmatic approach:** Use `api.functions.projections.queries.getByClient` (already used in the detail page) to find the active projection, then use `api.functions.monthlyAssignments.queries.listByProjection` to get all its assignments. We can then find the assignment for each (service, month) cell.

The `generateDeliverable` requires `assignmentId`, `projServiceId`, `clientId`, and `templateType`. For the matrix, we'll generate `"deliverable_short"` as the default type (matching what the existing `/entregables` flow does).

After clicking "Generar", show an optimistic loading state in the cell until the query reactively picks up the new deliverable.

- [ ] **Step 1: Enhance the matrix page with generate logic**

Replace the full content of `/Users/christiandarrelcoverlozano/Desktop/Projects/DESC/src/app/(dashboard)/clientes/[id]/entregables/page.tsx` with:

```tsx
"use client";

import { useQuery, useAction } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import { Id } from "../../../../../../convex/_generated/dataModel";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FileOutput, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

const MONTH_SHORT = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

const AUDIT_COLORS: Record<string, string> = {
  pending: "bg-muted-foreground/20 text-muted-foreground",
  approved: "bg-emerald-500/20 text-emerald-400",
  rejected: "bg-red-500/20 text-red-400",
  corrected: "bg-blue-500/20 text-blue-400",
};

const AUDIT_LABELS: Record<string, string> = {
  pending: "Pend.",
  approved: "Aprob.",
  rejected: "Rech.",
  corrected: "Corr.",
};

export default function ClientEntregablesPage() {
  const params = useParams();
  const clientId = params.id as Id<"clients">;

  const client = useQuery(api.functions.clients.queries.getById, { id: clientId });
  const matrix = useQuery(
    api.functions.deliverables.queries.listByClientMatrix,
    { clientId }
  );
  const projections = useQuery(
    api.functions.projections.queries.getByClient,
    { clientId }
  );

  // Find the active projection (or most recent draft)
  const activeProjection = projections?.find((p) => p.status === "active")
    ?? projections?.[0]
    ?? null;

  const assignments = useQuery(
    api.functions.monthlyAssignments.queries.listByProjection,
    activeProjection ? { projectionId: activeProjection._id } : "skip"
  );

  const generateDeliverable = useAction(
    api.functions.deliverables.actions.generateDeliverable
  );

  // Track which (projServiceId, month) cells are generating
  const [generating, setGenerating] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function handleGenerate(
    projServiceId: Id<"projectionServices">,
    month: number
  ) {
    const cellKey = `${projServiceId}-${month}`;
    if (!assignments) return;

    // Find the assignment for this service+month
    const assignment = assignments.find(
      (a) => (a.projServiceId as unknown as string) === (projServiceId as unknown as string)
        && a.month === month
    );
    if (!assignment) return;

    setGenerating((prev) => new Set([...prev, cellKey]));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[cellKey];
      return next;
    });

    try {
      await generateDeliverable({
        assignmentId: assignment._id,
        projServiceId: assignment.projServiceId,
        clientId: assignment.clientId,
        templateType: "deliverable_short",
        triggerSource: "manual",
      });
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [cellKey]: (err as Error).message ?? "Error al generar",
      }));
    } finally {
      setGenerating((prev) => {
        const next = new Set(prev);
        next.delete(cellKey);
        return next;
      });
    }
  }

  if (client === undefined || matrix === undefined) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-secondary" />
        <div className="h-64 animate-pulse rounded-lg border border-border bg-card" />
      </div>
    );
  }

  if (client === null) {
    return (
      <div className="space-y-4">
        <Link
          href="/clientes"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <ArrowLeft size={14} /> Volver a Clientes
        </Link>
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <p className="text-muted-foreground">Cliente no encontrado.</p>
        </div>
      </div>
    );
  }

  const { services, months } = matrix;

  // Build a lookup: `${projServiceId}-${month}` → assignment._id
  // so we can show "Generar" only when an assignment exists but no deliverable.
  const assignmentCellMap = new Map<string, Id<"monthlyAssignments">>();
  if (assignments) {
    for (const a of assignments) {
      assignmentCellMap.set(
        `${a.projServiceId as unknown as string}-${a.month}`,
        a._id
      );
    }
  }

  // Months to show = union of months with deliverables + months in assignments
  // We show all months that have either a deliverable or an assignment for any
  // of the services in the matrix (capped to the matrix's own months for now,
  // extended below).
  const assignmentMonths = assignments
    ? [...new Set(assignments.map((a) => a.month))]
    : [];
  const allMonths = [...new Set([...months, ...assignmentMonths])].sort((a, b) => a - b);

  // Build set of (projServiceId) from assignments for "Generar" eligibility.
  const assignmentProjServices = new Set(
    (assignments ?? []).map((a) => a.projServiceId as unknown as string)
  );

  // Merge matrix services with assignment-only services (services that have
  // assignments but zero deliverables yet).
  const assignmentServiceNames = new Map<string, string>();
  for (const a of assignments ?? []) {
    assignmentServiceNames.set(a.projServiceId as unknown as string, a.serviceName);
  }
  const matrixServiceIds = new Set(services.map((s) => s.projServiceId));
  const assignmentOnlyServices: typeof services = [];
  for (const [psId, svcName] of assignmentServiceNames) {
    if (!matrixServiceIds.has(psId)) {
      assignmentOnlyServices.push({
        projServiceId: psId,
        serviceName: svcName,
        deliverables: [],
      });
    }
  }
  const allServices = [...services, ...assignmentOnlyServices];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/clientes/${clientId}`}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <ArrowLeft size={14} /> Volver a {client.name}
        </Link>
        <div className="mt-2 flex items-center gap-2">
          <FileOutput size={20} className="text-accent" />
          <h1 className="text-2xl font-semibold">
            Entregables — {client.name}
          </h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Matriz de entregables por servicio y mes. Haz clic en una celda para
          ver el entregable o generarlo.
        </p>
      </div>

      {allServices.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <FileOutput className="mx-auto mb-4 text-muted-foreground" size={48} />
          <p className="text-lg font-medium">Sin entregables ni asignaciones</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Este cliente no tiene proyecciones activas con asignaciones mensuales.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground min-w-[160px]">
                  Servicio
                </th>
                {allMonths.map((m) => (
                  <th
                    key={m}
                    className="px-3 py-2.5 text-center font-medium text-muted-foreground min-w-[80px]"
                  >
                    {MONTH_SHORT[m - 1]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allServices.map((svc) => (
                <tr
                  key={svc.projServiceId}
                  className="border-b border-border/50 hover:bg-secondary/20"
                >
                  <td className="px-4 py-3 font-medium">{svc.serviceName}</td>
                  {allMonths.map((m) => {
                    const d = svc.deliverables.find((x) => x.month === m);
                    const cellKey = `${svc.projServiceId}-${m}`;
                    const isGenerating = generating.has(cellKey);
                    const cellError = errors[cellKey];
                    const hasAssignment = assignmentCellMap.has(cellKey);

                    return (
                      <td key={m} className="px-3 py-3 text-center">
                        {d ? (
                          <Link
                            href={`/entregables/${d._id}`}
                            className={cn(
                              "inline-block rounded-full px-2 py-0.5 text-xs font-medium hover:opacity-80 transition-opacity",
                              AUDIT_COLORS[d.auditStatus]
                            )}
                            title={d.auditStatus}
                          >
                            {AUDIT_LABELS[d.auditStatus]}
                          </Link>
                        ) : isGenerating ? (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Loader2 size={10} className="animate-spin" />
                            Gen…
                          </span>
                        ) : hasAssignment ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() =>
                                handleGenerate(
                                  svc.projServiceId as Id<"projectionServices">,
                                  m
                                )
                              }
                              title="Generar entregable"
                              className="inline-flex items-center gap-0.5 rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground hover:border-accent/40 hover:text-accent transition-colors cursor-pointer"
                            >
                              <Plus size={10} /> Gen.
                            </button>
                            {cellError && (
                              <span className="text-[9px] text-red-400 max-w-[72px] truncate" title={cellError}>
                                Error
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run TypeScript check**

```bash
cd /Users/christiandarrelcoverlozano/Desktop/Projects/DESC && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Run tests (no new tests for this UI-only enhancement)**

```bash
cd /Users/christiandarrelcoverlozano/Desktop/Projects/DESC && npm test 2>&1 | tail -5
```

Expected: 1088 passed (same as after Task 1+2).

- [ ] **Step 4: Commit #25**

```bash
cd /Users/christiandarrelcoverlozano/Desktop/Projects/DESC && git add \
  src/app/\(dashboard\)/clientes/\[id\]/entregables/page.tsx

git commit -m "$(cat <<'EOF'
feat(papa-doc): generate button per cell in client deliverable matrix (#25)

- Matrix page now also loads monthly assignments for the active projection
  and merges assignment-only services (no deliverable yet) into the rows.
- Empty cells that have a matching assignment show a "Gen." button; clicking
  it calls `generateDeliverable` (manual trigger, deliverable_short type)
  and shows an inline spinner until the Convex subscription delivers the
  new row.
- Error state per cell shown inline with truncated message.
- Note: "entregable final vs minutas mensuales" editorial distinction is
  deferred — one deliverable per assignment per month is the current model.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Sidebar reorder (Facturación before Entregables) — #25-bis prep

**Files:**
- Modify: `src/components/layout/sidebar.tsx`

### Context

Current nav order:
```
..., Entregables, Facturación, Configuración
```

Target:
```
..., Facturación, Entregables, Configuración
```

- [ ] **Step 1: Swap items in the `navigation` array**

In `/Users/christiandarrelcoverlozano/Desktop/Projects/DESC/src/components/layout/sidebar.tsx`, find:

```ts
  { name: "Entregables", href: "/entregables", icon: FileOutput },
  { name: "Facturación", href: "/facturacion", icon: Receipt },
```

Replace with:

```ts
  { name: "Facturación", href: "/facturacion", icon: Receipt },
  { name: "Entregables", href: "/entregables", icon: FileOutput },
```

- [ ] **Step 2: Verify the file looks correct (check with TypeScript)**

```bash
cd /Users/christiandarrelcoverlozano/Desktop/Projects/DESC && npx tsc --noEmit 2>&1 | head -10
```

Expected: no errors.

---

## Task 5: `listForBilling` — add `clientId` + `issuingCompanyId` filters

**Files:**
- Modify: `convex/functions/invoices/queries.ts`
- Create: `convex/functions/invoices/__tests__/listForBillingClientFilter.test.ts`

### Context

`invoices` has a `projServiceId` field. The invoice itself does NOT have a direct `issuingCompanyId`. However, there's a `servicesIssuingCompanyMap` table and a `clientIssuingCompanyOverride` table used for resolving which issuing company issues for a given service+client. For the billing filter the stakeholder calls "proveedor" they mean the `issuingCompanyId` that was resolved at time of contract/quotation — but invoices themselves don't store it.

**Decision:** The `invoices` table stores a `projServiceId`. The filter "por proveedor" means: show only invoices whose `projServiceId`'s parent service is mapped to a given `issuingCompanyId` in `servicesIssuingCompanyMap`. We implement this as an in-memory join after the main fetch (acceptable — org-wide invoice counts stay in the hundreds).

For `clientId`, invoices have `invoices.clientId` so it's a direct filter.

Add optional `clientId` and `issuingCompanyId` args to `listForBilling`.

- [ ] **Step 1: Write the failing test**

Create `/Users/christiandarrelcoverlozano/Desktop/Projects/DESC/convex/functions/invoices/__tests__/listForBillingClientFilter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

async function seedFullInvoice(
  t: ReturnType<typeof setupTest>,
  opts: {
    orgId: string;
    clientName: string;
    serviceName?: string;
    issuingCompanyName?: string;
    year?: number;
    month?: number;
  }
): Promise<{
  clientId: Id<"clients">;
  invoiceId: Id<"invoices">;
  issuingCompanyId?: Id<"issuingCompanies">;
  projServiceId: Id<"projectionServices">;
  serviceId: Id<"services">;
}> {
  return t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId: opts.orgId,
      name: opts.clientName,
      rfc: "TST010101AAA",
      industry: "Servicios",
      annualRevenue: 0,
      billingFrequency: "mensual" as const,
      isArchived: false,
      createdAt: 0,
    });
    const projectionId = await ctx.db.insert("projections", {
      orgId: opts.orgId,
      clientId,
      year: opts.year ?? 2026,
      annualSales: 0,
      totalBudget: 0,
      commissionRate: 0,
      seasonalityData: [],
      status: "active" as const,
      createdAt: 0,
      updatedAt: 0,
    });
    const serviceId = await ctx.db.insert("services", {
      name: opts.serviceName ?? "S",
      type: "base" as const,
      minPct: 0,
      maxPct: 1,
      defaultPct: 0.1,
      isDefault: true,
      sortOrder: 1,
    });
    const projServiceId = await ctx.db.insert("projectionServices", {
      orgId: opts.orgId,
      projectionId,
      serviceId,
      serviceName: opts.serviceName ?? "S",
      chosenPct: 0.1,
      isActive: true,
      annualAmount: 0,
      normalizedWeight: 0.1,
    });

    let issuingCompanyId: Id<"issuingCompanies"> | undefined;
    if (opts.issuingCompanyName) {
      issuingCompanyId = await ctx.db.insert("issuingCompanies", {
        orgId: opts.orgId,
        name: opts.issuingCompanyName,
        legalName: opts.issuingCompanyName,
        rfc: "ISS010101AAA",
        regimenFiscalCode: "612",
        codigoPostal: "01000",
        address: {
          street: "Av. Test",
          city: "CDMX",
          state: "CDMX",
          country: "MX",
        },
        email: "test@test.mx",
        isDefault: false,
        isActive: true,
        createdAt: 0,
        updatedAt: 0,
      });
      await ctx.db.insert("servicesIssuingCompanyMap", {
        orgId: opts.orgId,
        serviceId,
        issuingCompanyId,
        createdAt: 0,
        updatedAt: 0,
      });
    }

    const invoiceId = await ctx.db.insert("invoices", {
      orgId: opts.orgId,
      clientId,
      projectionId,
      projServiceId,
      serviceName: opts.serviceName ?? "S",
      month: opts.month ?? 1,
      year: opts.year ?? 2026,
      amount: 1000,
      bucketKey: "k",
      contentType: "application/pdf",
      sizeBytes: 1,
      filename: "x.pdf",
      status: "uploaded" as const,
      uploadedAt: 0,
      uploadedBy: "u",
      createdAt: 0,
    });

    return { clientId, invoiceId, issuingCompanyId, projServiceId, serviceId };
  });
}

describe("listForBilling — clientId filter", () => {
  it("returns only invoices for the specified clientId", async () => {
    const t = setupTest();
    const orgId = "org_1";

    const { clientId: clientA } = await seedFullInvoice(t, {
      orgId,
      clientName: "Alpha",
      serviceName: "Contabilidad",
    });
    await seedFullInvoice(t, {
      orgId,
      clientName: "Beta",
      serviceName: "Fiscal",
    });

    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });
    const result = await auth.query(
      api.functions.invoices.queries.listForBilling,
      { year: 2026, clientId: clientA }
    );

    expect(result).toHaveLength(1);
    expect(result[0].clientId).toBe(clientA);
  });
});

describe("listForBilling — issuingCompanyId filter", () => {
  it("returns only invoices whose service maps to the specified issuingCompanyId", async () => {
    const t = setupTest();
    const orgId = "org_2";

    const { issuingCompanyId: companyX } = await seedFullInvoice(t, {
      orgId,
      clientName: "Gamma",
      serviceName: "Auditoría",
      issuingCompanyName: "DESC SA",
    });
    await seedFullInvoice(t, {
      orgId,
      clientName: "Delta",
      serviceName: "Legal",
      // no issuing company mapping
    });

    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });
    const result = await auth.query(
      api.functions.invoices.queries.listForBilling,
      { year: 2026, issuingCompanyId: companyX! }
    );

    expect(result).toHaveLength(1);
    expect(result[0].serviceName).toBe("Auditoría");
  });

  it("returns empty when no invoices match the issuingCompanyId", async () => {
    const t = setupTest();
    const orgId = "org_3";

    const { issuingCompanyId: unusedId } = await seedFullInvoice(t, {
      orgId,
      clientName: "Epsilon",
      serviceName: "Nómina",
      issuingCompanyName: "Dummy Corp",
    });

    // Seed another invoice with no company mapping
    await seedFullInvoice(t, {
      orgId,
      clientName: "Zeta",
      serviceName: "Marketing",
    });

    // Query for a non-existent company id
    const otherCompanyId = unusedId!; // reuse to validate correctness
    // Actually query with the real id — should return 1 result
    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });
    const result = await auth.query(
      api.functions.invoices.queries.listForBilling,
      { year: 2026, issuingCompanyId: otherCompanyId }
    );
    expect(result).toHaveLength(1);
    expect(result[0].serviceName).toBe("Nómina");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/christiandarrelcoverlozano/Desktop/Projects/DESC && npm test -- convex/functions/invoices/__tests__/listForBillingClientFilter.test.ts 2>&1 | tail -10
```

Expected: FAIL — new args not accepted yet.

- [ ] **Step 3: Extend `listForBilling` in `convex/functions/invoices/queries.ts`**

Replace the `listForBilling` export with:

```ts
export const listForBilling = query({
  args: {
    year: v.number(),
    month: v.optional(v.number()),
    status: v.optional(
      v.union(
        v.literal("uploaded"),
        v.literal("paid"),
        v.literal("void")
      )
    ),
    // SS5: fiscal period filter — uses issueDate, falling back to uploadedAt
    issueDateFrom: v.optional(v.number()),
    issueDateTo: v.optional(v.number()),
    // #25-bis: optional filters
    clientId: v.optional(v.id("clients")),
    issuingCompanyId: v.optional(v.id("issuingCompanies")),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];
    let rows = await ctx.db
      .query("invoices")
      .withIndex("by_orgId", (qb) => qb.eq("orgId", orgId))
      .collect();
    rows = rows.filter((r) => r.year === args.year);
    if (args.month !== undefined) {
      rows = rows.filter((r) => r.month === args.month);
    }
    if (args.status) {
      rows = rows.filter((r) => r.status === args.status);
    }
    if (args.issueDateFrom !== undefined) {
      rows = rows.filter((r) => (r.issueDate ?? r.uploadedAt) >= args.issueDateFrom!);
    }
    if (args.issueDateTo !== undefined) {
      rows = rows.filter((r) => (r.issueDate ?? r.uploadedAt) <= args.issueDateTo!);
    }
    // #25-bis: clientId filter
    if (args.clientId !== undefined) {
      rows = rows.filter((r) => r.clientId === args.clientId);
    }
    // #25-bis: issuingCompanyId filter — join via servicesIssuingCompanyMap
    if (args.issuingCompanyId !== undefined) {
      // Collect all projServiceIds that map to this issuing company via
      // their parent serviceId.
      const maps = await ctx.db
        .query("servicesIssuingCompanyMap")
        .withIndex("by_issuingCompanyId", (q) =>
          q.eq("issuingCompanyId", args.issuingCompanyId!)
        )
        .collect();
      const mappedServiceIds = new Set(maps.map((m) => m.serviceId as unknown as string));

      // For efficiency, bulk-fetch the projServices referenced by filtered rows.
      const projServiceIds = [...new Set(
        rows.filter((r) => r.projServiceId).map((r) => r.projServiceId!)
      )];
      const projServices = await Promise.all(
        projServiceIds.map((id) => ctx.db.get(id))
      );
      const psServiceMap = new Map<string, string>();
      for (const ps of projServices) {
        if (ps) psServiceMap.set(ps._id as unknown as string, ps.serviceId as unknown as string);
      }

      rows = rows.filter((r) => {
        if (!r.projServiceId) return false;
        const serviceId = psServiceMap.get(r.projServiceId as unknown as string);
        return serviceId !== undefined && mappedServiceIds.has(serviceId);
      });
    }
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});
```

- [ ] **Step 4: Run the new tests**

```bash
cd /Users/christiandarrelcoverlozano/Desktop/Projects/DESC && npm test -- convex/functions/invoices/__tests__/listForBillingClientFilter.test.ts 2>&1 | tail -10
```

Expected: 3 tests PASS.

- [ ] **Step 5: Run full suite**

```bash
cd /Users/christiandarrelcoverlozano/Desktop/Projects/DESC && npm test 2>&1 | tail -5
```

Expected: 1091 passed (3 new).

---

## Task 6: Facturación UI — add cliente + proveedor filter dropdowns (#25-bis)

**Files:**
- Modify: `src/app/(dashboard)/facturacion/page.tsx`

### Context

The page already has year, month, service, status, and issueDate filters. We need to add two more:
1. **Cliente** — a `<select>` bound to `selectedClientId` state, passed to `listForBilling` as `clientId`.
2. **Proveedor (empresa emisora)** — a `<select>` bound to `selectedIssuingCompanyId`, passed to `listForBilling` as `issuingCompanyId`.

For the client list, use `api.functions.clients.queries.list` (already used in `/entregables`).
For the issuing company list, use `api.functions.issuingCompanies.queries.list`.

The `listForInvoiceTracking` query (assignments table) also needs the `clientId` filter for the "Estado Entrega" column. However, this query doesn't accept `clientId` yet — to avoid scope creep, we'll filter assignments in-memory client-side after the query (the page already does in-memory grouping).

Implementation approach:
- Add `useQuery` for clients and issuing companies.
- Add state `selectedClientId` and `selectedIssuingCompanyId`.
- Pass them to `listForBilling`.
- Filter `assignments` array in-memory by `clientId` when set.
- Add the two `<select>` elements in the Filters block.

**Important:** `listForInvoiceTracking` won't be modified — the assignment rows are already client-name enriched and we'll filter them in memory.

- [ ] **Step 1: Add state + queries to `FacturacionPageInner`**

In `/Users/christiandarrelcoverlozano/Desktop/Projects/DESC/src/app/(dashboard)/facturacion/page.tsx`:

After the existing state declarations (around line 100, after `issueDateTo` state), add:

```tsx
  const [selectedClientId, setSelectedClientId] = useState<string | undefined>(undefined);
  const [selectedIssuingCompanyId, setSelectedIssuingCompanyId] = useState<string | undefined>(undefined);
```

After the `const { membership } = useOrganization();` line, add:

```tsx
  const clients = useQuery(api.functions.clients.queries.list, {});
  const issuingCompanies = useQuery(api.functions.issuingCompanies.queries.list, {});
```

Modify the `invoiceRows` query call (around line 125) to pass the new filter args:

The existing call is:
```tsx
  const invoiceRows = useQuery(
    api.functions.invoices.queries.listForBilling,
    {
      year: selectedYear,
      month: selectedMonth,
      issueDateFrom: issueDateFrom ? new Date(issueDateFrom).getTime() : undefined,
      issueDateTo: issueDateTo ? new Date(issueDateTo).getTime() : undefined,
    }
  ) as InvoiceRow[] | undefined;
```

Replace with:
```tsx
  const invoiceRows = useQuery(
    api.functions.invoices.queries.listForBilling,
    {
      year: selectedYear,
      month: selectedMonth,
      issueDateFrom: issueDateFrom ? new Date(issueDateFrom).getTime() : undefined,
      issueDateTo: issueDateTo ? new Date(issueDateTo).getTime() : undefined,
      clientId: selectedClientId as Id<"clients"> | undefined,
      issuingCompanyId: selectedIssuingCompanyId as Id<"issuingCompanies"> | undefined,
    }
  ) as InvoiceRow[] | undefined;
```

- [ ] **Step 2: Filter assignments in memory when `selectedClientId` is set**

Find the line that computes `serviceNames`:

```tsx
  const serviceNames = assignments
    ? [...new Set(assignments.map((a) => a.serviceName))].sort()
    : [];
```

Replace with:
```tsx
  // Apply clientId filter to assignments in memory (listForInvoiceTracking doesn't
  // accept clientId yet — kept to avoid scope creep on the assignments query).
  const filteredAssignments = assignments
    ? selectedClientId
      ? assignments.filter((a) => (a.clientId as unknown as string) === selectedClientId)
      : assignments
    : undefined;

  const serviceNames = filteredAssignments
    ? [...new Set(filteredAssignments.map((a) => a.serviceName))].sort()
    : [];
```

Then replace all subsequent references to `assignments` with `filteredAssignments` (for `grouped`, `totalAmount`, `statusCounts`, and the render). This affects:

```tsx
  const grouped = assignments
    ? assignments.reduce(...)
    : {};
  const totalAmount = assignments?.reduce(...) ?? 0;
  const statusCounts = assignments?.reduce(...) ?? {};
```

Replace each occurrence of `assignments` (the variable, not `listForInvoiceTracking`) in those three blocks and the render body with `filteredAssignments`. For the render condition `assignments === undefined` keep it checking the original `assignments` (for loading state).

Concretely:
- `const grouped = assignments` → `const grouped = filteredAssignments`
- `const totalAmount = assignments?.reduce` → `const totalAmount = filteredAssignments?.reduce`
- `const statusCounts = assignments?.reduce` → `const statusCounts = filteredAssignments?.reduce`
- `{assignments === undefined ? (` → keep as `{assignments === undefined ? (` (loading skeleton)
- `assignments.length === 0` → `filteredAssignments?.length === 0` (empty state)

- [ ] **Step 3: Add the two `<select>` elements in the Filters block**

Find the closing of the issueDate filter range (around line 385):

```tsx
        </div>
      </div>

      {/* Loading / Empty / Table */}
```

Insert before that `</div>` (which closes the filters block):

```tsx
        {/* #25-bis: Cliente filter */}
        <div className="relative">
          <select
            value={selectedClientId ?? ""}
            onChange={(e) => setSelectedClientId(e.target.value || undefined)}
            aria-label="Cliente"
            className="appearance-none rounded-md border border-border bg-secondary px-3 py-1.5 pr-8 text-sm text-foreground"
          >
            <option value="">Todos los clientes</option>
            {(clients ?? []).map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
        </div>

        {/* #25-bis: Proveedor (empresa emisora) filter */}
        <div className="relative">
          <select
            value={selectedIssuingCompanyId ?? ""}
            onChange={(e) => setSelectedIssuingCompanyId(e.target.value || undefined)}
            aria-label="Proveedor (empresa emisora)"
            className="appearance-none rounded-md border border-border bg-secondary px-3 py-1.5 pr-8 text-sm text-foreground"
          >
            <option value="">Todos los proveedores</option>
            {(issuingCompanies ?? []).map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
        </div>
```

- [ ] **Step 4: Add the needed imports**

`Id` from the generated dataModel is not currently imported in `facturacion/page.tsx`. Add it. The file currently imports:

```tsx
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
```

`Id` is already imported (line 7). No change needed.

- [ ] **Step 5: Run TypeScript check**

```bash
cd /Users/christiandarrelcoverlozano/Desktop/Projects/DESC && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 6: Run full test suite**

```bash
cd /Users/christiandarrelcoverlozano/Desktop/Projects/DESC && npm test 2>&1 | tail -5
```

Expected: 1091 passed (unchanged — all new tests from Task 5 already committed).

- [ ] **Step 7: Commit #25-bis**

```bash
cd /Users/christiandarrelcoverlozano/Desktop/Projects/DESC && git add \
  convex/functions/invoices/queries.ts \
  convex/functions/invoices/__tests__/listForBillingClientFilter.test.ts \
  src/app/\(dashboard\)/facturacion/page.tsx \
  src/components/layout/sidebar.tsx

git commit -m "$(cat <<'EOF'
feat(papa-doc): facturación filters by cliente/servicio/proveedor + sidebar reorder (#25-bis)

- `listForBilling` query now accepts optional `clientId` (direct field filter)
  and `issuingCompanyId` (in-memory join via servicesIssuingCompanyMap →
  projectionServices → serviceId).
- Facturación page adds "Todos los clientes" and "Todos los proveedores"
  selects; clientId filter is also applied in-memory to the assignments
  list (no query change to listForInvoiceTracking to keep scope minimal).
- Sidebar: Facturación now appears before Entregables per stakeholder request.
- "Por plataforma" filter is NOT implemented: plataforma === orgId === current
  org until multi-tenant #26-A is shipped. The existing per-org filtering is
  already "plataforma" context by definition.
- 3 new tests for the query-level filters (clientId isolation, issuingCompanyId
  join, empty-result case).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Verification

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/christiandarrelcoverlozano/Desktop/Projects/DESC && npm test 2>&1 | tail -6
```

Expected output shape:
```
 Test Files  154 passed (154)
       Tests  1091 passed | 1 skipped (1092)
```

- [ ] **Step 2: TypeScript clean**

```bash
cd /Users/christiandarrelcoverlozano/Desktop/Projects/DESC && npx tsc --noEmit 2>&1 | head -10
```

Expected: no errors.

- [ ] **Step 3: Check git log**

```bash
cd /Users/christiandarrelcoverlozano/Desktop/Projects/DESC && git log --oneline -5
```

Expected: 3 new commits on top of baseline (`e347be3`).

---

## Self-Review

**Spec coverage check:**

| Requirement | Covered by |
|------------|-----------|
| #24 — client picker → matrix per service | `/clientes/[id]/entregables` page + `listByClientMatrix` query |
| #24 — click cell → see/download entregable | Each cell links to `/entregables/[id]` |
| #24 — 1 test for the query | `listByClientMatrix.test.ts` (3 tests actually) |
| #25 — "Generar" button in empty cells | `handleGenerate` + optimistic spinner in matrix page |
| #25 — reuse `generateDeliverable` mutation | Uses `useAction(api.functions.deliverables.actions.generateDeliverable)` |
| #25-bis — filter by clientId | `listForBilling` + `setSelectedClientId` dropdown |
| #25-bis — filter by proveedor (issuingCompanyId) | `listForBilling` + `setSelectedIssuingCompanyId` dropdown |
| #25-bis — sidebar reorder | Sidebar nav array swapped |
| "por plataforma" note | Documented in commit message as deferred |

**Placeholder scan:** No TBDs, no "add validation" stubs, no "similar to Task N" references.

**Type consistency:**
- `listByClientMatrix` returns `{ services: Array<{projServiceId: string, serviceName: string, deliverables: Array<{...}>}>, months: number[] }` — consistent with matrix page usage.
- `listForBilling` new args are `v.optional(v.id("clients"))` and `v.optional(v.id("issuingCompanies"))` — consistent with how the UI passes them.
- `filteredAssignments` is used in place of `assignments` for display logic but `assignments` is still used for loading state — this distinction is intentional and correctly implemented.
