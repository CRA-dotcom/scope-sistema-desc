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
 *
 * INTENTIONAL BYPASSES (mutations especializadas que patchean status directo,
 * sin pasar por updateStatus + assertTransition):
 * - `invoices.markPaid` → sync MA.invoiceStatus="paid" (puede saltar
 *   not_invoiced→paid si nunca se marcó invoiced explícito)
 * - `deliverables.deliver` → sync MA.status="delivered" (validación propia:
 *   auditStatus === "approved")
 * - `questionnaires.submit` + `publicMutations.submitByToken` → status="completed"
 *   (validación propia: cliente envía respuestas vía token)
 * - `questionnaires.reopen` → completed→in_progress (admin-only escape hatch)
 * - `projections.replaceProjection` → status="draft" sobre projection activa
 *   (cascade destructiva con su propia lógica de invariantes)
 *
 * Si agregas un nuevo path que patchea status directamente, decide si debe
 * pasar por assertTransition o documentarse aquí como bypass intencional.
 */

export type Transition<S extends string> = readonly [from: S, to: S];

/**
 * Cross-machine coherence guard for monthlyAssignments.
 *
 * Spec §7.1 invariant: status === "delivered" implies invoiceStatus !== "not_invoiced".
 * Llamado por:
 * - `deliverables.deliver` (bypass intencional de assertTransition pero debe respetar este invariant)
 * - `monthlyAssignments.updateStatus` cuando args.status === "delivered" (transición real, no idempotente)
 */
export function assertDeliveredRequiresInvoice(
  currentInvoiceStatus: "not_invoiced" | "invoiced" | "paid"
): void {
  if (currentInvoiceStatus === "not_invoiced") {
    throw new ConvexError({
      code: "COHERENCE_VIOLATION",
      message:
        "monthlyAssignments: no se puede marcar status=\"delivered\" mientras invoiceStatus=\"not_invoiced\". Emite la factura primero.",
    });
  }
}

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
