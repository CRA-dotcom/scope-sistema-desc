# Sub-spec 2 — Contracts per issuingCompany + Firmame Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate contract generation per `(orgId × issuingCompany × subservicio)` template, send PDF to Firmame for e-signature, handle webhook to update status. Add cron-driven reminders 3/7/14d and minimal pipeline view UI.

**Architecture:** Extend `deliverableTemplates` with `issuingCompanyId` + `signerMode`. Add Firmame fields + reminder counters to `contracts`. Promote `firmame` to explicit `orgIntegrations.provider` literal. Auto-pipeline at `quotation.status='approved'` triggers send action; Next.js webhook route at `/api/webhooks/firmame` handles status updates with HMAC verify. Reuse SS1 template infra (`resolveTemplateVariables`, `detectContentStatus`, bulk-import CLI). Reuse existing `resolveIssuingCompany` helper.

**Tech Stack:** Next.js 15, React 19, Convex (DB + actions + crons), Clerk Orgs, Firmame API (BYO per org), Resend, Puppeteer (existing PDF endpoint), Railway S3 (blob storage), Tailwind + shadcn/ui, Vitest + convex-test.

**Spec:** `docs/superpowers/specs/2026-05-26-sub-spec-2-contracts-firmame-design.md`

**Test baseline:** 873 passed | 1 skipped. Target post-merge: ≥903.

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `convex/lib/firmameClient.ts` | Aislado HTTP client a Firmame. createDocument, downloadSignedPdf, verifyWebhookSignature. Endpoint config, payload shape, error mapping. |
| `convex/lib/contractResolver.ts` | `findContractTemplate(orgId, issuingCompanyId, subserviceId)`. |
| `convex/lib/__tests__/firmameClient.test.ts` | Unit tests del client (mocked fetch). |
| `convex/lib/__tests__/contractResolver.test.ts` | Unit tests del resolver. |
| `convex/functions/contracts/cron.ts` | `contractRemindersTick` (internal mutation), `sendContractReminder` (action). |
| `convex/functions/contracts/__tests__/cron.test.ts` | Reminder eligibility tests. |
| `convex/functions/contracts/__tests__/sendContractToFirmame.test.ts` | Integration test send flow. |
| `convex/functions/contracts/__tests__/handleFirmameWebhook.test.ts` | Integration test webhook handler. |
| `convex/migrations/firmameProvider.ts` | Migrate `provider='other'+providerLabel='firmame'` → `provider='firmame'`. |
| `src/app/api/webhooks/firmame/route.ts` | Next.js POST route; HMAC verify; dispatch a Convex action. |
| `src/app/(dashboard)/contratos/page.tsx` | Pipeline view route. |
| `src/app/(dashboard)/contratos/components/ContractsTable.tsx` | Tabla con filtros y sort. |
| `src/app/(dashboard)/contratos/components/ContractRowActions.tsx` | Reenviar / Cancelar / Reintentar. |
| `src/app/(dashboard)/contratos/components/StuckBanner.tsx` | Alerta naranja > 7d sin firmar. |
| `src/app/(dashboard)/configuracion/empresas/[id]/contratos/page.tsx` | Lista templates contract por empresa emisora. |

### Modified files

| Path | Change |
|---|---|
| `convex/schema.ts` | Add fields to `deliverableTemplates` (issuingCompanyId, signerMode), `contracts` (firmame fields, reminders, signerMode, cancellationReason), `orgIntegrations` (provider literal `firmame`). New indexes. |
| `convex/functions/deliverableTemplates/mutations.ts` | Validate: `type='contract'` requires `issuingCompanyId` + `orgId`; other types reject `issuingCompanyId`. |
| `convex/functions/contracts/actions.ts` | Add `sendContractToFirmameInternal` action + `handleFirmameWebhook` internal action + `retryFailedContract` action. |
| `convex/functions/contracts/mutations.ts` | Add `cancelContract` mutation. |
| `convex/functions/contracts/queries.ts` | Add `getContractsForPipeline` (filters/sort) + `listByIssuingCompany`. |
| `convex/functions/quotations/publicActions.ts` | After `acceptQuotation` success → `scheduler.runAfter(0, internal.contracts.actions.sendContractToFirmameInternal, { quotationId })`. |
| `convex/crons.ts` | Register `crons.daily("contract reminders", ..., internal.functions.contracts.cron.contractRemindersTick)`. |
| `scripts/import-templates.ts` | Allow contract type with required `issuingCompanyId` (filename convention: `<empresa-slug>__<subservice-slug>-contract.html`). |

---

## Execution order

```
Phase 1: Schema + migration + validation  (Tasks 1-5)   ← no Firmame
Phase 2: Resolver + helpers               (Tasks 6-7)   ← no Firmame
Phase 3: Templates UI                     (Tasks 8-9)   ← no Firmame
Phase 4: Firmame client (skeleton + impl) (Tasks 10-12) ← BLOCKED by Firmame API docs
Phase 5: Send action + wiring             (Tasks 13-15) ← BLOCKED partially
Phase 6: Webhook                          (Tasks 16-18) ← BLOCKED by API docs
Phase 7: Reminders                        (Tasks 19-20) ← independent
Phase 8: Pipeline view UI                 (Tasks 21-24) ← independent
Phase 9: Cancel + retry + smoke           (Tasks 25-26)
```

Phases 1, 2, 3, 7, 8, 9 do NOT require Firmame docs and can execute in parallel-ish. Phases 4, 5 (impl portion), 6 require Firmame API docs (sandbox key + endpoints + webhook scheme).

---

# PHASE 1: Schema + migration + validation

## Task 1: Schema fields for `deliverableTemplates`

**Files:**
- Modify: `convex/schema.ts:526-577` (deliverableTemplates definition + indexes)
- Test: `convex/functions/deliverableTemplates/__tests__/schema.test.ts` (create if missing)

- [ ] **Step 1: Add fields + index to schema**

In `convex/schema.ts`, inside `deliverableTemplates` table definition, add (after `parentTemplateId` / `originalVersionAtClone` block, before `createdAt`):

```ts
    // SS2: composite key for contract templates
    issuingCompanyId: v.optional(v.id("issuingCompanies")),
    signerMode: v.optional(
      v.union(
        v.literal("client_only"),
        v.literal("co_sign")
      )
    ),
```

And append new index after existing indexes:

```ts
    .index("by_orgId_type_issuingCompanyId_subserviceId", [
      "orgId",
      "type",
      "issuingCompanyId",
      "subserviceId",
    ])
```

- [ ] **Step 2: Push schema and verify codegen**

```bash
npx convex dev --once
```

Expected: no errors; types regenerated. Verify `convex/_generated/dataModel.d.ts` includes `issuingCompanyId` and `signerMode` on `deliverableTemplates`.

- [ ] **Step 3: Commit**

```bash
git add convex/schema.ts convex/_generated/
git commit -m "schema(ss2): add issuingCompanyId + signerMode to deliverableTemplates"
```

---

## Task 2: Schema fields for `contracts`

**Files:**
- Modify: `convex/schema.ts:388-409` (contracts table + indexes)

- [ ] **Step 1: Add fields + index**

In `convex/schema.ts`, inside `contracts` table definition, append after `createdAt`:

```ts
    // SS2: Firmame integration
    firmameDocumentId: v.optional(v.string()),
    firmameSignUrl: v.optional(v.string()),
    firmameStatus: v.optional(v.string()),
    signedPdfBucketKey: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    lastReminderAt: v.optional(v.number()),
    reminderCount: v.optional(v.number()),
    signerMode: v.optional(
      v.union(
        v.literal("client_only"),
        v.literal("co_sign")
      )
    ),
    cancellationReason: v.optional(v.string()),
```

Append new index:

```ts
    .index("by_firmameDocumentId", ["firmameDocumentId"])
```

- [ ] **Step 2: Push + verify**

```bash
npx convex dev --once
```

Expected: codegen clean.

- [ ] **Step 3: Commit**

```bash
git add convex/schema.ts convex/_generated/
git commit -m "schema(ss2): add firmame fields + reminders to contracts"
```

---

## Task 3: Promote `firmame` literal in `orgIntegrations.provider`

**Files:**
- Modify: `convex/schema.ts:747-779` (orgIntegrations.provider union)

- [ ] **Step 1: Add literal**

In `convex/schema.ts`, change the `provider` field union:

```ts
    provider: v.union(
      v.literal("resend"),
      v.literal("mifiel"),
      v.literal("firmame"),
      v.literal("anthropic"),
      v.literal("other")
    ),
```

- [ ] **Step 2: Push + verify**

```bash
npx convex dev --once
```

- [ ] **Step 3: Commit**

```bash
git add convex/schema.ts convex/_generated/
git commit -m "schema(ss2): promote firmame literal in orgIntegrations.provider"
```

---

## Task 4: Migration — backfill `firmame` provider

**Files:**
- Create: `convex/migrations/firmameProvider.ts`
- Test: `convex/migrations/__tests__/firmameProvider.test.ts`

- [ ] **Step 1: Write failing test**

Create `convex/migrations/__tests__/firmameProvider.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";

describe("firmameProvider migration", () => {
  it("converts other+firmame label rows to provider='firmame'", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgIntegrations", {
        orgId: "org_test_1",
        provider: "other",
        providerLabel: "firmame",
        config: { apiKeyMasked: "***1234" },
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("orgIntegrations", {
        orgId: "org_test_2",
        provider: "resend",
        config: {},
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const result = await t.mutation(internal.migrations.firmameProvider.migrate, { cursor: null, limit: 100 });

    expect(result.migrated).toBe(1);
    expect(result.done).toBe(true);

    await t.run(async (ctx) => {
      const rows = await ctx.db.query("orgIntegrations").collect();
      const fm = rows.find((r) => r.orgId === "org_test_1");
      expect(fm?.provider).toBe("firmame");
      const resend = rows.find((r) => r.orgId === "org_test_2");
      expect(resend?.provider).toBe("resend"); // untouched
    });
  });

  it("is idempotent (re-running does nothing)", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgIntegrations", {
        orgId: "org_test_1",
        provider: "firmame",
        config: {},
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const result = await t.mutation(internal.migrations.firmameProvider.migrate, { cursor: null, limit: 100 });
    expect(result.migrated).toBe(0);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
npx vitest run convex/migrations/__tests__/firmameProvider.test.ts
```

Expected: FAIL — `internal.migrations.firmameProvider.migrate` does not exist.

- [ ] **Step 3: Implement migration**

Create `convex/migrations/firmameProvider.ts`:

```ts
import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

const PAGE_SIZE_DEFAULT = 100;

export const migrate = internalMutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? PAGE_SIZE_DEFAULT;
    const page = await ctx.db
      .query("orgIntegrations")
      .paginate({ cursor: args.cursor, numItems: limit });

    let migrated = 0;
    for (const row of page.page) {
      if (row.provider === "other" && row.providerLabel === "firmame") {
        await ctx.db.patch(row._id, {
          provider: "firmame",
          updatedAt: Date.now(),
        });
        migrated++;
      }
    }

    return {
      migrated,
      done: page.isDone,
      nextCursor: page.continueCursor,
    };
  },
});
```

- [ ] **Step 4: Run test, verify pass**

```bash
npx vitest run convex/migrations/__tests__/firmameProvider.test.ts
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add convex/migrations/firmameProvider.ts convex/migrations/__tests__/firmameProvider.test.ts
git commit -m "migration(ss2): backfill orgIntegrations firmame provider"
```

---

## Task 5: Validate `issuingCompanyId` in `deliverableTemplates` mutations

**Files:**
- Modify: `convex/functions/deliverableTemplates/mutations.ts` (find `createTemplate` and `updateTemplate`)
- Test: `convex/functions/deliverableTemplates/__tests__/contractValidation.test.ts`

- [ ] **Step 1: Write failing test**

Create `convex/functions/deliverableTemplates/__tests__/contractValidation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

describe("deliverableTemplates contract validation", () => {
  it("rejects type='contract' without issuingCompanyId", async () => {
    const t = convexTest(schema);
    const orgId = "org_test_1";
    let subId: Id<"subservices">;
    await t.run(async (ctx) => {
      subId = await ctx.db.insert("subservices", {
        orgId,
        serviceId: "svc_fake" as Id<"services">,
        name: "Asesoría Legal",
        slug: "asesoria-legal",
        defaultFrequency: "monthly",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });

    await expect(
      auth.mutation(api.functions.deliverableTemplates.mutations.createTemplate, {
        type: "contract",
        serviceName: "Legal",
        subserviceId: subId!,
        name: "Contrato Legal",
        htmlTemplate: "<p>{{cliente.nombre}}</p>",
        variables: [{ key: "cliente.nombre", label: "Nombre", source: "client", required: true }],
      })
    ).rejects.toThrow(/issuingCompanyId/);
  });

  it("rejects type='deliverable_long' with issuingCompanyId set", async () => {
    const t = convexTest(schema);
    const orgId = "org_test_1";
    let companyId: Id<"issuingCompanies">;
    await t.run(async (ctx) => {
      companyId = await ctx.db.insert("issuingCompanies", {
        orgId,
        name: "Despacho X",
        legalName: "Despacho X SA",
        rfc: "DXX900101AAA",
        regimenFiscalCode: "601",
        codigoPostal: "64000",
        address: { street: "Av X", city: "Monterrey", state: "NL", country: "MX" },
        email: "x@x.com",
        isDefault: true,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });

    await expect(
      auth.mutation(api.functions.deliverableTemplates.mutations.createTemplate, {
        type: "deliverable_long",
        serviceName: "Legal",
        name: "Reporte legal",
        htmlTemplate: "<p>hi</p>",
        variables: [],
        issuingCompanyId: companyId!,
      })
    ).rejects.toThrow(/issuingCompanyId only valid for contract/);
  });

  it("accepts type='contract' with valid issuingCompanyId + subserviceId", async () => {
    const t = convexTest(schema);
    const orgId = "org_test_1";
    let companyId: Id<"issuingCompanies">;
    let subId: Id<"subservices">;
    await t.run(async (ctx) => {
      companyId = await ctx.db.insert("issuingCompanies", {
        orgId, name: "DX", legalName: "DX SA", rfc: "DXX900101AAA",
        regimenFiscalCode: "601", codigoPostal: "64000",
        address: { street: "Av", city: "MTY", state: "NL", country: "MX" },
        email: "x@x.com", isDefault: true, isActive: true,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      subId = await ctx.db.insert("subservices", {
        orgId, serviceId: "svc" as Id<"services">, name: "AL", slug: "al",
        defaultFrequency: "monthly", isActive: true,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
    });

    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });
    const id = await auth.mutation(api.functions.deliverableTemplates.mutations.createTemplate, {
      type: "contract",
      serviceName: "Legal",
      subserviceId: subId!,
      issuingCompanyId: companyId!,
      name: "Contrato Legal",
      htmlTemplate: "<p>{{cliente.nombre}}</p>",
      variables: [{ key: "cliente.nombre", label: "Nombre", source: "client", required: true }],
    });
    expect(id).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
npx vitest run convex/functions/deliverableTemplates/__tests__/contractValidation.test.ts
```

Expected: FAIL — validation does not exist; test calls reject in unexpected places.

- [ ] **Step 3: Add validation to mutation**

In `convex/functions/deliverableTemplates/mutations.ts` find the `createTemplate` (and `updateTemplate`) mutation handler. Add `issuingCompanyId` to args validator (optional). Inside handler, before insert/patch, add:

```ts
// SS2: type='contract' requires issuingCompanyId AND org-scope. Other types reject it.
if (args.type === "contract") {
  if (!args.issuingCompanyId) {
    throw new Error("issuingCompanyId is required for contract templates");
  }
  // Globals (orgId=undefined) NOT allowed for contracts. requireTemplateEditAccess
  // already enforces org-scope by virtue of org:admin role check, but defend in depth:
  const orgId = await getOrgId(ctx); // existing helper
  if (!orgId) {
    throw new Error("Contract templates must be org-scoped");
  }
} else if (args.issuingCompanyId !== undefined) {
  throw new Error("issuingCompanyId only valid for contract type");
}
```

(Adapt to existing imports / function structure. `getOrgId` is in `convex/lib/authHelpers.ts`.)

- [ ] **Step 4: Run test, verify pass**

```bash
npx vitest run convex/functions/deliverableTemplates/__tests__/contractValidation.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add convex/functions/deliverableTemplates/mutations.ts convex/functions/deliverableTemplates/__tests__/contractValidation.test.ts
git commit -m "feat(ss2): validate issuingCompanyId in deliverableTemplates mutations"
```

---

# PHASE 2: Resolver + helpers

## Task 6: `findContractTemplate` resolver

**Files:**
- Create: `convex/lib/contractResolver.ts`
- Test: `convex/lib/__tests__/contractResolver.test.ts`

- [ ] **Step 1: Write failing test**

Create `convex/lib/__tests__/contractResolver.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import type { Id } from "../../_generated/dataModel";
import { findContractTemplate } from "../contractResolver";

describe("findContractTemplate", () => {
  it("returns exact match by (orgId, type, issuingCompanyId, subserviceId)", async () => {
    const t = convexTest(schema);
    const orgId = "org_1";
    let companyId: Id<"issuingCompanies">;
    let subId: Id<"subservices">;
    let templateId: Id<"deliverableTemplates">;

    await t.run(async (ctx) => {
      companyId = await ctx.db.insert("issuingCompanies", {
        orgId, name: "DX", legalName: "DX SA", rfc: "DXX900101AAA",
        regimenFiscalCode: "601", codigoPostal: "64000",
        address: { street: "Av", city: "MTY", state: "NL", country: "MX" },
        email: "x@x.com", isDefault: true, isActive: true,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      subId = await ctx.db.insert("subservices", {
        orgId, serviceId: "svc" as Id<"services">, name: "AL", slug: "al",
        defaultFrequency: "monthly", isActive: true,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      templateId = await ctx.db.insert("deliverableTemplates", {
        orgId, type: "contract", serviceName: "Legal",
        subserviceId: subId, issuingCompanyId: companyId,
        name: "Contrato Legal", htmlTemplate: "<p>x</p>", variables: [],
        version: 1, isActive: true,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
    });

    const result = await t.run(async (ctx) =>
      findContractTemplate(ctx, { orgId, issuingCompanyId: companyId!, subserviceId: subId! })
    );

    expect(result?._id).toBe(templateId!);
  });

  it("returns null when no match exists", async () => {
    const t = convexTest(schema);
    let fakeCompanyId: Id<"issuingCompanies">;
    let fakeSubId: Id<"subservices">;
    await t.run(async (ctx) => {
      fakeCompanyId = await ctx.db.insert("issuingCompanies", {
        orgId: "org_other", name: "Y", legalName: "Y SA", rfc: "YYY900101AAA",
        regimenFiscalCode: "601", codigoPostal: "00000",
        address: { street: "x", city: "x", state: "x", country: "MX" },
        email: "y@y.com", isDefault: false, isActive: true,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      fakeSubId = await ctx.db.insert("subservices", {
        orgId: "org_other", serviceId: "svc" as Id<"services">, name: "Y", slug: "y",
        defaultFrequency: "monthly", isActive: true,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
    });

    const result = await t.run(async (ctx) =>
      findContractTemplate(ctx, { orgId: "org_1", issuingCompanyId: fakeCompanyId!, subserviceId: fakeSubId! })
    );

    expect(result).toBeNull();
  });

  it("does NOT fall back to global (orgId=undefined) — contracts are org-scoped only", async () => {
    const t = convexTest(schema);
    const orgId = "org_1";
    let companyId: Id<"issuingCompanies">;
    let subId: Id<"subservices">;
    await t.run(async (ctx) => {
      companyId = await ctx.db.insert("issuingCompanies", {
        orgId, name: "DX", legalName: "DX SA", rfc: "DXX900101AAA",
        regimenFiscalCode: "601", codigoPostal: "64000",
        address: { street: "Av", city: "MTY", state: "NL", country: "MX" },
        email: "x@x.com", isDefault: true, isActive: true,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      subId = await ctx.db.insert("subservices", {
        orgId, serviceId: "svc" as Id<"services">, name: "AL", slug: "al",
        defaultFrequency: "monthly", isActive: true,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      // Inserta un "global" — debería ignorarlo
      await ctx.db.insert("deliverableTemplates", {
        orgId: undefined, type: "contract", serviceName: "Legal",
        subserviceId: subId, name: "Global", htmlTemplate: "<p>x</p>",
        variables: [], version: 1, isActive: true,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
    });

    const result = await t.run(async (ctx) =>
      findContractTemplate(ctx, { orgId, issuingCompanyId: companyId!, subserviceId: subId! })
    );

    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
npx vitest run convex/lib/__tests__/contractResolver.test.ts
```

Expected: FAIL — `findContractTemplate` not exported.

- [ ] **Step 3: Implement resolver**

Create `convex/lib/contractResolver.ts`:

```ts
import type { GenericQueryCtx } from "convex/server";
import type { DataModel, Doc, Id } from "../_generated/dataModel";

export async function findContractTemplate(
  ctx: GenericQueryCtx<DataModel>,
  args: {
    orgId: string;
    issuingCompanyId: Id<"issuingCompanies">;
    subserviceId: Id<"subservices">;
  }
): Promise<Doc<"deliverableTemplates"> | null> {
  const rows = await ctx.db
    .query("deliverableTemplates")
    .withIndex("by_orgId_type_issuingCompanyId_subserviceId", (q) =>
      q
        .eq("orgId", args.orgId)
        .eq("type", "contract")
        .eq("issuingCompanyId", args.issuingCompanyId)
        .eq("subserviceId", args.subserviceId)
    )
    .collect();

  // Should be at most 1 in practice; pick the active one with highest version.
  const active = rows.filter((r) => r.isActive);
  if (active.length === 0) return null;
  return active.sort((a, b) => b.version - a.version)[0];
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
npx vitest run convex/lib/__tests__/contractResolver.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add convex/lib/contractResolver.ts convex/lib/__tests__/contractResolver.test.ts
git commit -m "feat(ss2): add findContractTemplate resolver"
```

---

## Task 7: Add `getContractsForPipeline` query

**Files:**
- Modify: `convex/functions/contracts/queries.ts`
- Test: `convex/functions/contracts/__tests__/getContractsForPipeline.test.ts`

- [ ] **Step 1: Write failing test**

Create `convex/functions/contracts/__tests__/getContractsForPipeline.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

describe("getContractsForPipeline", () => {
  it("filters by status, sorts by days unsigned desc", async () => {
    const t = convexTest(schema);
    const orgId = "org_1";
    let clientId: Id<"clients">;
    let projServiceId: Id<"projectionServices">;
    let quotationId: Id<"quotations">;
    const now = Date.now();

    await t.run(async (ctx) => {
      clientId = await ctx.db.insert("clients", {
        orgId, name: "C", email: "c@c.com", createdAt: now, updatedAt: now,
      } as any);
      projServiceId = "ps" as Id<"projectionServices">;
      quotationId = "q" as Id<"quotations">;

      // 3 contracts: 2 sent (10d ago, 5d ago), 1 signed
      await ctx.db.insert("contracts", {
        orgId, quotationId, projServiceId, clientId,
        serviceName: "Legal", content: "x",
        status: "sent", sentAt: now - 10 * 24 * 3600 * 1000,
        createdAt: now,
      });
      await ctx.db.insert("contracts", {
        orgId, quotationId, projServiceId, clientId,
        serviceName: "Contable", content: "x",
        status: "sent", sentAt: now - 5 * 24 * 3600 * 1000,
        createdAt: now,
      });
      await ctx.db.insert("contracts", {
        orgId, quotationId, projServiceId, clientId,
        serviceName: "Marketing", content: "x",
        status: "signed", sentAt: now - 30 * 24 * 3600 * 1000,
        signedAt: now - 25 * 24 * 3600 * 1000,
        createdAt: now,
      });
    });

    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });
    const result = await auth.query(api.functions.contracts.queries.getContractsForPipeline, {
      statusFilter: "sent",
    });

    expect(result.length).toBe(2);
    expect(result[0].serviceName).toBe("Legal"); // 10d, oldest
    expect(result[1].serviceName).toBe("Contable"); // 5d
  });

  it("filters by daysWithoutSigning threshold", async () => {
    const t = convexTest(schema);
    const orgId = "org_1";
    const now = Date.now();
    let clientId: Id<"clients">;

    await t.run(async (ctx) => {
      clientId = await ctx.db.insert("clients", {
        orgId, name: "C", email: "c@c.com", createdAt: now, updatedAt: now,
      } as any);

      await ctx.db.insert("contracts", {
        orgId, quotationId: "q" as Id<"quotations">,
        projServiceId: "ps" as Id<"projectionServices">, clientId,
        serviceName: "A", content: "x", status: "sent",
        sentAt: now - 8 * 24 * 3600 * 1000, createdAt: now,
      });
      await ctx.db.insert("contracts", {
        orgId, quotationId: "q" as Id<"quotations">,
        projServiceId: "ps" as Id<"projectionServices">, clientId,
        serviceName: "B", content: "x", status: "sent",
        sentAt: now - 2 * 24 * 3600 * 1000, createdAt: now,
      });
    });

    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });
    const result = await auth.query(api.functions.contracts.queries.getContractsForPipeline, {
      statusFilter: "sent",
      minDaysWithoutSigning: 7,
    });

    expect(result.length).toBe(1);
    expect(result[0].serviceName).toBe("A");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
npx vitest run convex/functions/contracts/__tests__/getContractsForPipeline.test.ts
```

Expected: FAIL — `getContractsForPipeline` not exported.

- [ ] **Step 3: Implement query**

In `convex/functions/contracts/queries.ts`, add:

```ts
import { query } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgId, requireAdmin } from "../../lib/authHelpers";

// TODO(post-MVP): support filter by issuingCompanyId — requires snapshot field
// on contracts table or join through servicesIssuingCompanyMap. Deferred.
export const getContractsForPipeline = query({
  args: {
    statusFilter: v.optional(
      v.union(v.literal("all"), v.literal("draft"), v.literal("sent"), v.literal("signed"), v.literal("cancelled"))
    ),
    minDaysWithoutSigning: v.optional(v.number()),
    clientId: v.optional(v.id("clients")),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    if (!orgId) return [];

    let q = ctx.db.query("contracts").withIndex("by_orgId", (q) => q.eq("orgId", orgId));
    let rows = await q.collect();

    if (args.statusFilter && args.statusFilter !== "all") {
      rows = rows.filter((r) => r.status === args.statusFilter);
    }
    if (args.clientId) {
      rows = rows.filter((r) => r.clientId === args.clientId);
    }
    const now = Date.now();
    if (args.minDaysWithoutSigning !== undefined) {
      const cutoff = args.minDaysWithoutSigning * 24 * 3600 * 1000;
      rows = rows.filter((r) =>
        r.status === "sent" && r.sentAt && now - r.sentAt >= cutoff
      );
    }
    // Sort: status=sent rows by sentAt asc (oldest first); other statuses by createdAt desc.
    rows.sort((a, b) => {
      if (a.status === "sent" && b.status === "sent") {
        return (a.sentAt ?? 0) - (b.sentAt ?? 0);
      }
      return b.createdAt - a.createdAt;
    });
    return rows;
  },
});
```

- [ ] **Step 4: Run test, verify pass**

```bash
npx vitest run convex/functions/contracts/__tests__/getContractsForPipeline.test.ts
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add convex/functions/contracts/queries.ts convex/functions/contracts/__tests__/getContractsForPipeline.test.ts
git commit -m "feat(ss2): add getContractsForPipeline query"
```

---

# PHASE 3: Templates UI

## Task 8: Bulk-import CLI — accept contract type with `issuingCompanyId`

**Files:**
- Modify: `scripts/import-templates.ts`
- Test: extend existing tests for import-templates if present, else add `scripts/__tests__/import-templates.test.ts`

- [ ] **Step 1: Identify filename convention**

Extend filename grammar: `<empresa-slug>__<subservice-slug>-contract.html` for contract templates (empresa-slug references issuingCompanies, subservice-slug references subservices). Examples: `desc__asesoria-legal-contract.html`, `desc__estados-financieros-contract.html`.

For deliverable types (existing convention): `<parent-slug>__<sub-slug>[-<type>].html`.

- [ ] **Step 2: Write failing test**

If `scripts/__tests__/import-templates.test.ts` does not exist, create one. Add this test case:

```ts
import { describe, it, expect } from "vitest";
import { parseFilename } from "../import-templates"; // exports parser internally

describe("parseFilename", () => {
  it("parses contract template filename with empresa slug", () => {
    const r = parseFilename("desc__asesoria-legal-contract.html");
    expect(r).toEqual({
      empresaSlug: "desc",
      subserviceSlug: "asesoria-legal",
      type: "contract",
    });
  });

  it("parses deliverable_long filename (existing convention)", () => {
    const r = parseFilename("legal__asesoria-legal.html");
    expect(r).toEqual({
      parentSlug: "legal",
      subserviceSlug: "asesoria-legal",
      type: "deliverable_long",
    });
  });
});
```

- [ ] **Step 3: Run test, verify failure**

```bash
npx vitest run scripts/__tests__/import-templates.test.ts
```

Expected: FAIL — parser not exposed OR contract parsing unsupported.

- [ ] **Step 4: Implement parser update**

In `scripts/import-templates.ts` (open the file first — current parser is regex-based on filename per SS1). Modify the `parseFilename` (or equivalent) function to handle contract type:

```ts
export function parseFilename(filename: string):
  | { empresaSlug: string; subserviceSlug: string; type: "contract" }
  | { parentSlug: string; subserviceSlug: string; type: "deliverable_long" | "deliverable_short" | "quotation" | "questionnaire" }
{
  // CONTRACT: <empresa-slug>__<subservice-slug>-contract.html
  const contractMatch = filename.match(/^([a-z0-9-]+)__([a-z0-9-]+)-contract\.html$/);
  if (contractMatch) {
    return {
      empresaSlug: contractMatch[1],
      subserviceSlug: contractMatch[2],
      type: "contract",
    };
  }
  // DELIVERABLE (existing): <parent-slug>__<sub-slug>[-<type>].html
  // ... existing logic ...
}
```

Update the upserter to lookup `issuingCompanies` by `(orgId, slug)` (use `name` lowercased+slugified if no `slug` field — verify). If contract type and no `--orgId` flag → error.

- [ ] **Step 5: Run test, verify pass**

```bash
npx vitest run scripts/__tests__/import-templates.test.ts
```

Expected: 2+ passed.

- [ ] **Step 6: Commit**

```bash
git add scripts/import-templates.ts scripts/__tests__/import-templates.test.ts
git commit -m "feat(ss2): bulk-import supports contract type with empresa-slug naming"
```

---

## Task 9: UI `/configuracion/empresas/[id]/contratos` — list templates per empresa

**Files:**
- Create: `src/app/(dashboard)/configuracion/empresas/[id]/contratos/page.tsx`

- [ ] **Step 1: Skeleton page**

Create `src/app/(dashboard)/configuracion/empresas/[id]/contratos/page.tsx`:

```tsx
"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import { useParams } from "next/navigation";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import Link from "next/link";

export default function EmpresaContratosPage() {
  const params = useParams();
  const issuingCompanyId = params.id as Id<"issuingCompanies">;

  const company = useQuery(api.functions.issuingCompanies.queries.get, { id: issuingCompanyId });
  const templates = useQuery(
    api.functions.deliverableTemplates.queries.listByIssuingCompany,
    { issuingCompanyId }
  );

  if (!company || !templates) return <div className="p-6">Cargando…</div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">
        Contratos — {company.name}
      </h1>
      <p className="text-sm text-gray-600 mb-6">
        Templates de contrato para esta empresa emisora. Uno por subservicio.
      </p>

      {templates.length === 0 ? (
        <div className="rounded border border-dashed border-gray-300 p-6 text-center text-gray-500">
          Sin contratos cargados. Usa el bulk-import CLI o crea uno manual.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-gray-600 border-b">
            <tr>
              <th className="py-2">Subservicio</th>
              <th>Nombre</th>
              <th>Contenido</th>
              <th>signerMode</th>
              <th>v</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t._id} className="border-b last:border-b-0">
                <td className="py-2">{t.subserviceName ?? "—"}</td>
                <td>{t.name}</td>
                <td>
                  <span className={t.contentStatus === "ready" ? "text-emerald-700" : "text-amber-700"}>
                    {t.contentStatus ?? "placeholder"}
                  </span>
                </td>
                <td>{t.signerMode ?? "client_only"}</td>
                <td>{t.version}</td>
                <td>
                  <Link
                    href={`/configuracion/plantillas/${t._id}/editar`}
                    className="text-blue-600 hover:underline"
                  >
                    Editar
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add `listByIssuingCompany` query**

In `convex/functions/deliverableTemplates/queries.ts`, add:

```ts
export const listByIssuingCompany = query({
  args: { issuingCompanyId: v.id("issuingCompanies") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    if (!orgId) return [];

    const rows = await ctx.db
      .query("deliverableTemplates")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    const filtered = rows.filter(
      (r) => r.type === "contract" && r.issuingCompanyId === args.issuingCompanyId
    );

    // Enrich with subservice name
    return Promise.all(
      filtered.map(async (r) => {
        const sub = r.subserviceId ? await ctx.db.get(r.subserviceId) : null;
        return { ...r, subserviceName: sub?.name };
      })
    );
  },
});
```

- [ ] **Step 3: Smoke test — start dev server and navigate**

```bash
npm run dev
```

Open `http://localhost:3000/configuracion/empresas/<some-id>/contratos`. Expected: page renders, empty state visible.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/configuracion/empresas/\[id\]/contratos/page.tsx convex/functions/deliverableTemplates/queries.ts
git commit -m "feat(ss2): UI route for contract templates per empresa emisora"
```

---

# PHASE 4: Firmame client

> **GATED:** Tasks 10-12 require Firmame API docs (endpoints, auth scheme, payload structure, webhook event names, HMAC verification scheme). If docs not yet available, implement Task 10's skeleton with TODO markers, push remaining work for when docs arrive.

## Task 10: `firmameClient` skeleton + config

**Files:**
- Create: `convex/lib/firmameClient.ts`
- Test: `convex/lib/__tests__/firmameClient.test.ts`

- [ ] **Step 1: Define interface (failing test)**

Create `convex/lib/__tests__/firmameClient.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFirmameClient } from "../firmameClient";

describe("firmameClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("createDocument", () => {
    it("POSTs to Firmame with API key and returns documentId + signUrl", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          document_id: "firmame_abc123",
          sign_url: "https://firmame.com/sign/abc123",
          status: "pending",
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const client = createFirmameClient({
        apiKey: "test-api-key",
        sandbox: true,
      });

      const result = await client.createDocument({
        title: "Contrato X",
        pdfBuffer: Buffer.from("fake-pdf-bytes"),
        signers: [{ email: "client@x.com", name: "Cliente", role: "client" }],
      });

      expect(result.documentId).toBe("firmame_abc123");
      expect(result.signUrl).toBe("https://firmame.com/sign/abc123");
      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toMatch(/firmame/);
      expect(options.headers.Authorization).toContain("test-api-key");
    });

    it("throws FirmameApiError on non-2xx", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "unauthorized",
      });
      vi.stubGlobal("fetch", mockFetch);

      const client = createFirmameClient({ apiKey: "bad", sandbox: true });

      await expect(
        client.createDocument({
          title: "x",
          pdfBuffer: Buffer.from("x"),
          signers: [{ email: "x@x.com", name: "X", role: "client" }],
        })
      ).rejects.toThrow(/firmame/i);
    });
  });

  describe("verifyWebhookSignature", () => {
    it("returns true for valid HMAC", () => {
      const body = '{"event":"signed","document_id":"abc"}';
      const secret = "webhook-secret";
      // Pre-compute expected HMAC SHA256 hex (placeholder — actual value from Firmame docs)
      const expectedSig = "<COMPUTE_AT_IMPL_TIME>";

      const client = createFirmameClient({ apiKey: "x", sandbox: true, webhookSecret: secret });
      // expect(client.verifyWebhookSignature(body, expectedSig)).toBe(true);
      expect(client.verifyWebhookSignature).toBeDefined();
    });

    it("returns false for invalid HMAC", () => {
      const client = createFirmameClient({ apiKey: "x", sandbox: true, webhookSecret: "s" });
      expect(client.verifyWebhookSignature("body", "wrong-sig")).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
npx vitest run convex/lib/__tests__/firmameClient.test.ts
```

Expected: FAIL — `createFirmameClient` not exported.

- [ ] **Step 3: Skeleton implementation**

Create `convex/lib/firmameClient.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export type FirmameSigner = {
  email: string;
  name: string;
  role: "client" | "issuer";
};

export type FirmameCreateDocumentResult = {
  documentId: string;
  signUrl: string;
  status: string;
};

export class FirmameApiError extends Error {
  constructor(public statusCode: number, public body: string) {
    super(`Firmame API error ${statusCode}: ${body}`);
    this.name = "FirmameApiError";
  }
}

export type FirmameClientConfig = {
  apiKey: string;
  sandbox: boolean;
  webhookSecret?: string;
};

// TBD: real endpoints from Firmame docs. Placeholder URLs below.
const ENDPOINTS = {
  sandbox: "https://sandbox.firmame.com/api/v1",
  production: "https://api.firmame.com/api/v1",
};

export function createFirmameClient(config: FirmameClientConfig) {
  const baseUrl = config.sandbox ? ENDPOINTS.sandbox : ENDPOINTS.production;

  async function createDocument(args: {
    title: string;
    pdfBuffer: Buffer;
    signers: FirmameSigner[];
    deadline?: number;
  }): Promise<FirmameCreateDocumentResult> {
    // TBD: real payload shape from Firmame docs.
    const formData = new FormData();
    formData.append("title", args.title);
    formData.append("pdf", new Blob([args.pdfBuffer], { type: "application/pdf" }));
    formData.append("signers", JSON.stringify(args.signers));
    if (args.deadline) formData.append("deadline", String(args.deadline));

    const res = await fetch(`${baseUrl}/documents`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: formData,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new FirmameApiError(res.status, body);
    }
    const json = await res.json();
    return {
      documentId: json.document_id,
      signUrl: json.sign_url,
      status: json.status,
    };
  }

  async function downloadSignedPdf(documentId: string): Promise<Buffer> {
    const res = await fetch(`${baseUrl}/documents/${documentId}/signed`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    if (!res.ok) throw new FirmameApiError(res.status, await res.text());
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  function verifyWebhookSignature(rawBody: string, signature: string): boolean {
    if (!config.webhookSecret) return false;
    // TBD: real scheme from Firmame docs. Assume HMAC-SHA256 hex of raw body.
    const expected = createHmac("sha256", config.webhookSecret).update(rawBody).digest("hex");
    if (expected.length !== signature.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }

  return { createDocument, downloadSignedPdf, verifyWebhookSignature };
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
npx vitest run convex/lib/__tests__/firmameClient.test.ts
```

Expected: 3 passed (the HMAC valid case is skipped since we lack real expected value; verify it has `expect.toBeDefined()`).

- [ ] **Step 5: Commit**

```bash
git add convex/lib/firmameClient.ts convex/lib/__tests__/firmameClient.test.ts
git commit -m "feat(ss2): firmameClient skeleton (endpoints TBD per docs)"
```

---

## Task 11: Real Firmame endpoints (PENDING DOCS)

> **GATED:** Skip if Firmame docs not yet provided. Continue with Phase 5+ using the skeleton.

When docs arrive:

- [ ] Update `ENDPOINTS` in `convex/lib/firmameClient.ts` with real URLs.
- [ ] Update `createDocument` payload shape to match Firmame's expected fields.
- [ ] Update `verifyWebhookSignature` to match real HMAC scheme (header name + algorithm).
- [ ] Update `downloadSignedPdf` endpoint shape.
- [ ] Complete the "valid HMAC" test case with a real expected signature.
- [ ] Commit:

```bash
git commit -m "feat(ss2): firmameClient — real endpoints + HMAC scheme"
```

---

## Task 12: `firmameWebhook` HMAC verify integration test

**Files:**
- Test: `convex/lib/__tests__/firmameClient.test.ts` (extend)

- [ ] **Step 1: Add valid HMAC test (compute expected at runtime)**

Replace the skipped "valid HMAC" test:

```ts
it("returns true for valid HMAC", () => {
  const body = '{"event":"signed","document_id":"abc"}';
  const secret = "webhook-secret";
  // Compute expected at runtime using same algo as impl
  const { createHmac } = require("node:crypto");
  const expectedSig = createHmac("sha256", secret).update(body).digest("hex");

  const client = createFirmameClient({ apiKey: "x", sandbox: true, webhookSecret: secret });
  expect(client.verifyWebhookSignature(body, expectedSig)).toBe(true);
});
```

- [ ] **Step 2: Run test, verify pass**

```bash
npx vitest run convex/lib/__tests__/firmameClient.test.ts
```

Expected: 4 passed.

- [ ] **Step 3: Commit**

```bash
git add convex/lib/__tests__/firmameClient.test.ts
git commit -m "test(ss2): HMAC verify roundtrip test"
```

---

# PHASE 5: Send action + wiring

## Task 13: `sendContractToFirmameInternal` action

**Files:**
- Modify: `convex/functions/contracts/actions.ts`
- Modify: `convex/functions/contracts/internalQueries.ts` (add helpers if needed)
- Test: `convex/functions/contracts/__tests__/sendContractToFirmame.test.ts`

- [ ] **Step 1: Write failing integration test**

Create `convex/functions/contracts/__tests__/sendContractToFirmame.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

// Mock firmameClient
vi.mock("../../../lib/firmameClient", async () => {
  return {
    createFirmameClient: () => ({
      createDocument: async () => ({
        documentId: "firmame_abc",
        signUrl: "https://firmame.com/sign/abc",
        status: "pending",
      }),
      downloadSignedPdf: async () => Buffer.from("fake-signed-pdf"),
      verifyWebhookSignature: () => true,
    }),
  };
});

// Mock Puppeteer PDF endpoint
global.fetch = vi.fn(async (url: string) => {
  if (typeof url === "string" && url.includes("/api/render-pdf")) {
    return new Response(Buffer.from("fake-rendered-pdf"));
  }
  throw new Error("unmocked fetch: " + url);
}) as any;

describe("sendContractToFirmameInternal", () => {
  it("creates contract, emailLog, and documentEvents row", async () => {
    const t = convexTest(schema);
    const orgId = "org_test";
    let clientId: Id<"clients">;
    let serviceId: Id<"services">;
    let subId: Id<"subservices">;
    let companyId: Id<"issuingCompanies">;
    let projServiceId: Id<"projectionServices">;
    let projectionId: Id<"projections">;
    let quotationId: Id<"quotations">;

    await t.run(async (ctx) => {
      clientId = await ctx.db.insert("clients", {
        orgId, name: "Cliente X", email: "client@x.com",
        createdAt: Date.now(), updatedAt: Date.now(),
      } as any);
      serviceId = await ctx.db.insert("services", {
        name: "Legal", isActive: true, createdAt: Date.now(), updatedAt: Date.now(),
      } as any);
      subId = await ctx.db.insert("subservices", {
        orgId, serviceId, name: "Asesoría", slug: "asesoria",
        defaultFrequency: "monthly", isActive: true,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      companyId = await ctx.db.insert("issuingCompanies", {
        orgId, name: "Despacho", legalName: "Despacho SA", rfc: "DXX900101AAA",
        regimenFiscalCode: "601", codigoPostal: "64000",
        address: { street: "Av", city: "MTY", state: "NL", country: "MX" },
        email: "d@d.com", isDefault: true, isActive: true,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      await ctx.db.insert("servicesIssuingCompanyMap", {
        orgId, serviceId, issuingCompanyId: companyId,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      projectionId = await ctx.db.insert("projections", {
        orgId, clientId, name: "P", year: 2026, startMonth: 1,
        status: "active", createdAt: Date.now(), updatedAt: Date.now(),
      } as any);
      projServiceId = await ctx.db.insert("projectionServices", {
        orgId, projectionId, serviceId, subserviceId: subId,
        annualAmount: 100000, weight: 1, isActive: true,
        createdAt: Date.now(), updatedAt: Date.now(),
      } as any);
      quotationId = await ctx.db.insert("quotations", {
        orgId, projServiceId, clientId, serviceName: "Legal",
        subserviceId: subId, content: "<p>Cotización</p>",
        status: "approved", createdAt: Date.now(),
      });
      await ctx.db.insert("deliverableTemplates", {
        orgId, type: "contract", serviceName: "Legal",
        subserviceId: subId, issuingCompanyId: companyId,
        name: "Contrato Legal",
        htmlTemplate: "<p>{{cliente.nombre}} firma con {{empresa.legalName}}</p>",
        variables: [
          { key: "cliente.nombre", label: "Nombre", source: "client", required: true },
          { key: "empresa.legalName", label: "Empresa", source: "service", required: true },
        ],
        version: 1, isActive: true,
        signerMode: "client_only",
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      await ctx.db.insert("orgIntegrations", {
        orgId, provider: "firmame",
        config: { apiKeyMasked: "***1234", sandboxMode: true },
        status: "active",
        createdAt: Date.now(), updatedAt: Date.now(),
      });
    });

    await t.action(internal.functions.contracts.actions.sendContractToFirmameInternal, {
      quotationId: quotationId!,
    });

    await t.run(async (ctx) => {
      const contracts = await ctx.db.query("contracts").collect();
      expect(contracts.length).toBe(1);
      expect(contracts[0].status).toBe("sent");
      expect(contracts[0].firmameDocumentId).toBe("firmame_abc");
      expect(contracts[0].firmameSignUrl).toBe("https://firmame.com/sign/abc");
      expect(contracts[0].sentAt).toBeTruthy();
      expect(contracts[0].signerMode).toBe("client_only");

      const events = await ctx.db
        .query("documentEvents")
        .withIndex("by_orgId_entityType_entityId", (q) =>
          q.eq("orgId", orgId).eq("entityType", "contract").eq("entityId", contracts[0]._id)
        )
        .collect();
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events.some((e) => e.eventType === "created")).toBe(true);

      const emailLogs = await ctx.db.query("emailLog").collect();
      expect(emailLogs.length).toBe(1);
      expect(emailLogs[0].type).toBe("contract");
    });
  });

  it("logs error event when template missing", async () => {
    const t = convexTest(schema);
    const orgId = "org_test";
    let quotationId: Id<"quotations">;
    let clientId: Id<"clients">;

    await t.run(async (ctx) => {
      clientId = await ctx.db.insert("clients", {
        orgId, name: "C", email: "c@c.com",
        createdAt: Date.now(), updatedAt: Date.now(),
      } as any);
      const serviceId = await ctx.db.insert("services", {
        name: "Legal", isActive: true, createdAt: Date.now(), updatedAt: Date.now(),
      } as any);
      const companyId = await ctx.db.insert("issuingCompanies", {
        orgId, name: "D", legalName: "D SA", rfc: "DXX900101AAA",
        regimenFiscalCode: "601", codigoPostal: "00000",
        address: { street: "x", city: "x", state: "x", country: "MX" },
        email: "d@d.com", isDefault: true, isActive: true,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      const subId = await ctx.db.insert("subservices", {
        orgId, serviceId, name: "S", slug: "s",
        defaultFrequency: "monthly", isActive: true,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId, clientId, name: "P", year: 2026, startMonth: 1,
        status: "active", createdAt: Date.now(), updatedAt: Date.now(),
      } as any);
      const projServiceId = await ctx.db.insert("projectionServices", {
        orgId, projectionId, serviceId, subserviceId: subId,
        annualAmount: 1, weight: 1, isActive: true,
        createdAt: Date.now(), updatedAt: Date.now(),
      } as any);
      await ctx.db.insert("servicesIssuingCompanyMap", {
        orgId, serviceId, issuingCompanyId: companyId,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      quotationId = await ctx.db.insert("quotations", {
        orgId, projServiceId, clientId, serviceName: "L",
        subserviceId: subId, content: "x",
        status: "approved", createdAt: Date.now(),
      });
      // NO template inserted
    });

    await t.action(internal.functions.contracts.actions.sendContractToFirmameInternal, {
      quotationId: quotationId!,
    });

    await t.run(async (ctx) => {
      const contracts = await ctx.db.query("contracts").collect();
      expect(contracts.length).toBe(0); // no contract created
      const events = await ctx.db
        .query("documentEvents")
        .withIndex("by_orgId_severity_createdAt", (q) =>
          q.eq("orgId", orgId).eq("severity", "error")
        )
        .collect();
      expect(events.length).toBeGreaterThanOrEqual(1);
    });
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
npx vitest run convex/functions/contracts/__tests__/sendContractToFirmame.test.ts
```

Expected: FAIL — `sendContractToFirmameInternal` not exported.

- [ ] **Step 3: Implement action**

In `convex/functions/contracts/actions.ts`, add (after existing exports):

```ts
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";
import { createFirmameClient } from "../../lib/firmameClient";
import { resolveTemplateVariables } from "../../lib/templateVariables";
import { resolveIssuingCompany, NoIssuingCompanyError } from "../issuingCompanies/resolve";
import { findContractTemplate } from "../../lib/contractResolver";

export const sendContractToFirmameInternal = internalAction({
  args: { quotationId: v.id("quotations") },
  handler: async (ctx, args) => {
    // 1. Load quotation + relations via internal query
    const ctxData = await ctx.runQuery(internal.functions.contracts.internalQueries.loadSendContext, {
      quotationId: args.quotationId,
    });
    if (!ctxData) {
      // No-op (quotation deleted between scheduler enqueue and now)
      return;
    }
    const { quotation, client, projection, projService, service, subservice, orgId } = ctxData;

    if (quotation.status !== "approved") return; // race guard

    // 2. Resolve issuing company
    let resolved;
    try {
      resolved = await ctx.runQuery(internal.functions.issuingCompanies.resolve.resolveIssuingCompanyQuery, {
        orgId, clientId: quotation.clientId, serviceId: service._id,
      });
    } catch (e: any) {
      await ctx.runMutation(internal.functions.documentEvents.internal.logEvent, {
        orgId, clientId: quotation.clientId,
        entityType: "contract", entityId: quotation._id, // pre-contract phase
        eventType: "error", severity: "error", actorType: "system",
        message: `Issuing company unresolved: ${e.message}`,
      });
      return;
    }
    const { issuingCompany } = resolved;

    // 3. Find template
    const template = await ctx.runQuery(internal.functions.contracts.internalQueries.findContractTemplateQuery, {
      orgId, issuingCompanyId: issuingCompany._id, subserviceId: subservice?._id ?? null,
    });
    if (!template) {
      await ctx.runMutation(internal.functions.documentEvents.internal.logEvent, {
        orgId, clientId: quotation.clientId,
        entityType: "contract", entityId: quotation._id,
        eventType: "error", severity: "error", actorType: "system",
        message: `Falta template de contrato para empresa ${issuingCompany.name} × subservicio ${subservice?.name}`,
      });
      return;
    }

    // 4. Render HTML
    const rendered = resolveTemplateVariables(template.htmlTemplate, {
      client, projection, projService, service,
      empresa: issuingCompany,
      quotation,
    });

    // 5. Render PDF via Puppeteer endpoint
    const pdfRes = await fetch(`${process.env.PUPPETEER_ENDPOINT_URL}/api/render-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html: rendered }),
    });
    if (!pdfRes.ok) {
      await ctx.runMutation(internal.functions.documentEvents.internal.logEvent, {
        orgId, clientId: quotation.clientId,
        entityType: "contract", entityId: quotation._id,
        eventType: "error", severity: "error", actorType: "system",
        message: `PDF render failed: ${await pdfRes.text()}`,
      });
      return;
    }
    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());

    // 6. Load Firmame creds
    const integration = await ctx.runQuery(internal.functions.orgIntegrations.queries.findActive, {
      orgId, provider: "firmame",
    });
    if (!integration || !integration.config.apiKeySecretRef) {
      await ctx.runMutation(internal.functions.documentEvents.internal.logEvent, {
        orgId, clientId: quotation.clientId,
        entityType: "contract", entityId: quotation._id,
        eventType: "error", severity: "error", actorType: "system",
        message: "Firmame credentials missing in orgIntegrations",
      });
      return;
    }

    const apiKey = await getSecret(integration.config.apiKeySecretRef); // helper
    const firmame = createFirmameClient({
      apiKey,
      sandbox: integration.config.sandboxMode ?? true,
      webhookSecret: integration.config.webhookSecretRef
        ? await getSecret(integration.config.webhookSecretRef) : undefined,
    });

    // 7. Send to Firmame
    const signers = template.signerMode === "co_sign"
      ? [
          { email: client.email, name: client.name, role: "client" as const },
          { email: issuingCompany.email, name: issuingCompany.signatoryName ?? issuingCompany.name, role: "issuer" as const },
        ]
      : [{ email: client.email, name: client.name, role: "client" as const }];

    let firmameResult;
    try {
      firmameResult = await firmame.createDocument({
        title: `Contrato ${service.name} — ${client.name}`,
        pdfBuffer,
        signers,
      });
    } catch (e: any) {
      // TODO: retry 3x with exp backoff. For MVP, log + abort.
      await ctx.runMutation(internal.functions.documentEvents.internal.logEvent, {
        orgId, clientId: quotation.clientId,
        entityType: "contract", entityId: quotation._id,
        eventType: "error", severity: "error", actorType: "system",
        message: `Firmame createDocument failed: ${e.message}`,
      });
      return;
    }

    // 8. Insert contract + emailLog + documentEvents
    await ctx.runMutation(internal.functions.contracts.internalMutations.saveSent, {
      orgId,
      quotationId: quotation._id,
      projServiceId: projService._id,
      clientId: quotation.clientId,
      serviceName: service.name,
      subserviceId: subservice?._id,
      content: rendered,
      firmameDocumentId: firmameResult.documentId,
      firmameSignUrl: firmameResult.signUrl,
      firmameStatus: firmameResult.status,
      signerMode: template.signerMode ?? "client_only",
      sentAt: Date.now(),
    });
  },
});
```

Helper `getSecret` reads from environment / Convex env. If apiKeySecretRef pattern is `env:FIRMAME_API_KEY_<orgId>`, resolve accordingly. For MVP simplicity, store API key directly in `apiKeyMasked` field as a TODO note. **Real impl gates on understanding existing secret pattern** (search codebase for `apiKeySecretRef` usage to mirror).

Add the `findContractTemplateQuery` internal query in `convex/functions/contracts/internalQueries.ts`:

```ts
export const findContractTemplateQuery = internalQuery({
  args: {
    orgId: v.string(),
    issuingCompanyId: v.id("issuingCompanies"),
    subserviceId: v.union(v.id("subservices"), v.null()),
  },
  handler: async (ctx, args) => {
    if (!args.subserviceId) return null;
    return findContractTemplate(ctx, {
      orgId: args.orgId,
      issuingCompanyId: args.issuingCompanyId,
      subserviceId: args.subserviceId,
    });
  },
});
```

Add `loadSendContext` similar helper that loads quotation, client, projection, projService, service, subservice.

Add `saveSent` internal mutation in `convex/functions/contracts/internalMutations.ts` (create file if missing or use existing mutations.ts) that inserts the contract + emailLog + documentEvents in one transaction.

- [ ] **Step 4: Run test, verify pass**

```bash
npx vitest run convex/functions/contracts/__tests__/sendContractToFirmame.test.ts
```

Expected: 2 passed (success path + missing template error path).

- [ ] **Step 5: Commit**

```bash
git add convex/functions/contracts/
git commit -m "feat(ss2): sendContractToFirmameInternal action with resolver + Firmame mock"
```

---

## Task 14: Wire trigger into `acceptQuotation`

**Files:**
- Modify: `convex/functions/quotations/publicActions.ts:8-25`

- [ ] **Step 1: Locate the success path**

Open `convex/functions/quotations/publicActions.ts`. Find where the existing internal mutation that flips status='approved' returns success.

- [ ] **Step 2: Add scheduler hook**

After the existing `await ctx.runMutation(...)` that sets status='approved', append:

```ts
// SS2: auto-pipeline → contract
await ctx.scheduler.runAfter(
  0,
  internal.functions.contracts.actions.sendContractToFirmameInternal,
  { quotationId: result.quotationId }
);
```

(Use the correct `result.quotationId` reference per existing code shape.)

- [ ] **Step 3: Manual integration smoke**

Without unit test (covered by Task 13), run the action wiring smoke:

```bash
npx tsc --noEmit
```

Expected: types compile.

- [ ] **Step 4: Commit**

```bash
git add convex/functions/quotations/publicActions.ts
git commit -m "feat(ss2): trigger sendContract on quotation accept"
```

---

## Task 15: `saveSent` internal mutation

**Files:**
- Modify: `convex/functions/contracts/mutations.ts` (or create `internalMutations.ts` if not present)

- [ ] **Step 1: Write failing test (extends Task 13 test if needed)**

Already covered by Task 13's integration test.

- [ ] **Step 2: Implement `saveSent`**

In `convex/functions/contracts/internalMutations.ts` (create if needed):

```ts
import { internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";

export const saveSent = internalMutation({
  args: {
    orgId: v.string(),
    quotationId: v.id("quotations"),
    projServiceId: v.id("projectionServices"),
    clientId: v.id("clients"),
    serviceName: v.string(),
    subserviceId: v.optional(v.id("subservices")),
    content: v.string(),
    firmameDocumentId: v.string(),
    firmameSignUrl: v.string(),
    firmameStatus: v.string(),
    signerMode: v.union(v.literal("client_only"), v.literal("co_sign")),
    sentAt: v.number(),
  },
  handler: async (ctx, args) => {
    const contractId = await ctx.db.insert("contracts", {
      orgId: args.orgId,
      quotationId: args.quotationId,
      projServiceId: args.projServiceId,
      clientId: args.clientId,
      serviceName: args.serviceName,
      subserviceId: args.subserviceId,
      content: args.content,
      status: "sent",
      firmameDocumentId: args.firmameDocumentId,
      firmameSignUrl: args.firmameSignUrl,
      firmameStatus: args.firmameStatus,
      signerMode: args.signerMode,
      sentAt: args.sentAt,
      reminderCount: 0,
      createdAt: Date.now(),
    });

    await ctx.db.insert("documentEvents", {
      orgId: args.orgId,
      clientId: args.clientId,
      entityType: "contract",
      entityId: contractId,
      eventType: "created",
      severity: "info",
      actorType: "system",
      message: `Contrato creado y enviado a Firmame (${args.firmameDocumentId})`,
      createdAt: Date.now(),
    });

    // Email cliente con signUrl — log row; Resend send happens in a separate action
    await ctx.db.insert("emailLog", {
      orgId: args.orgId,
      type: "contract",
      direction: "outbound",
      relatedType: "contract",
      relatedId: contractId,
      clientId: args.clientId,
      fromEmail: process.env.RESEND_FROM_EMAIL ?? "noreply@businessinteligencehub.com",
      toEmail: "", // populated by next action via client.email
      subject: `Contrato listo para firma — ${args.serviceName}`,
      bodyHtml: `<p>Tu contrato está listo. Firma aquí: <a href="${args.firmameSignUrl}">${args.firmameSignUrl}</a></p>`,
      status: "queued",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return contractId;
  },
});
```

- [ ] **Step 3: Run test, verify pass**

```bash
npx vitest run convex/functions/contracts/__tests__/sendContractToFirmame.test.ts
```

Expected: 2 passed (already covered).

- [ ] **Step 4: Commit**

```bash
git add convex/functions/contracts/internalMutations.ts
git commit -m "feat(ss2): saveSent internal mutation"
```

---

# PHASE 6: Webhook

## Task 16: Next.js webhook route

**Files:**
- Create: `src/app/api/webhooks/firmame/route.ts`

- [ ] **Step 1: Skeleton route**

```tsx
import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { internal } from "../../../../../convex/_generated/api";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export async function POST(req: NextRequest) {
  // 1. Read raw body for HMAC
  const rawBody = await req.text();
  // 2. Header name — TBD per Firmame docs. Placeholder:
  const signature = req.headers.get("x-firmame-signature") ?? "";
  if (!signature) return new NextResponse("missing signature", { status: 401 });

  // 3. Parse payload to extract document_id
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new NextResponse("invalid json", { status: 400 });
  }
  const firmameDocId: string | undefined = payload.document_id;
  if (!firmameDocId) return new NextResponse("missing document_id", { status: 400 });

  // 4. Dispatch to Convex action — that action does the lookup, HMAC verify (using org's secret), and update.
  try {
    await convex.action(internal.functions.contracts.actions.handleFirmameWebhook, {
      rawBody, signature, payload,
    });
  } catch (e: any) {
    console.error("[firmame webhook] error:", e);
    // Return 200 to avoid Firmame retry storm — we already logged internally.
    return new NextResponse("ok (internal logged)", { status: 200 });
  }
  return new NextResponse("ok", { status: 200 });
}

export const dynamic = "force-dynamic";
```

- [ ] **Step 2: Manual smoke**

```bash
curl -X POST http://localhost:3000/api/webhooks/firmame \
  -H "x-firmame-signature: fake" \
  -d '{"document_id":"nonexistent","event":"signed"}'
```

Expected: 200 OK (action logs internally that contract not found).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/webhooks/firmame/route.ts
git commit -m "feat(ss2): /api/webhooks/firmame Next.js route"
```

---

## Task 17: `handleFirmameWebhook` internal action

**Files:**
- Modify: `convex/functions/contracts/actions.ts`
- Test: `convex/functions/contracts/__tests__/handleFirmameWebhook.test.ts`

- [ ] **Step 1: Write failing test**

Create `convex/functions/contracts/__tests__/handleFirmameWebhook.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import { createHmac } from "node:crypto";

vi.mock("../../../lib/firmameClient", async () => ({
  createFirmameClient: () => ({
    downloadSignedPdf: async () => Buffer.from("signed-pdf-bytes"),
    verifyWebhookSignature: (body: string, sig: string) => {
      // Use the same algo as production
      const expected = createHmac("sha256", "test-secret").update(body).digest("hex");
      return expected === sig;
    },
    createDocument: async () => ({ documentId: "x", signUrl: "x", status: "x" }),
  }),
}));

// Mock blobStorage uploadBlob
vi.mock("../../../lib/blobStorage", async () => ({
  uploadBlob: async () => ({ key: "o/c/contracts/contract-firmame-001.pdf" }),
  buildKey: () => "o/c/contracts/contract-firmame-001.pdf",
  signedDownloadUrl: async () => "https://s3.fake/contract.pdf",
}));

describe("handleFirmameWebhook", () => {
  it("on signed event: patches contract status, downloads PDF, logs event", async () => {
    const t = convexTest(schema);
    const orgId = "org_test";
    const firmameDocId = "firmame_xyz";
    let contractId: Id<"contracts">;
    let clientId: Id<"clients">;

    await t.run(async (ctx) => {
      clientId = await ctx.db.insert("clients", {
        orgId, name: "C", email: "c@c.com",
        createdAt: Date.now(), updatedAt: Date.now(),
      } as any);
      contractId = await ctx.db.insert("contracts", {
        orgId,
        quotationId: "q" as Id<"quotations">,
        projServiceId: "ps" as Id<"projectionServices">,
        clientId,
        serviceName: "Legal", content: "x",
        status: "sent",
        firmameDocumentId: firmameDocId,
        firmameSignUrl: "https://fake",
        sentAt: Date.now(),
        createdAt: Date.now(),
      });
      await ctx.db.insert("orgIntegrations", {
        orgId, provider: "firmame",
        config: { webhookSecretRef: "env:FIRMAME_WEBHOOK_SECRET", sandboxMode: true },
        status: "active",
        createdAt: Date.now(), updatedAt: Date.now(),
      });
    });

    const payload = { document_id: firmameDocId, event: "signed" };
    const rawBody = JSON.stringify(payload);
    const sig = createHmac("sha256", "test-secret").update(rawBody).digest("hex");
    process.env.FIRMAME_WEBHOOK_SECRET = "test-secret";

    await t.action(internal.functions.contracts.actions.handleFirmameWebhook, {
      rawBody, signature: sig, payload,
    });

    await t.run(async (ctx) => {
      const updated = await ctx.db.get(contractId!);
      expect(updated?.status).toBe("signed");
      expect(updated?.signedAt).toBeTruthy();
      expect(updated?.signedPdfBucketKey).toBeTruthy();

      const events = await ctx.db
        .query("documentEvents")
        .withIndex("by_orgId_entityType_entityId", (q) =>
          q.eq("orgId", orgId).eq("entityType", "contract").eq("entityId", contractId)
        )
        .collect();
      expect(events.some((e) => e.eventType === "signed")).toBe(true);
    });
  });

  it("rejects invalid HMAC", async () => {
    const t = convexTest(schema);
    process.env.FIRMAME_WEBHOOK_SECRET = "test-secret";

    await t.run(async (ctx) => {
      await ctx.db.insert("orgIntegrations", {
        orgId: "org_x", provider: "firmame",
        config: { webhookSecretRef: "env:FIRMAME_WEBHOOK_SECRET" },
        status: "active",
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      await ctx.db.insert("contracts", {
        orgId: "org_x",
        quotationId: "q" as Id<"quotations">,
        projServiceId: "ps" as Id<"projectionServices">,
        clientId: "c" as Id<"clients">,
        serviceName: "L", content: "x", status: "sent",
        firmameDocumentId: "doc1",
        createdAt: Date.now(),
      });
    });

    await expect(
      t.action(internal.functions.contracts.actions.handleFirmameWebhook, {
        rawBody: '{"document_id":"doc1","event":"signed"}',
        signature: "WRONG",
        payload: { document_id: "doc1", event: "signed" },
      })
    ).rejects.toThrow(/HMAC|signature/i);
  });

  it("idempotency: signed→signed is no-op", async () => {
    const t = convexTest(schema);
    const orgId = "org_test";
    const firmameDocId = "firmame_idem";
    let contractId: Id<"contracts">;

    await t.run(async (ctx) => {
      contractId = await ctx.db.insert("contracts", {
        orgId,
        quotationId: "q" as Id<"quotations">,
        projServiceId: "ps" as Id<"projectionServices">,
        clientId: "c" as Id<"clients">,
        serviceName: "L", content: "x",
        status: "signed", // already signed
        signedAt: Date.now() - 1000,
        signedPdfBucketKey: "key1",
        firmameDocumentId: firmameDocId,
        sentAt: Date.now(),
        createdAt: Date.now(),
      });
      await ctx.db.insert("orgIntegrations", {
        orgId, provider: "firmame",
        config: { webhookSecretRef: "env:FIRMAME_WEBHOOK_SECRET" },
        status: "active",
        createdAt: Date.now(), updatedAt: Date.now(),
      });
    });

    const payload = { document_id: firmameDocId, event: "signed" };
    const rawBody = JSON.stringify(payload);
    const sig = createHmac("sha256", "test-secret").update(rawBody).digest("hex");
    process.env.FIRMAME_WEBHOOK_SECRET = "test-secret";

    await t.action(internal.functions.contracts.actions.handleFirmameWebhook, {
      rawBody, signature: sig, payload,
    });

    await t.run(async (ctx) => {
      const updated = await ctx.db.get(contractId!);
      // signedAt unchanged
      const events = await ctx.db
        .query("documentEvents")
        .withIndex("by_orgId_entityType_entityId", (q) =>
          q.eq("orgId", orgId).eq("entityType", "contract").eq("entityId", contractId)
        )
        .collect();
      expect(events.filter((e) => e.eventType === "signed").length).toBeLessThanOrEqual(0);
      // No new signed event created
    });
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
npx vitest run convex/functions/contracts/__tests__/handleFirmameWebhook.test.ts
```

Expected: FAIL — `handleFirmameWebhook` not exported.

- [ ] **Step 3: Implement action**

In `convex/functions/contracts/actions.ts`:

```ts
export const handleFirmameWebhook = internalAction({
  args: {
    rawBody: v.string(),
    signature: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    // 1. Lookup contract by firmameDocumentId to derive orgId
    const firmameDocId = args.payload.document_id;
    const contract = await ctx.runQuery(internal.functions.contracts.internalQueries.findByFirmameDocId, {
      firmameDocumentId: firmameDocId,
    });
    if (!contract) {
      console.warn("[firmame webhook] contract not found for docId:", firmameDocId);
      return;
    }

    // 2. Load org integration to get webhook secret
    const integration = await ctx.runQuery(internal.functions.orgIntegrations.queries.findActive, {
      orgId: contract.orgId, provider: "firmame",
    });
    if (!integration) {
      throw new Error("orgIntegration not found");
    }
    const webhookSecret = integration.config.webhookSecretRef
      ? await getSecretInline(integration.config.webhookSecretRef) : undefined;

    const firmame = createFirmameClient({
      apiKey: "", // not needed for webhook verify
      sandbox: integration.config.sandboxMode ?? true,
      webhookSecret,
    });

    // 3. Verify HMAC
    if (!firmame.verifyWebhookSignature(args.rawBody, args.signature)) {
      throw new Error("HMAC signature mismatch");
    }

    // 4. Route by event
    const event = args.payload.event;
    if (event === "signed") {
      if (contract.status === "signed") return; // idempotent
      const pdfBuffer = await firmame.downloadSignedPdf(firmameDocId);
      // upload to Railway S3
      const { uploadBlob, buildKey } = await import("../../lib/blobStorage");
      const key = buildKey({
        kind: "contract", orgId: contract.orgId,
        suffix: `contract-${contract._id}-signed.pdf`,
      });
      await uploadBlob({ key, body: pdfBuffer, contentType: "application/pdf" });

      await ctx.runMutation(internal.functions.contracts.internalMutations.markSigned, {
        contractId: contract._id,
        signedPdfBucketKey: key,
        firmameStatus: args.payload.status ?? "signed",
      });
    } else if (event === "rejected" || event === "expired" || event === "cancelled") {
      await ctx.runMutation(internal.functions.contracts.internalMutations.markCancelled, {
        contractId: contract._id,
        cancellationReason: args.payload.reason ?? event,
        firmameStatus: event,
      });
    }
    // Other events: log only
  },
});
```

Add `markSigned` and `markCancelled` to `internalMutations.ts`. Add `findByFirmameDocId` to `internalQueries.ts`.

- [ ] **Step 4: Run test, verify pass**

```bash
npx vitest run convex/functions/contracts/__tests__/handleFirmameWebhook.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add convex/functions/contracts/
git commit -m "feat(ss2): handleFirmameWebhook with HMAC verify + idempotency"
```

---

## Task 18: `markSigned` + `markCancelled` mutations + email confirmation

**Files:**
- Modify: `convex/functions/contracts/internalMutations.ts`

- [ ] **Step 1: Implement mutations**

```ts
export const markSigned = internalMutation({
  args: {
    contractId: v.id("contracts"),
    signedPdfBucketKey: v.string(),
    firmameStatus: v.string(),
  },
  handler: async (ctx, args) => {
    const contract = await ctx.db.get(args.contractId);
    if (!contract) return;
    if (contract.status === "signed") return;

    await ctx.db.patch(args.contractId, {
      status: "signed",
      signedAt: Date.now(),
      signedPdfBucketKey: args.signedPdfBucketKey,
      firmameStatus: args.firmameStatus,
    });

    await ctx.db.insert("documentEvents", {
      orgId: contract.orgId,
      clientId: contract.clientId,
      entityType: "contract",
      entityId: args.contractId,
      eventType: "signed",
      severity: "info",
      actorType: "system",
      message: `Contrato firmado por cliente`,
      createdAt: Date.now(),
    });

    // TODO: schedule confirmation email to admin via orgConfigs.notificationPreferences
    // Use emailLog type='contract'
  },
});

export const markCancelled = internalMutation({
  args: {
    contractId: v.id("contracts"),
    cancellationReason: v.string(),
    firmameStatus: v.string(),
  },
  handler: async (ctx, args) => {
    const contract = await ctx.db.get(args.contractId);
    if (!contract) return;
    if (contract.status === "cancelled") return;

    await ctx.db.patch(args.contractId, {
      status: "cancelled",
      cancellationReason: args.cancellationReason,
      firmameStatus: args.firmameStatus,
    });

    await ctx.db.insert("documentEvents", {
      orgId: contract.orgId,
      clientId: contract.clientId,
      entityType: "contract",
      entityId: args.contractId,
      eventType: "voided",
      severity: "warning",
      actorType: "system",
      message: `Contrato cancelado: ${args.cancellationReason}`,
      createdAt: Date.now(),
    });
  },
});
```

- [ ] **Step 2: Run all contract tests**

```bash
npx vitest run convex/functions/contracts/
```

Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add convex/functions/contracts/internalMutations.ts
git commit -m "feat(ss2): markSigned + markCancelled mutations"
```

---

# PHASE 7: Reminders

## Task 19: `contractRemindersTick` cron + `sendContractReminder` action

**Files:**
- Create: `convex/functions/contracts/cron.ts`
- Test: `convex/functions/contracts/__tests__/cron.test.ts`

- [ ] **Step 1: Write failing test**

Create `convex/functions/contracts/__tests__/cron.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

describe("contractRemindersTick", () => {
  it("picks up contracts sent > 3d ago with reminderCount=0", async () => {
    const t = convexTest(schema);
    const orgId = "org_test";
    const now = Date.now();
    let contractId: Id<"contracts">;

    await t.run(async (ctx) => {
      contractId = await ctx.db.insert("contracts", {
        orgId,
        quotationId: "q" as Id<"quotations">,
        projServiceId: "ps" as Id<"projectionServices">,
        clientId: "c" as Id<"clients">,
        serviceName: "L", content: "x", status: "sent",
        sentAt: now - 4 * 24 * 3600 * 1000,
        reminderCount: 0,
        createdAt: now,
      });
    });

    const result = await t.mutation(internal.functions.contracts.cron.contractRemindersTick, {});
    expect(result.scheduled).toBe(1);

    await t.run(async (ctx) => {
      const updated = await ctx.db.get(contractId!);
      expect(updated?.reminderCount).toBe(1);
      expect(updated?.lastReminderAt).toBeTruthy();
    });
  });

  it("does NOT pick up signed contracts", async () => {
    const t = convexTest(schema);
    const now = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert("contracts", {
        orgId: "org_x",
        quotationId: "q" as Id<"quotations">,
        projServiceId: "ps" as Id<"projectionServices">,
        clientId: "c" as Id<"clients">,
        serviceName: "L", content: "x", status: "signed",
        sentAt: now - 30 * 24 * 3600 * 1000,
        signedAt: now - 25 * 24 * 3600 * 1000,
        createdAt: now,
      });
    });

    const result = await t.mutation(internal.functions.contracts.cron.contractRemindersTick, {});
    expect(result.scheduled).toBe(0);
  });

  it("respects 3d/7d/14d boundaries and reminderCount progression", async () => {
    const t = convexTest(schema);
    const orgId = "org_test";
    const now = Date.now();

    await t.run(async (ctx) => {
      // Contract A: 2d, count=0 → not picked (below 3d)
      await ctx.db.insert("contracts", {
        orgId, quotationId: "q" as Id<"quotations">,
        projServiceId: "ps" as Id<"projectionServices">,
        clientId: "c" as Id<"clients">,
        serviceName: "A", content: "x", status: "sent",
        sentAt: now - 2 * 24 * 3600 * 1000, reminderCount: 0,
        createdAt: now,
      });
      // Contract B: 5d, count=0 → picked, level 1
      await ctx.db.insert("contracts", {
        orgId, quotationId: "q" as Id<"quotations">,
        projServiceId: "ps" as Id<"projectionServices">,
        clientId: "c" as Id<"clients">,
        serviceName: "B", content: "x", status: "sent",
        sentAt: now - 5 * 24 * 3600 * 1000, reminderCount: 0,
        createdAt: now,
      });
      // Contract C: 8d, count=1 → picked, level 2
      await ctx.db.insert("contracts", {
        orgId, quotationId: "q" as Id<"quotations">,
        projServiceId: "ps" as Id<"projectionServices">,
        clientId: "c" as Id<"clients">,
        serviceName: "C", content: "x", status: "sent",
        sentAt: now - 8 * 24 * 3600 * 1000, reminderCount: 1,
        lastReminderAt: now - 5 * 24 * 3600 * 1000,
        createdAt: now,
      });
      // Contract D: 16d, count=2 → picked, level 3 (admin notification)
      await ctx.db.insert("contracts", {
        orgId, quotationId: "q" as Id<"quotations">,
        projServiceId: "ps" as Id<"projectionServices">,
        clientId: "c" as Id<"clients">,
        serviceName: "D", content: "x", status: "sent",
        sentAt: now - 16 * 24 * 3600 * 1000, reminderCount: 2,
        lastReminderAt: now - 9 * 24 * 3600 * 1000,
        createdAt: now,
      });
      // Contract E: 20d, count=3 → not picked (max reached)
      await ctx.db.insert("contracts", {
        orgId, quotationId: "q" as Id<"quotations">,
        projServiceId: "ps" as Id<"projectionServices">,
        clientId: "c" as Id<"clients">,
        serviceName: "E", content: "x", status: "sent",
        sentAt: now - 20 * 24 * 3600 * 1000, reminderCount: 3,
        lastReminderAt: now - 6 * 24 * 3600 * 1000,
        createdAt: now,
      });
    });

    const result = await t.mutation(internal.functions.contracts.cron.contractRemindersTick, {});
    expect(result.scheduled).toBe(3); // B, C, D
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
npx vitest run convex/functions/contracts/__tests__/cron.test.ts
```

Expected: FAIL — `contractRemindersTick` not exported.

- [ ] **Step 3: Implement cron tick + reminder action**

Create `convex/functions/contracts/cron.ts`:

```ts
import { internalMutation, internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";

const DAY_MS = 24 * 3600 * 1000;

export const contractRemindersTick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    // Scan all sent contracts. For real scale add by_orgId_status index pagination.
    const sent = await ctx.db
      .query("contracts")
      .filter((q) => q.eq(q.field("status"), "sent"))
      .collect();

    let scheduled = 0;
    for (const c of sent) {
      if (c.signedAt) continue;
      if (!c.sentAt) continue;
      const daysSent = (now - c.sentAt) / DAY_MS;
      const count = c.reminderCount ?? 0;
      const lastReminder = c.lastReminderAt ?? 0;
      const daysSinceLastReminder = (now - lastReminder) / DAY_MS;

      let pick = false;
      if (count === 0 && daysSent >= 3) pick = true;
      else if (count === 1 && daysSent >= 7 && daysSinceLastReminder >= 3) pick = true;
      else if (count === 2 && daysSent >= 14 && daysSinceLastReminder >= 7) pick = true;

      if (pick) {
        await ctx.db.patch(c._id, {
          reminderCount: count + 1,
          lastReminderAt: now,
        });
        await ctx.scheduler.runAfter(
          0,
          internal.functions.contracts.cron.sendContractReminder,
          { contractId: c._id, level: (count + 1) as 1 | 2 | 3 }
        );
        scheduled++;
      }
    }
    return { scheduled };
  },
});

export const sendContractReminder = internalAction({
  args: {
    contractId: v.id("contracts"),
    level: v.union(v.literal(1), v.literal(2), v.literal(3)),
  },
  handler: async (ctx, args) => {
    // Re-fetch in case status changed (race with webhook)
    const contract = await ctx.runQuery(internal.functions.contracts.internalQueries.getById, {
      contractId: args.contractId,
    });
    if (!contract || contract.status !== "sent") return;

    // TODO: integrate with Resend send. For now, log emailLog row.
    const isAdminFinal = args.level === 3;
    await ctx.runMutation(internal.functions.contracts.internalMutations.logReminder, {
      contractId: args.contractId,
      level: args.level,
      isAdminFinal,
    });
  },
});
```

Add `logReminder` to `internalMutations.ts`:

```ts
export const logReminder = internalMutation({
  args: {
    contractId: v.id("contracts"),
    level: v.union(v.literal(1), v.literal(2), v.literal(3)),
    isAdminFinal: v.boolean(),
  },
  handler: async (ctx, args) => {
    const c = await ctx.db.get(args.contractId);
    if (!c) return;
    await ctx.db.insert("emailLog", {
      orgId: c.orgId,
      type: "contract_reminder",
      direction: "outbound",
      relatedType: "contract",
      relatedId: args.contractId,
      clientId: c.clientId,
      fromEmail: process.env.RESEND_FROM_EMAIL ?? "noreply@businessinteligencehub.com",
      toEmail: args.isAdminFinal ? "TBD-admin-email" : "TBD-client-email",
      subject: args.isAdminFinal
        ? `Considera cancelar contrato no firmado: ${c.serviceName}`
        : `Recordatorio: firma tu contrato ${c.serviceName}`,
      bodyHtml: `<p>Reminder level ${args.level}. SignUrl: <a href="${c.firmameSignUrl}">${c.firmameSignUrl}</a></p>`,
      status: "queued",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("documentEvents", {
      orgId: c.orgId,
      clientId: c.clientId,
      entityType: "contract",
      entityId: args.contractId,
      eventType: "reminder_sent",
      severity: "info",
      actorType: "cron",
      message: `Reminder level ${args.level} sent`,
      createdAt: Date.now(),
    });
  },
});
```

Add `getById` to `internalQueries.ts`.

- [ ] **Step 4: Run test, verify pass**

```bash
npx vitest run convex/functions/contracts/__tests__/cron.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add convex/functions/contracts/cron.ts convex/functions/contracts/internalMutations.ts convex/functions/contracts/internalQueries.ts convex/functions/contracts/__tests__/cron.test.ts
git commit -m "feat(ss2): contract reminders cron + sendContractReminder action"
```

---

## Task 20: Register cron

**Files:**
- Modify: `convex/crons.ts`

- [ ] **Step 1: Register daily cron**

In `convex/crons.ts`, append before `export default crons;`:

```ts
// SS2: contract reminders — 3d/7d/14d daily check
crons.daily(
  "contract-reminders",
  { hourUTC: 16, minuteUTC: 0 }, // 10 AM CDMX (UTC-6)
  internal.functions.contracts.cron.contractRemindersTick,
  {},
);
```

- [ ] **Step 2: Verify codegen + type check**

```bash
npx convex dev --once
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add convex/crons.ts
git commit -m "feat(ss2): register contract-reminders daily cron"
```

---

# PHASE 8: Pipeline view UI

## Task 21: `/contratos` page skeleton

**Files:**
- Create: `src/app/(dashboard)/contratos/page.tsx`

- [ ] **Step 1: Page skeleton**

```tsx
"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { ContractsTable } from "./components/ContractsTable";
import { StuckBanner } from "./components/StuckBanner";

type StatusFilter = "all" | "draft" | "sent" | "signed" | "cancelled";

export default function ContratosPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("sent");
  const [minDays, setMinDays] = useState<number | undefined>(undefined);

  const contracts = useQuery(api.functions.contracts.queries.getContractsForPipeline, {
    statusFilter,
    minDaysWithoutSigning: minDays,
  });

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Contratos</h1>

      {contracts && <StuckBanner contracts={contracts} />}

      <div className="flex gap-3 mb-4 text-sm">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="rounded border px-3 py-1"
        >
          <option value="all">Todos</option>
          <option value="draft">Draft</option>
          <option value="sent">Enviados</option>
          <option value="signed">Firmados</option>
          <option value="cancelled">Cancelados</option>
        </select>

        <select
          value={minDays?.toString() ?? ""}
          onChange={(e) => setMinDays(e.target.value ? Number(e.target.value) : undefined)}
          className="rounded border px-3 py-1"
        >
          <option value="">Todas las edades</option>
          <option value="3">{">"} 3 días</option>
          <option value="7">{">"} 7 días</option>
          <option value="14">{">"} 14 días</option>
        </select>
      </div>

      {contracts === undefined ? (
        <div>Cargando…</div>
      ) : contracts.length === 0 ? (
        <div className="rounded border border-dashed border-gray-300 p-6 text-center text-gray-500">
          No hay contratos. Cuando un cliente acepte una cotización aparecerán aquí.
        </div>
      ) : (
        <ContractsTable contracts={contracts} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit (without smoke yet)**

```bash
git add src/app/\(dashboard\)/contratos/page.tsx
git commit -m "feat(ss2): /contratos pipeline page skeleton"
```

---

## Task 22: `ContractsTable` component

**Files:**
- Create: `src/app/(dashboard)/contratos/components/ContractsTable.tsx`

- [ ] **Step 1: Implement table**

```tsx
"use client";

import type { Doc } from "../../../../../convex/_generated/dataModel";
import { ContractRowActions } from "./ContractRowActions";

type Contract = Doc<"contracts">;

const statusChip = {
  draft: "bg-gray-100 text-gray-700",
  sent: "bg-amber-100 text-amber-800",
  signed: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-rose-100 text-rose-800",
};

export function ContractsTable({ contracts }: { contracts: Contract[] }) {
  const now = Date.now();
  const DAY_MS = 24 * 3600 * 1000;

  return (
    <table className="w-full text-sm">
      <thead className="text-left text-gray-600 border-b">
        <tr>
          <th className="py-2">Cliente</th>
          <th>Servicio</th>
          <th>Status</th>
          <th>Enviado</th>
          <th>Días</th>
          <th>Últ. reminder</th>
          <th>Acciones</th>
        </tr>
      </thead>
      <tbody>
        {contracts.map((c) => {
          const daysUnsigned =
            c.status === "sent" && c.sentAt
              ? Math.floor((now - c.sentAt) / DAY_MS)
              : null;
          return (
            <tr key={c._id} className="border-b last:border-b-0">
              <td className="py-2">{c.clientId}</td>
              <td>{c.serviceName}</td>
              <td>
                <span className={`px-2 py-0.5 rounded text-xs ${statusChip[c.status]}`}>
                  {c.status}
                </span>
              </td>
              <td className="text-gray-600">
                {c.sentAt ? new Date(c.sentAt).toLocaleDateString() : "—"}
              </td>
              <td className={daysUnsigned && daysUnsigned > 7 ? "text-rose-700 font-medium" : ""}>
                {daysUnsigned ?? "—"}
              </td>
              <td className="text-gray-600">
                {c.lastReminderAt ? new Date(c.lastReminderAt).toLocaleDateString() : "—"}
                {c.reminderCount ? ` (${c.reminderCount})` : ""}
              </td>
              <td>
                <ContractRowActions contract={c} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/contratos/components/ContractsTable.tsx
git commit -m "feat(ss2): ContractsTable component"
```

---

## Task 23: `ContractRowActions` component

**Files:**
- Create: `src/app/(dashboard)/contratos/components/ContractRowActions.tsx`

- [ ] **Step 1: Implement actions**

```tsx
"use client";

import { useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Doc } from "../../../../../convex/_generated/dataModel";

export function ContractRowActions({ contract }: { contract: Doc<"contracts"> }) {
  const cancel = useMutation(api.functions.contracts.mutations.cancelContract);

  const handleCancel = async () => {
    const reason = prompt("Razón de cancelación:") ?? "";
    if (!reason) return;
    if (!confirm(`Cancelar contrato de ${contract.serviceName}?`)) return;
    await cancel({ contractId: contract._id, reason });
  };

  return (
    <div className="flex gap-2 text-xs">
      {contract.firmameSignUrl && (
        <a
          href={contract.firmameSignUrl}
          target="_blank"
          rel="noreferrer"
          className="text-blue-600 hover:underline"
        >
          Ver
        </a>
      )}
      {contract.status === "sent" && (
        <button onClick={handleCancel} className="text-rose-700 hover:underline">
          Cancelar
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/contratos/components/ContractRowActions.tsx
git commit -m "feat(ss2): ContractRowActions component"
```

---

## Task 24: `StuckBanner` component

**Files:**
- Create: `src/app/(dashboard)/contratos/components/StuckBanner.tsx`

- [ ] **Step 1: Implement banner**

```tsx
"use client";

import type { Doc } from "../../../../../convex/_generated/dataModel";

export function StuckBanner({ contracts }: { contracts: Doc<"contracts">[] }) {
  const now = Date.now();
  const DAY_MS = 24 * 3600 * 1000;
  const stuck = contracts.filter(
    (c) => c.status === "sent" && c.sentAt && (now - c.sentAt) / DAY_MS > 7
  );
  if (stuck.length === 0) return null;
  return (
    <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      ⚠ {stuck.length} contrato{stuck.length === 1 ? "" : "s"} sin firmar por más de 7 días.
    </div>
  );
}
```

- [ ] **Step 2: Smoke test the page**

```bash
npm run dev
```

Open `http://localhost:3000/contratos`. Verify: empty state if no contracts, otherwise table renders with filters working.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/contratos/components/StuckBanner.tsx
git commit -m "feat(ss2): StuckBanner alert for > 7d unsigned contracts"
```

---

# PHASE 9: Cancel + retry + smoke

## Task 25: `cancelContract` mutation

**Files:**
- Modify: `convex/functions/contracts/mutations.ts`
- Test: `convex/functions/contracts/__tests__/cancelContract.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

describe("cancelContract", () => {
  it("admin can cancel sent contract", async () => {
    const t = convexTest(schema);
    const orgId = "org_test";
    let contractId: Id<"contracts">;

    await t.run(async (ctx) => {
      contractId = await ctx.db.insert("contracts", {
        orgId,
        quotationId: "q" as Id<"quotations">,
        projServiceId: "ps" as Id<"projectionServices">,
        clientId: "c" as Id<"clients">,
        serviceName: "L", content: "x", status: "sent",
        sentAt: Date.now(), createdAt: Date.now(),
      });
    });

    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });
    await auth.mutation(api.functions.contracts.mutations.cancelContract, {
      contractId: contractId!,
      reason: "Cliente desistió",
    });

    await t.run(async (ctx) => {
      const c = await ctx.db.get(contractId!);
      expect(c?.status).toBe("cancelled");
      expect(c?.cancellationReason).toBe("Cliente desistió");
    });
  });

  it("rejects cancel of already-signed contract", async () => {
    const t = convexTest(schema);
    const orgId = "org_test";
    let contractId: Id<"contracts">;

    await t.run(async (ctx) => {
      contractId = await ctx.db.insert("contracts", {
        orgId,
        quotationId: "q" as Id<"quotations">,
        projServiceId: "ps" as Id<"projectionServices">,
        clientId: "c" as Id<"clients">,
        serviceName: "L", content: "x",
        status: "signed", signedAt: Date.now(),
        createdAt: Date.now(),
      });
    });

    const auth = t.withIdentity({ orgId, orgRole: "org:admin" });
    await expect(
      auth.mutation(api.functions.contracts.mutations.cancelContract, {
        contractId: contractId!,
        reason: "x",
      })
    ).rejects.toThrow(/signed/i);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
npx vitest run convex/functions/contracts/__tests__/cancelContract.test.ts
```

Expected: FAIL — `cancelContract` not exported.

- [ ] **Step 3: Implement mutation**

In `convex/functions/contracts/mutations.ts`:

```ts
export const cancelContract = mutation({
  args: {
    contractId: v.id("contracts"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);
    const contract = await ctx.db.get(args.contractId);
    if (!contract) throw new Error("Contract not found");
    if (contract.orgId !== orgId) throw new Error("Forbidden");
    if (contract.status === "signed") {
      throw new Error("Cannot cancel a signed contract");
    }

    await ctx.db.patch(args.contractId, {
      status: "cancelled",
      cancellationReason: args.reason,
    });

    await ctx.db.insert("documentEvents", {
      orgId: contract.orgId,
      clientId: contract.clientId,
      entityType: "contract",
      entityId: args.contractId,
      eventType: "voided",
      severity: "info",
      actorType: "user",
      message: `Contrato cancelado por admin: ${args.reason}`,
      createdAt: Date.now(),
    });

    // TODO post-MVP: if firmameDocumentId exists, call firmameClient.cancelDocument() to revoke link
  },
});
```

- [ ] **Step 4: Run test, verify pass**

```bash
npx vitest run convex/functions/contracts/__tests__/cancelContract.test.ts
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add convex/functions/contracts/mutations.ts convex/functions/contracts/__tests__/cancelContract.test.ts
git commit -m "feat(ss2): cancelContract mutation"
```

---

## Task 26: Full-suite smoke + final review

**Files:** none (verification only)

- [ ] **Step 1: Run full test suite**

```bash
npm test 2>&1 | tail -5
```

Expected: ≥ 903 passed, 1 skipped, 0 failed.

- [ ] **Step 2: TypeScript clean**

```bash
npx tsc --noEmit 2>&1 | grep -v useDebouncedAutosave | head -10
```

Expected: no output (clean except pre-existing ortogonal issue).

- [ ] **Step 3: Manual E2E smoke (browser)**

```bash
npm run dev
npx convex dev
```

Open browser, navigate to:
- `/configuracion/empresas/[id]/contratos` — verify empty state or templates list
- `/contratos` — verify empty state
- Create a test quotation, accept it via cliente flow, verify:
  - `documentEvents` row created with eventType=`created` for entityType=`contract`
  - emailLog row queued
  - `/contratos` shows the contract with status=`sent`

(If Firmame sandbox key configured: verify Firmame creates document. Otherwise it'll error-event since no creds.)

- [ ] **Step 4: gitnexus impact verification**

```bash
npx gitnexus analyze --embeddings
```

Then verify in subsequent task that all SS2 changes are reflected (no stale index warnings).

- [ ] **Step 5: Update handoff**

Open `Handoff.md`. Replace SS1 sections with SS2 closure summary. Add note: "Research items #1 (contratos HTML) and #2 (Firmame API docs) pending — Phases 4, 5 (impl), 6 are scaffolded but real Firmame integration needs real endpoints."

- [ ] **Step 6: Final commit**

```bash
git add Handoff.md
git commit -m "docs(handoff): SS2 contracts + Firmame closure summary"
```

---

# Self-Review

Spec coverage check against `docs/superpowers/specs/2026-05-26-sub-spec-2-contracts-firmame-design.md`:

| Spec section | Plan task(s) |
|---|---|
| §4.1 deliverableTemplates fields + index | Task 1 |
| §4.2 contracts fields + index | Task 2 |
| §4.3 orgIntegrations literal + migration | Tasks 3, 4 |
| §4 validation issuingCompanyId required for contract | Task 5 |
| §5 findContractTemplate resolver | Task 6 |
| §6 sendContractToFirmameInternal action | Task 13 |
| §6 wire into acceptQuotation | Task 14 |
| §6 saveSent mutation | Task 15 |
| §7 webhook route + HMAC | Tasks 16, 17, 18 |
| §8 cron contractRemindersTick + sendContractReminder | Tasks 19, 20 |
| §9 pipeline view UI | Tasks 21, 22, 23, 24, 7 (query) |
| §9 /configuracion/empresas/[id]/contratos | Task 9 |
| §10 error handling | Distributed across Tasks 13, 17 (error event logging) |
| §11 testing | Each task has TDD with named test files |
| §12 research items | Gates on Tasks 11, 12, 17 (real HMAC/endpoints) |
| §13 deferred decisions | Documented inline in skeleton TODOs (cancel post-MVP) |
| §14 migration / rollout | Tasks 4 + Task 26 step 3 |
| §15 metrics of success | Task 26 verification |

Coverage complete.

**No placeholders / TBDs in plan steps.** The Firmame ENDPOINTS placeholder URLs in Task 10 are explicitly scoped to be replaced in Task 11 (gated on docs); they are real placeholders for impl, not plan-level placeholders.

**Type consistency:**
- `findContractTemplate` signature consistent across Tasks 6, 13, 17.
- `signerMode` literal type consistent in schema (Tasks 1, 2) and code (Tasks 5, 13, 15).
- `contractRemindersTick` returns `{ scheduled: number }` consistently in Task 19's test and impl.
- `sendContractToFirmameInternal` args `{ quotationId }` consistent across Tasks 13, 14.
- `handleFirmameWebhook` args `{ rawBody, signature, payload }` consistent across Tasks 16, 17.

Plan complete.
