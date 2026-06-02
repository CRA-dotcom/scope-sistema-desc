import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(
  resolve(__dirname, "../[id]/page.tsx"),
  "utf-8"
);

describe("/proyecciones/[id] — subservice in matrix left column", () => {
  it("prefetches subservices via listAllForOrg", () => {
    expect(SOURCE).toMatch(
      /useQuery\(\s*api\.functions\.subservices\.queries\.listAllForOrg/
    );
  });

  it("builds a Map keyed by subservice _id for lookup", () => {
    expect(SOURCE).toContain("subservicesById");
    expect(SOURCE).toMatch(/new Map\([^)]*\.map\(/);
  });

  it("renders the subservice name under serviceName conditionally", () => {
    // After scalar drop: uses primary element from subserviceIds array.
    expect(SOURCE).toMatch(/svc\.subserviceIds\?\.\[0\]\s*&&/);
    expect(SOURCE).toMatch(/subservicesById\.get\(svc\.subserviceIds/);
  });

  it("passes subserviceName to MatrixCellDetail when an assignment is selected", () => {
    expect(SOURCE).toContain("subserviceName=");
    expect(SOURCE).toMatch(/selectedAssignment\.subserviceId/);
  });
});
