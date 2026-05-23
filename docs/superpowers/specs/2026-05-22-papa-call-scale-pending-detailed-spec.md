# Spec pendiente — Llamada papá 2026-05-22 (escala + features)

**Fecha:** 2026-05-22
**Estado:** 🟡 **STUB — pendiente de detallar funcionalidades**
**Owner:** Christian
**Trigger:** llamada con papá 2026-05-22 noche. Pendiente lista funcional completa.

---

## Resumen

Llamada con papá identificó que el sistema necesita **varias mejoras funcionales** + soportar **carga de producción**. Este doc es un placeholder hasta tener el detalle completo de funcionalidades y poder hacer brainstorming → spec → plan → impl.

## Lo que SÍ sabemos

### Escala objetivo

- **2,000 contratos / mes** (~0.046/min promedio, picos pueden ser 100-200 en batch)
- **2,000 entregables / mes** (similar)
- No necesariamente concurrentes, **PERO si lo son** debe haber queue para soportar peor caso

### Análisis técnico hecho (cabe en infra actual con queue)

| Pieza | Capacidad actual | Veredicto a 2000/mes |
|---|---|---|
| Convex DB | Serverless, escala bien | ✅ |
| Business logic | Sin estado pesado | ✅ |
| Resend (email) | ~10-20/seg | ⚠️ batch API |
| Claude API | ~50 RPM Sonnet | ⚠️ Batch API + queue |
| Puppeteer PDF | 1 proceso Vercel function | ❌ separar a Railway worker |
| Convex scheduler | ~100 jobs/min | ⚠️ rate limit bucket |

### Arquitectura propuesta (alto nivel)

```
[Trigger] → enqueue(generationJob)
              ↓
   [generationJobs table] (queued/running/completed/failed)
              ↓
   [worker cron cada 30s, dispatch N jobs por tick]
              ↓
   [generateDeliverable / generateContract]
              ↓
   [Railway puppeteer worker] (separado de Vercel, pool de browsers)
              ↓
   [Resend batch send]
```

Componentes a construir:
1. Tabla `generationJobs` con estados + retry counter
2. Worker (Convex cron) que dispatch jobs respetando rate limits
3. Servicio dedicado de Puppeteer en Railway (1 dyno con browser pool)
4. UI dashboard `/platform/jobs` para observabilidad
5. Retry con exponential backoff

Estimado: ~3-5 días de impl una vez tengamos el spec funcional resuelto.

## Lo que FALTA capturar de la llamada con papá

Christian dijo "necesitamos varias cosas en el sistema para hacerlo mucho mejor". Pendiente listar las "varias cosas":

- [ ] Tipos nuevos de documentos? (e.g., reportes, dashboards, recibos)
- [ ] Cambios en el wizard / cuestionario?
- [ ] Reportes / analytics / KPIs de los clientes?
- [ ] Integraciones nuevas? (SAT / FacturAPI / DocuSign / etc.)
- [ ] Workflow / aprobaciones multi-step?
- [ ] Branding / white-label?
- [ ] Solicitudes específicas de BiHive / Katimi / otros clientes?
- [ ] Cambios al modelo de pricing / facturación al cliente final?

**Próximo paso:** Christian aterriza la lista funcional con papá (siguiente call o por escrito) y abrimos brainstorming en serio. Idealmente con `superpowers:brainstorming` que descomponga si es necesario en sub-specs.

## Sugerencia de decomposición probable (sujeto al detalle)

Una vez con el detalle, probable que el spec se decomponga en:

1. **Sub-spec escala/queue/worker** — infra autónoma, ~3-5 días
2. **Sub-spec [feature 1 de papá]** — pendiente
3. **Sub-spec [feature 2 de papá]** — pendiente
4. ...

Cada uno con su spec → plan → subagent-driven-development cycle.

## Riesgos a flaggear ahora

- **Costo Claude API** a 2000 entregables/mes: estimar usando Batch API (50% descuento). Con Sonnet 4.x a ~$15/Mtok input, $75/Mtok output, y entregables de ~2k tokens cada uno → ~$50-150/mes solo en AI. Cabe.
- **Costo Railway** worker Puppeteer: ~$5-20/mes según consumo.
- **Resend tier**: revisar si plan actual soporta 4000+ emails/mes.
- **Concurrencia humana**: papá no puede revisar 2000 contratos/mes manualmente. ¿Auto-aprobación con audit? ¿Sampling para review?

---

**Cuando esté el detalle:** mover a un spec `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` con número de revisión y archivar este stub.
