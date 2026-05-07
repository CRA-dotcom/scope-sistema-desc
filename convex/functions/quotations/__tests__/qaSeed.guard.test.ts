import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("qaSeed — production guard", () => {
  it("qaSeedMutation source contiene guard NODE_ENV === 'production'", () => {
    const source = readFileSync(
      resolve(__dirname, "../qaSeedMutation.ts"),
      "utf-8"
    );
    expect(source).toMatch(/NODE_ENV\s*===\s*["']production["']/);
    expect(source).toMatch(/throw new Error/);
  });
});
