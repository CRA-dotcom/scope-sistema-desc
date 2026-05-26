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

  it("returns 'placeholder' with extra whitespace in tag", () => {
    expect(detectContentStatus(`<div   class="placeholder">x</div>`)).toBe("placeholder");
  });

  it("returns 'placeholder' with single quotes around class", () => {
    expect(detectContentStatus(`<div class='placeholder'>x</div>`)).toBe("placeholder");
  });

  it("returns 'placeholder' when 'placeholder' is one of multiple classes", () => {
    expect(detectContentStatus(`<div class="foo placeholder bar">x</div>`)).toBe("placeholder");
  });

  it("returns 'placeholder' regardless of tag/attr case", () => {
    expect(detectContentStatus(`<DIV CLASS="placeholder">x</DIV>`)).toBe("placeholder");
  });

  it("returns 'ready' when marker is inside an HTML comment", () => {
    expect(detectContentStatus(`<!-- <div class="placeholder">old</div> --><p>real</p>`)).toBe("ready");
  });

  it("returns 'ready' when marker is inside a <script> block", () => {
    expect(detectContentStatus(`<script>const x = '<div class="placeholder">'</script><p>real</p>`)).toBe("ready");
  });

  it("returns 'ready' when class is a non-marker substring like 'placeholders'", () => {
    expect(detectContentStatus(`<div class="placeholders">multiple holders</div>`)).toBe("ready");
  });
});
