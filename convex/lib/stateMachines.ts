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
