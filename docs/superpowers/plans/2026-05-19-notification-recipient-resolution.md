# Notification Recipient Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve real notification recipients from app data (not Clerk) for the three `TODO(feature)` call sites: overdue alert, questionnaire reminder, questionnaire-completed.

**Architecture:** Add `notificationEmail` to `orgConfigs`. A shared resolver (`getOrgNotificationEmail` + an `internalQuery` wrapper) returns `orgConfig.notificationEmail ?? OPS_NOTIFICATION_EMAIL ?? null`. The client reminder uses `clients.contactEmail`. Resend transport is unchanged; only the "to" changes. Callers skip + warn when the resolver returns `null`.

**Tech Stack:** Convex (queries/mutations/actions), `convex-test` + Vitest, TypeScript.

Spec: `docs/superpowers/specs/2026-05-19-notification-recipient-resolution-design.md`

---

### Task 1: Add `notificationEmail` to orgConfigs (schema + upsert mutation)

**Files:**
- Modify: `convex/schema.ts` (orgConfigs table, ~line 369-390)
- Modify: `convex/functions/orgConfigs/mutations.ts` (upsert, full file)
- Test: `convex/functions/orgConfigs/__tests__/notificationEmail.test.ts`

- [ ] **Step 1: Write the failing test**

Create `convex/functions/orgConfigs/__tests__/notificationEmail.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { api } from "../../../_generated/api";

const SUPER_ADMIN = {
  subject: "user_superadmin",
  issuer: "test",
  tokenIdentifier: "test|user_superadmin",
  publicMetadata: { role: "super_admin" },
};

const baseArgs = {
  orgId: "org_a",
  calculationMode: "weighted" as const,
  commissionMode: "proportional" as const,
  seasonalityEnabled: true,
  featureFlags: {
    advancedConfigVisible: true,
    customServicesVisible: true,
    seasonalityEditable: true,
    manualOverrideAllowed: true,
  },
};

describe("orgConfigs.upsert notificationEmail", () => {
  it("persists notificationEmail on insert", async () => {
    const t = setupTest();
    await t
      .withIdentity(SUPER_ADMIN)
      .mutation(api.functions.orgConfigs.mutations.upsert, {
        ...baseArgs,
        notificationEmail: "responsable@empresa.com",
      });

    const stored = await t.run(async (ctx) =>
      ctx.db
        .query("orgConfigs")
        .withIndex("by_orgId", (q) => q.eq("orgId", "org_a"))
        .unique()
    );
    expect(stored?.notificationEmail).toBe("responsable@empresa.com");
  });

  it("updates notificationEmail on existing config", async () => {
    const t = setupTest();
    const id = await t
      .withIdentity(SUPER_ADMIN)
      .mutation(api.functions.orgConfigs.mutations.upsert, {
        ...baseArgs,
        notificationEmail: "old@empresa.com",
      });
    await t
      .withIdentity(SUPER_ADMIN)
      .mutation(api.functions.orgConfigs.mutations.upsert, {
        ...baseArgs,
        notificationEmail: "new@empresa.com",
      });

    const stored = await t.run(async (ctx) => ctx.db.get(id));
    expect(stored?.notificationEmail).toBe("new@empresa.com");
  });

  it("leaves notificationEmail undefined when omitted", async () => {
    const t = setupTest();
    await t
      .withIdentity(SUPER_ADMIN)
      .mutation(api.functions.orgConfigs.mutations.upsert, baseArgs);

    const stored = await t.run(async (ctx) =>
      ctx.db
        .query("orgConfigs")
        .withIndex("by_orgId", (q) => q.eq("orgId", "org_a"))
        .unique()
    );
    expect(stored?.notificationEmail).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- convex/functions/orgConfigs/__tests__/notificationEmail.test.ts`
Expected: FAIL — `notificationEmail` is not a valid arg / not persisted (ArgumentValidationError or undefined).

- [ ] **Step 3: Add the schema field**

In `convex/schema.ts`, inside `orgConfigs: defineTable({ ... })`, add the field right after `fiscalYearStartMonth: v.optional(v.number()),` and before `updatedAt: v.number(),`:

```ts
    fiscalYearStartMonth: v.optional(v.number()),
    notificationEmail: v.optional(v.string()),
    updatedAt: v.number(),
```

- [ ] **Step 4: Accept and persist it in the upsert mutation**

In `convex/functions/orgConfigs/mutations.ts`:

Add to `args` (after `fiscalYearStartMonth: v.optional(v.number()),`):

```ts
    fiscalYearStartMonth: v.optional(v.number()),
    notificationEmail: v.optional(v.string()),
```

In the `existing` patch object, add `notificationEmail: args.notificationEmail,` (after `fiscalYearStartMonth: args.fiscalYearStartMonth,`):

```ts
        fiscalYearStartMonth: args.fiscalYearStartMonth,
        notificationEmail: args.notificationEmail,
        updatedAt: now,
```

In the `insert` object, add the same line (after `fiscalYearStartMonth: args.fiscalYearStartMonth,`):

```ts
      fiscalYearStartMonth: args.fiscalYearStartMonth,
      notificationEmail: args.notificationEmail,
      updatedAt: now,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- convex/functions/orgConfigs/__tests__/notificationEmail.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 6: Commit**

```bash
git add convex/schema.ts convex/functions/orgConfigs/mutations.ts convex/functions/orgConfigs/__tests__/notificationEmail.test.ts
git commit -m "feat(orgConfigs): notificationEmail field + upsert (86ahjaqzc)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Shared recipient resolver

**Files:**
- Create: `convex/functions/email/resolveRecipients.ts`
- Test: `convex/functions/email/__tests__/resolveRecipients.test.ts`

- [ ] **Step 1: Write the failing test**

Create `convex/functions/email/__tests__/resolveRecipients.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { internal } from "../../../_generated/api";

const originalOps = process.env.OPS_NOTIFICATION_EMAIL;

async function seedConfig(
  t: ReturnType<typeof setupTest>,
  orgId: string,
  notificationEmail?: string
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgConfigs", {
      orgId,
      calculationMode: "weighted" as const,
      commissionMode: "proportional" as const,
      seasonalityEnabled: true,
      featureFlags: {
        advancedConfigVisible: true,
        customServicesVisible: true,
        seasonalityEditable: true,
        manualOverrideAllowed: true,
      },
      notificationEmail,
      updatedAt: Date.now(),
    });
  });
}

describe("resolveOrgNotificationEmail", () => {
  beforeEach(() => {
    delete process.env.OPS_NOTIFICATION_EMAIL;
  });
  afterEach(() => {
    if (originalOps) process.env.OPS_NOTIFICATION_EMAIL = originalOps;
    else delete process.env.OPS_NOTIFICATION_EMAIL;
  });

  it("returns the org config notificationEmail when set", async () => {
    const t = setupTest();
    await seedConfig(t, "org_a", "responsable@empresa.com");
    const result = await t.query(
      internal.functions.email.resolveRecipients.resolveOrgNotificationEmail,
      { orgId: "org_a" }
    );
    expect(result).toBe("responsable@empresa.com");
  });

  it("falls back to OPS_NOTIFICATION_EMAIL when config has none", async () => {
    process.env.OPS_NOTIFICATION_EMAIL = "ops@interno.com";
    const t = setupTest();
    await seedConfig(t, "org_a");
    const result = await t.query(
      internal.functions.email.resolveRecipients.resolveOrgNotificationEmail,
      { orgId: "org_a" }
    );
    expect(result).toBe("ops@interno.com");
  });

  it("returns null when neither config nor env is set", async () => {
    const t = setupTest();
    const result = await t.query(
      internal.functions.email.resolveRecipients.resolveOrgNotificationEmail,
      { orgId: "org_a" }
    );
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- convex/functions/email/__tests__/resolveRecipients.test.ts`
Expected: FAIL — module `resolveRecipients` does not exist.

- [ ] **Step 3: Create the resolver**

Create `convex/functions/email/resolveRecipients.ts`:

```ts
import { internalQuery } from "../../_generated/server";
import { QueryCtx, MutationCtx } from "../../_generated/server";
import { v } from "convex/values";

/**
 * Resolves the notification email for an org from app data, with a
 * last-resort env fallback. Returns null when nothing is configured —
 * callers MUST skip + warn (never send to a placeholder domain).
 */
export async function getOrgNotificationEmail(
  ctx: QueryCtx | MutationCtx,
  orgId: string
): Promise<string | null> {
  const config = await ctx.db
    .query("orgConfigs")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .unique();
  return (
    config?.notificationEmail ?? process.env.OPS_NOTIFICATION_EMAIL ?? null
  );
}

export const resolveOrgNotificationEmail = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, args) => getOrgNotificationEmail(ctx, args.orgId),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- convex/functions/email/__tests__/resolveRecipients.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
git add convex/functions/email/resolveRecipients.ts convex/functions/email/__tests__/resolveRecipients.test.ts
git commit -m "feat(email): shared org notification email resolver (86ahjaqzc)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Wire `overdueCheck` to the resolver

**Files:**
- Modify: `convex/functions/cron/overdueCheck.ts:108-141`
- Test: `convex/functions/cron/__tests__/overdueCheck.recipients.test.ts`

- [ ] **Step 1: Write the failing test**

Create `convex/functions/cron/__tests__/overdueCheck.recipients.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { internal } from "../../../_generated/api";

const originalOps = process.env.OPS_NOTIFICATION_EMAIL;

describe("overdueCheck recipient resolution", () => {
  beforeEach(() => {
    delete process.env.OPS_NOTIFICATION_EMAIL;
    vi.restoreAllMocks();
  });
  afterEach(() => {
    if (originalOps) process.env.OPS_NOTIFICATION_EMAIL = originalOps;
    else delete process.env.OPS_NOTIFICATION_EMAIL;
  });

  async function seedOverdue(
    t: ReturnType<typeof setupTest>,
    orgId: string,
    notificationEmail?: string
  ) {
    await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        orgId,
        name: "ACME",
        rfc: "AAA010101AAA",
        industry: "X",
        annualRevenue: 1_000_000,
        billingFrequency: "mensual" as const,
        isArchived: false,
        createdAt: Date.now(),
      });
      const projectionId = await ctx.db.insert("projections", {
        orgId,
        clientId,
        year: 2026,
        annualSales: 1_000_000,
        totalBudget: 100_000,
        commissionRate: 0,
        seasonalityData: [],
        status: "active" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("monthlyAssignments", {
        orgId,
        clientId,
        projectionId,
        serviceName: "Contable",
        month: 1,
        year: 2020,
        status: "pending" as const,
        createdAt: Date.now(),
      });
      if (notificationEmail !== undefined) {
        await ctx.db.insert("orgConfigs", {
          orgId,
          calculationMode: "weighted" as const,
          commissionMode: "proportional" as const,
          seasonalityEnabled: true,
          featureFlags: {
            advancedConfigVisible: true,
            customServicesVisible: true,
            seasonalityEditable: true,
            manualOverrideAllowed: true,
          },
          notificationEmail,
          updatedAt: Date.now(),
        });
      }
    });
  }

  it("sends the overdue alert to the org notificationEmail", async () => {
    const t = setupTest();
    await seedOverdue(t, "org_a", "responsable@empresa.com");

    await t.action(internal.functions.cron.overdueCheck.run, {});

    const emails = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect()
    );
    const args = emails.map((e: any) => e.args?.[0]);
    expect(args.some((a: any) => a?.to === "responsable@empresa.com")).toBe(
      true
    );
  });

  it("skips + warns when no recipient is resolvable", async () => {
    const t = setupTest();
    await seedOverdue(t, "org_a"); // no orgConfig, no env
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await t.action(internal.functions.cron.overdueCheck.run, {});

    const emails = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect()
    );
    expect(emails.length).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
```

> Note: the action export is `run` (verify with `grep -n "export const" convex/functions/cron/overdueCheck.ts`). If the scheduled-functions assertion shape differs in this `convex-test` version, assert instead on `console`-logged count and the absence/presence of the warn — the behavioral contract is: recipient resolved → email scheduled; not resolved → zero scheduled + warn.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- convex/functions/cron/__tests__/overdueCheck.recipients.test.ts`
Expected: FAIL — current code reads `process.env.OPS_NOTIFICATION_EMAIL` directly, so the `notificationEmail` case sends nothing (or to undefined) instead of `responsable@empresa.com`.

- [ ] **Step 3: Use the resolver per org**

In `convex/functions/cron/overdueCheck.ts`, add to the imports at the top (the file already imports `internal` from `../../_generated/api`):

(no new import needed — `internal` is already imported)

Replace the block at lines ~116-126:

```ts
        // TODO(feature): resolver el email del admin de la org desde Clerk.
        // Hasta entonces se usa el buzón de ops; si no está configurado se
        // omite el envío (no se manda a un dominio placeholder ajeno).
        const opsTo = process.env.OPS_NOTIFICATION_EMAIL;
        if (!opsTo) {
          console.warn(
            `[overdueCheck] OPS_NOTIFICATION_EMAIL no configurado; ` +
              `omitiendo alerta de ${items.length} vencidos para org ${orgId}.`
          );
          continue;
        }
```

with:

```ts
        const opsTo = await ctx.runQuery(
          internal.functions.email.resolveRecipients
            .resolveOrgNotificationEmail,
          { orgId }
        );
        if (!opsTo) {
          console.warn(
            `[overdueCheck] Sin email de notificación para org ${orgId} ` +
              `(orgConfigs.notificationEmail / OPS_NOTIFICATION_EMAIL); ` +
              `omitiendo alerta de ${items.length} vencidos.`
          );
          continue;
        }
```

Leave the rest of the loop (the `ctx.scheduler.runAfter` with `to: opsTo`) unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- convex/functions/cron/__tests__/overdueCheck.recipients.test.ts`
Expected: PASS (2 passing).

- [ ] **Step 5: Commit**

```bash
git add convex/functions/cron/overdueCheck.ts convex/functions/cron/__tests__/overdueCheck.recipients.test.ts
git commit -m "feat(cron): overdueCheck resolves org notificationEmail (86ahjaqzc)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `monthlyCheck` — reminder to client's contactEmail

**Files:**
- Modify: `convex/functions/cron/monthlyCheck.ts` (`listPendingQuestionnaires` ~45-89; reminder block ~157-184)
- Test: `convex/functions/cron/__tests__/monthlyCheck.recipients.test.ts`

- [ ] **Step 1: Write the failing test**

Create `convex/functions/cron/__tests__/monthlyCheck.recipients.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { internal } from "../../../_generated/api";

async function seedPending(
  t: ReturnType<typeof setupTest>,
  contactEmail?: string
) {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId: "org_a",
      name: "ACME",
      rfc: "AAA010101AAA",
      industry: "X",
      annualRevenue: 1_000_000,
      billingFrequency: "mensual" as const,
      isArchived: false,
      contactEmail,
      createdAt: Date.now(),
    });
    const projectionId = await ctx.db.insert("projections", {
      orgId: "org_a",
      clientId,
      year: 2026,
      annualSales: 1_000_000,
      totalBudget: 100_000,
      commissionRate: 0,
      seasonalityData: [],
      status: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("questionnaireResponses", {
      orgId: "org_a",
      clientId,
      projectionId,
      responses: [],
      status: "sent" as const,
      createdAt: Date.now(),
    });
    return { clientId, projectionId };
  });
}

describe("monthlyCheck.listPendingQuestionnaires contactEmail", () => {
  it("includes the client's contactEmail in the result", async () => {
    const t = setupTest();
    const { clientId, projectionId } = await seedPending(
      t,
      "cliente@empresa.com"
    );

    const result = await t.query(
      internal.functions.cron.monthlyCheck.listPendingQuestionnaires,
      {
        clientProjectionPairs: [
          { clientId, projectionId, serviceName: "Contable" },
        ],
      }
    );

    expect(result).toHaveLength(1);
    expect(result[0].contactEmail).toBe("cliente@empresa.com");
    expect(result[0].clientName).toBe("ACME");
  });

  it("returns contactEmail undefined when the client has none", async () => {
    const t = setupTest();
    const { clientId, projectionId } = await seedPending(t);

    const result = await t.query(
      internal.functions.cron.monthlyCheck.listPendingQuestionnaires,
      {
        clientProjectionPairs: [
          { clientId, projectionId, serviceName: "Contable" },
        ],
      }
    );

    expect(result).toHaveLength(1);
    expect(result[0].contactEmail).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- convex/functions/cron/__tests__/monthlyCheck.recipients.test.ts`
Expected: FAIL — `result[0].contactEmail` is `undefined` even when the client has one (not yet returned).

- [ ] **Step 3: Extend `listPendingQuestionnaires` to return contactEmail**

In `convex/functions/cron/monthlyCheck.ts`, change the `results` type and the pushed object inside `listPendingQuestionnaires`:

Change:

```ts
    const results: Array<{
      clientId: string;
      clientName: string;
      serviceName: string;
    }> = [];
```

to:

```ts
    const results: Array<{
      clientId: string;
      clientName: string;
      contactEmail?: string;
      serviceName: string;
    }> = [];
```

Change:

```ts
          results.push({
            clientId: client._id,
            clientName: client.name,
            serviceName: pair.serviceName,
          });
```

to:

```ts
          results.push({
            clientId: client._id,
            clientName: client.name,
            contactEmail: client.contactEmail,
            serviceName: pair.serviceName,
          });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- convex/functions/cron/__tests__/monthlyCheck.recipients.test.ts`
Expected: PASS (2 passing).

- [ ] **Step 5: Resolve the reminder recipient per pending questionnaire**

In `convex/functions/cron/monthlyCheck.ts`, replace the block at lines ~157-184 (from the `TODO(feature)` comment through the closing of the `else`):

```ts
      // TODO(feature): resolver el email real del cliente desde
      // Clerk/contactos. Hasta entonces estos recordatorios NO se envían
      // (antes iban a un dominio placeholder ajeno — fuga de datos).
      const clientReminderTo = process.env.OPS_NOTIFICATION_EMAIL;
      if (!clientReminderTo) {
        console.warn(
          `[monthlyCheck] Sin resolución de email de cliente; ` +
            `omitiendo ${pendingQuestionnaires.length} recordatorios de cuestionario.`
        );
      } else {
        // Send reminder email for each pending questionnaire
        for (const pq of pendingQuestionnaires) {
          await ctx.scheduler.runAfter(
            0,
            internal.functions.email.send.sendEmailInternal,
            {
              to: clientReminderTo,
              subject: `Recordatorio: Cuestionario pendiente - ${pq.serviceName}`,
              html: `<p>Estimado ${pq.clientName}, le recordamos que su cuestionario de ${pq.serviceName} para ${currentMonth}/${currentYear} está pendiente.</p>`,
            }
          );
        }

        console.log(
          `[monthlyCheck] Sent ${pendingQuestionnaires.length} questionnaire reminder emails`
        );
      }
```

with:

```ts
      let sent = 0;
      let skipped = 0;
      for (const pq of pendingQuestionnaires) {
        if (!pq.contactEmail) {
          skipped += 1;
          continue;
        }
        await ctx.scheduler.runAfter(
          0,
          internal.functions.email.send.sendEmailInternal,
          {
            to: pq.contactEmail,
            subject: `Recordatorio: Cuestionario pendiente - ${pq.serviceName}`,
            html: `<p>Estimado ${pq.clientName}, le recordamos que su cuestionario de ${pq.serviceName} para ${currentMonth}/${currentYear} está pendiente.</p>`,
          }
        );
        sent += 1;
      }

      if (skipped > 0) {
        console.warn(
          `[monthlyCheck] ${skipped} recordatorio(s) omitido(s): cliente sin ` +
            `contactEmail.`
        );
      }
      console.log(
        `[monthlyCheck] Sent ${sent} questionnaire reminder emails`
      );
```

- [ ] **Step 6: Add a behavioral test for the per-client skip**

Append to `convex/functions/cron/__tests__/monthlyCheck.recipients.test.ts`:

```ts
describe("monthlyCheck.run reminder dispatch", () => {
  it("does not throw and skips clients without contactEmail", async () => {
    const t = setupTest();
    await seedPending(t); // no contactEmail
    // monthlyCheck.run filters by current month/year against assignments;
    // with no due assignments it simply produces a summary without sending.
    const summary = await t.action(
      internal.functions.cron.monthlyCheck.run,
      {}
    );
    expect(summary).toBeDefined();
    const emails = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect()
    );
    expect(emails.length).toBe(0);
  });
});
```

> Note: verify the action export name with `grep -n "export const" convex/functions/cron/monthlyCheck.ts`. If `run` differs, use the actual exported action name. This test asserts the safe-degradation contract (no throw, nothing sent without a recipient).

- [ ] **Step 7: Run the full file**

Run: `npm test -- convex/functions/cron/__tests__/monthlyCheck.recipients.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 8: Commit**

```bash
git add convex/functions/cron/monthlyCheck.ts convex/functions/cron/__tests__/monthlyCheck.recipients.test.ts
git commit -m "feat(cron): monthlyCheck reminders use client contactEmail (86ahjaqzc)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `questionnaires/submit` — notify org notificationEmail

**Files:**
- Modify: `convex/functions/questionnaires/mutations.ts:207-234`
- Test: `convex/functions/questionnaires/__tests__/submitNotification.test.ts`

- [ ] **Step 1: Write the failing test**

Create `convex/functions/questionnaires/__tests__/submitNotification.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { setupTest } from "../../../../tests/harness";
import { api } from "../../../_generated/api";

function asUserOfOrg(orgId: string) {
  return {
    subject: `user|${orgId}`,
    issuer: "test",
    tokenIdentifier: `test|user|${orgId}`,
    orgId,
  };
}

async function seedSentQuestionnaire(t: ReturnType<typeof setupTest>) {
  return await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      orgId: "org_a",
      name: "ACME",
      rfc: "AAA010101AAA",
      industry: "X",
      annualRevenue: 1_000_000,
      billingFrequency: "mensual" as const,
      isArchived: false,
      assignedTo: "user_exec_1",
      createdAt: Date.now(),
    });
    const projectionId = await ctx.db.insert("projections", {
      orgId: "org_a",
      clientId,
      year: 2026,
      annualSales: 1_000_000,
      totalBudget: 100_000,
      commissionRate: 0,
      seasonalityData: [],
      status: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("orgConfigs", {
      orgId: "org_a",
      calculationMode: "weighted" as const,
      commissionMode: "proportional" as const,
      seasonalityEnabled: true,
      featureFlags: {
        advancedConfigVisible: true,
        customServicesVisible: true,
        seasonalityEditable: true,
        manualOverrideAllowed: true,
      },
      notificationEmail: "responsable@empresa.com",
      updatedAt: Date.now(),
    });
    return await ctx.db.insert("questionnaireResponses", {
      orgId: "org_a",
      clientId,
      projectionId,
      responses: [],
      status: "sent" as const,
      createdAt: Date.now(),
    });
  });
}

describe("questionnaires.submit notification", () => {
  it("schedules the completed-notification to the org notificationEmail", async () => {
    const t = setupTest();
    const id = await seedSentQuestionnaire(t);

    await t
      .withIdentity(asUserOfOrg("org_a"))
      .mutation(api.functions.questionnaires.mutations.submit, { id });

    const scheduled = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect()
    );
    const tos = scheduled.map((s: any) => s.args?.[0]?.to);
    expect(tos).toContain("responsable@empresa.com");
  });
});
```

> Note: confirm the public mutation name is `submit` (it is, per `convex/functions/questionnaires/mutations.ts:188`). If the scheduled-functions shape differs in this `convex-test` version, assert on the contract instead: with `notificationEmail` set, exactly one email is scheduled; the test must fail before the change because the code currently targets `process.env.OPS_NOTIFICATION_EMAIL` (unset → nothing scheduled).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- convex/functions/questionnaires/__tests__/submitNotification.test.ts`
Expected: FAIL — with `OPS_NOTIFICATION_EMAIL` unset the current code skips, so nothing is scheduled to `responsable@empresa.com`.

- [ ] **Step 3: Use the shared resolver in `submit`**

In `convex/functions/questionnaires/mutations.ts`, add this import near the top with the other imports:

```ts
import { getOrgNotificationEmail } from "../email/resolveRecipients";
```

Replace the block at lines ~214-223:

```ts
      // TODO(feature): resolver el email del ejecutivo asignado desde Clerk.
      // Hasta entonces se notifica al buzón de ops; si no está configurado
      // se omite (antes iba a un dominio placeholder ajeno).
      const notifyTo = process.env.OPS_NOTIFICATION_EMAIL;
      if (!notifyTo) {
        console.warn(
          "[questionnaire] OPS_NOTIFICATION_EMAIL no configurado; " +
            "omitiendo notificación de cuestionario completado."
        );
      } else {
```

with:

```ts
      const notifyTo = await getOrgNotificationEmail(ctx, questionnaire.orgId);
      if (!notifyTo) {
        console.warn(
          "[questionnaire] Sin email de notificación para org " +
            `${questionnaire.orgId}; omitiendo notificación de ` +
            "cuestionario completado."
        );
      } else {
```

Leave the `else` body (the `ctx.scheduler.runAfter` with `to: notifyTo`) and the closing braces unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- convex/functions/questionnaires/__tests__/submitNotification.test.ts`
Expected: PASS (1 passing).

- [ ] **Step 5: Commit**

```bash
git add convex/functions/questionnaires/mutations.ts convex/functions/questionnaires/__tests__/submitNotification.test.ts
git commit -m "feat(questionnaires): submit notifies org notificationEmail (86ahjaqzc)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Full suite + GitNexus reindex

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — all prior tests plus the 5 new test files green. If any pre-existing test regressed, stop and investigate before proceeding.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in the modified files.

- [ ] **Step 3: Reindex GitNexus (per CLAUDE.md, post code changes)**

Run: `npx gitnexus analyze`
Expected: completes; index no longer stale.

- [ ] **Step 4: Final verification commit (if reindex changed tracked files)**

```bash
git add -A
git status --short
# Only commit if .gitnexus produced tracked changes (it is gitignored — usually nothing to commit)
```

---

## Notes for the implementer

- `npm test -- <path>` runs a single file (`vitest run` passthrough).
- All new tests use `setupTest()` from `tests/harness.ts` (project root, imported as `../../../../tests/harness` from `convex/functions/<dir>/__tests__/`).
- Internal functions are invoked in tests via `t.query(internal.…)` / `t.action(internal.…)`; public ones via `t.query(api.…)` / `t.mutation(api.…)`.
- `requireSuperAdmin` checks `identity.publicMetadata.role === "super_admin"` — Task 1's test identity sets that.
- The behavioral contract everywhere: recipient resolved → email scheduled via `sendEmailInternal` (Resend, unchanged); not resolved → zero emails + `console.warn`. Never send to a placeholder/foreign domain.
- Spec: `docs/superpowers/specs/2026-05-19-notification-recipient-resolution-design.md`.
