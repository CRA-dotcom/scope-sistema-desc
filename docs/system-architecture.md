# Projex — System architecture (2026-05-22 snapshot)

Diagramas Mermaid del sistema en su estado actual post-sprint v2. Renderiza directo en GitHub/VS Code (markdown preview).

---

## 1. Arquitectura de alto nivel

```mermaid
graph TB
    subgraph Browser["🌐 Browser - Operador"]
        UI_Wizard["/proyecciones/nueva<br/>Wizard 4 steps"]
        UI_Matrix["/proyecciones/[id]<br/>Matriz mensual + drawer"]
        UI_Fact["/facturacion<br/>Upload PDF + markPaid"]
        UI_Tmpl["/configuracion/plantillas<br/>Tree Servicio→Subservicio"]
        UI_Quest["/cuestionarios<br/>Lista + share link"]
        UI_Entreg["/entregables/[id]<br/>Preview iframe + PDF"]
        UI_Conf["/configuracion/*<br/>Branding, notif, integraciones"]
        UI_Plat["/platform/*<br/>Super-admin: orgs, métricas, templates"]
    end

    subgraph PublicWeb["🔗 Browser - Cliente final - sin auth"]
        UI_Pub["/q/[token]<br/>Responder cuestionario"]
    end

    subgraph NextJS["▲ Next.js 15 - Vercel"]
        Pages["App Router pages<br/>(client + server)"]
        APIPdf["/api/generate-pdf<br/>puppeteer-core route"]
        APIClerk["/api/clerk/*<br/>webhooks, invite"]
    end

    subgraph Convex["⚡ Convex - DB + Server functions"]
        Queries["queries.ts<br/>read auth+org-filtered"]
        Mutations["mutations.ts<br/>write auth+org-filtered"]
        Actions["actions.ts<br/>side effects external"]
        Internal["internal.* / publicMutations<br/>scheduler + token paths"]
        Scheduler["ctx.scheduler.runAfter<br/>job queue async"]
        Crons["crons.ts<br/>daily overdue + eligibility scan"]
    end

    subgraph External["🔌 External services"]
        Clerk["🔐 Clerk<br/>Auth + Organizations<br/>org:admin / org:member"]
        Resend["📧 Resend<br/>Email send only<br/>FROM noreply@biz...com"]
        Claude["🤖 Claude API<br/>AI variable fill<br/>claude-sonnet-4-20250514"]
        Railway["📦 Railway S3<br/>PDF/factura blob storage<br/>metadata in Convex"]
        Firmame["✍️ Firmame<br/>Firma digital - pending integration"]
    end

    UI_Wizard --> Pages
    UI_Matrix --> Pages
    UI_Fact --> Pages
    UI_Tmpl --> Pages
    UI_Quest --> Pages
    UI_Entreg --> Pages
    UI_Conf --> Pages
    UI_Plat --> Pages
    UI_Pub --> Pages

    Pages -->|useQuery / useMutation / useAction| Queries
    Pages --> Mutations
    Pages --> Actions
    Pages -->|signed-in identity| Clerk

    APIPdf -->|HTML to PDF| Browser
    Actions -->|fetch HTML to PDF| APIPdf

    Mutations -->|enqueue| Scheduler
    Scheduler --> Actions
    Crons --> Internal
    Internal --> Mutations

    Actions -->|sendEmail| Resend
    Actions -->|messages.create| Claude
    Actions -->|S3 PUT blob| Railway
    Mutations -->|metadata only| Railway

    Queries -.->|JWT orgRole| Clerk
    Mutations -.->|JWT orgRole| Clerk
    UI_Pub -.->|accessToken, no auth| Internal

    classDef external fill:#1e293b,stroke:#475569,color:#cbd5e1
    classDef ui fill:#1e3a8a,stroke:#3b82f6,color:#dbeafe
    classDef backend fill:#14532d,stroke:#22c55e,color:#dcfce7
    class Clerk,Resend,Claude,Railway,Firmame external
    class UI_Wizard,UI_Matrix,UI_Fact,UI_Tmpl,UI_Quest,UI_Entreg,UI_Conf,UI_Plat,UI_Pub ui
    class Queries,Mutations,Actions,Internal,Scheduler,Crons backend
```

---

## 2. Data model — tablas principales

```mermaid
erDiagram
    organizations ||--o{ clients : "has"
    organizations ||--o{ projections : "has"
    organizations ||--|| orgConfigs : "has 1"
    organizations ||--|| orgBranding : "has 1"
    organizations ||--o{ subservices : "scoped clones"

    clients ||--o{ projections : "has"
    clients ||--o{ questionnaireResponses : "responds"
    clients ||--o{ invoices : "billed"

    projections ||--o{ projectionServices : "has many"
    projections ||--|| seasonalityData : "embedded"
    projectionServices ||--o{ monthlyAssignments : "12 rows"

    services ||--o{ subservices : "parent of"
    subservices ||--o{ projectionServices : "selected at wizard"
    subservices ||--o{ monthlyAssignments : "per-month pick"
    subservices ||--o{ deliverableTemplates : "1 short + 1 long"

    monthlyAssignments ||--o{ invoices : "invoiced for"
    invoices ||--o{ deliverables : "triggers"
    deliverableTemplates ||--o{ deliverables : "rendered from"

    organizations {
        string id PK
        string name
        plan plan
    }
    clients {
        Id _id PK
        string orgId FK
        string name
        string contactEmail
        string assignedTo "Clerk userId"
    }
    projections {
        Id _id PK
        string orgId
        Id clientId FK
        int year
        int startMonth "1-12"
        int monthCount "1-12"
        string projectionMode "fiscal | rolling"
        number annualSales
        number totalBudget
        number commissionRate
        array seasonalityData "12 entries"
        array seasonalityOutliers
    }
    projectionServices {
        Id _id PK
        Id projectionId FK
        Id serviceId
        Id subserviceId "fixed at wizard"
        number annualAmount
        number normalizedWeight
        boolean isActive
    }
    monthlyAssignments {
        Id _id PK
        Id projServiceId FK
        Id subserviceId "operator pick per cell"
        int month "1-12"
        number amount
        number feFactor
        status status
        invoiceStatus invoiceStatus "legacy"
    }
    services {
        Id _id PK
        string name "9 áreas: Legal Contable TI Marketing RH Admin Comisiones Logística Construcción"
    }
    subservices {
        Id _id PK
        string orgId "null = global"
        Id parentServiceId FK
        string name
        string slug
        frequency defaultFrequency "mensual trimestral semestral anual una_vez"
        array applicableMonths
        boolean isActive
        Id parentSubserviceId "copy-on-write clone source"
    }
    deliverableTemplates {
        Id _id PK
        string orgId "null = global"
        Id subserviceId "match key"
        type type "deliverable_short long quotation contract questionnaire"
        string name
        string htmlTemplate
        array variables
        int version
    }
    invoices {
        Id _id PK
        Id clientId FK
        Id projectionId
        Id monthlyAssignmentId
        int month
        int year
        number amount
        status status "uploaded paid void"
        string bucketKey "Railway S3"
    }
    deliverables {
        Id _id PK
        Id templateId
        int templateVersion
        string templateHtmlSnapshot "frozen for audit"
        string shortContent "rendered"
        string longContent
        triggerSource triggerSource "manual cron invoice_paid api"
        Id triggerInvoiceId
    }
    questionnaireResponses {
        Id _id PK
        Id clientId FK
        Id projectionId
        string accessToken "public-link auth"
        status status "draft sent in_progress completed"
        array responses
        timestamp completedAt
    }
    orgConfigs {
        string orgId PK
        string notificationEmail "OPS catch-all override"
        object featureFlags "manualOverrideAllowed etc"
    }
```

---

## 3. Lifecycle de documento (estado)

```mermaid
stateDiagram-v2
    [*] --> ClienteCreado
    ClienteCreado --> ProyeccionCreada: wizard 4-step
    ProyeccionCreada --> CuestionarioEnviado: generate token + email
    CuestionarioEnviado --> CuestionarioCompletado: cliente submit via /q/[token]
    CuestionarioCompletado --> NotifPapa: email a OPS_NOTIFICATION_EMAIL

    NotifPapa --> CotizacionGenerada: operator triggers
    CotizacionGenerada --> CotizacionAceptada: cliente click accept link HMAC
    CotizacionAceptada --> ContratoGenerado
    ContratoGenerado --> ContratoFirmado: Firmame (pending integration)

    ContratoFirmado --> FacturaSubida: operator manual PDF upload to Railway
    FacturaSubida --> FacturaPagada: operator markPaid in /facturacion

    FacturaPagada --> EntregableGenerado: scheduler.runAfter generateFromInvoice
    note left of EntregableGenerado
        Override manual: admin puede saltar
        directo aqui via /proyecciones drawer
        triggerSource = "manual"
    end note

    EntregableGenerado --> EntregableEntregado: link signed sent to cliente
    EntregableEntregado --> [*]

    FacturaSubida --> FacturaAnulada: admin markVoid
    FacturaAnulada --> [*]: requiere re-upload
```

---

## 4. Generación de entregable — flujo paralelo (auto vs override)

```mermaid
sequenceDiagram
    participant Op as Operador<br/>(browser)
    participant Mut as invoices.markPaid<br/>(mutation)
    participant Sch as ctx.scheduler
    participant GFI as generateFromInvoice<br/>(internalAction)
    participant Sel as selectDeliverableForMonth<br/>(internalQuery)
    participant Gen as generateDeliverable<br/>(action)
    participant Ai as Claude API
    participant Pdf as /api/generate-pdf
    participant Rail as Railway S3
    participant Db as Convex DB

    rect rgb(20, 50, 80)
    Note over Op,Db: 🔵 PATH AUTO — markPaid dispara
    Op->>Mut: click "Marcar pagada" en /facturacion
    Mut->>Db: patch invoice.status = "paid"
    Mut->>Sch: runAfter(0, generateFromInvoice, invoiceId)
    Mut-->>Op: { ok: true }
    Sch->>GFI: (async)
    GFI->>Db: load invoice
    GFI->>GFI: idempotency check by triggerInvoiceId
    GFI->>Sel: select template by frequency + subserviceId
    Sel-->>GFI: template snapshot
    GFI->>Gen: generateDeliverable(templateOverride)
    end

    rect rgb(80, 50, 20)
    Note over Op,Db: 🟠 PATH OVERRIDE MANUAL — admin click
    Op->>Gen: click "Generar entregable ahora"<br/>(drawer matrix-cell)
    Note over Gen: triggerSource = "manual"<br/>templateType = "deliverable_long"
    end

    Gen->>Db: load assignment, client, projService
    Note over Gen: 🛑 GUARD 2026-05-22:<br/>throw if assignment.subserviceId is null
    Gen->>Db: load questionnaire + orgBranding + template
    Gen->>Ai: batchFillWithClaude<br/>(retry 3x, cost tracking)
    Ai-->>Gen: filled variables
    Gen->>Db: insert deliverable<br/>(short + long content + snapshot)
    Gen->>Pdf: POST html → PDF buffer
    Pdf->>Pdf: puppeteer-core launch local Chrome<br/>(CHROMIUM_PATH env)
    Pdf-->>Gen: PDF blob
    Gen->>Rail: PUT pdf blob
    Gen->>Db: patch deliverable.pdfBucketKey
    Gen-->>Op: deliverable._id
    Op->>Op: navigate to /entregables/[id]<br/>iframe srcDoc preview
```

---

## 5. Engine: cálculo de allocation mensual (post-fix Katimi)

```mermaid
flowchart TD
    Start([wizard submit / recalculate]) --> Step1
    Step1[Step 1: comisiones<br/>annualCommissions = sales × rate × monthCount/12<br/>solo si commission service activo] --> Step2
    Step2[Step 2: remainingBudget = effectiveBudget − annualCommissions] --> Step3
    Step3[Step 3: activeServices = services.filter isActive AND NOT isCommission] --> Step4
    Step4[Step 4: totalWeight = Σ chosenPct activeServices] --> Step5
    Step5["Step 5: por cada activeService:<br/>normalizedWeight = chosenPct / totalWeight<br/>annualAmount = remainingBudget × normalizedWeight<br/><b>monthlyBase = annualAmount / sum feFactor in slice</b><br/>2026-05-22 fix<br/>adjustedAmount = monthlyBase × feFactor por mes"] --> Step5b
    Step5b["Step 5b: residual reconciliation<br/>1 annual drift to heaviest service<br/>2 monthly drift PROPORCIONAL al feFactor<br/>2026-05-22 fix"] --> Step6
    Step6[Step 6: monthlyTotals = Σ adjustedAmount per mes through services] --> Insert
    Insert[(insert monthlyAssignments<br/>12 rows per active service)]

    classDef fix fill:#3f2937,stroke:#dc2626,color:#fef2f2
    class Step5,Step5b fix
```

---

## 6. Multi-tenant isolation

```mermaid
flowchart LR
    User[👤 User signs in<br/>Clerk] -->|JWT incl. orgId + orgRole| App[Next.js client]
    App -->|every query/mutation| Convex
    Convex -->|ctx.auth.getUserIdentity| GetOrg{identity.orgId<br/>identity.orgRole}
    GetOrg -->|null| Reject1[❌ return empty or throw]
    GetOrg -->|✓| Filter[every table query<br/>uses by_orgId index]
    Filter --> RowCheck{row.orgId<br/>=== caller orgId?}
    RowCheck -->|sí| Allow[✅ return data]
    RowCheck -->|no| Reject2[❌ filtered out]

    SuperAdmin[👑 Super Admin<br/>publicMetadata.role super_admin] -->|bypass orgId filter<br/>per query opt-in| Convex
```

---

## Cómo se actualiza este doc

Cuando cambies arquitectura significativa:

1. Edita la sección correspondiente.
2. Si agregas un componente nuevo, agrégalo al diagrama de §1.
3. Si agregas tabla nueva, extiende §2.
4. Si cambias un flow de generación, actualiza §4.
5. Commit con mensaje `docs(architecture): <qué cambió>`.

Para diagramas más detallados temporales (durante brainstorming) — usa Excalidraw, no permanente.
