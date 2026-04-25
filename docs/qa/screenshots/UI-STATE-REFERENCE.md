# Section 3B - UI State Reference

This document catalogs the visible UI states for the Section 3B (cotizacion send/receive flow) feature. States that could be captured visually are stored as PNGs in this directory; states that require authenticated sessions and seeded data are documented structurally below.

Updated: 2026-04-23
Companion to: docs/qa/section-3B-visual-qa.md (if applicable)

## Capture status summary

| # | State | Capture | File |
|---|---|---|---|
| 1 | Invalid token | screenshot | `01-invalid-token-state.png` |
| 2 | Public landing loading spinner | structural only (race-condition timing) | n/a |
| 3 | Expired token | structural only | n/a |
| 4 | Already responded - approved | structural only | n/a |
| 5 | Already responded - rejected | structural only | n/a |
| 6 | Decline reason dialog | structural only | n/a |
| 7 | Public landing - ready (with quotation) | structural only | n/a |
| 8 | Just-responded confirmation (approved) | structural only | n/a |
| 9 | Just-responded confirmation (rejected) | structural only | n/a |
| 10 | SendQuotationDialog - initial | structural only | n/a |
| 11 | SendQuotationDialog - resend warning | structural only | n/a |
| 12 | SendQuotationDialog - PDF missing | structural only | n/a |
| 13 | SendQuotationDialog - issuingCompany error | structural only | n/a |
| 14 | SendQuotationDialog - success | structural only | n/a |
| 15 | SendStatusPanel - sent | structural only | n/a |
| 16 | SendStatusPanel - approved | structural only | n/a |
| 17 | SendStatusPanel - rejected (with reason) | structural only | n/a |
| 18 | Quotation detail buttons - draft | structural only | n/a |
| 19 | Quotation detail buttons - sent | structural only | n/a |
| 20 | Quotation detail buttons - approved | structural only | n/a |

States 2-20 require either extreme network-throttling timing (state 2), or an authenticated Clerk session plus a seeded quotation row in Convex with specific status/token fields (states 3-20). Setting up the seed data programmatically requires a chain of dependencies (organization, client, projection, projService, optional issuingCompany) that exceeds the scope of this QA task. Use this document as the visual specification.

---

## Public landing route

Route: `/q/cotizacion/[token]`
Page: `src/app/q/cotizacion/[token]/page.tsx`
Layout: `src/app/q/cotizacion/[token]/layout.tsx` (sets `robots: noindex,nofollow`, wraps in `min-h-screen bg-background text-foreground`)

The page calls `api.functions.quotations.publicQueries.getByToken({ token })` and routes by `result.kind`:
- `undefined` → loading spinner (state 2)
- `"invalid"` → `<InvalidTokenState>` (state 1)
- `"expired"` → `<ExpiredState>` (state 3)
- `"already_responded"` → `<QuotationRespondedState status={...} respondedAt={...} />` (states 4-5)
- `"ready"` → `<QuotationLandingContent>` (state 7)

### State 1 - Invalid token

Component: `src/components/public/InvalidTokenState.tsx`
Trigger:
- Token cannot be HMAC-hashed (e.g. `QUOTATION_TOKEN_SECRET` misconfigured) - `kind: "invalid"`
- Hash does not match any quotation row - `kind: "invalid"`
- Quotation found but client/projService missing - `kind: "invalid"`
- Quotation status is neither `sent`, `approved`, nor `rejected` (e.g. `draft`) - `kind: "invalid"`
- Or thrown from publicActions (`acceptAction` / `declineAction`) when err message contains `"invalid_token"` (sets `fatal = "invalid"`)

Visible elements:
- 64x64 muted-circle icon container with `Search` lucide icon (gray)
- H1: "Link no valido"
- Body: "Verifica que copiaste el link correcto de tu correo o contacta a tu ejecutivo."
- Footer: PublicFooter (`powered by Projex`)

Color cues: gris (muted)

JSX:
```tsx
<div className="min-h-screen flex items-center justify-center px-6">
  <div className="max-w-md text-center space-y-4">
    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-muted/40">
      <Search className="text-muted-foreground" size={28} />
    </div>
    <h1 className="text-xl font-semibold">Link no valido</h1>
    <p className="text-sm text-muted-foreground">
      Verifica que copiaste el link correcto de tu correo o contacta a tu ejecutivo.
    </p>
    <PublicFooter />
  </div>
</div>
```

Reference screenshot: `01-invalid-token-state.png`

### State 2 - Public landing loading spinner

Component: inline in `src/app/q/cotizacion/[token]/page.tsx` (lines 15-21)
Trigger: `result === undefined` while Convex query is in flight
Visible elements:
- Centered 32x32 spinner (`h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-accent`)

Color cues: spinner uses muted ring with accent-colored top (theme accent color)

JSX:
```tsx
<div className="min-h-screen flex items-center justify-center">
  <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-accent" />
</div>
```

Why no screenshot: The Convex query for an invalid token is essentially synchronous on localhost (sub-100ms), faster than the screenshot tool can capture between navigation and first render. Would require artificial network throttling via CDP, which agent-browser does not currently expose ergonomically. The render is straightforward and the JSX above is the full visual.

### State 3 - Expired

Component: `src/components/public/ExpiredState.tsx`
Trigger:
- `quotation.tokenExpiresAt` is missing or `< Date.now()` - `kind: "expired"`
- Or thrown from publicActions when err message contains `"expired"` (sets `fatal = "expired"`)

Visible elements:
- 64x64 amber-tinted circle (`bg-amber-500/20`) with `Clock` icon (`text-amber-400`)
- H1: "Esta cotizacion expiro"
- Body: "Por favor contacta a tu ejecutivo para solicitar una nueva cotizacion."
- PublicFooter

Color cues: ambar (warning)

JSX:
```tsx
<div className="min-h-screen flex items-center justify-center px-6">
  <div className="max-w-md text-center space-y-4">
    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/20">
      <Clock className="text-amber-400" size={28} />
    </div>
    <h1 className="text-xl font-semibold">Esta cotizacion expiro</h1>
    <p className="text-sm text-muted-foreground">
      Por favor contacta a tu ejecutivo para solicitar una nueva cotizacion.
    </p>
    <PublicFooter />
  </div>
</div>
```

### State 4 - Already responded (approved)

Component: `src/components/public/QuotationRespondedState.tsx` with `status="approved"`, `justNow={false}`
Trigger: Quotation has status `approved` - returns `kind: "already_responded"` from `getByToken`

Visible elements:
- 64x64 emerald-tinted circle (`bg-emerald-500/20`) with `CheckCircle2` icon (`text-emerald-400`)
- H1: "Esta cotizacion fue aprobada el {fecha}" (or no fecha if `respondedAt` null)
- Body: "Contacta a tu ejecutivo si necesitas modificarla."
- PublicFooter

Color cues: verde

### State 5 - Already responded (rejected)

Component: `src/components/public/QuotationRespondedState.tsx` with `status="rejected"`, `justNow={false}`
Trigger: Quotation has status `rejected` - `kind: "already_responded"`

Visible elements:
- 64x64 muted circle (`bg-muted/40`) with `XCircle` icon (`text-muted-foreground`)
- H1: "Esta cotizacion fue rechazada el {fecha}" (or no fecha)
- Body: "Contacta a tu ejecutivo si necesitas modificarla."
- PublicFooter

Color cues: gris (muted)

JSX (states 4-5 share component):
```tsx
<div className="min-h-screen flex items-center justify-center px-6">
  <div className="max-w-md text-center space-y-4">
    <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${
      isApproved ? "bg-emerald-500/20" : "bg-muted/40"
    }`}>
      {isApproved ? (
        <CheckCircle2 className="text-emerald-400" size={28} />
      ) : (
        <XCircle className="text-muted-foreground" size={28} />
      )}
    </div>
    <h1 className="text-xl font-semibold">
      Esta cotizacion fue {isApproved ? "aprobada" : "rechazada"}
      {when ? ` el ${when}` : ""}
    </h1>
    <p className="text-sm text-muted-foreground">
      Contacta a tu ejecutivo si necesitas modificarla.
    </p>
    <PublicFooter />
  </div>
</div>
```

Date format (`when`): `es-MX` long form, e.g. "23 de abril de 2026".

### State 6 - Decline reason dialog

Component: `src/components/public/DeclineReasonDialog.tsx`
Trigger: User clicks "Rechazar" in `<QuotationLandingContent>` action bar; `showDecline` set to true

Visible elements:
- Full-screen black/50 overlay (z-50, click-to-cancel)
- Centered card (`max-w-md rounded-lg border border-border bg-card p-6 shadow-lg`)
- Header row: H3 "Por que rechazas la cotizacion?" + X close button
- Subtext: "Tu respuesta es opcional. Nos ayuda a mejorar nuestra oferta."
- Textarea (4 rows, 500-char max, char counter `n/500` aligned right)
- Three buttons in footer:
  - "Cancelar" (outline, secondary hover)
  - "Rechazar sin comentario" (outline, muted text)
  - "Enviar rechazo" (primaryColor background, white text) - shows "Enviando..." while submitting, disabled state

Color cues:
- Overlay gris/negro semi-transparente
- Primary button uses `primaryColor` prop (defaults to `#1a1a2e` from `<QuotationLandingContent>`)

### State 7 - Public landing ready (with quotation content)

Component: `src/components/public/QuotationLandingContent.tsx`
Trigger: `result.kind === "ready"`

Layout (top to bottom):
1. Header: `border-b` (with `${primaryColor}30` border accent)
   - max-w-3xl row, gap-4
   - Logo (48x48 rounded image, only if `issuingCompany?.logoStorageUrl`)
   - Company name in `primaryColor`, optional `signatoryName` below in muted
2. Main: max-w-3xl `px-6 py-8` with sanitized HTML (DOMPurify) of `quotation.content`
3. Sticky bottom action bar (`fixed inset-x-0 bottom-0 border-t bg-background/95 backdrop-blur`)
   - Left: "Vigencia: hasta el {expiresDate}" in muted
   - Right: two buttons - "Rechazar" (outline) and "Aceptar cotizacion" with `CheckCircle2` icon and `primaryColor` background

When `submitting`: button text shows "Enviando..." and both buttons disabled.
On error (non-fatal): destructive-colored `<p>` shown below the button row inside the action bar.

### State 8 - Just-responded approved confirmation

Same component as State 4 (`QuotationRespondedState`) but with `justNow={true}`, status="approved", fresh `respondedAt={Date.now()}`.

Differences vs state 4:
- H1: "Gracias!"
- Body: "Hemos registrado tu aceptacion. En breve recibiras el contrato para firmar en tu correo."

### State 9 - Just-responded rejected confirmation

Same as state 5 with `justNow={true}`. Differences:
- H1: "Respuesta registrada"
- Body: "Si cambias de opinion, contacta a tu ejecutivo."

There is also an "unknown" branch (state ~9.5) inline in `QuotationLandingContent.tsx` lines 84-95 when an action throws `already_responded`:
- H1: "Esta cotizacion ya fue respondida"
- Body: "Si crees que es un error, contacta a tu ejecutivo."
- (no PublicFooter)

---

## Dashboard - SendQuotationDialog states

Component: `src/components/cotizaciones/SendQuotationDialog.tsx`
Triggered: from `/cotizaciones/[id]` page when "Enviar por email" or "Reenviar" button clicked.

Modal layout: `fixed inset-0 z-50 bg-black/50` overlay; centered card `max-w-xl rounded-lg border border-border bg-card p-6 shadow-lg`.

### State 10 - SendQuotationDialog initial (first-time send, valid)

Header H3: "Enviar cotizacion por email"
Body sections (top to bottom):
1. Destinatario - email input prefilled with `client.contactEmail`. Email regex validation: `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`. Shows "Email invalido" in destructive color when invalid and non-empty.
2. Asunto - text input prefilled from `preview.defaultSubject`.
3. Info card (`bg-secondary/30 p-3 rounded`):
   - "Adjunto: {pdfFilename}"
   - "Emitente: {issuingCompany.name}" (or "- (sin configurar)")
   - "Los links expiraran en {tokenTtlDays} dias." (smaller, more muted)
4. Footer buttons: "Cancelar" (outline) + "Enviar" (accent bg, with `Send` icon).
   - When `sending`: button text becomes "Enviando..." with `Loader2` spinner.
   - "Enviar" disabled unless: preview loaded, `hasPdf=true`, no `issuingCompanyError`, valid email, non-empty subject, not already sending.

### State 11 - SendQuotationDialog resend warning

When `preview.sendCount > 0`:
- Header H3 changes to: "Reenviar cotizacion (envio #{sendCount + 1})"
- Amber alert banner inside dialog body (top): `border-amber-500/30 bg-amber-500/10 p-3 text-amber-400` with `AlertTriangle` icon and text "Los links de accept/decline anteriores seran invalidados."

### State 12 - SendQuotationDialog PDF missing

When `!preview.hasPdf`:
- Red alert banner: `border-red-500/30 bg-red-500/10 p-3 text-red-400`
- Text: "Genera el PDF de la cotizacion antes de enviar."
- "Enviar" button disabled (canSend false).

### State 13 - SendQuotationDialog issuingCompany error

When `preview.issuingCompanyError` is set:
- Red alert banner with the error message text
- Inline link "Configurar emitente" (underline) pointing to `/configuracion/empresas-emitentes`
- "Enviar" button disabled.

### State 14 - SendQuotationDialog success

After `sendAction` resolves successfully (`success` state set):
- Replaces all form content
- Top row: emerald `CheckCircle2` icon (size 20) + "Cotizacion enviada" (font-medium, emerald)
- Body: "Destinatario: {to}" in muted
- Public link card (`bg-secondary/50 p-3 rounded`):
  - Label: "Link publico (para copiar si el cliente no recibe el email):"
  - Truncated `<code>` with `{appUrl}/q/cotizacion/{plaintextToken}`
  - "Copiar" button with `Copy` icon - changes to "Copiado" for 2s after click
- Footer: single "Cerrar" button (accent bg)

Color cues: verde (emerald) for success header; rest neutral.

### Generic error (any state)

After `sendAction` throws while in form state, `error` is rendered as red alert banner just above footer buttons.

---

## Dashboard - SendStatusPanel states

Component: `src/components/cotizaciones/SendStatusPanel.tsx`
Rendered: in `/cotizaciones/[id]/page.tsx` between action buttons and content area.

Hidden when: `quotation.status === "draft" && !quotation.sendCount` (returns null).

Date format (`fmt`): `es-MX`, day + month + hour:minute, e.g. "23 de abril, 14:35".

### State 15 - SendStatusPanel sent

Trigger: `quotation.status === "sent"` (regardless of `sendCount` for first-send vs reseend display label).

Visible elements:
- Card: `border-blue-500/30 bg-blue-500/10 p-4 rounded-lg`
- Header: blue-400 `Send` icon + text "Enviada" (or "Enviada N veces" if `sendCount > 1`)
- Body row: "Ultimo envio: {fmt(lastSentAt)} . Expira: [Clock icon] {fmt(tokenExpiresAt)}"
- Bottom link: "Ver historial de emails" - underlined-on-hover, points to `/configuracion/email-log?relatedId={quotation._id}`

Color cues: azul

### State 16 - SendStatusPanel approved

Trigger: `quotation.status === "approved"`

Visible elements:
- Card: `border-emerald-500/30 bg-emerald-500/10 p-4 rounded-lg`
- Header: emerald-400 `CheckCircle2` icon + "Aprobada por el cliente"
- Body: "{fmt(respondedAt)} . Enviada {sendCount} {vez|veces}"

Color cues: verde

### State 17 - SendStatusPanel rejected

Trigger: `quotation.status === "rejected"`

Visible elements:
- Card: `border-red-500/30 bg-red-500/10 p-4 rounded-lg`
- Header: red-400 `XCircle` icon + "Rechazada por el cliente"
- Body: "{fmt(respondedAt)}"
- Optional blockquote (only if `declineReason` exists): `border-l-2 border-red-500/50 pl-3 italic text-muted-foreground` showing the reason text

Color cues: rojo

---

## Dashboard - Quotation detail page button states

Page: `src/app/(dashboard)/cotizaciones/[id]/page.tsx`
Action bar location: just below the page header, above the SendStatusPanel.

Status pill in the page header uses these classes:
- draft: `bg-muted-foreground/20 text-muted-foreground` (label: "Borrador")
- sent: `bg-blue-500/20 text-blue-400` (label: "Enviado")
- approved: `bg-emerald-500/20 text-emerald-400` (label: "Aprobado")
- rejected: `bg-red-500/20 text-red-400` (label: "Rechazado")

### State 18 - Buttons when status=draft (not editing)

Visible (left to right):
1. "Editar Contenido" (outline, `Edit3` icon)
2. "Generar PDF" (outline, `Download` icon - or `Loader2` spinner with text "Generando..." / "Subiendo..." while `pdfState.isGenerating`/`isUploading`)
3. "Descargar PDF" (outline, `Download` icon) - only visible when `quotation.pdfStorageId` set
4. "Enviar por email" (`bg-blue-500/20 text-blue-400`, `Send` icon)
   - disabled unless `pdfStorageId` AND `client.contactEmail` exist
   - tooltip ("title" attribute): "Genera el PDF antes de enviar" or "Agrega email de contacto en el cliente"

When user clicks "Editar Contenido": replaces button row with "Guardar Cambios" (accent bg, `Save` icon, shows "Guardando..." while saving) + "Cancelar" (outline). Other action buttons hidden during edit.

### State 19 - Buttons when status=sent (not editing)

Same as state 18 except:
- "Editar Contenido" hidden (only shown when `isDraft && !editing`)
- "Enviar por email" label changes to "Reenviar" (still blue, `Send` icon)
- "Acciones admin" details/dropdown appears: outline button labeled "... Acciones admin" that on summary-click reveals a 256px-wide popover with two destructive admin shortcuts:
  - "Marcar como aprobada (sin email)"
  - "Marcar como rechazada (sin email)"
  These call `updateStatus` mutation directly.

### State 20 - Buttons when status=approved (not editing)

Same as state 18/19 except:
- No "Editar Contenido"
- No "Enviar por email" / "Reenviar" (only visible when `isDraft || isSent`)
- No "Acciones admin" dropdown
- Conditional contract action:
  - If `existingContract === null`: "Generar Contrato" button (accent bg, `Plus` icon, or `Loader2` spinner with text "Generando con AI (20-60s)..." while `isGeneratingContract`)
  - If `existingContract` exists: "Ver Contrato" link (outline, `FileSignature` icon + `ArrowRight` chevron) navigating to `/contratos/{contract._id}`

### Buttons when status=rejected (additional)

Inferred from code - the page does not render any rejected-specific buttons. Only PDF generate/download remain available; the SendStatusPanel below shows the rejection reason.

### Editing mode (any status that allows it)

When `editing === true`:
- Replaces content area with a 20-row `<textarea>` containing raw HTML, monospace font, secondary background.
- Shows "Guardar Cambios" + "Cancelar" buttons in the action bar; all other action buttons hidden.

### PDF error banner

When `pdfState.error` is set (PDF generation failure):
- Red alert banner (`border-red-500/30 bg-red-500/10 p-3 text-red-400`) just below the action button row, above SendStatusPanel.

---

## Color reference

| Cue | Background | Border | Foreground / Icon |
|---|---|---|---|
| verde (success) | `bg-emerald-500/10` or `/20` | `border-emerald-500/30` | `text-emerald-400` |
| rojo (error/rejected) | `bg-red-500/10` or `/20` | `border-red-500/30` | `text-red-400` / `text-destructive` |
| ambar (expired/warning) | `bg-amber-500/10` or `/20` | `border-amber-500/30` | `text-amber-400` |
| azul (sent) | `bg-blue-500/10` or `/20` | `border-blue-500/30` | `text-blue-400` |
| gris (muted/draft) | `bg-muted/40`, `bg-muted-foreground/20` | `border-border` | `text-muted-foreground` |
| primary | `bg-accent` | n/a | `text-accent-foreground` |
| brand (public landing) | inline-style `primaryColor` from `issuingCompany.primaryColor` (default `#1a1a2e`) | n/a | `color: white` on filled buttons |

---

## How to capture the missing screenshots

To capture states 3-20 visually, you need:

1. **Authenticated Clerk session** (the dashboard route is gated behind `(dashboard)` group middleware/Clerk).
2. **Seeded data**: create an `organization`, `client` (with `contactEmail`), `projection`, `projService`, `issuingCompany`, `quotation` row with the desired status and `tokenExpiresAt`. The token must be plaintext-derivable (or you must compute the HMAC-SHA256 hash with `QUOTATION_TOKEN_SECRET` and store it in `accessTokenHash`).
3. **For expired**: set `quotation.status = "sent"`, `tokenExpiresAt = Date.now() - 1` and visit `/q/cotizacion/{token}`.
4. **For already-responded**: set `quotation.status = "approved"` (or `"rejected"`) and `respondedAt = Date.now()`.
5. **For dashboard states**: use Clerk dev sign-in then navigate to `/cotizaciones/{id}` for the seeded quotation.

A future helper would be a `convex/functions/quotations/internalMutations.ts` debug/seed mutation `seedQuotationForQA({ status, expired })` callable via `npx convex run`. As of 2026-04-23 this does not exist; the visual specifications above suffice for implementation review.
