/**
 * Pricing model union — single source of truth for the 4 modes Projex supports.
 * Spec: docs/superpowers/specs/2026-05-25-pricing-model-frequency-foundation-design.md §2
 */
export type PricingModel =
  | "fixed_retainer"
  | "dynamic_retainer"
  | "commission"
  | "one_time";

export type SubserviceFrequency =
  | "mensual"
  | "trimestral"
  | "semestral"
  | "anual"
  | "una_vez";

/**
 * Derive default pricingModel from existing subservice signals.
 * Order: commission > one_time > fixed_retainer.
 * Used at migration time and as fallback when subservice has no defaultPricingModel.
 */
export function derivePricingModel(args: {
  isCommission?: boolean;
  defaultFrequency: SubserviceFrequency;
}): PricingModel {
  if (args.isCommission) return "commission";
  if (args.defaultFrequency === "una_vez") return "one_time";
  return "fixed_retainer";
}
