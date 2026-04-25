#!/usr/bin/env bash
# Section 3B — E2E Test 01: Public landing states (no auth)
#
# Tests the public route /q/cotizacion/[token] in its error/edge states.
# Only the InvalidTokenState path is fully automated here because it does
# not need seeded data. Other states (expired, already responded) require
# a real quotation in the DB and are documented but not auto-executed.
#
# Usage:
#   APP_URL=http://localhost:3000 bash tests/e2e/01-public-landing-states.sh

set -euo pipefail

APP_URL="${APP_URL:-http://localhost:3000}"
SCREENSHOT_DIR="$(cd "$(dirname "$0")/../../docs/qa/screenshots" && pwd)"

mkdir -p "$SCREENSHOT_DIR"

echo "==> Section 3B / E2E 01 — Public landing states"
echo "    APP_URL=$APP_URL"
echo "    SCREENSHOT_DIR=$SCREENSHOT_DIR"
echo ""

# ---------------------------------------------------------------------------
# Test 1.1: Invalid token (random garbage) -> InvalidTokenState
# ---------------------------------------------------------------------------
echo "==> Test 1.1: Invalid token state"
npx agent-browser open "$APP_URL/q/cotizacion/garbage_random_token_xyz_test"
sleep 1
npx agent-browser screenshot "$SCREENSHOT_DIR/e2e-01-invalid-token.png"

SNAPSHOT=$(npx agent-browser snapshot -i)
if echo "$SNAPSHOT" | grep -q "Link no válido"; then
  echo "  OK Invalid token state rendered ('Link no válido' heading found)"
else
  echo "  FAIL: expected 'Link no válido' heading"
  echo "----- snapshot -----"
  echo "$SNAPSHOT"
  echo "--------------------"
  npx agent-browser close || true
  exit 1
fi

# ---------------------------------------------------------------------------
# Test 1.2: Empty token segment -> 404 or InvalidTokenState
# ---------------------------------------------------------------------------
echo ""
echo "==> Test 1.2: Empty token segment"
HTTP_STATUS=$(curl -sS -o /dev/null -w "%{http_code}" "$APP_URL/q/cotizacion/")
if [ "$HTTP_STATUS" = "404" ] || [ "$HTTP_STATUS" = "200" ]; then
  echo "  OK Empty token returned HTTP $HTTP_STATUS (expected 404 or 200 with redirect)"
else
  echo "  FAIL: empty token returned unexpected HTTP $HTTP_STATUS"
  npx agent-browser close || true
  exit 1
fi

# ---------------------------------------------------------------------------
# Test 1.3: SQL-injection-style token -> still InvalidTokenState (not 500)
# ---------------------------------------------------------------------------
echo ""
echo "==> Test 1.3: Injection-style token still safe"
INJECTION_TOKEN="abc%27%20OR%201%3D1--"
HTTP_STATUS=$(curl -sS -o /dev/null -w "%{http_code}" "$APP_URL/q/cotizacion/$INJECTION_TOKEN")
if [ "$HTTP_STATUS" = "200" ]; then
  echo "  OK Injection-style token returned 200 (renders InvalidTokenState client-side)"
else
  echo "  FAIL: unexpected HTTP $HTTP_STATUS for injection-style token"
  npx agent-browser close || true
  exit 1
fi

# ---------------------------------------------------------------------------
# Documented (manual) tests — require seeded data
# ---------------------------------------------------------------------------
cat <<'EOF'

==> Manual tests (require seeded quotation):

  [ ] ExpiredTokenState
      1. In Convex Dashboard, edit the quotation doc and set
         tokenExpiresAt = Date.now() - 1000.
      2. Open /q/cotizacion/<plaintext-token> in incognito.
      3. Capture screenshot to docs/qa/screenshots/24-expired-token-state.png.

  [ ] AlreadyRespondedState
      1. Accept or reject a quotation via the public landing.
      2. Open the same link again (without rotating the token).
      3. Capture screenshot to docs/qa/screenshots/25-already-responded-state.png.

  Seeding can be done via:
    - Convex Dashboard (Tables -> quotations -> Edit doc)
    - npx convex run quotations:seedTestQuotation '{...}' (if a seed mutation exists)

EOF

echo "==> All automated public landing state tests passed"
npx agent-browser close || true
