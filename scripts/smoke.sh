#!/usr/bin/env bash
# Post-deploy smoke test (Phase 20). Checks a deployed QueueFlow from the
# outside, with no accounts or secrets: the API is up and talking to its
# database, only the web app may call it, it sees real visitor IPs, public
# sign-up is off, and the web app is served with its security headers and
# points at the right API.
#
#   scripts/smoke.sh https://api.q.m9rcy.dev https://q.m9rcy.dev
#
# Exits non-zero if anything fails. Run after every production deploy.
set -uo pipefail

API="${1:?usage: scripts/smoke.sh <api-url> <web-url>}"
WEB="${2:?usage: scripts/smoke.sh <api-url> <web-url>}"
API="${API%/}"
WEB="${WEB%/}"
failures=0

pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; failures=$((failures + 1)); }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }
header() { curl -s -D - -o /dev/null "${@:2}" "$1" | tr -d '\r'; }

echo "API: $API"
check "health is ok (and the database answers)" \
  "curl -sf '$API/health' | grep -q '\"status\":\"ok\"'"
check "HTTPS is enforced (HSTS)" \
  "header '$API/health' | grep -qi '^strict-transport-security:'"
check "the web app may call it (CORS)" \
  "header '$API/health' -H 'Origin: $WEB' | grep -qi '^access-control-allow-origin: $WEB\$'"
check "other websites may not (CORS)" \
  "! header '$API/health' -H 'Origin: https://not-queueflow.example' | grep -qi '^access-control-allow-origin:'"
check "public business sign-up is off (404)" \
  "[ \"\$(curl -s -o /dev/null -w '%{http_code}' -X POST '$API/auth/business-signup' -H 'Content-Type: application/json' -d '{\"businessName\":\"Smoke\",\"ownerName\":\"S\",\"email\":\"smoke@example.com\"}')\" = 404 ]"
check "platform sign-in answers without revealing admins (202)" \
  "[ \"\$(curl -s -o /dev/null -w '%{http_code}' -X POST '$API/platform/login/request' -H 'Content-Type: application/json' -d '{\"email\":\"not-an-admin@example.com\"}')\" = 202 ]"
check "an unknown ticket's QR is 404" \
  "[ \"\$(curl -s -o /dev/null -w '%{http_code}' '$API/public/queue-entries/not-a-real-token/qr.png')\" = 404 ]"
ip=$(curl -s "$API/health/ip" | sed -E 's/.*"ip":"?([^"}]*)"?.*/\1/')
echo "  · the API sees your IP as: ${ip:-unknown}"
echo "    (it should be your own public IP — if it's a private 10.x/172.x address, set TRUST_PROXY_HOPS)"

echo "Web: $WEB"
for page in / /admin/login /platform; do
  check "$page loads" "[ \"\$(curl -s -o /dev/null -w '%{http_code}' '$WEB$page')\" = 200 ]"
done
check "pages may only talk to this API (CSP connect-src)" \
  "header '$WEB/admin/login' | grep -i '^content-security-policy:' | grep -q \"connect-src 'self' $API\""
check "HTTPS is enforced (HSTS)" \
  "header '$WEB/admin/login' | grep -qi '^strict-transport-security:'"
check "plain-http requests are upgraded (CSP)" \
  "header '$WEB/admin/login' | grep -i '^content-security-policy:' | grep -q 'upgrade-insecure-requests'"

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) FAILED"
  exit 1
fi
echo "All checks passed."
