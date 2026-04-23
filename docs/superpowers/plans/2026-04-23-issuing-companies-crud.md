# Empresas Emitentes CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build CRUD admin de empresas emitentes + resolver + seed dummy. Desbloquea secciones 3 y 4 del sprint v2.

**Architecture:** Patrón estándar del codebase — `convex/functions/issuingCompanies/` con queries/mutations/actions separados, resolver como TS puro más wrapper internalQuery. UI en `src/app/(dashboard)/configuracion/empresas-emitentes/` siguiendo el patrón de `clientes/`. No hay cambios al schema.

**Tech Stack:** Next.js 15 + React 19 + Convex + Clerk Organizations + Tailwind. Tests con Vitest (puro) y convex-test (integration, se instala en Fase 7).

**Spec:** `docs/superpowers/specs/2026-04-23-issuing-companies-crud-design.md`

---

## File Structure

### New files — Backend

- `convex/functions/issuingCompanies/helpers.ts` — catálogo SAT de regímenes fiscales, helper `validateRegimenFiscal`
- `convex/functions/issuingCompanies/queries.ts` — list, getById, listServiceMap, listAvailableServices, getDefault, countReferences
- `convex/functions/issuingCompanies/mutations.ts` — create, update, setDefault, remove, assignServicesToCompany, setLogoFromStorage, removeLogo, generateUploadUrl
- `convex/functions/issuingCompanies/resolve.ts` — `NoIssuingCompanyError`, `resolveIssuingCompany` (TS puro) + `resolveIssuingCompanyQuery` (internalQuery wrapper)
- `convex/functions/seed/v2Fixtures.ts` — seed dummy (2 empresas + service map + 1 override)

### New files — Tests

- `convex/functions/issuingCompanies/__tests__/helpers.test.ts` — unit del catálogo SAT
- `convex/functions/issuingCompanies/__tests__/resolveIssuingCompany.test.ts` — unit del resolver con mock ctx
- `convex/functions/issuingCompanies/__tests__/mutations.test.ts` — integration con convex-test (Fase 7)
- `convex/functions/issuingCompanies/__tests__/permissions.test.ts` — integration con convex-test (Fase 7)

### New files — Frontend

- `src/components/configuracion/empresas-emitentes/IssuingCompanyForm.tsx`
- `src/components/configuracion/empresas-emitentes/IssuingCompanyList.tsx`
- `src/components/configuracion/empresas-emitentes/IssuingCompanyDetailTabs.tsx`
- `src/components/configuracion/empresas-emitentes/ServicesAssignmentEditor.tsx`
- `src/components/configuracion/empresas-emitentes/DangerZone.tsx`
- `src/components/configuracion/empresas-emitentes/DeleteConfirmDialog.tsx`
- `src/components/configuracion/empresas-emitentes/SetDefaultDialog.tsx`
- `src/components/configuracion/empresas-emitentes/LogoUploader.tsx`
- `src/app/(dashboard)/configuracion/empresas-emitentes/page.tsx`
- `src/app/(dashboard)/configuracion/empresas-emitentes/nueva/page.tsx`
- `src/app/(dashboard)/configuracion/empresas-emitentes/[id]/page.tsx`

### Modified files

- `src/app/(dashboard)/configuracion/page.tsx` — convertir en hub con card a empresas-emitentes
- No se toca `convex/schema.ts` (ya tiene todo)
- No se toca sidebar (ya tiene link a `/configuracion`)

### Reusos del codebase

- `convex/lib/authHelpers.ts` — `requireAuth`, `requireAdmin`, `getOrgId`, `getOrgIdSafe`
- `convex/lib/validators.ts` — `RFC_PATTERN`, `isValidRFC` (no reescribir)
- Patrón de form: `src/components/clients/client-form.tsx`
- Patrón de list page: `src/app/(dashboard)/clientes/page.tsx`
- Patrón de logo upload: `convex/functions/orgBranding/mutations.ts` (nota: `generateUploadUrl` existe como mutation en el patrón, no como action)

---

## Phase 1: Backend helpers (pure TS, TDD)

### Task 1: Catálogo SAT de regímenes fiscales + validator

**Files:**
- Create: `convex/functions/issuingCompanies/helpers.ts`
- Create: `convex/functions/issuingCompanies/__tests__/helpers.test.ts`

- [ ] **Step 1: Write the failing test**

Write `convex/functions/issuingCompanies/__tests__/helpers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SAT_REGIMENES, validateRegimenFiscal, getRegimenLabel } from "../helpers";

describe("SAT_REGIMENES catalog", () => {
  it("includes the 4 most common régimenes", () => {
    const codes = SAT_REGIMENES.map((r) => r.code);
    expect(codes).toContain("601"); // General de Ley PM
    expect(codes).toContain("603"); // PM con Fines No Lucrativos
    expect(codes).toContain("612"); // Persona Física Actividad Empresarial
    expect(codes).toContain("626"); // RESICO
  });
});

describe("validateRegimenFiscal", () => {
  it("accepts a valid code", () => {
    expect(validateRegimenFiscal("601")).toBe(true);
  });
  it("rejects an unknown code", () => {
    expect(validateRegimenFiscal("999")).toBe(false);
  });
  it("rejects empty string", () => {
    expect(validateRegimenFiscal("")).toBe(false);
  });
});

describe("getRegimenLabel", () => {
  it("returns the label for a valid code", () => {
    expect(getRegimenLabel("601")).toMatch(/General de Ley/i);
  });
  it("returns null for an unknown code", () => {
    expect(getRegimenLabel("999")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- helpers.test.ts`
Expected: FAIL with "Cannot find module '../helpers'"

- [ ] **Step 3: Write the implementation**

Write `convex/functions/issuingCompanies/helpers.ts`:

```ts
export interface SATRegimen {
  code: string;
  label: string;
  personaType: "moral" | "fisica" | "ambas";
}

export const SAT_REGIMENES: readonly SATRegimen[] = [
  { code: "601", label: "General de Ley Personas Morales", personaType: "moral" },
  { code: "603", label: "Personas Morales con Fines No Lucrativos", personaType: "moral" },
  { code: "605", label: "Sueldos y Salarios", personaType: "fisica" },
  { code: "606", label: "Arrendamiento", personaType: "fisica" },
  { code: "608", label: "Demás ingresos", personaType: "fisica" },
  { code: "612", label: "Personas Físicas con Actividades Empresariales y Profesionales", personaType: "fisica" },
  { code: "621", label: "Incorporación Fiscal", personaType: "fisica" },
  { code: "625", label: "Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas", personaType: "fisica" },
  { code: "626", label: "Régimen Simplificado de Confianza (RESICO)", personaType: "ambas" },
] as const;

const REGIMEN_MAP = new Map(SAT_REGIMENES.map((r) => [r.code, r]));

export function validateRegimenFiscal(code: string): boolean {
  return REGIMEN_MAP.has(code);
}

export function getRegimenLabel(code: string): string | null {
  return REGIMEN_MAP.get(code)?.label ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- helpers.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add convex/functions/issuingCompanies/helpers.ts convex/functions/issuingCompanies/__tests__/helpers.test.ts
git commit -m "feat(issuingCompanies): add SAT régimen fiscal catalog + helpers"
```

---

## Phase 2: Backend queries

### Task 2: `queries.ts` — list + getById

**Files:**
- Create: `convex/functions/issuingCompanies/queries.ts`

- [ ] **Step 1: Write `list` and `getById`**

Write `convex/functions/issuingCompanies/queries.ts`:

```ts
import { query } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgIdSafe } from "../../lib/authHelpers";

export const list = query({
  args: {
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    let companies = await ctx.db
      .query("issuingCompanies")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    if (!args.includeInactive) {
      companies = companies.filter((c) => c.isActive);
    }

    // Compute serviceCount and clientOverrideCount per company
    const withCounts = await Promise.all(
      companies.map(async (c) => {
        const services = await ctx.db
          .query("servicesIssuingCompanyMap")
          .withIndex("by_issuingCompanyId", (q) => q.eq("issuingCompanyId", c._id))
          .collect();
        const overrides = await ctx.db
          .query("clientIssuingCompanyOverride")
          .withIndex("by_issuingCompanyId", (q) => q.eq("issuingCompanyId", c._id))
          .collect();
        return {
          ...c,
          serviceCount: services.length,
          clientOverrideCount: overrides.length,
        };
      })
    );

    return withCounts.sort((a, b) => {
      // Default first, then alphabetical by name
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return a.name.localeCompare(b.name);
    });
  },
});

export const getById = query({
  args: { id: v.id("issuingCompanies") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;
    const doc = await ctx.db.get(args.id);
    if (!doc || doc.orgId !== orgId) return null;
    return doc;
  },
});
```

- [ ] **Step 2: Manual smoke test**

Run: `npx convex dev` (in a separate terminal, if not already running).
In Convex dashboard, call `issuingCompanies.queries.list` — should return `[]` (DB empty).

- [ ] **Step 3: Commit**

```bash
git add convex/functions/issuingCompanies/queries.ts
git commit -m "feat(issuingCompanies): add list + getById queries"
```

---

### Task 3: `queries.ts` — listServiceMap, listAvailableServices, getDefault, countReferences

**Files:**
- Modify: `convex/functions/issuingCompanies/queries.ts` (append)

- [ ] **Step 1: Append `listServiceMap`**

Append to `convex/functions/issuingCompanies/queries.ts`:

```ts
export const listServiceMap = query({
  args: { issuingCompanyId: v.id("issuingCompanies") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];
    const company = await ctx.db.get(args.issuingCompanyId);
    if (!company || company.orgId !== orgId) return [];

    const maps = await ctx.db
      .query("servicesIssuingCompanyMap")
      .withIndex("by_issuingCompanyId", (q) => q.eq("issuingCompanyId", args.issuingCompanyId))
      .collect();

    return Promise.all(
      maps.map(async (m) => {
        const service = await ctx.db.get(m.serviceId);
        return {
          mapId: m._id,
          serviceId: m.serviceId,
          serviceName: service?.name ?? "(desconocido)",
        };
      })
    );
  },
});
```

- [ ] **Step 2: Append `listAvailableServices`**

```ts
export const listAvailableServices = query({
  args: { issuingCompanyId: v.optional(v.id("issuingCompanies")) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const role = (identity.orgRole as string) ?? "org:member";
    if (role !== "org:admin") {
      throw new Error("Acceso denegado. Se requiere rol de Administrador.");
    }
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    // All org services (org-scoped + global seeds)
    const orgServices = await ctx.db
      .query("services")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const globalServices = await ctx.db
      .query("services")
      .withIndex("by_orgId", (q) => q.eq("orgId", undefined))
      .collect();
    const services = [...orgServices, ...globalServices];

    // All mappings in this org
    const maps = await ctx.db
      .query("servicesIssuingCompanyMap")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const mapByService = new Map(maps.map((m) => [m.serviceId, m.issuingCompanyId]));

    // Enrich each service with its current assignment
    const result = await Promise.all(
      services.map(async (s) => {
        const assignedCompanyId = mapByService.get(s._id);
        let assignedTo: { issuingCompanyId: string; name: string } | undefined;
        if (assignedCompanyId) {
          const company = await ctx.db.get(assignedCompanyId);
          if (company) {
            assignedTo = { issuingCompanyId: company._id, name: company.name };
          }
        }
        return {
          serviceId: s._id,
          serviceName: s.name,
          assignedTo,
        };
      })
    );

    return result.sort((a, b) => a.serviceName.localeCompare(b.serviceName));
  },
});
```

- [ ] **Step 3: Append `getDefault` and `countReferences`**

```ts
export const getDefault = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;
    const results = await ctx.db
      .query("issuingCompanies")
      .withIndex("by_orgId_isDefault", (q) => q.eq("orgId", orgId).eq("isDefault", true))
      .collect();
    return results.find((c) => c.isActive) ?? null;
  },
});

export const countReferences = query({
  args: { id: v.id("issuingCompanies") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("No autenticado");
    const role = (identity.orgRole as string) ?? "org:member";
    if (role !== "org:admin") {
      throw new Error("Acceso denegado. Se requiere rol de Administrador.");
    }

    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) throw new Error("Sin organización");
    const company = await ctx.db.get(args.id);
    if (!company || company.orgId !== orgId) throw new Error("Empresa no encontrada");

    const [emailLogs, serviceMaps, clientOverrides] = await Promise.all([
      ctx.db
        .query("emailLog")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect()
        .then((rows) => rows.filter((r) => r.issuingCompanyId === args.id).length),
      ctx.db
        .query("servicesIssuingCompanyMap")
        .withIndex("by_issuingCompanyId", (q) => q.eq("issuingCompanyId", args.id))
        .collect()
        .then((r) => r.length),
      ctx.db
        .query("clientIssuingCompanyOverride")
        .withIndex("by_issuingCompanyId", (q) => q.eq("issuingCompanyId", args.id))
        .collect()
        .then((r) => r.length),
    ]);

    // TODO: when sections 3/4 add issuingCompanyId to quotations/contracts/deliverables/deliverableTemplates,
    // add counts here.
    const total = emailLogs + serviceMaps + clientOverrides;

    return {
      emailLog: emailLogs,
      serviceMap: serviceMaps,
      clientOverride: clientOverrides,
      total,
    };
  },
});
```

- [ ] **Step 4: Commit**

```bash
git add convex/functions/issuingCompanies/queries.ts
git commit -m "feat(issuingCompanies): add listServiceMap, listAvailableServices, getDefault, countReferences"
```

---

## Phase 3: Backend mutations

### Task 4: `mutations.ts` — create with auto-default

**Files:**
- Create: `convex/functions/issuingCompanies/mutations.ts`

- [ ] **Step 1: Write `create` mutation**

```ts
import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { requireAdmin, getOrgId } from "../../lib/authHelpers";
import { isValidRFC } from "../../lib/validators";
import { validateRegimenFiscal, getRegimenLabel } from "./helpers";

const addressValidator = v.object({
  street: v.string(),
  exteriorNumber: v.optional(v.string()),
  interiorNumber: v.optional(v.string()),
  colonia: v.optional(v.string()),
  city: v.string(),
  state: v.string(),
  country: v.string(),
});

export const create = mutation({
  args: {
    name: v.string(),
    legalName: v.string(),
    rfc: v.string(),
    regimenFiscalCode: v.string(),
    codigoPostal: v.string(),
    address: addressValidator,
    email: v.string(),
    phone: v.optional(v.string()),
    website: v.optional(v.string()),
    bankName: v.optional(v.string()),
    bankAccount: v.optional(v.string()),
    clabe: v.optional(v.string()),
    currency: v.optional(v.string()),
    invoiceSerie: v.optional(v.string()),
    signatoryName: v.optional(v.string()),
    signatoryTitle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);

    const rfcUpper = args.rfc.toUpperCase().trim();

    // Validations
    if (!isValidRFC(rfcUpper)) {
      throw new Error("Formato de RFC inválido");
    }
    if (!validateRegimenFiscal(args.regimenFiscalCode)) {
      throw new Error("Régimen fiscal inválido");
    }
    if (!/^\d{5}$/.test(args.codigoPostal)) {
      throw new Error("Código postal debe tener 5 dígitos");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.email)) {
      throw new Error("Formato de email inválido");
    }

    // Unique RFC per org
    const existing = await ctx.db
      .query("issuingCompanies")
      .withIndex("by_orgId_rfc", (q) => q.eq("orgId", orgId).eq("rfc", rfcUpper))
      .first();
    if (existing) {
      throw new Error("Ya existe una empresa emitente con ese RFC en la organización");
    }

    // Auto-default: if no active issuingCompany exists yet for this org, this one becomes default
    const activeExisting = await ctx.db
      .query("issuingCompanies")
      .withIndex("by_orgId_isActive", (q) => q.eq("orgId", orgId).eq("isActive", true))
      .first();
    const isDefault = !activeExisting;

    const now = Date.now();
    return await ctx.db.insert("issuingCompanies", {
      orgId,
      name: args.name.trim(),
      legalName: args.legalName.trim(),
      rfc: rfcUpper,
      regimenFiscalCode: args.regimenFiscalCode,
      regimenFiscalLabel: getRegimenLabel(args.regimenFiscalCode) ?? undefined,
      codigoPostal: args.codigoPostal,
      address: args.address,
      email: args.email.trim(),
      phone: args.phone,
      website: args.website,
      bankName: args.bankName,
      bankAccount: args.bankAccount,
      clabe: args.clabe,
      currency: args.currency,
      invoiceSerie: args.invoiceSerie,
      signatoryName: args.signatoryName,
      signatoryTitle: args.signatoryTitle,
      isDefault,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add convex/functions/issuingCompanies/mutations.ts
git commit -m "feat(issuingCompanies): add create mutation with auto-default + validations"
```

---

### Task 5: `mutations.ts` — update with isActive guard

**Files:**
- Modify: `convex/functions/issuingCompanies/mutations.ts` (append)

- [ ] **Step 1: Append `update`**

```ts
export const update = mutation({
  args: {
    id: v.id("issuingCompanies"),
    name: v.optional(v.string()),
    legalName: v.optional(v.string()),
    rfc: v.optional(v.string()),
    regimenFiscalCode: v.optional(v.string()),
    codigoPostal: v.optional(v.string()),
    address: v.optional(addressValidator),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    website: v.optional(v.string()),
    bankName: v.optional(v.string()),
    bankAccount: v.optional(v.string()),
    clabe: v.optional(v.string()),
    currency: v.optional(v.string()),
    invoiceSerie: v.optional(v.string()),
    signatoryName: v.optional(v.string()),
    signatoryTitle: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    const doc = await ctx.db.get(args.id);
    if (!doc || doc.orgId !== orgId) {
      throw new Error("Empresa emitente no encontrada");
    }

    // Guard: cannot deactivate default
    if (args.isActive === false && doc.isDefault) {
      throw new Error("No puedes desactivar la empresa default. Marca otra como default primero.");
    }

    const { id, ...rest } = args;
    const patch: Record<string, unknown> = { updatedAt: Date.now() };

    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) patch[key] = value;
    }

    // Normalize / re-validate fields that were included
    if (patch.rfc) {
      const rfcUpper = (patch.rfc as string).toUpperCase().trim();
      if (!isValidRFC(rfcUpper)) throw new Error("Formato de RFC inválido");
      // Unique RFC per org (excluding self)
      const existing = await ctx.db
        .query("issuingCompanies")
        .withIndex("by_orgId_rfc", (q) => q.eq("orgId", orgId).eq("rfc", rfcUpper))
        .first();
      if (existing && existing._id !== id) {
        throw new Error("Ya existe una empresa emitente con ese RFC en la organización");
      }
      patch.rfc = rfcUpper;
    }
    if (patch.regimenFiscalCode) {
      if (!validateRegimenFiscal(patch.regimenFiscalCode as string)) {
        throw new Error("Régimen fiscal inválido");
      }
      patch.regimenFiscalLabel = getRegimenLabel(patch.regimenFiscalCode as string) ?? undefined;
    }
    if (patch.codigoPostal && !/^\d{5}$/.test(patch.codigoPostal as string)) {
      throw new Error("Código postal debe tener 5 dígitos");
    }
    if (patch.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.email as string)) {
      throw new Error("Formato de email inválido");
    }

    await ctx.db.patch(id, patch);
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add convex/functions/issuingCompanies/mutations.ts
git commit -m "feat(issuingCompanies): add update mutation with isActive guard"
```

---

### Task 6: `mutations.ts` — setDefault (atomic)

**Files:**
- Modify: `convex/functions/issuingCompanies/mutations.ts` (append)

- [ ] **Step 1: Append `setDefault`**

```ts
export const setDefault = mutation({
  args: { id: v.id("issuingCompanies") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    const target = await ctx.db.get(args.id);
    if (!target || target.orgId !== orgId) {
      throw new Error("Empresa emitente no encontrada");
    }
    if (!target.isActive) {
      throw new Error("Reactiva la empresa antes de marcarla como default");
    }
    if (target.isDefault) {
      return; // already default, noop
    }

    // Find current defaults (should be at most 1)
    const currentDefaults = await ctx.db
      .query("issuingCompanies")
      .withIndex("by_orgId_isDefault", (q) => q.eq("orgId", orgId).eq("isDefault", true))
      .collect();

    const now = Date.now();
    // Unset all current defaults
    for (const d of currentDefaults) {
      if (d._id !== args.id) {
        await ctx.db.patch(d._id, { isDefault: false, updatedAt: now });
      }
    }
    // Set target as default
    await ctx.db.patch(args.id, { isDefault: true, updatedAt: now });
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add convex/functions/issuingCompanies/mutations.ts
git commit -m "feat(issuingCompanies): add setDefault mutation (atomic)"
```

---

### Task 7: `mutations.ts` — remove with references guard

**Files:**
- Modify: `convex/functions/issuingCompanies/mutations.ts` (append)

- [ ] **Step 1: Append `remove`**

```ts
export const remove = mutation({
  args: { id: v.id("issuingCompanies") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    const doc = await ctx.db.get(args.id);
    if (!doc || doc.orgId !== orgId) {
      throw new Error("Empresa emitente no encontrada");
    }
    if (doc.isDefault) {
      throw new Error("No puedes borrar la empresa default. Marca otra como default primero.");
    }

    // Count references
    const [emailLogsArr, serviceMapsArr, clientOverridesArr] = await Promise.all([
      ctx.db
        .query("emailLog")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect()
        .then((rows) => rows.filter((r) => r.issuingCompanyId === args.id)),
      ctx.db
        .query("servicesIssuingCompanyMap")
        .withIndex("by_issuingCompanyId", (q) => q.eq("issuingCompanyId", args.id))
        .collect(),
      ctx.db
        .query("clientIssuingCompanyOverride")
        .withIndex("by_issuingCompanyId", (q) => q.eq("issuingCompanyId", args.id))
        .collect(),
    ]);
    // TODO: cuando secciones 3/4 agreguen issuingCompanyId a quotations/contracts/deliverables/deliverableTemplates,
    // contar esas referencias aquí también.

    const total = emailLogsArr.length + serviceMapsArr.length + clientOverridesArr.length;
    if (total > 0) {
      const parts: string[] = [];
      if (emailLogsArr.length) parts.push(`${emailLogsArr.length} email(s)`);
      if (serviceMapsArr.length) parts.push(`${serviceMapsArr.length} asignación(es) de servicio`);
      if (clientOverridesArr.length) parts.push(`${clientOverridesArr.length} override(s) por cliente`);
      throw new Error(
        `No puede borrarse: tiene ${parts.join(", ")}. Desactívala en lugar de borrar.`
      );
    }

    // Delete logo from storage if present
    if (doc.logoStorageId) {
      await ctx.storage.delete(doc.logoStorageId);
    }
    await ctx.db.delete(args.id);
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add convex/functions/issuingCompanies/mutations.ts
git commit -m "feat(issuingCompanies): add remove mutation with references guard"
```

---

### Task 8: `mutations.ts` — assignServicesToCompany (single-assignment)

**Files:**
- Modify: `convex/functions/issuingCompanies/mutations.ts` (append)

- [ ] **Step 1: Append `assignServicesToCompany`**

```ts
export const assignServicesToCompany = mutation({
  args: {
    issuingCompanyId: v.id("issuingCompanies"),
    serviceIds: v.array(v.id("services")),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    const company = await ctx.db.get(args.issuingCompanyId);
    if (!company || company.orgId !== orgId) {
      throw new Error("Empresa emitente no encontrada");
    }

    // Validate all serviceIds belong to this org (or are global seeds)
    for (const sid of args.serviceIds) {
      const service = await ctx.db.get(sid);
      if (!service) throw new Error(`Servicio ${sid} no existe`);
      // services may have orgId=undefined (global seed) OR match this org
      if (service.orgId !== undefined && service.orgId !== orgId) {
        throw new Error(`Servicio ${service.name} pertenece a otra organización`);
      }
    }

    const now = Date.now();

    // Delete all existing mappings for this company
    const existingForCompany = await ctx.db
      .query("servicesIssuingCompanyMap")
      .withIndex("by_issuingCompanyId", (q) => q.eq("issuingCompanyId", args.issuingCompanyId))
      .collect();
    for (const m of existingForCompany) {
      await ctx.db.delete(m._id);
    }

    // For each serviceId: if it's already mapped to ANOTHER company, delete that mapping (single-assignment)
    for (const sid of args.serviceIds) {
      const foreign = await ctx.db
        .query("servicesIssuingCompanyMap")
        .withIndex("by_orgId_serviceId", (q) => q.eq("orgId", orgId).eq("serviceId", sid))
        .first();
      if (foreign) await ctx.db.delete(foreign._id);
    }

    // Create new mappings
    for (const sid of args.serviceIds) {
      await ctx.db.insert("servicesIssuingCompanyMap", {
        orgId,
        serviceId: sid,
        issuingCompanyId: args.issuingCompanyId,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add convex/functions/issuingCompanies/mutations.ts
git commit -m "feat(issuingCompanies): add assignServicesToCompany mutation (single-assignment)"
```

---

### Task 9: `mutations.ts` — logo helpers + generateUploadUrl

**Files:**
- Modify: `convex/functions/issuingCompanies/mutations.ts` (append)

- [ ] **Step 1: Append `setLogoFromStorage`, `removeLogo`, `generateUploadUrl`**

```ts
export const generateUploadUrl = mutation({
  args: { id: v.id("issuingCompanies") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    const doc = await ctx.db.get(args.id);
    if (!doc || doc.orgId !== orgId) {
      throw new Error("Empresa emitente no encontrada");
    }
    return await ctx.storage.generateUploadUrl();
  },
});

export const setLogoFromStorage = mutation({
  args: {
    id: v.id("issuingCompanies"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    const doc = await ctx.db.get(args.id);
    if (!doc || doc.orgId !== orgId) {
      throw new Error("Empresa emitente no encontrada");
    }

    if (doc.logoStorageId) {
      await ctx.storage.delete(doc.logoStorageId);
    }
    await ctx.db.patch(args.id, {
      logoStorageId: args.storageId,
      updatedAt: Date.now(),
    });
  },
});

export const removeLogo = mutation({
  args: { id: v.id("issuingCompanies") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    const doc = await ctx.db.get(args.id);
    if (!doc || doc.orgId !== orgId) {
      throw new Error("Empresa emitente no encontrada");
    }
    if (doc.logoStorageId) {
      await ctx.storage.delete(doc.logoStorageId);
      await ctx.db.patch(args.id, {
        logoStorageId: undefined,
        updatedAt: Date.now(),
      });
    }
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add convex/functions/issuingCompanies/mutations.ts
git commit -m "feat(issuingCompanies): add logo upload/remove mutations"
```

---

## Phase 4: Resolver (TDD pure TS)

### Task 10: Resolver unit tests (with mock ctx)

**Files:**
- Create: `convex/functions/issuingCompanies/__tests__/resolveIssuingCompany.test.ts`

- [ ] **Step 1: Write tests against a shape we'll define next**

```ts
import { describe, it, expect, vi } from "vitest";

// We'll inject a minimal ctx shape; resolver uses only ctx.db.query and ctx.db.get
type MockDoc = { _id: string; [k: string]: unknown };

function makeCtx(docs: {
  issuingCompanies: MockDoc[];
  servicesIssuingCompanyMap: MockDoc[];
  clientIssuingCompanyOverride: MockDoc[];
}) {
  const store: Record<string, MockDoc[]> = {
    issuingCompanies: docs.issuingCompanies,
    servicesIssuingCompanyMap: docs.servicesIssuingCompanyMap,
    clientIssuingCompanyOverride: docs.clientIssuingCompanyOverride,
  };

  function queryBuilder(tableName: string) {
    let rows = [...(store[tableName] ?? [])];
    const api = {
      withIndex: (_name: string, fn: (q: IndexQ) => IndexQ) => {
        const filters: Array<(r: MockDoc) => boolean> = [];
        const q: IndexQ = {
          eq(field: string, value: unknown) {
            filters.push((r) => r[field] === value);
            return q;
          },
        };
        fn(q);
        rows = rows.filter((r) => filters.every((f) => f(r)));
        return api;
      },
      async first() {
        return rows[0] ?? null;
      },
      async collect() {
        return rows;
      },
    };
    return api;
  }
  interface IndexQ { eq: (f: string, v: unknown) => IndexQ }

  return {
    db: {
      query: (tableName: string) => queryBuilder(tableName),
      get: async (id: string) => {
        for (const t of Object.values(store)) {
          const hit = t.find((r) => r._id === id);
          if (hit) return hit;
        }
        return null;
      },
    },
  };
}

// Imports will be available after Task 11
import { resolveIssuingCompany, NoIssuingCompanyError } from "../resolve";

describe("resolveIssuingCompany", () => {
  const orgId = "org_A";
  const clientId = "client_1";
  const serviceId = "service_1";

  it("returns override when client override is present and active", async () => {
    const ctx = makeCtx({
      issuingCompanies: [
        { _id: "company_A", orgId, name: "A", isActive: true, isDefault: true },
        { _id: "company_B", orgId, name: "B", isActive: true, isDefault: false },
      ],
      servicesIssuingCompanyMap: [{ _id: "m1", orgId, serviceId, issuingCompanyId: "company_B" }],
      clientIssuingCompanyOverride: [
        { _id: "o1", orgId, clientId, serviceId, issuingCompanyId: "company_A" },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await resolveIssuingCompany(ctx as any, { orgId, clientId, serviceId });
    expect(res.source).toBe("client_override");
    expect(res.issuingCompany._id).toBe("company_A");
  });

  it("falls back to service map when no override", async () => {
    const ctx = makeCtx({
      issuingCompanies: [
        { _id: "company_A", orgId, name: "A", isActive: true, isDefault: true },
        { _id: "company_B", orgId, name: "B", isActive: true, isDefault: false },
      ],
      servicesIssuingCompanyMap: [{ _id: "m1", orgId, serviceId, issuingCompanyId: "company_B" }],
      clientIssuingCompanyOverride: [],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await resolveIssuingCompany(ctx as any, { orgId, clientId, serviceId });
    expect(res.source).toBe("service_map");
    expect(res.issuingCompany._id).toBe("company_B");
  });

  it("falls back to org default when no override and no service map", async () => {
    const ctx = makeCtx({
      issuingCompanies: [
        { _id: "company_A", orgId, name: "A", isActive: true, isDefault: true },
      ],
      servicesIssuingCompanyMap: [],
      clientIssuingCompanyOverride: [],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await resolveIssuingCompany(ctx as any, { orgId, clientId, serviceId });
    expect(res.source).toBe("org_default");
    expect(res.issuingCompany._id).toBe("company_A");
  });

  it("throws NoIssuingCompanyError when no active company exists", async () => {
    const ctx = makeCtx({
      issuingCompanies: [],
      servicesIssuingCompanyMap: [],
      clientIssuingCompanyOverride: [],
    });
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolveIssuingCompany(ctx as any, { orgId, clientId, serviceId })
    ).rejects.toBeInstanceOf(NoIssuingCompanyError);
  });

  it("degrades from override to service_map when override points to inactive company", async () => {
    const ctx = makeCtx({
      issuingCompanies: [
        { _id: "company_A", orgId, name: "A (inactive)", isActive: false, isDefault: false },
        { _id: "company_B", orgId, name: "B", isActive: true, isDefault: true },
      ],
      servicesIssuingCompanyMap: [{ _id: "m1", orgId, serviceId, issuingCompanyId: "company_B" }],
      clientIssuingCompanyOverride: [
        { _id: "o1", orgId, clientId, serviceId, issuingCompanyId: "company_A" },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await resolveIssuingCompany(ctx as any, { orgId, clientId, serviceId });
    expect(res.source).toBe("service_map");
    expect(res.issuingCompany._id).toBe("company_B");
  });

  it("degrades from service_map to org_default when service map points to inactive", async () => {
    const ctx = makeCtx({
      issuingCompanies: [
        { _id: "company_A", orgId, name: "A (inactive)", isActive: false, isDefault: false },
        { _id: "company_B", orgId, name: "B default", isActive: true, isDefault: true },
      ],
      servicesIssuingCompanyMap: [{ _id: "m1", orgId, serviceId, issuingCompanyId: "company_A" }],
      clientIssuingCompanyOverride: [],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await resolveIssuingCompany(ctx as any, { orgId, clientId, serviceId });
    expect(res.source).toBe("org_default");
    expect(res.issuingCompany._id).toBe("company_B");
  });

  it("throws when only default is inactive", async () => {
    const ctx = makeCtx({
      issuingCompanies: [
        { _id: "company_A", orgId, name: "A", isActive: false, isDefault: true },
      ],
      servicesIssuingCompanyMap: [],
      clientIssuingCompanyOverride: [],
    });
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolveIssuingCompany(ctx as any, { orgId, clientId, serviceId })
    ).rejects.toBeInstanceOf(NoIssuingCompanyError);
  });
});
```

- [ ] **Step 2: Run test — expected FAIL**

Run: `npm test -- resolveIssuingCompany.test.ts`
Expected: FAIL with "Cannot find module '../resolve'"

- [ ] **Step 3: Commit the tests**

```bash
git add convex/functions/issuingCompanies/__tests__/resolveIssuingCompany.test.ts
git commit -m "test(issuingCompanies): add resolver unit tests (failing)"
```

---

### Task 11: Resolver implementation + internalQuery wrapper

**Files:**
- Create: `convex/functions/issuingCompanies/resolve.ts`

- [ ] **Step 1: Implement resolver**

```ts
import { internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { GenericQueryCtx } from "convex/server";
import type { DataModel } from "../../_generated/dataModel";

export class NoIssuingCompanyError extends Error {
  constructor(orgId: string) {
    super(`No hay empresa emitente activa para la organización ${orgId}`);
    this.name = "NoIssuingCompanyError";
  }
}

export type ResolveResult = {
  issuingCompany: Doc<"issuingCompanies">;
  source: "client_override" | "service_map" | "org_default";
};

export async function resolveIssuingCompany(
  ctx: GenericQueryCtx<DataModel>,
  args: { orgId: string; clientId: Id<"clients">; serviceId: Id<"services"> }
): Promise<ResolveResult> {
  const { orgId, clientId, serviceId } = args;

  // 1. clientIssuingCompanyOverride
  const override = await ctx.db
    .query("clientIssuingCompanyOverride")
    .withIndex("by_orgId_client_service", (q) =>
      q.eq("orgId", orgId).eq("clientId", clientId).eq("serviceId", serviceId)
    )
    .first();
  if (override) {
    const company = await ctx.db.get(override.issuingCompanyId);
    if (company && company.isActive) {
      return { issuingCompany: company, source: "client_override" };
    }
  }

  // 2. servicesIssuingCompanyMap
  const mapping = await ctx.db
    .query("servicesIssuingCompanyMap")
    .withIndex("by_orgId_serviceId", (q) =>
      q.eq("orgId", orgId).eq("serviceId", serviceId)
    )
    .first();
  if (mapping) {
    const company = await ctx.db.get(mapping.issuingCompanyId);
    if (company && company.isActive) {
      return { issuingCompany: company, source: "service_map" };
    }
  }

  // 3. org default
  const defaults = await ctx.db
    .query("issuingCompanies")
    .withIndex("by_orgId_isDefault", (q) => q.eq("orgId", orgId).eq("isDefault", true))
    .collect();
  const active = defaults.find((c) => c.isActive);
  if (active) {
    return { issuingCompany: active, source: "org_default" };
  }

  throw new NoIssuingCompanyError(orgId);
}

// Wrapper for actions (section 3/4 will call via ctx.runQuery)
export const resolveIssuingCompanyQuery = internalQuery({
  args: {
    orgId: v.string(),
    clientId: v.id("clients"),
    serviceId: v.id("services"),
  },
  handler: async (ctx, args) => resolveIssuingCompany(ctx, args),
});
```

- [ ] **Step 2: Run tests — expected PASS**

Run: `npm test -- resolveIssuingCompany.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 3: Commit**

```bash
git add convex/functions/issuingCompanies/resolve.ts
git commit -m "feat(issuingCompanies): implement resolver with 3-source fallback + internalQuery wrapper"
```

---

## Phase 5: Seed dummy

### Task 12: Seed fixtures for dev environment

**Files:**
- Create: `convex/functions/seed/v2Fixtures.ts`

- [ ] **Step 1: Check if `convex/functions/seed/` exists**

Run: `ls convex/functions/seed 2>/dev/null || echo "missing"`

If missing: `mkdir -p convex/functions/seed`

- [ ] **Step 2: Implement seed**

Write `convex/functions/seed/v2Fixtures.ts`:

```ts
import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";

/**
 * Seed fixtures for sprint v2 — 2 issuing companies + service map + 1 override.
 * 
 * Run via:
 *   npx convex run seed:v2Fixtures '{"orgId":"<your-org-id>"}'
 * 
 * Guards:
 *   - Refuses to run in production (NODE_ENV check).
 *   - Requires prerequisite data (services "Contable" & "Legal", client "ACME") in the target org.
 *   - Idempotent: wipes issuingCompanies + maps + overrides for this org before inserting.
 */
export const v2Fixtures = internalMutation({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    if (process.env.NODE_ENV === "production") {
      throw new Error("v2Fixtures no puede correr en producción");
    }

    // Prereqs
    const services = await ctx.db
      .query("services")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const contableService = services.find((s) => s.name.toLowerCase().includes("contable"));
    const legalService = services.find((s) => s.name.toLowerCase().includes("legal"));
    if (!contableService || !legalService) {
      throw new Error(
        `Faltan servicios "Contable" y/o "Legal" en la org ${orgId}. Ejecuta seedServices primero.`
      );
    }

    const clients = await ctx.db
      .query("clients")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const acme = clients.find((c) => c.name.toLowerCase() === "acme");
    if (!acme) {
      throw new Error(`Falta cliente "ACME" en la org ${orgId}. Ejecuta seedClients primero.`);
    }

    // Idempotency: wipe existing
    const existingCompanies = await ctx.db
      .query("issuingCompanies")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    for (const c of existingCompanies) {
      await ctx.db.delete(c._id);
    }
    const existingMaps = await ctx.db
      .query("servicesIssuingCompanyMap")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    for (const m of existingMaps) {
      await ctx.db.delete(m._id);
    }
    const existingOverrides = await ctx.db
      .query("clientIssuingCompanyOverride")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    for (const o of existingOverrides) {
      await ctx.db.delete(o._id);
    }

    const now = Date.now();

    // Company A — DESC Holding (default)
    const companyAId = await ctx.db.insert("issuingCompanies", {
      orgId,
      name: "DESC Holding",
      legalName: "DESC Holding S.A. de C.V.",
      rfc: "DHO200101ABC",
      regimenFiscalCode: "601",
      regimenFiscalLabel: "General de Ley Personas Morales",
      codigoPostal: "11550",
      address: {
        street: "Av. Reforma",
        exteriorNumber: "100",
        colonia: "Juárez",
        city: "Ciudad de México",
        state: "CDMX",
        country: "México",
      },
      email: "facturacion@desc-holding.mx",
      invoiceSerie: "DESC-A",
      signatoryName: "Christian Cover",
      signatoryTitle: "Director General",
      isDefault: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // Company B — DESC Contable
    const companyBId = await ctx.db.insert("issuingCompanies", {
      orgId,
      name: "DESC Contable",
      legalName: "DESC Contable y Asociados S.C.",
      rfc: "DCA210315XYZ",
      regimenFiscalCode: "603",
      regimenFiscalLabel: "Personas Morales con Fines No Lucrativos",
      codigoPostal: "11000",
      address: {
        street: "Palmas",
        exteriorNumber: "50",
        colonia: "Lomas",
        city: "Ciudad de México",
        state: "CDMX",
        country: "México",
      },
      email: "facturacion@desc-contable.mx",
      invoiceSerie: "DCA-B",
      signatoryName: "Christian Cover",
      signatoryTitle: "Socio Director",
      isDefault: false,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // Service map: Contable + Legal → B
    await ctx.db.insert("servicesIssuingCompanyMap", {
      orgId,
      serviceId: contableService._id,
      issuingCompanyId: companyBId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("servicesIssuingCompanyMap", {
      orgId,
      serviceId: legalService._id,
      issuingCompanyId: companyBId,
      createdAt: now,
      updatedAt: now,
    });

    // Override: ACME + Contable → A
    await ctx.db.insert("clientIssuingCompanyOverride", {
      orgId,
      clientId: acme._id,
      serviceId: contableService._id,
      issuingCompanyId: companyAId,
      reason: "ACME pidió que Contable lo facture DESC Holding (cuenta de prueba)",
      createdAt: now,
      updatedAt: now,
    });

    return {
      companies: { A: companyAId, B: companyBId },
      serviceMap: [
        { service: "Contable", company: companyBId },
        { service: "Legal", company: companyBId },
      ],
      overrides: [{ client: "ACME", service: "Contable", company: companyAId }],
    };
  },
});
```

- [ ] **Step 3: Commit**

```bash
git add convex/functions/seed/v2Fixtures.ts
git commit -m "feat(seed): add v2Fixtures for issuing companies + maps + override"
```

---

## Phase 6: UI components (bottom-up)

> **Task ordering note:** Tasks 13-20 create components with some import dependencies. Order below is arranged so that each task's component only imports from already-created tasks (leaves first). If an engineer reorders, the build between commits will fail.

### Task 13: IssuingCompanyForm (needs LogoUploader created first — see Task 14)

**NOTE on order:** This task ships `IssuingCompanyForm.tsx` which imports `LogoUploader`. Do **Task 14 before committing Task 13** (or do them together in a single commit) so the build doesn't break on the intermediate commit. Alternatively, temporarily stub the `LogoUploader` import.

**Files:**
- Create: `src/components/configuracion/empresas-emitentes/IssuingCompanyForm.tsx`

- [ ] **Step 1: Write the form component**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { SAT_REGIMENES } from "../../../../convex/functions/issuingCompanies/helpers";
import { LogoUploader } from "./LogoUploader";

type IssuingCompanyData = {
  _id?: Id<"issuingCompanies">;
  name: string;
  legalName: string;
  rfc: string;
  regimenFiscalCode: string;
  codigoPostal: string;
  address: {
    street: string;
    exteriorNumber?: string;
    interiorNumber?: string;
    colonia?: string;
    city: string;
    state: string;
    country: string;
  };
  email: string;
  phone?: string;
  website?: string;
  bankName?: string;
  bankAccount?: string;
  clabe?: string;
  currency?: string;
  invoiceSerie?: string;
  signatoryName?: string;
  signatoryTitle?: string;
  logoStorageId?: Id<"_storage">;
};

const EMPTY: IssuingCompanyData = {
  name: "",
  legalName: "",
  rfc: "",
  regimenFiscalCode: "",
  codigoPostal: "",
  address: { street: "", city: "", state: "", country: "México" },
  email: "",
};

export function IssuingCompanyForm({
  initialData,
  mode = "create",
}: {
  initialData?: IssuingCompanyData;
  mode?: "create" | "edit";
}) {
  const router = useRouter();
  const createCompany = useMutation(api.functions.issuingCompanies.mutations.create);
  const updateCompany = useMutation(api.functions.issuingCompanies.mutations.update);

  const [form, setForm] = useState<IssuingCompanyData>(initialData ?? EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Nombre requerido";
    if (!form.legalName.trim()) e.legalName = "Razón social requerida";
    if (!form.rfc.trim()) e.rfc = "RFC requerido";
    else if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i.test(form.rfc)) e.rfc = "Formato de RFC inválido";
    if (!form.regimenFiscalCode) e.regimenFiscalCode = "Régimen requerido";
    if (!/^\d{5}$/.test(form.codigoPostal)) e.codigoPostal = "Código postal de 5 dígitos";
    if (!form.address.street.trim()) e.street = "Calle requerida";
    if (!form.address.city.trim()) e.city = "Ciudad requerida";
    if (!form.address.state.trim()) e.state = "Estado requerido";
    if (!form.address.country.trim()) e.country = "País requerido";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = "Email inválido";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      const payload = {
        name: form.name,
        legalName: form.legalName,
        rfc: form.rfc,
        regimenFiscalCode: form.regimenFiscalCode,
        codigoPostal: form.codigoPostal,
        address: form.address,
        email: form.email,
        phone: form.phone || undefined,
        website: form.website || undefined,
        bankName: form.bankName || undefined,
        bankAccount: form.bankAccount || undefined,
        clabe: form.clabe || undefined,
        currency: form.currency || undefined,
        invoiceSerie: form.invoiceSerie || undefined,
        signatoryName: form.signatoryName || undefined,
        signatoryTitle: form.signatoryTitle || undefined,
      };
      let id: Id<"issuingCompanies">;
      if (mode === "edit" && initialData?._id) {
        await updateCompany({ id: initialData._id, ...payload });
        id = initialData._id;
      } else {
        id = await createCompany(payload);
      }
      router.push(`/configuracion/empresas-emitentes/${id}`);
    } catch (err) {
      setErrors({ submit: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }

  const input =
    "w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";
  const errStyle = "text-xs text-destructive";
  const sectionTitle = "text-sm font-semibold text-muted-foreground uppercase tracking-wide pb-2 border-b border-border";

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl space-y-8">
      {errors.submit && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
          {errors.submit}
        </div>
      )}

      {/* Datos fiscales */}
      <section className="space-y-4">
        <h3 className={sectionTitle}>Datos fiscales</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Nombre comercial *</label>
            <input type="text" className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            {errors.name && <p className={errStyle}>{errors.name}</p>}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Razón social *</label>
            <input type="text" className={input} value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} />
            {errors.legalName && <p className={errStyle}>{errors.legalName}</p>}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">RFC *</label>
            <input type="text" className={`${input} uppercase`} maxLength={13} value={form.rfc} onChange={(e) => setForm({ ...form, rfc: e.target.value.toUpperCase() })} />
            {errors.rfc && <p className={errStyle}>{errors.rfc}</p>}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Régimen fiscal *</label>
            <select className={`${input} cursor-pointer`} value={form.regimenFiscalCode} onChange={(e) => setForm({ ...form, regimenFiscalCode: e.target.value })}>
              <option value="">Selecciona régimen</option>
              {SAT_REGIMENES.map((r) => (
                <option key={r.code} value={r.code}>{r.code} — {r.label}</option>
              ))}
            </select>
            {errors.regimenFiscalCode && <p className={errStyle}>{errors.regimenFiscalCode}</p>}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Código postal *</label>
            <input type="text" className={input} maxLength={5} value={form.codigoPostal} onChange={(e) => setForm({ ...form, codigoPostal: e.target.value })} />
            {errors.codigoPostal && <p className={errStyle}>{errors.codigoPostal}</p>}
          </div>
        </div>
      </section>

      {/* Dirección */}
      <section className="space-y-4">
        <h3 className={sectionTitle}>Dirección fiscal</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium">Calle *</label>
            <input type="text" className={input} value={form.address.street} onChange={(e) => setForm({ ...form, address: { ...form.address, street: e.target.value } })} />
            {errors.street && <p className={errStyle}>{errors.street}</p>}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Núm. exterior</label>
            <input type="text" className={input} value={form.address.exteriorNumber ?? ""} onChange={(e) => setForm({ ...form, address: { ...form.address, exteriorNumber: e.target.value } })} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Núm. interior</label>
            <input type="text" className={input} value={form.address.interiorNumber ?? ""} onChange={(e) => setForm({ ...form, address: { ...form.address, interiorNumber: e.target.value } })} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Colonia</label>
            <input type="text" className={input} value={form.address.colonia ?? ""} onChange={(e) => setForm({ ...form, address: { ...form.address, colonia: e.target.value } })} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Ciudad *</label>
            <input type="text" className={input} value={form.address.city} onChange={(e) => setForm({ ...form, address: { ...form.address, city: e.target.value } })} />
            {errors.city && <p className={errStyle}>{errors.city}</p>}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Estado *</label>
            <input type="text" className={input} value={form.address.state} onChange={(e) => setForm({ ...form, address: { ...form.address, state: e.target.value } })} />
            {errors.state && <p className={errStyle}>{errors.state}</p>}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">País *</label>
            <input type="text" className={input} value={form.address.country} onChange={(e) => setForm({ ...form, address: { ...form.address, country: e.target.value } })} />
            {errors.country && <p className={errStyle}>{errors.country}</p>}
          </div>
        </div>
      </section>

      {/* Contacto */}
      <section className="space-y-4">
        <h3 className={sectionTitle}>Contacto</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Email *</label>
            <input type="email" className={input} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            {errors.email && <p className={errStyle}>{errors.email}</p>}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Teléfono</label>
            <input type="text" className={input} value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium">Sitio web</label>
            <input type="url" className={input} value={form.website ?? ""} onChange={(e) => setForm({ ...form, website: e.target.value })} />
          </div>
        </div>
      </section>

      {/* Bancarios */}
      <section className="space-y-4">
        <h3 className={sectionTitle}>Datos bancarios</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Banco</label>
            <input type="text" className={input} value={form.bankName ?? ""} onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Cuenta</label>
            <input type="text" className={input} value={form.bankAccount ?? ""} onChange={(e) => setForm({ ...form, bankAccount: e.target.value })} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">CLABE</label>
            <input type="text" className={input} maxLength={18} value={form.clabe ?? ""} onChange={(e) => setForm({ ...form, clabe: e.target.value })} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Moneda</label>
            <input type="text" className={input} placeholder="MXN" value={form.currency ?? ""} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
          </div>
        </div>
      </section>

      {/* Emisión y firma */}
      <section className="space-y-4">
        <h3 className={sectionTitle}>Emisión y firma</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Serie de factura</label>
            <input type="text" className={input} value={form.invoiceSerie ?? ""} onChange={(e) => setForm({ ...form, invoiceSerie: e.target.value })} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Nombre del firmante</label>
            <input type="text" className={input} value={form.signatoryName ?? ""} onChange={(e) => setForm({ ...form, signatoryName: e.target.value })} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Cargo del firmante</label>
            <input type="text" className={input} value={form.signatoryTitle ?? ""} onChange={(e) => setForm({ ...form, signatoryTitle: e.target.value })} />
          </div>
        </div>
      </section>

      {/* Logo — only on edit (needs an id) */}
      {mode === "edit" && initialData?._id && (
        <section className="space-y-4">
          <h3 className={sectionTitle}>Logo</h3>
          <LogoUploader companyId={initialData._id} currentStorageId={initialData.logoStorageId} />
        </section>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-4">
        <button type="submit" disabled={loading} className="rounded-md bg-accent px-6 py-2 text-sm font-medium text-primary hover:bg-accent/90 transition-colors disabled:opacity-50 cursor-pointer">
          {loading ? "Guardando..." : mode === "edit" ? "Guardar cambios" : "Crear empresa"}
        </button>
        <button type="button" onClick={() => router.back()} className="rounded-md border border-border px-6 py-2 text-sm text-muted-foreground hover:bg-secondary transition-colors cursor-pointer">
          Cancelar
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/configuracion/empresas-emitentes/IssuingCompanyForm.tsx
git commit -m "feat(ui): add IssuingCompanyForm component"
```

---

### Task 14: LogoUploader component

**Files:**
- Create: `src/components/configuracion/empresas-emitentes/LogoUploader.tsx`

- [ ] **Step 1: Write component**

```tsx
"use client";

import { useState, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Upload, X, Image as ImageIcon } from "lucide-react";

const MAX_SIZE_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml"];

export function LogoUploader({
  companyId,
  currentStorageId,
}: {
  companyId: Id<"issuingCompanies">;
  currentStorageId?: Id<"_storage">;
}) {
  const generateUploadUrl = useMutation(api.functions.issuingCompanies.mutations.generateUploadUrl);
  const setLogoFromStorage = useMutation(api.functions.issuingCompanies.mutations.setLogoFromStorage);
  const removeLogo = useMutation(api.functions.issuingCompanies.mutations.removeLogo);
  const currentUrl = useQuery(
    api.functions.storage.getUrl,
    currentStorageId ? { storageId: currentStorageId } : "skip"
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    if (file.size > MAX_SIZE_BYTES) {
      setError("El archivo excede 2 MB");
      return;
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError("Solo PNG, JPEG o SVG");
      return;
    }
    setUploading(true);
    try {
      const uploadUrl = await generateUploadUrl({ id: companyId });
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error("Error subiendo el archivo");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await setLogoFromStorage({ id: companyId, storageId });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRemove() {
    setError(null);
    try {
      await removeLogo({ id: companyId });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-3">
      {currentUrl ? (
        <div className="flex items-start gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={currentUrl} alt="Logo" className="h-24 w-24 rounded-md border border-border bg-secondary object-contain p-2" />
          <div className="flex gap-2">
            <button type="button" onClick={() => inputRef.current?.click()} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary transition-colors cursor-pointer">
              Reemplazar
            </button>
            <button type="button" onClick={handleRemove} className="rounded-md border border-destructive/20 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 transition-colors cursor-pointer">
              <X size={14} className="inline mr-1" /> Quitar
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex w-full items-center justify-center gap-2 rounded-md border-2 border-dashed border-border bg-secondary/50 py-8 text-sm text-muted-foreground hover:border-accent hover:text-foreground transition-colors cursor-pointer disabled:opacity-50"
        >
          {uploading ? (
            <span>Subiendo...</span>
          ) : (
            <>
              <Upload size={18} />
              <span>Click para subir logo (PNG, JPEG, SVG, máx 2MB)</span>
            </>
          )}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Verify `api.functions.storage.getUrl` exists**

Run: `ls convex/functions/storage/`

If the file exists, check if there's a `getUrl` query. If not, skip to Step 3; otherwise Step 4.

- [ ] **Step 3 (if needed): Add `getUrl` query to storage module**

If `convex/functions/storage/queries.ts` (or similar) doesn't expose `getUrl`, add it. Check existing structure first:

```ts
// convex/functions/storage/queries.ts (append or create)
import { query } from "../../_generated/server";
import { v } from "convex/values";

export const getUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.storageId);
  },
});
```

Note: `ctx.storage.getUrl` works in queries.

- [ ] **Step 4: Commit**

```bash
git add src/components/configuracion/empresas-emitentes/LogoUploader.tsx convex/functions/storage/
git commit -m "feat(ui): add LogoUploader component"
```

---

### Task 15: IssuingCompanyList component

**NOTE on order:** `IssuingCompanyList.tsx` imports `SetDefaultDialog` (Task 16). Do **Task 16 before committing Task 15** (or combine their commits). Same rationale as the Task 13↔14 ordering note.

**Files:**
- Create: `src/components/configuracion/empresas-emitentes/IssuingCompanyList.tsx`

- [ ] **Step 1: Write component**

```tsx
"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { Building2, Plus, Search, Star, CircleSlash, Check } from "lucide-react";
import { useState } from "react";
import { SetDefaultDialog } from "./SetDefaultDialog";
import { Id } from "../../../../convex/_generated/dataModel";

type Company = NonNullable<ReturnType<typeof useQuery<typeof api.functions.issuingCompanies.queries.list>>>[number];

export function IssuingCompanyList() {
  const { user } = useUser();
  const isAdmin = user?.organizationMemberships?.[0]?.role === "org:admin";

  const [search, setSearch] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [pendingDefault, setPendingDefault] = useState<Company | null>(null);

  const companies = useQuery(api.functions.issuingCompanies.queries.list, { includeInactive });
  const currentDefault = companies?.find((c) => c.isDefault);

  const filtered = companies?.filter((c) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return c.name.toLowerCase().includes(term) || c.rfc.toLowerCase().includes(term);
  });

  if (companies === undefined) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg border border-border bg-card" />
        ))}
      </div>
    );
  }

  if (companies.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-12 text-center">
        <Building2 className="mx-auto mb-4 text-muted-foreground" size={48} />
        <p className="text-lg font-medium">No hay empresas emitentes configuradas</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {isAdmin
            ? "Crea la primera empresa para emitir cotizaciones y contratos."
            : "Pide a un administrador que configure la primera empresa."}
        </p>
        {isAdmin && (
          <Link href="/configuracion/empresas-emitentes/nueva" className="mt-4 inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-primary hover:bg-accent/90 transition-colors cursor-pointer">
            <Plus size={16} /> Crear primera empresa
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search + filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o RFC..."
            className="w-full rounded-md border border-border bg-secondary py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <button
          onClick={() => setIncludeInactive(!includeInactive)}
          className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors cursor-pointer ${
            includeInactive
              ? "border-warning bg-warning/10 text-warning"
              : "border-border text-muted-foreground hover:bg-secondary"
          }`}
        >
          <CircleSlash size={14} /> Inactivas
        </button>
        {isAdmin && (
          <Link href="/configuracion/empresas-emitentes/nueva" className="flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-primary hover:bg-accent/90 transition-colors cursor-pointer">
            <Plus size={16} /> Nueva
          </Link>
        )}
      </div>

      {/* List */}
      <div className="space-y-2">
        {filtered?.map((c) => (
          <div key={c._id} className="group relative rounded-lg border border-border bg-card p-4 transition-colors hover:border-accent/30">
            <Link href={`/configuracion/empresas-emitentes/${c._id}`} className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10">
                  <Building2 className="text-accent" size={20} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{c.name}</p>
                    {c.isDefault && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent">
                        <Star size={10} /> Default
                      </span>
                    )}
                    {!c.isActive && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Inactiva</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    RFC: {c.rfc} &middot; {c.regimenFiscalLabel ?? c.regimenFiscalCode} &middot; {c.serviceCount} servicio(s)
                  </p>
                </div>
              </div>
            </Link>
            {isAdmin && !c.isDefault && c.isActive && (
              <button
                onClick={() => setPendingDefault(c)}
                className="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:bg-secondary transition-all cursor-pointer"
              >
                <Check size={12} className="inline mr-1" /> Marcar default
              </button>
            )}
          </div>
        ))}
      </div>

      {pendingDefault && currentDefault && (
        <SetDefaultDialog
          companyId={pendingDefault._id as Id<"issuingCompanies">}
          newName={pendingDefault.name}
          currentName={currentDefault.name}
          onClose={() => setPendingDefault(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/configuracion/empresas-emitentes/IssuingCompanyList.tsx
git commit -m "feat(ui): add IssuingCompanyList with search + inactive filter"
```

---

### Task 16: SetDefaultDialog

**Files:**
- Create: `src/components/configuracion/empresas-emitentes/SetDefaultDialog.tsx`

- [ ] **Step 1: Write component**

```tsx
"use client";

import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useState } from "react";

export function SetDefaultDialog({
  companyId,
  newName,
  currentName,
  onClose,
}: {
  companyId: Id<"issuingCompanies">;
  newName: string;
  currentName: string;
  onClose: () => void;
}) {
  const setDefault = useMutation(api.functions.issuingCompanies.mutations.setDefault);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setLoading(true);
    setError(null);
    try {
      await setDefault({ id: companyId });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg">
        <h3 className="text-lg font-semibold">Cambiar empresa default</h3>
        <p className="mt-3 text-sm text-muted-foreground">
          Esto reemplaza <strong className="text-foreground">{currentName}</strong> como empresa default por{" "}
          <strong className="text-foreground">{newName}</strong>. Las nuevas cotizaciones sin asignación explícita se emitirán desde{" "}
          <strong className="text-foreground">{newName}</strong> en adelante.
        </p>
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-secondary transition-colors cursor-pointer">
            Cancelar
          </button>
          <button onClick={confirm} disabled={loading} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-primary hover:bg-accent/90 transition-colors disabled:opacity-50 cursor-pointer">
            {loading ? "Aplicando..." : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/configuracion/empresas-emitentes/SetDefaultDialog.tsx
git commit -m "feat(ui): add SetDefaultDialog modal"
```

---

### Task 17: DeleteConfirmDialog

**Files:**
- Create: `src/components/configuracion/empresas-emitentes/DeleteConfirmDialog.tsx`

- [ ] **Step 1: Write component**

```tsx
"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";

export function DeleteConfirmDialog({
  companyId,
  companyName,
  onClose,
}: {
  companyId: Id<"issuingCompanies">;
  companyName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const refs = useQuery(api.functions.issuingCompanies.queries.countReferences, { id: companyId });
  const remove = useMutation(api.functions.issuingCompanies.mutations.remove);
  const [typed, setTyped] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (typed !== companyName) return;
    setLoading(true);
    setError(null);
    try {
      await remove({ id: companyId });
      onClose();
      router.push("/configuracion/empresas-emitentes");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const hasRefs = refs !== undefined && refs.total > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-lg">
        <div className="flex items-center gap-3">
          <AlertTriangle className="text-destructive" size={24} />
          <h3 className="text-lg font-semibold">Borrar permanentemente</h3>
        </div>

        {refs === undefined ? (
          <p className="mt-4 text-sm text-muted-foreground">Verificando referencias...</p>
        ) : hasRefs ? (
          <div className="mt-4 space-y-3 text-sm">
            <p className="text-destructive">Esta empresa no puede borrarse porque tiene referencias:</p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {refs.emailLog > 0 && <li>{refs.emailLog} email(s) enviado(s)</li>}
              {refs.serviceMap > 0 && <li>{refs.serviceMap} asignación(es) de servicio</li>}
              {refs.clientOverride > 0 && <li>{refs.clientOverride} override(s) por cliente</li>}
            </ul>
            <p className="text-muted-foreground">Desactívala en lugar de borrarla.</p>
          </div>
        ) : (
          <div className="mt-4 space-y-3 text-sm">
            <p className="text-muted-foreground">
              Esta acción es irreversible. Para confirmar, escribe el nombre de la empresa:
            </p>
            <p className="font-mono text-foreground">{companyName}</p>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:border-destructive focus:outline-none focus:ring-1 focus:ring-destructive"
              placeholder="Escribe el nombre exacto"
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-secondary transition-colors cursor-pointer">
            Cancelar
          </button>
          {!hasRefs && (
            <button
              onClick={confirm}
              disabled={loading || typed !== companyName || refs === undefined}
              className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {loading ? "Borrando..." : "Borrar"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/configuracion/empresas-emitentes/DeleteConfirmDialog.tsx
git commit -m "feat(ui): add DeleteConfirmDialog with references check"
```

---

### Task 18: ServicesAssignmentEditor

**Files:**
- Create: `src/components/configuracion/empresas-emitentes/ServicesAssignmentEditor.tsx`

- [ ] **Step 1: Write component**

```tsx
"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";

export function ServicesAssignmentEditor({
  companyId,
}: {
  companyId: Id<"issuingCompanies">;
}) {
  const { user } = useUser();
  const isAdmin = user?.organizationMemberships?.[0]?.role === "org:admin";

  const available = useQuery(api.functions.issuingCompanies.queries.listAvailableServices, { issuingCompanyId: companyId });
  const assign = useMutation(api.functions.issuingCompanies.mutations.assignServicesToCompany);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (available) {
      const initial = new Set(
        available.filter((s) => s.assignedTo?.issuingCompanyId === companyId).map((s) => s.serviceId)
      );
      setSelected(initial);
      setDirty(false);
    }
  }, [available, companyId]);

  function toggle(serviceId: string) {
    if (!isAdmin) return;
    setDirty(true);
    setSaved(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(serviceId)) next.delete(serviceId);
      else next.add(serviceId);
      return next;
    });
  }

  async function save() {
    setLoading(true);
    setError(null);
    try {
      await assign({
        issuingCompanyId: companyId,
        serviceIds: Array.from(selected) as Id<"services">[],
      });
      setDirty(false);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (available === undefined) {
    return <div className="h-40 animate-pulse rounded-md bg-card" />;
  }

  if (available.length === 0) {
    return <p className="text-sm text-muted-foreground">No hay servicios en esta organización.</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Marca los servicios que esta empresa emite. Los servicios ya asignados a otra empresa se moverán aquí si los marcas.
        {!isAdmin && " (Solo lectura — requiere rol Admin para modificar.)"}
      </p>

      <div className="space-y-2">
        {available.map((s) => {
          const isChecked = selected.has(s.serviceId);
          const assignedElsewhere = s.assignedTo && s.assignedTo.issuingCompanyId !== companyId;
          return (
            <label
              key={s.serviceId}
              className={`flex items-start gap-3 rounded-md border border-border bg-card p-3 transition-colors ${
                isAdmin ? "cursor-pointer hover:border-accent/30" : "cursor-default"
              }`}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => toggle(s.serviceId)}
                disabled={!isAdmin}
                className="mt-0.5 accent-accent"
              />
              <div className="flex-1">
                <p className="text-sm font-medium">{s.serviceName}</p>
                {assignedElsewhere && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Actualmente asignado a <strong className="text-foreground">{s.assignedTo?.name}</strong>
                    {isChecked ? " — se moverá a esta empresa al guardar" : ""}
                  </p>
                )}
              </div>
            </label>
          );
        })}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && <p className="text-sm text-accent">Asignaciones guardadas.</p>}

      {isAdmin && (
        <button
          onClick={save}
          disabled={!dirty || loading}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-primary hover:bg-accent/90 transition-colors disabled:opacity-50 cursor-pointer"
        >
          {loading ? "Guardando..." : "Guardar asignaciones"}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/configuracion/empresas-emitentes/ServicesAssignmentEditor.tsx
git commit -m "feat(ui): add ServicesAssignmentEditor tab"
```

---

### Task 19: DangerZone

**Files:**
- Create: `src/components/configuracion/empresas-emitentes/DangerZone.tsx`

- [ ] **Step 1: Write component**

```tsx
"use client";

import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";

export function DangerZone({
  companyId,
  companyName,
  isActive,
  isDefault,
}: {
  companyId: Id<"issuingCompanies">;
  companyName: string;
  isActive: boolean;
  isDefault: boolean;
}) {
  const updateCompany = useMutation(api.functions.issuingCompanies.mutations.update);
  const [loading, setLoading] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleActive() {
    setLoading(true);
    setError(null);
    try {
      await updateCompany({ id: companyId, isActive: !isActive });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-warning/40 bg-warning/5 p-4">
        <h4 className="text-sm font-semibold text-warning">{isActive ? "Desactivar empresa" : "Reactivar empresa"}</h4>
        <p className="mt-2 text-sm text-muted-foreground">
          {isActive
            ? "La empresa dejará de aparecer en resoluciones nuevas de cotizaciones/contratos, pero sus registros históricos se preservan."
            : "La empresa volverá a estar disponible para emitir documentos."}
        </p>
        {isDefault && isActive && (
          <p className="mt-2 text-xs text-destructive">
            No puedes desactivar la empresa default. Marca otra como default primero.
          </p>
        )}
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        <button
          onClick={toggleActive}
          disabled={loading || (isDefault && isActive)}
          className="mt-3 rounded-md border border-warning px-3 py-1.5 text-sm text-warning hover:bg-warning/10 transition-colors disabled:opacity-50 cursor-pointer"
        >
          {loading ? "Aplicando..." : isActive ? "Desactivar" : "Reactivar"}
        </button>
      </div>

      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <h4 className="text-sm font-semibold text-destructive">Borrar permanentemente</h4>
        <p className="mt-2 text-sm text-muted-foreground">
          Borra la empresa de la base de datos. Solo permitido si no tiene referencias (emails, asignaciones, overrides).
        </p>
        {isDefault && (
          <p className="mt-2 text-xs text-destructive">No puedes borrar la empresa default.</p>
        )}
        <button
          onClick={() => setShowDelete(true)}
          disabled={isDefault}
          className="mt-3 flex items-center gap-2 rounded-md border border-destructive px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50 cursor-pointer"
        >
          <Trash2 size={14} /> Borrar permanentemente
        </button>
      </div>

      {showDelete && (
        <DeleteConfirmDialog companyId={companyId} companyName={companyName} onClose={() => setShowDelete(false)} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/configuracion/empresas-emitentes/DangerZone.tsx
git commit -m "feat(ui): add DangerZone tab with deactivate + delete"
```

---

### Task 20: IssuingCompanyDetailTabs

**Files:**
- Create: `src/components/configuracion/empresas-emitentes/IssuingCompanyDetailTabs.tsx`

- [ ] **Step 1: Write component**

```tsx
"use client";

import { useState } from "react";
import { Id, Doc } from "../../../../convex/_generated/dataModel";
import { IssuingCompanyForm } from "./IssuingCompanyForm";
import { ServicesAssignmentEditor } from "./ServicesAssignmentEditor";
import { DangerZone } from "./DangerZone";
import { useUser } from "@clerk/nextjs";

type Tab = "info" | "services" | "danger";

export function IssuingCompanyDetailTabs({ company }: { company: Doc<"issuingCompanies"> }) {
  const { user } = useUser();
  const isAdmin = user?.organizationMemberships?.[0]?.role === "org:admin";
  const [tab, setTab] = useState<Tab>("info");

  const tabs: Array<{ id: Tab; label: string; adminOnly?: boolean }> = [
    { id: "info", label: "Información" },
    { id: "services", label: "Servicios que emite" },
    { id: "danger", label: "Zona de peligro", adminOnly: true },
  ];

  const visibleTabs = tabs.filter((t) => !t.adminOnly || isAdmin);

  return (
    <div className="space-y-6">
      <div className="flex gap-1 border-b border-border">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors cursor-pointer ${
              tab === t.id
                ? "border-b-2 border-accent text-accent"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "info" && (
        <IssuingCompanyForm
          mode="edit"
          initialData={{
            _id: company._id as Id<"issuingCompanies">,
            name: company.name,
            legalName: company.legalName,
            rfc: company.rfc,
            regimenFiscalCode: company.regimenFiscalCode,
            codigoPostal: company.codigoPostal,
            address: company.address,
            email: company.email,
            phone: company.phone,
            website: company.website,
            bankName: company.bankName,
            bankAccount: company.bankAccount,
            clabe: company.clabe,
            currency: company.currency,
            invoiceSerie: company.invoiceSerie,
            signatoryName: company.signatoryName,
            signatoryTitle: company.signatoryTitle,
            logoStorageId: company.logoStorageId,
          }}
        />
      )}
      {tab === "services" && <ServicesAssignmentEditor companyId={company._id as Id<"issuingCompanies">} />}
      {tab === "danger" && isAdmin && (
        <DangerZone
          companyId={company._id as Id<"issuingCompanies">}
          companyName={company.name}
          isActive={company.isActive}
          isDefault={company.isDefault}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/configuracion/empresas-emitentes/IssuingCompanyDetailTabs.tsx
git commit -m "feat(ui): add IssuingCompanyDetailTabs composing info/services/danger tabs"
```

---

## Phase 7: UI pages

### Task 21: Hub page `/configuracion`

**Files:**
- Modify: `src/app/(dashboard)/configuracion/page.tsx`

- [ ] **Step 1: Check current content**

Run: `cat src/app/\(dashboard\)/configuracion/page.tsx`

- [ ] **Step 2: Replace with hub content**

```tsx
"use client";

import Link from "next/link";
import { Settings, Building2, ChevronRight } from "lucide-react";

const sections = [
  {
    href: "/configuracion/empresas-emitentes",
    icon: Building2,
    title: "Empresas Emitentes",
    description: "Personas morales que emiten cotizaciones, contratos y facturas.",
  },
];

export default function ConfiguracionPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="text-accent" size={28} />
        <h1 className="text-2xl font-bold">Configuración</h1>
      </div>

      <div className="space-y-2">
        {sections.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="flex items-center justify-between rounded-lg border border-border bg-card p-4 transition-colors hover:border-accent/30 cursor-pointer"
          >
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10">
                <s.icon className="text-accent" size={20} />
              </div>
              <div>
                <p className="font-medium">{s.title}</p>
                <p className="text-xs text-muted-foreground">{s.description}</p>
              </div>
            </div>
            <ChevronRight className="text-muted-foreground" size={18} />
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/configuracion/page.tsx
git commit -m "feat(ui): convert /configuracion into hub page"
```

---

### Task 22: List page `/configuracion/empresas-emitentes`

**Files:**
- Create: `src/app/(dashboard)/configuracion/empresas-emitentes/page.tsx`

- [ ] **Step 1: Write page**

```tsx
"use client";

import Link from "next/link";
import { Building2, ChevronLeft } from "lucide-react";
import { IssuingCompanyList } from "@/components/configuracion/empresas-emitentes/IssuingCompanyList";

export default function EmpresasEmitentesPage() {
  return (
    <div className="space-y-6">
      <Link href="/configuracion" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
        <ChevronLeft size={16} /> Configuración
      </Link>

      <div className="flex items-center gap-3">
        <Building2 className="text-accent" size={28} />
        <h1 className="text-2xl font-bold">Empresas Emitentes</h1>
      </div>

      <IssuingCompanyList />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add 'src/app/(dashboard)/configuracion/empresas-emitentes/page.tsx'
git commit -m "feat(ui): add empresas-emitentes list page"
```

---

### Task 23: Create page `/configuracion/empresas-emitentes/nueva`

**Files:**
- Create: `src/app/(dashboard)/configuracion/empresas-emitentes/nueva/page.tsx`

- [ ] **Step 1: Write page**

```tsx
"use client";

import Link from "next/link";
import { Building2, ChevronLeft } from "lucide-react";
import { IssuingCompanyForm } from "@/components/configuracion/empresas-emitentes/IssuingCompanyForm";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function NuevaEmpresaPage() {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const isAdmin = user?.organizationMemberships?.[0]?.role === "org:admin";

  useEffect(() => {
    if (isLoaded && !isAdmin) {
      router.replace("/configuracion/empresas-emitentes");
    }
  }, [isLoaded, isAdmin, router]);

  if (!isLoaded || !isAdmin) return null;

  return (
    <div className="space-y-6">
      <Link href="/configuracion/empresas-emitentes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
        <ChevronLeft size={16} /> Empresas Emitentes
      </Link>

      <div className="flex items-center gap-3">
        <Building2 className="text-accent" size={28} />
        <h1 className="text-2xl font-bold">Nueva empresa emitente</h1>
      </div>

      <IssuingCompanyForm mode="create" />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add 'src/app/(dashboard)/configuracion/empresas-emitentes/nueva/page.tsx'
git commit -m "feat(ui): add nueva empresa emitente page"
```

---

### Task 24: Detail page `/configuracion/empresas-emitentes/[id]`

**Files:**
- Create: `src/app/(dashboard)/configuracion/empresas-emitentes/[id]/page.tsx`

- [ ] **Step 1: Write page**

```tsx
"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import { Id } from "../../../../../../convex/_generated/dataModel";
import { Building2, ChevronLeft, Star } from "lucide-react";
import { IssuingCompanyDetailTabs } from "@/components/configuracion/empresas-emitentes/IssuingCompanyDetailTabs";

export default function DetalleEmpresaPage() {
  const { id } = useParams<{ id: string }>();
  const company = useQuery(api.functions.issuingCompanies.queries.getById, {
    id: id as Id<"issuingCompanies">,
  });

  if (company === undefined) {
    return <div className="h-40 animate-pulse rounded-lg bg-card" />;
  }
  if (company === null) {
    return (
      <div className="rounded-lg border border-border bg-card p-12 text-center">
        <p className="text-lg font-medium">Empresa no encontrada</p>
        <Link href="/configuracion/empresas-emitentes" className="mt-3 inline-block text-sm text-accent hover:underline cursor-pointer">
          Volver al listado
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/configuracion/empresas-emitentes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
        <ChevronLeft size={16} /> Empresas Emitentes
      </Link>

      <div className="flex items-center gap-3">
        <Building2 className="text-accent" size={28} />
        <h1 className="text-2xl font-bold">{company.name}</h1>
        {company.isDefault && (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-1 text-xs text-accent">
            <Star size={12} /> Default
          </span>
        )}
        {!company.isActive && (
          <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">Inactiva</span>
        )}
      </div>

      <IssuingCompanyDetailTabs company={company} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add 'src/app/(dashboard)/configuracion/empresas-emitentes/[id]/page.tsx'
git commit -m "feat(ui): add empresa emitente detail page with tabs"
```

---

## Phase 8: Smoke test & dogfood

### Task 25: Manual smoke test

**Files:** None (manual QA)

- [ ] **Step 1: Build passes**

Run: `npm run build`
Expected: no type errors, no lint errors in the new files.

- [ ] **Step 2: Convex deploy passes**

Run: `npx convex dev` (if not already running)
Expected: no schema diff errors, new functions appear in the Convex dashboard.

- [ ] **Step 3: Seed data against your dev org**

Get your `orgId` from Clerk dashboard or browser devtools.
Run: `npx convex run seed:v2Fixtures '{"orgId":"<your-org-id>"}'`
Expected: returns `{ companies: {...}, serviceMap: [...], overrides: [...] }`.

If it fails on prereqs, seed services + clients first.

- [ ] **Step 4: Run the app and exercise flows**

Run: `npm run dev`

Manual checklist:
- [ ] Navigate to `/configuracion` — see hub with "Empresas Emitentes" card
- [ ] Click into list — see 2 empresas from seed (DESC Holding + DESC Contable)
- [ ] DESC Holding shows "Default" badge
- [ ] Click into detail — form shows all fields pre-filled
- [ ] Switch to "Servicios que emite" tab — DESC Contable shows Contable + Legal checked
- [ ] Switch to "Zona de peligro" (admin only) — deactivate button shows; delete button shows references (2 service maps, 1 override → blocked)
- [ ] Go back to list, click "Marcar default" on DESC Contable — confirm modal → DESC Contable becomes default
- [ ] Click "Nueva" → create a test empresa → redirects to detail page
- [ ] Delete that test empresa (no references) → confirm dialog → redirected to list

- [ ] **Step 5: Commit any fixes found during smoke test**

```bash
git add <any changed files>
git commit -m "fix(issuingCompanies): <describe fix>"
```

---

## Phase 9 (optional): Integration tests with convex-test

**Note:** This phase adds `convex-test` to the project for the first time. It's worth the investment but can be deferred if sprint deadline is tight.

### Task 26: Install and configure convex-test

**Files:**
- Modify: `package.json`
- Create: `convex/__tests__/harness.ts`
- Modify/create: vitest config

- [ ] **Step 1: Install convex-test**

```bash
npm install -D convex-test
```

- [ ] **Step 2: Create test harness**

```ts
// convex/__tests__/harness.ts
import { convexTest } from "convex-test";
import schema from "../schema";

export function setupTest() {
  // Pass modules.glob only if your project requires it; convex-test auto-discovers by default
  return convexTest(schema);
}

export const ORG_A = "org_test_A";
export const ORG_B = "org_test_B";
```

- [ ] **Step 3: Configure vitest if needed**

Run: `cat vitest.config.ts 2>/dev/null || cat vitest.config.mts 2>/dev/null`

If no config exists, create `vitest.config.mts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime", // convex-test runs in edge-compatible env
    include: ["**/*.test.ts", "**/*.test.tsx"],
  },
});
```

Install the edge environment:
```bash
npm install -D @edge-runtime/vm
```

- [ ] **Step 4: Smoke test the harness**

Create `convex/__tests__/harness.smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { setupTest } from "./harness";

describe("convex-test harness", () => {
  it("boots and exposes run", async () => {
    const t = setupTest();
    expect(typeof t.run).toBe("function");
  });
});
```

Run: `npm test -- harness.smoke.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json convex/__tests__/ vitest.config.mts
git commit -m "test: add convex-test harness for integration tests"
```

---

### Task 27: Mutations integration tests

**Files:**
- Create: `convex/functions/issuingCompanies/__tests__/mutations.test.ts`

- [ ] **Step 1: Write tests**

```ts
import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import { setupTest, ORG_A, ORG_B } from "../../../__tests__/harness";

function withAdmin(orgId: string) {
  return { tokenIdentifier: "test|admin", subject: "user_admin", orgId, orgRole: "org:admin" };
}

const base = {
  name: "Test Co",
  legalName: "Test Co S.A. de C.V.",
  rfc: "TCO200101ABC",
  regimenFiscalCode: "601",
  codigoPostal: "11550",
  address: { street: "Av. Uno", city: "CDMX", state: "CDMX", country: "México" },
  email: "test@test.mx",
};

describe("issuingCompanies.mutations", () => {
  it("first empresa activa en la org es isDefault=true automáticamente", async () => {
    const t = setupTest();
    const id = await t.withIdentity(withAdmin(ORG_A)).mutation(api.functions.issuingCompanies.mutations.create, base);
    const doc = await t.run(async (ctx) => ctx.db.get(id));
    expect(doc?.isDefault).toBe(true);
  });

  it("segunda empresa en la org entra con isDefault=false", async () => {
    const t = setupTest();
    await t.withIdentity(withAdmin(ORG_A)).mutation(api.functions.issuingCompanies.mutations.create, base);
    const id2 = await t.withIdentity(withAdmin(ORG_A)).mutation(api.functions.issuingCompanies.mutations.create, {
      ...base,
      name: "Second",
      legalName: "Second S.A.",
      rfc: "SEC200101XYZ",
      email: "s@s.mx",
    });
    const doc2 = await t.run(async (ctx) => ctx.db.get(id2));
    expect(doc2?.isDefault).toBe(false);
  });

  it("RFC duplicado en misma org lanza", async () => {
    const t = setupTest();
    await t.withIdentity(withAdmin(ORG_A)).mutation(api.functions.issuingCompanies.mutations.create, base);
    await expect(
      t.withIdentity(withAdmin(ORG_A)).mutation(api.functions.issuingCompanies.mutations.create, {
        ...base,
        name: "Clone",
      })
    ).rejects.toThrow(/RFC/i);
  });

  it("RFC duplicado en otra org es OK (multi-tenant isolation)", async () => {
    const t = setupTest();
    await t.withIdentity(withAdmin(ORG_A)).mutation(api.functions.issuingCompanies.mutations.create, base);
    const idB = await t.withIdentity(withAdmin(ORG_B)).mutation(api.functions.issuingCompanies.mutations.create, base);
    expect(idB).toBeDefined();
  });

  it("setDefault: pone la nueva en true y la anterior en false", async () => {
    const t = setupTest();
    const id1 = await t.withIdentity(withAdmin(ORG_A)).mutation(api.functions.issuingCompanies.mutations.create, base);
    const id2 = await t.withIdentity(withAdmin(ORG_A)).mutation(api.functions.issuingCompanies.mutations.create, {
      ...base,
      name: "Second",
      legalName: "Second S.A.",
      rfc: "SEC200101XYZ",
      email: "s@s.mx",
    });
    await t.withIdentity(withAdmin(ORG_A)).mutation(api.functions.issuingCompanies.mutations.setDefault, { id: id2 });
    const d1 = await t.run(async (ctx) => ctx.db.get(id1));
    const d2 = await t.run(async (ctx) => ctx.db.get(id2));
    expect(d1?.isDefault).toBe(false);
    expect(d2?.isDefault).toBe(true);
  });

  it("update isActive=false sobre default lanza", async () => {
    const t = setupTest();
    const id = await t.withIdentity(withAdmin(ORG_A)).mutation(api.functions.issuingCompanies.mutations.create, base);
    await expect(
      t.withIdentity(withAdmin(ORG_A)).mutation(api.functions.issuingCompanies.mutations.update, { id, isActive: false })
    ).rejects.toThrow(/default/i);
  });

  it("remove sobre default lanza", async () => {
    const t = setupTest();
    const id = await t.withIdentity(withAdmin(ORG_A)).mutation(api.functions.issuingCompanies.mutations.create, base);
    await expect(
      t.withIdentity(withAdmin(ORG_A)).mutation(api.functions.issuingCompanies.mutations.remove, { id })
    ).rejects.toThrow(/default/i);
  });

  it("remove sin referencias elimina", async () => {
    const t = setupTest();
    const id1 = await t.withIdentity(withAdmin(ORG_A)).mutation(api.functions.issuingCompanies.mutations.create, base);
    const id2 = await t.withIdentity(withAdmin(ORG_A)).mutation(api.functions.issuingCompanies.mutations.create, {
      ...base,
      name: "Second",
      legalName: "Second S.A.",
      rfc: "SEC200101XYZ",
      email: "s@s.mx",
    });
    await t.withIdentity(withAdmin(ORG_A)).mutation(api.functions.issuingCompanies.mutations.remove, { id: id2 });
    const gone = await t.run(async (ctx) => ctx.db.get(id2));
    expect(gone).toBeNull();
    // id1 unaffected
    const still = await t.run(async (ctx) => ctx.db.get(id1));
    expect(still).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run and iterate until green**

Run: `npm test -- mutations.test.ts`
Expected: PASS, 8 tests.

If it fails on harness setup issues (module resolution, schema loading), adjust `convex/__tests__/harness.ts` and re-run.

- [ ] **Step 3: Commit**

```bash
git add convex/functions/issuingCompanies/__tests__/mutations.test.ts
git commit -m "test(issuingCompanies): add mutations integration tests"
```

---

### Task 28: Permissions integration tests

**Files:**
- Create: `convex/functions/issuingCompanies/__tests__/permissions.test.ts`

- [ ] **Step 1: Write tests**

```ts
import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../__tests__/harness";

function admin(orgId: string) {
  return { tokenIdentifier: "test|admin", subject: "user_admin", orgId, orgRole: "org:admin" };
}
function member(orgId: string) {
  return { tokenIdentifier: "test|member", subject: "user_member", orgId, orgRole: "org:member" };
}

const base = {
  name: "Test",
  legalName: "Test S.A.",
  rfc: "TCO200101ABC",
  regimenFiscalCode: "601",
  codigoPostal: "11550",
  address: { street: "Uno", city: "CDMX", state: "CDMX", country: "México" },
  email: "t@t.mx",
};

describe("issuingCompanies permissions", () => {
  it("member puede list", async () => {
    const t = setupTest();
    await t.withIdentity(admin(ORG_A)).mutation(api.functions.issuingCompanies.mutations.create, base);
    const result = await t.withIdentity(member(ORG_A)).query(api.functions.issuingCompanies.queries.list, {});
    expect(result.length).toBe(1);
  });

  it("member NO puede create", async () => {
    const t = setupTest();
    await expect(
      t.withIdentity(member(ORG_A)).mutation(api.functions.issuingCompanies.mutations.create, base)
    ).rejects.toThrow(/Administrador/i);
  });

  it("member NO puede update/setDefault/remove/assign", async () => {
    const t = setupTest();
    const id = await t.withIdentity(admin(ORG_A)).mutation(api.functions.issuingCompanies.mutations.create, base);
    await expect(
      t.withIdentity(member(ORG_A)).mutation(api.functions.issuingCompanies.mutations.update, { id, name: "x" })
    ).rejects.toThrow(/Administrador/i);
    await expect(
      t.withIdentity(member(ORG_A)).mutation(api.functions.issuingCompanies.mutations.setDefault, { id })
    ).rejects.toThrow(/Administrador/i);
    await expect(
      t.withIdentity(member(ORG_A)).mutation(api.functions.issuingCompanies.mutations.remove, { id })
    ).rejects.toThrow(/Administrador/i);
    await expect(
      t.withIdentity(member(ORG_A)).mutation(api.functions.issuingCompanies.mutations.assignServicesToCompany, {
        issuingCompanyId: id,
        serviceIds: [],
      })
    ).rejects.toThrow(/Administrador/i);
  });

  it("member NO puede listAvailableServices (admin-only)", async () => {
    const t = setupTest();
    await expect(
      t.withIdentity(member(ORG_A)).query(api.functions.issuingCompanies.queries.listAvailableServices, {})
    ).rejects.toThrow(/Administrador/i);
  });

  it("member NO puede countReferences (admin-only)", async () => {
    const t = setupTest();
    const id = await t.withIdentity(admin(ORG_A)).mutation(api.functions.issuingCompanies.mutations.create, base);
    await expect(
      t.withIdentity(member(ORG_A)).query(api.functions.issuingCompanies.queries.countReferences, { id })
    ).rejects.toThrow(/Administrador/i);
  });
});
```

- [ ] **Step 2: Run**

Run: `npm test -- permissions.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 3: Commit**

```bash
git add convex/functions/issuingCompanies/__tests__/permissions.test.ts
git commit -m "test(issuingCompanies): add permissions integration tests"
```

---

## Wrap-up

- [ ] **Final step: Run full test suite**

Run: `npm test`
Expected: all tests pass, including the baseline 61 + the new ones added in Phase 1, 4, 9.

- [ ] **Final build check**

Run: `npm run build`
Expected: no errors.

---

## Spec coverage checklist

- [x] Section 2.1 Scope — Tasks 1-24 (CRUD + resolver + seed + UI)
- [x] Section 2.2 Data model + validations — Task 1 (SAT helper), Tasks 4-9 (mutations with business rules)
- [x] Section 2.3 Backend — Tasks 2-11
- [x] Section 2.4 UI — Tasks 13-24
- [x] Section 2.5 Seed — Task 12
- [x] Section 2.6 Error handling — enforced across mutations + dialogs (Tasks 15-19)
- [x] Section 2.7 Testing — Task 1 (helpers unit), Task 10-11 (resolver unit), Tasks 26-28 (integration)
- [x] Section 2.8 Out of scope — respected (no `clientIssuingCompanyOverride` CRUD, no branding cromático, no onboarding banner)
- [x] Section 2.10 Unblocks 3/4 — `resolveIssuingCompany` + `resolveIssuingCompanyQuery` in Task 11 ready for sections 3/4 to import
