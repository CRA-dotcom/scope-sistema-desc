import { describe, it, expect } from "vitest";
import { detectContentStatus } from "../templateContent";

describe("detectContentStatus", () => {
  it("returns 'placeholder' when HTML contains the seed marker", () => {
    const html = `<div class="placeholder"><strong>Plantilla placeholder.</strong></div>`;
    expect(detectContentStatus(html)).toBe("placeholder");
  });

  it("returns 'ready' when marker absent (real content)", () => {
    const html = `<h1>Reporte Mensual</h1><p>Datos del cliente {{cliente.nombre}}</p>`;
    expect(detectContentStatus(html)).toBe("ready");
  });

  it("returns 'ready' for empty or minimal HTML without the marker", () => {
    expect(detectContentStatus("")).toBe("ready");
    expect(detectContentStatus("<p></p>")).toBe("ready");
  });

  it("returns 'placeholder' even if marker is nested deep", () => {
    const html = `<html><body><section><div class="placeholder">x</div></section></body></html>`;
    expect(detectContentStatus(html)).toBe("placeholder");
  });
});
