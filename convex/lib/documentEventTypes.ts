import { v } from "convex/values";

/**
 * Single source of truth for documentEvents entity/event type unions.
 *
 * Import these validators into:
 * - convex/schema.ts (documentEvents table definition)
 * - convex/functions/documentEvents/queries.ts (list query args)
 * - convex/functions/documentEvents/internal.ts (logEventMutation args)
 *
 * And import the TS types/arrays into:
 * - src/app/platform/audit/page.tsx (filter dropdown + labels)
 */

export const DOCUMENT_EVENT_ENTITY_TYPES = [
  "deliverable",
  "invoice",
  "quotation",
  "contract",
  "template",
  "subservice",
  "questionnaire",
  "financial_data",
  "projection",
] as const;

export type DocumentEventEntityType =
  (typeof DOCUMENT_EVENT_ENTITY_TYPES)[number];

export const documentEventEntityTypeValidator = v.union(
  ...DOCUMENT_EVENT_ENTITY_TYPES.map((t) => v.literal(t))
);

export const DOCUMENT_EVENT_TYPES = [
  "created",
  "updated",
  "sent",
  "signed",
  "paid",
  "generated",
  "audited",
  "deleted",
  "personalized",
  "restored",
  "reminder_sent",
  "uploaded",
  "voided",
  "error",
  "reopened",
] as const;

export type DocumentEventType = (typeof DOCUMENT_EVENT_TYPES)[number];

export const documentEventTypeValidator = v.union(
  ...DOCUMENT_EVENT_TYPES.map((t) => v.literal(t))
);
