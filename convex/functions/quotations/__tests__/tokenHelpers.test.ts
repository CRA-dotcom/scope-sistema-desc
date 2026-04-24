import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateToken, hashToken, TOKEN_TTL_MS } from "../tokenHelpers";

describe("tokenHelpers", () => {
  const originalSecret = process.env.QUOTATION_TOKEN_SECRET;
  beforeEach(() => {
    process.env.QUOTATION_TOKEN_SECRET = "a".repeat(48);
  });
  afterEach(() => {
    process.env.QUOTATION_TOKEN_SECRET = originalSecret;
  });

  it("generateToken returns a base64url string of 43 chars", () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("generateToken produces distinct values on consecutive calls", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toEqual(b);
  });

  it("hashToken is deterministic for the same input", () => {
    const token = "abc123";
    expect(hashToken(token)).toEqual(hashToken(token));
  });

  it("hashToken throws when QUOTATION_TOKEN_SECRET is missing", () => {
    delete process.env.QUOTATION_TOKEN_SECRET;
    expect(() => hashToken("abc")).toThrow(/QUOTATION_TOKEN_SECRET/);
  });

  it("hashToken throws when QUOTATION_TOKEN_SECRET is < 32 chars", () => {
    process.env.QUOTATION_TOKEN_SECRET = "tooshort";
    expect(() => hashToken("abc")).toThrow(/QUOTATION_TOKEN_SECRET/);
  });

  it("TOKEN_TTL_MS equals 30 days in milliseconds", () => {
    expect(TOKEN_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
