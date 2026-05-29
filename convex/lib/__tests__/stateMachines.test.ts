import { describe, it, expect } from "vitest";
import { ConvexError } from "convex/values";
import { assertTransition, type Transition } from "../stateMachines";

type TestStatus = "draft" | "active" | "archived";

const ALLOWED: readonly Transition<TestStatus>[] = [
  ["draft", "active"],
  ["active", "archived"],
] as const;

describe("assertTransition", () => {
  it("allows a permitted transition (no throw)", () => {
    expect(() =>
      assertTransition("table", "status", "draft", "active", ALLOWED)
    ).not.toThrow();
  });

  it("is idempotent (from === to never throws)", () => {
    expect(() =>
      assertTransition("table", "status", "active", "active", ALLOWED)
    ).not.toThrow();
  });

  it("throws ConvexError with INVALID_TRANSITION code on illegal transition", () => {
    let caught: ConvexError<{ code: string; message: string }> | null = null;
    try {
      assertTransition("table", "status", "archived", "draft", ALLOWED);
    } catch (e) {
      caught = e as ConvexError<{ code: string; message: string }>;
    }
    expect(caught).not.toBeNull();
    expect(caught).toBeInstanceOf(ConvexError);
    const data = caught!.data as { code: string; message: string };
    expect(data.code).toBe("INVALID_TRANSITION");
    expect(data.message).toMatch(/table\.status/);
    expect(data.message).toMatch(/archived/);
    expect(data.message).toMatch(/draft/);
  });

  it("throws on a transition not in the allowed list (even between valid states)", () => {
    expect(() =>
      assertTransition("table", "status", "draft", "archived", ALLOWED)
    ).toThrow(/INVALID_TRANSITION|draft.*archived/i);
  });
});
