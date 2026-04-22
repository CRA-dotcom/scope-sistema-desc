# Pendientes · Cuestionario unificado

**Estado:** 🟡 Bloqueado por contenido de papá
**Última actualización:** 2026-04-22

## Decisión de producto (reunión 2026-04-20)

Un **solo cuestionario unificado** por proyección (no uno por área). Una respuesta puede alimentar múltiples servicios (dedup). Es el **primer paso** del flujo: cliente → cotización → contrato → entregables.

Modos de llenado soportados:
- Cliente llena el link público (`/q/[token]`)
- Consultor llena por teléfono desde el dashboard interno

## 🔴 Bloqueante único: contenido de las preguntas

**Owner:** papá
**Prometido:** 2026-04-21
**Estado actual:** pendiente de entrega (ya 1 día tarde)

Formato requerido para cada pregunta:

| Campo | Descripción |
|---|---|
| `key` | Identificador único (ej. `cliente_giro_principal`) |
| `text` | Pregunta tal como la ve el cliente |
| `services` | Lista de servicios a los que alimenta (ej. `["Legal", "Contable", "Admin"]`) |
| `type` | `text` · `textarea` · `file_upload` · `select` |
| `required` | `true` / `false` |
| `help_text` (opcional) | Ayuda/ejemplo mostrado al cliente |

Ejemplo tabular aceptable:

```
K01 | ¿Cuál es el giro principal del negocio? | Legal,Contable,TI,Marketing,Admin | text     | sí
K02 | Accionistas y % de participación         | Legal,Admin                      | textarea | sí
K03 | Estados financieros último año           | Contable,Financiero              | file     | sí
```

Cualquier formato (Word / Sheet / lista) sirve — se convierte a código después.

## 🟢 Lo que YA funciona (código en producción)

- Botón "Generar Cuestionario" en `/proyecciones/[id]` — crea registro + redirige
- Vista pública `/q/[token]` — cliente llena
- Vista dashboard `/cuestionarios/[id]` — ejecutivo ve respuestas
- Los entregables AI (`deliverables/actions.ts`) leen las respuestas como contexto
- Las cotizaciones AI (`quotations/actions.ts` — commit `dfec8cd`) también leen respuestas como contexto

## 🟡 Lo que falta implementar (después del contenido)

Todo esto está desbloqueado para programar tan pronto como papá entregue las preguntas:

1. **Seed de preguntas** — convertir el documento de papá a código Convex
   - Tabla candidata: `questionnaireMasterQuestions` (nueva) o `deliverableTemplates` con `type: "questionnaire"`
   - Cada pregunta con tags de servicios aplicables

2. **Reemplazar hardcode** en `convex/functions/questionnaires/mutations.ts:7-20`
   - Hoy: `DEFAULT_QUESTIONS` = 3 preguntas genéricas + 1 por servicio
   - Nuevo: leer del seed, filtrar por servicios activos de la proyección

3. **Modo "llenar por teléfono"** en `/cuestionarios/[id]`
   - Hoy: la vista es solo-lectura
   - Nuevo: permitir al consultor editar las respuestas inline (mismos campos que la vista pública, pero sin token público)
   - Independiente del contenido — se puede empezar YA

4. **Archivar los 5 cuestionarios por área obsoletos**
   - `docs/templates/html/admin-questionnaire.{html,json}`
   - `docs/templates/html/legal-questionnaire.{html,json}`
   - `docs/templates/html/marketing-questionnaire.{html,json}`
   - `docs/templates/html/financiero-questionnaire.{html,meta.json}`
   - `docs/templates/html/ti-questionnaire.{html,meta.json}`
   - Mover a `docs/templates/_archived/` o eliminar del repo

5. **Upload de archivos en preguntas `file_upload`**
   - La vista pública hoy solo tiene `textarea` — agregar `<input type=file>` + integración con `convex/functions/storage/mutations.ts`

6. **Mejora del prompt AI** una vez se sepa la estructura real
   - Los prompts actuales pasan las respuestas como "P: ... R: ..." en texto plano
   - Cuando sepamos qué preguntas son estructuradas, podemos pasar datos tipados a Claude

## Trabajo paralelo que puedo arrancar YA (no depende de papá)

- [ ] #3 modo "llenar por teléfono" — puro UI/backend, no necesita contenido
- [ ] #4 archivar cuestionarios obsoletos — limpieza
- [ ] Preparar esqueleto del seed script (#1) para que solo falte pegar el contenido

## Recordatorio para chasear a papá

El compromiso era 2026-04-21. Hoy es 2026-04-22. Si mañana (23-abr) sigue sin llegar, escalarlo — esto afecta la entrega del 15-may.
