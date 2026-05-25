import { describe, it, expect } from "vitest";
import { derivePricingModel } from "../pricingModel";

describe("derivePricingModel", () => {
  it("returns 'commission' when isCommission is true (wins over una_vez)", () => {
    expect(
      derivePricingModel({ isCommission: true, defaultFrequency: "una_vez" })
    ).toBe("commission");
  });

  it("returns 'one_time' when defaultFrequency is 'una_vez' and not commission", () => {
    expect(
      derivePricingModel({ isCommission: false, defaultFrequency: "una_vez" })
    ).toBe("one_time");
  });

  it("returns 'fixed_retainer' when defaultFrequency is 'mensual' and not commission", () => {
    expect(
      derivePricingModel({ isCommission: false, defaultFrequency: "mensual" })
    ).toBe("fixed_retainer");
  });

  it("treats undefined isCommission as false", () => {
    expect(
      derivePricingModel({ isCommission: undefined, defaultFrequency: "trimestral" })
    ).toBe("fixed_retainer");
  });
});
