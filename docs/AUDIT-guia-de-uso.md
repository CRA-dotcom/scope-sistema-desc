# Auditoría · `guia-de-uso.html` vs código + UI real

Fecha: 2026-04-21
Metodología: cross-check de cada claim de la guía contra `src/` y contra la app en vivo (localhost:3000 vía agent-browser)

---

## 🔴 CRÍTICO — Funcionalidad prometida que NO existe

### 1. `/proyecciones/[id]` · Botón "+ Generar Cuestionario" — no existe
- **Guía** (sección 5, línea 754): promete el botón como acción principal para arrancar el cuestionario
- **Realidad**:
  - `src/app/(dashboard)/proyecciones/[id]/page.tsx` no menciona cuestionario en ninguna de sus 213 líneas
  - Mutation `convex/functions/questionnaires/mutations.ts:22` (`generate`) existe pero **nunca se invoca desde `src/`**
  - `/cuestionarios` empty state dice "Los cuestionarios se generan desde las proyecciones" — contradicción interna del propio producto
- **Impacto**: la guía describe un flujo imposible de ejecutar

### 2. `/clientes/[id]/ciclo` · Botón "+ Generar Cotización para {Servicio}" — no existe
- **Guía** (sección 8): este botón es el punto de entrada para generar cotizaciones
- **Realidad**: la página solo muestra status text "Sin crear" junto a cada servicio, sin botón de acción
- **Confirmado en vivo**: navegado en browser, solo texto estático

### 3. `/cotizaciones/[id]` · Botón "+ Generar Contrato" — no existe
- **Guía** (sección 9): promete el botón cuando la cotización está aprobada
- **Realidad**: no hay botón en `src/app/(dashboard)/cotizaciones/[id]/page.tsx`

### 4. `/entregables/[id]` · Botón "🤖 Generar con AI" — no existe
- **Guía** (sección 10): acción principal que dispara pipeline AI (20-60 seg)
- **Realidad** (confirmado en vivo): la página solo muestra `Generar PDF`, `Descargar PDF`, tabs `Resumen (Short)` / `Completo (Long)`. El texto está pre-llenado (placeholder) pero no hay entry point para regenerar vía AI

---

## 🔴 NDA — "Hedgestone" en 12 menciones

`docs/guia-de-uso.html` contiene la marca **Hedgestone** (cliente bajo NDA de otra empresa) en:

| Línea | Contexto |
|---|---|
| 591 | Tarjeta en listado de clientes (nombre + RFC) |
| 611 | Ejemplo de campo "Razón Social" |
| 636 | Header de detalle de cliente |
| 784 | Header de detalle de cuestionario |
| 829 | Ejemplo de email a cliente |
| 861 | Vista pública del cuestionario |
| 934 | Header de cotización |
| 945 | Preview HTML de cotización |
| 1012 | Entregable en ciclo documental |
| 1038 | Header de entregable |
| 1050 | Cuerpo de resumen legal |
| 1084 | Sección "Ciclo Documental" |

Todas incluyen "Hedgestone S.A. de C.V." y el RFC ficticio `HED230101A9Z`. **Acción**: reemplazar por cliente genérico (ej. "Empresa Demo S.A. de C.V." / RFC `XAXX010101000`).

---

## 🟡 Labels de botones/campos divergentes

Guía dice una cosa, el código dice otra. No son bugs, pero confunden al lector si usa la guía como referencia:

| Ubicación | Guía | UI real |
|---|---|---|
| `/clientes/nuevo` | "Guardar Cliente" | **"Crear Cliente"** |
| `/clientes/nuevo` (6 campos) | incluye "Ejecutivo asignado" | **campo no existe** (solo 5 campos reales) |
| `/clientes/[id]` | "Asignado a" + "Creado" | **ninguno visible** |
| `/clientes/[id]` | "Frecuencia" | "Frecuencia de Facturación" |
| `/proyecciones/nueva` paso 1 | "Ventas anuales del cliente" | "Venta Anual Proyectada (MXN)" |
| `/proyecciones/nueva` paso 1 | "Budget total" | "Presupuesto Total a Contratar (MXN)" |
| `/cotizaciones/[id]` | "✉️ Marcar Enviado" | "Enviar" |
| `/contratos/[id]` | "✍️ Marcar Firmado" | "Firmar" |
| `/entregables/[id]` | "✉️ Entregar al Cliente" | "Marcar como Entregado" |
| `/entregables/[id]` tabs | "📄 Resumen" / "📑 Completo" | "Resumen (Short)" / "Completo (Long)" |
| Dashboard card | "Pendientes" | "Entregables Pendientes" |
| Dashboard card | "Facturación Mes" | "Facturacion del Mes" (sin tilde) |

---

## 🟡 Typos en el código (sin tilde)

Texto hardcoded en componentes con acentos faltantes. Consistentes, parece decisión de estilo pero choca con el resto de la guía y del sidebar (que sí usan tildes):

| Archivo / ruta | Texto con typo |
|---|---|
| Dashboard card | "Facturacion del Mes" |
| `/clientes/[id]/ciclo` — links por servicio | "Proyeccion", "Cotizacion" |
| `/platform` — botón alta | "Nueva Organizacion" |
| `/platform/orgs/new` — headings/labels | "Informacion General", "Configuracion", "Modo de calculo", "Modo de comision" |

Decisión para el usuario: unificar todo con tildes, o dejar sin tildes y ajustar la guía a ese estilo.

---

## 🟡 Estructura divergente

### `/clientes/[id]/ciclo` — diferente a lo descrito
- **Guía** (sección 11): summary cards al top ("Cuestionario", "Cotizaciones (N)", "Contratos (N)", "Entregables") + pipeline por servicio
- **Realidad**: **no hay summary cards**, solo legend (Completado/En progreso/Pendiente/Bloqueado) + pipeline por servicio directamente
- No aparece el cuestionario en ningún lado de esta vista

### Dashboard — sin "⚠️ Alertas" como bloque separado
- **Guía** (sección 2): describe "⚠️ Alertas (bloque rojo)" como sección
- **Realidad**: solo existe un badge "X vencidos" bajo la card "Entregables Pendientes". No hay sección Alertas dedicada

### Sidebar — icons
- **Guía**: menciona iconos emoji (🏠 👥 📈 💼 📋 📄 ✍️ 📦 💰 ⚙️ 🛡️)
- **Realidad**: el sidebar en vivo no muestra esos emojis en el texto accesible. Puede que haya iconos SVG adyacentes que el a11y tree no expone, pero los emojis de la guía no son literales

---

## ✅ Funciona correctamente

Estos claims de la guía coinciden con el código y la UI:

- **23 de 24 rutas** existen (la 24, `/platform/orgs/new`, funciona vía dynamic route `[id]/page.tsx` con magic id "new")
- **Sidebar**: 11 items coinciden con guía (Dashboard, Clientes, Proyecciones, Servicios, Cuestionarios, Cotizaciones, Contratos, Entregables, Facturación, Configuración, Panel de Plataforma)
- **Dashboard**: year selector (2025/2026/2027), botón "Exportar CSV", 4 cards top, charts "Ventas vs Pagos" + "Estado de Entregables"
- **Wizard `/proyecciones/nueva`**: 4 pasos ("Datos Básicos", "Ventas Mensuales", "Servicios", "Revisión") con botón final "Crear Proyección"
- **`/servicios`**: 9 áreas (Legal, Contable, TI, Marketing, RH, Admin, Comisiones, Logística, Construcción)
- **Filtros de status** en `/cuestionarios`, `/cotizaciones`, `/contratos`, `/entregables` coinciden
- **`/q/[token]`**: botones "Guardar Progreso" y "Enviar Respuestas" existen
- **`/cuestionarios/[id]`**: botones "Editar Respuestas", "Enviar a Cliente", "Marcar Completado", "Copiar" existen en código (no pude verificar en vivo por no haber data)
- **Roles**: Super Admin muestra "Panel de Plataforma" en sidebar, confirmado en vivo

---

## Screenshots capturados

Para referencia de comparación, se capturaron en `docs/screenshots/`:
- `audit-clientes-nuevo.png`
- `audit-cliente-detalle.png`
- `audit-ciclo.png`
- `audit-proyeccion-nueva.png`
- `audit-proyeccion-detalle.png`
- `audit-entregable-detalle.png`

---

## Recomendación de remediación

Tres caminos:

**A) Alinear guía al código** (rápido, ~1 hora)
- Quitar las 4 secciones que describen botones que no existen (Cuestionario, Cotización, Contrato, AI)
- Cambiar labels en guía a los reales
- Reemplazar "Hedgestone" por "Empresa Demo"
- Riesgo: guía queda honesta pero el producto sigue con gaps funcionales

**B) Alinear código a la guía** (mediano, ~6-10 horas)
- Agregar los 4 botones faltantes (wiring UI → mutation)
- Renombrar labels + arreglar tildes
- Reemplazar "Hedgestone" en guía
- Riesgo: cambio de scope del sprint 15-may

**C) Mixto** (recomendado)
- Remediaciones blocker: los 4 botones faltantes SÍ son funcionalidad core del flujo comercial (sin botón de Cuestionario no hay forma de arrancar el ciclo). Implementar.
- Remediaciones cosméticas: labels/tildes → ajustar guía al código, no al revés
- NDA: reemplazar Hedgestone ya (riesgo legal)
