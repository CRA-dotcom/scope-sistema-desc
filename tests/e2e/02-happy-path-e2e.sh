#!/usr/bin/env bash
# Section 3B — E2E Test 02: Happy path (semi-automated)
#
# This script REQUIRES manual setup before running:
#
#   1. Be logged into the dashboard in the same Chrome profile that
#      agent-browser will attach to (so the Clerk session cookie is set).
#   2. Have an existing quotation in `draft` status with:
#        - PDF generated (storageId set)
#        - client.contactEmail populated
#        - At least 1 active issuing company in the org
#   3. Export the quotation id:
#        export QUOTATION_ID=jh7abc...   # from the URL /cotizaciones/<id>
#   4. Optionally export CDP_PORT if attaching to an existing Chrome:
#        export CDP_PORT=9222
#
# The script captures key screenshots and pauses at interactive points
# where human verification is required (dialog interactions, email inbox,
# accept/reject confirmation).
#
# Usage:
#   QUOTATION_ID=<id> APP_URL=http://localhost:3000 bash tests/e2e/02-happy-path-e2e.sh

set -euo pipefail

APP_URL="${APP_URL:-http://localhost:3000}"
QUOTATION_ID="${QUOTATION_ID:?Set QUOTATION_ID env var (the cotizacion _id from /cotizaciones/<id>)}"
SCREENSHOT_DIR="$(cd "$(dirname "$0")/../../docs/qa/screenshots" && pwd)"

mkdir -p "$SCREENSHOT_DIR"

echo "==> Section 3B / E2E 02 — Happy path (semi-automated)"
echo "    APP_URL=$APP_URL"
echo "    QUOTATION_ID=$QUOTATION_ID"
echo "    SCREENSHOT_DIR=$SCREENSHOT_DIR"
echo ""

pause() {
  echo ""
  echo ">>> $1"
  read -rp "    Press ENTER when done... " _
}

# ---------------------------------------------------------------------------
# Step 1: Open quotation detail (auth required)
# ---------------------------------------------------------------------------
echo "==> Step 1: Open /cotizaciones/$QUOTATION_ID"
npx agent-browser open "$APP_URL/cotizaciones/$QUOTATION_ID"
sleep 2
npx agent-browser screenshot "$SCREENSHOT_DIR/e2e-02-quotation-detail-draft.png"

# Sanity check: confirm the quotation page loaded (not redirected to /sign-in)
SNAPSHOT=$(npx agent-browser snapshot -i)
if echo "$SNAPSHOT" | grep -qi "sign in\|iniciar sesión"; then
  echo "  FAIL: redirected to sign-in. Make sure your Chrome profile has an"
  echo "        active Clerk session cookie for $APP_URL."
  exit 1
fi
echo "  OK Quotation detail loaded"

# ---------------------------------------------------------------------------
# Step 2: Open SendQuotationDialog
# ---------------------------------------------------------------------------
echo ""
echo "==> Step 2: Locate and click 'Enviar por email' button"
npx agent-browser snapshot -i
echo ""
echo "  Look for the 'Enviar por email' button in the snapshot above."
echo "  Then run interactively:"
echo "      npx agent-browser click @e<N>"
echo "  where <N> is the element id of the button."
pause "Click the button, then ENTER to continue."

npx agent-browser screenshot "$SCREENSHOT_DIR/e2e-02-send-dialog-open.png"

# ---------------------------------------------------------------------------
# Step 3: Submit the dialog
# ---------------------------------------------------------------------------
echo ""
echo "==> Step 3: Verify prefilled fields and submit"
echo "  - to:      <client.contactEmail>"
echo "  - subject: 'Cotización <empresa> — <folio>'"
echo "  - message: default template (editable)"
pause "Click 'Enviar' to submit, then ENTER once the success view appears."

npx agent-browser screenshot "$SCREENSHOT_DIR/e2e-02-send-dialog-success.png"

# ---------------------------------------------------------------------------
# Step 4: Capture the public URL from the success view
# ---------------------------------------------------------------------------
echo ""
echo "==> Step 4: Copy the public URL from the success view"
echo "  The dialog shows the link /q/cotizacion/<token> ONCE."
read -rp "    Paste the full URL here: " PUBLIC_URL
if [ -z "$PUBLIC_URL" ]; then
  echo "  FAIL: empty URL"
  exit 1
fi
echo "  Captured: $PUBLIC_URL"

# ---------------------------------------------------------------------------
# Step 5: Refresh dashboard to verify SendStatusPanel
# ---------------------------------------------------------------------------
echo ""
echo "==> Step 5: Refresh dashboard, verify SendStatusPanel"
npx agent-browser open "$APP_URL/cotizaciones/$QUOTATION_ID"
sleep 2
npx agent-browser screenshot "$SCREENSHOT_DIR/e2e-02-send-status-panel.png"

SNAPSHOT=$(npx agent-browser snapshot -i)
if echo "$SNAPSHOT" | grep -qi "enviada hace\|reenviar"; then
  echo "  OK SendStatusPanel shows 'Enviada hace ...' or 'Reenviar'"
else
  echo "  WARN: could not auto-detect SendStatusPanel state. Verify visually."
fi

# ---------------------------------------------------------------------------
# Step 6: Open the public link in a fresh context (no auth)
# ---------------------------------------------------------------------------
echo ""
echo "==> Step 6: Open public landing in incognito-like context"
echo "  Open the URL below in a private/incognito window manually,"
echo "  OR use a separate Chrome profile. agent-browser may share cookies."
echo "  $PUBLIC_URL"
pause "Verify branding (logo, primaryColor) and content. ENTER to continue."

# ---------------------------------------------------------------------------
# Step 7: Accept the quotation
# ---------------------------------------------------------------------------
echo ""
echo "==> Step 7: Click 'Aceptar cotización' on the public landing"
pause "After accepting, ENTER to continue."

# ---------------------------------------------------------------------------
# Step 8: Verify dashboard shows 'Aprobado'
# ---------------------------------------------------------------------------
echo ""
echo "==> Step 8: Refresh dashboard, verify status 'Aprobado'"
npx agent-browser open "$APP_URL/cotizaciones/$QUOTATION_ID"
sleep 2
npx agent-browser screenshot "$SCREENSHOT_DIR/e2e-02-dashboard-approved.png"

SNAPSHOT=$(npx agent-browser snapshot -i)
if echo "$SNAPSHOT" | grep -qi "aprobado\|approved"; then
  echo "  OK Dashboard shows approved state"
else
  echo "  WARN: could not auto-detect approved badge. Verify visually."
fi

# ---------------------------------------------------------------------------
# Step 9: Wait for contract auto-generation
# ---------------------------------------------------------------------------
echo ""
echo "==> Step 9: Wait ~30s for contract auto-generation, then check /contratos"
sleep 30
npx agent-browser open "$APP_URL/contratos"
sleep 2
npx agent-browser screenshot "$SCREENSHOT_DIR/e2e-02-contracts-list.png"
echo "  Verify a new contract draft is listed referencing this quotation."

echo ""
echo "==> Happy path E2E completed."
echo "    Screenshots in $SCREENSHOT_DIR/e2e-02-*.png"
npx agent-browser close || true
