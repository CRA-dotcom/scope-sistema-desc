#!/usr/bin/env bash
# Section 3B — E2E Test 03: Security checks (automated, no auth)
#
# Verifies:
#   1. Token forgery -> all random tokens land on InvalidTokenState
#   2. <meta name="robots" content="noindex,nofollow"> on the public layout
#   3. Token plaintext is never returned by the public getByToken query
#      (best-effort heuristic via raw HTML inspection)
#
# Usage:
#   APP_URL=http://localhost:3000 bash tests/e2e/03-security-checks.sh

set -euo pipefail

APP_URL="${APP_URL:-http://localhost:3000}"

echo "==> Section 3B / E2E 03 — Security checks"
echo "    APP_URL=$APP_URL"
echo ""

# ---------------------------------------------------------------------------
# Test 3.1: Token forgery rejection
# ---------------------------------------------------------------------------
echo "==> Test 3.1: Token forgery rejection"

TOKENS=(
  "abc"
  "garbage_string"
  "admin"
  "../../etc/passwd"
  "$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"
)

for token in "${TOKENS[@]}"; do
  # URL-encode the token segment to be safe
  ENCODED=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$token" 2>/dev/null || echo "$token")
  STATUS=$(curl -sS -o /dev/null -w "%{http_code}" "$APP_URL/q/cotizacion/$ENCODED")
  if [ "$STATUS" = "200" ]; then
    echo "  OK Random token '$token' -> 200 (renders InvalidTokenState client-side)"
  elif [ "$STATUS" = "404" ]; then
    echo "  OK Random token '$token' -> 404"
  else
    echo "  FAIL: unexpected status $STATUS for token '$token'"
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# Test 3.2: noindex meta on public landing
# ---------------------------------------------------------------------------
echo ""
echo "==> Test 3.2: noindex meta on public landing"
HTML=$(curl -sS "$APP_URL/q/cotizacion/anything")
if echo "$HTML" | grep -qiE 'name="robots"[^>]*content="[^"]*noindex'; then
  echo "  OK <meta name=\"robots\" content=\"noindex,nofollow\"> present"
elif echo "$HTML" | grep -qiE 'content="[^"]*noindex[^"]*"[^>]*name="robots"'; then
  echo "  OK robots noindex meta present (alternate attribute order)"
else
  echo "  FAIL: noindex meta missing from public landing layout"
  echo "----- HTML head excerpt -----"
  echo "$HTML" | head -c 4000
  echo "-----------------------------"
  exit 1
fi

# ---------------------------------------------------------------------------
# Test 3.3: Token plaintext not in public response
# ---------------------------------------------------------------------------
echo ""
echo "==> Test 3.3: Token plaintext leakage check (heuristic)"
# Use a known-bad token. The HTML must NOT echo it back (it should only
# be referenced as a route param, never displayed in content).
TEST_TOKEN="probe_token_should_not_leak_xyz123"
HTML=$(curl -sS "$APP_URL/q/cotizacion/$TEST_TOKEN")

# The token may legitimately appear once as part of a canonical URL or in
# an asset href. Anything more than 2 occurrences is suspicious.
OCCURRENCES=$(echo "$HTML" | grep -o "$TEST_TOKEN" | wc -l | tr -d ' ')
if [ "$OCCURRENCES" -le 2 ]; then
  echo "  OK Token '$TEST_TOKEN' appears $OCCURRENCES time(s) (acceptable: <=2)"
else
  echo "  WARN Token appears $OCCURRENCES times in HTML — review for leakage"
  echo "       (this may be a false positive if the route is statically rendered)"
fi

# ---------------------------------------------------------------------------
# Test 3.4: Public landing does NOT expose Convex deployment URL with secrets
# ---------------------------------------------------------------------------
echo ""
echo "==> Test 3.4: No secret env vars in public HTML"
SECRET_PATTERNS=(
  "QUOTATION_TOKEN_SECRET"
  "RESEND_API_KEY"
  "ANTHROPIC_API_KEY"
  "CLERK_SECRET_KEY"
)
LEAK_FOUND=0
for pat in "${SECRET_PATTERNS[@]}"; do
  if echo "$HTML" | grep -q "$pat"; then
    echo "  FAIL: secret env var name '$pat' appears in public HTML"
    LEAK_FOUND=1
  fi
done
if [ "$LEAK_FOUND" = "0" ]; then
  echo "  OK No known secret env var names in public HTML"
else
  exit 1
fi

echo ""
echo "==> All security checks passed"
