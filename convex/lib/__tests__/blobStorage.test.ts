import { describe, it, expect } from "vitest";
import { buildKey } from "../blobStorage";

describe("buildKey — client-scoped kinds", () => {
  it("composes {orgId}/{clientId}/{kind}/{suffix}", () => {
    expect(
      buildKey({
        orgId: "org_123",
        clientId: "client_456",
        kind: "deliverables",
        suffix: "deliverable-789.pdf",
      }),
    ).toBe("org_123/client_456/deliverables/deliverable-789.pdf");
  });

  it("supports nested suffix paths (quotations with multiple files)", () => {
    expect(
      buildKey({
        orgId: "org_123",
        clientId: "client_456",
        kind: "quotations",
        suffix: "quot-789/cotizacion.pdf",
      }),
    ).toBe("org_123/client_456/quotations/quot-789/cotizacion.pdf");
  });

  it("supports invoices namespaced by service + month", () => {
    expect(
      buildKey({
        orgId: "org_a",
        clientId: "client_b",
        kind: "invoices",
        suffix: "proj-1/svc-marketing/m03.pdf",
      }),
    ).toBe("org_a/client_b/invoices/proj-1/svc-marketing/m03.pdf");
  });

  it("supports contracts namespace", () => {
    expect(
      buildKey({
        orgId: "o",
        clientId: "c",
        kind: "contracts",
        suffix: "contract-firmame-001.pdf",
      }),
    ).toBe("o/c/contracts/contract-firmame-001.pdf");
  });
});

describe("buildKey — branding (org-level)", () => {
  it("composes {orgId}/branding/{suffix} without clientId", () => {
    expect(
      buildKey({
        orgId: "org_123",
        kind: "branding",
        suffix: "logos/logo.png",
      }),
    ).toBe("org_123/branding/logos/logo.png");
  });
});

describe("buildKey — rejects unsafe input (multi-tenant isolation)", () => {
  it("throws when orgId is empty", () => {
    expect(() =>
      buildKey({
        orgId: "",
        clientId: "c",
        kind: "deliverables",
        suffix: "x.pdf",
      }),
    ).toThrow(/orgId/);
  });

  it("throws when clientId is empty for client-scoped kinds", () => {
    expect(() =>
      buildKey({
        orgId: "o",
        clientId: "",
        kind: "deliverables",
        suffix: "x.pdf",
      }),
    ).toThrow(/clientId/);
  });

  it("throws when orgId contains a slash (would let caller escape tenant prefix)", () => {
    expect(() =>
      buildKey({
        orgId: "org_a/../org_b",
        clientId: "c",
        kind: "deliverables",
        suffix: "x.pdf",
      }),
    ).toThrow();
  });

  it("throws when clientId contains traversal", () => {
    expect(() =>
      buildKey({
        orgId: "o",
        clientId: "..",
        kind: "deliverables",
        suffix: "x.pdf",
      }),
    ).toThrow();
  });

  it("throws when suffix tries to traverse up", () => {
    expect(() =>
      buildKey({
        orgId: "o",
        clientId: "c",
        kind: "deliverables",
        suffix: "../../escape.pdf",
      }),
    ).toThrow();
  });

  it("throws when suffix is empty", () => {
    expect(() =>
      buildKey({
        orgId: "o",
        clientId: "c",
        kind: "deliverables",
        suffix: "",
      }),
    ).toThrow();
  });

  it("throws when suffix starts with /", () => {
    expect(() =>
      buildKey({
        orgId: "o",
        clientId: "c",
        kind: "deliverables",
        suffix: "/abs/path.pdf",
      }),
    ).toThrow();
  });
});
