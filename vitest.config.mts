import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

export default defineConfig(({ mode }) => ({
  test: {
    // convex-test requires edge-runtime for Convex function execution
    // Non-Convex tests (pure TS helpers) work fine in this env too.
    environment: "edge-runtime",
    env: loadEnv(mode ?? "test", process.cwd(), ""),
    server: { deps: { inline: ["convex-test"] } },
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules", ".next", "dist"],
  },
}));
