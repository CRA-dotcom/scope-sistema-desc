import { describe, it, expect } from "vitest";
import { setupTest } from "../../tests/harness";

describe("convex-test harness", () => {
  it("boots and exposes run", async () => {
    const t = setupTest();
    expect(typeof t.run).toBe("function");
  });
});
