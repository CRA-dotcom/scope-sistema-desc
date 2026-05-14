/**
 * Anthropic returned credit_balance_too_low. Stop issuing further calls
 * — caller should save partial results and surface a credit-out warning.
 */
export class CreditExhaustedError extends Error {
  readonly code = "CREDIT_EXHAUSTED" as const;
  constructor(message = "Anthropic credit balance exhausted") {
    super(message);
    this.name = "CreditExhaustedError";
  }
}

/**
 * Hard cost cap (D4: $2.00 per deliverable) tripped mid-run. Caller saves
 * whatever was already filled and marks the deliverable rejected with the
 * unfilled keys so an operator can decide to retry or hand-edit.
 */
export class CostCapExceededError extends Error {
  readonly code = "COST_CAP_EXCEEDED" as const;
  readonly costUsd: number;
  constructor(costUsd: number) {
    super(`Per-deliverable cost cap exceeded: $${costUsd.toFixed(4)}`);
    this.name = "CostCapExceededError";
    this.costUsd = costUsd;
  }
}
