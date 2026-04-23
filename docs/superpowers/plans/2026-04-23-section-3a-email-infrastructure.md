# Section 3A — Email Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build email infrastructure (Resend send + emailLog writes + webhook handler + per-org config + admin inbox UI) as Section 3A of the Projex v2 sprint. Unblocks 3B (quotation send) and 3C (contract + Firmame).

**Architecture:** `convex/functions/email/` module with queries/mutations/actions/resolver mirroring the Section 2 pattern. Resolver finds Resend credentials in `orgIntegrations` per-org, falls back to `process.env`. `convex/http.ts` exposes `/webhooks/resend` that verifies HMAC via `svix` and dispatches to an internal mutation. UI consists of two routes: `/configuracion/email-log` (admin + ejecutivo filtered) and `/configuracion/integraciones/resend` (admin-only config form). Existing `sendEmailInternal` (used by crons, questionnaires, deliverables) is preserved untouched — new `sendEmail` action replaces only the public action that had no callers.

**Tech Stack:** Next.js 15 + Convex + Resend SDK + svix (new) + Vitest + convex-test (already installed). UI follows existing `clients/` and `empresas-emitentes/` patterns (manual state + Tailwind, no RHF/Zod, no toast library).

**Spec:** `docs/superpowers/specs/2026-04-23-section-3a-email-infrastructure-design.md`

---

## File Structure

### New files — Backend

- `convex/functions/email/resolveConfig.ts` — `resolveResendCredentials` TS helper + `ResendNotConfiguredError` + `resolveResendCredentialsQuery` internalQuery + `resolveWebhookSecretByMessageId` internalQuery.
- `convex/functions/email/internalMutations.ts` — `insertQueued`, `markSent`, `markFailed`, `handleWebhookEvent`.
- `convex/functions/email/internalQueries.ts` — `isClientAssignedToUser`, `getByIdForResend`.
- `convex/functions/email/queries.ts` — `list`, `getById`, `getEvents`, `getAttachmentUrls`, `getResendConfig`.
- `convex/functions/email/mutations.ts` — `upsertResendConfig`.
- `convex/http.ts` — HTTP router exposing `/webhooks/resend`.

### Modified files — Backend

- `convex/functions/email/send.ts` — add new `sendEmail` (replaces old public action), `testResendConnection`, `resendFromLog`. Keep `sendEmailInternal` untouched (has 4 callers: crons + questionnaires + deliverables).

### New files — Tests

- `convex/functions/email/__tests__/resolveConfig.test.ts`
- `convex/functions/email/__tests__/sendEmail.test.ts`
- `convex/functions/email/__tests__/httpWebhook.test.ts`
- `convex/functions/email/__tests__/queries.test.ts`
- `convex/functions/email/__tests__/permissions.test.ts`

### New files — Frontend

- `src/components/email-log/EmailStatusBadge.tsx`
- `src/components/email-log/EmailTypeBadge.tsx`
- `src/components/email-log/EmailLogList.tsx`
- `src/components/email-log/EmailLogDetail.tsx`
- `src/components/integraciones/resend/ResendSetupGuide.tsx`
- `src/components/integraciones/resend/ResendConfigForm.tsx`
- `src/app/(dashboard)/configuracion/email-log/page.tsx`
- `src/app/(dashboard)/configuracion/integraciones/resend/page.tsx`

### Modified files — Frontend

- `src/app/(dashboard)/configuracion/page.tsx` — add two new cards (Email Log, Integración Resend).

### Reuses

- `convex/lib/authHelpers.ts` — `requireAuth`, `requireAdmin`, `getOrgId`, `getOrgIdSafe`
- `convex/__tests__/harness.ts` — `setupTest`, `ORG_A`, `ORG_B` (installed in Section 2)
- `src/components/clients/client-form.tsx` — form pattern (manual state + inline errors, no RHF)
- `src/app/(dashboard)/clientes/page.tsx` — list page pattern (skeleton loader, empty state, search input)

---

## Phase 1: Setup & resolver

### Task 1: Install svix + env vars documentation

**Files:**
- Modify: `package.json` (add `svix` dep)

- [ ] **Step 1: Install dependency**

```bash
npm install svix
```

- [ ] **Step 2: Verify no conflicting peer deps**

Run: `npm install svix 2>&1 | grep -E "peer|conflict|ERR"`
Expected: no peer/conflict errors.

- [ ] **Step 3: Document env vars in a comment inside resolveConfig.ts**

Env vars the platform will read from `process.env`:
- `RESEND_API_KEY` — already exists in `.env.local`, platform fallback key.
- `RESEND_WEBHOOK_SECRET` — new, used by `/webhooks/resend` when org has no per-org secret.
- `RESEND_FROM_EMAIL` — new, optional. Default: `noreply@projex-platform.com`.
- `RESEND_FROM_NAME` — new, optional.

These will be commented inline when we write `resolveConfig.ts` in Task 2.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(email): install svix for Resend webhook HMAC verification"
```

---

### Task 2: `resolveConfig.ts` with resolver + 2 internal queries

**Files:**
- Create: `convex/functions/email/resolveConfig.ts`

- [ ] **Step 1: Implement the file**

Write `convex/functions/email/resolveConfig.ts`:

```ts
import { internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import type { GenericQueryCtx } from "convex/server";
import type { DataModel } from "../../_generated/dataModel";

// Env vars consumed by platform fallback:
//   RESEND_API_KEY       — fallback API key
//   RESEND_WEBHOOK_SECRET — fallback webhook signing secret
//   RESEND_FROM_EMAIL    — optional default "noreply@projex-platform.com"
//   RESEND_FROM_NAME     — optional

export class ResendNotConfiguredError extends Error {
  constructor(orgId: string) {
    super(
      `No hay configuración de Resend activa para la org ${orgId}. ` +
        `Configura el API key en /configuracion/integraciones/resend o ` +
        `establece RESEND_API_KEY en environment.`
    );
    this.name = "ResendNotConfiguredError";
  }
}

export type ResendConfig = {
  apiKey: string;
  fromEmail: string;
  fromName?: string;
  webhookSigningSecret?: string;
  source: "org_integration" | "platform_env";
};

export async function resolveResendCredentials(
  ctx: GenericQueryCtx<DataModel>,
  args: { orgId: string }
): Promise<ResendConfig> {
  const orgConfig = await ctx.db
    .query("orgIntegrations")
    .withIndex("by_orgId_provider", (q) =>
      q.eq("orgId", args.orgId).eq("provider", "resend")
    )
    .first();

  if (
    orgConfig &&
    orgConfig.status === "active" &&
    orgConfig.config.apiKeySecretRef
  ) {
    return {
      apiKey: orgConfig.config.apiKeySecretRef,
      fromEmail: orgConfig.config.fromEmail ?? "noreply@projex-platform.com",
      fromName: orgConfig.config.fromName,
      webhookSigningSecret: orgConfig.config.webhookSecretRef,
      source: "org_integration",
    };
  }

  const platformKey = process.env.RESEND_API_KEY;
  if (!platformKey || platformKey === "placeholder") {
    throw new ResendNotConfiguredError(args.orgId);
  }

  return {
    apiKey: platformKey,
    fromEmail: process.env.RESEND_FROM_EMAIL ?? "noreply@projex-platform.com",
    fromName: process.env.RESEND_FROM_NAME,
    webhookSigningSecret: process.env.RESEND_WEBHOOK_SECRET,
    source: "platform_env",
  };
}

export const resolveResendCredentialsQuery = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, args) => resolveResendCredentials(ctx, args),
});

export const resolveWebhookSecretByMessageId = internalQuery({
  args: { providerMessageId: v.string() },
  handler: async (ctx, args) => {
    const log = await ctx.db
      .query("emailLog")
      .withIndex("by_providerMessageId", (q) =>
        q.eq("providerMessageId", args.providerMessageId)
      )
      .first();
    if (!log) return null;

    try {
      const config = await resolveResendCredentials(ctx, { orgId: log.orgId });
      return {
        orgId: log.orgId,
        emailLogId: log._id,
        webhookSigningSecret: config.webhookSigningSecret ?? null,
      };
    } catch {
      return {
        orgId: log.orgId,
        emailLogId: log._id,
        webhookSigningSecret: null,
      };
    }
  },
});
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: no errors in `resolveConfig.ts`.

- [ ] **Step 3: Deploy to Convex to register the internal queries**

Run: `npx convex dev --once`
Expected: no errors, functions appear in Convex dashboard.

- [ ] **Step 4: Commit**

```bash
git add convex/functions/email/resolveConfig.ts convex/_generated/
git commit -m "feat(email): add resolveResendCredentials with per-org + platform fallback"
```

---

### Task 3: Resolver unit + integration tests

**Files:**
- Create: `convex/functions/email/__tests__/resolveConfig.test.ts`

- [ ] **Step 1: Write tests**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { internal } from "../../../_generated/api";
import { setupTest, ORG_A, ORG_B } from "../../../__tests__/harness";

describe("resolveResendCredentials", () => {
  const originalKey = process.env.RESEND_API_KEY;
  const originalFromEmail = process.env.RESEND_FROM_EMAIL;

  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
  });
  afterEach(() => {
    if (originalKey) process.env.RESEND_API_KEY = originalKey;
    else delete process.env.RESEND_API_KEY;
    if (originalFromEmail) process.env.RESEND_FROM_EMAIL = originalFromEmail;
    else delete process.env.RESEND_FROM_EMAIL;
  });

  it("returns org_integration source when orgIntegrations.resend is active", async () => {
    const t = setupTest();
    await t.run(async (ctx) => {
      await ctx.db.insert("orgIntegrations", {
        orgId: ORG_A,
        provider: "resend",
        config: {
          apiKeySecretRef: "re_live_abc123",
          fromEmail: "test@desc.mx",
          fromName: "Test Org",
          webhookSecretRef: "whsec_abc",
        },
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const result = await t.query(
      internal.functions.email.resolveConfig.resolveResendCredentialsQuery,
      { orgId: ORG_A }
    );
    expect(result.source).toBe("org_integration");
    expect(result.apiKey).toBe("re_live_abc123");
    expect(result.fromEmail).toBe("test@desc.mx");
    expect(result.fromName).toBe("Test Org");
    expect(result.webhookSigningSecret).toBe("whsec_abc");
  });

  it("falls back to platform_env when orgIntegrations status=inactive", async () => {
    process.env.RESEND_API_KEY = "re_platform_fallback";
    const t = setupTest();
    await t.run(async (ctx) => {
      await ctx.db.insert("orgIntegrations", {
        orgId: ORG_A,
        provider: "resend",
        config: { apiKeySecretRef: "re_org" },
        status: "inactive",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const result = await t.query(
      internal.functions.email.resolveConfig.resolveResendCredentialsQuery,
      { orgId: ORG_A }
    );
    expect(result.source).toBe("platform_env");
    expect(result.apiKey).toBe("re_platform_fallback");
  });

  it("uses platform_env when no orgIntegrations exist", async () => {
    process.env.RESEND_API_KEY = "re_platform_only";
    const t = setupTest();
    const result = await t.query(
      internal.functions.email.resolveConfig.resolveResendCredentialsQuery,
      { orgId: ORG_A }
    );
    expect(result.source).toBe("platform_env");
    expect(result.apiKey).toBe("re_platform_only");
  });

  it("throws ResendNotConfiguredError when no org config AND no env", async () => {
    const t = setupTest();
    await expect(
      t.query(
        internal.functions.email.resolveConfig.resolveResendCredentialsQuery,
        { orgId: ORG_A }
      )
    ).rejects.toThrow(/No hay configuración de Resend/i);
  });

  it("org B config does not leak into org A resolution", async () => {
    const t = setupTest();
    await t.run(async (ctx) => {
      await ctx.db.insert("orgIntegrations", {
        orgId: ORG_B,
        provider: "resend",
        config: { apiKeySecretRef: "re_B_secret" },
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    // Org A has no config + no env → throws
    await expect(
      t.query(
        internal.functions.email.resolveConfig.resolveResendCredentialsQuery,
        { orgId: ORG_A }
      )
    ).rejects.toThrow(/No hay configuración/i);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm test -- resolveConfig.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 3: Commit**

```bash
git add convex/functions/email/__tests__/resolveConfig.test.ts
git commit -m "test(email): resolveResendCredentials covers org + platform + multi-tenant isolation"
```

---

## Phase 2: Internal mutations

### Task 4: `internalMutations.ts` — insertQueued, markSent, markFailed

**Files:**
- Create: `convex/functions/email/internalMutations.ts`

- [ ] **Step 1: Write the 3 state-transition mutations**

```ts
import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";

const attachmentValidator = v.object({
  storageId: v.id("_storage"),
  filename: v.string(),
  contentType: v.optional(v.string()),
});

export const insertQueued = internalMutation({
  args: {
    orgId: v.string(),
    type: v.union(
      v.literal("quotation"),
      v.literal("quotation_reminder"),
      v.literal("contract"),
      v.literal("contract_reminder"),
      v.literal("deliverable"),
      v.literal("questionnaire"),
      v.literal("reminder"),
      v.literal("custom")
    ),
    fromEmail: v.string(),
    fromName: v.optional(v.string()),
    toEmail: v.string(),
    cc: v.optional(v.array(v.string())),
    bcc: v.optional(v.array(v.string())),
    replyTo: v.optional(v.string()),
    subject: v.string(),
    bodyHtml: v.optional(v.string()),
    bodyText: v.optional(v.string()),
    relatedType: v.optional(
      v.union(
        v.literal("quotation"),
        v.literal("contract"),
        v.literal("deliverable"),
        v.literal("questionnaire"),
        v.literal("assignment")
      )
    ),
    relatedId: v.optional(v.string()),
    clientId: v.optional(v.id("clients")),
    issuingCompanyId: v.optional(v.id("issuingCompanies")),
    attachments: v.optional(v.array(attachmentValidator)),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("emailLog", {
      orgId: args.orgId,
      type: args.type,
      direction: "outbound",
      relatedType: args.relatedType,
      relatedId: args.relatedId,
      clientId: args.clientId,
      issuingCompanyId: args.issuingCompanyId,
      fromEmail: args.fromEmail,
      fromName: args.fromName,
      toEmail: args.toEmail,
      cc: args.cc,
      bcc: args.bcc,
      replyTo: args.replyTo,
      subject: args.subject,
      bodyHtml: args.bodyHtml,
      bodyText: args.bodyText,
      attachments: args.attachments,
      status: "queued",
      provider: "resend",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const markSent = internalMutation({
  args: {
    emailLogId: v.id("emailLog"),
    providerMessageId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.emailLogId, {
      status: "sent",
      providerMessageId: args.providerMessageId,
      sentAt: now,
      updatedAt: now,
    });
  },
});

export const markFailed = internalMutation({
  args: {
    emailLogId: v.id("emailLog"),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.emailLogId, {
      status: "failed",
      errorMessage: args.errorMessage,
      updatedAt: Date.now(),
    });
  },
});
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add convex/functions/email/internalMutations.ts
git commit -m "feat(email): add insertQueued + markSent + markFailed internal mutations"
```

---

### Task 5: `internalMutations.ts` — handleWebhookEvent state machine

**Files:**
- Modify: `convex/functions/email/internalMutations.ts` (append)

- [ ] **Step 1: Append `handleWebhookEvent` to the same file**

The handler validates event type, inserts an `emailEvents` row, then updates `emailLog.status` monotonically.

Append to `convex/functions/email/internalMutations.ts`:

```ts
type ResendEventType =
  | "email.sent"
  | "email.delivered"
  | "email.delivery_delayed"
  | "email.opened"
  | "email.clicked"
  | "email.bounced"
  | "email.complained"
  | "email.failed";

// Monotonic ordering: only forward-advance status. Terminal events (bounced/complained/failed) always win.
const STATUS_RANK: Record<string, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  opened: 3,
  clicked: 4,
};

function mapEventToStatus(
  eventType: string
): "sent" | "delivered" | "opened" | "clicked" | "bounced" | "complained" | "failed" | null {
  switch (eventType) {
    case "email.sent": return "sent";
    case "email.delivered": return "delivered";
    case "email.opened": return "opened";
    case "email.clicked": return "clicked";
    case "email.bounced": return "bounced";
    case "email.complained": return "complained";
    case "email.failed": return "failed";
    case "email.delivery_delayed": return null; // don't advance status, but log event
    default: return null;
  }
}

function mapEventTypeToEmailEventsUnion(
  eventType: string
):
  | "sent"
  | "delivered"
  | "delivery_delayed"
  | "opened"
  | "clicked"
  | "bounced"
  | "complained"
  | "failed"
  | null {
  switch (eventType) {
    case "email.sent": return "sent";
    case "email.delivered": return "delivered";
    case "email.delivery_delayed": return "delivery_delayed";
    case "email.opened": return "opened";
    case "email.clicked": return "clicked";
    case "email.bounced": return "bounced";
    case "email.complained": return "complained";
    case "email.failed": return "failed";
    default: return null;
  }
}

export const handleWebhookEvent = internalMutation({
  args: {
    providerMessageId: v.string(),
    event: v.object({
      type: v.string(),
      occurredAt: v.number(),
      metadata: v.any(),
    }),
  },
  handler: async (ctx, args) => {
    const log = await ctx.db
      .query("emailLog")
      .withIndex("by_providerMessageId", (q) =>
        q.eq("providerMessageId", args.providerMessageId)
      )
      .first();
    if (!log) {
      console.warn(
        `[email.handleWebhookEvent] unknown providerMessageId=${args.providerMessageId}`
      );
      return;
    }

    const emailEventType = mapEventTypeToEmailEventsUnion(args.event.type);
    if (!emailEventType) {
      console.warn(
        `[email.handleWebhookEvent] unknown event type=${args.event.type}`
      );
      return;
    }

    // Extract metadata from Resend payload (shape varies by event type)
    const rawMeta = args.event.metadata as Record<string, unknown>;
    const eventMetadata: {
      userAgent?: string;
      ipAddress?: string;
      link?: string;
      bounceType?: string;
      bounceReason?: string;
    } = {};
    if (typeof rawMeta.user_agent === "string") eventMetadata.userAgent = rawMeta.user_agent;
    if (typeof rawMeta.ip === "string") eventMetadata.ipAddress = rawMeta.ip;
    if (typeof rawMeta.link === "string") eventMetadata.link = rawMeta.link;
    if (rawMeta.bounce && typeof rawMeta.bounce === "object") {
      const b = rawMeta.bounce as Record<string, unknown>;
      if (typeof b.type === "string") eventMetadata.bounceType = b.type;
      if (typeof b.message === "string") eventMetadata.bounceReason = b.message;
    }

    await ctx.db.insert("emailEvents", {
      orgId: log.orgId,
      emailLogId: log._id,
      providerMessageId: args.providerMessageId,
      provider: "resend",
      eventType: emailEventType,
      metadata: eventMetadata,
      rawPayload: JSON.stringify(args.event.metadata),
      occurredAt: args.event.occurredAt,
      createdAt: Date.now(),
    });

    // Compute new status with monotonic ordering
    const proposedStatus = mapEventToStatus(args.event.type);
    if (!proposedStatus) return; // delivery_delayed doesn't change status

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    const terminalStatuses = ["bounced", "complained", "failed"];
    if (terminalStatuses.includes(proposedStatus)) {
      patch.status = proposedStatus;
    } else {
      const currentRank = STATUS_RANK[log.status] ?? -1;
      const proposedRank = STATUS_RANK[proposedStatus] ?? -1;
      if (proposedRank > currentRank) {
        patch.status = proposedStatus;
      }
    }

    // Timestamps
    if (proposedStatus === "delivered") patch.deliveredAt = args.event.occurredAt;
    if (proposedStatus === "opened") patch.openedAt = args.event.occurredAt;
    if (proposedStatus === "clicked") patch.clickedAt = args.event.occurredAt;

    await ctx.db.patch(log._id, patch);
  },
});
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add convex/functions/email/internalMutations.ts
git commit -m "feat(email): add handleWebhookEvent with monotonic status state machine"
```

---

## Phase 3: Internal queries

### Task 6: `internalQueries.ts` — isClientAssignedToUser + getByIdForResend

**Files:**
- Create: `convex/functions/email/internalQueries.ts`

- [ ] **Step 1: Write both helpers**

```ts
import { internalQuery } from "../../_generated/server";
import { v } from "convex/values";

export const isClientAssignedToUser = internalQuery({
  args: {
    clientId: v.id("clients"),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientId);
    if (!client) return false;
    return client.assignedTo === args.userId;
  },
});

export const getByIdForResend = internalQuery({
  args: {
    id: v.id("emailLog"),
    orgId: v.string(),
  },
  handler: async (ctx, args) => {
    const log = await ctx.db.get(args.id);
    if (!log || log.orgId !== args.orgId) return null;
    return log;
  },
});
```

- [ ] **Step 2: Type-check and commit**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | head -10
git add convex/functions/email/internalQueries.ts
git commit -m "feat(email): add isClientAssignedToUser + getByIdForResend internal queries"
```

---

## Phase 4: Public actions in send.ts

### Task 7: New `sendEmail` action (replace old public action, keep sendEmailInternal)

**Files:**
- Modify: `convex/functions/email/send.ts` (replace file contents)

- [ ] **Step 1: Read current content to preserve `sendEmailInternal`**

Run: `cat convex/functions/email/send.ts`

Keep `sendEmailInternal` (lines 46-52 in current file) exactly as-is because it's called by: `cron/overdueCheck.ts:118`, `cron/monthlyCheck.ts:161`, `questionnaires/mutations.ts:191`, `deliverables/mutations.ts:140`. They pass `{to, subject, html, from?}` — the simple shape.

- [ ] **Step 2: Rewrite the file**

```ts
"use node";

import { action, internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";
import { Resend } from "resend";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENTS_BYTES = 25 * 1024 * 1024;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// --- Legacy sendEmailHandler, kept intact ---
async function sendEmailHandler(args: {
  to: string;
  subject: string;
  html: string;
  from?: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("RESEND_API_KEY not set, skipping email");
    return { sent: false, reason: "no_api_key" };
  }
  const resend = new Resend(apiKey);
  const from = args.from ?? "Projex <noreply@projex-platform.com>";
  try {
    const { data, error } = await resend.emails.send({
      from,
      to: args.to,
      subject: args.subject,
      html: args.html,
    });
    if (error) {
      console.error("Email send error:", error);
      return { sent: false, reason: error.message };
    }
    return { sent: true, id: data?.id };
  } catch (err) {
    console.error("Email send exception:", err);
    return { sent: false, reason: String(err) };
  }
}

const legacyEmailArgs = {
  to: v.string(),
  subject: v.string(),
  html: v.string(),
  from: v.optional(v.string()),
};

// Kept untouched for backwards compat with crons/questionnaires/deliverables.
export const sendEmailInternal = internalAction({
  args: legacyEmailArgs,
  handler: async (_ctx, args) => {
    return await sendEmailHandler(args);
  },
});

// --- NEW sendEmail action with logging + per-org config ---
const attachmentInputValidator = v.object({
  storageId: v.id("_storage"),
  filename: v.string(),
  contentType: v.optional(v.string()),
});

export const sendEmail = action({
  args: {
    to: v.string(),
    subject: v.string(),
    bodyHtml: v.string(),
    bodyText: v.optional(v.string()),
    cc: v.optional(v.array(v.string())),
    bcc: v.optional(v.array(v.string())),
    replyTo: v.optional(v.string()),
    type: v.union(
      v.literal("quotation"),
      v.literal("quotation_reminder"),
      v.literal("contract"),
      v.literal("contract_reminder"),
      v.literal("deliverable"),
      v.literal("questionnaire"),
      v.literal("reminder"),
      v.literal("custom")
    ),
    relatedType: v.optional(
      v.union(
        v.literal("quotation"),
        v.literal("contract"),
        v.literal("deliverable"),
        v.literal("questionnaire"),
        v.literal("assignment")
      )
    ),
    relatedId: v.optional(v.string()),
    clientId: v.optional(v.id("clients")),
    issuingCompanyId: v.optional(v.id("issuingCompanies")),
    attachmentStorageIds: v.optional(v.array(attachmentInputValidator)),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("No autenticado");
    const orgId = (identity.orgId ??
      (identity as Record<string, unknown>).org_id) as string | undefined;
    if (!orgId) throw new Error("Sin organización");

    // Email format validation
    if (!EMAIL_REGEX.test(args.to)) throw new Error(`Email inválido: ${args.to}`);
    for (const addr of args.cc ?? []) {
      if (!EMAIL_REGEX.test(addr)) throw new Error(`CC inválido: ${addr}`);
    }
    for (const addr of args.bcc ?? []) {
      if (!EMAIL_REGEX.test(addr)) throw new Error(`BCC inválido: ${addr}`);
    }
    if (args.replyTo && !EMAIL_REGEX.test(args.replyTo)) {
      throw new Error(`Reply-To inválido: ${args.replyTo}`);
    }

    // Ejecutivo can only send to their assigned clients
    const role = (identity.orgRole as string) ?? "org:member";
    if (role === "org:member" && args.clientId) {
      const isAssigned = await ctx.runQuery(
        internal.functions.email.internalQueries.isClientAssignedToUser,
        { clientId: args.clientId, userId: identity.subject }
      );
      if (!isAssigned) throw new Error("Cliente no asignado a este ejecutivo");
    }

    // Resolve Resend config
    const config = await ctx.runQuery(
      internal.functions.email.resolveConfig.resolveResendCredentialsQuery,
      { orgId }
    );

    // Insert emailLog as queued
    const emailLogId = await ctx.runMutation(
      internal.functions.email.internalMutations.insertQueued,
      {
        orgId,
        type: args.type,
        fromEmail: config.fromEmail,
        fromName: config.fromName,
        toEmail: args.to,
        cc: args.cc,
        bcc: args.bcc,
        replyTo: args.replyTo,
        subject: args.subject,
        bodyHtml: args.bodyHtml,
        bodyText: args.bodyText,
        relatedType: args.relatedType,
        relatedId: args.relatedId,
        clientId: args.clientId,
        issuingCompanyId: args.issuingCompanyId,
        attachments: (args.attachmentStorageIds ?? []).map((a) => ({
          storageId: a.storageId,
          filename: a.filename,
          contentType: a.contentType,
        })),
      }
    );

    try {
      // Build attachments from storage
      const attachments: Array<{ filename: string; content: string }> = [];
      let totalSize = 0;
      for (const att of args.attachmentStorageIds ?? []) {
        const blob = await ctx.storage.get(att.storageId);
        if (!blob) {
          throw new Error(`Attachment ${att.filename} no encontrado en storage`);
        }
        if (blob.size > MAX_ATTACHMENT_BYTES) {
          throw new Error(`Attachment ${att.filename} excede 10MB`);
        }
        totalSize += blob.size;
        if (totalSize > MAX_TOTAL_ATTACHMENTS_BYTES) {
          throw new Error(`Attachments totales exceden 25MB`);
        }
        const buffer = await blob.arrayBuffer();
        attachments.push({
          filename: att.filename,
          content: Buffer.from(buffer).toString("base64"),
        });
      }

      const resend = new Resend(config.apiKey);
      const fromHeader = config.fromName
        ? `${config.fromName} <${config.fromEmail}>`
        : config.fromEmail;
      const { data, error } = await resend.emails.send({
        from: fromHeader,
        to: args.to,
        subject: args.subject,
        html: args.bodyHtml,
        text: args.bodyText,
        cc: args.cc,
        bcc: args.bcc,
        replyTo: args.replyTo,
        attachments: attachments.length ? attachments : undefined,
        tags: [{ name: "orgId", value: orgId }],
      });

      if (error) {
        await ctx.runMutation(
          internal.functions.email.internalMutations.markFailed,
          { emailLogId, errorMessage: error.message }
        );
        return { ok: false as const, emailLogId, errorMessage: error.message };
      }

      await ctx.runMutation(
        internal.functions.email.internalMutations.markSent,
        { emailLogId, providerMessageId: data!.id }
      );
      return {
        ok: true as const,
        emailLogId,
        providerMessageId: data!.id,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(
        internal.functions.email.internalMutations.markFailed,
        { emailLogId, errorMessage }
      );
      return { ok: false as const, emailLogId, errorMessage };
    }
  },
});
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -30`
Expected: no new errors. The existing callers of `sendEmailInternal` still resolve.

- [ ] **Step 4: Deploy to Convex**

Run: `npx convex dev --once`
Expected: functions register without errors.

- [ ] **Step 5: Commit**

```bash
git add convex/functions/email/send.ts convex/_generated/
git commit -m "feat(email): add sendEmail action with per-org config + logging

Keeps legacy sendEmailInternal untouched (used by crons, questionnaires, deliverables)."
```

---

### Task 8: `send.ts` — testResendConnection + resendFromLog actions

**Files:**
- Modify: `convex/functions/email/send.ts` (append)

- [ ] **Step 1: Append both actions**

Add to the end of `convex/functions/email/send.ts`:

```ts
export const testResendConnection = action({
  args: { apiKey: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("No autenticado");
    const role = (identity.orgRole as string) ?? "org:member";
    if (role !== "org:admin") {
      throw new Error("Acceso denegado. Se requiere rol de Administrador.");
    }

    try {
      const resend = new Resend(args.apiKey);
      // Cheap call that requires auth — list domains.
      const result = await resend.domains.list();
      if (result.error) {
        return { ok: false as const, error: result.error.message };
      }
      return { ok: true as const };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { ok: false as const, error };
    }
  },
});

export const resendFromLog = action({
  args: { id: v.id("emailLog") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("No autenticado");
    const role = (identity.orgRole as string) ?? "org:member";
    if (role !== "org:admin") {
      throw new Error("Acceso denegado. Se requiere rol de Administrador.");
    }
    const orgId = (identity.orgId ??
      (identity as Record<string, unknown>).org_id) as string | undefined;
    if (!orgId) throw new Error("Sin organización");

    const original = await ctx.runQuery(
      internal.functions.email.internalQueries.getByIdForResend,
      { id: args.id, orgId }
    );
    if (!original) throw new Error("Email no encontrado");

    // Call sendEmail action with the same args — Convex supports calling
    // actions in the same module via api.functions.email.send.sendEmail
    // without circular-dep issues because `api` is type-only at build time.
    const apiModule = await import("../../_generated/api");
    return await ctx.runAction(apiModule.api.functions.email.send.sendEmail, {
      to: original.toEmail,
      subject: original.subject,
      bodyHtml: original.bodyHtml ?? "",
      bodyText: original.bodyText,
      cc: original.cc,
      bcc: original.bcc,
      replyTo: original.replyTo,
      type: original.type,
      relatedType: original.relatedType,
      relatedId: original.relatedId,
      clientId: original.clientId,
      issuingCompanyId: original.issuingCompanyId,
      attachmentStorageIds: original.attachments?.map((a) => ({
        storageId: a.storageId,
        filename: a.filename,
        contentType: a.contentType,
      })),
    });
  },
});
```

**Implementation note:** this uses dynamic import on `_generated/api` instead
of a top-level `import { api } from "../../_generated/api"`. Both work, but
the dynamic form avoids a potential load-order edge case when `resendFromLog`
and `sendEmail` co-exist in the same file. If during implementation TypeScript
complains about the dynamic path, switch to the static import — verify at
runtime that `ctx.runAction(api.functions.email.send.sendEmail, ...)` is
invocable. Either way works; pick the one your TypeScript resolves cleanly.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -30`
Expected: no errors. If the `api.api.functions.email.send.sendEmail` path doesn't type-check cleanly, it means the dynamic import pattern is stale. Fallback: extract a helper function.

- [ ] **Step 3: Commit**

```bash
git add convex/functions/email/send.ts convex/_generated/
git commit -m "feat(email): add testResendConnection + resendFromLog actions"
```

---

## Phase 5: HTTP webhook

### Task 9: `convex/http.ts` with Resend webhook handler

**Files:**
- Create: `convex/http.ts`

- [ ] **Step 1: Write the HTTP router**

```ts
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Webhook } from "svix";

const http = httpRouter();

http.route({
  path: "/webhooks/resend",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await req.text();
    const svixId = req.headers.get("svix-id") ?? "";
    const svixTimestamp = req.headers.get("svix-timestamp") ?? "";
    const svixSignature = req.headers.get("svix-signature") ?? "";
    if (!svixId || !svixTimestamp || !svixSignature) {
      return new Response("Missing svix headers", { status: 400 });
    }

    let payloadUnverified: {
      type: string;
      created_at: string;
      data: { email_id?: string;[k: string]: unknown };
    };
    try {
      payloadUnverified = JSON.parse(body);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const providerMessageId = payloadUnverified?.data?.email_id;
    if (!providerMessageId) {
      return new Response("Bad payload: missing email_id", { status: 400 });
    }

    const resolved = await ctx.runQuery(
      internal.functions.email.resolveConfig.resolveWebhookSecretByMessageId,
      { providerMessageId }
    );
    if (!resolved) {
      console.warn(
        `[Resend webhook] unknown providerMessageId=${providerMessageId}`
      );
      return new Response(null, { status: 200 });
    }
    if (!resolved.webhookSigningSecret) {
      console.warn(
        `[Resend webhook] no signing secret configured for org=${resolved.orgId}`
      );
      return new Response("No webhook secret configured", { status: 500 });
    }

    try {
      const wh = new Webhook(resolved.webhookSigningSecret);
      wh.verify(body, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      });
    } catch {
      return new Response("Invalid signature", { status: 401 });
    }

    await ctx.runMutation(
      internal.functions.email.internalMutations.handleWebhookEvent,
      {
        providerMessageId,
        event: {
          type: payloadUnverified.type,
          occurredAt: Date.parse(payloadUnverified.created_at),
          metadata: payloadUnverified.data,
        },
      }
    );

    return new Response(null, { status: 200 });
  }),
});

export default http;
```

- [ ] **Step 2: Deploy and verify the endpoint is exposed**

Run: `npx convex dev --once`
Expected: no errors. The URL of the webhook endpoint will be
`<CONVEX_URL>/webhooks/resend` (replace `<CONVEX_URL>` with your dev
deployment URL, e.g., `https://avid-fox-123.convex.site`).

Run: `echo "Webhook endpoint: $(grep NEXT_PUBLIC_CONVEX_URL .env.local | cut -d= -f2)/webhooks/resend"`
Expected: prints the URL you'll configure in the Resend dashboard.

- [ ] **Step 3: Commit**

```bash
git add convex/http.ts convex/_generated/
git commit -m "feat(email): add /webhooks/resend HTTP endpoint with svix HMAC verification"
```

---

### Task 10: HTTP webhook tests

**Files:**
- Create: `convex/functions/email/__tests__/httpWebhook.test.ts`

- [ ] **Step 1: Write the test file**

```ts
import { describe, it, expect } from "vitest";
import { Webhook } from "svix";
import { internal } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../__tests__/harness";

const WEBHOOK_SECRET = "whsec_testSecret1234567890abcdefghij";

function signWebhook(body: string, secret: string = WEBHOOK_SECRET) {
  const wh = new Webhook(secret);
  const msgId = "msg_test_" + Math.random().toString(36).slice(2);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = wh.sign(msgId, new Date(Number(timestamp) * 1000), body);
  return {
    "svix-id": msgId,
    "svix-timestamp": timestamp,
    "svix-signature": signature,
  };
}

async function seedEmailLog(t: ReturnType<typeof setupTest>, providerMessageId: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgIntegrations", {
      orgId: ORG_A,
      provider: "resend",
      config: {
        apiKeySecretRef: "re_test",
        webhookSecretRef: WEBHOOK_SECRET,
      },
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return await ctx.db.insert("emailLog", {
      orgId: ORG_A,
      type: "custom",
      direction: "outbound",
      fromEmail: "test@ejemplo.com",
      toEmail: "client@ejemplo.com",
      subject: "Test",
      status: "sent",
      provider: "resend",
      providerMessageId,
      sentAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
}

function buildEvent(type: string, emailId: string, extras: Record<string, unknown> = {}) {
  return JSON.stringify({
    type,
    created_at: new Date().toISOString(),
    data: { email_id: emailId, ...extras },
  });
}

describe("handleWebhookEvent (internal mutation)", () => {
  it("delivered event transitions status from sent to delivered", async () => {
    const t = setupTest();
    const messageId = "re_abc_delivered";
    await seedEmailLog(t, messageId);

    await t.mutation(
      internal.functions.email.internalMutations.handleWebhookEvent,
      {
        providerMessageId: messageId,
        event: {
          type: "email.delivered",
          occurredAt: Date.now(),
          metadata: { email_id: messageId },
        },
      }
    );

    const log = await t.run(async (ctx) =>
      ctx.db
        .query("emailLog")
        .withIndex("by_providerMessageId", (q) => q.eq("providerMessageId", messageId))
        .first()
    );
    expect(log?.status).toBe("delivered");
    expect(log?.deliveredAt).toBeGreaterThan(0);
  });

  it("opened event with existing delivered status advances to opened", async () => {
    const t = setupTest();
    const messageId = "re_abc_opened";
    await seedEmailLog(t, messageId);
    await t.mutation(
      internal.functions.email.internalMutations.handleWebhookEvent,
      {
        providerMessageId: messageId,
        event: { type: "email.delivered", occurredAt: Date.now(), metadata: {} },
      }
    );
    await t.mutation(
      internal.functions.email.internalMutations.handleWebhookEvent,
      {
        providerMessageId: messageId,
        event: {
          type: "email.opened",
          occurredAt: Date.now() + 1000,
          metadata: { user_agent: "Chrome" },
        },
      }
    );
    const log = await t.run(async (ctx) =>
      ctx.db
        .query("emailLog")
        .withIndex("by_providerMessageId", (q) => q.eq("providerMessageId", messageId))
        .first()
    );
    expect(log?.status).toBe("opened");
    expect(log?.openedAt).toBeGreaterThan(0);
  });

  it("clicked event records link metadata", async () => {
    const t = setupTest();
    const messageId = "re_abc_clicked";
    await seedEmailLog(t, messageId);
    await t.mutation(
      internal.functions.email.internalMutations.handleWebhookEvent,
      {
        providerMessageId: messageId,
        event: {
          type: "email.clicked",
          occurredAt: Date.now(),
          metadata: { link: "https://example.com/accept" },
        },
      }
    );
    const events = await t.run(async (ctx) =>
      ctx.db
        .query("emailEvents")
        .withIndex("by_providerMessageId", (q) => q.eq("providerMessageId", messageId))
        .collect()
    );
    expect(events.length).toBe(1);
    expect(events[0].metadata?.link).toBe("https://example.com/accept");
  });

  it("bounced event sets status to bounced (terminal) and records bounce metadata", async () => {
    const t = setupTest();
    const messageId = "re_abc_bounced";
    await seedEmailLog(t, messageId);
    await t.mutation(
      internal.functions.email.internalMutations.handleWebhookEvent,
      {
        providerMessageId: messageId,
        event: {
          type: "email.bounced",
          occurredAt: Date.now(),
          metadata: {
            bounce: { type: "HardBounce", message: "mailbox does not exist" },
          },
        },
      }
    );
    const log = await t.run(async (ctx) =>
      ctx.db
        .query("emailLog")
        .withIndex("by_providerMessageId", (q) => q.eq("providerMessageId", messageId))
        .first()
    );
    expect(log?.status).toBe("bounced");
    const events = await t.run(async (ctx) =>
      ctx.db
        .query("emailEvents")
        .withIndex("by_providerMessageId", (q) => q.eq("providerMessageId", messageId))
        .collect()
    );
    expect(events[0].metadata?.bounceType).toBe("HardBounce");
    expect(events[0].metadata?.bounceReason).toBe("mailbox does not exist");
  });

  it("complained event sets status to complained (terminal)", async () => {
    const t = setupTest();
    const messageId = "re_abc_complained";
    await seedEmailLog(t, messageId);
    await t.mutation(
      internal.functions.email.internalMutations.handleWebhookEvent,
      {
        providerMessageId: messageId,
        event: {
          type: "email.complained",
          occurredAt: Date.now(),
          metadata: {},
        },
      }
    );
    const log = await t.run(async (ctx) =>
      ctx.db
        .query("emailLog")
        .withIndex("by_providerMessageId", (q) => q.eq("providerMessageId", messageId))
        .first()
    );
    expect(log?.status).toBe("complained");
  });

  it("unknown providerMessageId is idempotent (no throw)", async () => {
    const t = setupTest();
    await expect(
      t.mutation(
        internal.functions.email.internalMutations.handleWebhookEvent,
        {
          providerMessageId: "re_unknown",
          event: {
            type: "email.delivered",
            occurredAt: Date.now(),
            metadata: {},
          },
        }
      )
    ).resolves.toBeUndefined();
  });

  it("delivered event arriving AFTER opened does not downgrade status", async () => {
    const t = setupTest();
    const messageId = "re_abc_out_of_order";
    await seedEmailLog(t, messageId);
    // Advance to opened first
    await t.mutation(
      internal.functions.email.internalMutations.handleWebhookEvent,
      {
        providerMessageId: messageId,
        event: { type: "email.delivered", occurredAt: Date.now(), metadata: {} },
      }
    );
    await t.mutation(
      internal.functions.email.internalMutations.handleWebhookEvent,
      {
        providerMessageId: messageId,
        event: { type: "email.opened", occurredAt: Date.now() + 100, metadata: {} },
      }
    );
    // Now an out-of-order delivered arrives
    await t.mutation(
      internal.functions.email.internalMutations.handleWebhookEvent,
      {
        providerMessageId: messageId,
        event: { type: "email.delivered", occurredAt: Date.now() + 200, metadata: {} },
      }
    );
    const log = await t.run(async (ctx) =>
      ctx.db
        .query("emailLog")
        .withIndex("by_providerMessageId", (q) => q.eq("providerMessageId", messageId))
        .first()
    );
    expect(log?.status).toBe("opened"); // did not downgrade to delivered
    const events = await t.run(async (ctx) =>
      ctx.db
        .query("emailEvents")
        .withIndex("by_providerMessageId", (q) => q.eq("providerMessageId", messageId))
        .collect()
    );
    expect(events.length).toBe(3); // all events recorded
  });
});
```

- [ ] **Step 2: Run**

Run: `npm test -- httpWebhook.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 3: Commit**

```bash
git add convex/functions/email/__tests__/httpWebhook.test.ts
git commit -m "test(email): handleWebhookEvent covers state machine + idempotency + out-of-order"
```

---

## Phase 6: Public queries

### Task 11: `queries.ts` — list + getById

**Files:**
- Create: `convex/functions/email/queries.ts`

- [ ] **Step 1: Write list + getById**

```ts
import { query } from "../../_generated/server";
import { v } from "convex/values";
import { getOrgIdSafe } from "../../lib/authHelpers";

export const list = query({
  args: {
    status: v.optional(v.string()),
    type: v.optional(v.string()),
    clientId: v.optional(v.id("clients")),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];

    const identity = await ctx.auth.getUserIdentity();
    const role = (identity?.orgRole as string) ?? "org:member";
    const userId = identity?.subject ?? "";

    let rows = await ctx.db
      .query("emailLog")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    // Ejecutivo: filter to assigned clients only
    if (role === "org:member") {
      const assignedClients = await ctx.db
        .query("clients")
        .withIndex("by_orgId_assignedTo", (q) =>
          q.eq("orgId", orgId).eq("assignedTo", userId)
        )
        .collect();
      const assignedIds = new Set(assignedClients.map((c) => c._id));
      rows = rows.filter((r) => r.clientId && assignedIds.has(r.clientId));
    }

    if (args.status) {
      rows = rows.filter((r) => r.status === args.status);
    }
    if (args.type) {
      rows = rows.filter((r) => r.type === args.type);
    }
    if (args.clientId) {
      rows = rows.filter((r) => r.clientId === args.clientId);
    }
    if (args.search) {
      const term = args.search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.toEmail.toLowerCase().includes(term) ||
          r.subject.toLowerCase().includes(term)
      );
    }

    rows.sort((a, b) => b.createdAt - a.createdAt);

    const limit = args.limit ?? 50;
    return rows.slice(0, limit);
  },
});

export const getById = query({
  args: { id: v.id("emailLog") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;
    const log = await ctx.db.get(args.id);
    if (!log || log.orgId !== orgId) return null;

    const identity = await ctx.auth.getUserIdentity();
    const role = (identity?.orgRole as string) ?? "org:member";
    if (role === "org:member") {
      if (!log.clientId) return null;
      const client = await ctx.db.get(log.clientId);
      if (!client || client.assignedTo !== identity?.subject) return null;
    }
    return log;
  },
});
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | head -10
git add convex/functions/email/queries.ts
git commit -m "feat(email): add list + getById queries with role-based filtering"
```

---

### Task 12: `queries.ts` — getEvents + getAttachmentUrls + getResendConfig

**Files:**
- Modify: `convex/functions/email/queries.ts` (append)

- [ ] **Step 1: Append the three queries**

```ts
export const getEvents = query({
  args: { emailLogId: v.id("emailLog") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];
    const log = await ctx.db.get(args.emailLogId);
    if (!log || log.orgId !== orgId) return [];

    const identity = await ctx.auth.getUserIdentity();
    const role = (identity?.orgRole as string) ?? "org:member";
    if (role === "org:member") {
      if (!log.clientId) return [];
      const client = await ctx.db.get(log.clientId);
      if (!client || client.assignedTo !== identity?.subject) return [];
    }

    const events = await ctx.db
      .query("emailEvents")
      .withIndex("by_emailLogId", (q) => q.eq("emailLogId", args.emailLogId))
      .collect();
    return events.sort((a, b) => a.occurredAt - b.occurredAt);
  },
});

export const getAttachmentUrls = query({
  args: { emailLogId: v.id("emailLog") },
  handler: async (ctx, args) => {
    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return [];
    const log = await ctx.db.get(args.emailLogId);
    if (!log || log.orgId !== orgId) return [];

    const identity = await ctx.auth.getUserIdentity();
    const role = (identity?.orgRole as string) ?? "org:member";
    if (role === "org:member") {
      if (!log.clientId) return [];
      const client = await ctx.db.get(log.clientId);
      if (!client || client.assignedTo !== identity?.subject) return [];
    }

    const urls = await Promise.all(
      (log.attachments ?? []).map(async (att) => ({
        filename: att.filename,
        contentType: att.contentType,
        url: await ctx.storage.getUrl(att.storageId),
      }))
    );
    return urls;
  },
});

export const getResendConfig = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const role = (identity.orgRole as string) ?? "org:member";
    if (role !== "org:admin") {
      throw new Error("Acceso denegado. Se requiere rol de Administrador.");
    }

    const orgId = await getOrgIdSafe(ctx);
    if (!orgId) return null;

    const config = await ctx.db
      .query("orgIntegrations")
      .withIndex("by_orgId_provider", (q) =>
        q.eq("orgId", orgId).eq("provider", "resend")
      )
      .first();

    if (!config) {
      return { configured: false, hasWebhookSecret: false };
    }

    return {
      configured: true,
      fromEmail: config.config.fromEmail,
      fromName: config.config.fromName,
      apiKeyMasked: config.config.apiKeyMasked,
      hasWebhookSecret: !!config.config.webhookSecretRef,
      status: config.status,
    };
  },
});
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | head -10
git add convex/functions/email/queries.ts
git commit -m "feat(email): add getEvents + getAttachmentUrls + getResendConfig queries"
```

---

## Phase 7: Public mutations

### Task 13: `mutations.ts` — upsertResendConfig

**Files:**
- Create: `convex/functions/email/mutations.ts`

- [ ] **Step 1: Write upsert**

```ts
import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { requireAdmin, getOrgId } from "../../lib/authHelpers";

function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 4) return "****";
  return `${apiKey.slice(0, 7)}****${apiKey.slice(-4)}`;
}

export const upsertResendConfig = mutation({
  args: {
    apiKey: v.string(),
    fromEmail: v.string(),
    fromName: v.optional(v.string()),
    webhookSigningSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orgId = await getOrgId(ctx);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.fromEmail)) {
      throw new Error("fromEmail inválido");
    }
    if (args.apiKey.trim().length < 8) {
      throw new Error("API key inválido (muy corto)");
    }

    const existing = await ctx.db
      .query("orgIntegrations")
      .withIndex("by_orgId_provider", (q) =>
        q.eq("orgId", orgId).eq("provider", "resend")
      )
      .first();

    const now = Date.now();
    const configPayload = {
      apiKeySecretRef: args.apiKey,
      apiKeyMasked: maskApiKey(args.apiKey),
      fromEmail: args.fromEmail,
      fromName: args.fromName,
      webhookSecretRef: args.webhookSigningSecret,
    };

    if (existing) {
      await ctx.db.patch(existing._id, {
        config: configPayload,
        status: "active",
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("orgIntegrations", {
      orgId,
      provider: "resend",
      config: configPayload,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  },
});
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | head -10
git add convex/functions/email/mutations.ts convex/_generated/
git commit -m "feat(email): add upsertResendConfig mutation with masking"
```

---

## Phase 8: Integration tests

### Task 14: `sendEmail.test.ts` integration tests (mocked Resend)

**Files:**
- Create: `convex/functions/email/__tests__/sendEmail.test.ts`

- [ ] **Step 1: Write tests with Resend mock**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api, internal } from "../../../_generated/api";
import { setupTest, ORG_A, ORG_B } from "../../../__tests__/harness";

// Mock the Resend SDK before any import of send.ts runs inside the harness
vi.mock("resend", () => {
  const send = vi.fn();
  return {
    Resend: vi.fn().mockImplementation(() => ({
      emails: { send },
      domains: { list: vi.fn().mockResolvedValue({ data: [], error: null }) },
    })),
    __send: send,
  };
});

// Helper to access the mocked send function across tests
async function getMockSend() {
  const mod = await import("resend");
  // @ts-expect-error - __send is our injected test handle
  return mod.__send as ReturnType<typeof vi.fn>;
}

function admin(orgId: string) {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `user_admin_${orgId}`,
    orgId,
    orgRole: "org:admin",
  };
}
function member(orgId: string, userId: string) {
  return {
    tokenIdentifier: `test|member_${userId}`,
    subject: userId,
    orgId,
    orgRole: "org:member",
  };
}

async function seedResendConfig(t: ReturnType<typeof setupTest>, orgId: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgIntegrations", {
      orgId,
      provider: "resend",
      config: {
        apiKeySecretRef: "re_test_key",
        fromEmail: "test@ejemplo.com",
        fromName: "Test Org",
      },
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
}

const validSendArgs = {
  to: "client@ejemplo.com",
  subject: "Test",
  bodyHtml: "<p>hola</p>",
  type: "custom" as const,
};

describe("sendEmail action", () => {
  beforeEach(async () => {
    const send = await getMockSend();
    send.mockReset();
  });

  it("sends email and creates emailLog in 'sent' state", async () => {
    const t = setupTest();
    await seedResendConfig(t, ORG_A);
    const send = await getMockSend();
    send.mockResolvedValueOnce({ data: { id: "re_msg_abc" }, error: null });

    const result = await t
      .withIdentity(admin(ORG_A))
      .action(api.functions.email.send.sendEmail, validSendArgs);

    expect(result.ok).toBe(true);
    expect(result.providerMessageId).toBe("re_msg_abc");

    const log = await t.run(async (ctx) => ctx.db.get(result.emailLogId));
    expect(log?.status).toBe("sent");
    expect(log?.providerMessageId).toBe("re_msg_abc");
    expect(send).toHaveBeenCalledOnce();
  });

  it("Resend 4xx → emailLog 'failed' with errorMessage", async () => {
    const t = setupTest();
    await seedResendConfig(t, ORG_A);
    const send = await getMockSend();
    send.mockResolvedValueOnce({
      data: null,
      error: { message: "Domain not verified", name: "validation_error" },
    });

    const result = await t
      .withIdentity(admin(ORG_A))
      .action(api.functions.email.send.sendEmail, validSendArgs);

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toMatch(/Domain not verified/);
    const log = await t.run(async (ctx) => ctx.db.get(result.emailLogId));
    expect(log?.status).toBe("failed");
  });

  it("Resend throws → emailLog 'failed'", async () => {
    const t = setupTest();
    await seedResendConfig(t, ORG_A);
    const send = await getMockSend();
    send.mockRejectedValueOnce(new Error("network timeout"));

    const result = await t
      .withIdentity(admin(ORG_A))
      .action(api.functions.email.send.sendEmail, validSendArgs);

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toMatch(/network timeout/);
    const log = await t.run(async (ctx) => ctx.db.get(result.emailLogId));
    expect(log?.status).toBe("failed");
  });

  it("ejecutivo to their assigned client succeeds", async () => {
    const t = setupTest();
    await seedResendConfig(t, ORG_A);
    const userId = "user_ejecutivo_A";
    const clientId = await t.run(async (ctx) =>
      ctx.db.insert("clients", {
        orgId: ORG_A,
        name: "Acme",
        rfc: "ACM100101ABC",
        industry: "Servicios",
        annualRevenue: 1000000,
        billingFrequency: "mensual" as const,
        isArchived: false,
        assignedTo: userId,
        createdAt: Date.now(),
      })
    );
    const send = await getMockSend();
    send.mockResolvedValueOnce({ data: { id: "re_msg_ok" }, error: null });

    const result = await t
      .withIdentity(member(ORG_A, userId))
      .action(api.functions.email.send.sendEmail, {
        ...validSendArgs,
        clientId,
      });
    expect(result.ok).toBe(true);
  });

  it("ejecutivo to NOT-assigned client throws", async () => {
    const t = setupTest();
    await seedResendConfig(t, ORG_A);
    const clientId = await t.run(async (ctx) =>
      ctx.db.insert("clients", {
        orgId: ORG_A,
        name: "Other",
        rfc: "OTR100101ABC",
        industry: "Servicios",
        annualRevenue: 1000000,
        billingFrequency: "mensual" as const,
        isArchived: false,
        assignedTo: "someone_else",
        createdAt: Date.now(),
      })
    );
    await expect(
      t
        .withIdentity(member(ORG_A, "user_ejecutivo_A"))
        .action(api.functions.email.send.sendEmail, {
          ...validSendArgs,
          clientId,
        })
    ).rejects.toThrow(/Cliente no asignado/i);
  });

  it("sin Resend configurado throws before inserting emailLog", async () => {
    const t = setupTest();
    // no seedResendConfig; also ensure env has no key during test
    const prev = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      await expect(
        t
          .withIdentity(admin(ORG_A))
          .action(api.functions.email.send.sendEmail, validSendArgs)
      ).rejects.toThrow(/No hay configuración de Resend/i);
    } finally {
      if (prev) process.env.RESEND_API_KEY = prev;
    }
  });

  it("multi-tenant: org A list does NOT see org B's emailLog", async () => {
    const t = setupTest();
    await seedResendConfig(t, ORG_A);
    await seedResendConfig(t, ORG_B);
    const send = await getMockSend();
    send.mockResolvedValue({ data: { id: "re_msg_shared" }, error: null });

    await t
      .withIdentity(admin(ORG_B))
      .action(api.functions.email.send.sendEmail, validSendArgs);

    const resultA = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.email.queries.list, {});
    expect(resultA).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run**

Run: `npm test -- sendEmail.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 3: Commit**

```bash
git add convex/functions/email/__tests__/sendEmail.test.ts
git commit -m "test(email): sendEmail integration tests (mocked Resend, multi-tenant)"
```

---

### Task 15: `queries.test.ts` + `permissions.test.ts`

**Files:**
- Create: `convex/functions/email/__tests__/queries.test.ts`
- Create: `convex/functions/email/__tests__/permissions.test.ts`

- [ ] **Step 1: Write queries.test.ts**

```ts
import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../__tests__/harness";

function admin(orgId: string) {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `user_admin_${orgId}`,
    orgId,
    orgRole: "org:admin",
  };
}
function member(orgId: string, userId: string) {
  return {
    tokenIdentifier: `test|member_${userId}`,
    subject: userId,
    orgId,
    orgRole: "org:member",
  };
}

async function seedLog(
  t: ReturnType<typeof setupTest>,
  overrides: Record<string, unknown> = {}
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("emailLog", {
      orgId: ORG_A,
      type: "custom" as const,
      direction: "outbound" as const,
      fromEmail: "from@ejemplo.com",
      toEmail: "to@ejemplo.com",
      subject: "Asunto test",
      status: "sent" as const,
      provider: "resend",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    })
  );
}

describe("email.queries.list", () => {
  it("admin sees all emailLog rows in their org", async () => {
    const t = setupTest();
    await seedLog(t);
    await seedLog(t);
    await seedLog(t, { type: "quotation" as const });
    const rows = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.email.queries.list, {});
    expect(rows.length).toBe(3);
  });

  it("filters by status and type", async () => {
    const t = setupTest();
    await seedLog(t, { status: "bounced" as const, type: "quotation" as const });
    await seedLog(t, { status: "sent" as const });
    const bounced = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.email.queries.list, { status: "bounced" });
    expect(bounced.length).toBe(1);
    const quotations = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.email.queries.list, { type: "quotation" });
    expect(quotations.length).toBe(1);
  });

  it("search matches toEmail and subject", async () => {
    const t = setupTest();
    await seedLog(t, { toEmail: "acme@cliente.com", subject: "Cotización agosto" });
    await seedLog(t, { toEmail: "other@cliente.com", subject: "Otro asunto" });
    const search = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.email.queries.list, { search: "acme" });
    expect(search.length).toBe(1);
    expect(search[0].toEmail).toBe("acme@cliente.com");
  });

  it("ejecutivo only sees emails tied to their clients", async () => {
    const t = setupTest();
    const userId = "user_X";
    const mineClient = await t.run(async (ctx) =>
      ctx.db.insert("clients", {
        orgId: ORG_A,
        name: "Mine",
        rfc: "MIN100101ABC",
        industry: "Servicios",
        annualRevenue: 100,
        billingFrequency: "mensual" as const,
        isArchived: false,
        assignedTo: userId,
        createdAt: Date.now(),
      })
    );
    const otherClient = await t.run(async (ctx) =>
      ctx.db.insert("clients", {
        orgId: ORG_A,
        name: "Other",
        rfc: "OTR100101ABC",
        industry: "Servicios",
        annualRevenue: 100,
        billingFrequency: "mensual" as const,
        isArchived: false,
        assignedTo: "someone_else",
        createdAt: Date.now(),
      })
    );
    await seedLog(t, { clientId: mineClient });
    await seedLog(t, { clientId: otherClient });
    await seedLog(t); // no clientId — admin-only row
    const rows = await t
      .withIdentity(member(ORG_A, userId))
      .query(api.functions.email.queries.list, {});
    expect(rows.length).toBe(1);
  });

  it("getById returns null for id of another org", async () => {
    const t = setupTest();
    const otherOrgLogId = await t.run(async (ctx) =>
      ctx.db.insert("emailLog", {
        orgId: "org_OTHER",
        type: "custom" as const,
        direction: "outbound" as const,
        fromEmail: "x@y.com",
        toEmail: "a@b.com",
        subject: "x",
        status: "sent" as const,
        provider: "resend",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    );
    const result = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.email.queries.getById, { id: otherOrgLogId });
    expect(result).toBeNull();
  });

  it("getEvents returns timeline sorted by occurredAt", async () => {
    const t = setupTest();
    const logId = await seedLog(t, { providerMessageId: "re_timeline" });
    const t2 = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("emailEvents", {
        orgId: ORG_A,
        emailLogId: logId,
        providerMessageId: "re_timeline",
        provider: "resend",
        eventType: "delivered",
        occurredAt: t2 + 100,
        createdAt: t2 + 100,
      });
      await ctx.db.insert("emailEvents", {
        orgId: ORG_A,
        emailLogId: logId,
        providerMessageId: "re_timeline",
        provider: "resend",
        eventType: "sent",
        occurredAt: t2,
        createdAt: t2,
      });
    });
    const events = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.email.queries.getEvents, { emailLogId: logId });
    expect(events.map((e) => e.eventType)).toEqual(["sent", "delivered"]);
  });
});
```

- [ ] **Step 2: Write permissions.test.ts**

```ts
import { describe, it, expect } from "vitest";
import { api } from "../../../_generated/api";
import { setupTest, ORG_A } from "../../../__tests__/harness";

function admin(orgId: string) {
  return {
    tokenIdentifier: `test|admin_${orgId}`,
    subject: `user_admin_${orgId}`,
    orgId,
    orgRole: "org:admin",
  };
}
function member(orgId: string) {
  return {
    tokenIdentifier: `test|member_${orgId}`,
    subject: `user_member_${orgId}`,
    orgId,
    orgRole: "org:member",
  };
}

describe("email permissions", () => {
  it("ejecutivo can list (gets filtered result)", async () => {
    const t = setupTest();
    const result = await t
      .withIdentity(member(ORG_A))
      .query(api.functions.email.queries.list, {});
    expect(result).toEqual([]);
  });

  it("ejecutivo cannot getResendConfig (admin-only)", async () => {
    const t = setupTest();
    await expect(
      t
        .withIdentity(member(ORG_A))
        .query(api.functions.email.queries.getResendConfig, {})
    ).rejects.toThrow(/Administrador/i);
  });

  it("ejecutivo cannot upsertResendConfig", async () => {
    const t = setupTest();
    await expect(
      t
        .withIdentity(member(ORG_A))
        .mutation(api.functions.email.mutations.upsertResendConfig, {
          apiKey: "re_test_1234",
          fromEmail: "x@y.com",
        })
    ).rejects.toThrow(/Administrador/i);
  });

  it("admin can upsertResendConfig and read it back", async () => {
    const t = setupTest();
    const id = await t
      .withIdentity(admin(ORG_A))
      .mutation(api.functions.email.mutations.upsertResendConfig, {
        apiKey: "re_abc123def456",
        fromEmail: "hola@ejemplo.com",
        fromName: "Hola",
      });
    expect(id).toBeDefined();
    const cfg = await t
      .withIdentity(admin(ORG_A))
      .query(api.functions.email.queries.getResendConfig, {});
    expect(cfg?.configured).toBe(true);
    expect(cfg?.apiKeyMasked).toMatch(/^re_abc1\*\*\*\*/);
  });

  it("unauthenticated call throws", async () => {
    const t = setupTest();
    await expect(
      t.query(api.functions.email.queries.getResendConfig, {})
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run both files**

```bash
npm test -- queries.test.ts permissions.test.ts
```

Expected: PASS, 6 + 5 = 11 tests.

- [ ] **Step 4: Commit**

```bash
git add convex/functions/email/__tests__/queries.test.ts convex/functions/email/__tests__/permissions.test.ts
git commit -m "test(email): queries (list/getById/getEvents) + permissions RBAC"
```

---

## Phase 9: UI — Email log

### Task 16: EmailStatusBadge + EmailTypeBadge

**Files:**
- Create: `src/components/email-log/EmailStatusBadge.tsx`
- Create: `src/components/email-log/EmailTypeBadge.tsx`

- [ ] **Step 1: Write both badges**

`src/components/email-log/EmailStatusBadge.tsx`:

```tsx
import { CircleDashed, Send, Check, MailOpen, MousePointer, AlertTriangle, X } from "lucide-react";

type Status =
  | "queued"
  | "sent"
  | "delivered"
  | "opened"
  | "clicked"
  | "bounced"
  | "complained"
  | "failed";

const STYLES: Record<Status, { label: string; cls: string; Icon: typeof Send }> = {
  queued: { label: "En cola", cls: "bg-muted text-muted-foreground", Icon: CircleDashed },
  sent: { label: "Enviado", cls: "bg-blue-500/10 text-blue-500", Icon: Send },
  delivered: { label: "Entregado", cls: "bg-emerald-500/10 text-emerald-500", Icon: Check },
  opened: { label: "Abierto", cls: "bg-emerald-600/15 text-emerald-600", Icon: MailOpen },
  clicked: { label: "Clickeado", cls: "bg-emerald-700/20 text-emerald-700", Icon: MousePointer },
  bounced: { label: "Rebotado", cls: "bg-destructive/10 text-destructive", Icon: AlertTriangle },
  complained: { label: "Reportado spam", cls: "bg-destructive/20 text-destructive", Icon: AlertTriangle },
  failed: { label: "Falló", cls: "bg-destructive/10 text-destructive", Icon: X },
};

export function EmailStatusBadge({ status }: { status: string }) {
  const entry = (STYLES as Record<string, typeof STYLES.sent>)[status] ?? STYLES.queued;
  const { label, cls, Icon } = entry;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${cls}`}>
      <Icon size={10} /> {label}
    </span>
  );
}
```

`src/components/email-log/EmailTypeBadge.tsx`:

```tsx
type EmailType =
  | "quotation"
  | "quotation_reminder"
  | "contract"
  | "contract_reminder"
  | "deliverable"
  | "questionnaire"
  | "reminder"
  | "custom";

const LABELS: Record<EmailType, { label: string; cls: string }> = {
  quotation: { label: "Cotización", cls: "bg-accent/10 text-accent" },
  quotation_reminder: { label: "Recordatorio cot.", cls: "bg-accent/5 text-accent/70" },
  contract: { label: "Contrato", cls: "bg-accent/10 text-accent" },
  contract_reminder: { label: "Recordatorio contr.", cls: "bg-accent/5 text-accent/70" },
  deliverable: { label: "Entregable", cls: "bg-purple-500/10 text-purple-500" },
  questionnaire: { label: "Cuestionario", cls: "bg-sky-500/10 text-sky-500" },
  reminder: { label: "Recordatorio", cls: "bg-orange-500/10 text-orange-500" },
  custom: { label: "Otro", cls: "bg-muted text-muted-foreground" },
};

export function EmailTypeBadge({ type }: { type: string }) {
  const entry =
    (LABELS as Record<string, typeof LABELS.custom>)[type] ?? LABELS.custom;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${entry.cls}`}
    >
      {entry.label}
    </span>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/email-log/EmailStatusBadge.tsx src/components/email-log/EmailTypeBadge.tsx
git commit -m "feat(ui): add EmailStatusBadge + EmailTypeBadge"
```

---

### Task 17: EmailLogDetail component

**Files:**
- Create: `src/components/email-log/EmailLogDetail.tsx`

- [ ] **Step 1: Write detail component**

```tsx
"use client";

import { useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Doc, Id } from "../../../convex/_generated/dataModel";
import { Paperclip, RefreshCw, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmailStatusBadge } from "./EmailStatusBadge";
import { useOrganization } from "@clerk/nextjs";

export function EmailLogDetail({ log }: { log: Doc<"emailLog"> }) {
  const { membership } = useOrganization();
  const isAdmin = membership?.role === "org:admin";
  const events = useQuery(api.functions.email.queries.getEvents, {
    emailLogId: log._id,
  });
  const attachments = useQuery(api.functions.email.queries.getAttachmentUrls, {
    emailLogId: log._id,
  });
  const resendFromLog = useAction(api.functions.email.send.resendFromLog);
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);

  async function handleResend() {
    setResending(true);
    setResendError(null);
    try {
      await resendFromLog({ id: log._id });
    } catch (e) {
      setResendError((e as Error).message);
    } finally {
      setResending(false);
    }
  }

  const lastBounceEvent = events?.find((e) => e.eventType === "bounced");

  return (
    <div className="mt-3 space-y-4 rounded-md border border-border bg-secondary/30 p-4">
      {log.status === "failed" && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <div className="flex items-center gap-2 text-destructive font-medium">
            <AlertTriangle size={16} /> Envío fallido
          </div>
          {log.errorMessage && (
            <p className="mt-1 text-destructive/80">{log.errorMessage}</p>
          )}
          {isAdmin && (
            <button
              onClick={handleResend}
              disabled={resending}
              className="mt-2 inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={12} /> {resending ? "Reenviando..." : "Reenviar"}
            </button>
          )}
          {resendError && (
            <p className="mt-2 text-xs text-destructive">{resendError}</p>
          )}
        </div>
      )}

      {log.status === "bounced" && lastBounceEvent && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 text-sm">
          <p className="font-medium text-yellow-500">Email rebotado</p>
          {lastBounceEvent.metadata?.bounceReason && (
            <p className="mt-1 text-muted-foreground">
              Razón: {lastBounceEvent.metadata.bounceReason}
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <div>
          <span className="text-xs text-muted-foreground">De:</span>{" "}
          {log.fromName ? `${log.fromName} <${log.fromEmail}>` : log.fromEmail}
        </div>
        <div>
          <span className="text-xs text-muted-foreground">Para:</span> {log.toEmail}
        </div>
        {log.cc && log.cc.length > 0 && (
          <div>
            <span className="text-xs text-muted-foreground">CC:</span>{" "}
            {log.cc.join(", ")}
          </div>
        )}
        {log.replyTo && (
          <div>
            <span className="text-xs text-muted-foreground">Reply-To:</span>{" "}
            {log.replyTo}
          </div>
        )}
        {log.clientId && (
          <div>
            <span className="text-xs text-muted-foreground">Cliente:</span>{" "}
            <Link
              href={`/clientes/${log.clientId}`}
              className="text-accent hover:underline cursor-pointer"
            >
              Ver cliente
            </Link>
          </div>
        )}
      </div>

      <div>
        <h4 className="text-sm font-semibold mb-2">{log.subject}</h4>
        {log.bodyHtml ? (
          <iframe
            srcDoc={log.bodyHtml}
            sandbox=""
            className="w-full h-96 rounded-md border border-border bg-white"
            title="Email body"
          />
        ) : (
          <p className="text-sm text-muted-foreground">(sin contenido HTML)</p>
        )}
      </div>

      {events && events.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Timeline
          </h5>
          <ul className="space-y-1 text-sm">
            {events.map((e) => (
              <li key={e._id} className="flex items-center gap-2">
                <EmailStatusBadge status={e.eventType} />
                <span className="text-xs text-muted-foreground">
                  {new Date(e.occurredAt).toLocaleString("es-MX")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {attachments && attachments.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Adjuntos
          </h5>
          <ul className="space-y-1">
            {attachments.map((att, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                <Paperclip size={14} className="text-muted-foreground" />
                {att.url ? (
                  <a
                    href={att.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline cursor-pointer"
                  >
                    {att.filename}
                  </a>
                ) : (
                  <span className="text-muted-foreground">{att.filename}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | head -15
git add src/components/email-log/EmailLogDetail.tsx
git commit -m "feat(ui): add EmailLogDetail with timeline, attachments, resend"
```

---

### Task 18: EmailLogList component

**Files:**
- Create: `src/components/email-log/EmailLogList.tsx`

- [ ] **Step 1: Write the list**

```tsx
"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Doc } from "../../../convex/_generated/dataModel";
import { useOrganization } from "@clerk/nextjs";
import { Search, Mail } from "lucide-react";
import { useState } from "react";
import { EmailStatusBadge } from "./EmailStatusBadge";
import { EmailTypeBadge } from "./EmailTypeBadge";
import { EmailLogDetail } from "./EmailLogDetail";

const STATUSES = [
  { value: "", label: "Todos los estados" },
  { value: "queued", label: "En cola" },
  { value: "sent", label: "Enviado" },
  { value: "delivered", label: "Entregado" },
  { value: "opened", label: "Abierto" },
  { value: "clicked", label: "Clickeado" },
  { value: "bounced", label: "Rebotado" },
  { value: "complained", label: "Reportado spam" },
  { value: "failed", label: "Falló" },
];
const TYPES = [
  { value: "", label: "Todos los tipos" },
  { value: "quotation", label: "Cotización" },
  { value: "quotation_reminder", label: "Recordatorio cotización" },
  { value: "contract", label: "Contrato" },
  { value: "contract_reminder", label: "Recordatorio contrato" },
  { value: "deliverable", label: "Entregable" },
  { value: "questionnaire", label: "Cuestionario" },
  { value: "reminder", label: "Recordatorio" },
  { value: "custom", label: "Otro" },
];

export function EmailLogList() {
  const { membership } = useOrganization();
  const isAdmin = membership?.role === "org:admin";
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(50);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const rows = useQuery(api.functions.email.queries.list, {
    status: status || undefined,
    type: type || undefined,
    search: search || undefined,
    limit,
  });

  if (rows === undefined) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-lg border border-border bg-card"
          />
        ))}
      </div>
    );
  }

  const hasAnyResults = rows.length > 0;
  const hasFilters = !!(status || type || search);

  if (!hasAnyResults && !hasFilters) {
    return (
      <div className="rounded-lg border border-border bg-card p-12 text-center">
        <Mail className="mx-auto mb-4 text-muted-foreground" size={48} />
        <p className="text-lg font-medium">No hay emails aún</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {isAdmin
            ? "Los emails enviados desde cotizaciones, contratos o entregables aparecerán aquí."
            : "Aún no hay emails vinculados a tus clientes."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            size={16}
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por asunto o destinatario..."
            className="w-full rounded-md border border-border bg-secondary py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-md border border-border bg-secondary py-2 px-3 text-sm text-foreground focus:border-accent focus:outline-none cursor-pointer"
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="rounded-md border border-border bg-secondary py-2 px-3 text-sm text-foreground focus:border-accent focus:outline-none cursor-pointer"
        >
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {!hasAnyResults && hasFilters && (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No se encontraron emails con estos filtros.
          </p>
          <button
            onClick={() => {
              setStatus("");
              setType("");
              setSearch("");
            }}
            className="mt-3 inline-flex items-center rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary transition-colors cursor-pointer"
          >
            Limpiar filtros
          </button>
        </div>
      )}

      {hasAnyResults && (
        <div className="space-y-2">
          {rows.map((log: Doc<"emailLog">) => {
            const isExpanded = expandedId === log._id;
            return (
              <div key={log._id} className="space-y-2">
                <button
                  onClick={() => setExpandedId(isExpanded ? null : log._id)}
                  className={`w-full rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-accent/30 cursor-pointer ${
                    isExpanded ? "border-accent/40" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <EmailStatusBadge status={log.status} />
                        <EmailTypeBadge type={log.type} />
                        <span className="text-xs text-muted-foreground">
                          {new Date(log.createdAt).toLocaleString("es-MX")}
                        </span>
                      </div>
                      <p className="mt-1 text-sm font-medium truncate">
                        {log.subject}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        Para: {log.toEmail}
                      </p>
                    </div>
                  </div>
                </button>
                {isExpanded && <EmailLogDetail log={log} />}
              </div>
            );
          })}
        </div>
      )}

      {hasAnyResults && rows.length === limit && (
        <div className="flex justify-center">
          <button
            onClick={() => setLimit(limit + 50)}
            className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-secondary transition-colors cursor-pointer"
          >
            Cargar más
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | head -10
git add src/components/email-log/EmailLogList.tsx
git commit -m "feat(ui): add EmailLogList with search, filters, expandable rows"
```

---

### Task 19: `/configuracion/email-log` page + update hub

**Files:**
- Create: `src/app/(dashboard)/configuracion/email-log/page.tsx`
- Modify: `src/app/(dashboard)/configuracion/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
"use client";

import Link from "next/link";
import { Mail, ChevronLeft } from "lucide-react";
import { EmailLogList } from "@/components/email-log/EmailLogList";

export default function EmailLogPage() {
  return (
    <div className="space-y-6">
      <Link
        href="/configuracion"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <ChevronLeft size={16} /> Configuración
      </Link>

      <div className="flex items-center gap-3">
        <Mail className="text-accent" size={28} />
        <h1 className="text-2xl font-bold">Email Log</h1>
      </div>

      <EmailLogList />
    </div>
  );
}
```

- [ ] **Step 2: Update hub `/configuracion/page.tsx`**

Replace the current single-card hub with two cards:

```tsx
"use client";

import Link from "next/link";
import { Settings, Building2, Mail, ChevronRight } from "lucide-react";

const sections = [
  {
    href: "/configuracion/empresas-emitentes",
    icon: Building2,
    title: "Empresas Emitentes",
    description:
      "Personas morales que emiten cotizaciones, contratos y facturas.",
  },
  {
    href: "/configuracion/email-log",
    icon: Mail,
    title: "Email Log",
    description: "Historial de emails enviados por la plataforma.",
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

(The Resend integraciones card will be added in Task 22 alongside the page.)

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | head -10
git add 'src/app/(dashboard)/configuracion/email-log/' 'src/app/(dashboard)/configuracion/page.tsx'
git commit -m "feat(ui): add /configuracion/email-log page + hub card"
```

---

## Phase 10: UI — Resend config

### Task 20: ResendSetupGuide

**Files:**
- Create: `src/components/integraciones/resend/ResendSetupGuide.tsx`

- [ ] **Step 1: Write the guide component**

```tsx
import { ExternalLink } from "lucide-react";

const STEPS: Array<{ n: number; title: string; body: React.ReactNode }> = [
  {
    n: 1,
    title: "Crea cuenta en Resend",
    body: (
      <>
        Ve a{" "}
        <a
          href="https://resend.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline inline-flex items-center gap-1"
        >
          resend.com <ExternalLink size={11} />
        </a>{" "}
        y crea una cuenta con el email de tu empresa.
      </>
    ),
  },
  {
    n: 2,
    title: "Agrega tu dominio",
    body: (
      <>
        Desde la sección <strong>Domains</strong> agrega el dominio desde el
        que quieres enviar (ej. <code>cotizaciones.tu-empresa.mx</code>).
      </>
    ),
  },
  {
    n: 3,
    title: "Configura los DNS records",
    body: (
      <>
        Resend te muestra records MX, TXT y CNAME. Agrégalos en tu proveedor
        de dominios (Cloudflare, GoDaddy, etc.). Puede tardar de minutos a
        varias horas en propagar.
      </>
    ),
  },
  {
    n: 4,
    title: "Verifica el dominio",
    body: (
      <>
        Vuelve a Resend y click "Verify". Espera a que el dominio aparezca
        como <strong>Verified</strong>.
      </>
    ),
  },
  {
    n: 5,
    title: "Crea un API key y configura webhook",
    body: (
      <>
        En <strong>API Keys</strong> crea uno con permisos Full Access. En{" "}
        <strong>Webhooks</strong> agrega endpoint{" "}
        <code>&lt;tu-URL&gt;/webhooks/resend</code> (tu admin tiene esta URL)
        y copia el <strong>Signing Secret</strong>. Pega ambos valores en el
        formulario abajo.
      </>
    ),
  },
];

export function ResendSetupGuide() {
  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
        Cómo configurar Resend
      </h3>
      <ol className="space-y-4">
        {STEPS.map((s) => (
          <li key={s.n} className="flex gap-3">
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent text-sm font-semibold">
              {s.n}
            </span>
            <div className="pt-0.5">
              <p className="text-sm font-medium">{s.title}</p>
              <p className="text-sm text-muted-foreground mt-0.5">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/integraciones/resend/ResendSetupGuide.tsx
git commit -m "feat(ui): add ResendSetupGuide component"
```

---

### Task 21: ResendConfigForm

**Files:**
- Create: `src/components/integraciones/resend/ResendConfigForm.tsx`

- [ ] **Step 1: Write the form**

```tsx
"use client";

import { useState, useEffect } from "react";
import { useMutation, useQuery, useAction } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Check, X, Loader2 } from "lucide-react";

export function ResendConfigForm() {
  const config = useQuery(api.functions.email.queries.getResendConfig, {});
  const upsert = useMutation(api.functions.email.mutations.upsertResendConfig);
  const testConnection = useAction(
    api.functions.email.send.testResendConnection
  );

  const [apiKey, setApiKey] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<
    { ok: true } | { ok: false; error: string } | null
  >(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (config?.configured) {
      setFromEmail(config.fromEmail ?? "");
      setFromName(config.fromName ?? "");
      // apiKey and webhookSecret NOT prefilled — they are sensitive.
    }
  }, [config]);

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!apiKey.trim() && !config?.configured)
      e.apiKey = "API key es requerido";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail))
      e.fromEmail = "Email inválido";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleTest() {
    if (!apiKey.trim()) {
      setTestResult({ ok: false, error: "Pega un API key primero" });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testConnection({ apiKey });
      setTestResult(res);
    } catch (err) {
      setTestResult({ ok: false, error: (err as Error).message });
    } finally {
      setTesting(false);
    }
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setSaved(false);
    try {
      await upsert({
        apiKey: apiKey.trim() || "__keep__",  // sentinel handled server-side? actually better to not allow empty save
        fromEmail: fromEmail.trim(),
        fromName: fromName.trim() || undefined,
        webhookSigningSecret: webhookSecret.trim() || undefined,
      });
      setSaved(true);
    } catch (err) {
      setErrors({ submit: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }

  const input =
    "w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";
  const errStyle = "text-xs text-destructive";

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-card p-6 space-y-4">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Configuración
      </h3>

      {errors.submit && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
          {errors.submit}
        </div>
      )}

      {saved && (
        <div className="rounded-md bg-emerald-500/10 border border-emerald-500/20 p-3 text-sm text-emerald-500">
          Configuración guardada.
        </div>
      )}

      <div className="space-y-2">
        <label className="text-sm font-medium">API Key *</label>
        <input
          type="password"
          className={input}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={
            config?.configured
              ? `(dejar en blanco para mantener: ${config.apiKeyMasked ?? "****"})`
              : "re_live_..."
          }
        />
        {errors.apiKey && <p className={errStyle}>{errors.apiKey}</p>}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !apiKey.trim()}
            className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary transition-colors cursor-pointer disabled:opacity-50"
          >
            {testing ? <Loader2 size={12} className="animate-spin" /> : null}
            Probar conexión
          </button>
          {testResult?.ok === true && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
              <Check size={12} /> Conexión OK
            </span>
          )}
          {testResult?.ok === false && (
            <span className="inline-flex items-center gap-1 text-xs text-destructive">
              <X size={12} /> {testResult.error}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Email remitente *</label>
        <input
          type="email"
          className={input}
          value={fromEmail}
          onChange={(e) => setFromEmail(e.target.value)}
          placeholder="cotizaciones@tu-empresa.mx"
        />
        {errors.fromEmail && <p className={errStyle}>{errors.fromEmail}</p>}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Nombre remitente</label>
        <input
          type="text"
          className={input}
          value={fromName}
          onChange={(e) => setFromName(e.target.value)}
          placeholder="Tu Empresa"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Webhook Signing Secret</label>
        <input
          type="password"
          className={input}
          value={webhookSecret}
          onChange={(e) => setWebhookSecret(e.target.value)}
          placeholder={
            config?.hasWebhookSecret
              ? "(dejar en blanco para mantener el actual)"
              : "whsec_..."
          }
        />
        <p className="text-xs text-muted-foreground">
          Opcional pero recomendado. Sin esto, los webhooks de eventos de email
          fallarán a la verificación HMAC.
        </p>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="rounded-md bg-accent px-6 py-2 text-sm font-medium text-primary hover:bg-accent/90 transition-colors disabled:opacity-50 cursor-pointer"
      >
        {loading ? "Guardando..." : "Guardar configuración"}
      </button>
    </form>
  );
}
```

**Note on the `__keep__` sentinel:** the form design has a gap — if
`config.configured` is true and the user doesn't type a new apiKey, we
don't want to overwrite the existing key with an empty value. The
simplest fix is to either: (a) require the user to always paste the key
on save (current behavior: `validate()` only requires it if
`!config.configured`), or (b) add a server-side sentinel check. For v2,
go with (a) — if you're editing the config, you paste the key again.
Remove the `__keep__` sentinel logic; require apiKey to be non-empty on
upsert. Update the mutation `upsertResendConfig` to raise on empty
apiKey, which it already does (len check >= 8). Fix the form:

Replace the `apiKey: apiKey.trim() || "__keep__"` line in `handleSubmit` with:

```ts
        apiKey: apiKey.trim(),
```

and update `validate()` to ALWAYS require apiKey (not just when not configured). This is simpler semantics and matches the server guarantee.

- [ ] **Step 2: Apply the fix**

Change:
```ts
if (!apiKey.trim() && !config?.configured) e.apiKey = "API key es requerido";
```
to:
```ts
if (!apiKey.trim()) e.apiKey = "API key es requerido (pégalo de nuevo si estás editando)";
```

And replace:
```ts
apiKey: apiKey.trim() || "__keep__",
```
with:
```ts
apiKey: apiKey.trim(),
```

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | head -15
git add src/components/integraciones/resend/ResendConfigForm.tsx
git commit -m "feat(ui): add ResendConfigForm with test connection + save"
```

---

### Task 22: `/configuracion/integraciones/resend` page + hub card

**Files:**
- Create: `src/app/(dashboard)/configuracion/integraciones/resend/page.tsx`
- Modify: `src/app/(dashboard)/configuracion/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
"use client";

import Link from "next/link";
import { Plug, ChevronLeft } from "lucide-react";
import { useOrganization } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ResendSetupGuide } from "@/components/integraciones/resend/ResendSetupGuide";
import { ResendConfigForm } from "@/components/integraciones/resend/ResendConfigForm";

export default function ResendIntegrationPage() {
  const { membership, isLoaded } = useOrganization();
  const router = useRouter();
  const isAdmin = membership?.role === "org:admin";

  useEffect(() => {
    if (isLoaded && !isAdmin) {
      router.replace("/configuracion/email-log");
    }
  }, [isLoaded, isAdmin, router]);

  if (!isLoaded || !isAdmin) return null;

  return (
    <div className="space-y-6">
      <Link
        href="/configuracion"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <ChevronLeft size={16} /> Configuración
      </Link>

      <div className="flex items-center gap-3">
        <Plug className="text-accent" size={28} />
        <h1 className="text-2xl font-bold">Integración Resend</h1>
      </div>

      <p className="text-sm text-muted-foreground max-w-2xl">
        Conecta tu cuenta de Resend para enviar emails desde tu propio dominio.
        Si no configuras esto, se usa un dominio de plataforma compartido por
        defecto.
      </p>

      <ResendSetupGuide />
      <ResendConfigForm />
    </div>
  );
}
```

- [ ] **Step 2: Update hub to add the card**

Edit `src/app/(dashboard)/configuracion/page.tsx` — add the third entry to the `sections` array:

```tsx
import { Settings, Building2, Mail, Plug, ChevronRight } from "lucide-react";

const sections = [
  {
    href: "/configuracion/empresas-emitentes",
    icon: Building2,
    title: "Empresas Emitentes",
    description:
      "Personas morales que emiten cotizaciones, contratos y facturas.",
  },
  {
    href: "/configuracion/email-log",
    icon: Mail,
    title: "Email Log",
    description: "Historial de emails enviados por la plataforma.",
  },
  {
    href: "/configuracion/integraciones/resend",
    icon: Plug,
    title: "Integración Resend",
    description: "Configura API key y dominio para enviar correos propios.",
  },
];
```

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | head -10
git add 'src/app/(dashboard)/configuracion/'
git commit -m "feat(ui): add /configuracion/integraciones/resend page + hub card"
```

---

## Phase 11: Wrap-up

### Task 23: Full build + test + smoke

**Files:** None (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests pass (baseline 89 + ~31 new = ~120).

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: no errors. New routes visible:
- `/configuracion/email-log`
- `/configuracion/integraciones/resend`

- [ ] **Step 3: Convex deploy**

Run: `npx convex dev --once`
Expected: all functions register. New HTTP endpoint `/webhooks/resend` available.

- [ ] **Step 4: Manual smoke checklist**

Run `npm run dev` and verify:

- [ ] `/configuracion` shows three cards (Empresas Emitentes, Email Log, Integración Resend).
- [ ] `/configuracion/integraciones/resend` as admin: form loads, `getResendConfig` returns null initially, the apiKey placeholder says "re_live_...".
- [ ] Fill apiKey + fromEmail, click "Probar conexión" (if real Resend key handy). Should show check green or red error.
- [ ] Click "Guardar". Message "Configuración guardada" appears. Refresh page — fromEmail persists, apiKey field empty (masked value shown in placeholder).
- [ ] Configure `RESEND_WEBHOOK_SECRET` in `.env.local` or in the form. Register the webhook URL in Resend dashboard: `<CONVEX_URL>/webhooks/resend`.
- [ ] In Convex dashboard, call `email.send.sendEmail` directly with a real test:
  ```
  { "to": "YOUR_REAL_EMAIL", "subject": "Smoke test 3A", "bodyHtml": "<p>Hola desde Projex</p>", "type": "custom" }
  ```
- [ ] Check `/configuracion/email-log`: row appears with status `sent`.
- [ ] Check the inbox of YOUR_REAL_EMAIL: email arrives (or check Resend dashboard if email suppressed).
- [ ] Open the email — webhook fires — status in Projex UI transitions to `opened`.
- [ ] As admin, click "Reenviar" on a `failed` email (force a failed one by using an invalid domain first): creates a new emailLog row.

- [ ] **Step 5: Commit any fixes found**

```bash
git add <any changed files>
git commit -m "fix(email): <describe fix from smoke test>"
```

- [ ] **Step 6: Final verification summary**

Compare against spec `docs/superpowers/specs/2026-04-23-section-3a-email-infrastructure-design.md`:

- [ ] §3A.1 scope items all have corresponding tasks above.
- [ ] §3A.2 no schema changes made.
- [ ] §3A.3 backend: 4 new files (`resolveConfig`, `internalMutations`, `internalQueries`, `queries`, `mutations`), 1 modified (`send.ts`), 1 new (`http.ts`). ✓
- [ ] §3A.4 UI: 2 pages + hub update + 6 components. ✓
- [ ] §3A.6 error handling: validated via tests in Tasks 3/14/15.
- [ ] §3A.7 testing: 5 test files, ~31 tests. ✓
- [ ] §3A.8 unblocks 3B/3C: `sendEmail` action is public and typed for all 8 email types.

---

## Spec coverage checklist

- [x] §3A.1 Scope — Tasks 1-22 cover every item.
- [x] §3A.2 Data model — No schema changes, all consumed fields are used correctly in Tasks 4/5/11.
- [x] §3A.3 Backend — Tasks 2/4/5/6/7/8/9/11/12/13 cover every function listed.
- [x] §3A.4 UI — Tasks 16/17/18/19/20/21/22 cover list + detail + badges + forms + pages + hub.
- [x] §3A.5 Seed (optional) — no seed task needed; spec says only manual steps.
- [x] §3A.6 Error handling — covered in validation logic (Tasks 7/13) and tested (Tasks 3/10/14/15).
- [x] §3A.7 Testing — Tasks 3/10/14/15 cover 5 test files.
- [x] §3A.8 Dependencies — Task 1 installs svix + documents env vars.
- [x] §3A.9 Risks — mitigations are embedded in the relevant task code (e.g., monotonic status in Task 5, attachment size caps in Task 7).
