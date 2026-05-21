import { describe, it, expect } from "vitest";
import { formatLocalDateTime } from "../datetime";

describe("formatLocalDateTime", () => {
  it("formats a ms timestamp using es-MX locale and the given IANA timezone", () => {
    // 2026-05-29T20:22:00Z → America/Mexico_City (UTC-6 in May, no DST in MX) = 14:22 local.
    // es-MX uses dd/mm/yyyy and 12-hour clock with AM/PM (e.g. "02:22 p.m.").
    const ms = Date.UTC(2026, 4, 29, 20, 22, 0);
    const formatted = formatLocalDateTime(ms, "America/Mexico_City");
    expect(formatted).toMatch(/29\/05\/2026/);
    // Hour part: either 14:22 (24h) or 02:22 (12h with am/pm marker).
    expect(formatted).toMatch(/(14:22|02:22)/);
  });

  it("falls back to the browser tz when tz arg is omitted", () => {
    const ms = Date.UTC(2026, 0, 1, 0, 0, 0);
    // Smoke test: must return a non-empty string with the year present.
    const formatted = formatLocalDateTime(ms);
    expect(typeof formatted).toBe("string");
    expect(formatted.length).toBeGreaterThan(0);
    // Some year string near 2025/2026 depending on local tz.
    expect(formatted).toMatch(/202\d/);
  });
});
