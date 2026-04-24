import { convexTest } from "convex-test";
import schema from "../convex/schema";

// convex-test auto-discovers modules via the file system by default.
// If auto-discovery fails in this setup, we may need to provide
// `import.meta.glob` explicitly. Revisit if tests report missing modules.
export function setupTest() {
  return convexTest(schema);
}

export const ORG_A = "org_test_A";
export const ORG_B = "org_test_B";
