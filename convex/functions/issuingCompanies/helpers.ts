export interface SATRegimen {
  code: string;
  label: string;
  personaType: "moral" | "fisica" | "ambas";
}

export const SAT_REGIMENES: readonly SATRegimen[] = [
  { code: "601", label: "General de Ley Personas Morales", personaType: "moral" },
  { code: "603", label: "Personas Morales con Fines No Lucrativos", personaType: "moral" },
  { code: "605", label: "Sueldos y Salarios", personaType: "fisica" },
  { code: "606", label: "Arrendamiento", personaType: "fisica" },
  { code: "608", label: "Demás ingresos", personaType: "fisica" },
  { code: "612", label: "Personas Físicas con Actividades Empresariales y Profesionales", personaType: "fisica" },
  { code: "621", label: "Incorporación Fiscal", personaType: "fisica" },
  { code: "625", label: "Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas", personaType: "fisica" },
  { code: "626", label: "Régimen Simplificado de Confianza (RESICO)", personaType: "ambas" },
] as const;

const REGIMEN_MAP = new Map(SAT_REGIMENES.map((r) => [r.code, r]));

export function validateRegimenFiscal(code: string): boolean {
  return REGIMEN_MAP.has(code);
}

export function getRegimenLabel(code: string): string | null {
  return REGIMEN_MAP.get(code)?.label ?? null;
}
