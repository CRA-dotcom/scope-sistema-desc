import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // convex-test requires edge-runtime for Convex function execution
    // Non-Convex tests (pure TS helpers) work fine in this env too.
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules", ".next", "dist"],
  },
});
