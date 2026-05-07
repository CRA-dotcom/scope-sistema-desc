import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Smoke test estático: verifica que el código del wizard usa el patrón "skip"
// cuando isLoaded es false. Test sobre el source del archivo, no E2E —
// convex-test no ejecuta hooks de React directamente.

describe("proyecciones/nueva — auth gate on useQuery", () => {
  it("clients useQuery debe pasar 'skip' si isLoaded es false", () => {
    const source = readFileSync(
      resolve(__dirname, "../nueva/page.tsx"),
      "utf-8"
    );
    // El useQuery de clients debe estar gated. Patrón aceptado:
    // useQuery(api.functions.clients.queries.list, isLoaded ? {} : "skip")
    // o variantes con && / ?? que produzcan "skip" cuando auth no lista.
    expect(source).toMatch(/useQuery\(\s*api\.functions\.clients\.queries\.list,\s*[^)]*"skip"/);
  });

  it("services useQuery debe estar gated igual", () => {
    const source = readFileSync(
      resolve(__dirname, "../nueva/page.tsx"),
      "utf-8"
    );
    expect(source).toMatch(/useQuery\(\s*api\.functions\.services\.queries\.listGlobal[^)]*"skip"/);
  });
});
