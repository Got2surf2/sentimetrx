#!/usr/bin/env bash
# Exercise the admin-session wiring against a local dev server on :3000
# (started separately with `bash scripts/dev.sh test`). Expected:
#   1. expired-idle stamp on an admin API   → 401 {reason:"idle"}
#   2. expired-max  stamp on an admin API   → 401 {reason:"max"}
#   3. expired-idle stamp on /admin page    → 307 → /login?reason=idle, cookie cleared
#   4. fresh stamp on a public page         → 200 and a REFRESHED Set-Cookie sx_admin_session
#   5. no stamp on a public page            → 200, no admin cookie touched
#   6. /login?reason=idle                   → page mentions "30 minutes of inactivity"
set -u
cd "$(dirname "$0")/.."
eval "$(npx tsx scripts/_adminStampGen.ts 2>/dev/null | grep -E "^[A-Z_]+=")"
echo "key source: $KEYSRC"
B=http://localhost:3000
hdr() { curl -s -o /dev/null -D - "$@" ; }
echo "── 1. idle stamp → admin API"; curl -s -i "$B/api/admin/usage" -H "Cookie: sx_admin_session=$EXPIRED_IDLE" | grep -E "^HTTP|reason" | head -3
echo "── 2. max stamp → admin API";  curl -s -i "$B/api/admin/usage" -H "Cookie: sx_admin_session=$EXPIRED_MAX"  | grep -E "^HTTP|reason" | head -3
echo "── 3. idle stamp → /admin page"; hdr "$B/admin" -H "Cookie: sx_admin_session=$EXPIRED_IDLE" | grep -iE "^HTTP|^location|set-cookie: sx_admin" | head -4
echo "── 4. fresh stamp → public page (expect 200 + refreshed cookie)"; hdr "$B/login" -H "Cookie: sx_admin_session=$FRESH" | grep -iE "^HTTP|set-cookie: sx_admin" | cut -c1-120 | head -3
echo "   refreshed seen differs from minted? minted seen=$(echo "$FRESH" | cut -d. -f2)"
echo "── 5. no stamp → public page"; hdr "$B/login" | grep -iE "^HTTP|set-cookie: sx_admin" | head -3
echo "── 6. /login?reason=idle renders the notice"; curl -s "$B/login?reason=idle" | grep -oE "30 minutes of inactivity[^<]*" | head -1
