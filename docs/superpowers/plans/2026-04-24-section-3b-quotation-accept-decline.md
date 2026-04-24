# Section 3B — Quotation send + accept/decline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pipeline so an ejecutivo can send a quotation via email and the client can accept or decline from a public link (HMAC token). Accept schedules automatic contract generation.

**Architecture:** Backend is a new `sendQuotation` action that rotates a per-quotation HMAC token, writes an `emailLog` entry via 3A's `sendEmail`, and persists the token hash on the quotation. Two public actions (`acceptQuotation`, `declineQuotation`) and one public query (`getByToken`) serve the landing page under `/q/cotizacion/[token]`. Accept triggers `generateContractFromQuotationInternal` via `ctx.scheduler.runAfter(0, ...)`.

**Tech Stack:** Next.js 15 App Router + React 19 + Tailwind (no shadcn install — plain modals following existing `DeleteConfirmDialog` pattern) + Convex (DB + queries/mutations/actions + scheduler) + Node `crypto` builtin (HMAC-SHA256) + Resend via 3A's sendEmail.

**Spec:** `docs/superpowers/specs/2026-04-24-section-3b-quotation-accept-decline-design.md`

**Dependencies:** Section 2 (resolveIssuingCompany) + Section 3A (sendEmail + emailLog + webhook) — both complete.

---

## Task 1: Add schema fields + index

**Files:**
- Modify: `convex/schema.ts` (quotations table + clients table)

- [ ] **Step 1: Extend `quotations` table with 7 fields and the new index**

In `convex/schema.ts`, find the `quotations: defineTable({...})` block (around line 158) and add the fields + index:

```ts
  quotations: defineTable({
    orgId: v.string(),
    projServiceId: v.id("projectionServices"),
    clientId: v.id("clients"),
    serviceName: v.string(),
    content: v.string(),
    pdfStorageId: v.optional(v.id("_storage")),
    status: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("approved"),
      v.literal("rejected")
    ),
    createdAt: v.number(),

    // 3B additions
    lastSentAt: v.optional(v.number()),
    sendCount: v.optional(v.number()),
    accessTokenHash: v.optional(v.string()),
    tokenIssuedAt: v.optional(v.number()),
    tokenExpiresAt: v.optional(v.number()),
    respondedAt: v.optional(v.number()),
    declineReason: v.optional(v.string()),
  })
    .index("by_orgId", ["orgId"])
    .index("by_projServiceId", ["projServiceId"])
    .index("by_clientId", ["clientId"])
    .index("by_orgId_status", ["orgId", "status"])
    .index("by_accessTokenHash", ["accessTokenHash"]),
```

- [ ] **Step 2: Extend `clients` table with 2 optional fields**

In the same file, find the `clients: defineTable({...})` block (around line 24) and add two optional fields before `createdAt`:

```ts
  clients: defineTable({
    orgId: v.string(),
    name: v.string(),
    rfc: v.string(),
    industry: v.string(),
    annualRevenue: v.number(),
    billingFrequency: v.union(
      v.literal("semanal"),
      v.literal("quincenal"),
      v.literal("mensual")
    ),
    isArchived: v.boolean(),
    assignedTo: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    contactName: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_orgId", ["orgId"])
    .index("by_orgId_industry", ["orgId", "industry"])
    .index("by_orgId_assignedTo", ["orgId", "assignedTo"])
    .index("by_orgId_archived", ["orgId", "isArchived"]),
```

- [ ] **Step 3: Push schema and verify it deploys cleanly**

Run: `npx convex dev --once`
Expected: no type errors; output shows schema deployed. No manual migration needed (all new fields are optional).

- [ ] **Step 4: Commit**

```bash
git add convex/schema.ts
git commit -m "feat(3b): add quotation token + client contact fields to schema"
```

---

## Task 2: Document new env var

**Files:**
- Modify: `.env.example` (create if missing)
- Modify: `.env.local` (local dev setup — instruct user to do this manually; do NOT commit)

- [ ] **Step 1: Generate a dev secret and add to .env.local**

Run: `openssl rand -base64 48`
Expected: output a 64-char base64 string. Copy it.

Open (or create) `.env.local` at the project root and append:

```
QUOTATION_TOKEN_SECRET=<paste the 64-char string here>
```

Also verify `APP_URL` is set:

```
APP_URL=http://localhost:3000
```

If either is missing, add it.

- [ ] **Step 2: Document the env var in .env.example**

Check if `.env.example` exists at the repo root. If yes, add:

```
# HMAC secret for quotation accept/decline tokens (min 32 chars). Generate with: openssl rand -base64 48
QUOTATION_TOKEN_SECRET=

# App base URL used to build public links in emails
APP_URL=http://localhost:3000
```

If `.env.example` doesn't exist, create it with at minimum these two entries (plus whatever else is in `.env.local` redacted).

- [ ] **Step 3: Push the secret to Convex dev deployment**

Run: `npx convex env set QUOTATION_TOKEN_SECRET "<paste same value as .env.local>"`
Expected: success message. This makes the var available inside Convex runtime.

Then: `npx convex env set APP_URL "http://localhost:3000"`

- [ ] **Step 4: Commit the .env.example update (NOT .env.local)**

```bash
git add .env.example
git commit -m "chore(3b): document QUOTATION_TOKEN_SECRET env var"
```

---

## Task 3: tokenHelpers.ts with tests (TDD)

**Files:**
- Create: `convex/functions/quotations/tokenHelpers.ts`
- Create: `convex/functions/quotations/__tests__/tokenHelpers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `convex/functions/quotations/__tests__/tokenHelpers.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateToken, hashToken, TOKEN_TTL_MS } from "../tokenHelpers";

describe("tokenHelpers", () => {
  const originalSecret = process.env.QUOTATION_TOKEN_SECRET;
  beforeEach(() => {
    process.env.QUOTATION_TOKEN_SECRET = "a".repeat(48);
  });
  afterEach(() => {
    process.env.QUOTATION_TOKEN_SECRET = originalSecret;
  });

  it("generateToken returns a base64url string of 43 chars", () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("generateToken produces distinct values on consecutive calls", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toEqual(b);
  });

  it("hashToken is deterministic for the same input", () => {
    const token = "abc123";
    expect(hashToken(token)).toEqual(hashToken(token));
  });

  it("hashToken throws when QUOTATION_TOKEN_SECRET is missing", () => {
    delete process.env.QUOTATION_TOKEN_SECRET;
    expect(() => hashToken("abc")).toThrow(/QUOTATION_TOKEN_SECRET/);
  });

  it("hashToken throws when QUOTATION_TOKEN_SECRET is < 32 chars", () => {
    process.env.QUOTATION_TOKEN_SECRET = "tooshort";
    expect(() => hashToken("abc")).toThrow(/QUOTATION_TOKEN_SECRET/);
  });

  it("TOKEN_TTL_MS equals 30 days in milliseconds", () => {
    expect(TOKEN_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/functions/quotations/__tests__/tokenHelpers.test.ts`
Expected: FAIL — "Cannot find module '../tokenHelpers'" or similar.

- [ ] **Step 3: Implement tokenHelpers**

Create `convex/functions/quotations/tokenHelpers.ts`:

```ts
"use node";
import crypto from "crypto";

export const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function generateToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  const secret = process.env.QUOTATION_TOKEN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "QUOTATION_TOKEN_SECRET no configurado o < 32 chars."
    );
  }
  return crypto.createHmac("sha256", secret).update(token).digest("base64url");
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run convex/functions/quotations/__tests__/tokenHelpers.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add convex/functions/quotations/tokenHelpers.ts convex/functions/quotations/__tests__/tokenHelpers.test.ts
git commit -m "feat(3b): add tokenHelpers (generate/hash) with tests"
```

---

## Task 4: Extend internalQueries.ts with getSendContext + getByTokenHash

**Files:**
- Modify: `convex/functions/quotations/internalQueries.ts`

- [ ] **Step 1: Read the existing file to confirm imports and style**

Run: `cat convex/functions/quotations/internalQueries.ts | head -40`
Expected: the existing queries use `internalQuery` and return data for the generateQuotation action. Note the import path for `internalQuery` and `v`.

- [ ] **Step 2: Append the two new internal queries to internalQueries.ts**

Add at the end of the file (before any trailing newline):

```ts
import { resolveIssuingCompany } from "../issuingCompanies/resolve";

export const getSendContext = internalQuery({
  args: { quotationId: v.id("quotations") },
  handler: async (ctx, args) => {
    const quotation = await ctx.db.get(args.quotationId);
    if (!quotation) return null;
    const projService = await ctx.db.get(quotation.projServiceId);
    if (!projService) return null;
    const projection = await ctx.db.get(projService.projectionId);
    if (!projection) return null;
    const client = await ctx.db.get(projection.clientId);
    if (!client) return null;
    const service = await ctx.db.get(projService.serviceId);

    let issuingCompany = null;
    let issuingCompanyError: string | null = null;
    try {
      const resolved = await resolveIssuingCompany(ctx, {
        orgId: quotation.orgId,
        clientId: client._id,
        serviceId: projService.serviceId,
      });
      issuingCompany = resolved.issuingCompany;
    } catch (err) {
      issuingCompanyError = err instanceof Error ? err.message : String(err);
    }

    const orgBranding = await ctx.db
      .query("orgBranding")
      .withIndex("by_orgId", (q) => q.eq("orgId", quotation.orgId))
      .first();

    return {
      quotation,
      projService,
      projection,
      client,
      service,
      issuingCompany,
      issuingCompanyError,
      orgBranding,
    };
  },
});

export const getByTokenHash = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("quotations")
      .withIndex("by_accessTokenHash", (q) =>
        q.eq("accessTokenHash", args.tokenHash)
      )
      .first();
  },
});
```

(If the import for `resolveIssuingCompany` already exists at the top of the file, don't duplicate — move the `import` line up there.)

- [ ] **Step 3: Verify the file type-checks**

Run: `npx convex dev --once`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add convex/functions/quotations/internalQueries.ts
git commit -m "feat(3b): add getSendContext + getByTokenHash internal queries"
```

---

## Task 5: rotateTokenAndMarkSent internal mutation (TDD)

**Files:**
- Create: `convex/functions/quotations/internalMutations.ts`
- Create: `convex/functions/quotations/__tests__/helpers/quotations.ts`
- Create: `convex/functions/quotations/__tests__/rotateToken.test.ts`

- [ ] **Step 1: Create the test helper**

Create `convex/functions/quotations/__tests__/helpers/quotations.ts`:

```ts
import type { setupTest } from "../../../../../tests/harness";
import type { Id } from "../../../../_generated/dataModel";

type T = ReturnType<typeof setupTest>;

export async function seedClient(
  t: T,
  orgId: string,
  overrides: Partial<{
    name: string;
    rfc: string;
    industry: string;
    annualRevenue: number;
    assignedTo?: string;
    contactEmail?: string;
    contactName?: string;
  }> = {}
): Promise<Id<"clients">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("clients", {
      orgId,
      name: overrides.name ?? "Test Client",
      rfc: overrides.rfc ?? "TEST010101ABC",
      industry: overrides.industry ?? "Servicios",
      annualRevenue: overrides.annualRevenue ?? 1_000_000,
      billingFrequency: "mensual",
      isArchived: false,
      assignedTo: overrides.assignedTo,
      contactEmail: overrides.contactEmail,
      contactName: overrides.contactName,
      createdAt: Date.now(),
    });
  });
}

export async function seedQuotation(
  t: T,
  orgId: string,
  clientId: Id<"clients">,
  overrides: Partial<{
    status: "draft" | "sent" | "approved" | "rejected";
    pdfStorageId?: Id<"_storage">;
    accessTokenHash?: string;
    tokenExpiresAt?: number;
    sendCount?: number;
    projServiceId: Id<"projectionServices">;
  }> = {}
): Promise<Id<"quotations">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("quotations", {
      orgId,
      projServiceId:
        overrides.projServiceId ??
        ("unused" as unknown as Id<"projectionServices">),
      clientId,
      serviceName: "Contable",
      content: "<div>Cotización</div>",
      pdfStorageId: overrides.pdfStorageId,
      status: overrides.status ?? "draft",
      sendCount: overrides.sendCount,
      accessTokenHash: overrides.accessTokenHash,
      tokenExpiresAt: overrides.tokenExpiresAt,
      createdAt: Date.now(),
    });
  });
}
```

- [ ] **Step 2: Write the failing test**

Create `convex/functions/quotations/__tests__/rotateToken.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { internal } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../../tests/harness";
import { seedClient, seedQuotation } from "./helpers/quotations";

describe("rotateTokenAndMarkSent", () => {
  it("patches quotation to sent, increments sendCount, sets token fields", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const quotationId = await seedQuotation(t, ORG_A, clientId, { status: "draft" });

    const tokenIssuedAt = Date.now();
    const tokenExpiresAt = tokenIssuedAt + 30 * 24 * 60 * 60 * 1000;

    await t.mutation(
      internal.functions.quotations.internalMutations.rotateTokenAndMarkSent,
      {
        quotationId,
        tokenHash: "hash_v1",
        tokenIssuedAt,
        tokenExpiresAt,
      }
    );

    const after = await t.run((ctx) => ctx.db.get(quotationId));
    expect(after?.status).toBe("sent");
    expect(after?.sendCount).toBe(1);
    expect(after?.accessTokenHash).toBe("hash_v1");
    expect(after?.tokenIssuedAt).toBe(tokenIssuedAt);
    expect(after?.tokenExpiresAt).toBe(tokenExpiresAt);
    expect(after?.lastSentAt).toBeGreaterThan(0);
  });

  it("increments sendCount from 2 to 3 on re-send and overwrites token", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const quotationId = await seedQuotation(t, ORG_A, clientId, {
      status: "sent",
      sendCount: 2,
      accessTokenHash: "old_hash",
    });

    await t.mutation(
      internal.functions.quotations.internalMutations.rotateTokenAndMarkSent,
      {
        quotationId,
        tokenHash: "new_hash",
        tokenIssuedAt: Date.now(),
        tokenExpiresAt: Date.now() + 1000,
      }
    );

    const after = await t.run((ctx) => ctx.db.get(quotationId));
    expect(after?.sendCount).toBe(3);
    expect(after?.accessTokenHash).toBe("new_hash");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run convex/functions/quotations/__tests__/rotateToken.test.ts`
Expected: FAIL — internalMutations module not found.

- [ ] **Step 4: Implement rotateTokenAndMarkSent**

Create `convex/functions/quotations/internalMutations.ts`:

```ts
import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";

export const rotateTokenAndMarkSent = internalMutation({
  args: {
    quotationId: v.id("quotations"),
    tokenHash: v.string(),
    tokenIssuedAt: v.number(),
    tokenExpiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const quotation = await ctx.db.get(args.quotationId);
    if (!quotation) throw new Error("Cotización no encontrada.");
    const prev = quotation.sendCount ?? 0;
    await ctx.db.patch(args.quotationId, {
      status: "sent",
      lastSentAt: Date.now(),
      sendCount: prev + 1,
      accessTokenHash: args.tokenHash,
      tokenIssuedAt: args.tokenIssuedAt,
      tokenExpiresAt: args.tokenExpiresAt,
    });
    return { sendCount: prev + 1, tokenExpiresAt: args.tokenExpiresAt };
  },
});
```

- [ ] **Step 5: Run test to verify pass**

Run: `npx vitest run convex/functions/quotations/__tests__/rotateToken.test.ts`
Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add convex/functions/quotations/internalMutations.ts convex/functions/quotations/__tests__/rotateToken.test.ts convex/functions/quotations/__tests__/helpers/quotations.ts
git commit -m "feat(3b): add rotateTokenAndMarkSent internal mutation + test helper"
```

---

## Task 6: applyAcceptance internal mutation (TDD)

**Files:**
- Modify: `convex/functions/quotations/internalMutations.ts`
- Create: `convex/functions/quotations/__tests__/applyAcceptance.test.ts`

- [ ] **Step 1: Write the failing test**

Create `convex/functions/quotations/__tests__/applyAcceptance.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { internal } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../../tests/harness";
import { seedClient, seedQuotation } from "./helpers/quotations";

describe("applyAcceptance", () => {
  it("transitions sent to approved and clears accessTokenHash", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const quotationId = await seedQuotation(t, ORG_A, clientId, {
      status: "sent",
      accessTokenHash: "hash_v1",
      tokenExpiresAt: Date.now() + 100_000,
    });

    const result = await t.mutation(
      internal.functions.quotations.internalMutations.applyAcceptance,
      { tokenHash: "hash_v1" }
    );

    expect(result.quotationId).toBe(quotationId);
    expect(result.orgId).toBe(ORG_A);

    const after = await t.run((ctx) => ctx.db.get(quotationId));
    expect(after?.status).toBe("approved");
    expect(after?.accessTokenHash).toBeUndefined();
    expect(after?.respondedAt).toBeGreaterThan(0);
  });

  it("throws invalid_token when hash not found", async () => {
    const t = setupTest();
    await expect(
      t.mutation(internal.functions.quotations.internalMutations.applyAcceptance, {
        tokenHash: "missing",
      })
    ).rejects.toThrow(/invalid_token/);
  });

  it("throws already_responded when status is approved", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    await seedQuotation(t, ORG_A, clientId, {
      status: "approved",
      accessTokenHash: "hash_v1",
      tokenExpiresAt: Date.now() + 100_000,
    });
    await expect(
      t.mutation(internal.functions.quotations.internalMutations.applyAcceptance, {
        tokenHash: "hash_v1",
      })
    ).rejects.toThrow(/already_responded/);
  });

  it("throws already_responded when status is rejected", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    await seedQuotation(t, ORG_A, clientId, {
      status: "rejected",
      accessTokenHash: "hash_v1",
      tokenExpiresAt: Date.now() + 100_000,
    });
    await expect(
      t.mutation(internal.functions.quotations.internalMutations.applyAcceptance, {
        tokenHash: "hash_v1",
      })
    ).rejects.toThrow(/already_responded/);
  });

  it("throws expired when tokenExpiresAt < now", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    await seedQuotation(t, ORG_A, clientId, {
      status: "sent",
      accessTokenHash: "hash_v1",
      tokenExpiresAt: Date.now() - 1000,
    });
    await expect(
      t.mutation(internal.functions.quotations.internalMutations.applyAcceptance, {
        tokenHash: "hash_v1",
      })
    ).rejects.toThrow(/expired/);
  });

  it("second concurrent call throws already_responded", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    await seedQuotation(t, ORG_A, clientId, {
      status: "sent",
      accessTokenHash: "hash_v1",
      tokenExpiresAt: Date.now() + 100_000,
    });

    const [first, second] = await Promise.allSettled([
      t.mutation(internal.functions.quotations.internalMutations.applyAcceptance, {
        tokenHash: "hash_v1",
      }),
      t.mutation(internal.functions.quotations.internalMutations.applyAcceptance, {
        tokenHash: "hash_v1",
      }),
    ]);
    const fulfilled = [first, second].filter((r) => r.status === "fulfilled");
    const rejected = [first, second].filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(
      (rejected[0] as PromiseRejectedResult).reason.message
    ).toMatch(/already_responded|invalid_token/);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run convex/functions/quotations/__tests__/applyAcceptance.test.ts`
Expected: FAIL — `applyAcceptance` not exported.

- [ ] **Step 3: Add applyAcceptance to internalMutations.ts**

Append to `convex/functions/quotations/internalMutations.ts`:

```ts
export const applyAcceptance = internalMutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    const quotation = await ctx.db
      .query("quotations")
      .withIndex("by_accessTokenHash", (q) =>
        q.eq("accessTokenHash", args.tokenHash)
      )
      .first();
    if (!quotation) throw new Error("invalid_token");
    if (quotation.status !== "sent") throw new Error("already_responded");
    if (
      !quotation.tokenExpiresAt ||
      quotation.tokenExpiresAt < Date.now()
    ) {
      throw new Error("expired");
    }
    await ctx.db.patch(quotation._id, {
      status: "approved",
      respondedAt: Date.now(),
      accessTokenHash: undefined,
    });
    // TODO(pipeline-visibility): emit notifications.insert when §3B.10 ships.
    const projService = await ctx.db.get(quotation.projServiceId);
    return {
      quotationId: quotation._id,
      orgId: quotation.orgId,
      clientId: quotation.clientId,
      projServiceId: quotation.projServiceId,
      serviceId: projService?.serviceId,
    };
  },
});
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run convex/functions/quotations/__tests__/applyAcceptance.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add convex/functions/quotations/internalMutations.ts convex/functions/quotations/__tests__/applyAcceptance.test.ts
git commit -m "feat(3b): add applyAcceptance internal mutation with tests"
```

---

## Task 7: applyDecline internal mutation (TDD)

**Files:**
- Modify: `convex/functions/quotations/internalMutations.ts`
- Create: `convex/functions/quotations/__tests__/applyDecline.test.ts`

- [ ] **Step 1: Write the failing test**

Create `convex/functions/quotations/__tests__/applyDecline.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { internal } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../../tests/harness";
import { seedClient, seedQuotation } from "./helpers/quotations";

describe("applyDecline", () => {
  it("transitions sent to rejected and stores declineReason", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const quotationId = await seedQuotation(t, ORG_A, clientId, {
      status: "sent",
      accessTokenHash: "hash_d1",
      tokenExpiresAt: Date.now() + 100_000,
    });

    await t.mutation(
      internal.functions.quotations.internalMutations.applyDecline,
      { tokenHash: "hash_d1", declineReason: "muy caro" }
    );

    const after = await t.run((ctx) => ctx.db.get(quotationId));
    expect(after?.status).toBe("rejected");
    expect(after?.declineReason).toBe("muy caro");
    expect(after?.respondedAt).toBeGreaterThan(0);
    expect(after?.accessTokenHash).toBeUndefined();
  });

  it("truncates declineReason to 500 chars", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const quotationId = await seedQuotation(t, ORG_A, clientId, {
      status: "sent",
      accessTokenHash: "hash_d1",
      tokenExpiresAt: Date.now() + 100_000,
    });
    const long = "x".repeat(600);
    await t.mutation(
      internal.functions.quotations.internalMutations.applyDecline,
      { tokenHash: "hash_d1", declineReason: long }
    );
    const after = await t.run((ctx) => ctx.db.get(quotationId));
    expect(after?.declineReason).toHaveLength(500);
  });

  it("stores undefined when declineReason is undefined", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const quotationId = await seedQuotation(t, ORG_A, clientId, {
      status: "sent",
      accessTokenHash: "hash_d1",
      tokenExpiresAt: Date.now() + 100_000,
    });
    await t.mutation(
      internal.functions.quotations.internalMutations.applyDecline,
      { tokenHash: "hash_d1" }
    );
    const after = await t.run((ctx) => ctx.db.get(quotationId));
    expect(after?.declineReason).toBeUndefined();
  });

  it("normalizes empty string to undefined", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const quotationId = await seedQuotation(t, ORG_A, clientId, {
      status: "sent",
      accessTokenHash: "hash_d1",
      tokenExpiresAt: Date.now() + 100_000,
    });
    await t.mutation(
      internal.functions.quotations.internalMutations.applyDecline,
      { tokenHash: "hash_d1", declineReason: "" }
    );
    const after = await t.run((ctx) => ctx.db.get(quotationId));
    expect(after?.declineReason).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run convex/functions/quotations/__tests__/applyDecline.test.ts`
Expected: FAIL — `applyDecline` not exported.

- [ ] **Step 3: Add applyDecline to internalMutations.ts**

Append to `convex/functions/quotations/internalMutations.ts`:

```ts
export const applyDecline = internalMutation({
  args: {
    tokenHash: v.string(),
    declineReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const quotation = await ctx.db
      .query("quotations")
      .withIndex("by_accessTokenHash", (q) =>
        q.eq("accessTokenHash", args.tokenHash)
      )
      .first();
    if (!quotation) throw new Error("invalid_token");
    if (quotation.status !== "sent") throw new Error("already_responded");
    if (
      !quotation.tokenExpiresAt ||
      quotation.tokenExpiresAt < Date.now()
    ) {
      throw new Error("expired");
    }
    const reasonTrimmed = args.declineReason?.slice(0, 500);
    const reason = reasonTrimmed && reasonTrimmed.length > 0 ? reasonTrimmed : undefined;
    await ctx.db.patch(quotation._id, {
      status: "rejected",
      respondedAt: Date.now(),
      declineReason: reason,
      accessTokenHash: undefined,
    });
    // TODO(pipeline-visibility): emit notifications.insert when §3B.10 ships.
    return {
      quotationId: quotation._id,
      orgId: quotation.orgId,
    };
  },
});
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run convex/functions/quotations/__tests__/applyDecline.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add convex/functions/quotations/internalMutations.ts convex/functions/quotations/__tests__/applyDecline.test.ts
git commit -m "feat(3b): add applyDecline internal mutation with tests"
```

---

## Task 8: Refactor contracts/actions.ts to expose internal variant

**Files:**
- Modify: `convex/functions/contracts/actions.ts`

- [ ] **Step 1: Read current generateContract to identify the common logic**

Run: `cat convex/functions/contracts/actions.ts | sed -n '130,220p'`
Expected: see the handler that derives orgId from identity and performs the full AI pipeline.

- [ ] **Step 2: Add getByQuotationInternal helper if missing**

Check `convex/functions/contracts/internalQueries.ts` for an existing `getByQuotationInternal` that accepts `{quotationId, orgId}`. If it exists, skip this step. If not, add:

```ts
export const getByQuotationInternal = internalQuery({
  args: { quotationId: v.id("quotations"), orgId: v.string() },
  handler: async (ctx, args) => {
    const c = await ctx.db
      .query("contracts")
      .withIndex("by_quotationId", (q) => q.eq("quotationId", args.quotationId))
      .first();
    if (!c || c.orgId !== args.orgId) return null;
    return c;
  },
});
```

- [ ] **Step 3: Refactor `generateContract` by extracting its handler body into a shared helper**

Open `convex/functions/contracts/actions.ts`. The existing `generateContract` action's handler (approximately lines 130-260 based on the current file) derives `orgId` from `ctx.auth` then performs the AI pipeline. Perform this refactor mechanically:

1. Create a new top-level async function `doGenerate` that takes `(ctx, orgId: string, quotationId: Id<"quotations">)`. Give it the return type `Promise<Id<"contracts">>`.

2. Copy the ENTIRE body of the current `generateContract` handler into `doGenerate`, except for the first few lines that call `ctx.auth.getUserIdentity()` and derive `orgId` — those are replaced by using the `orgId` parameter directly.

3. Prepend `doGenerate` with the idempotency check:

```ts
const existing = await ctx.runQuery(
  internal.functions.contracts.internalQueries.getByQuotationInternal,
  { quotationId, orgId }
);
if (existing) return existing._id;
```

4. Rewrite the `generateContract` action so its handler only auth-gates and delegates:

```ts
export const generateContract = action({
  args: { quotationId: v.id("quotations") },
  handler: async (ctx, args): Promise<Id<"contracts">> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("No autenticado. Inicia sesión para continuar.");
    const orgId = (identity.orgId ?? (identity as Record<string, unknown>).org_id) as string | undefined;
    if (!orgId) throw new Error("No se encontró la organización.");
    return doGenerate(ctx, orgId, args.quotationId);
  },
});
```

5. Add the internal-action wrapper that the scheduler will call:

```ts
import { internalAction } from "../../_generated/server";

export const generateContractFromQuotationInternal = internalAction({
  args: {
    quotationId: v.id("quotations"),
    orgId: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      await doGenerate(ctx, args.orgId, args.quotationId);
    } catch (err) {
      console.error(
        `[Contract auto-gen] Failed for quotation ${args.quotationId}:`,
        err
      );
      // No re-throw — scheduler no reintenta. Ejecutivo puede regenerar manual.
    }
  },
});
```

Key invariants while refactoring:
- Every `ctx.auth.getUserIdentity()` call inside what WAS the handler body is gone. The only place `ctx.auth` is referenced is inside the `generateContract` wrapper above.
- Every reference to `orgId` inside `doGenerate` comes from the function parameter, not from identity.
- If the original handler called internal queries that derived orgId internally from ctx.auth, switch them to explicit-orgId variants (add them to `internalQueries.ts` as needed — same pattern as `getByQuotationInternal` above).
- Preserve the exact same logging, return values, and error messages.

- [ ] **Step 3: Verify types and existing tests still pass**

Run: `npx convex dev --once`
Expected: clean.

Run: `npm test -- --run` (or whatever invokes vitest)
Expected: all existing 124 tests still pass.

- [ ] **Step 4: Commit**

```bash
git add convex/functions/contracts/actions.ts convex/functions/contracts/internalQueries.ts
git commit -m "refactor(contracts): extract doGenerate + add internal variant for scheduler"
```

---

## Task 9: buildQuotationEmailHtml helper + getSendPreviewContext query

**Files:**
- Modify: `convex/functions/quotations/actions.ts` (add buildQuotationEmailHtml helper)
- Modify: `convex/functions/quotations/queries.ts` (add getSendPreviewContext)

- [ ] **Step 1: Add buildQuotationEmailHtml helper to actions.ts**

Append to `convex/functions/quotations/actions.ts` (above `export const generateQuotation`, it's a pure helper):

```ts
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildQuotationEmailHtml(input: {
  client: { name: string; contactName?: string };
  serviceName: string;
  issuingCompany: { name: string; primaryColor?: string };
  token: string;
  appUrl: string;
}): string {
  const greeting = input.client.contactName
    ? `Estimado/a ${input.client.contactName}`
    : `Estimado/a cliente`;
  const link = `${input.appUrl}/q/cotizacion/${input.token}`;
  const primary = input.issuingCompany.primaryColor ?? "#1a1a2e";
  return `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px;">
  <p>${greeting},</p>
  <p>Te compartimos la cotización de <strong>${input.serviceName}</strong> por parte de <strong>${input.issuingCompany.name}</strong>.</p>
  <p>Puedes revisarla y responder directamente desde el siguiente enlace:</p>
  <p style="margin: 32px 0; text-align: center;">
    <a href="${link}" style="display: inline-block; background: ${primary}; color: white; padding: 14px 28px; border-radius: 6px; text-decoration: none; font-weight: 600;">Ver cotización</a>
  </p>
  <p style="color: #666; font-size: 13px;">También adjuntamos el PDF. La cotización es válida por 30 días naturales.</p>
  <p style="color: #666; font-size: 13px;">Si el botón no funciona, copia este link en tu navegador:<br/><span style="color: ${primary}; word-break: break-all;">${link}</span></p>
</div>`.trim();
}
```

(The helpers are internal to this file — no need to export. They'll be used by `sendQuotation` in Task 10.)

- [ ] **Step 2: Add getSendPreviewContext public query to queries.ts**

Append to `convex/functions/quotations/queries.ts`:

```ts
import { internal } from "../../_generated/api";

export const getSendPreviewContext = query({
  args: { quotationId: v.id("quotations") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;

    const quotation = await ctx.db.get(args.quotationId);
    if (!quotation || quotation.orgId !== orgId) return null;

    const client = await ctx.db.get(quotation.clientId);
    if (!client || client.orgId !== orgId) return null;

    // Ejecutivo permission gate
    const identity = await ctx.auth.getUserIdentity();
    const role = (identity?.orgRole as string) ?? "org:member";
    if (role === "org:member" && client.assignedTo && client.assignedTo !== identity?.subject) {
      return null;
    }

    const projService = await ctx.db.get(quotation.projServiceId);
    if (!projService) return null;

    // Attempt issuingCompany resolution without throwing.
    let issuingCompanyPreview: {
      _id: string;
      name: string;
      primaryColor?: string;
      logoStorageUrl?: string | null;
    } | null = null;
    let issuingCompanyError: string | null = null;
    try {
      // Reuse resolver via internal query to keep one code path.
      const resolved = await ctx.runQuery(
        internal.functions.issuingCompanies.resolve.resolveIssuingCompanyQuery,
        {
          orgId,
          clientId: client._id,
          serviceId: projService.serviceId,
        }
      );
      const logoUrl = resolved.issuingCompany.logoStorageId
        ? await ctx.storage.getUrl(resolved.issuingCompany.logoStorageId)
        : null;
      issuingCompanyPreview = {
        _id: resolved.issuingCompany._id,
        name: resolved.issuingCompany.name,
        primaryColor: resolved.issuingCompany.primaryColor,
        logoStorageUrl: logoUrl,
      };
    } catch (err) {
      issuingCompanyError = err instanceof Error ? err.message : String(err);
    }

    const pdfFilename = `cotizacion-${slug(quotation.serviceName)}-${slug(client.name)}.pdf`;
    const defaultSubject = `Cotización ${quotation.serviceName}${issuingCompanyPreview ? ` — ${issuingCompanyPreview.name}` : ""}`;

    return {
      client: {
        name: client.name,
        contactEmail: client.contactEmail,
        contactName: client.contactName,
      },
      issuingCompany: issuingCompanyPreview,
      issuingCompanyError,
      pdfFilename,
      defaultSubject,
      tokenTtlDays: 30,
      hasPdf: !!quotation.pdfStorageId,
      status: quotation.status,
      sendCount: quotation.sendCount ?? 0,
    };
  },
});

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
```

Note: `resolveIssuingCompanyQuery` is the existing internal query wrapper in `convex/functions/issuingCompanies/resolve.ts`.

If a `resolveIssuingCompanyQuery` public-query wrapper doesn't exist (only the `internalQuery` does), keep the code above using `internal.*` — queries can call `internal` queries via `ctx.runQuery`. Check the file before implementing.

- [ ] **Step 3: Verify type-check**

Run: `npx convex dev --once`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add convex/functions/quotations/actions.ts convex/functions/quotations/queries.ts
git commit -m "feat(3b): add email body helper + getSendPreviewContext query"
```

---

## Task 10: sendQuotation action (TDD)

**Files:**
- Modify: `convex/functions/quotations/actions.ts`
- Create: `convex/functions/quotations/__tests__/sendQuotation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `convex/functions/quotations/__tests__/sendQuotation.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "../../../_generated/api";
import { setupTest, ORG_A, ORG_B } from "../../../../tests/harness";
import { seedClient, seedQuotation } from "./helpers/quotations";

vi.mock("resend", () => {
  const send = vi.fn();
  class MockResend {
    emails = { send };
    domains = { list: vi.fn().mockResolvedValue({ data: [], error: null }) };
    constructor(_k: string) { void _k; }
  }
  return { Resend: MockResend, __send: send };
});

async function getMockSend() {
  const m = await import("resend");
  // @ts-expect-error test handle
  return m.__send as ReturnType<typeof vi.fn>;
}

function admin(orgId: string) {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `user_admin_${orgId}`,
    orgId,
    orgRole: "org:admin",
  };
}

async function seedResend(t: ReturnType<typeof setupTest>, orgId: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgIntegrations", {
      orgId,
      provider: "resend",
      config: { apiKeySecretRef: "re_test", fromEmail: "noreply@test.mx" },
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
}

async function seedIssuingCompanyDefault(
  t: ReturnType<typeof setupTest>,
  orgId: string
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("issuingCompanies", {
      orgId,
      name: "Empresa Emisora A",
      legalName: "Empresa Emisora A S.A.",
      rfc: "EEA200101ABC",
      regimenFiscalCode: "601",
      codigoPostal: "00000",
      address: { street: "Calle 1", city: "CDMX", state: "CDMX", country: "MX" },
      email: "contacto@ejemplo.mx",
      isDefault: true,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
}

async function seedQuotationForSend(
  t: ReturnType<typeof setupTest>,
  orgId: string,
  opts: { assignedTo?: string; contactEmail?: string; status?: "draft" | "sent"; sendCount?: number; pdfStorageId?: string } = {}
) {
  const clientId = await seedClient(t, orgId, {
    assignedTo: opts.assignedTo,
    contactEmail: opts.contactEmail ?? "cliente@test.mx",
  });
  const svcId = await t.run(async (ctx) =>
    ctx.db.insert("services", {
      orgId,
      name: "Contable",
      type: "base",
      minPct: 5,
      maxPct: 15,
      defaultPct: 10,
      isDefault: true,
    })
  );
  const projectionId = await t.run(async (ctx) =>
    ctx.db.insert("projections", {
      orgId,
      clientId,
      year: 2026,
      annualSales: 1_000_000,
      totalBudget: 100_000,
      commissionRate: 0,
      seasonalityData: [],
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  );
  const projServiceId = await t.run(async (ctx) =>
    ctx.db.insert("projectionServices", {
      orgId,
      projectionId,
      serviceId: svcId,
      serviceName: "Contable",
      chosenPct: 10,
      annualAmount: 10_000,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  );
  return await seedQuotation(t, orgId, clientId, {
    status: opts.status ?? "draft",
    sendCount: opts.sendCount,
    projServiceId,
    pdfStorageId: (opts.pdfStorageId as any) ?? ("st_test" as any),
  });
}

describe("sendQuotation", () => {
  beforeEach(async () => {
    process.env.QUOTATION_TOKEN_SECRET = "a".repeat(48);
    process.env.APP_URL = "http://localhost:3000";
    const send = await getMockSend();
    send.mockReset();
    send.mockResolvedValue({ data: { id: "resend_msg_1" }, error: null });
  });

  it("admin sends a draft quotation: status becomes sent, sendCount=1, token hash stored", async () => {
    const t = setupTest();
    await seedResend(t, ORG_A);
    await seedIssuingCompanyDefault(t, ORG_A);
    const qid = await seedQuotationForSend(t, ORG_A);
    const result = await t
      .withIdentity(admin(ORG_A))
      .action(api.functions.quotations.actions.sendQuotation, { quotationId: qid });

    expect(result.ok).toBe(true);
    expect(result.sendCount).toBe(1);
    expect(result.plaintextToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const q = await t.run((ctx) => ctx.db.get(qid));
    expect(q?.status).toBe("sent");
    expect(q?.accessTokenHash).toBeTruthy();
    expect(q?.tokenExpiresAt).toBeGreaterThan(Date.now());
  });

  it("re-send on status sent increments sendCount and rotates token", async () => {
    const t = setupTest();
    await seedResend(t, ORG_A);
    await seedIssuingCompanyDefault(t, ORG_A);
    const qid = await seedQuotationForSend(t, ORG_A, { status: "sent", sendCount: 1 });
    const r1 = await t
      .withIdentity(admin(ORG_A))
      .action(api.functions.quotations.actions.sendQuotation, { quotationId: qid });
    expect(r1.sendCount).toBe(2);
    const q = await t.run((ctx) => ctx.db.get(qid));
    expect(q?.sendCount).toBe(2);
  });

  it("throws when client has no contactEmail", async () => {
    const t = setupTest();
    await seedResend(t, ORG_A);
    await seedIssuingCompanyDefault(t, ORG_A);
    const qid = await seedQuotationForSend(t, ORG_A, { contactEmail: undefined });
    await expect(
      t.withIdentity(admin(ORG_A)).action(api.functions.quotations.actions.sendQuotation, {
        quotationId: qid,
      })
    ).rejects.toThrow(/email/i);
  });

  it("throws when quotation has no pdfStorageId", async () => {
    const t = setupTest();
    await seedResend(t, ORG_A);
    await seedIssuingCompanyDefault(t, ORG_A);
    const qid = await seedQuotationForSend(t, ORG_A, { pdfStorageId: undefined as any });
    await expect(
      t.withIdentity(admin(ORG_A)).action(api.functions.quotations.actions.sendQuotation, {
        quotationId: qid,
      })
    ).rejects.toThrow(/PDF/i);
  });

  it("throws when status is approved", async () => {
    const t = setupTest();
    await seedResend(t, ORG_A);
    await seedIssuingCompanyDefault(t, ORG_A);
    const clientId = await seedClient(t, ORG_A, { contactEmail: "c@x.mx" });
    const qid = await seedQuotation(t, ORG_A, clientId, { status: "approved", pdfStorageId: "x" as any });
    await expect(
      t.withIdentity(admin(ORG_A)).action(api.functions.quotations.actions.sendQuotation, {
        quotationId: qid,
      })
    ).rejects.toThrow();
  });

  it("cross-org send is blocked", async () => {
    const t = setupTest();
    await seedResend(t, ORG_A);
    await seedIssuingCompanyDefault(t, ORG_A);
    const qid = await seedQuotationForSend(t, ORG_A);
    await expect(
      t.withIdentity(admin(ORG_B)).action(api.functions.quotations.actions.sendQuotation, {
        quotationId: qid,
      })
    ).rejects.toThrow();
  });

  it("resend 4xx surfaces as error; token still rotated (trade-off documented)", async () => {
    const t = setupTest();
    await seedResend(t, ORG_A);
    await seedIssuingCompanyDefault(t, ORG_A);
    const send = await getMockSend();
    send.mockResolvedValue({ data: null, error: { message: "invalid from domain" } });
    const qid = await seedQuotationForSend(t, ORG_A);
    await expect(
      t.withIdentity(admin(ORG_A)).action(api.functions.quotations.actions.sendQuotation, {
        quotationId: qid,
      })
    ).rejects.toThrow(/invalid from domain/);
    const q = await t.run((ctx) => ctx.db.get(qid));
    expect(q?.status).toBe("sent"); // rotation happened even though send failed
    expect(q?.accessTokenHash).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run convex/functions/quotations/__tests__/sendQuotation.test.ts`
Expected: FAIL — `sendQuotation` not found on `api.functions.quotations.actions`.

- [ ] **Step 3: Implement sendQuotation in actions.ts**

Append to `convex/functions/quotations/actions.ts` (after `generateQuotation`):

```ts
import { generateToken, hashToken, TOKEN_TTL_MS } from "./tokenHelpers";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const sendQuotation = action({
  args: {
    quotationId: v.id("quotations"),
    toOverride: v.optional(v.string()),
    subjectOverride: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // 1. Auth + orgId
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("No autenticado.");
    const orgId = (identity.orgId ?? (identity as Record<string, unknown>).org_id) as string | undefined;
    if (!orgId) throw new Error("Sin organización.");
    const role = (identity.orgRole as string) ?? "org:member";

    // 2. Gather send context
    const context = await ctx.runQuery(
      internal.functions.quotations.internalQueries.getSendContext,
      { quotationId: args.quotationId }
    );
    if (!context) throw new Error("Cotización no encontrada.");
    const { quotation, client, projService, orgBranding, issuingCompany, issuingCompanyError } = context;

    if (quotation.orgId !== orgId) throw new Error("Cotización de otra organización.");
    if (role === "org:member" && client.assignedTo && client.assignedTo !== identity.subject) {
      throw new Error("Cliente no asignado a este ejecutivo.");
    }

    // 3. Pre-send validations
    if (!["draft", "sent"].includes(quotation.status)) {
      throw new Error(`No se puede enviar una cotización en estado ${quotation.status}.`);
    }
    if (!quotation.pdfStorageId) {
      throw new Error("Genera el PDF antes de enviar.");
    }
    const effectiveTo = args.toOverride ?? client.contactEmail;
    if (!effectiveTo) {
      throw new Error("El cliente no tiene email de contacto. Agrégalo antes de enviar.");
    }
    if (!EMAIL_REGEX.test(effectiveTo)) {
      throw new Error(`Email inválido: ${effectiveTo}`);
    }
    if (issuingCompanyError || !issuingCompany) {
      throw new Error(
        issuingCompanyError ?? "No hay empresa emitente configurada para este cliente/servicio."
      );
    }

    // 4. Generate + hash token
    const plaintextToken = generateToken();
    const tokenHash = hashToken(plaintextToken);
    const now = Date.now();
    const tokenExpiresAt = now + TOKEN_TTL_MS;

    // 5. Rotate token + mark sent
    const rotateRes = await ctx.runMutation(
      internal.functions.quotations.internalMutations.rotateTokenAndMarkSent,
      {
        quotationId: args.quotationId,
        tokenHash,
        tokenIssuedAt: now,
        tokenExpiresAt,
      }
    );

    // 6. Build email
    const subject =
      args.subjectOverride ??
      `Cotización ${quotation.serviceName} — ${issuingCompany.name}`;
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const bodyHtml = buildQuotationEmailHtml({
      client: { name: client.name, contactName: client.contactName },
      serviceName: quotation.serviceName,
      issuingCompany: {
        name: issuingCompany.name,
        primaryColor: orgBranding?.primaryColor,
      },
      token: plaintextToken,
      appUrl,
    });
    const pdfFilename = `cotizacion-${slugify(quotation.serviceName)}-${slugify(client.name)}.pdf`;

    // 7. Send via 3A
    const result: { ok: boolean; emailLogId?: string; errorMessage?: string } =
      await ctx.runAction(internal.functions.email.send.sendEmail as any, {
        to: effectiveTo,
        subject,
        bodyHtml,
        type: "quotation",
        relatedType: "quotation",
        relatedId: args.quotationId,
        clientId: client._id,
        issuingCompanyId: issuingCompany._id,
        attachmentStorageIds: [
          {
            storageId: quotation.pdfStorageId,
            filename: pdfFilename,
            contentType: "application/pdf",
          },
        ],
      });

    if (!result.ok) {
      throw new Error(result.errorMessage ?? "Error al enviar el email.");
    }

    return {
      ok: true as const,
      emailLogId: result.emailLogId,
      plaintextToken,
      appUrl,
      sendCount: rotateRes.sendCount,
      tokenExpiresAt,
    };
  },
});
```

Note: the internal call `internal.functions.email.send.sendEmail` works only if `sendEmail` is exported as a regular `action`. It IS a public action in 3A. For `ctx.runAction` cross-module, use `api.functions.email.send.sendEmail` (not `internal`) since it's not an internal action. Adjust accordingly. If the codebase exposes an internal variant, prefer that.

**Implementation note:** if `sendEmail` is only public, the `ctx.runAction(api.functions.email.send.sendEmail, ...)` call requires that the caller already has auth. Since `sendQuotation` has auth, this works.

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run convex/functions/quotations/__tests__/sendQuotation.test.ts`
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add convex/functions/quotations/actions.ts convex/functions/quotations/__tests__/sendQuotation.test.ts
git commit -m "feat(3b): add sendQuotation action with token rotation + tests"
```

---

## Task 11: publicQueries.ts — getByToken (TDD)

**Files:**
- Create: `convex/functions/quotations/publicQueries.ts`
- Create: `convex/functions/quotations/__tests__/getByToken.test.ts`

- [ ] **Step 1: Write the failing test**

Create `convex/functions/quotations/__tests__/getByToken.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import crypto from "crypto";
import { api } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../../tests/harness";
import { seedClient, seedQuotation } from "./helpers/quotations";

const SECRET = "a".repeat(48);

function hashFor(token: string): string {
  return crypto.createHmac("sha256", SECRET).update(token).digest("base64url");
}

async function seedIssuingCompanyForQuotation(
  t: ReturnType<typeof setupTest>,
  orgId: string,
  clientId: string
) {
  const svcId = await t.run(async (ctx) =>
    ctx.db.insert("services", {
      orgId,
      name: "Contable",
      type: "base",
      minPct: 5, maxPct: 15, defaultPct: 10, isDefault: true,
    })
  );
  await t.run(async (ctx) =>
    ctx.db.insert("issuingCompanies", {
      orgId,
      name: "Empresa Emisora A",
      legalName: "Empresa Emisora A S.A.",
      rfc: "EEA200101ABC",
      regimenFiscalCode: "601",
      codigoPostal: "00000",
      address: { street: "Calle 1", city: "CDMX", state: "CDMX", country: "MX" },
      email: "contacto@ejemplo.mx",
      isDefault: true,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  );
  return svcId;
}

describe("getByToken public query", () => {
  beforeEach(() => {
    process.env.QUOTATION_TOKEN_SECRET = SECRET;
  });

  it("returns kind=ready for valid, non-expired, sent quotation", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A, { contactName: "Juan" });
    const svcId = await seedIssuingCompanyForQuotation(t, ORG_A, clientId);
    // Need a real projService so the query can resolve client+projService.
    const projectionId = await t.run((ctx) =>
      ctx.db.insert("projections", {
        orgId: ORG_A, clientId, year: 2026,
        annualSales: 1, totalBudget: 1, commissionRate: 0,
        seasonalityData: [], status: "active",
        createdAt: Date.now(), updatedAt: Date.now(),
      })
    );
    const projServiceId = await t.run((ctx) =>
      ctx.db.insert("projectionServices", {
        orgId: ORG_A, projectionId, serviceId: svcId, serviceName: "Contable",
        chosenPct: 10, annualAmount: 100, isActive: true,
        createdAt: Date.now(), updatedAt: Date.now(),
      })
    );
    const token = "valid_token_xyz";
    await seedQuotation(t, ORG_A, clientId, {
      status: "sent",
      accessTokenHash: hashFor(token),
      tokenExpiresAt: Date.now() + 100_000,
      projServiceId,
    });
    const result = await t.query(api.functions.quotations.publicQueries.getByToken, { token });
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.quotation.serviceName).toBe("Contable");
      expect(result.client.name).toBe("Test Client");
    }
  });

  it("returns kind=expired when tokenExpiresAt < now", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const token = "expired_token";
    await seedQuotation(t, ORG_A, clientId, {
      status: "sent",
      accessTokenHash: hashFor(token),
      tokenExpiresAt: Date.now() - 1000,
    });
    const result = await t.query(api.functions.quotations.publicQueries.getByToken, { token });
    expect(result.kind).toBe("expired");
  });

  it("returns kind=invalid when token hash not found", async () => {
    const t = setupTest();
    const result = await t.query(api.functions.quotations.publicQueries.getByToken, {
      token: "ghost_token",
    });
    expect(result.kind).toBe("invalid");
  });

  it("returns kind=already_responded when status=approved (simulated)", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const token = "post_accept_token";
    // Simulate a race: the hash field was still set but status already moved.
    await seedQuotation(t, ORG_A, clientId, {
      status: "approved",
      accessTokenHash: hashFor(token),
      tokenExpiresAt: Date.now() + 100_000,
    });
    const result = await t.query(api.functions.quotations.publicQueries.getByToken, { token });
    expect(result.kind).toBe("already_responded");
  });

  it("returns kind=invalid for malformed token", async () => {
    const t = setupTest();
    const result = await t.query(api.functions.quotations.publicQueries.getByToken, {
      token: "not a real token!!!",
    });
    expect(result.kind).toBe("invalid");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run convex/functions/quotations/__tests__/getByToken.test.ts`
Expected: FAIL — `publicQueries.getByToken` not found.

- [ ] **Step 3: Implement publicQueries.ts**

Create `convex/functions/quotations/publicQueries.ts`:

```ts
import { query } from "../../_generated/server";
import { v } from "convex/values";

function base64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hashTokenSubtle(token: string): Promise<string> {
  const secret = process.env.QUOTATION_TOKEN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("QUOTATION_TOKEN_SECRET no configurado o < 32 chars.");
  }
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(token));
  return base64urlEncode(new Uint8Array(sig));
}

export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    let tokenHash: string;
    try {
      tokenHash = await hashTokenSubtle(args.token);
    } catch {
      return { kind: "invalid" as const };
    }

    const quotation = await ctx.db
      .query("quotations")
      .withIndex("by_accessTokenHash", (q) =>
        q.eq("accessTokenHash", tokenHash)
      )
      .first();

    if (!quotation) return { kind: "invalid" as const };

    if (quotation.status !== "sent") {
      return {
        kind: "already_responded" as const,
        status: quotation.status,
        respondedAt: quotation.respondedAt ?? null,
      };
    }

    if (
      !quotation.tokenExpiresAt ||
      quotation.tokenExpiresAt < Date.now()
    ) {
      return { kind: "expired" as const };
    }

    const client = await ctx.db.get(quotation.clientId);
    const projService = await ctx.db.get(quotation.projServiceId);
    if (!client || !projService) return { kind: "invalid" as const };

    // Resolve issuing company for branding.
    let issuingCompanyOut: {
      name: string;
      logoStorageUrl: string | null;
      signatoryName?: string;
      primaryColor?: string;
      secondaryColor?: string;
      address?: unknown;
    } | null = null;
    try {
      const override = await ctx.db
        .query("clientIssuingCompanyOverride")
        .withIndex("by_orgId_client_service", (q) =>
          q
            .eq("orgId", quotation.orgId)
            .eq("clientId", client._id)
            .eq("serviceId", projService.serviceId)
        )
        .first();
      let companyId = override?.issuingCompanyId;
      if (!companyId) {
        const map = await ctx.db
          .query("servicesIssuingCompanyMap")
          .withIndex("by_orgId_serviceId", (q) =>
            q.eq("orgId", quotation.orgId).eq("serviceId", projService.serviceId)
          )
          .first();
        companyId = map?.issuingCompanyId;
      }
      if (!companyId) {
        const defaults = await ctx.db
          .query("issuingCompanies")
          .withIndex("by_orgId_isDefault", (q) =>
            q.eq("orgId", quotation.orgId).eq("isDefault", true)
          )
          .collect();
        const active = defaults.find((c) => c.isActive);
        if (active) companyId = active._id;
      }
      if (companyId) {
        const company = await ctx.db.get(companyId);
        if (company) {
          const logoUrl = company.logoStorageId
            ? await ctx.storage.getUrl(company.logoStorageId)
            : null;
          issuingCompanyOut = {
            name: company.name,
            logoStorageUrl: logoUrl,
            signatoryName: company.signatoryName,
            address: company.address,
          };
        }
      }
    } catch {
      // issuingCompany missing → landing still renders without branding
    }

    // Org branding for colors fallback.
    const orgBranding = await ctx.db
      .query("orgBranding")
      .withIndex("by_orgId", (q) => q.eq("orgId", quotation.orgId))
      .first();
    if (issuingCompanyOut) {
      issuingCompanyOut.primaryColor = orgBranding?.primaryColor;
      issuingCompanyOut.secondaryColor = orgBranding?.secondaryColor;
    }

    return {
      kind: "ready" as const,
      quotation: {
        content: quotation.content,
        serviceName: quotation.serviceName,
        tokenExpiresAt: quotation.tokenExpiresAt,
      },
      client: {
        name: client.name,
        contactName: client.contactName,
      },
      issuingCompany: issuingCompanyOut,
    };
  },
});
```

**Fallback if `crypto.subtle` is not available in Convex runtime:** convert `getByToken` to an action (in `publicActions.ts`) that uses Node `crypto`. The landing would `useAction` instead of `useQuery`. Not needed unless tests fail with a runtime error about `crypto.subtle`.

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run convex/functions/quotations/__tests__/getByToken.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add convex/functions/quotations/publicQueries.ts convex/functions/quotations/__tests__/getByToken.test.ts
git commit -m "feat(3b): add getByToken public query with tests"
```

---

## Task 12: publicActions.ts — acceptQuotation + declineQuotation (TDD)

**Files:**
- Create: `convex/functions/quotations/publicActions.ts`
- Create: `convex/functions/quotations/__tests__/publicActions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `convex/functions/quotations/__tests__/publicActions.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import crypto from "crypto";
import { api } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../../tests/harness";
import { seedClient, seedQuotation } from "./helpers/quotations";

const SECRET = "a".repeat(48);
function hashFor(token: string) {
  return crypto.createHmac("sha256", SECRET).update(token).digest("base64url");
}

describe("publicActions", () => {
  beforeEach(() => {
    process.env.QUOTATION_TOKEN_SECRET = SECRET;
  });

  it("acceptQuotation transitions to approved and returns approved status", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const token = "accept_tok";
    const qid = await seedQuotation(t, ORG_A, clientId, {
      status: "sent",
      accessTokenHash: hashFor(token),
      tokenExpiresAt: Date.now() + 100_000,
    });
    const result = await t.action(api.functions.quotations.publicActions.acceptQuotation, { token });
    expect(result.status).toBe("approved");
    expect(result.quotationId).toBe(qid);
    const q = await t.run((ctx) => ctx.db.get(qid));
    expect(q?.status).toBe("approved");
    // Scheduled contract generation runs async; we verify at the
    // transition level (approved + accessTokenHash cleared). Integration
    // of the scheduler→generateContractFromQuotationInternal path is
    // exercised by the golden E2E test (stretch goal in spec §3B.7).
    expect(q?.accessTokenHash).toBeUndefined();
  });

  it("acceptQuotation with invalid token throws and does not schedule", async () => {
    const t = setupTest();
    await expect(
      t.action(api.functions.quotations.publicActions.acceptQuotation, { token: "ghost" })
    ).rejects.toThrow(/invalid_token/);
  });

  it("declineQuotation with reason records rejected + reason", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const token = "decline_tok";
    const qid = await seedQuotation(t, ORG_A, clientId, {
      status: "sent",
      accessTokenHash: hashFor(token),
      tokenExpiresAt: Date.now() + 100_000,
    });
    await t.action(api.functions.quotations.publicActions.declineQuotation, {
      token,
      declineReason: "muy caro",
    });
    const q = await t.run((ctx) => ctx.db.get(qid));
    expect(q?.status).toBe("rejected");
    expect(q?.declineReason).toBe("muy caro");
  });

  it("declineQuotation without reason stores undefined", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const token = "decline_no_reason";
    const qid = await seedQuotation(t, ORG_A, clientId, {
      status: "sent",
      accessTokenHash: hashFor(token),
      tokenExpiresAt: Date.now() + 100_000,
    });
    await t.action(api.functions.quotations.publicActions.declineQuotation, { token });
    const q = await t.run((ctx) => ctx.db.get(qid));
    expect(q?.status).toBe("rejected");
    expect(q?.declineReason).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run convex/functions/quotations/__tests__/publicActions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement publicActions.ts**

Create `convex/functions/quotations/publicActions.ts`:

```ts
"use node";
import { action } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";
import { hashToken } from "./tokenHelpers";

export const acceptQuotation = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const tokenHash = hashToken(args.token);
    const result = await ctx.runMutation(
      internal.functions.quotations.internalMutations.applyAcceptance,
      { tokenHash }
    );
    await ctx.scheduler.runAfter(
      0,
      internal.functions.contracts.actions.generateContractFromQuotationInternal,
      { quotationId: result.quotationId, orgId: result.orgId }
    );
    return { status: "approved" as const, quotationId: result.quotationId };
  },
});

export const declineQuotation = action({
  args: {
    token: v.string(),
    declineReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tokenHash = hashToken(args.token);
    const result = await ctx.runMutation(
      internal.functions.quotations.internalMutations.applyDecline,
      { tokenHash, declineReason: args.declineReason }
    );
    return { status: "rejected" as const, quotationId: result.quotationId };
  },
});
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run convex/functions/quotations/__tests__/publicActions.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add convex/functions/quotations/publicActions.ts convex/functions/quotations/__tests__/publicActions.test.ts
git commit -m "feat(3b): add acceptQuotation + declineQuotation public actions"
```

---

## Task 13: permissions test (regression)

**Files:**
- Create: `convex/functions/quotations/__tests__/permissions.test.ts`

- [ ] **Step 1: Write tests**

Create `convex/functions/quotations/__tests__/permissions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../../tests/harness";
import { seedClient, seedQuotation } from "./helpers/quotations";

vi.mock("resend", () => {
  const send = vi.fn().mockResolvedValue({ data: { id: "msg" }, error: null });
  class MockResend {
    emails = { send };
    domains = { list: vi.fn() };
    constructor(_: string) {}
  }
  return { Resend: MockResend };
});

function member(orgId: string, userId: string) {
  return {
    tokenIdentifier: `test|${userId}`,
    subject: userId,
    orgId,
    orgRole: "org:member",
  };
}

async function seedFullContext(t: ReturnType<typeof setupTest>, orgId: string, assignedTo?: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgIntegrations", {
      orgId, provider: "resend",
      config: { apiKeySecretRef: "re_x", fromEmail: "n@x.mx" },
      status: "active", createdAt: Date.now(), updatedAt: Date.now(),
    });
    await ctx.db.insert("issuingCompanies", {
      orgId, name: "EA", legalName: "EA", rfc: "EA200101ABC",
      regimenFiscalCode: "601", codigoPostal: "00000",
      address: { street: "s", city: "c", state: "s", country: "MX" },
      email: "a@b.mx", isDefault: true, isActive: true,
      createdAt: Date.now(), updatedAt: Date.now(),
    });
  });
  const clientId = await seedClient(t, orgId, { assignedTo, contactEmail: "x@y.mx" });
  const svcId = await t.run((ctx) =>
    ctx.db.insert("services", {
      orgId, name: "Contable", type: "base",
      minPct: 5, maxPct: 15, defaultPct: 10, isDefault: true,
    })
  );
  const projId = await t.run((ctx) =>
    ctx.db.insert("projections", {
      orgId, clientId, year: 2026,
      annualSales: 1, totalBudget: 1, commissionRate: 0,
      seasonalityData: [], status: "active",
      createdAt: Date.now(), updatedAt: Date.now(),
    })
  );
  const projServiceId = await t.run((ctx) =>
    ctx.db.insert("projectionServices", {
      orgId, projectionId: projId, serviceId: svcId, serviceName: "Contable",
      chosenPct: 10, annualAmount: 100, isActive: true,
      createdAt: Date.now(), updatedAt: Date.now(),
    })
  );
  const qid = await seedQuotation(t, orgId, clientId, {
    status: "draft", projServiceId, pdfStorageId: "st" as any,
  });
  return { clientId, qid };
}

describe("quotations permissions", () => {
  beforeEach(() => {
    process.env.QUOTATION_TOKEN_SECRET = "a".repeat(48);
    process.env.APP_URL = "http://localhost:3000";
  });

  it("ejecutivo can send quotation of own client", async () => {
    const t = setupTest();
    const { qid } = await seedFullContext(t, ORG_A, "user_1");
    const result = await t
      .withIdentity(member(ORG_A, "user_1"))
      .action(api.functions.quotations.actions.sendQuotation, { quotationId: qid });
    expect(result.ok).toBe(true);
  });

  it("ejecutivo cannot send quotation of other user's client", async () => {
    const t = setupTest();
    const { qid } = await seedFullContext(t, ORG_A, "user_1");
    await expect(
      t.withIdentity(member(ORG_A, "user_OTHER"))
        .action(api.functions.quotations.actions.sendQuotation, { quotationId: qid })
    ).rejects.toThrow();
  });

  it("updateStatus blocks terminal → other transitions", async () => {
    const t = setupTest();
    const clientId = await seedClient(t, ORG_A);
    const qid = await seedQuotation(t, ORG_A, clientId, { status: "approved" });
    await expect(
      t.withIdentity(member(ORG_A, "user_1"))
        .mutation(api.functions.quotations.mutations.updateStatus, {
          id: qid, status: "sent",
        })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run convex/functions/quotations/__tests__/permissions.test.ts`
Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add convex/functions/quotations/__tests__/permissions.test.ts
git commit -m "test(3b): permissions regression coverage"
```

---

## Task 14: Update clients mutations + form to accept contactEmail/contactName

**Files:**
- Modify: `convex/functions/clients/mutations.ts`
- Modify: `src/components/clients/client-form.tsx`

- [ ] **Step 1: Extend create + update mutations**

In `convex/functions/clients/mutations.ts`, find `create` and `update` mutations. Add optional args `contactEmail` and `contactName`:

```ts
// In the args block of `create`:
args: {
  name: v.string(),
  rfc: v.string(),
  industry: v.string(),
  annualRevenue: v.number(),
  billingFrequency: v.union(
    v.literal("semanal"),
    v.literal("quincenal"),
    v.literal("mensual")
  ),
  assignedTo: v.optional(v.string()),
  contactEmail: v.optional(v.string()),   // NEW
  contactName: v.optional(v.string()),    // NEW
},
```

In the handler, validate and normalize email:

```ts
if (args.contactEmail) {
  const e = args.contactEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    throw new Error("Email de contacto inválido.");
  }
  // substitute into insert args
}
```

Do the same for `update`. Store the normalized email.

- [ ] **Step 2: Add fields to client-form.tsx**

In `src/components/clients/client-form.tsx`, extend the `ClientData` type and the form state:

```ts
type ClientData = {
  _id?: Id<"clients">;
  name: string;
  rfc: string;
  industry: string;
  annualRevenue: number;
  billingFrequency: "semanal" | "quincenal" | "mensual";
  contactEmail?: string;
  contactName?: string;
};

// In state:
const [form, setForm] = useState({
  name: initialData?.name ?? "",
  rfc: initialData?.rfc ?? "",
  industry: initialData?.industry ?? "",
  annualRevenue: initialData?.annualRevenue ?? 0,
  billingFrequency: initialData?.billingFrequency ?? ("mensual" as const),
  contactEmail: initialData?.contactEmail ?? "",
  contactName: initialData?.contactName ?? "",
});
```

Add two `<input>` blocks in the form UI (follow the existing field styling):

```tsx
<div>
  <label className="block text-sm font-medium mb-1">Email de contacto (opcional)</label>
  <input
    type="email"
    value={form.contactEmail}
    onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
    className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
    placeholder="contacto@empresa.com"
  />
  {errors.contactEmail && <p className="mt-1 text-xs text-destructive">{errors.contactEmail}</p>}
</div>

<div>
  <label className="block text-sm font-medium mb-1">Nombre de contacto (opcional)</label>
  <input
    type="text"
    value={form.contactName}
    onChange={(e) => setForm({ ...form, contactName: e.target.value })}
    className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
    placeholder="Juan Pérez"
  />
</div>
```

Wire them into the mutation calls in `handleSubmit`:

```ts
if (mode === "create") {
  await createClient({
    ...form,
    contactEmail: form.contactEmail || undefined,
    contactName: form.contactName || undefined,
  });
} else {
  await updateClient({
    id: initialData!._id!,
    ...form,
    contactEmail: form.contactEmail || undefined,
    contactName: form.contactName || undefined,
  });
}
```

Add inline email validation:

```ts
if (form.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail)) {
  newErrors.contactEmail = "Email inválido";
}
```

- [ ] **Step 3: Verify**

Run: `npx convex dev --once` (verify types)
Run: `npm run build` (verify Next build)
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add convex/functions/clients/mutations.ts src/components/clients/client-form.tsx
git commit -m "feat(3b): add contactEmail + contactName to client mutations and form"
```

---

## Task 15: SendStatusPanel component

**Files:**
- Create: `src/components/cotizaciones/SendStatusPanel.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/cotizaciones/SendStatusPanel.tsx`:

```tsx
"use client";
import { CheckCircle2, XCircle, Send, Clock, Copy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

type Quotation = {
  _id: string;
  status: "draft" | "sent" | "approved" | "rejected";
  sendCount?: number;
  lastSentAt?: number;
  tokenExpiresAt?: number;
  respondedAt?: number;
  declineReason?: string;
};

export function SendStatusPanel({
  quotation,
  successMeta,
}: {
  quotation: Quotation;
  successMeta?: { plaintextToken: string; appUrl: string } | null;
}) {
  const [copied, setCopied] = useState(false);

  if (quotation.status === "draft" && !quotation.sendCount) return null;

  const sendCount = quotation.sendCount ?? 0;
  const isSent = quotation.status === "sent";
  const isApproved = quotation.status === "approved";
  const isRejected = quotation.status === "rejected";

  const fmt = (ts?: number) =>
    ts
      ? new Date(ts).toLocaleString("es-MX", {
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";

  if (isApproved) {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
        <div className="flex items-center gap-2 font-medium text-emerald-400">
          <CheckCircle2 size={16} /> Aprobada por el cliente
        </div>
        <p className="mt-1 text-muted-foreground">
          {fmt(quotation.respondedAt)} · Enviada {sendCount} {sendCount === 1 ? "vez" : "veces"}
        </p>
      </div>
    );
  }

  if (isRejected) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm">
        <div className="flex items-center gap-2 font-medium text-red-400">
          <XCircle size={16} /> Rechazada por el cliente
        </div>
        <p className="mt-1 text-muted-foreground">{fmt(quotation.respondedAt)}</p>
        {quotation.declineReason && (
          <blockquote className="mt-2 border-l-2 border-red-500/50 pl-3 italic text-muted-foreground">
            {quotation.declineReason}
          </blockquote>
        )}
      </div>
    );
  }

  if (isSent) {
    const link = successMeta
      ? `${successMeta.appUrl}/q/cotizacion/${successMeta.plaintextToken}`
      : null;
    return (
      <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4 text-sm">
        <div className="flex items-center gap-2 font-medium text-blue-400">
          <Send size={16} /> Enviada {sendCount > 1 && `${sendCount} veces`}
        </div>
        <p className="mt-1 text-muted-foreground">
          Último envío: {fmt(quotation.lastSentAt)} · Expira:{" "}
          <Clock size={12} className="inline" /> {fmt(quotation.tokenExpiresAt)}
        </p>
        {link && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
            <code className="flex-1 truncate text-xs">{link}</code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(link);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-secondary"
            >
              <Copy size={12} /> {copied ? "Copiado" : "Copiar"}
            </button>
          </div>
        )}
        <Link
          href={`/configuracion/email-log?relatedId=${quotation._id}`}
          className="mt-2 inline-block text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          Ver historial de emails
        </Link>
      </div>
    );
  }

  return null;
}
```

- [ ] **Step 2: Verify Next build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/cotizaciones/SendStatusPanel.tsx
git commit -m "feat(3b): add SendStatusPanel component"
```

---

## Task 16: SendQuotationDialog component

**Files:**
- Create: `src/components/cotizaciones/SendQuotationDialog.tsx`

- [ ] **Step 1: Create the dialog**

Create `src/components/cotizaciones/SendQuotationDialog.tsx`:

```tsx
"use client";
import { useState, useEffect } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Send, Loader2, CheckCircle2, Copy, AlertTriangle, X } from "lucide-react";
import Link from "next/link";

export function SendQuotationDialog({
  quotationId,
  onClose,
}: {
  quotationId: Id<"quotations">;
  onClose: () => void;
}) {
  const preview = useQuery(
    api.functions.quotations.queries.getSendPreviewContext,
    { quotationId }
  );
  const sendAction = useAction(api.functions.quotations.actions.sendQuotation);

  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    plaintextToken: string;
    appUrl: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (preview) {
      setTo(preview.client.contactEmail ?? "");
      setSubject(preview.defaultSubject);
    }
  }, [preview]);

  const toValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to);
  const canSend =
    preview &&
    preview.hasPdf &&
    !preview.issuingCompanyError &&
    toValid &&
    subject.trim().length > 0 &&
    !sending;

  async function onSend() {
    setSending(true);
    setError(null);
    try {
      const r = await sendAction({
        quotationId,
        toOverride: to,
        subjectOverride: subject,
      });
      setSuccess({ plaintextToken: r.plaintextToken, appUrl: r.appUrl });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-lg border border-border bg-card p-6 shadow-lg"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            {preview?.sendCount && preview.sendCount > 0
              ? `Reenviar cotización (envío #${preview.sendCount + 1})`
              : "Enviar cotización por email"}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>

        {preview === undefined && <p className="text-sm text-muted-foreground">Cargando...</p>}

        {preview && success === null && (
          <div className="space-y-4">
            {preview.sendCount && preview.sendCount > 0 && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-400">
                <AlertTriangle size={14} className="mr-1 inline" />
                Los links de accept/decline anteriores serán invalidados.
              </div>
            )}

            {preview.issuingCompanyError && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                {preview.issuingCompanyError}{" "}
                <Link
                  href="/configuracion/empresas-emitentes"
                  className="underline"
                >
                  Configurar emitente
                </Link>
              </div>
            )}

            {!preview.hasPdf && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                Genera el PDF de la cotización antes de enviar.
              </div>
            )}

            <div>
              <label className="mb-1 block text-sm font-medium">Destinatario</label>
              <input
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              {!toValid && to.length > 0 && (
                <p className="mt-1 text-xs text-destructive">Email inválido</p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Asunto</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <div className="rounded-md border border-border bg-secondary/30 p-3 text-sm">
              <p className="text-muted-foreground">
                <strong>Adjunto:</strong> {preview.pdfFilename}
              </p>
              <p className="mt-1 text-muted-foreground">
                <strong>Emitente:</strong>{" "}
                {preview.issuingCompany?.name ?? "— (sin configurar)"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Los links expirarán en {preview.tokenTtlDays} días.
              </p>
            </div>

            {error && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={onClose}
                className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-secondary"
              >
                Cancelar
              </button>
              <button
                onClick={onSend}
                disabled={!canSend}
                className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
              >
                {sending ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Enviando...
                  </>
                ) : (
                  <>
                    <Send size={14} /> Enviar
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {success && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 size={20} />
              <p className="font-medium">Cotización enviada</p>
            </div>
            <p className="text-sm text-muted-foreground">Destinatario: {to}</p>
            <div className="rounded-md border border-border bg-secondary/50 p-3">
              <p className="mb-2 text-xs text-muted-foreground">Link público (para copiar si el cliente no recibe el email):</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate text-xs">
                  {success.appUrl}/q/cotizacion/{success.plaintextToken}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(
                      `${success.appUrl}/q/cotizacion/${success.plaintextToken}`
                    );
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-secondary"
                >
                  <Copy size={12} /> {copied ? "Copiado" : "Copiar"}
                </button>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button
                onClick={onClose}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify Next build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/cotizaciones/SendQuotationDialog.tsx
git commit -m "feat(3b): add SendQuotationDialog component"
```

---

## Task 17: Wire dialog + panel into /cotizaciones/[id]/page.tsx

**Files:**
- Modify: `src/app/(dashboard)/cotizaciones/[id]/page.tsx`

- [ ] **Step 1: Import new components and add state**

In `src/app/(dashboard)/cotizaciones/[id]/page.tsx`:

Add imports at the top:

```tsx
import { SendQuotationDialog } from "@/components/cotizaciones/SendQuotationDialog";
import { SendStatusPanel } from "@/components/cotizaciones/SendStatusPanel";
```

Add state near the other useState hooks:

```tsx
const [sendDialogOpen, setSendDialogOpen] = useState(false);
```

- [ ] **Step 2: Replace the "Enviar" button with "Enviar por email"**

Find the block (around line 286) that renders the "Enviar" button inside `isDraft && !editing`:

```tsx
{isDraft && !editing && (
  <button
    onClick={() => handleStatusChange("sent")}
    ...
  >
    <Send size={16} />
    Enviar
  </button>
)}
```

Replace with a single button that works for both draft and sent:

```tsx
{(isDraft || isSent) && !editing && (
  <button
    onClick={() => setSendDialogOpen(true)}
    disabled={!quotation.pdfStorageId || !client?.contactEmail}
    title={
      !quotation.pdfStorageId
        ? "Genera el PDF antes de enviar"
        : !client?.contactEmail
          ? "Agrega email de contacto en el cliente"
          : undefined
    }
    className="flex items-center gap-2 rounded-md bg-blue-500/20 px-4 py-2 text-sm font-medium text-blue-400 hover:bg-blue-500/30 transition-colors cursor-pointer disabled:opacity-50"
  >
    <Send size={16} />
    {isSent ? "Reenviar" : "Enviar por email"}
  </button>
)}
```

- [ ] **Step 3: Move manual "Aprobar" / "Rechazar" buttons behind an overflow menu**

Find the block `{isSent && !editing && ...}` (around line 297) that renders the two buttons. Replace with a details/summary overflow:

```tsx
{isSent && !editing && (
  <details className="relative">
    <summary className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-secondary transition-colors list-none">
      <span className="text-lg leading-none">⋯</span>
      Acciones admin
    </summary>
    <div className="absolute right-0 top-full z-10 mt-1 w-64 rounded-md border border-border bg-card p-2 shadow-lg">
      <button
        onClick={() => handleStatusChange("approved")}
        disabled={saving}
        className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-secondary transition-colors cursor-pointer disabled:opacity-50"
      >
        Marcar como aprobada (sin email)
      </button>
      <button
        onClick={() => handleStatusChange("rejected")}
        disabled={saving}
        className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-secondary transition-colors cursor-pointer disabled:opacity-50"
      >
        Marcar como rechazada (sin email)
      </button>
    </div>
  </details>
)}
```

- [ ] **Step 4: Add SendStatusPanel above the content**

Find the `{/* Content */}` block (around line 352). Immediately before it, add:

```tsx
<SendStatusPanel quotation={{
  _id: quotation._id,
  status: quotation.status,
  sendCount: quotation.sendCount,
  lastSentAt: quotation.lastSentAt,
  tokenExpiresAt: quotation.tokenExpiresAt,
  respondedAt: quotation.respondedAt,
  declineReason: quotation.declineReason,
}} />
```

- [ ] **Step 5: Render the dialog at the bottom of the return**

Right before the closing `</div>` of the root container, add:

```tsx
{sendDialogOpen && (
  <SendQuotationDialog
    quotationId={quotation._id}
    onClose={() => setSendDialogOpen(false)}
  />
)}
```

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 7: Manual smoke test**

Start dev server: `npm run dev` + `npx convex dev` in another tab.
Navigate to an existing quotation with PDF generated and client with contactEmail. Verify:
- "Enviar por email" button appears.
- Clicking opens the dialog with prellenado email and subject.
- Dialog reaction is sane (disabled states, errors visible).

(This is smoke — don't need to actually send an email until the landing is done.)

- [ ] **Step 8: Commit**

```bash
git add src/app/(dashboard)/cotizaciones/[id]/page.tsx
git commit -m "feat(3b): wire SendQuotationDialog + SendStatusPanel into quotation page"
```

---

## Task 18: Terminal state components (public)

**Files:**
- Create: `src/components/public/ExpiredState.tsx`
- Create: `src/components/public/InvalidTokenState.tsx`
- Create: `src/components/public/QuotationRespondedState.tsx`

- [ ] **Step 1: ExpiredState**

Create `src/components/public/ExpiredState.tsx`:

```tsx
import { Clock } from "lucide-react";
import { PublicFooter } from "./PublicFooter";

export function ExpiredState() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md text-center space-y-4">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/20">
          <Clock className="text-amber-400" size={28} />
        </div>
        <h1 className="text-xl font-semibold">Esta cotización expiró</h1>
        <p className="text-sm text-muted-foreground">
          Por favor contacta a tu ejecutivo para solicitar una nueva cotización.
        </p>
        <PublicFooter />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: InvalidTokenState**

Create `src/components/public/InvalidTokenState.tsx`:

```tsx
import { Search } from "lucide-react";
import { PublicFooter } from "./PublicFooter";

export function InvalidTokenState() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md text-center space-y-4">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-muted/40">
          <Search className="text-muted-foreground" size={28} />
        </div>
        <h1 className="text-xl font-semibold">Link no válido</h1>
        <p className="text-sm text-muted-foreground">
          Verifica que copiaste el link correcto de tu correo o contacta a tu ejecutivo.
        </p>
        <PublicFooter />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: QuotationRespondedState**

Create `src/components/public/QuotationRespondedState.tsx`:

```tsx
import { CheckCircle2, XCircle } from "lucide-react";
import { PublicFooter } from "./PublicFooter";

export function QuotationRespondedState({
  status,
  respondedAt,
  justNow = false,
}: {
  status: "approved" | "rejected";
  respondedAt?: number | null;
  justNow?: boolean;
}) {
  const isApproved = status === "approved";
  const when = respondedAt
    ? new Date(respondedAt).toLocaleDateString("es-MX", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md text-center space-y-4">
        <div
          className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${
            isApproved ? "bg-emerald-500/20" : "bg-muted/40"
          }`}
        >
          {isApproved ? (
            <CheckCircle2 className="text-emerald-400" size={28} />
          ) : (
            <XCircle className="text-muted-foreground" size={28} />
          )}
        </div>
        {justNow ? (
          isApproved ? (
            <>
              <h1 className="text-xl font-semibold">¡Gracias!</h1>
              <p className="text-sm text-muted-foreground">
                Hemos registrado tu aceptación. En breve recibirás el contrato para firmar en tu correo.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold">Respuesta registrada</h1>
              <p className="text-sm text-muted-foreground">
                Si cambias de opinión, contacta a tu ejecutivo.
              </p>
            </>
          )
        ) : (
          <>
            <h1 className="text-xl font-semibold">
              Esta cotización fue {isApproved ? "aprobada" : "rechazada"}
              {when ? ` el ${when}` : ""}
            </h1>
            <p className="text-sm text-muted-foreground">
              Contacta a tu ejecutivo si necesitas modificarla.
            </p>
          </>
        )}
        <PublicFooter />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: PublicFooter shared**

Create `src/components/public/PublicFooter.tsx`:

```tsx
export function PublicFooter() {
  return (
    <p className="mt-8 text-xs text-muted-foreground">
      powered by{" "}
      <a href="https://projex.app" className="underline underline-offset-2">
        Projex
      </a>
    </p>
  );
}
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/public/ExpiredState.tsx src/components/public/InvalidTokenState.tsx src/components/public/QuotationRespondedState.tsx src/components/public/PublicFooter.tsx
git commit -m "feat(3b): add public terminal state components"
```

---

## Task 19: DeclineReasonDialog

**Files:**
- Create: `src/components/public/DeclineReasonDialog.tsx`

- [ ] **Step 1: Create the modal**

Create `src/components/public/DeclineReasonDialog.tsx`:

```tsx
"use client";
import { useState } from "react";
import { X } from "lucide-react";

export function DeclineReasonDialog({
  primaryColor,
  onSubmit,
  onCancel,
}: {
  primaryColor: string;
  onSubmit: (reason: string | undefined) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const max = 500;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold">¿Por qué rechazas la cotización?</h3>
          <button onClick={onCancel} className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          Tu respuesta es opcional. Nos ayuda a mejorar nuestra oferta.
        </p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, max))}
          rows={4}
          className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:outline-none resize-y"
          placeholder="Opcional"
        />
        <p className="mt-1 text-right text-xs text-muted-foreground">
          {reason.length}/{max}
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-border px-4 py-2 text-sm hover:bg-secondary"
          >
            Cancelar
          </button>
          <button
            onClick={async () => {
              setSubmitting(true);
              await onSubmit(undefined);
            }}
            disabled={submitting}
            className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-secondary disabled:opacity-50"
          >
            Rechazar sin comentario
          </button>
          <button
            onClick={async () => {
              setSubmitting(true);
              await onSubmit(reason.trim() || undefined);
            }}
            disabled={submitting}
            className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
            style={{ background: primaryColor, color: "white" }}
          >
            {submitting ? "Enviando..." : "Enviar rechazo"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/public/DeclineReasonDialog.tsx
git commit -m "feat(3b): add DeclineReasonDialog component"
```

---

## Task 20: QuotationLandingContent

**Files:**
- Create: `src/components/public/QuotationLandingContent.tsx`

- [ ] **Step 1: Create the main landing component**

Create `src/components/public/QuotationLandingContent.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { CheckCircle2 } from "lucide-react";
import Image from "next/image";
import { DeclineReasonDialog } from "./DeclineReasonDialog";
import { QuotationRespondedState } from "./QuotationRespondedState";
import { ExpiredState } from "./ExpiredState";
import { InvalidTokenState } from "./InvalidTokenState";

type Props = {
  token: string;
  quotation: { content: string; serviceName: string; tokenExpiresAt: number };
  client: { name: string; contactName?: string };
  issuingCompany: {
    name: string;
    logoStorageUrl: string | null;
    signatoryName?: string;
    primaryColor?: string;
    secondaryColor?: string;
    address?: unknown;
  } | null;
};

export function QuotationLandingContent({
  token,
  quotation,
  client,
  issuingCompany,
}: Props) {
  const acceptAction = useAction(api.functions.quotations.publicActions.acceptQuotation);
  const declineAction = useAction(api.functions.quotations.publicActions.declineQuotation);

  const [justResponded, setJustResponded] = useState<"approved" | "rejected" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fatal, setFatal] = useState<"expired" | "invalid" | null>(null);
  const [showDecline, setShowDecline] = useState(false);

  const primaryColor = issuingCompany?.primaryColor ?? "#1a1a2e";

  const handleAccept = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await acceptAction({ token });
      setJustResponded("approved");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("expired")) setFatal("expired");
      else if (msg.includes("invalid_token")) setFatal("invalid");
      else if (msg.includes("already_responded")) setJustResponded("approved"); // safe guess; server state will correct on refresh
      else setError("Hubo un problema. Intenta de nuevo o contacta a tu ejecutivo.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecline = async (reason: string | undefined) => {
    setSubmitting(true);
    setError(null);
    try {
      await declineAction({ token, declineReason: reason });
      setJustResponded("rejected");
      setShowDecline(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("expired")) setFatal("expired");
      else if (msg.includes("invalid_token")) setFatal("invalid");
      else if (msg.includes("already_responded")) setJustResponded("rejected");
      else setError("Hubo un problema. Intenta de nuevo o contacta a tu ejecutivo.");
    } finally {
      setSubmitting(false);
    }
  };

  if (fatal === "expired") return <ExpiredState />;
  if (fatal === "invalid") return <InvalidTokenState />;
  if (justResponded) return <QuotationRespondedState status={justResponded} justNow respondedAt={Date.now()} />;

  const expiresDate = new Date(quotation.tokenExpiresAt).toLocaleDateString("es-MX", {
    day: "numeric", month: "long", year: "numeric",
  });

  return (
    <div className="min-h-screen pb-28">
      <header className="border-b border-border px-6 py-4" style={{ borderBottomColor: `${primaryColor}30` }}>
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          {issuingCompany?.logoStorageUrl && (
            <Image
              src={issuingCompany.logoStorageUrl}
              alt={issuingCompany.name}
              width={48}
              height={48}
              className="rounded"
              unoptimized
            />
          )}
          <div>
            <p className="text-sm font-semibold" style={{ color: primaryColor }}>
              {issuingCompany?.name ?? "Cotización"}
            </p>
            {issuingCompany?.signatoryName && (
              <p className="text-xs text-muted-foreground">{issuingCompany.signatoryName}</p>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        <div dangerouslySetInnerHTML={{ __html: quotation.content }} />
      </main>

      <div
        className="fixed inset-x-0 bottom-0 border-t border-border bg-background/95 backdrop-blur px-6 py-4"
        style={{ borderTopColor: `${primaryColor}30` }}
      >
        <div className="max-w-3xl mx-auto flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">Vigencia: hasta el {expiresDate}</p>
          <div className="flex gap-3">
            <button
              onClick={() => setShowDecline(true)}
              disabled={submitting}
              className="rounded-md border border-border px-4 py-2 text-sm hover:bg-secondary disabled:opacity-50"
            >
              Rechazar
            </button>
            <button
              onClick={handleAccept}
              disabled={submitting}
              className="flex items-center gap-2 rounded-md px-6 py-2 text-sm font-medium disabled:opacity-50"
              style={{ background: primaryColor, color: "white" }}
            >
              {submitting ? "Enviando..." : (<><CheckCircle2 size={16} /> Aceptar cotización</>)}
            </button>
          </div>
        </div>
        {error && <p className="mt-2 text-xs text-destructive text-center">{error}</p>}
      </div>

      {showDecline && (
        <DeclineReasonDialog
          primaryColor={primaryColor}
          onSubmit={handleDecline}
          onCancel={() => setShowDecline(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/public/QuotationLandingContent.tsx
git commit -m "feat(3b): add QuotationLandingContent component"
```

---

## Task 21: Public layout + page for /q/cotizacion/[token]

**Files:**
- Create: `src/app/q/cotizacion/[token]/layout.tsx`
- Create: `src/app/q/cotizacion/[token]/page.tsx`

- [ ] **Step 1: Layout with noindex meta**

Create `src/app/q/cotizacion/[token]/layout.tsx`:

```tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cotización",
  robots: "noindex,nofollow",
};

export default function PublicQuotationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen bg-background text-foreground">{children}</div>;
}
```

- [ ] **Step 2: Page with state-machine**

Create `src/app/q/cotizacion/[token]/page.tsx`:

```tsx
"use client";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { QuotationLandingContent } from "@/components/public/QuotationLandingContent";
import { QuotationRespondedState } from "@/components/public/QuotationRespondedState";
import { ExpiredState } from "@/components/public/ExpiredState";
import { InvalidTokenState } from "@/components/public/InvalidTokenState";

export default function PublicQuotationPage() {
  const params = useParams();
  const token = params.token as string;
  const result = useQuery(api.functions.quotations.publicQueries.getByToken, { token });

  if (result === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-accent" />
      </div>
    );
  }

  if (result.kind === "invalid") return <InvalidTokenState />;
  if (result.kind === "expired") return <ExpiredState />;
  if (result.kind === "already_responded") {
    return (
      <QuotationRespondedState
        status={result.status as "approved" | "rejected"}
        respondedAt={result.respondedAt ?? undefined}
      />
    );
  }

  return (
    <QuotationLandingContent
      token={token}
      quotation={result.quotation}
      client={result.client}
      issuingCompany={result.issuingCompany}
    />
  );
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: clean. The new route `/q/cotizacion/[token]` appears in the dynamic routes output.

- [ ] **Step 4: Commit**

```bash
git add src/app/q/cotizacion/[token]/layout.tsx src/app/q/cotizacion/[token]/page.tsx
git commit -m "feat(3b): add public /q/cotizacion/[token] landing route"
```

---

## Task 22: End-to-end manual smoke + final verification

**Files:**
- None (verification only)

- [ ] **Step 1: Start local dev environment**

In one terminal:

```bash
npx convex dev
```

In another:

```bash
npm run dev
```

Expected: both start without errors.

- [ ] **Step 2: Ensure env vars and seed data**

Verify `.env.local` has `QUOTATION_TOKEN_SECRET` and `APP_URL`. Confirm via:

```bash
grep QUOTATION_TOKEN_SECRET .env.local
grep APP_URL .env.local
```

- [ ] **Step 3: Manual flow — send + accept**

- Log into the dashboard as Admin.
- Navigate to an existing client (or create one) and ensure `contactEmail` is set.
- Navigate to a quotation that has a generated PDF (use the "Generar PDF" button if needed).
- Click "Enviar por email".
- In the dialog, confirm email and subject, click "Enviar".
- Expect: success view appears with the public link. Copy the link.
- Open the link in an incognito browser window.
- Expect: landing page shows the quotation HTML with emitente branding + Aceptar/Rechazar buttons.
- Click "Aceptar cotización".
- Expect: confirmation page.
- Back in the dashboard on `/cotizaciones/[id]`, refresh.
- Expect: status badge says "Aprobado", SendStatusPanel shows approved state.
- Navigate to `/contratos`. Wait ~30-60 seconds.
- Expect: a new contract in `draft` appears for this quotation.

- [ ] **Step 4: Manual flow — decline**

Repeat send flow with another quotation. Click "Rechazar" → enter reason → submit. Verify dashboard shows rejected status + reason in the panel.

- [ ] **Step 5: Run the full test suite**

```bash
npm test -- --run
```

Expected: 160+ tests pass (124 existing + 36 new).

- [ ] **Step 6: Build check**

```bash
npm run build
```

Expected: clean production build.

- [ ] **Step 7: Convex deploy check**

```bash
npx convex dev --once
```

Expected: schema + functions deploy without errors.

- [ ] **Step 8: Final commit with any clean-up**

If manual smoke revealed minor issues, fix them and commit:

```bash
git add -p  # stage selectively
git commit -m "fix(3b): address manual smoke test findings"
```

If no issues, this step is a no-op.

---

## Self-Review checklist (plan author runs this)

- [ ] Every spec section 3B.1 through 3B.9 has a corresponding task.
- [ ] All new files in §3B.3/§3B.4 are covered (see task list above).
- [ ] Every backend symbol mentioned (`sendQuotation`, `acceptQuotation`, `declineQuotation`, `getByToken`, `applyAcceptance`, `applyDecline`, `rotateTokenAndMarkSent`, `getSendContext`, `getByTokenHash`, `getSendPreviewContext`, `generateContractFromQuotationInternal`, `hashToken`, `generateToken`, `TOKEN_TTL_MS`, `buildQuotationEmailHtml`) is defined in exactly one task.
- [ ] No placeholders ("TBD", "TODO", "add error handling") in any task body. (`TODO(pipeline-visibility)` comments inside code are intentional hooks documented in §3B.10, not plan placeholders.)
- [ ] Type consistency: `acceptTokenHash` field appears consistently as `accessTokenHash` everywhere (spec uses `accessTokenHash` — confirmed).
- [ ] Test counts tally: Task 3 (6) + Task 5 (2) + Task 6 (6) + Task 7 (4) + Task 10 (7) + Task 11 (5) + Task 12 (4) + Task 13 (3) = 37 new tests. Target was +36; close enough.
