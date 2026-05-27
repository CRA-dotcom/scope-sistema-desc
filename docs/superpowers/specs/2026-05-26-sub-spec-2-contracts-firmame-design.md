# Sub-spec 2 — Contratos por empresa emisora + Firmame

**Fecha:** 2026-05-26
**Estado:** Diseño — pendiente approval Christian + research items (contratos HTML, Firmame API docs)
**Origen:** `docs/superpowers/specs/2026-05-22-papa-call-scale-pending-detailed-spec.md` §3 Sub-spec 2
**Estimado impl:** 5-6 días (4-5 base + 1 pipeline view contratos)
**Bloquea:** nada en su path; SS3/4/5/6/7 son independientes

---

## 1. Resumen ejecutivo

Cuando un cliente acepta una cotización, el sistema renderea automáticamente un contrato (HTML template org-scoped per `issuingCompany × subservicio`), lo convierte a PDF, lo sube a **Firmame.com** vía API, y le envía al cliente un email con el link de firma. Cuando el cliente firma, Firmame dispara webhook que actualiza el contrato a `signed`, descarga el PDF firmado a Railway S3, y notifica al admin. Reminders automáticos a 3/7/14 días si no firma.

Cada org configura sus propias empresas emisoras + contratos + credenciales Firmame en `/configuracion`. Modelo **BYO Firmame** para MVP (cada org trae su API key); modelo Master/Hybrid queda como research item post-MVP.

Se incluye una **vista pipeline mínima de contratos** (`/contratos`) para que admin vea status / días sin firmar / errors. El pipeline GLOBAL multi-documento (quotation→contract→invoice→deliverable) se difiere a sub-spec separado.

## 2. Requirements

- R1. Cada org configura sus propios contratos. NO templates globales para contracts.
- R2. Granularidad: 1 template por `(orgId, issuingCompanyId, subserviceId, type='contract')`.
- R3. `signerMode` configurable per template:
  - `client_only`: solo cliente firma vía Firmame; el despacho pre-firma su parte o no firma en digital.
  - `co_sign`: cliente + representante de issuingCompany firman ambos vía Firmame (sequential).
- R4. Trigger: auto-pipeline al `quotation.status='approved'`. Sin gate manual del admin.
- R5. Post-signed: solo marca firmado + email admin + log. NO factura auto. NO activación auto de proyección. (Mantiene `V1 factura manual` de doc lifecycle.)
- R6. Reminders cron: 3d, 7d, 14d después de `sentAt` si no firmado. Después email admin "considera cancelar"; stop cliente.
- R7. Pipeline view: lista de contratos por org con status, días sin firmar, errors, acciones manuales (reenviar reminder, cancelar, link a Firmame).
- R8. Firmame: modelo BYO MVP. Cada org pega su API key en `/configuracion/integraciones` (UI ya existe).

## 3. Arquitectura

```
┌────────────────────────────────────────────────────────────┐
│  CLIENTE acepta cotización (existing SS3B publicActions)   │
└────────────────────────┬───────────────────────────────────┘
                         │ scheduler.runAfter(0)
                         ▼
┌────────────────────────────────────────────────────────────┐
│  sendContractToFirmameInternal (action)                    │
│   resolve issuingCompany → findTemplate → render HTML →   │
│   PDF (Puppeteer) → Firmame API upload → insert contract,  │
│   emailLog, documentEvents → Resend email                  │
└────────────────────────┬───────────────────────────────────┘
                         │ async
                         ▼
                  ┌──────────────┐
                  │ CLIENTE firma│
                  └──────┬───────┘
                         │ webhook
                         ▼
┌────────────────────────────────────────────────────────────┐
│  POST /api/webhooks/firmame (Next.js)                      │
│   verify HMAC → ConvexHttpClient.action(handleFirmameEvent)│
│   - signed: pull PDF, upload Railway S3, patch contract,   │
│     log signed event, email admin                          │
│   - rejected/expired/cancelled: patch status='cancelled',  │
│     log, email admin                                       │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│  cron contractReminders.tick (daily 10:00 local)           │
│   scan sent contracts → schedule reminder action 3/7/14d   │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│  Admin UI /contratos (pipeline view)                       │
│   lista filtrable + acciones manuales                      │
└────────────────────────────────────────────────────────────┘
```

### Boundaries

- **Convex actions:** network calls (Firmame API, Puppeteer, Resend). Mutations son pure DB.
- **HTTP webhook:** en Next.js route (`src/app/api/webhooks/firmame/route.ts`), NO Convex http actions. Más fácil debug + access a raw body para HMAC verify.
- **Firmame client aislado:** todo HTTP a Firmame en `convex/lib/firmameClient.ts`. Endpoint config, payload shape, error mapping. Cambio de provider o Master account post-MVP = solo este archivo.

## 4. Schema changes

### 4.1 `deliverableTemplates` — campos opcionales nuevos

```ts
{
  // ...existing fields
  issuingCompanyId: v.optional(v.id("issuingCompanies")),
  signerMode: v.optional(v.union(
    v.literal("client_only"),
    v.literal("co_sign"),
  )),
}
.index("by_orgId_type_issuingCompanyId_subserviceId",
  ["orgId", "type", "issuingCompanyId", "subserviceId"])
```

**Validación en mutations:** cuando `type='contract'`, `issuingCompanyId` es required Y `orgId` es required (NO globals para contracts — ver §1 R1). Para otros types, `issuingCompanyId` debe ser `undefined` (rechazar si presente).

**Default `signerMode`** cuando undefined: `client_only`.

### 4.2 `contracts` — campos Firmame + reminders

```ts
{
  // ...existing fields (orgId, quotationId, projServiceId, clientId,
  //    serviceName, subserviceId, content, pdfStorageId, status,
  //    signedAt, createdAt)
  firmameDocumentId: v.optional(v.string()),
  firmameSignUrl: v.optional(v.string()),
  firmameStatus: v.optional(v.string()),
  signedPdfBucketKey: v.optional(v.string()),
  sentAt: v.optional(v.number()),
  lastReminderAt: v.optional(v.number()),
  reminderCount: v.optional(v.number()),
  signerMode: v.optional(v.union(
    v.literal("client_only"),
    v.literal("co_sign"),
  )),
  cancellationReason: v.optional(v.string()),
}
.index("by_firmameDocumentId", ["firmameDocumentId"])
```

`signerMode` snapshot al `sendContractToFirmame` time (NO re-derive del template — reproducibilidad histórica si template muta).

### 4.3 `orgIntegrations` — promover `firmame` literal

```ts
provider: v.union(
  v.literal("resend"),
  v.literal("mifiel"),    // keep (legacy, no usar)
  v.literal("firmame"),   // NEW explicit
  v.literal("anthropic"),
  v.literal("other"),
)
```

**Migración:** rows con `provider='other'` + `providerLabel='firmame'` → `provider='firmame'`. Cursor-based pagination (patrón SS1 hardening).

### 4.4 Sin tabla nueva

No se crea `contractTemplates`. Reuse `deliverableTemplates` (consistente con cómo creció con `contentStatus`, `parentTemplateId`). Reuse total de SS1: detector placeholder/ready, editor UI, bulk-import CLI, sin cambios.

## 5. Resolver de templates

```ts
async function findContractTemplate(
  ctx, orgId, issuingCompanyId, subserviceId
): Promise<Doc<"deliverableTemplates"> | null>
```

Lookup:
1. **Exact match org-scoped:** `(orgId, type='contract', issuingCompanyId, subserviceId)` por índice `by_orgId_type_issuingCompanyId_subserviceId`.
2. Sin match → `null` → admin error event ("Falta template de contrato para [empresa emisora] × [subservicio]. Súbelo en /configuracion/empresas/[id]/contratos").

NO hay fallback global para contracts (R1 — cada org sus propios contratos).

## 6. Flow detallado — sendContract

**Trigger:** `quotations/publicActions.acceptQuotation` (existing) ya pone `status='approved'`. Agregar al final:
```ts
await ctx.scheduler.runAfter(0,
  internal.contracts.actions.sendContractToFirmameInternal,
  { quotationId });
```

**Action `sendContractToFirmameInternal({ quotationId })`:**

1. Lee quotation + projService + client + projection.
2. Resuelve `issuingCompany`:
   - Check `clientIssuingCompanyOverride(clientId, serviceId)` → si existe usar ese
   - Else `servicesIssuingCompanyMap(serviceId)` → ese
   - Else `issuingCompanies.by_orgId_isDefault(orgId, true)` → ese
   - Else error event, abort.
3. `findContractTemplate(orgId, issuingCompanyId, subserviceId)` → si null, error event, abort.
4. Render HTML — reuse pipeline SS1: `personalizeTemplate` con context `{ client, projection, projService, issuingCompany, subservice, quotation }`. Variables expandidas: `{{cliente.nombre}}`, `{{cliente.rfc}}`, `{{contrato.monto_total}}`, `{{contrato.vigencia_inicio}}`, `{{contrato.vigencia_fin}}`, `{{empresa.legalName}}`, `{{empresa.rfc}}`, `{{servicio.nombre}}`, etc.
5. POST a endpoint Puppeteer interno (existing) → PDF buffer.
6. Lee `orgIntegrations.findActive(orgId, provider='firmame')` — si no existe / `status != active` → error event, abort.
7. `firmameClient.createDocument({ pdfBuffer, signers, title, deadline })` — **payload shape TBD pending docs**.
8. Receive `{ firmameDocumentId, signUrl, status }`.
9. INSERT `contracts` (status=`sent`, firmameDocumentId, firmameSignUrl, firmameStatus, sentAt=now, signerMode snapshot, todos los IDs).
10. INSERT `emailLog` (type=`contract`, status=`queued`, body con signUrl, relatedType=`contract`, relatedId=contractId).
11. INSERT `documentEvents` (entityType=`contract`, entityId=contractId, eventType=`created`, actorType=`system`).
12. Send via Resend; on ack → INSERT `documentEvents` (eventType=`sent`).

## 7. Webhook handler

**Endpoint:** `POST /api/webhooks/firmame` (Next.js route)

**Flow:**
1. Read raw body (Buffer) — necesario para HMAC.
2. Extract signature header (e.g. `x-firmame-signature` — **header name TBD**).
3. Find orgId: parse `firmameDocumentId` del payload → lookup contract por índice `by_firmameDocumentId` → derive `orgId`. Si no existe contract con ese firmameDocumentId → 404, log warning.
4. Lee `orgIntegrations.findActive(orgId, 'firmame')` → webhookSecret.
5. HMAC verify (scheme TBD; probable SHA256(secret + body)). Si mismatch → 401, log warning, return.
6. ConvexHttpClient → `internal.contracts.actions.handleFirmameWebhook({ payload })`.
7. Action handleFirmameWebhook:
   - Lookup contract by `firmameDocumentId` (índice nuevo)
   - Idempotency: if contract.status ya es el target → return 200, no-op
   - Switch on event:
     - **`signed`** — pull signed PDF de Firmame (`firmameClient.downloadSignedPdf(docId)`) → upload a Railway S3 (existing `uploadToBucket`) → patch contract (status=`signed`, signedAt=now, signedPdfBucketKey, firmameStatus) → INSERT documentEvents `signed` → email confirmación admin (respeta `orgConfigs.notificationPreferences`)
     - **`rejected`/`expired`/`cancelled`** — patch (status=`cancelled`, cancellationReason, firmameStatus) → documentEvents `voided` → email admin
     - **Otros (sent/viewed/etc.)** — log only, no mutate
8. Return 200 incluso si internal error (avoid Firmame retry storm); log internamente con severity=error.

**HTTP method:** sólo POST. Reject otros con 405.

## 8. Cron reminders

**Declaración** en `convex/crons.ts`:
```ts
crons.daily("contract reminders",
  { hourUTC: 16, minuteUTC: 0 },   // 10 AM CDMX en horario base
  internal.contracts.cron.contractRemindersTick
);
```

NOTE: usa UTC base; for true per-org timezone iteramos orgs y aplicamos offset (post-MVP optim). Para MVP: 1 corrida UTC fixed.

**Internal mutation `contractRemindersTick`:**
- Query contracts: `status='sent'`, `signedAt=null`, `sentAt < now - 3d`.
- For each: compute days since sentAt + reminderCount.
- Eligibility:
  - 3d ≤ days < 7d AND reminderCount=0 → schedule reminder, reminderCount=1
  - 7d ≤ days < 14d AND reminderCount=1 → schedule, reminderCount=2
  - days ≥ 14d AND reminderCount=2 → schedule **admin** notification "considera cancelar", reminderCount=3
  - reminderCount=3 → no-op
- Schedule action `sendContractReminder({ contractId, kind })` con `scheduler.runAfter`.

**Action `sendContractReminder`:**
- Re-fetch contract (en caso de race con webhook signed)
- Si status != `sent` → abort (firmó entre tick y send)
- Send email via Resend (template diferente per kind: reminder_3d, reminder_7d, admin_final)
- emailLog type=`contract_reminder`
- Update contract.lastReminderAt=now
- documentEvents eventType=`reminder_sent`

## 9. Pipeline view UI

**Route:** `/contratos` — `src/app/(dashboard)/contratos/page.tsx`

**Layout:**
- Header: "Contratos" + filtros + botón "Reenviar todos los > 7d"
- Banner naranja arriba si hay contratos `sentAt < now - 7d` sin firmar (count + link a filter)
- Tabla:
  | Cliente | Servicio | Empresa Emisora | Status | Sent | Días sin firmar | Últ reminder | Acciones |
- Status chips: `draft` (gris), `sent` (amber), `signed` (emerald), `cancelled` (rose)
- Sort: días sin firmar desc (stuck first)
- Filtros: status, días sin firmar (`>3d`/`>7d`/`>14d`), empresa emisora, cliente.
- Pagination: 50/page.
- Acciones per row:
  - "Ver en Firmame" → external link (`firmameSignUrl` o link a dashboard Firmame)
  - "Reenviar reminder" → trigger `sendContractReminder({ kind: 'manual' })`
  - "Cancelar" → confirm modal → mutation `cancelContract({ contractId, reason })`
  - "Reintentar" (solo si status=`draft` con error) → trigger send action

**Empty state:** "No hay contratos. Cuando un cliente acepte una cotización aparecerá aquí."

## 10. Error handling

| Caso | Comportamiento |
|---|---|
| Firmame API down | retry 3x exp backoff (patrón `deliverables/actions.ts`). Falla todo → contract `status='draft'`, error event, pipeline view rojo, "Reintentar". |
| Puppeteer down | mismo retry. Falla → NO contract; quotation queda `approved`; documentEvents `error`; email admin. |
| Webhook HMAC mismatch | 401, log warning, NO mutate. |
| Webhook duplicate | idempotency check de status. No-op. |
| Template missing | error event, email admin, NO email cliente. Admin debe subir template. |
| Issuing company unresolved | error event, email admin. |
| Cliente sin email | error event, contract `status='draft'`. |
| Firmame creds missing en orgIntegrations | error event al primer intento; admin redirected a `/configuracion/integraciones`. |
| Signed PDF download fail | retry 3x; falla → contract `signed` pero `signedPdfBucketKey=null`; admin alert; manual re-pull desde pipeline view. |

## 11. Testing

**Unit (~20 tests):**
- `findContractTemplate` (custom exact / fallback global / no match)
- `signerMode` default
- HMAC verify (valid / invalid / missing header / wrong scheme)
- Reminder eligibility boundaries (2.9d=no, 3d=yes, 6.9d=no si count=1, etc.)
- Webhook idempotency (signed→signed = no-op)
- IssuingCompany resolver order (override > map > default)

**Integration (~10 tests):**
- Quotation accept → sendContract flow con Firmame mock → assertions en contracts/emailLog/documentEvents
- Webhook signed → status update + PDF download + email
- Webhook duplicate
- Webhook rejected
- Cron pickup contracts a 3d/7d/14d
- Cron does NOT pickup signed contracts

**E2E manual (agent-browser):**
- Crear org DESC + issuing company + upload contract template HTML
- Crear cotización, accept, verificar email recibido con Firmame link
- Simular webhook signed → verificar pipeline view actualizada

**Target total:** ~903 tests (873 baseline + ~30).

## 12. Research items

### Bloquea impl (input Christian)

1. **Contratos HTML iniciales.** Min: 1 para org DESC + 1 issuingCompany + 1-2 subservicios. HTML con variables estilo SS1.
2. **Firmame API docs + sandbox API key.** Endpoints exactos, auth scheme (Bearer/Basic/custom), payload create-document, webhook event names, HMAC scheme + header. Sin esto, `firmameClient.ts` no se puede implementar concretamente.

### Research paralelo (NO bloquea impl, post-MVP decision)

3. **Modelo económico Firmame.**
   - Pricing real per signature / per documento / volume tiers.
   - ¿Firmame soporta multi-tenant routing (1 cuenta nuestra, webhooks per tenant)?
   - Competidores: MiFiel (notar memoria dice "NO MiFiel" pero re-evaluar a la luz de pricing), DocuSign, AdobeSign — pricing & features.
   - Break-even: ¿a partir de cuántas firmas/mes Master account se vuelve más rentable que BYO?
   - ¿Firmame ofrece reseller / white-label / partner program?

## 13. Decisiones diferidas (post-MVP)

1. **Modelo económico Master/Hybrid.** Pending research #3. Schema actual permite migración (`orgIntegrations` puede coexistir con master account central).
2. **Co-sign sequential vs parallel.** `signerMode='co_sign'` por ahora implementa la opción default de Firmame (probablemente sequential). UI no expone configurar el orden.
3. **Webhook escala (2000 contratos/mes target stub).** Next.js route soporta picos; revisar si llega a 50+ req/sec sostenido — Sub-spec 7 (queue + scale) lo aborda.
4. **Contract template versioning con `parentTemplateId` clone-on-personalize** (estilo SS1 A2). Defer — contratos típicamente NO se personalizan por-cliente (todos los del subservicio usan mismo template).
5. **Pipeline UI multi-documento global** (quotation→contract→invoice→deliverable). Sub-spec separado (refer a `2026-05-23-document-lifecycle-design.md` para foundation).
6. **Reminder cadence configurable per org.** Hard-coded 3/7/14d MVP. Post-MVP exponer en `orgConfigs.notificationPreferences`.
7. **Cancelar contrato en Firmame** cuando admin cancela localmente — agregar action que llame Firmame API cancel endpoint. **TBD** si Firmame soporta cancelación post-envío.

## 14. Migración / rollout

1. Apply schema changes (`deliverableTemplates`, `contracts`, `orgIntegrations`) — Convex push.
2. Migrate orgIntegrations rows `other`+`firmame` → `firmame` (cursor pagination).
3. Bulk-import templates de Christian (papá) usando CLI SS1 con type=`contract`.
4. Crear org de test "DESC" con 1 issuingCompany + 1 subservicio + 1 contract template + Firmame sandbox creds.
5. Smoke E2E manual: quotation → accept → verify email + Firmame doc creado → simulate webhook signed → verify pipeline view.
6. Habilitar cron `contractReminders.tick` (commented por default por seguridad).

## 15. Métricas de éxito

- Tests: ≥900 passing post-merge.
- TypeScript: clean (mantiene baseline excepto useDebouncedAutosave ortogonal).
- Manual smoke: 1 contrato sent → signed → status updated end-to-end con cuenta sandbox Firmame.
- Pipeline view muestra contratos correctamente, filtros funcionan.

## 16. Próximo paso

Después de approval de este spec → invocar `superpowers:writing-plans` para crear plan de implementación detallado (tasks TDD, orden de ejecución, dependencias). Plan se ejecutará con `subagent-driven-development` similar a SS0/SS1.

Research items #1 y #2 deben resolverse ANTES de que el plan llegue a la fase de Firmame integration (probablemente Phase 3+ del plan). Mientras tanto, Phases 1-2 (schema + resolver + UI templates) pueden ejecutarse sin esos inputs.
