# Deliverable Templates — Bulk Seed Directory

Pon archivos `.html` aquí y corre el script para upsert masivo a Convex DB.

## Naming Convention

`<parent-svc-slug>__<subservice-slug>[-<type>].html`

- `parent-svc-slug` — slug del Service padre. Mapping en `scripts/import-templates.ts:SLUG_TO_NAME`. Slugs válidos hoy: `legal`, `contable`, `ti`, `marketing`, `rh`, `admin`, `comisiones`, `logistica`, `construccion`.
- `subservice-slug` — slug exacto del Subservice (column `subservices.slug`). Ver `/configuracion/subservicios` o `npx convex data subservices` para listar slugs.
- `<type>` (opcional) — sufijo `-quotation`, `-contract`, `-short`, `-long`, `-questionnaire`. Default: `deliverable_long`.

## Ejemplos

- `legal__asesoria-legal.html` → Legal · Asesoría Legal · Reporte Completo
- `contable__estados-financieros-quotation.html` → Contable · Estados Financieros · Cotización
- `marketing__contenido-redes-short.html` → Marketing · Contenido Redes · Reporte Breve

## Cómo correr

```bash
# 1. Crear/editar .html files aquí (Claude Code amigable — pídele a Claude:
#    "Genera HTML para el reporte mensual de Asesoría Legal usando estas
#     variables: {{cliente.nombre}}, {{cliente.rfc}}, {{proyeccion.mes}},
#     {{proyeccion.año}}, {{ai.diagnostico}}")

# 2. Obtén tu deploy key del Convex dashboard
#    Settings → "Deploy Keys" → genera uno (Development o Production según
#    a qué deployment quieras importar).
#
# 3. Auth + run (reemplaza el valor del key)
CONVEX_DEPLOY_KEY="convex_deploy_key_aqui" \
NEXT_PUBLIC_CONVEX_URL=$(grep NEXT_PUBLIC_CONVEX_URL .env.local | cut -d= -f2) \
  npx tsx scripts/import-templates.ts

# 3. Verifica output (esperado: ✓ created / ↻ updated per file).
```

## Variables disponibles

Todas las plantillas creadas via bulk-import vienen con estas 5 variables estándar declaradas (mismo set que el seed del 2026-05-22):

- `{{cliente.nombre}}` — required, source: client
- `{{cliente.rfc}}` — optional, source: client
- `{{proyeccion.mes}}` — required, source: projection
- `{{proyeccion.año}}` — required, source: projection
- `{{ai.diagnostico}}` — required, source: ai (Claude API rellena en generation)

## contentStatus auto-detection

El script NO necesita decirle a Convex si el HTML es placeholder o ready. Lo detecta automáticamente:

- HTML contiene `<div class="placeholder">` → `contentStatus = "placeholder"`
- HTML NO contiene ese marker → `contentStatus = "ready"`

Si necesitas dejar una plantilla en estado "placeholder" intencionalmente (ej: tienes header listo pero contenido no), incluye el marker en algún parte del HTML.

## Bulk vs in-app editor

- **Bulk-import** (este flujo): para llenar muchas plantillas iniciales o re-importar batch desde versionado en git.
- **In-app editor** (`/configuracion/plantillas/[id]`): para hot-fixes puntuales sin tocar el filesystem.

Convención: bulk-import es la fuente de verdad para iniciales; in-app es para ajustes ad-hoc. NO hay sync bidireccional automático — si editas in-app, esos cambios NO se exportan a `.html` files.
