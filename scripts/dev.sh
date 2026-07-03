#!/usr/bin/env bash
# Dev launcher — decides which database the local dev server talks to.
#
#   npm run dev        → TEST project (Sentimetrx-Test). The safe default:
#                        break anything, seed anything, no client data.
#   npm run dev:prod   → PRODUCTION database, with a loud red banner in the
#                        UI. Use deliberately — e.g. QC-ing a report/deck
#                        against real data. Read-only habits apply
#                        (docs/SECURITY.md; never run mutating experiments
#                        against prod).
#
# Mechanism: process env beats .env.local in Next.js, so exporting the
# TEST creds under the runtime names re-points the whole app without
# touching .env.local (which keeps prod values for scripts that want them
# and for dev:prod).
set -euo pipefail

MODE="${1:-test}"

if [ "$MODE" = "test" ]; then
  # Pull the test-project creds out of .env.local and re-export them
  # under the runtime names.
  TEST_URL=$(grep '^SUPABASE_TEST_URL=' .env.local | cut -d= -f2-)
  TEST_ANON=$(grep '^SUPABASE_TEST_ANON_KEY=' .env.local | cut -d= -f2-)
  TEST_SR=$(grep '^SUPABASE_TEST_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2-)
  if [ -z "$TEST_URL" ] || [ -z "$TEST_ANON" ] || [ -z "$TEST_SR" ]; then
    echo "ERROR: SUPABASE_TEST_* values missing from .env.local — cannot start test-mode dev." >&2
    echo "       Use 'npm run dev:prod' if you intend to develop against production." >&2
    exit 1
  fi
  export NEXT_PUBLIC_SUPABASE_URL="$TEST_URL"
  export NEXT_PUBLIC_SUPABASE_ANON_KEY="$TEST_ANON"
  export SUPABASE_SERVICE_ROLE_KEY="$TEST_SR"
  export NEXT_PUBLIC_DB_TARGET="test"
  echo "▶ dev server → TEST project ($(echo "$TEST_URL" | sed 's|https://||;s|\.supabase\.co||'))"
else
  export NEXT_PUBLIC_DB_TARGET="prod"
  echo "▶ dev server → ⚠️  PRODUCTION database (banner shown in UI)"
fi

exec npx next dev --webpack
