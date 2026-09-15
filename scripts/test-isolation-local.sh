#!/usr/bin/env bash
# Run one of the env-gated isolation suites against the TEST project
# (Sentimetrx-Test) from a laptop — the same re-pointing scripts/dev.sh does
# for the dev server, applied to a test script. CI does the equivalent in the
# "multi-tenant isolation" job from the SUPABASE_TEST_* secrets.
#
#   bash scripts/test-isolation-local.sh test:egress
#   bash scripts/test-isolation-local.sh test:rls
#   bash scripts/test-isolation-local.sh test:auth-flows
#
# Why not just `npm run test:egress`? .env.local's runtime names point at PROD
# (kept that way for read-only scripts and dev:prod), and these suites seed +
# delete rows. They namespace and clean up after themselves, but they still
# must never run against the production project — this wrapper makes the
# safe target the only target.
set -euo pipefail
SCRIPT="${1:?usage: test-isolation-local.sh <npm script, e.g. test:egress>}"
TEST_URL=$(grep '^SUPABASE_TEST_URL=' .env.local | cut -d= -f2-)
TEST_ANON=$(grep '^SUPABASE_TEST_ANON_KEY=' .env.local | cut -d= -f2-)
TEST_SR=$(grep '^SUPABASE_TEST_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2-)
if [ -z "$TEST_URL" ] || [ -z "$TEST_ANON" ] || [ -z "$TEST_SR" ]; then
  echo "ERROR: SUPABASE_TEST_* values missing from .env.local — refusing to run an isolation suite." >&2
  exit 1
fi
export NEXT_PUBLIC_SUPABASE_URL="$TEST_URL"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$TEST_ANON"
export SUPABASE_SERVICE_ROLE_KEY="$TEST_SR"
echo "▶ $SCRIPT → TEST project ($(echo "$TEST_URL" | sed 's|https://||;s|\.supabase\.co||'))"
exec npm run --silent "$SCRIPT"
