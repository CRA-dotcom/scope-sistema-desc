/**
 * Default subservices catalog seed (A1 Phase 1).
 *
 * ⚠️  PENDIENTE VALIDACIÓN PAPÁ — catálogo placeholder.
 *
 * R1 §12 decisión #15 reserva 0.5 día para refinar este catálogo con el input
 * operativo real del dueño antes de correr `seedDefaultSubservices` en prod.
 * En dev este seed es seguro de correr (es idempotente). Una vez papá
 * apruebe el catálogo definitivo, edita `DEFAULT_SUBSERVICES` abajo y vuelve
 * a correr — los rows existentes se respetan y solo se insertan los nuevos.
 *
 * Run en dev:
 *   npx convex run subservices/seed:seedDefaultSubservices
 *
 * Run en prod (una vez):
 *   Convex dashboard → run mutation → subservices/seed.seedDefaultSubservices
 */
import { internalMutation } from "../../_generated/server";

type FrequencyLiteral =
  | "mensual"
  | "trimestral"
  | "semestral"
  | "anual"
  | "una_vez";

export const DEFAULT_SUBSERVICES: ReadonlyArray<{
  parentName: string;
  name: string;
  slug: string;
  defaultFrequency: FrequencyLiteral;
  description?: string;
  isCommission?: boolean;
  sortOrder: number;
}> = [
  // Legal — 5 items
  { parentName: "Legal", name: "Gobierno Corporativo", slug: "gobierno-corporativo", defaultFrequency: "trimestral", sortOrder: 10 },
  { parentName: "Legal", name: "Contratos Mercantiles", slug: "contratos-mercantiles", defaultFrequency: "mensual", sortOrder: 20 },
  { parentName: "Legal", name: "Compliance LFPDPP", slug: "compliance-lfpdpp", defaultFrequency: "trimestral", sortOrder: 30 },
  { parentName: "Legal", name: "Propiedad Intelectual", slug: "propiedad-intelectual", defaultFrequency: "anual", sortOrder: 40 },
  { parentName: "Legal", name: "Litigios", slug: "litigios", defaultFrequency: "mensual", sortOrder: 50 },

  // Contable — 4 items
  { parentName: "Contable", name: "Estados Financieros Mensuales", slug: "estados-financieros-mensuales", defaultFrequency: "mensual", sortOrder: 10 },
  { parentName: "Contable", name: "Conciliación Bancaria", slug: "conciliacion-bancaria", defaultFrequency: "mensual", sortOrder: 20 },
  { parentName: "Contable", name: "Cierre Anual", slug: "cierre-anual", defaultFrequency: "anual", sortOrder: 30 },
  { parentName: "Contable", name: "Reporte SAT", slug: "reporte-sat", defaultFrequency: "mensual", sortOrder: 40 },

  // TI — 4 items
  { parentName: "TI", name: "Diagnóstico", slug: "diagnostico", defaultFrequency: "una_vez", sortOrder: 10 },
  { parentName: "TI", name: "Implementación ERP", slug: "implementacion-erp", defaultFrequency: "una_vez", sortOrder: 20 },
  { parentName: "TI", name: "Soporte Mensual", slug: "soporte-mensual", defaultFrequency: "mensual", sortOrder: 30 },
  { parentName: "TI", name: "Ciberseguridad", slug: "ciberseguridad", defaultFrequency: "trimestral", sortOrder: 40 },

  // Marketing — 5 items
  { parentName: "Marketing", name: "Plan Anual", slug: "plan-anual", defaultFrequency: "anual", sortOrder: 10 },
  { parentName: "Marketing", name: "Redes Sociales", slug: "redes-sociales", defaultFrequency: "mensual", sortOrder: 20 },
  { parentName: "Marketing", name: "Contenido", slug: "contenido", defaultFrequency: "mensual", sortOrder: 30 },
  { parentName: "Marketing", name: "Branding", slug: "branding", defaultFrequency: "una_vez", sortOrder: 40 },
  { parentName: "Marketing", name: "Performance", slug: "performance", defaultFrequency: "mensual", sortOrder: 50 },

  // RH — 4 items
  { parentName: "RH", name: "Reclutamiento", slug: "reclutamiento", defaultFrequency: "mensual", sortOrder: 10 },
  { parentName: "RH", name: "Nómina", slug: "nomina", defaultFrequency: "mensual", sortOrder: 20 },
  { parentName: "RH", name: "Capacitación", slug: "capacitacion", defaultFrequency: "trimestral", sortOrder: 30 },
  { parentName: "RH", name: "Clima Laboral", slug: "clima-laboral", defaultFrequency: "semestral", sortOrder: 40 },

  // Admin — 3 items
  { parentName: "Admin", name: "Manual Operativo", slug: "manual-operativo", defaultFrequency: "una_vez", sortOrder: 10 },
  { parentName: "Admin", name: "Procesos", slug: "procesos", defaultFrequency: "trimestral", sortOrder: 20 },
  { parentName: "Admin", name: "Control Interno", slug: "control-interno", defaultFrequency: "trimestral", sortOrder: 30 },

  // Comisiones — 2 items (heredan isCommission del padre)
  { parentName: "Comisiones", name: "Cálculo Mensual", slug: "calculo-mensual", defaultFrequency: "mensual", isCommission: true, sortOrder: 10 },
  { parentName: "Comisiones", name: "Reporte Comisiones", slug: "reporte-comisiones", defaultFrequency: "mensual", isCommission: true, sortOrder: 20 },

  // Logística — 3 items
  { parentName: "Logística", name: "Rutas", slug: "rutas", defaultFrequency: "mensual", sortOrder: 10 },
  { parentName: "Logística", name: "Inventario", slug: "inventario", defaultFrequency: "mensual", sortOrder: 20 },
  { parentName: "Logística", name: "Almacén", slug: "almacen", defaultFrequency: "trimestral", sortOrder: 30 },

  // Construcción — 3 items
  { parentName: "Construcción", name: "Levantamiento", slug: "levantamiento", defaultFrequency: "una_vez", sortOrder: 10 },
  { parentName: "Construcción", name: "Avance de Obra", slug: "avance-de-obra", defaultFrequency: "mensual", sortOrder: 20 },
  { parentName: "Construcción", name: "Bitácora", slug: "bitacora", defaultFrequency: "mensual", sortOrder: 30 },
];

/**
 * seedDefaultSubservices — idempotent insert of the placeholder catalog.
 *
 * - Skips rows whose (parentServiceId, slug) already exist as globals.
 * - Skips entries whose parentName doesn't match any seeded `services` row
 *   (in that case run `services/seed.seedDefaultServices` first).
 *
 * Returns counts so the operator can verify a clean run.
 */
export const seedDefaultSubservices = internalMutation({
  args: {},
  handler: async (ctx) => {
    const services = await ctx.db
      .query("services")
      .filter((q) => q.eq(q.field("isDefault"), true))
      .collect();
    const byName = new Map(services.map((s) => [s.name, s]));

    let created = 0;
    let skipped = 0;
    const now = Date.now();

    for (const entry of DEFAULT_SUBSERVICES) {
      const parent = byName.get(entry.parentName);
      if (!parent) {
        console.warn(
          `[seedDefaultSubservices] Padre "${entry.parentName}" no existe; corre seedDefaultServices primero.`
        );
        continue;
      }

      const existing = await ctx.db
        .query("subservices")
        .withIndex("by_parent_slug", (q) =>
          q.eq("parentServiceId", parent._id).eq("slug", entry.slug)
        )
        .filter((q) => q.eq(q.field("orgId"), undefined))
        .first();
      if (existing) {
        skipped += 1;
        continue;
      }

      await ctx.db.insert("subservices", {
        orgId: undefined,
        parentServiceId: parent._id,
        name: entry.name,
        slug: entry.slug,
        description: entry.description,
        defaultFrequency: entry.defaultFrequency,
        isCommission: entry.isCommission ?? parent.isCommission ?? false,
        isActive: true,
        isDefault: true,
        sortOrder: entry.sortOrder,
        createdAt: now,
        updatedAt: now,
      });
      created += 1;
    }

    return {
      seeded: created > 0,
      created,
      skipped,
      total: DEFAULT_SUBSERVICES.length,
    };
  },
});
